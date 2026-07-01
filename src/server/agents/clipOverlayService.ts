/**
 * Clip Overlay Service — lower-third text overlays for sermon clips.
 *
 * Overlays are rendered onto the plain rendered clip (not the captioned version).
 * The overlay is saved as a separate file so the plain rendered clip is preserved.
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
  getClipOutputPath,
  getOverlayClipPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import {
  invalidateAfterOverlayCompleted,
  markOverlayAssetCompleted,
  markOverlayAssetFailed,
} from "@/server/regeneration/dependencies";
import { getBrandingOverlayDimensions, renderBrandingOverlayPng } from "@/server/agents/brandingOverlay";
import { getSharp } from "@/server/agents/sharpClient";

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
  | "renderedFilePath"
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

  return {
    text: record["text"].trim(),
    position,
    startSeconds,
    durationSeconds,
    endSeconds,
    animation,
    size,
    bold: record["bold"] !== false,
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

function wrapOverlayText(value: string, maxLineLength: number): string[] {
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

function buildHookOverlaySvg(spec: HookOverlaySpec): string {
  const fontSize = spec.size === "large" ? 56 : spec.size === "small" ? 34 : 44;
  const lineHeight = Math.round(fontSize * 1.18);
  const lines = wrapOverlayText(spec.text, spec.size === "large" ? 26 : spec.size === "small" ? 38 : 32);
  const totalTextHeight = Math.max(lineHeight, lines.length * lineHeight);
  const firstY = Math.round((spec.height - totalTextHeight) / 2) + 4;
  const fontWeight = spec.bold ? 900 : 700;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
      <rect x="0" y="0" width="${spec.width}" height="${spec.height}" rx="34" fill="#000000" fill-opacity="0.66" />
      <rect x="16" y="16" width="${spec.width - 32}" height="${spec.height - 32}" rx="26" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2" />
      ${lines.map((line, index) => (
        `<text x="${spec.width / 2}" y="${firstY + index * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="#FFFFFF" text-anchor="middle" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-width="7" stroke-linejoin="round">${escapeSvgText(line)}</text>`
      )).join("\n      ")}
    </svg>
  `;
}

async function renderHookOverlayPng(outputPath: string, spec: HookOverlaySpec): Promise<void> {
  const sharp = await getSharp();
  await sharp(Buffer.from(buildHookOverlaySvg(spec))).png().toFile(/* turbopackIgnore: true */ outputPath);
}

function buildHookOverlayPosition(spec: HookOverlaySpec): string {
  if (spec.position === "top") {
    return "x=(W-w)/2:y=112";
  }

  if (spec.position === "lower") {
    return "x=(W-w)/2:y=H-h-360";
  }

  return "x=(W-w)/2:y=(H-h)/2";
}

function buildOverlayFilterComplex(input: {
  hasBrandingOverlay: boolean;
  hookOverlaySpec: HookOverlaySpec | null;
  hookOverlayInputIndex: number | null;
}): string {
  const parts: string[] = [];
  let current = "[0:v]";

  if (input.hasBrandingOverlay) {
    parts.push(`${current}[1:v]overlay=0:0:shortest=1:format=auto[branded]`);
    current = "[branded]";
  }

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
      `${current}${hookLabel}overlay=${buildHookOverlayPosition(spec)}:enable='between(t,${spec.startSeconds.toFixed(3)},${spec.endSeconds.toFixed(3)})':eof_action=pass[hooked]`,
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
  shouldBrandingLowerThirdYieldToCaptions,
  buildHookOverlaySvg,
  buildOverlayFilterComplex,
  validateOverlayEligibility,
  fileHasBytes,
  formatSermonDate: (date: Date): string => formatSermonDate(date),
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function getTempOverlayPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".overlay.partial.mp4");
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
      renderedFilePath: true,
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
    },
  });

  return branding;
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

async function failOverlayRender(clipId: string, message: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      overlayStatus: "FAILED",
      overlayRenderError: message,
    },
  });
  await markOverlayAssetFailed(clipId);
}

