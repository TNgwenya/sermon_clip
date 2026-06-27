import { access, rename, stat, unlink } from "node:fs/promises";
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
import { getBrandingSettings } from "@/server/branding/settings";
import { getSharp } from "@/server/agents/sharpClient";

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
};

type CaptionSafeArea = "STANDARD" | "RAISED" | "LOWER_MINIMAL";

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
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

function buildCaptionForceStyle(presetId: string | null | undefined, safeArea: CaptionSafeArea = "STANDARD"): string {
  const preset = resolveCaptionStylePreset(presetId);
  const base = "FontName=Arial,BorderStyle=1,Shadow=0";

  if (preset.id === "clean-lower") {
    return withCaptionSafeArea(`${base},FontSize=18,PrimaryColour=&H00111111,OutlineColour=&H00FFFFFF,BackColour=&HCCFFFFFF,Outline=1,Alignment=2,MarginV=56`, safeArea);
  }

  if (preset.id === "high-contrast") {
    return withCaptionSafeArea(`${base},FontSize=22,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,Outline=4,Alignment=2,MarginV=64`, safeArea);
  }

  if (preset.id === "youth-social") {
    return withCaptionSafeArea(`${base},FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00D84D1D,Outline=4,Shadow=2,Alignment=2,MarginV=72`, safeArea);
  }

  if (preset.id === "minimal-church") {
    return withCaptionSafeArea(`${base},FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,Outline=1,Alignment=2,MarginV=42`, safeArea);
  }

  if (preset.id === "scripture-focus") {
    return withCaptionSafeArea(`${base.replace("FontName=Arial", "FontName=Georgia")},FontSize=20,PrimaryColour=&H00111111,OutlineColour=&H00FACC15,BackColour=&HEEFFFFFF,Outline=1,Alignment=2,MarginV=60`, safeArea);
  }

  if (preset.id === "cinematic-testimony") {
    return withCaptionSafeArea(`${base},FontSize=19,PrimaryColour=&H00F8FAFC,OutlineColour=&H00111827,BackColour=&HAA111827,Outline=2,Shadow=1,Alignment=2,MarginV=54`, safeArea);
  }

  return withCaptionSafeArea(`${base},FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Alignment=2,MarginV=64`, safeArea);
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

function wrapCaptionText(value: string, maxLineLength = 34): string[] {
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

  return lines.slice(0, 3);
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

function buildCaptionOverlaySvg(cue: CaptionCueOverlay): string {
  const width = 960;
  const height = 220;
  const lines = wrapCaptionText(cue.text);
  const lineHeight = 44;
  const totalTextHeight = Math.max(lineHeight, lines.length * lineHeight);
  const firstY = Math.round((height - totalTextHeight) / 2) + 8;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#000000" fill-opacity="0.68" />
      ${lines.map((line, index) => (
        `<text x="${width / 2}" y="${firstY + index * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" fill="#FFFFFF" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-width="5" stroke-linejoin="round">${escapeSvgText(line)}</text>`
      )).join("\n      ")}
    </svg>
  `;
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
}): Promise<void> {
  const escapedSubtitlePath = escapeForFfmpegSubtitlesPath(input.subtitlePath);
  const forceStyle = buildCaptionForceStyle(input.captionStylePresetId, input.captionSafeArea);
  const command = commandFor(input.ffmpegPath);

  const args = [
    "-y",
    "-i",
    input.renderedPath,
    "-vf",
    `subtitles=filename='${escapedSubtitlePath}':force_style='${forceStyle}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];

  await appendPipelineLog(input.sermonId, "Caption burn started.");

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
}

async function createCaptionOverlayImages(input: {
  cues: CaptionCueOverlay[];
  outputPath: string;
}): Promise<string[]> {
  const imagePaths: string[] = [];
  const sharp = await getSharp();

  for (const cue of input.cues) {
    const imagePath = input.outputPath.replace(/\.mp4$/i, `.cue-${String(cue.index).padStart(2, "0")}.png`);
    await sharp(Buffer.from(buildCaptionOverlaySvg(cue))).png().toFile(imagePath);
    imagePaths.push(imagePath);
  }

  return imagePaths;
}

async function runFfmpegCaptionOverlayFallback(input: {
  sermonId: string;
  renderedPath: string;
  outputPath: string;
  ffmpegPath?: string;
  jobId: string;
  cues: CaptionCueOverlay[];
}): Promise<void> {
  if (input.cues.length === 0) {
    throw new Error("Caption overlay fallback could not find any caption cues.");
  }

  const imagePaths = await createCaptionOverlayImages({
    cues: input.cues,
    outputPath: input.outputPath,
  });

  const command = commandFor(input.ffmpegPath);
  const args = ["-y", "-i", input.renderedPath];
  for (const imagePath of imagePaths) {
    args.push("-loop", "1", "-i", imagePath);
  }

  let previous = "[0:v]";
  const filterParts: string[] = [];
  input.cues.forEach((cue, index) => {
    const output = index === input.cues.length - 1 ? "[v]" : `[captioned${index}]`;
    filterParts.push(
      `${previous}[${index + 1}:v]overlay=(W-w)/2:H-h-132:enable='between(t,${cue.startSeconds.toFixed(3)},${cue.endSeconds.toFixed(3)})':eof_action=pass${output}`,
    );
    previous = output;
  });

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    input.outputPath,
  );

  await appendPipelineLog(input.sermonId, "Caption overlay fallback started.");

  try {
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

  const renderedClipExists = await fileExists(renderedPath);
  const subtitleExists = await fileExists(subtitlePath);

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
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: buildCaptionBurnMetadata({
        outputPath: captionedVideoPath,
        burnedAt,
        captionStylePresetId,
        captionSafeArea: resolveCaptionSafeArea(clip.captionData),
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

  try {
    await runFfmpegCaptionBurn({
      sermonId: clip.sermonId,
      renderedPath,
      subtitlePath,
      outputPath: tempCaptionedVideoPath,
      ffmpegPath: options?.ffmpegPath,
      jobId,
      captionStylePresetId,
      captionSafeArea,
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
      cues: extractCaptionCueOverlays(clip.captionData),
    });
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
  resolveClipCaptionStylePresetId,
  shouldApplyCaptionsToClip,
  extractCaptionCueOverlays,
  shouldUseCaptionOverlayFallback,
};
