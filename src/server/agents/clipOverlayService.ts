/**
 * Clip Overlay Service — lower-third text overlays for sermon clips.
 *
 * Overlays are rendered onto the most polished prepared clip source. When
 * captions have already been burned in, the captioned file is used so final
 * exports keep both captions and overlays.
 *
 * Overlay design:
 *  - Semi-transparent dark bar at the lower portion of the frame
 *  - Pastor name (large)
 *  - Sermon title (medium)
 *  - Church name (small)
 *  - Sermon date (small, if available)
 *  - Positioned above where captions would appear (safe zone: y < H-80)
 */

import { access, rename, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { ClipCandidate, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveCaptionStylePreset, type CaptionStylePresetId } from "@/lib/captionStylePresets";
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
  getOverlayClipPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled, getMediaDurationSeconds } from "@/server/media/ffmpeg";
import { getBrandingOverlayDimensions, renderBrandingOverlayPng } from "@/server/agents/brandingOverlay";
import {
  DEFAULT_CLIP_BRANDING,
  DEFAULT_INTRO_DURATION_SECONDS,
  DEFAULT_OUTRO_DURATION_SECONDS,
  normalizeBrandingDurationSeconds,
  resolveBrandingLowerThirdPlacement,
  resolveBrandingConfig,
  type ClipBrandingConfig,
} from "@/lib/clipBranding";
import { getSharp } from "@/server/agents/sharpClient";
import { resolveAvailableBrandingLogoPath } from "@/server/branding/logoStorage";
import {
  extractSpeechCleanupCutPlan,
  remapTimelineRangeToCleanedTime,
} from "@/lib/speechCleanupPlan";
import {
  extractBrollLayerConfig,
  extractCaptionPosition,
  type BrollCardPosition,
  type BrollCardTone,
} from "@/lib/clipStudio";
import {
  assertClipEditPlanStillActive,
  isStaleClipCompositionError,
  preferStaleClipCompositionError,
  recordClipArtifact,
  tryUpdateClipCandidateForActiveEditPlan,
  updateClipCandidateForActiveEditPlan,
  upsertActiveClipEditPlanForClip,
  type ClipEditPlanGuard,
} from "@/server/agents/clipEditPlanService";
import {
  buildVideoEncoderArgs,
  resolvePreferredVideoEncoder,
} from "@/server/media/videoEncoding";
import {
  capturePromotedMediaIdentity,
  discardPromotedMediaIfUnchanged,
  type PromotedMediaIdentity,
} from "@/server/agents/mediaPromotionGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverlayOptions = {
  ffmpegPath?: string;
  allowRerender?: boolean;
  force?: boolean;
};

type ClipForOverlay = Pick<
  ClipCandidate,
  | "id"
  | "sermonId"
  | "status"
  | "renderStatus"
  | "renderFreshness"
  | "durationSeconds"
  | "renderedFilePath"
  | "captionBurnStatus"
  | "captionBurnFreshness"
  | "captionedVideoPath"
  | "captionData"
  | "overlayStatus"
  | "overlayVideoPath"
>;

type SermonMetadataForOverlay = {
  title: string;
  speakerName: string;
  churchName: string;
  sermonDate: Date | null;
};

type BrandingForOverlay = {
  primaryBrandColor: string;
  churchName?: string;
  churchLogoPath?: string | null;
  watermarkPosition?: "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_LEFT" | "BOTTOM_RIGHT" | "CENTER";
} | null;

type HookOverlaySpec = {
  text: string;
  position: "top" | "center" | "lower";
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  animation: "fade" | "pan-in" | "pop" | "none";
  size: "small" | "medium" | "large";
  bold: boolean;
  captionStylePresetId?: CaptionStylePresetId;
  width: number;
  height: number;
};

type BrollCardOverlaySpec = {
  id: string;
  text: string;
  label: string;
  tone: BrollCardTone;
  position: BrollCardPosition;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  width: number;
  height: number;
};

export type OverlayEligibilityInput = {
  status: ClipCandidate["status"];
  renderStatus: ClipCandidate["renderStatus"];
  overlayStatus: ClipCandidate["overlayStatus"];
  renderedClipExists: boolean;
  hasSermonTitle: boolean;
  hasPastorName: boolean;
  allowRerender: boolean;
};

export type OverlayEligibility = {
  ok: boolean;
  reason?: string;
};

export type OverlayResult = {
  clipId: string;
  overlayVideoPath: string;
  renderedAt: Date;
  reusedExistingFile: boolean;
};

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates whether a clip is eligible for overlay rendering.
 * Pure function — no I/O. Exported for tests.
 */
export function validateOverlayEligibility(input: OverlayEligibilityInput): OverlayEligibility {
  if (input.status !== "SUGGESTED" && input.status !== "APPROVED" && !(input.allowRerender && input.status === "EXPORTED")) {
    return { ok: false, reason: "Clip must be suggested or approved before overlay rendering." };
  }

  if (input.overlayStatus === "RENDERING") {
    return { ok: false, reason: "Overlay render is already in progress for this clip." };
  }

  if (input.overlayStatus === "COMPLETED" && !input.allowRerender) {
    return {
      ok: false,
      reason: "Overlay already rendered. Use regenerate to run again.",
    };
  }

  if (input.renderStatus !== "COMPLETED") {
    return { ok: false, reason: "Rendered clip must be completed before overlay can be applied." };
  }

  if (!input.renderedClipExists) {
    return { ok: false, reason: "Rendered clip file does not exist." };
  }

  if (!input.hasSermonTitle && !input.hasPastorName) {
    return { ok: false, reason: "Sermon title or pastor name is required to generate an overlay." };
  }

  return { ok: true };
}

// ─── Text escaping ────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe use in an FFmpeg drawtext filter expression.
 * Colons, backslashes, single-quotes, and square brackets must be escaped.
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .trim();
}