async function runFfmpegOverlay(input: {
  sermonId: string;
  renderedPath: string;
  outputPath: string;
  filterComplex: string;
  brandingOverlayPath?: string;
  hookOverlayPath?: string;
  ffmpegPath?: string;
  jobId: string;
}): Promise<void> {
  const command = commandFor(input.ffmpegPath);
  const args = [
    "-y",
    "-i",
    input.renderedPath,
  ];

  if (input.brandingOverlayPath) {
    args.push("-loop", "1", "-i", input.brandingOverlayPath);
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

  await appendPipelineLog(input.sermonId, "Overlay render started.");

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

  const clip = await loadClipForOverlay(clipId);
  await ensureSermonFolders(clip.sermonId);

  const renderedPath = clip.renderedFilePath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
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
    await failOverlayRender(clip.id, eligibility.reason ?? "Clip is not eligible for overlay rendering.");
    throw new Error(eligibility.reason ?? "Clip is not eligible for overlay rendering.");
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    const message = "FFmpeg is not installed or not executable.";
    await failOverlayRender(clip.id, message);
    throw new Error(message);
  }

  const outputPath = getOverlayClipPath(clip.sermonId, clip.id);
  const outputExists = await fileHasBytes(outputPath);

  if (outputExists && !options?.allowRerender && !options?.force) {
    const renderedAt = new Date();
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: buildOverlayMetadata(outputPath),
    });
    await markOverlayAssetCompleted(clip.id, false);

    return {
      clipId: clip.id,
      overlayVideoPath: outputPath,
      renderedAt,
      reusedExistingFile: true,
    };
  }

  // Claim the render slot — prevents duplicate concurrent renders.
  const claimResult = await prisma.clipCandidate.updateMany({
    where: {
      id: clip.id,
      NOT: { overlayStatus: "RENDERING" },
    },
    data: {
      overlayStatus: "RENDERING",
      overlayRenderError: null,
    },
  });

  if (claimResult.count === 0) {
    throw new Error("Overlay render is already in progress for this clip.");
  }

  const job = await createProcessingJob(clip.sermonId, "RENDER_OVERLAY");

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Overlay render requested for clip ${clip.id}.`);

    const overlayDimensions = getBrandingOverlayDimensions("VERTICAL_9_16");
    const brandingOverlayPath = getTempOverlayPath(outputPath).replace(/\.mp4$/i, ".branding.png");
    const hookOverlaySpec = extractHookOverlaySpec(clip.captionData);
    const captionsOverrideBranding = shouldBrandingLowerThirdYieldToCaptions(clip.captionData);
    const hookOverlayPath = hookOverlaySpec
      ? getTempOverlayPath(outputPath).replace(/\.mp4$/i, ".hook.png")
      : null;

    const overlayEnabled = await renderBrandingOverlayPng(
      brandingOverlayPath,
      {
        enabled: true,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: true,
        lowerThirdEnabled: !captionsOverrideBranding,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: branding?.primaryBrandColor ?? null,
      },
      {
        format: "VERTICAL_9_16",
        sermonTitle: sermon.title,
        preacherName: sermon.speakerName,
        churchName: sermon.churchName,
        themeColor: branding?.primaryBrandColor ?? null,
        watermarkPosition: "BOTTOM_RIGHT",
        width: overlayDimensions.width,
        height: overlayDimensions.height,
      },
    );

    if (hookOverlaySpec && hookOverlayPath) {
      await renderHookOverlayPng(hookOverlayPath, hookOverlaySpec);
    }

    const fullFilter = buildOverlayFilterComplex({
      hasBrandingOverlay: overlayEnabled,
      hookOverlaySpec,
      hookOverlayInputIndex: hookOverlaySpec ? (overlayEnabled ? 2 : 1) : null,
    });

    const tempOutputPath = getTempOverlayPath(outputPath);
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
      hookOverlayPath: hookOverlayPath ?? undefined,
      ffmpegPath: options?.ffmpegPath,
      jobId: job.id,
    });

    await rename(/* turbopackIgnore: true */ tempOutputPath, /* turbopackIgnore: true */ outputPath);
    if (!(await fileHasBytes(outputPath))) {
      throw new Error("Overlay render produced an empty output file.");
    }
    if (overlayEnabled) {
      await unlink(/* turbopackIgnore: true */ brandingOverlayPath).catch(() => undefined);
    }
    if (hookOverlayPath) {
      await unlink(/* turbopackIgnore: true */ hookOverlayPath).catch(() => undefined);
    }

    const renderedAt = new Date();
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: buildOverlayMetadata(outputPath),
    });
    await markOverlayAssetCompleted(clip.id, true);
    await invalidateAfterOverlayCompleted(
      clip.id,
      "Overlay regenerated. Export assets require regeneration.",
    );

    await appendPipelineLog(clip.sermonId, `Overlay render completed for clip ${clip.id}.`);
    await markJobSucceeded(job.id, `Overlay rendered for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      overlayVideoPath: outputPath,
      renderedAt,
      reusedExistingFile: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay render error.";

    const tempOutputPath = getTempOverlayPath(outputPath);
    try {
      await unlink(/* turbopackIgnore: true */ tempOutputPath);
    } catch {
      // Ignore cleanup failures.
    }
    await unlink(/* turbopackIgnore: true */ tempOutputPath.replace(/\.mp4$/i, ".branding.png")).catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ tempOutputPath.replace(/\.mp4$/i, ".hook.png")).catch(() => undefined);

    await failOverlayRender(clip.id, message);
    await markJobFailed(job.id, message, "Overlay render failed.");
    await appendPipelineLog(clip.sermonId, `Overlay render failed for clip ${clip.id}: ${message}`);

    throw new Error(message);
  }
}
