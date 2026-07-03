import { access, rename, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { ClipCandidate, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getCaptionedClipPath,
  getClipOutputPath,
  getClipSrtPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import {
  markCaptionBurnAssetCompleted,
  markCaptionBurnAssetFailed,
} from "@/server/regeneration/dependencies";
import {
  resolveCaptionStylePreset,
  type CaptionStylePresetId,
} from "@/lib/captionStylePresets";
import {
  DEFAULT_CAPTION_APPEARANCE_SETTINGS,
  normalizeCaptionAppearanceSettings,
  type CaptionAppearanceSettings,
  type CaptionPosition,
} from "@/lib/clipStudio";
import { getBrandingSettings } from "@/server/branding/settings";
import { getSharp } from "@/server/agents/sharpClient";
import {
  extractSpeechCleanupCutPlan,
  remapTimelineRangeToCleanedTime,
  type SpeechCleanupCutPlan,
} from "@/lib/speechCleanupPlan";

type CaptionBurnOptions = {
  ffmpegPath?: string;
  allowReburn?: boolean;
  force?: boolean;
  captionStylePresetId?: CaptionStylePresetId;
};

type ClipForCaptionBurn = Pick<
  ClipCandidate,
  | "id"
  | "sermonId"
  | "status"
  | "renderStatus"
  | "renderedFilePath"
  | "captionStatus"
  | "subtitleFilePath"
  | "srtPath"
  | "captionData"
  | "captionBurnStatus"
  | "captionedVideoPath"
>;

type CaptionBurnEligibilityInput = {
  status: ClipCandidate["status"];
  renderStatus: ClipCandidate["renderStatus"];
  captionStatus: ClipCandidate["captionStatus"];
  captionBurnStatus: ClipCandidate["captionBurnStatus"];
  renderedClipExists: boolean;
  subtitleExists: boolean;
  allowReburn: boolean;
};

type CaptionBurnEligibility = {
  ok: boolean;
  reason?: string;
};

type CaptionBurnResult = {
  clipId: string;
  captionedVideoPath: string;
  burnedAt: Date;
  reusedExistingFile: boolean;
};

type CaptionCueOverlay = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  activeWordIndex?: number;
};

type CaptionSafeArea = "STANDARD" | "RAISED" | "LOWER_MINIMAL";

const FALLBACK_VIDEO_ENCODER = "libx264";
const HARDWARE_VIDEO_ENCODER = "h264_videotoolbox";

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function resolvePreferredVideoEncoder(): string {
  return process.env.CLIP_CAPTION_BURN_VIDEO_ENCODER?.trim()
    || process.env.CLIP_RENDER_VIDEO_ENCODER?.trim()
    || process.env.CLIP_EXPORT_VIDEO_ENCODER?.trim()
    || (process.platform === "darwin" ? HARDWARE_VIDEO_ENCODER : FALLBACK_VIDEO_ENCODER);
}

function isHardwareVideoEncoder(encoder: string): boolean {
  return encoder === HARDWARE_VIDEO_ENCODER || encoder.includes("videotoolbox");
}

function buildVideoEncoderArgs(encoder: string): string[] {
  if (encoder === HARDWARE_VIDEO_ENCODER) {
    return [
      "-c:v",
      HARDWARE_VIDEO_ENCODER,
      "-b:v",
      process.env.CLIP_CAPTION_BURN_VIDEO_BITRATE?.trim()
        || process.env.CLIP_RENDER_VIDEO_BITRATE?.trim()
        || process.env.CLIP_EXPORT_VIDEO_BITRATE?.trim()
        || "5000k",
      "-allow_sw",
      "1",
    ];
  }

  if (encoder !== FALLBACK_VIDEO_ENCODER) {
    return ["-c:v", encoder];
  }

  return [
    "-c:v",
    FALLBACK_VIDEO_ENCODER,
    "-preset",
    "veryfast",
    "-crf",
    "23",
  ];
}

function getTempBurnPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".captioning.partial.mp4");
}

function escapeForFfmpegSubtitlesPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function withCaptionSafeArea(style: string, safeArea: CaptionSafeArea): string {
  const margin =
    safeArea === "RAISED"
      ? 104
      : safeArea === "LOWER_MINIMAL"
        ? 44
        : null;

  if (margin === null) {
    return style;
  }

  return style.replace(/MarginV=\d+/, `MarginV=${margin}`);
}

function withCaptionPlacement(style: string, safeArea: CaptionSafeArea, captionPosition: CaptionPosition): string {
  if (captionPosition === "top") {
    return style.replace(/Alignment=\d+/, "Alignment=8").replace(/MarginV=\d+/, "MarginV=82");
  }

  if (captionPosition === "middle") {
    return style.replace(/Alignment=\d+/, "Alignment=5").replace(/MarginV=\d+/, "MarginV=0");
  }

  return withCaptionSafeArea(style, safeArea);
}