// ─── Filter building ──────────────────────────────────────────────────────────

/**
 * Returns the hex color string (#RRGGBB) for the text based on brand settings.
 * Falls back to white.
 */
function resolveTextColor(branding: BrandingForOverlay): string {
  if (!branding) return "#FFFFFF";
  const raw = branding.primaryBrandColor.trim();
  // Accept both "#RRGGBB" and "RRGGBB".
  return raw.startsWith("#") ? raw : `#${raw}`;
}

/**
 * Formats a Date as "Month YYYY" for overlay display.
 */
function formatSermonDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Builds the FFmpeg -vf filter string that draws the lower-third overlay.
 *
 * Layout (from bottom of frame, 1080x1920):
 *   H-280 …  H-80  — semi-transparent dark background bar
 *   H-260         — pastor name (32px)
 *   H-215         — sermon title (22px, may wrap via abbreviated text)
 *   H-178         — church name (18px)
 *   H-148         — sermon date (16px)
 *
 * Captions sit at approximately H-68…H-48, so the overlay safely clears them.
 */
export function buildOverlayFilter(
  sermon: SermonMetadataForOverlay,
  branding: BrandingForOverlay,
): string {
  const textColor = resolveTextColor(branding);
  // FFmpeg drawtext accepts colors as 0xRRGGBB or color names. Convert hex.
  const ffmpegTextColor = textColor.replace("#", "0x");

  const lines: string[] = [];

  // Background bar
  lines.push("drawbox=x=0:y=ih-290:w=iw:h=215:color=black@0.60:t=fill");

  // Pastor name
  if (sermon.speakerName.trim()) {
    const name = escapeDrawtext(sermon.speakerName);
    lines.push(
      `drawtext=text='${name}':fontcolor=${ffmpegTextColor}:fontsize=32:x=48:y=h-272:fontname=Arial:shadowcolor=black@0.8:shadowx=1:shadowy=1`,
    );
  }

  // Sermon title
  if (sermon.title.trim()) {
    const title = escapeDrawtext(sermon.title);
    lines.push(
      `drawtext=text='${title}':fontcolor=${ffmpegTextColor}@0.85:fontsize=22:x=48:y=h-228:fontname=Arial:shadowcolor=black@0.7:shadowx=1:shadowy=1`,
    );
  }

  // Church name
  if (sermon.churchName.trim()) {
    const church = escapeDrawtext(sermon.churchName);
    lines.push(
      `drawtext=text='${church}':fontcolor=white@0.70:fontsize=18:x=48:y=h-192:fontname=Arial`,
    );
  }

  // Sermon date (optional)
  if (sermon.sermonDate) {
    const dateStr = escapeDrawtext(formatSermonDate(sermon.sermonDate));
    lines.push(
      `drawtext=text='${dateStr}':fontcolor=white@0.60:fontsize=16:x=48:y=h-162:fontname=Arial`,
    );
  }

  return lines.join(",");
}

function buildHookOverlayFilter(captionData: unknown): string | null {
  const spec = extractHookOverlaySpec(captionData);
  if (!spec) {
    return null;
  }

  const fontSize = spec.size === "large" ? 64 : spec.size === "small" ? 38 : 50;
  const baseY = spec.position === "center" ? "(h-text_h)/2" : spec.position === "lower" ? "h-430" : "120";
  const text = escapeDrawtext(spec.text);
  const fontWeightShadow = spec.bold === false ? "shadowx=1:shadowy=1" : "shadowx=2:shadowy=2";
  const introWindow = Math.min(0.45, Math.max(0.18, spec.durationSeconds / 4));
  const outroWindow = Math.min(0.35, Math.max(0.15, spec.durationSeconds / 5));
  const introEnd = spec.startSeconds + introWindow;
  const outroStart = Math.max(spec.startSeconds, spec.endSeconds - outroWindow);
  const xExpression = spec.animation === "pan-in"
    ? `'((w-text_w)/2)-if(lt(t,${introEnd.toFixed(2)}),(1-((t-${spec.startSeconds.toFixed(2)})/${introWindow.toFixed(2)}))*120,0)'`
    : "(w-text_w)/2";
  const yExpression = spec.animation === "pop"
    ? `'(${baseY})+if(lt(t,${introEnd.toFixed(2)}),(1-((t-${spec.startSeconds.toFixed(2)})/${introWindow.toFixed(2)}))*18,0)'`
    : baseY;
  const alphaExpression = spec.animation === "fade"
    ? [
        "alpha=",
        `'if(lt(t,${introEnd.toFixed(2)}),`,
        `(t-${spec.startSeconds.toFixed(2)})/${introWindow.toFixed(2)},`,
        `if(gt(t,${outroStart.toFixed(2)}),`,
        `(${spec.endSeconds.toFixed(2)}-t)/${outroWindow.toFixed(2)},`,
        "1))'",
      ].join("")
    : null;

  const filterParts = [
    `drawtext=text='${text}'`,
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "fontname=Arial",
    `x=${xExpression}`,
    `y=${yExpression}`,
    "box=1",
    "boxcolor=black@0.62",
    "boxborderw=28",
    "shadowcolor=black@0.75",
    fontWeightShadow,
    `enable='between(t,${spec.startSeconds.toFixed(2)},${spec.endSeconds.toFixed(2)})'`,
  ];

  if (alphaExpression) {
    filterParts.splice(2, 0, alphaExpression);
  }

  return filterParts.join(":");
}

function extractHookOverlaySpec(captionData: unknown): HookOverlaySpec | null {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return null;
  }

  const hookOverlay = (captionData as Record<string, unknown>)["hookOverlay"];
  if (!hookOverlay || typeof hookOverlay !== "object" || Array.isArray(hookOverlay)) {
    return null;
  }

  const record = hookOverlay as Record<string, unknown>;
  if (record["enabled"] !== true || typeof record["text"] !== "string" || !record["text"].trim()) {
    return null;
  }

  const rawPosition = record["position"];
  const rawSize = record["size"];
  const rawAnimation = record["animation"];
  const position = rawPosition === "top" || rawPosition === "lower" || rawPosition === "center"
    ? rawPosition
    : "center";
  const size = rawSize === "large" || rawSize === "small" || rawSize === "medium"
    ? rawSize
    : "medium";
  const animation = rawAnimation === "fade" || rawAnimation === "pan-in" || rawAnimation === "pop"
    ? rawAnimation
    : "none";
  const startSeconds = typeof record["startSeconds"] === "number" && Number.isFinite(record["startSeconds"])
    ? Math.max(0, record["startSeconds"])
    : 0;
  const durationSeconds = typeof record["durationSeconds"] === "number" && Number.isFinite(record["durationSeconds"])
    ? Math.min(20, Math.max(1, record["durationSeconds"]))
    : 6;
  const endSeconds = startSeconds + durationSeconds;
  const cleanupPlan = extractSpeechCleanupCutPlan(captionData);
  const remappedRange = remapTimelineRangeToCleanedTime({ startSeconds, endSeconds, plan: cleanupPlan });
  if (!remappedRange) {
    return null;
  }
  const remappedDurationSeconds = remappedRange.endSeconds - remappedRange.startSeconds;
  const captionStylePresetId = resolveCaptionStylePreset(
    typeof (captionData as Record<string, unknown>)["captionStylePresetId"] === "string"
      ? (captionData as Record<string, unknown>)["captionStylePresetId"] as string
      : undefined,
  ).id;

  return {
    text: record["text"].trim(),
    position,
    startSeconds: remappedRange.startSeconds,
    durationSeconds: remappedDurationSeconds,
    endSeconds: remappedRange.endSeconds,
    animation,
    size,
    bold: record["bold"] !== false,
    captionStylePresetId,
    width: 960,
    height: size === "large" ? 260 : size === "small" ? 180 : 220,
  };
}

function shouldBrandingLowerThirdYieldToCaptions(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return false;
  }

  const record = captionData as Record<string, unknown>;
  const applyCaptionsToClip = record["applyCaptionsToClip"] !== false;
  const cues = Array.isArray(record["cues"]) ? record["cues"] : [];
  return applyCaptionsToClip && cues.length > 0;
}

function shouldApplyCaptionsToOverlaySource(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return true;
  }

  const value = (captionData as Record<string, unknown>)["applyCaptionsToClip"];
  return typeof value === "boolean" ? value : true;
}