function withCaptionAppearance(style: string, appearance?: CaptionAppearanceSettings): string {
  if (!appearance) {
    return style;
  }

  const fontSizeMultiplier =
    appearance.fontScale === "compact"
      ? 0.88
      : appearance.fontScale === "large"
        ? 1.16
        : 1;
  const withFontSize = style.replace(/FontSize=(\d+)/, (_match, size: string) => {
    const scaledSize = Math.max(14, Math.round(Number(size) * fontSizeMultiplier));
    return `FontSize=${scaledSize}`;
  });

  if (appearance.verticalOffset === 0) {
    return withFontSize;
  }

  return withFontSize.replace(/MarginV=(\d+)/, (_match, margin: string) => {
    const shiftedMargin = Math.max(0, Math.round(Number(margin) + appearance.verticalOffset));
    return `MarginV=${shiftedMargin}`;
  });
}

function buildCaptionForceStyle(
  presetId: string | null | undefined,
  safeArea: CaptionSafeArea = "STANDARD",
  captionPosition: CaptionPosition = "lower",
  appearance?: CaptionAppearanceSettings,
): string {
  const preset = resolveCaptionStylePreset(presetId);
  const base = "FontName=Arial,BorderStyle=1,Shadow=0";
  const boxedBase = base.replace("BorderStyle=1", "BorderStyle=3");
  const applyAppearance = (style: string) => withCaptionAppearance(style, appearance);

  if (preset.id === "clean-lower") {
    return applyAppearance(withCaptionPlacement(`${boxedBase},FontSize=21,PrimaryColour=&H00111111,OutlineColour=&H00FFFFFF,BackColour=&HEEFFFFFF,Outline=2,Shadow=1,Alignment=2,MarginV=58`, safeArea, captionPosition));
  }

  if (preset.id === "kinetic-pop") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=29,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=5,Shadow=2,Alignment=2,MarginV=70`, safeArea, captionPosition));
  }

  if (preset.id === "creator-highlight") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00111827,BackColour=&H8822D3EE,Outline=3,Shadow=2,Alignment=2,MarginV=66`, safeArea, captionPosition));
  }

  if (preset.id === "soft-bubble") {
    return applyAppearance(withCaptionPlacement(`${boxedBase},FontSize=21,PrimaryColour=&H00111827,OutlineColour=&H00FFFFFF,BackColour=&HEEFFFFFF,Outline=2,Shadow=1,Alignment=2,MarginV=58`, safeArea, captionPosition));
  }

  if (preset.id === "high-contrast") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=22,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,Outline=4,Alignment=2,MarginV=64`, safeArea, captionPosition));
  }

  if (preset.id === "youth-social") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00D84D1D,Outline=4,Shadow=2,Alignment=2,MarginV=72`, safeArea, captionPosition));
  }

  if (preset.id === "minimal-church") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,Outline=1,Shadow=1,Alignment=2,MarginV=42`, safeArea, captionPosition));
  }

  if (preset.id === "scripture-focus") {
    return applyAppearance(withCaptionPlacement(`${boxedBase.replace("FontName=Arial", "FontName=Georgia")},FontSize=20,PrimaryColour=&H00111111,OutlineColour=&H00FACC15,BackColour=&HEEFFFFFF,Outline=1,Shadow=1,Alignment=2,MarginV=60`, safeArea, captionPosition));
  }

  if (preset.id === "cinematic-testimony") {
    return applyAppearance(withCaptionPlacement(`${base},FontSize=20,PrimaryColour=&H00F8FAFC,OutlineColour=&H00111827,BackColour=&HAA111827,Outline=2,Shadow=2,Alignment=2,MarginV=54`, safeArea, captionPosition));
  }

  return applyAppearance(withCaptionPlacement(`${base},FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Alignment=2,MarginV=64`, safeArea, captionPosition));
}

function resolveCaptionSafeArea(captionData: unknown): CaptionSafeArea {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return "STANDARD";
  }

  const framingDecision = (captionData as Record<string, unknown>)["framingDecision"];
  if (!framingDecision || typeof framingDecision !== "object" || Array.isArray(framingDecision)) {
    return "STANDARD";
  }

  const safeArea = (framingDecision as Record<string, unknown>)["captionSafeArea"];
  return safeArea === "RAISED" || safeArea === "LOWER_MINIMAL" ? safeArea : "STANDARD";
}

function resolveCaptionPosition(captionData: unknown): CaptionPosition {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return "lower";
  }

  const value = (captionData as Record<string, unknown>)["captionPosition"];
  return value === "top" || value === "middle" || value === "lower" ? value : "lower";
}

function resolveCaptionAppearance(captionData: unknown): CaptionAppearanceSettings {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return DEFAULT_CAPTION_APPEARANCE_SETTINGS;
  }

  return normalizeCaptionAppearanceSettings((captionData as Record<string, unknown>)["captionAppearance"]);
}

function resolveClipCaptionStylePresetId(
  captionData: unknown,
  fallback: CaptionStylePresetId,
): CaptionStylePresetId {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return fallback;
  }

  const value = (captionData as Record<string, unknown>)["captionStylePresetId"];
  if (
    value === "bold-sermon" ||
    value === "kinetic-pop" ||
    value === "creator-highlight" ||
    value === "soft-bubble" ||
    value === "clean-lower" ||
    value === "high-contrast" ||
    value === "youth-social" ||
    value === "minimal-church" ||
    value === "scripture-focus" ||
    value === "cinematic-testimony"
  ) {
    return value;
  }

  return fallback;
}

function shouldApplyCaptionsToClip(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return true;
  }

  const value = (captionData as Record<string, unknown>)["applyCaptionsToClip"];
  return typeof value === "boolean" ? value : true;
}

function shouldUseWordHighlightOverlay(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return false;
  }

  return (captionData as Record<string, unknown>)["wordHighlightEnabled"] === true;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r?\n/g, " ")
    .trim();
}

function wrapCaptionText(value: string, maxLineLength = 34, maxLines = 4): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLineLength && current) {
      lines.push(current);
      current = word;
      continue;
    }

    current = candidate;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

type CaptionOverlayWord = {
  index: number;
  text: string;
};

function splitCaptionOverlayWords(value: string): string[] {
  return value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function getCaptionOverlayWordWeight(word: string): number {
  const spokenCharacterCount = word.replace(/[^\p{L}\p{N}]+/gu, "").length;
  const punctuationWeight = /[.!?]["')\]]?$/.test(word)
    ? 0.45
    : /[,;:]["')\]]?$/.test(word)
      ? 0.225
      : 0;

  return Math.max(1, spokenCharacterCount) + punctuationWeight;
}

function wrapCaptionWords(value: string, maxLineLength = 34, maxLines = 4): CaptionOverlayWord[][] {
  const words = splitCaptionOverlayWords(value).map((word, index) => ({ index, text: word }));
  const lines: CaptionOverlayWord[][] = [];
  let current: CaptionOverlayWord[] = [];
  let currentLength = 0;

  for (const word of words) {
    const nextLength = currentLength + (current.length > 0 ? 1 : 0) + word.text.length;
    if (nextLength > maxLineLength && current.length > 0) {
      lines.push(current);
      current = [word];
      currentLength = word.text.length;
      continue;
    }

    current.push(word);
    currentLength = nextLength;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

function extractCaptionCueOverlays(captionData: unknown): CaptionCueOverlay[] {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return [];
  }

  const cues = (captionData as Record<string, unknown>)["cues"];
  if (!Array.isArray(cues)) {
    return [];
  }

  return cues.flatMap((cue, index) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
      return [];
    }

    const record = cue as Record<string, unknown>;
    const startSeconds = Number(record["startSeconds"]);
    const endSeconds = Number(record["endSeconds"]);
    const text = typeof record["text"] === "string" ? record["text"].replace(/\s+/g, " ").trim() : "";

    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || !text) {
      return [];
    }

    return [{
      index: Number(record["index"]) || index + 1,
      startSeconds,
      endSeconds,
      text,
    }];
  });
}

function remapCaptionCueOverlaysForSpeechCleanup(
  cues: CaptionCueOverlay[],
  plan: SpeechCleanupCutPlan | null,
): CaptionCueOverlay[] {
  if (!plan?.enabled) {
    return cues;
  }

  return cues.flatMap((cue, index) => {
    const remapped = remapTimelineRangeToCleanedTime({
      startSeconds: cue.startSeconds,
      endSeconds: cue.endSeconds,
      plan,
    });
    if (!remapped) {
      return [];
    }

    return [{
      ...cue,
      index: index + 1,
      startSeconds: remapped.startSeconds,
      endSeconds: remapped.endSeconds,
    }];
  });
}

function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const milliseconds = Math.round((clamped - Math.floor(clamped)) * 1000);

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(wholeSeconds).padStart(2, "0"),
  ].join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

function buildSrtFromCaptionCueOverlays(cues: CaptionCueOverlay[]): string {
  return cues
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}`,
      cue.text,
    ].join("\n"))
    .join("\n\n");
}