function resolveOverlaySourceSelection(
  clip: Pick<
    ClipForOverlay,
    | "renderStatus"
    | "renderFreshness"
    | "renderedFilePath"
    | "captionBurnStatus"
    | "captionBurnFreshness"
    | "captionedVideoPath"
    | "captionData"
  >,
): { sourcePath: string; sourceWasCaptioned: boolean } {
  if (shouldApplyCaptionsToOverlaySource(clip.captionData)) {
    const captionedPath = clip.captionedVideoPath?.trim();
    if (
      clip.captionBurnStatus !== "COMPLETED"
      || clip.captionBurnFreshness !== "UP_TO_DATE"
      || !captionedPath
    ) {
      throw new Error("Captions are enabled, but the captioned video is stale or incomplete. Rebuild burned captions before adding overlays.");
    }

    return {
      sourcePath: captionedPath,
      sourceWasCaptioned: true,
    };
  }

  const renderedPath = clip.renderedFilePath?.trim();
  if (
    clip.renderStatus !== "COMPLETED"
    || clip.renderFreshness !== "UP_TO_DATE"
    || !renderedPath
  ) {
    throw new Error("The prepared render is stale or incomplete. Rebuild the clip before adding overlays.");
  }

  return {
    sourcePath: renderedPath,
    sourceWasCaptioned: false,
  };
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

function wrapOverlayText(value: string, maxLineLength: number, maxLines = 3): string[] {
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

  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  const lastIndex = visibleLines.length - 1;
  const lastLine = visibleLines[lastIndex] ?? "";
  visibleLines[lastIndex] = `${lastLine.slice(0, Math.max(1, maxLineLength - 1)).trimEnd()}…`;
  return visibleLines;
}

function buildHookOverlaySvg(spec: HookOverlaySpec): string {
  const visual = resolveCaptionStylePreset(spec.captionStylePresetId).visual;
  const fontSize = spec.size === "large" ? 56 : spec.size === "small" ? 34 : 44;
  const lineHeight = Math.round(fontSize * 1.18);
  const displayText = visual.uppercase ? spec.text.toUpperCase() : spec.text;
  const lines = wrapOverlayText(displayText, spec.size === "large" ? 26 : spec.size === "small" ? 38 : 32);
  const totalTextHeight = Math.max(lineHeight, lines.length * lineHeight);
  const firstY = Math.round((spec.height - totalTextHeight) / 2) + 4;
  const fontWeight = spec.bold ? visual.fontWeight : 700;
  const fontFamily = visual.fontFamily === "serif"
    ? "Georgia, Times New Roman, serif"
    : "Arial, Helvetica, sans-serif";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
      <rect x="0" y="0" width="${spec.width}" height="${spec.height}" rx="${visual.borderRadius}" fill="${visual.backgroundColor}" fill-opacity="${visual.backgroundOpacity}" />
      ${visual.borderWidth > 0 && visual.borderOpacity > 0
        ? `<rect x="${visual.borderWidth / 2}" y="${visual.borderWidth / 2}" width="${spec.width - visual.borderWidth}" height="${spec.height - visual.borderWidth}" rx="${Math.max(0, visual.borderRadius - visual.borderWidth / 2)}" fill="none" stroke="${visual.borderColor}" stroke-opacity="${visual.borderOpacity}" stroke-width="${visual.borderWidth}" />`
        : ""}
      ${lines.map((line, index) => (
        `<text x="${spec.width / 2}" y="${firstY + index * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${visual.textColor}" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="${visual.textStrokeColor}" stroke-width="${visual.textStrokeWidth}" stroke-linejoin="round">${escapeSvgText(line)}</text>`
      )).join("\n      ")}
    </svg>
  `;
}

async function renderHookOverlayPng(outputPath: string, spec: HookOverlaySpec): Promise<void> {
  const sharp = await getSharp();
  await sharp(Buffer.from(buildHookOverlaySvg(spec))).png().toFile(/* turbopackIgnore: true */ outputPath);
}

function buildHookOverlayPosition(spec: HookOverlaySpec, avoidsTopBrandRail = false): string {
  const baseX = "(W-w)/2";
  const baseY = spec.position === "top"
    ? avoidsTopBrandRail ? "328" : "112"
    : spec.position === "lower"
      ? "H-h-360"
      : "(H-h)/2";
  const introWindow = Math.min(0.35, Math.max(0.12, spec.durationSeconds / 6));
  const introEnd = spec.startSeconds + introWindow;
  const x = spec.animation === "pan-in"
    ? `'${baseX}-if(lt(t,${introEnd.toFixed(3)}),(1-((t-${spec.startSeconds.toFixed(3)})/${introWindow.toFixed(3)}))*120,0)'`
    : baseX;
  const y = spec.animation === "pop"
    ? `'${baseY}+if(lt(t,${introEnd.toFixed(3)}),(1-((t-${spec.startSeconds.toFixed(3)})/${introWindow.toFixed(3)}))*18,0)'`
    : baseY;

  return `x=${x}:y=${y}`;
}

function extractBrollOverlaySpecs(captionData: unknown): BrollCardOverlaySpec[] {
  const layer = extractBrollLayerConfig(captionData);
  if (!layer.enabled || layer.cards.length === 0) {
    return [];
  }

  const cleanupPlan = extractSpeechCleanupCutPlan(captionData);
  return layer.cards.flatMap((card): BrollCardOverlaySpec[] => {
    if (!card.enabled || !card.text.trim()) {
      return [];
    }

    const startSeconds = Math.max(0, card.startSeconds);
    const durationSeconds = Math.min(12, Math.max(1, card.durationSeconds));
    const endSeconds = startSeconds + durationSeconds;
    const remappedRange = remapTimelineRangeToCleanedTime({ startSeconds, endSeconds, plan: cleanupPlan });
    if (!remappedRange) {
      return [];
    }

    const isFull = card.position === "full";
    return [{
      id: card.id,
      text: card.text.trim(),
      label: card.label.trim() || "Key moment",
      tone: card.tone,
      position: card.position,
      startSeconds: remappedRange.startSeconds,
      durationSeconds: remappedRange.endSeconds - remappedRange.startSeconds,
      endSeconds: remappedRange.endSeconds,
      width: isFull ? 900 : 840,
      height: isFull ? 520 : 260,
    }];
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

function brollToneColors(tone: BrollCardTone): { background: string; border: string; accent: string } {
  switch (tone) {
    case "scripture":
      return { background: "#101820", border: "#75D9B8", accent: "#75D9B8" };
    case "application":
      return { background: "#162015", border: "#FACC15", accent: "#FACC15" };
    case "context":
      return { background: "#151827", border: "#93C5FD", accent: "#93C5FD" };
    case "quote":
    default:
      return { background: "#17151F", border: "#F0ABFC", accent: "#F0ABFC" };
  }
}

function buildBrollCardSvg(spec: BrollCardOverlaySpec): string {
  const colors = brollToneColors(spec.tone);
  const isFull = spec.position === "full";
  const fontSize = isFull ? 48 : 36;
  const labelFontSize = isFull ? 21 : 17;
  const lineHeight = Math.round(fontSize * 1.16);
  const lines = wrapOverlayText(spec.text, isFull ? 26 : 34);
  const textBlockHeight = lines.length * lineHeight;
  const firstLineY = Math.round((spec.height - textBlockHeight) / 2) + (isFull ? 26 : 18);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
      <rect x="0" y="0" width="${spec.width}" height="${spec.height}" rx="36" fill="${colors.background}" fill-opacity="0.74" />
      <rect x="18" y="18" width="${spec.width - 36}" height="${spec.height - 36}" rx="28" fill="none" stroke="${colors.border}" stroke-opacity="0.68" stroke-width="3" />
      <rect x="0" y="0" width="${spec.width}" height="${spec.height}" rx="36" fill="url(#cardSheen)" fill-opacity="0.24" />
      <rect x="${Math.round(spec.width * 0.34)}" y="${isFull ? 96 : 72}" width="${Math.round(spec.width * 0.32)}" height="5" rx="3" fill="${colors.accent}" fill-opacity="0.88" />
      <defs>
        <linearGradient id="cardSheen" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.34" />
          <stop offset="44%" stop-color="#FFFFFF" stop-opacity="0" />
        </linearGradient>
      </defs>
      <text x="${spec.width / 2}" y="${isFull ? 54 : 38}" font-family="Arial, Helvetica, sans-serif" font-size="${labelFontSize}" font-weight="800" fill="${colors.accent}" text-anchor="middle" letter-spacing="0">${escapeSvgText(spec.label.toUpperCase())}</text>
      ${lines.map((line, index) => (
        `<text x="${spec.width / 2}" y="${firstLineY + index * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900" fill="#FFFFFF" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-opacity="0.55" stroke-width="8" stroke-linejoin="round">${escapeSvgText(line)}</text>`
      )).join("\n      ")}
    </svg>
  `;
}

async function renderBrollOverlayPng(outputPath: string, spec: BrollCardOverlaySpec): Promise<void> {
  const sharp = await getSharp();
  await sharp(Buffer.from(buildBrollCardSvg(spec))).png().toFile(/* turbopackIgnore: true */ outputPath);
}

function buildBrollOverlayPosition(spec: BrollCardOverlaySpec): string {
  if (spec.position === "upper") {
    return "x=(W-w)/2:y=340";
  }

  if (spec.position === "lower") {
    return "x=(W-w)/2:y=H-h-610";
  }

  return "x=(W-w)/2:y=(H-h)/2";
}

function buildOverlayFilterComplex(input: {
  hasBrandingOverlay: boolean;
  timedBrandingLayers?: Array<{
    inputIndex: number;
    startSeconds: number;
    endSeconds: number;
  }>;
  brollOverlaySpecs: BrollCardOverlaySpec[];
  brollOverlayInputStartIndex: number | null;
  hookOverlaySpec: HookOverlaySpec | null;
  hookOverlayInputIndex: number | null;
  hookAvoidsTopBrandRail?: boolean;
}): string {
  const parts: string[] = [];
  let current = "[0:v]";

  if (input.hasBrandingOverlay) {
    parts.push(`${current}[1:v]overlay=0:0:shortest=1:format=auto[branded]`);
    current = "[branded]";
  }

  for (const [index, layer] of (input.timedBrandingLayers ?? []).entries()) {
    const outputLabel = `[timedBranding${index}]`;
    parts.push(
      `${current}[${layer.inputIndex}:v]overlay=0:0:enable='between(t,${layer.startSeconds.toFixed(3)},${layer.endSeconds.toFixed(3)})':eof_action=pass${outputLabel}`,
    );
    current = outputLabel;
  }

  input.brollOverlaySpecs.forEach((spec, index) => {
    if (input.brollOverlayInputStartIndex === null) {
      return;
    }

    const inputIndex = input.brollOverlayInputStartIndex + index;
    const fadeDuration = Math.min(0.35, Math.max(0.12, spec.durationSeconds / 6));
    const fadeOutStart = Math.max(spec.startSeconds, spec.endSeconds - fadeDuration);
    const brollLabel = `[brollOverlay${index}]`;
    const outputLabel = `[brollLayer${index}]`;
    parts.push(
      `[${inputIndex}:v]format=rgba,fade=t=in:st=${spec.startSeconds.toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1${brollLabel}`,
    );
    parts.push(
      `${current}${brollLabel}overlay=${buildBrollOverlayPosition(spec)}:enable='between(t,${spec.startSeconds.toFixed(3)},${spec.endSeconds.toFixed(3)})':eof_action=pass${outputLabel}`,
    );
    current = outputLabel;
  });

  if (input.hookOverlaySpec && input.hookOverlayInputIndex !== null) {
    const spec = input.hookOverlaySpec;
    const fadeDuration = Math.min(0.35, Math.max(0.12, spec.durationSeconds / 6));
    const fadeOutStart = Math.max(spec.startSeconds, spec.endSeconds - fadeDuration);
    const hookLabel = "[hookOverlay]";
    const hookFilters = spec.animation === "fade"
      ? `format=rgba,fade=t=in:st=${spec.startSeconds.toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1`
      : "format=rgba";
    parts.push(`[${input.hookOverlayInputIndex}:v]${hookFilters}${hookLabel}`);
    parts.push(
      `${current}${hookLabel}overlay=${buildHookOverlayPosition(spec, input.hookAvoidsTopBrandRail)}:enable='between(t,${spec.startSeconds.toFixed(3)},${spec.endSeconds.toFixed(3)})':eof_action=pass[hooked]`,
    );
    current = "[hooked]";
  }

  parts.push(`${current}format=yuv420p[v]`);
  return parts.join(";");
}

// ─── Test utilities ───────────────────────────────────────────────────────────

export const __clipOverlayTestUtils = {
  escapeDrawtext,
  buildOverlayFilter,
  buildHookOverlayFilter,
  extractHookOverlaySpec,
  buildHookOverlayPosition,
  extractBrollOverlaySpecs,
  shouldBrandingLowerThirdYieldToCaptions,
  resolveOverlaySourceSelection,
  buildHookOverlaySvg,
  buildBrollCardSvg,
  buildOverlayFilterComplex,
  validateOverlayEligibility,
  fileHasBytes,
  formatSermonDate: (date: Date): string => formatSermonDate(date),
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function getTempOverlayPath(outputPath: string, editPlanId: string): string {
  const planSuffix = editPlanId.replace(/[^a-zA-Z0-9_-]/g, "");
  return outputPath.replace(/\.mp4$/i, `.plan-${planSuffix}.overlay.partial.mp4`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

async function loadClipForOverlay(clipId: string): Promise<ClipForOverlay> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      renderStatus: true,
      renderFreshness: true,
      durationSeconds: true,
      renderedFilePath: true,
      captionBurnStatus: true,
      captionBurnFreshness: true,
      captionedVideoPath: true,
      captionData: true,
      overlayStatus: true,
      overlayVideoPath: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

async function loadSermonForOverlay(sermonId: string): Promise<SermonMetadataForOverlay> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      title: true,
      speakerName: true,
      churchName: true,
      sermonDate: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  return sermon;
}

async function loadBrandingForOverlay(): Promise<BrandingForOverlay> {
  const branding = await prisma.brandingSettings.findUnique({
    where: { id: "local" },
    select: {
      primaryBrandColor: true,
      churchName: true,
      churchLogoPath: true,
      watermarkPosition: true,
    },
  });

  return branding;
}

function hasSavedClipBrandingConfig(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return false;
  }

  const brandingSettings = (captionData as Record<string, unknown>)["brandingSettings"];
  return Boolean(brandingSettings && typeof brandingSettings === "object" && !Array.isArray(brandingSettings));
}

function resolveOverlayBrandingConfig(
  captionData: unknown,
  primaryBrandColor: string | null,
): ClipBrandingConfig {
  if (hasSavedClipBrandingConfig(captionData)) {
    const saved = resolveBrandingConfig(captionData);
    return {
      ...saved,
      themeColor: saved.themeColor ?? primaryBrandColor,
    };
  }

  // Preserve the established prepared-clip look for clips created before
  // per-clip branding settings were stored.
  return {
    ...DEFAULT_CLIP_BRANDING,
    enabled: true,
    watermarkEnabled: true,
    lowerThirdEnabled: true,
    themeColor: primaryBrandColor,
  };
}

function buildOverlayMetadata(outputPath: string): Pick<
  Prisma.ClipCandidateUpdateInput,
  "overlayStatus" | "overlayVideoPath" | "overlayRenderedAt" | "overlayRenderError"
> {
  return {
    overlayStatus: "COMPLETED",
    overlayVideoPath: outputPath,
    overlayRenderedAt: new Date(),
    overlayRenderError: null,
  };
}

async function failOverlayRender(guard: ClipEditPlanGuard, message: string): Promise<void> {
  await tryUpdateClipCandidateForActiveEditPlan({
    guard,
    data: {
      overlayStatus: "FAILED",
      overlayRenderError: message,
      overlayFreshness: "FAILED",
    },
  });
}

async function runFfmpegOverlay(input: {
  sermonId: string;
  renderedPath: string;
  outputPath: string;
  filterComplex: string;
  brandingOverlayPath?: string;
  timedBrandingOverlayPaths?: string[];
  brollOverlayPaths?: string[];
  hookOverlayPath?: string;
  ffmpegPath?: string;
  jobId: string;
}): Promise<void> {
  const command = commandFor(input.ffmpegPath);
  const videoEncoder = resolvePreferredVideoEncoder("overlay");
  const args = [
    "-y",
    "-i",
    input.renderedPath,
  ];

  if (input.brandingOverlayPath) {
    args.push("-loop", "1", "-i", input.brandingOverlayPath);
  }

  for (const timedBrandingOverlayPath of input.timedBrandingOverlayPaths ?? []) {
    args.push("-loop", "1", "-i", timedBrandingOverlayPath);
  }

  for (const brollOverlayPath of input.brollOverlayPaths ?? []) {
    args.push("-loop", "1", "-i", brollOverlayPath);
  }

  if (input.hookOverlayPath) {
    args.push("-loop", "1", "-i", input.hookOverlayPath);
  }

  args.push(
    "-filter_complex",
    input.filterComplex,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    ...buildVideoEncoderArgs(videoEncoder, "overlay"),
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    input.outputPath,
  );

  await appendPipelineLog(input.sermonId, `Overlay render started with encoder: ${videoEncoder}.`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text.length > 0) {
        void appendJobLog(input.jobId, `[ffmpeg stdout] ${text}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        void appendJobLog(input.jobId, `[ffmpeg stderr] ${trimmed}`);
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

      reject(
        new Error(
          `FFmpeg overlay render failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1400)}`.trim(),
        ),
      );
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a lower-third text overlay onto the plain rendered clip.
 * The output is saved separately — the rendered clip is not modified.
 */
export async function renderClipOverlay(
  clipCandidateId: string,
  options?: OverlayOptions,
): Promise<OverlayResult> {
  const clipId = clipCandidateId.trim();
  if (!clipId) {
    throw new Error("Clip id is required for overlay rendering.");
  }

  const { plan: startedEditPlan } = await upsertActiveClipEditPlanForClip({
    clipCandidateId: clipId,
    createdBy: "overlay",
    createdReason: "overlay_input_snapshot",
  });
  const editPlanGuard = {
    clipCandidateId: clipId,
    editPlanId: startedEditPlan.id,
    planHash: startedEditPlan.planHash,
  };

  const clip = await loadClipForOverlay(clipId);
  await assertClipEditPlanStillActive(editPlanGuard);
  await ensureSermonFolders(clip.sermonId);

  const overlaySource = resolveOverlaySourceSelection(clip);
  const renderedPath = overlaySource.sourcePath;
  const captionedPath = overlaySource.sourceWasCaptioned ? renderedPath : null;
  const renderedClipExists = await fileExists(renderedPath);

  const sermon = await loadSermonForOverlay(clip.sermonId);
  const branding = await loadBrandingForOverlay();

  const eligibility = validateOverlayEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    overlayStatus: clip.overlayStatus,
    renderedClipExists,
    hasSermonTitle: sermon.title.trim().length > 0,
    hasPastorName: sermon.speakerName.trim().length > 0,
    allowRerender: Boolean(options?.allowRerender),
  });

  if (!eligibility.ok) {
    await failOverlayRender(editPlanGuard, eligibility.reason ?? "Clip is not eligible for overlay rendering.");
    throw new Error(eligibility.reason ?? "Clip is not eligible for overlay rendering.");
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    const message = "FFmpeg is not installed or not executable.";
    await failOverlayRender(editPlanGuard, message);
    throw new Error(message);
  }

  const outputPath = getOverlayClipPath(clip.sermonId, clip.id);
  const tempOutputPath = getTempOverlayPath(outputPath, editPlanGuard.editPlanId);

  // Claim the render slot — prevents duplicate concurrent renders.
  const claimResult = await prisma.clipCandidate.updateMany({
    where: {
      id: clip.id,
      editPlans: {
        some: {
          id: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
          status: "ACTIVE",
        },
      },
      NOT: { overlayStatus: "RENDERING" },
    },
    data: {
      overlayStatus: "RENDERING",
      overlayRenderError: null,
    },
  });

  if (claimResult.count === 0) {
    await assertClipEditPlanStillActive(editPlanGuard);
    throw new Error("Overlay render is already in progress for this clip.");
  }

  const job = await createProcessingJob(clip.sermonId, "RENDER_OVERLAY");
  let promotedOutputIdentity: PromotedMediaIdentity | null = null;

  try {
    await assertClipEditPlanStillActive(editPlanGuard);
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Overlay render requested for clip ${clip.id}.`);

    const overlayDimensions = getBrandingOverlayDimensions("VERTICAL_9_16");
    const brandingOverlayPath = tempOutputPath.replace(/\.mp4$/i, ".branding.png");
    const introOverlayPath = tempOutputPath.replace(/\.mp4$/i, ".branding-intro.png");
    const outroOverlayPath = tempOutputPath.replace(/\.mp4$/i, ".branding-outro.png");
    const hookOverlaySpec = extractHookOverlaySpec(clip.captionData);
    const brollOverlaySpecs = extractBrollOverlaySpecs(clip.captionData);
    const captionsRequireSafeBrandingPlacement = shouldBrandingLowerThirdYieldToCaptions(clip.captionData);
    const brollOverlayPaths = brollOverlaySpecs.map((_, index) =>
      tempOutputPath.replace(/\.mp4$/i, `.broll-${index + 1}.png`),
    );
    const hookOverlayPath = hookOverlaySpec
      ? tempOutputPath.replace(/\.mp4$/i, ".hook.png")
      : null;
    const brandingConfig = resolveOverlayBrandingConfig(
      clip.captionData,
      branding?.primaryBrandColor ?? null,
    );
    const configuredLogoPath = await resolveAvailableBrandingLogoPath(branding?.churchLogoPath);
    const logoAvailable = Boolean(configuredLogoPath);
    const brandingContext = {
      format: "VERTICAL_9_16" as const,
      sermonTitle: sermon.title,
      preacherName: sermon.speakerName,
      churchName: sermon.churchName.trim() || branding?.churchName?.trim() || "",
      themeColor: brandingConfig.themeColor ?? branding?.primaryBrandColor ?? null,
      watermarkPosition: branding?.watermarkPosition ?? "TOP_RIGHT" as const,
      width: overlayDimensions.width,
      height: overlayDimensions.height,
      logoPath: logoAvailable ? configuredLogoPath : null,
      lowerThirdPlacement: resolveBrandingLowerThirdPlacement({
        applyCaptionsToClip: captionsRequireSafeBrandingPlacement,
        captionCueCount: captionsRequireSafeBrandingPlacement ? 1 : 0,
        captionPosition: extractCaptionPosition(clip.captionData),
      }),
    };
    const baseBrandingConfig: ClipBrandingConfig = {
      ...brandingConfig,
      introEnabled: false,
      outroEnabled: false,
    };
    const overlayEnabled = await renderBrandingOverlayPng(
      brandingOverlayPath,
      baseBrandingConfig,
      brandingContext,
      "base",
    );
    const mediaDurationSeconds = await getMediaDurationSeconds(renderedPath, options?.ffmpegPath)
      .catch(() => clip.durationSeconds ?? 60);
    const timedBrandingOverlayPaths: string[] = [];
    const timedBrandingLayers: Array<{ inputIndex: number; startSeconds: number; endSeconds: number }> = [];
    let nextOverlayInputIndex = 1 + (overlayEnabled ? 1 : 0);

    if (brandingConfig.enabled && brandingConfig.introEnabled) {
      const introRendered = await renderBrandingOverlayPng(
        introOverlayPath,
        brandingConfig,
        brandingContext,
        "intro",
      );
      if (introRendered) {
        const introDurationSeconds = normalizeBrandingDurationSeconds(
          brandingConfig.introDurationSeconds,
          DEFAULT_INTRO_DURATION_SECONDS,
        );
        timedBrandingOverlayPaths.push(introOverlayPath);
        timedBrandingLayers.push({
          inputIndex: nextOverlayInputIndex,
          startSeconds: 0,
          endSeconds: Math.min(mediaDurationSeconds, introDurationSeconds),
        });
        nextOverlayInputIndex += 1;
      }
    }

    if (brandingConfig.enabled && brandingConfig.outroEnabled) {
      const outroRendered = await renderBrandingOverlayPng(
        outroOverlayPath,
        brandingConfig,
        brandingContext,
        "outro",
      );
      if (outroRendered) {
        const outroDurationSeconds = normalizeBrandingDurationSeconds(
          brandingConfig.outroDurationSeconds,
          DEFAULT_OUTRO_DURATION_SECONDS,
        );
        timedBrandingOverlayPaths.push(outroOverlayPath);
        timedBrandingLayers.push({
          inputIndex: nextOverlayInputIndex,
          startSeconds: Math.max(0, mediaDurationSeconds - outroDurationSeconds),
          endSeconds: mediaDurationSeconds,
        });
        nextOverlayInputIndex += 1;
      }
    }

    if (hookOverlaySpec && hookOverlayPath) {
      await renderHookOverlayPng(hookOverlayPath, hookOverlaySpec);
    }
    await Promise.all(
      brollOverlaySpecs.map((spec, index) => renderBrollOverlayPng(brollOverlayPaths[index], spec)),
    );

    const brollOverlayInputStartIndex = brollOverlaySpecs.length > 0 ? nextOverlayInputIndex : null;
    const hookOverlayInputIndex = hookOverlaySpec
      ? nextOverlayInputIndex + brollOverlaySpecs.length
      : null;

    const fullFilter = buildOverlayFilterComplex({
      hasBrandingOverlay: overlayEnabled,
      timedBrandingLayers,
      brollOverlaySpecs,
      brollOverlayInputStartIndex,
      hookOverlaySpec,
      hookOverlayInputIndex,
      hookAvoidsTopBrandRail: Boolean(
        hookOverlaySpec?.position === "top"
        && brandingConfig.enabled
        && brandingConfig.lowerThirdEnabled
        && brandingConfig.preset !== "MINIMAL_WATERMARK"
        && brandingConfig.preset !== "NO_BRANDING"
        && brandingContext.lowerThirdPlacement === "TOP"
      ),
    });

    try {
      await unlink(/* turbopackIgnore: true */ tempOutputPath);
    } catch {
      // Ignore stale partial file.
    }

    await runFfmpegOverlay({
      sermonId: clip.sermonId,
      renderedPath,
      outputPath: tempOutputPath,
      filterComplex: fullFilter,
      brandingOverlayPath: overlayEnabled ? brandingOverlayPath : undefined,
      timedBrandingOverlayPaths,
      brollOverlayPaths,
      hookOverlayPath: hookOverlayPath ?? undefined,
      ffmpegPath: options?.ffmpegPath,
      jobId: job.id,
    });

    await assertClipEditPlanStillActive(editPlanGuard);
    await rename(/* turbopackIgnore: true */ tempOutputPath, /* turbopackIgnore: true */ outputPath);
    promotedOutputIdentity = await capturePromotedMediaIdentity(outputPath);
    if (!(await fileHasBytes(outputPath))) {
      throw new Error("Overlay render produced an empty output file.");
    }
    if (overlayEnabled) {
      await unlink(/* turbopackIgnore: true */ brandingOverlayPath).catch(() => undefined);
    }
    await Promise.all(
      timedBrandingOverlayPaths.map((overlayPath) =>
        unlink(/* turbopackIgnore: true */ overlayPath).catch(() => undefined),
      ),
    );
    if (hookOverlayPath) {
      await unlink(/* turbopackIgnore: true */ hookOverlayPath).catch(() => undefined);
    }
    await Promise.all(brollOverlayPaths.map((overlayPath) => unlink(/* turbopackIgnore: true */ overlayPath).catch(() => undefined)));

    const renderedAt = new Date();
    const outputStats = await stat(outputPath).catch(() => null);
    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        ...buildOverlayMetadata(outputPath),
        overlayFreshness: "UP_TO_DATE",
        overlayAssetVersion: { increment: 1 },
        exportFreshness: "NEEDS_REGENERATION",
        assetInvalidationReason: "Overlay regenerated. Export assets require regeneration.",
      },
    });
    await recordClipArtifact({
      clipCandidateId: clip.id,
      kind: "OVERLAY",
      filePath: outputPath,
      sizeBytes: outputStats?.size ?? null,
      metadata: {
        reusedExistingFile: false,
        sourceWasCaptioned: Boolean(captionedPath),
        hookOverlayApplied: Boolean(hookOverlaySpec),
        brollOverlayCount: brollOverlaySpecs.length,
        brandingApplied: overlayEnabled || timedBrandingLayers.length > 0,
        logoApplied: Boolean(
          brandingConfig.enabled
          && logoAvailable
          && (brandingConfig.watermarkEnabled || brandingConfig.preset === "MINIMAL_WATERMARK")
        ),
        introDurationSeconds: timedBrandingLayers[0]?.startSeconds === 0
          ? timedBrandingLayers[0].endSeconds
          : null,
        outroDurationSeconds: brandingConfig.outroEnabled
          ? normalizeBrandingDurationSeconds(
              brandingConfig.outroDurationSeconds,
              DEFAULT_OUTRO_DURATION_SECONDS,
            )
          : null,
      },
      editPlan: {
        editPlanId: editPlanGuard.editPlanId,
        planHash: editPlanGuard.planHash,
      },
    });
    await appendPipelineLog(clip.sermonId, `Overlay render completed for clip ${clip.id}.`);
    await markJobSucceeded(job.id, `Overlay rendered for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      overlayVideoPath: outputPath,
      renderedAt,
      reusedExistingFile: false,
    };
  } catch (error) {
    const completionError = await preferStaleClipCompositionError(editPlanGuard, error);
    const message = completionError instanceof Error ? completionError.message : "Unknown overlay render error.";

    try {
      await unlink(/* turbopackIgnore: true */ tempOutputPath);
    } catch {
      // Ignore cleanup failures.
    }
    await unlink(/* turbopackIgnore: true */ tempOutputPath.replace(/\.mp4$/i, ".branding.png")).catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ tempOutputPath.replace(/\.mp4$/i, ".hook.png")).catch(() => undefined);
    await Promise.all(
      [1, 2, 3, 4].map((index) => unlink(/* turbopackIgnore: true */ tempOutputPath.replace(/\.mp4$/i, `.broll-${index}.png`)).catch(() => undefined)),
    );

    if (isStaleClipCompositionError(completionError)) {
      if (promotedOutputIdentity) {
        await discardPromotedMediaIfUnchanged(outputPath, promotedOutputIdentity);
      }
      await markJobFailed(job.id, message, "Stale overlay discarded after newer Clip Studio changes.").catch(() => undefined);
      await appendPipelineLog(clip.sermonId, `Discarded stale overlay for clip ${clip.id}: ${message}`).catch(() => undefined);
      throw completionError;
    }

    const failureRecorded = await tryUpdateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        overlayStatus: "FAILED",
        overlayRenderError: message,
        overlayFreshness: "FAILED",
      },
    });
    if (failureRecorded) {
      await recordClipArtifact({
        clipCandidateId: clip.id,
        kind: "OVERLAY",
        status: "FAILED",
        filePath: outputPath,
        errorMessage: message,
        editPlan: {
          editPlanId: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
        },
      }).catch(() => undefined);
    }
    await markJobFailed(job.id, message, "Overlay render failed.");
    await appendPipelineLog(clip.sermonId, `Overlay render failed for clip ${clip.id}: ${message}`);

    throw new Error(message);
  }
}