function captionOverlayFontSize(appearance: CaptionAppearanceSettings): number {
  if (appearance.fontScale === "compact") {
    return 32;
  }

  if (appearance.fontScale === "large") {
    return 42;
  }

  return 36;
}

function captionOverlayLineLength(appearance: CaptionAppearanceSettings): number {
  if (appearance.fontScale === "compact") {
    return 40;
  }

  if (appearance.fontScale === "large") {
    return 29;
  }

  return 34;
}

function formatCaptionOverlayText(value: string, appearance: CaptionAppearanceSettings): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return appearance.uppercase ? normalized.toUpperCase() : normalized;
}

function buildCaptionOverlaySvg(
  cue: CaptionCueOverlay,
  appearance: CaptionAppearanceSettings = DEFAULT_CAPTION_APPEARANCE_SETTINGS,
): string {
  const width = 960;
  const fontSize = captionOverlayFontSize(appearance);
  const maxLineLength = captionOverlayLineLength(appearance);
  const displayText = formatCaptionOverlayText(cue.text, appearance);
  const wordLines = cue.activeWordIndex === undefined ? [] : wrapCaptionWords(displayText, maxLineLength, appearance.maxLines);
  const lines = wordLines.length > 0 ? [] : wrapCaptionText(displayText, maxLineLength, appearance.maxLines);
  const lineHeight = Math.round(fontSize * 1.22);
  const lineCount = Math.max(1, wordLines.length || lines.length);
  const totalTextHeight = Math.max(lineHeight, lineCount * lineHeight);
  const height = Math.max(190, totalTextHeight + 62);
  const firstY = Math.round((height - totalTextHeight) / 2) + 8;
  const activeFontSize = Math.round(fontSize * 1.08);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#000000" fill-opacity="0.68" />
      ${wordLines.length > 0
        ? wordLines.map((line, lineIndex) => (
            `<text x="${width / 2}" y="${firstY + lineIndex * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900" fill="#FFFFFF" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-width="5" stroke-linejoin="round">${line.map((word, wordIndex) => {
              const isActive = word.index === cue.activeWordIndex;
              const prefix = wordIndex === 0 ? "" : " ";
              return `<tspan fill="${isActive ? "#22C55E" : "#FFFFFF"}" font-size="${isActive ? activeFontSize : fontSize}">${escapeSvgText(`${prefix}${word.text}`)}</tspan>`;
            }).join("")}</text>`
          )).join("\n      ")
        : lines.map((line, index) => (
            `<text x="${width / 2}" y="${firstY + index * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#FFFFFF" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-width="5" stroke-linejoin="round">${escapeSvgText(line)}</text>`
          )).join("\n      ")}
    </svg>
  `;
}

function expandCaptionCueWordHighlightOverlays(cues: CaptionCueOverlay[]): CaptionCueOverlay[] {
  return cues.flatMap((cue) => {
    const words = splitCaptionOverlayWords(cue.text);
    const durationSeconds = cue.endSeconds - cue.startSeconds;

    if (words.length === 0 || durationSeconds <= 0) {
      return [];
    }

    const weights = words.map(getCaptionOverlayWordWeight);
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    if (totalWeight <= 0) {
      return [];
    }

    let cursorSeconds = cue.startSeconds;
    let cumulativeWeight = 0;

    return words.map((_, wordIndex) => {
      const wordStartSeconds = cursorSeconds;
      cumulativeWeight += weights[wordIndex];
      const wordEndSeconds = wordIndex === words.length - 1
        ? cue.endSeconds
        : cue.startSeconds + durationSeconds * (cumulativeWeight / totalWeight);
      cursorSeconds = wordEndSeconds;

      return {
        ...cue,
        index: cue.index * 1000 + wordIndex + 1,
        startSeconds: Number(wordStartSeconds.toFixed(3)),
        endSeconds: Number(wordEndSeconds.toFixed(3)),
        activeWordIndex: wordIndex,
      };
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function validateCaptionBurnEligibility(input: CaptionBurnEligibilityInput): CaptionBurnEligibility {
  if (input.status !== "APPROVED" && !(input.allowReburn && input.status === "EXPORTED")) {
    return { ok: false, reason: "Clip must be approved before caption burn." };
  }

  if (input.captionBurnStatus === "BURNING") {
    return { ok: false, reason: "Caption burn is already running for this clip." };
  }

  if (input.captionBurnStatus === "COMPLETED" && !input.allowReburn) {
    return { ok: false, reason: "Caption burn already completed. Use re-burn to run again." };
  }

  if (input.renderStatus !== "COMPLETED") {
    return { ok: false, reason: "Rendered clip is not completed yet." };
  }

  if (!input.renderedClipExists) {
    return { ok: false, reason: "Rendered clip file does not exist." };
  }

  if (input.captionStatus !== "GENERATED") {
    return { ok: false, reason: "Caption/SRT data is not generated yet." };
  }

  if (!input.subtitleExists) {
    return { ok: false, reason: "Subtitle SRT file does not exist." };
  }

  return { ok: true };
}

function buildCaptionBurnMetadata(input: {
  outputPath: string;
  burnedAt: Date;
  captionStylePresetId?: CaptionStylePresetId;
  captionSafeArea?: CaptionSafeArea;
  captionPosition?: CaptionPosition;
  captionAppearance?: CaptionAppearanceSettings;
  captionData?: unknown;
}): Pick<Prisma.ClipCandidateUpdateInput, "captionBurnStatus" | "captionedVideoPath" | "captionBurnedAt" | "captionBurnError" | "subtitlesBurned" | "captionData"> {
  const currentCaptionData =
    input.captionData && typeof input.captionData === "object" && !Array.isArray(input.captionData)
      ? (input.captionData as Record<string, unknown>)
      : {};

  return {
    captionBurnStatus: "COMPLETED",
    captionedVideoPath: input.outputPath,
    captionBurnedAt: input.burnedAt,
    captionBurnError: null,
    subtitlesBurned: true,
    captionData: {
      ...currentCaptionData,
      captionStylePresetId: resolveCaptionStylePreset(input.captionStylePresetId).id,
      captionSafeArea: input.captionSafeArea ?? resolveCaptionSafeArea(input.captionData),
      captionPosition: input.captionPosition ?? resolveCaptionPosition(input.captionData),
      captionAppearance: input.captionAppearance ?? resolveCaptionAppearance(input.captionData),
      captionBurnedAt: input.burnedAt.toISOString(),
    },
  };
}

async function loadClipForCaptionBurn(clipId: string): Promise<ClipForCaptionBurn> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      renderStatus: true,
      renderedFilePath: true,
      captionStatus: true,
      subtitleFilePath: true,
      srtPath: true,
      captionData: true,
      captionBurnStatus: true,
      captionedVideoPath: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

async function claimCaptionBurnStart(clipId: string): Promise<void> {
  const result = await prisma.clipCandidate.updateMany({
    where: {
      id: clipId,
      captionBurnStatus: {
        not: "BURNING",
      },
    },
    data: {
      captionBurnStatus: "BURNING",
      captionBurnError: null,
    },
  });

  if (result.count === 0) {
    throw new Error("Caption burn is already running for this clip.");
  }
}

async function runFfmpegCaptionBurn(input: {
  sermonId: string;
  renderedPath: string;
  subtitlePath: string;
  outputPath: string;
  ffmpegPath?: string;
  jobId: string;
  captionStylePresetId?: CaptionStylePresetId;
  captionSafeArea?: CaptionSafeArea;
  captionPosition?: CaptionPosition;
  appearance?: CaptionAppearanceSettings;
}): Promise<void> {
  const escapedSubtitlePath = escapeForFfmpegSubtitlesPath(input.subtitlePath);
  const forceStyle = buildCaptionForceStyle(input.captionStylePresetId, input.captionSafeArea, input.captionPosition, input.appearance);
  const command = commandFor(input.ffmpegPath);

  await appendPipelineLog(input.sermonId, "Caption burn started.");

  const runWithEncoder = async (videoEncoder: string): Promise<void> => {
    const args = [
      "-y",
      "-i",
      input.renderedPath,
      "-vf",
      `subtitles=filename='${escapedSubtitlePath}':force_style='${forceStyle}'`,
      ...buildVideoEncoderArgs(videoEncoder),
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      input.outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text.length > 0) {
          void appendJobLog(input.jobId, `[ffmpeg stdout] ${text}`).catch(() => undefined);
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          void appendJobLog(input.jobId, `[ffmpeg stderr] ${trimmed}`).catch(() => undefined);
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`FFmpeg caption burn failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1400)}`.trim()));
      });
    });
  };

  const preferredVideoEncoder = resolvePreferredVideoEncoder();
  try {
    await runWithEncoder(preferredVideoEncoder);
  } catch (error) {
    if (!isHardwareVideoEncoder(preferredVideoEncoder)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown caption burn error.";
    await unlink(input.outputPath).catch(() => undefined);
    await appendJobLog(input.jobId, `Hardware caption burn failed with ${preferredVideoEncoder}; retrying with ${FALLBACK_VIDEO_ENCODER}. Original error: ${message}`);
    await appendPipelineLog(input.sermonId, `Hardware caption burn fallback used: ${preferredVideoEncoder} failed.`);
    await runWithEncoder(FALLBACK_VIDEO_ENCODER);
  }
}

async function createCaptionOverlayImages(input: {
  cues: CaptionCueOverlay[];
  outputPath: string;
  appearance?: CaptionAppearanceSettings;
}): Promise<string[]> {
  const imagePaths: string[] = [];
  const sharp = await getSharp();

  for (const cue of input.cues) {
    const imagePath = input.outputPath.replace(/\.mp4$/i, `.cue-${String(cue.index).padStart(2, "0")}.png`);
    await sharp(Buffer.from(buildCaptionOverlaySvg(cue, input.appearance))).png().toFile(imagePath);
    imagePaths.push(imagePath);
  }

  return imagePaths;
}

function captionOverlayYExpression(captionPosition: CaptionPosition | undefined, appearance?: CaptionAppearanceSettings): string {
  const offset = appearance?.verticalOffset ?? 0;
  if (captionPosition === "top") {
    return String(Math.max(24, 132 - offset));
  }

  if (captionPosition === "middle") {
    if (offset === 0) {
      return "(H-h)/2";
    }

    return offset > 0 ? `(H-h)/2-${offset}` : `(H-h)/2+${Math.abs(offset)}`;
  }

  const lowerMargin = Math.max(24, 132 + offset);
  if (lowerMargin === 132) {
    return "H-h-132";
  }

  return `H-h-${lowerMargin}`;
}

async function runFfmpegCaptionOverlayFallback(input: {
  sermonId: string;
  renderedPath: string;
  outputPath: string;
  ffmpegPath?: string;
  jobId: string;
  cues: CaptionCueOverlay[];
  captionPosition?: CaptionPosition;
  appearance?: CaptionAppearanceSettings;
}): Promise<void> {
  if (input.cues.length === 0) {
    throw new Error("Caption overlay fallback could not find any caption cues.");
  }

  const imagePaths = await createCaptionOverlayImages({
    cues: input.cues,
    outputPath: input.outputPath,
    appearance: input.appearance,
  });

  const command = commandFor(input.ffmpegPath);
  let previous = "[0:v]";
  const filterParts: string[] = [];
  const overlayY = captionOverlayYExpression(input.captionPosition, input.appearance);
  input.cues.forEach((cue, index) => {
    const output = index === input.cues.length - 1 ? "[v]" : `[captioned${index}]`;
    filterParts.push(
      `${previous}[${index + 1}:v]overlay=(W-w)/2:${overlayY}:enable='between(t,${cue.startSeconds.toFixed(3)},${cue.endSeconds.toFixed(3)})':eof_action=pass${output}`,
    );
    previous = output;
  });

  const buildArgs = (videoEncoder: string): string[] => {
    const args = ["-y", "-i", input.renderedPath];
    for (const imagePath of imagePaths) {
      args.push("-loop", "1", "-i", imagePath);
    }

    args.push(
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[v]",
      "-map",
      "0:a?",
      ...buildVideoEncoderArgs(videoEncoder),
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      input.outputPath,
    );
    return args;
  };

  await appendPipelineLog(input.sermonId, "Caption overlay fallback started.");

  const runWithEncoder = async (videoEncoder: string): Promise<void> => {
    const args = buildArgs(videoEncoder);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text.length > 0) {
          void appendJobLog(input.jobId, `[ffmpeg fallback stdout] ${text}`).catch(() => undefined);
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          void appendJobLog(input.jobId, `[ffmpeg fallback stderr] ${trimmed}`).catch(() => undefined);
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to start FFmpeg caption overlay fallback: ${error.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`FFmpeg caption overlay fallback failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1400)}`.trim()));
      });
    });
  };

  try {
    const preferredVideoEncoder = resolvePreferredVideoEncoder();
    try {
      await runWithEncoder(preferredVideoEncoder);
    } catch (error) {
      if (!isHardwareVideoEncoder(preferredVideoEncoder)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unknown caption overlay error.";
      await unlink(input.outputPath).catch(() => undefined);
      await appendJobLog(input.jobId, `Hardware caption overlay failed with ${preferredVideoEncoder}; retrying with ${FALLBACK_VIDEO_ENCODER}. Original error: ${message}`);
      await appendPipelineLog(input.sermonId, `Hardware caption overlay fallback used: ${preferredVideoEncoder} failed.`);
      await runWithEncoder(FALLBACK_VIDEO_ENCODER);
    }
  } finally {
    await Promise.all(imagePaths.map((imagePath) => unlink(imagePath).catch(() => undefined)));
  }
}

function shouldUseCaptionOverlayFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No such filter: 'subtitles'") || message.includes("No such filter: subtitles");
}

async function burnCaptionsForClipCore(
  clip: ClipForCaptionBurn,
  options: CaptionBurnOptions | undefined,
  jobId: string,
): Promise<CaptionBurnResult> {
  await ensureSermonFolders(clip.sermonId);

  const renderedPath = clip.renderedFilePath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
  const subtitlePath = clip.subtitleFilePath?.trim() || clip.srtPath?.trim() || getClipSrtPath(clip.sermonId, clip.id);
  const captionedVideoPath = getCaptionedClipPath(clip.sermonId, clip.id);
  const tempCaptionedVideoPath = getTempBurnPath(captionedVideoPath);
  const speechCleanupPlan = extractSpeechCleanupCutPlan(clip.captionData);
  const sourceCaptionCues = extractCaptionCueOverlays(clip.captionData);
  const renderCaptionCues = remapCaptionCueOverlaysForSpeechCleanup(sourceCaptionCues, speechCleanupPlan);
  const renderCaptionData = clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
    ? { ...(clip.captionData as Record<string, unknown>), cues: renderCaptionCues }
    : clip.captionData;

  const renderedClipExists = await fileExists(renderedPath);
  const subtitleExists = await fileExists(subtitlePath) || renderCaptionCues.length > 0;

  const eligibility = validateCaptionBurnEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    captionStatus: clip.captionStatus,
    captionBurnStatus: clip.captionBurnStatus,
    renderedClipExists,
    subtitleExists,
    allowReburn: Boolean(options?.allowReburn),
  });

  if (!eligibility.ok) {
    throw new Error(eligibility.reason ?? "Clip is not eligible for caption burn.");
  }

  if (!shouldApplyCaptionsToClip(clip.captionData)) {
    throw new Error("Captions are disabled for this clip in Clip Studio.");
  }

  const existingOutput = await fileExists(captionedVideoPath);
  if (existingOutput && !options?.force && !options?.allowReburn) {
    const burnedAt = new Date();
    const brandingSettings = await getBrandingSettings();
    const captionStylePresetId = resolveClipCaptionStylePresetId(
      clip.captionData,
      options?.captionStylePresetId ?? (brandingSettings.defaultCaptionStyleName as CaptionStylePresetId),
    );
    const captionPosition = resolveCaptionPosition(renderCaptionData);
    const captionAppearance = resolveCaptionAppearance(renderCaptionData);
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: buildCaptionBurnMetadata({
        outputPath: captionedVideoPath,
        burnedAt,
        captionStylePresetId,
        captionSafeArea: resolveCaptionSafeArea(clip.captionData),
        captionPosition,
        captionAppearance,
        captionData: clip.captionData,
      }),
    });
    await markCaptionBurnAssetCompleted(clip.id, false);

    await appendJobLog(jobId, `Reused existing captioned video for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Reused captioned video for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      captionedVideoPath,
      burnedAt,
      reusedExistingFile: true,
    };
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    throw new Error("FFmpeg is not installed or not executable.");
  }

  const brandingSettings = await getBrandingSettings();
  const captionStylePresetId = resolveClipCaptionStylePresetId(
    clip.captionData,
    options?.captionStylePresetId ?? (brandingSettings.defaultCaptionStyleName as CaptionStylePresetId),
  );
  const captionSafeArea = resolveCaptionSafeArea(clip.captionData);
  const captionPosition = resolveCaptionPosition(renderCaptionData);
  const captionAppearance = resolveCaptionAppearance(renderCaptionData);
  const remappedSubtitlePath = speechCleanupPlan?.enabled && renderCaptionCues.length > 0
    ? tempCaptionedVideoPath.replace(/\.mp4$/i, ".speech-cleanup.srt")
    : null;

  if (remappedSubtitlePath) {
    await writeFile(/* turbopackIgnore: true */ remappedSubtitlePath, buildSrtFromCaptionCueOverlays(renderCaptionCues), "utf8");
    await appendJobLog(jobId, "Caption timing remapped to the speech-cleaned render timeline.");
  }

  if (shouldUseWordHighlightOverlay(clip.captionData)) {
    const wordHighlightCues = expandCaptionCueWordHighlightOverlays(renderCaptionCues);
    await appendJobLog(jobId, "Caption burn using active-word image overlays.");
    await appendPipelineLog(clip.sermonId, "Caption burn using active-word image overlays.");
    await runFfmpegCaptionOverlayFallback({
      sermonId: clip.sermonId,
      renderedPath,
      outputPath: tempCaptionedVideoPath,
      ffmpegPath: options?.ffmpegPath,
      jobId,
      cues: wordHighlightCues,
      captionPosition,
      appearance: captionAppearance,
    });
  } else {
    try {
      await runFfmpegCaptionBurn({
        sermonId: clip.sermonId,
        renderedPath,
        subtitlePath: remappedSubtitlePath ?? subtitlePath,
        outputPath: tempCaptionedVideoPath,
        ffmpegPath: options?.ffmpegPath,
        jobId,
        captionStylePresetId,
        captionSafeArea,
        captionPosition,
        appearance: captionAppearance,
      });
    } catch (error) {
      if (!shouldUseCaptionOverlayFallback(error)) {
        throw error;
      }

      await unlink(tempCaptionedVideoPath).catch(() => undefined);
      await appendJobLog(jobId, "FFmpeg subtitles filter is unavailable. Retrying captions with image overlays.");
      await appendPipelineLog(clip.sermonId, "Caption burn retrying with image overlay fallback.");
      await runFfmpegCaptionOverlayFallback({
        sermonId: clip.sermonId,
        renderedPath,
        outputPath: tempCaptionedVideoPath,
        ffmpegPath: options?.ffmpegPath,
        jobId,
        cues: renderCaptionCues,
        captionPosition,
        appearance: captionAppearance,
      });
    }
  }
  if (remappedSubtitlePath) {
    await unlink(/* turbopackIgnore: true */ remappedSubtitlePath).catch(() => undefined);
  }

  try {
    await rename(tempCaptionedVideoPath, captionedVideoPath);
  } catch (error) {
    await unlink(tempCaptionedVideoPath).catch(() => undefined);
    throw error;
  }

  const outputStat = await stat(captionedVideoPath);
  if (outputStat.size <= 0) {
    throw new Error("Caption burn produced an empty output file.");
  }

  const burnedAt = new Date();
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: buildCaptionBurnMetadata({
      outputPath: captionedVideoPath,
      burnedAt,
      captionStylePresetId,
      captionSafeArea,
      captionPosition,
      captionAppearance,
      captionData: clip.captionData,
    }),
  });
  await markCaptionBurnAssetCompleted(clip.id, true);

  await appendJobLog(jobId, `Caption burn completed for clip ${clip.id}.`);
  await appendPipelineLog(clip.sermonId, `Caption burn completed for clip ${clip.id}.`);

  return {
    clipId: clip.id,
    captionedVideoPath,
    burnedAt,
    reusedExistingFile: false,
  };
}

async function failCaptionBurn(clipId: string, message: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionBurnStatus: "FAILED",
      captionBurnError: message,
    },
  });
  await markCaptionBurnAssetFailed(clipId);
}

export async function burnCaptionsIntoRenderedClip(
  clipId: string,
  options?: CaptionBurnOptions,
): Promise<CaptionBurnResult> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    throw new Error("Clip id is required for caption burn.");
  }

  const clip = await loadClipForCaptionBurn(normalizedClipId);
  const job = await createProcessingJob(clip.sermonId, "BURN_SUBTITLES");
  const renderedPath = clip.renderedFilePath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
  const subtitlePath = clip.subtitleFilePath?.trim() || clip.srtPath?.trim() || getClipSrtPath(clip.sermonId, clip.id);

  const eligibility = validateCaptionBurnEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    captionStatus: clip.captionStatus,
    captionBurnStatus: clip.captionBurnStatus,
    renderedClipExists: await fileExists(renderedPath),
    subtitleExists: await fileExists(subtitlePath),
    allowReburn: Boolean(options?.allowReburn),
  });

  if (!eligibility.ok) {
    throw new Error(eligibility.reason ?? "Clip is not eligible for caption burn.");
  }

  let didClaimBurnStart = false;

  try {
    await claimCaptionBurnStart(clip.id);
    didClaimBurnStart = true;
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Caption burn started for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Caption burn requested for clip ${clip.id}.`);

    const result = await burnCaptionsForClipCore(clip, options, job.id);

    await markJobSucceeded(
      job.id,
      result.reusedExistingFile
        ? `Reused existing captioned video for ${clip.id}.`
        : `Captioned video generated for ${clip.id}.`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown caption burn error.";
    if (didClaimBurnStart) {
      await failCaptionBurn(clip.id, message).catch(() => undefined);
    }
    await markJobFailed(job.id, message, "Caption burn failed.");
    await appendPipelineLog(clip.sermonId, `Caption burn failed for clip ${clip.id}: ${message}`);
    throw new Error(message);
  }
}

export const __captionBurnTestUtils = {
  validateCaptionBurnEligibility,
  buildCaptionBurnMetadata,
  buildCaptionForceStyle,
  buildVideoEncoderArgs,
  resolveCaptionPosition,
  resolveClipCaptionStylePresetId,
  shouldApplyCaptionsToClip,
  shouldUseWordHighlightOverlay,
  extractCaptionCueOverlays,
  remapCaptionCueOverlaysForSpeechCleanup,
  expandCaptionCueWordHighlightOverlays,
  buildSrtFromCaptionCueOverlays,
  buildCaptionOverlaySvg,
  captionOverlayYExpression,
  shouldUseCaptionOverlayFallback,
};
