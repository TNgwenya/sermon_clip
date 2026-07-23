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
  resolveCaptionFontFamily,
  resolveCaptionSafeWidthPercent,
  resolveCaptionStylePreset,
  type CaptionDesignSettingsV1,
  type CaptionStylePresetId,
} from "@/lib/captionStylePresets";
import {
  DEFAULT_CAPTION_APPEARANCE_SETTINGS,
  extractCaptionDesignSettings,
  extractCaptionRevealMode,
  extractCaptionStyleOverride,
  extractCaptionSyncOffsetSeconds,
  hasCaptionDesignSettings,
  normalizeCaptionDesignSettings,
  normalizeCaptionAppearanceSettings,
  type CaptionAppearanceSettings,
  type CaptionPosition,
} from "@/lib/clipStudio";
import {
  breakCaptionTextIntoSemanticLines,
  normalizeCaptionCueWordTimings,
  splitEditableCaptionCue,
  type CaptionCueWordTiming,
} from "@/lib/clipStudioEditing";
import { getBrandingSettings } from "@/server/branding/settings";
import { getSharp } from "@/server/agents/sharpClient";
import {
  extractSpeechCleanupCutPlan,
  remapTimelineRangeToCleanedTime,
  type SpeechCleanupCutPlan,
} from "@/lib/speechCleanupPlan";
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
import { validateTranscriptSafetyForPublishing } from "@/server/agents/localLanguageTranscriptSafety";
import {
  SOFTWARE_VIDEO_ENCODER,
  buildVideoEncoderArgs as buildSharedVideoEncoderArgs,
  resolvePreferredVideoEncoder as resolveSharedPreferredVideoEncoder,
  shouldRetryWithSoftwareEncoder,
} from "@/server/media/videoEncoding";
import {
  capturePromotedMediaIdentity,
  discardPromotedMediaIfUnchanged,
  type PromotedMediaIdentity,
} from "@/server/agents/mediaPromotionGuard";

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
  | "captionBurnFreshness"
  | "captionedVideoPath"
  | "transcriptSafetyStatus"
>;

type CaptionBurnEligibilityInput = {
  status: ClipCandidate["status"];
  renderStatus: ClipCandidate["renderStatus"];
  captionStatus: ClipCandidate["captionStatus"];
  captionBurnStatus: ClipCandidate["captionBurnStatus"];
  renderedClipExists: boolean;
  subtitleExists: boolean;
  allowReburn: boolean;
  transcriptSafetyStatus?: ClipCandidate["transcriptSafetyStatus"];
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
  wordTimings?: CaptionCueWordTiming[];
  activeWordIndex?: number;
};

type CaptionSafeArea = "STANDARD" | "RAISED" | "LOWER_MINIMAL";

const FALLBACK_VIDEO_ENCODER = SOFTWARE_VIDEO_ENCODER;
// Typical 60–120 second clips regularly exceed 120 spoken words. Keep active-
// word final renders aligned with Studio preview for those normal short-form
// lengths while retaining a guardrail for unusually large FFmpeg graphs.
const MAX_WORD_HIGHLIGHT_OVERLAY_CUES = 360;
const MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES = 180;
const MAX_SEMANTIC_CAPTION_SPLITS_PER_CUE = 120;
const CAPTION_RENDERER_VERSION = 5;

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function resolvePreferredVideoEncoder(): string {
  return resolveSharedPreferredVideoEncoder("caption");
}

function isHardwareVideoEncoder(encoder: string): boolean {
  return shouldRetryWithSoftwareEncoder(encoder);
}

function buildVideoEncoderArgs(encoder: string): string[] {
  return buildSharedVideoEncoderArgs(encoder, "caption");
}

function getTempBurnPath(outputPath: string, editPlanId: string): string {
  const planSuffix = editPlanId.replace(/[^a-zA-Z0-9_-]/g, "");
  return outputPath.replace(/\.mp4$/i, `.plan-${planSuffix}.captioning.partial.mp4`);
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

function toAssColor(color: string, opacity = 1): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "FFFFFF";
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  const alpha = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16)
    .padStart(2, "0");

  return `&H${alpha}${blue}${green}${red}`.toUpperCase();
}

function captionAssAlignment(design: CaptionDesignSettingsV1): number {
  const horizontal =
    design.layout.horizontalPosition === "left"
      ? 1
      : design.layout.horizontalPosition === "right"
        ? 3
        : 2;
  if (design.layout.verticalPosition === "top") return horizontal + 6;
  if (design.layout.verticalPosition === "middle") return horizontal + 3;
  return horizontal;
}

function captionAssVerticalMargin(
  design: CaptionDesignSettingsV1,
  safeArea: CaptionSafeArea,
): number {
  if (design.layout.verticalPosition === "middle") {
    return 0;
  }

  const safeMargin = design.layout.verticalPosition === "top"
    ? 82
    : safeArea === "RAISED"
      ? 104
      : safeArea === "LOWER_MINIMAL"
        ? 44
        : 64;
  const signedOffset = design.layout.verticalPosition === "top"
    ? -design.layout.verticalOffset
    : design.layout.verticalOffset;
  return Math.max(0, Math.round(safeMargin + signedOffset));
}

function captionAssHorizontalMargins(design: CaptionDesignSettingsV1): {
  left: number;
  right: number;
} {
  const widthPercent = resolveCaptionSafeWidthPercent(design.layout.safeWidth);
  const baseMargin = Math.round((1080 * (1 - widthPercent / 100)) / 2);
  const offset = design.layout.horizontalOffset;

  return {
    left: Math.max(12, Math.round(baseMargin + offset)),
    right: Math.max(12, Math.round(baseMargin - offset)),
  };
}

function buildCaptionForceStyle(
  presetId: string | null | undefined,
  safeArea: CaptionSafeArea = "STANDARD",
  captionPosition: CaptionPosition = "lower",
  appearance?: CaptionAppearanceSettings,
  captionDesign?: CaptionDesignSettingsV1,
): string {
  const design = captionDesign ?? normalizeCaptionDesignSettings(undefined, {
    presetId,
    legacyAppearance: appearance,
    legacyPosition: captionPosition,
  });
  const font = resolveCaptionFontFamily(design.typography.fontFamilyId);
  const margins = captionAssHorizontalMargins(design);
  const shadow = Math.max(
    0,
    Math.min(
      4,
      Math.round(
        Math.max(
          Math.abs(design.readability.shadowOffsetX),
          Math.abs(design.readability.shadowOffsetY),
          design.readability.shadowBlurPx / 4,
        ) * design.readability.shadowOpacity / 2,
      ),
    ),
  );

  return [
    `FontName=${font.renderFamily}`,
    `FontSize=${Math.max(14, Math.round(design.typography.fontSizePx * 0.62))}`,
    `Bold=${design.typography.fontWeight >= 700 ? -1 : 0}`,
    `Italic=${design.typography.italic ? -1 : 0}`,
    `Spacing=${design.typography.letterSpacingPx}`,
    `PrimaryColour=${toAssColor(design.colors.textColor)}`,
    `OutlineColour=${toAssColor(design.readability.outlineColor)}`,
    `BackColour=${toAssColor(design.background.color, design.background.opacity)}`,
    `BorderStyle=${design.background.treatment === "none" ? 1 : 3}`,
    `Outline=${Math.round(design.readability.outlineWidthPx)}`,
    `Shadow=${shadow}`,
    `Alignment=${captionAssAlignment(design)}`,
    `MarginL=${margins.left}`,
    `MarginR=${margins.right}`,
    `MarginV=${captionAssVerticalMargin(design, safeArea)}`,
  ].join(",");
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
  if (hasCaptionDesignSettings(captionData)) {
    return extractCaptionDesignSettings(captionData).layout.verticalPosition;
  }

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

function resolveCaptionDesign(
  captionData: unknown,
  fallback: CaptionStylePresetId,
): CaptionDesignSettingsV1 {
  return extractCaptionDesignSettings(captionData, fallback);
}

/**
 * ASS handles the high-frequency caption controls efficiently (font, size,
 * case, colours, outline and safe placement). SVG remains required whenever
 * the complete saved design uses visual controls ASS cannot reproduce. This
 * includes polished stock presets; the bounded renderer below protects
 * unusually high-cue exports without weakening normal preview/export parity.
 */
function requiresCaptionImageOverlayForDesign(
  captionData: unknown,
  design: CaptionDesignSettingsV1,
): boolean {
  if (!hasCaptionDesignSettings(captionData)) {
    return false;
  }

  const backgroundIsVisible =
    design.background.treatment !== "none"
    && design.background.opacity > 0;
  const visibleBorder =
    backgroundIsVisible
    && design.background.borderWidthPx > 0
    && design.background.borderOpacity > 0;
  const roundedTreatment =
    design.background.treatment === "rounded"
    || design.background.treatment === "soft-panel";
  const explicitPanelPadding =
    backgroundIsVisible
    && (design.background.paddingX > 0 || design.background.paddingY > 0);
  const visibleShadow =
    design.readability.shadowOpacity > 0
    && (
      design.readability.shadowBlurPx > 0
      || design.readability.shadowOffsetX !== 0
      || design.readability.shadowOffsetY !== 0
    );
  const nonBinaryFontWeight =
    design.typography.fontWeight !== 400
    && design.typography.fontWeight !== 700;
  const customLineMetrics =
    Math.abs(design.typography.lineHeight - 1.2) > 0.001
    || Math.abs(design.typography.wordSpacingPx) > 0.001;
  const independentTextAlignment =
    design.typography.alignment !== design.layout.horizontalPosition;

  return (
    customLineMetrics
    || nonBinaryFontWeight
    || independentTextAlignment
    || !Number.isInteger(design.readability.outlineWidthPx)
    || visibleBorder
    || roundedTreatment
    || explicitPanelPadding
    || visibleShadow
  );
}

function shouldUseStaticCaptionImageOverlay(
  requiresImageOverlay: boolean,
  cueCount: number,
): boolean {
  return (
    requiresImageOverlay
    && cueCount > 0
    && cueCount <= MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES
  );
}

function resolveClipCaptionStylePresetId(
  captionData: unknown,
  fallback: CaptionStylePresetId,
): CaptionStylePresetId {
  return extractCaptionStyleOverride(captionData) || fallback;
}

function shouldApplyCaptionsToClip(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return true;
  }

  const value = (captionData as Record<string, unknown>)["applyCaptionsToClip"];
  return typeof value === "boolean" ? value : true;
}

function shouldUseWordHighlightOverlay(captionData: unknown): boolean {
  return extractCaptionRevealMode(captionData) === "active-word";
}

function hasCurrentCaptionRendererVersion(captionData: unknown): boolean {
  return Boolean(
    captionData
    && typeof captionData === "object"
    && !Array.isArray(captionData)
    && (captionData as Record<string, unknown>)["captionRendererVersion"] === CAPTION_RENDERER_VERSION,
  );
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

function wrapCaptionText(
  value: string,
  maxLineLength = 34,
  maxLines = 3,
): string[] {
  return breakCaptionTextIntoSemanticLines(value, {
    maxCharactersPerLine: maxLineLength,
    maxLines,
  });
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

function wrapCaptionWords(
  value: string,
  maxLineLength = 34,
  maxLines = 3,
): CaptionOverlayWord[][] {
  const words = splitCaptionOverlayWords(value).map((word, index) => ({ index, text: word }));
  const lineTexts = breakCaptionTextIntoSemanticLines(value, {
    maxCharactersPerLine: maxLineLength,
    maxLines,
  });
  let cursor = 0;

  return lineTexts.map((line) => {
    const wordCount = splitCaptionOverlayWords(line).length;
    const lineWords = words.slice(cursor, cursor + wordCount);
    cursor += wordCount;
    return lineWords;
  });
}

function normalizeCaptionWordIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveMatchingCaptionWordTimings(cue: CaptionCueOverlay): CaptionCueWordTiming[] | null {
  const words = splitCaptionOverlayWords(cue.text);
  const timings = normalizeCaptionCueWordTimings(
    cue.wordTimings,
    cue.startSeconds,
    cue.endSeconds,
  );
  if (
    !timings
    || timings.length !== words.length
    || !words.every((word, index) => {
      const visibleWord = normalizeCaptionWordIdentity(word);
      const timedWord = normalizeCaptionWordIdentity(timings[index]?.text ?? "");
      return visibleWord.length > 0 && visibleWord === timedWord;
    })
  ) {
    return null;
  }

  return timings;
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

    const wordTimings = normalizeCaptionCueWordTimings(record["wordTimings"], startSeconds, endSeconds);

    return [{
      index: Number(record["index"]) || index + 1,
      startSeconds,
      endSeconds,
      text,
      ...(wordTimings ? { wordTimings } : {}),
    }];
  });
}

function shiftCaptionCueOverlays(
  cues: CaptionCueOverlay[],
  offsetSeconds: number,
): CaptionCueOverlay[] {
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) < 0.001) {
    return cues;
  }

  return cues.flatMap((cue) => {
    const shiftedStartSeconds = cue.startSeconds + offsetSeconds;
    const shiftedEndSeconds = cue.endSeconds + offsetSeconds;
    if (shiftedEndSeconds <= 0) {
      return [];
    }

    const startSeconds = Number(Math.max(0, shiftedStartSeconds).toFixed(3));
    const endSeconds = Number(shiftedEndSeconds.toFixed(3));
    const wordTimings = cue.wordTimings?.flatMap((timing) => {
      const wordStartSeconds = timing.startSeconds + offsetSeconds;
      const wordEndSeconds = timing.endSeconds + offsetSeconds;
      if (wordEndSeconds <= 0) {
        return [];
      }

      return [{
        ...timing,
        startSeconds: Number(Math.max(0, wordStartSeconds).toFixed(3)),
        endSeconds: Number(wordEndSeconds.toFixed(3)),
      }];
    });

    return [{
      ...cue,
      startSeconds,
      endSeconds,
      ...(wordTimings && wordTimings.length > 0 ? { wordTimings } : { wordTimings: undefined }),
    }];
  }).map((cue, index) => ({ ...cue, index: index + 1 }));
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

    const wordTimings = cue.wordTimings?.flatMap((timing) => {
      const remappedWord = remapTimelineRangeToCleanedTime({
        startSeconds: timing.startSeconds,
        endSeconds: timing.endSeconds,
        plan,
      });
      return remappedWord
        ? [{
            ...timing,
            startSeconds: remappedWord.startSeconds,
            endSeconds: remappedWord.endSeconds,
          }]
        : [];
    });

    return [{
      ...cue,
      index: index + 1,
      startSeconds: remapped.startSeconds,
      endSeconds: remapped.endSeconds,
      ...(wordTimings && wordTimings.length > 0 ? { wordTimings } : { wordTimings: undefined }),
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

function captionOverlayFontSize(
  appearance: CaptionAppearanceSettings,
  design?: CaptionDesignSettingsV1,
): number {
  if (design) {
    return design.typography.fontSizePx;
  }

  if (appearance.fontScale === "compact") {
    return 32;
  }

  if (appearance.fontScale === "large") {
    return 42;
  }

  return 36;
}

function captionOverlayLineLength(
  appearance: CaptionAppearanceSettings,
  design?: CaptionDesignSettingsV1,
): number {
  if (design) {
    const widthRatio = resolveCaptionSafeWidthPercent(design.layout.safeWidth) / 78;
    const sizeRatio = 36 / design.typography.fontSizePx;
    const spacingPenalty = Math.max(
      0.72,
      1 - Math.max(0, design.typography.letterSpacingPx + design.typography.wordSpacingPx / 3) / 30,
    );
    return Math.max(18, Math.min(52, Math.round(34 * widthRatio * sizeRatio * spacingPenalty)));
  }

  if (appearance.fontScale === "compact") {
    return 40;
  }

  if (appearance.fontScale === "large") {
    return 29;
  }

  return 34;
}

function splitCaptionCueOverlaysForLayout(
  cues: CaptionCueOverlay[],
  appearance: CaptionAppearanceSettings = DEFAULT_CAPTION_APPEARANCE_SETTINGS,
  design?: CaptionDesignSettingsV1,
): CaptionCueOverlay[] {
  const targetLines = Math.max(2, Math.min(4, design?.layout.maxLines ?? appearance.maxLines));
  const maxCharacters = captionOverlayLineLength(appearance, design) * targetLines;
  const fontSize = captionOverlayFontSize(appearance, design);
  const wordsPerLine = fontSize >= 40 ? 4 : fontSize <= 32 ? 6 : 5;
  const maxWords = wordsPerLine * targetLines;

  return cues.flatMap((cue) => {
    const initialWords = splitCaptionOverlayWords(cue.text);
    if (
      initialWords.length <= 1
      || (initialWords.length <= maxWords && cue.text.length <= maxCharacters)
    ) {
      return [cue];
    }

    const chunks: CaptionCueOverlay[] = [];
    let remaining: CaptionCueOverlay = cue;
    let splitCount = 0;
    let appendedRemaining = false;

    while (splitCount < MAX_SEMANTIC_CAPTION_SPLITS_PER_CUE) {
      const remainingWords = splitCaptionOverlayWords(remaining.text);
      if (
        remainingWords.length <= 1
        || (remainingWords.length <= maxWords && remaining.text.length <= maxCharacters)
      ) {
        chunks.push(remaining);
        appendedRemaining = true;
        break;
      }

      let preferredWordIndex = 0;
      let candidateLength = 0;
      for (const word of remainingWords) {
        const nextLength = candidateLength + (preferredWordIndex > 0 ? 1 : 0) + word.length;
        if (
          preferredWordIndex > 0
          && (preferredWordIndex >= maxWords || nextLength > maxCharacters)
        ) {
          break;
        }
        preferredWordIndex += 1;
        candidateLength = nextLength;
      }
      preferredWordIndex = Math.max(1, Math.min(remainingWords.length - 1, preferredWordIndex));
      const split = splitEditableCaptionCue({
        cues: [remaining],
        cueIndex: 0,
        splitWordIndex: preferredWordIndex,
        clipDurationSeconds: Math.max(cue.endSeconds, remaining.endSeconds),
        minimumCueDurationSeconds: 0.05,
      });
      if (!split.changed || split.cues.length !== 2) {
        chunks.push(remaining);
        appendedRemaining = true;
        break;
      }

      const [left, right] = split.cues;
      chunks.push({ ...left, activeWordIndex: undefined });
      remaining = { ...right, activeWordIndex: undefined };
      splitCount += 1;
    }

    if (!appendedRemaining) {
      // The guard protects pathological manually-entered cues from unbounded
      // work. Preserve the full spoken tail even when it remains oversized.
      chunks.push(remaining);
    }

    if (chunks.length === 0) {
      return [cue];
    }

    return chunks.map((chunk, index) => ({
      ...chunk,
      index: cue.index * 100 + index + 1,
      activeWordIndex: undefined,
    }));
  });
}

function formatCaptionOverlayText(
  value: string,
  appearance: CaptionAppearanceSettings,
  presetId?: CaptionStylePresetId,
  captionDesign?: CaptionDesignSettingsV1,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const design = captionDesign ?? normalizeCaptionDesignSettings(undefined, {
    presetId,
    legacyAppearance: appearance,
  });
  if (design.typography.textCase === "uppercase") {
    return normalized.toUpperCase();
  }
  if (design.typography.textCase === "lowercase") {
    return normalized.toLowerCase();
  }
  return normalized;
}

function estimateCaptionSvgWordWidth(
  value: string,
  fontSize: number,
  letterSpacingPx: number,
): number {
  let emWidth = 0;
  for (const character of Array.from(value)) {
    if (/[MW@%&]/.test(character)) {
      emWidth += 0.78;
    } else if (/[ilI1|.,'`:;]/.test(character)) {
      emWidth += 0.3;
    } else if (/[A-Z0-9]/.test(character)) {
      emWidth += 0.62;
    } else if (/[a-z]/.test(character)) {
      emWidth += 0.54;
    } else {
      // A safe width for accented Latin and other glyphs in multilingual text.
      emWidth += 0.62;
    }
  }

  const characters = Array.from(value).length;
  return emWidth * fontSize + Math.max(0, characters - 1) * letterSpacingPx;
}

function captionSvgWordGapWidth(
  fontSize: number,
  design: CaptionDesignSettingsV1,
): number {
  return fontSize * 0.33 + design.typography.wordSpacingPx;
}

function estimateCaptionSvgLineWidth(
  value: string,
  fontSize: number,
  design: CaptionDesignSettingsV1,
): number {
  const words = splitCaptionOverlayWords(value);
  return (
    words.reduce(
      (total, word) => total + estimateCaptionSvgWordWidth(
        word,
        fontSize,
        design.typography.letterSpacingPx,
      ),
      0,
    )
    + Math.max(0, words.length - 1) * captionSvgWordGapWidth(fontSize, design)
  );
}

function estimateCaptionSvgOverlayWordLineWidth(
  line: CaptionOverlayWord[],
  activeWordIndex: number | undefined,
  fontSize: number,
  activeFontSize: number,
  design: CaptionDesignSettingsV1,
): number {
  return (
    line.reduce(
      (total, word) => total + estimateCaptionSvgWordWidth(
        word.text,
        word.index === activeWordIndex ? activeFontSize : fontSize,
        design.typography.letterSpacingPx,
      ),
      0,
    )
    + Math.max(0, line.length - 1) * captionSvgWordGapWidth(fontSize, design)
  );
}

function buildActiveCaptionWordRect(input: {
  line: CaptionOverlayWord[];
  activeWordIndex: number;
  lineY: number;
  textX: number;
  textAnchor: "start" | "middle" | "end";
  fontSize: number;
  activeFontSize: number;
  design: CaptionDesignSettingsV1;
}): string {
  const activeLineIndex = input.line.findIndex(
    (word) => word.index === input.activeWordIndex,
  );
  if (activeLineIndex < 0 || input.design.highlighting.backgroundOpacity <= 0) {
    return "";
  }

  const wordWidths = input.line.map((word) => estimateCaptionSvgWordWidth(
    word.text,
    word.index === input.activeWordIndex ? input.activeFontSize : input.fontSize,
    input.design.typography.letterSpacingPx,
  ));
  const gapWidth = captionSvgWordGapWidth(input.fontSize, input.design);
  const lineWidth = estimateCaptionSvgOverlayWordLineWidth(
    input.line,
    input.activeWordIndex,
    input.fontSize,
    input.activeFontSize,
    input.design,
  );
  const lineLeft =
    input.textAnchor === "start"
      ? input.textX
      : input.textAnchor === "end"
        ? input.textX - lineWidth
        : input.textX - lineWidth / 2;
  const precedingWidth =
    wordWidths.slice(0, activeLineIndex).reduce((total, width) => total + width, 0)
    + activeLineIndex * gapWidth;
  const activeWordWidth = wordWidths[activeLineIndex] ?? input.activeFontSize;
  const paddingX = Math.max(5, Math.round(input.fontSize * 0.14));
  const paddingY = Math.max(3, Math.round(input.fontSize * 0.08));
  const rectX = Number((lineLeft + precedingWidth - paddingX).toFixed(2));
  const rectY = Number((input.lineY - paddingY).toFixed(2));
  const rectWidth = Number((activeWordWidth + paddingX * 2).toFixed(2));
  const rectHeight = Number((input.activeFontSize * 1.08 + paddingY * 2).toFixed(2));
  const radius = Math.max(4, Math.round(Math.min(rectHeight, input.fontSize) * 0.24));

  return `<rect data-caption-active-word="true" x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="${radius}" fill="${input.design.colors.highlightBackgroundColor}" fill-opacity="${input.design.highlighting.backgroundOpacity}" />`;
}

function buildCaptionOverlaySvg(
  cue: CaptionCueOverlay,
  appearance: CaptionAppearanceSettings = DEFAULT_CAPTION_APPEARANCE_SETTINGS,
  presetId?: CaptionStylePresetId,
  captionDesign?: CaptionDesignSettingsV1,
): string {
  const design = captionDesign ?? normalizeCaptionDesignSettings(undefined, {
    presetId,
    legacyAppearance: appearance,
  });
  const font = resolveCaptionFontFamily(design.typography.fontFamilyId);
  const width = Math.round(1080 * resolveCaptionSafeWidthPercent(design.layout.safeWidth) / 100);
  const fontSize = captionOverlayFontSize(appearance, design);
  const maxLineLength = captionOverlayLineLength(appearance, design);
  const displayText = formatCaptionOverlayText(cue.text, appearance, design.presetId, design);
  const wordLines = cue.activeWordIndex === undefined
    ? []
    : wrapCaptionWords(displayText, maxLineLength, design.layout.maxLines);
  const lines = wordLines.length > 0
    ? []
    : wrapCaptionText(displayText, maxLineLength, design.layout.maxLines);
  const lineHeight = Math.round(fontSize * design.typography.lineHeight);
  const lineCount = Math.max(1, wordLines.length || lines.length);
  const totalTextHeight = Math.max(lineHeight, lineCount * lineHeight);
  const height = Math.max(72, totalTextHeight + design.background.paddingY * 2 + 14);
  const firstY = Math.round((height - totalTextHeight) / 2) + 6;
  const activeScale = design.highlighting.reducedMotion ? 1 : design.highlighting.scale;
  const activeFontSize = Math.round(fontSize * activeScale);
  const activeFontWeight = Math.min(
    900,
    design.typography.fontWeight + design.highlighting.fontWeightBoost,
  );
  const textAnchor =
    design.typography.alignment === "left"
      ? "start"
      : design.typography.alignment === "right"
        ? "end"
        : "middle";
  const renderedLineWidths = wordLines.length > 0
    ? wordLines.map((line) => estimateCaptionSvgOverlayWordLineWidth(
        line,
        undefined,
        fontSize,
        activeFontSize,
        design,
      ))
    : lines.map((line) => estimateCaptionSvgLineWidth(line, fontSize, design));
  const contentWidth = Math.max(fontSize, ...renderedLineWidths);
  const panelWidth = Number(Math.min(
    width,
    Math.ceil(contentWidth + design.background.paddingX * 2),
  ).toFixed(2));
  const panelX = Number((
    design.layout.horizontalPosition === "left"
      ? 0
      : design.layout.horizontalPosition === "right"
        ? width - panelWidth
        : (width - panelWidth) / 2
  ).toFixed(2));
  const textX =
    design.typography.alignment === "left"
      ? panelX + design.background.paddingX
      : design.typography.alignment === "right"
        ? panelX + panelWidth - design.background.paddingX
        : panelX + panelWidth / 2;
  const borderRadius =
    design.background.treatment === "solid"
      ? 0
      : design.background.borderRadiusPx;
  const showBackground =
    design.background.treatment !== "none"
    && design.background.opacity > 0;
  const showShadow =
    design.readability.shadowOpacity > 0
    && (
      design.readability.shadowBlurPx > 0
      || design.readability.shadowOffsetX !== 0
      || design.readability.shadowOffsetY !== 0
    );
  const fontFamily = escapeSvgText(`${font.renderFamily}, ${font.glyphSafeFallback}`);
  const sharedTextAttributes = [
    `x="${textX}"`,
    `font-family="${fontFamily}"`,
    `font-size="${fontSize}"`,
    `font-weight="${design.typography.fontWeight}"`,
    `font-style="${design.typography.italic ? "italic" : "normal"}"`,
    `fill="${design.colors.textColor}"`,
    `text-anchor="${textAnchor}"`,
    'dominant-baseline="hanging"',
    'paint-order="stroke fill"',
    `stroke="${design.readability.outlineColor}"`,
    `stroke-width="${design.readability.outlineWidthPx}"`,
    'stroke-linejoin="round"',
    'xml:space="preserve"',
    `letter-spacing="${design.typography.letterSpacingPx}px"`,
    `word-spacing="${design.typography.wordSpacingPx}px"`,
  ].join(" ");
  const shadowFilter = showShadow
    ? `<defs><filter id="caption-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="${design.readability.shadowOffsetX}" dy="${design.readability.shadowOffsetY}" stdDeviation="${Number((design.readability.shadowBlurPx / 2).toFixed(2))}" flood-color="${design.readability.shadowColor}" flood-opacity="${design.readability.shadowOpacity}" /></filter></defs>`
    : "";
  const groupFilter = showShadow ? ' filter="url(#caption-shadow)"' : "";
  const backgroundRect = showBackground
    ? `<rect data-caption-panel="true" x="${panelX}" y="0" width="${panelWidth}" height="${height}" rx="${borderRadius}" fill="${design.background.color}" fill-opacity="${design.background.opacity}" />`
    : "";
  const borderRect =
    showBackground
    && design.background.borderWidthPx > 0
    && design.background.borderOpacity > 0
      ? `<rect data-caption-panel-border="true" x="${panelX + design.background.borderWidthPx / 2}" y="${design.background.borderWidthPx / 2}" width="${panelWidth - design.background.borderWidthPx}" height="${height - design.background.borderWidthPx}" rx="${Math.max(0, borderRadius - design.background.borderWidthPx / 2)}" fill="none" stroke="${design.background.borderColor}" stroke-opacity="${design.background.borderOpacity}" stroke-width="${design.background.borderWidthPx}" />`
      : "";
  const activeWordIndex = cue.activeWordIndex;
  const activeWordRects = activeWordIndex === undefined
    ? ""
    : wordLines.map((line, lineIndex) => buildActiveCaptionWordRect({
        line,
        activeWordIndex,
        lineY: firstY + lineIndex * lineHeight,
        textX,
        textAnchor,
        fontSize,
        activeFontSize,
        design,
      })).filter(Boolean).join("\n      ");
  const textElements = wordLines.length > 0
    ? wordLines.map((line, lineIndex) => (
        `<text ${sharedTextAttributes} y="${firstY + lineIndex * lineHeight}">${line.map((word, wordIndex) => {
          const isActive = word.index === cue.activeWordIndex;
          const prefix = wordIndex === 0 ? "" : "&#160;";
          return `<tspan fill="${isActive ? design.colors.activeTextColor : design.colors.textColor}" font-size="${isActive ? activeFontSize : fontSize}" font-weight="${isActive ? activeFontWeight : design.typography.fontWeight}">${prefix}${escapeSvgText(word.text)}</tspan>`;
        }).join("")}</text>`
      )).join("\n      ")
    : lines.map((line, index) => (
        `<text ${sharedTextAttributes} y="${firstY + index * lineHeight}">${escapeSvgText(line)}</text>`
      )).join("\n      ");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${shadowFilter}
      <g${groupFilter}>
      ${backgroundRect}
      ${borderRect}
      ${activeWordRects}
      ${textElements}
      </g>
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

    const exactWordTimings = resolveMatchingCaptionWordTimings(cue);
    const weights = exactWordTimings ? [] : words.map(getCaptionOverlayWordWeight);
    const totalWeight = exactWordTimings ? 0 : weights.reduce((total, weight) => total + weight, 0);
    if (!exactWordTimings && totalWeight <= 0) return [];

    let cursorSeconds = cue.startSeconds;
    let cumulativeWeight = 0;

    return words.map((_, wordIndex) => {
      const exactWordTiming = exactWordTimings?.[wordIndex];
      const wordStartSeconds = exactWordTiming?.startSeconds ?? cursorSeconds;
      cumulativeWeight += weights[wordIndex] ?? 0;
      const wordEndSeconds = exactWordTiming?.endSeconds ?? (
        wordIndex === words.length - 1
          ? cue.endSeconds
          : cue.startSeconds + durationSeconds * (cumulativeWeight / totalWeight)
      );
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

function expandCaptionCueSingleWordOverlays(cues: CaptionCueOverlay[]): CaptionCueOverlay[] {
  return expandCaptionCueWordHighlightOverlays(cues).flatMap((overlay) => {
    const words = splitCaptionOverlayWords(overlay.text);
    const wordIndex = overlay.activeWordIndex;
    const word = wordIndex === undefined ? null : words[wordIndex];
    if (!word) {
      return [];
    }

    return [{
      ...overlay,
      text: word,
      activeWordIndex: undefined,
      wordTimings: undefined,
    }];
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

  const transcriptSafety = validateTranscriptSafetyForPublishing({
    transcriptSafetyStatus: input.transcriptSafetyStatus ?? "TRUSTED",
  });
  if (!transcriptSafety.ok) {
    return { ok: false, reason: transcriptSafety.reason };
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
  captionDesign?: CaptionDesignSettingsV1;
  captionData?: unknown;
}): Pick<Prisma.ClipCandidateUpdateInput, "captionBurnStatus" | "captionedVideoPath" | "captionBurnedAt" | "captionBurnError" | "subtitlesBurned" | "captionData"> {
  const currentCaptionData =
    input.captionData && typeof input.captionData === "object" && !Array.isArray(input.captionData)
      ? (input.captionData as Record<string, unknown>)
      : {};
  const fallbackPresetId = resolveCaptionStylePreset(input.captionStylePresetId).id;
  const captionDesign = input.captionDesign ?? extractCaptionDesignSettings(
    input.captionData,
    fallbackPresetId,
  );

  return {
    captionBurnStatus: "COMPLETED",
    captionedVideoPath: input.outputPath,
    captionBurnedAt: input.burnedAt,
    captionBurnError: null,
    subtitlesBurned: true,
    captionData: {
      ...currentCaptionData,
      captionStylePresetId: captionDesign.presetId,
      captionSafeArea: input.captionSafeArea ?? resolveCaptionSafeArea(input.captionData),
      captionPosition: captionDesign.layout.verticalPosition,
      captionAppearance: input.captionAppearance ?? resolveCaptionAppearance(input.captionData),
      captionDesign,
      captionRendererVersion: CAPTION_RENDERER_VERSION,
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
      captionBurnFreshness: true,
      captionedVideoPath: true,
      transcriptSafetyStatus: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

async function claimCaptionBurnStart(guard: ClipEditPlanGuard): Promise<void> {
  const result = await prisma.clipCandidate.updateMany({
    where: {
      id: guard.clipCandidateId,
      editPlans: {
        some: {
          id: guard.editPlanId,
          planHash: guard.planHash,
          status: "ACTIVE",
        },
      },
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
    await assertClipEditPlanStillActive(guard);
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
  captionDesign?: CaptionDesignSettingsV1;
}): Promise<void> {
  const escapedSubtitlePath = escapeForFfmpegSubtitlesPath(input.subtitlePath);
  const forceStyle = buildCaptionForceStyle(
    input.captionStylePresetId,
    input.captionSafeArea,
    input.captionPosition,
    input.appearance,
    input.captionDesign,
  );
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
  captionStylePresetId?: CaptionStylePresetId;
  captionDesign?: CaptionDesignSettingsV1;
}): Promise<string[]> {
  const imagePaths: string[] = [];
  const sharp = await getSharp();

  for (const cue of input.cues) {
    const imagePath = input.outputPath.replace(/\.mp4$/i, `.cue-${String(cue.index).padStart(2, "0")}.png`);
    await sharp(
      Buffer.from(
        buildCaptionOverlaySvg(
          cue,
          input.appearance,
          input.captionStylePresetId,
          input.captionDesign,
        ),
      ),
    ).png().toFile(imagePath);
    imagePaths.push(imagePath);
  }

  return imagePaths;
}

function captionOverlayYExpression(
  captionPosition: CaptionPosition | undefined,
  appearance?: CaptionAppearanceSettings,
  safeArea: CaptionSafeArea = "STANDARD",
  captionDesign?: CaptionDesignSettingsV1,
): string {
  const resolvedPosition = captionDesign?.layout.verticalPosition ?? captionPosition;
  const offset = captionDesign?.layout.verticalOffset ?? appearance?.verticalOffset ?? 0;
  const safeAreaMargin = safeArea === "RAISED" ? 220 : safeArea === "LOWER_MINIMAL" ? 96 : 132;
  if (resolvedPosition === "top") {
    return String(Math.max(24, safeAreaMargin - offset));
  }

  if (resolvedPosition === "middle") {
    if (offset === 0) {
      return "(H-h)/2";
    }

    return offset > 0 ? `(H-h)/2-${offset}` : `(H-h)/2+${Math.abs(offset)}`;
  }

  const lowerMargin = Math.max(24, safeAreaMargin + offset);
  if (lowerMargin === 132) {
    return "H-h-132";
  }

  return `H-h-${lowerMargin}`;
}

function captionOverlayXExpression(captionDesign?: CaptionDesignSettingsV1): string {
  if (!captionDesign) {
    return "(W-w)/2";
  }

  const offset = captionDesign.layout.horizontalOffset;
  if (captionDesign.layout.horizontalPosition === "left") {
    return `max(24\\,min(W-w-24\\,W*0.05${offset >= 0 ? "+" : ""}${offset}))`;
  }
  if (captionDesign.layout.horizontalPosition === "right") {
    return `max(24\\,min(W-w-24\\,W-w-W*0.05${offset >= 0 ? "+" : ""}${offset}))`;
  }
  if (offset === 0) {
    return "(W-w)/2";
  }

  return `max(24\\,min(W-w-24\\,(W-w)/2${offset >= 0 ? "+" : ""}${offset}))`;
}

function buildCaptionOverlayFilterGraph(
  cues: CaptionCueOverlay[],
  overlayY: string,
  animateWordPop = false,
  reducedMotion = false,
  overlayX = "(W-w)/2",
): string {
  let previous = "[0:v]";
  const filterParts: string[] = [];

  cues.forEach((cue, index) => {
    let overlayInput = `[${index + 1}:v]`;
    if (animateWordPop && !reducedMotion) {
      const durationSeconds = Math.max(0.05, cue.endSeconds - cue.startSeconds);
      const animationSeconds = Math.min(0.16, Math.max(0.05, durationSeconds / 2));
      const popInput = `[caption-pop-${index}]`;
      const progress = `min(t/${animationSeconds.toFixed(3)}\\,1)`;
      filterParts.push(
        `${overlayInput}trim=duration=${durationSeconds.toFixed(3)},setpts=PTS-STARTPTS,scale=w='trunc(iw*(0.92+0.08*${progress})/2)*2':h='trunc(ih*(0.92+0.08*${progress})/2)*2':eval=frame,fade=t=in:st=0:d=${animationSeconds.toFixed(3)}:alpha=1,setpts=PTS+${cue.startSeconds.toFixed(3)}/TB${popInput}`,
      );
      overlayInput = popInput;
    }

    const output = index === cues.length - 1 ? "[v]" : `[captioned${index}]`;
    filterParts.push(
      `${previous}${overlayInput}overlay=${overlayX}:${overlayY}:enable='between(t,${cue.startSeconds.toFixed(3)},${cue.endSeconds.toFixed(3)})':eof_action=pass${output}`,
    );
    previous = output;
  });

  return filterParts.join(";");
}

function buildCaptionOverlayImageInputArgs(
  imagePaths: string[],
  animateWordPop = false,
  reducedMotion = false,
): string[] {
  const inputFramerate = animateWordPop && !reducedMotion ? "30" : "1";
  return imagePaths.flatMap((imagePath) => [
    "-loop",
    "1",
    "-framerate",
    inputFramerate,
    "-i",
    imagePath,
  ]);
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
  captionStylePresetId?: CaptionStylePresetId;
  captionSafeArea?: CaptionSafeArea;
  animateWordPop?: boolean;
  captionDesign?: CaptionDesignSettingsV1;
}): Promise<void> {
  if (input.cues.length === 0) {
    throw new Error("Caption overlay fallback could not find any caption cues.");
  }

  const imagePaths = await createCaptionOverlayImages({
    cues: input.cues,
    outputPath: input.outputPath,
    appearance: input.appearance,
    captionStylePresetId: input.captionStylePresetId,
    captionDesign: input.captionDesign,
  });

  const command = commandFor(input.ffmpegPath);
  const overlayY = captionOverlayYExpression(
    input.captionPosition,
    input.appearance,
    input.captionSafeArea,
    input.captionDesign,
  );
  const overlayX = captionOverlayXExpression(input.captionDesign);
  const filterGraph = buildCaptionOverlayFilterGraph(
    input.cues,
    overlayY,
    input.animateWordPop,
    input.captionDesign?.highlighting.reducedMotion,
    overlayX,
  );

  const buildArgs = (videoEncoder: string): string[] => {
    const args = [
      "-y",
      "-i",
      input.renderedPath,
      ...buildCaptionOverlayImageInputArgs(
        imagePaths,
        input.animateWordPop,
        input.captionDesign?.highlighting.reducedMotion,
      ),
    ];

    args.push(
      "-filter_complex",
      filterGraph,
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
  editPlanGuard: ClipEditPlanGuard,
): Promise<CaptionBurnResult> {
  await ensureSermonFolders(clip.sermonId);

  const renderedPath = clip.renderedFilePath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
  const subtitlePath = clip.subtitleFilePath?.trim() || clip.srtPath?.trim() || getClipSrtPath(clip.sermonId, clip.id);
  const captionedVideoPath = getCaptionedClipPath(clip.sermonId, clip.id);
  const tempCaptionedVideoPath = getTempBurnPath(captionedVideoPath, editPlanGuard.editPlanId);
  const speechCleanupPlan = extractSpeechCleanupCutPlan(clip.captionData);
  const sourceCaptionCues = extractCaptionCueOverlays(clip.captionData);
  const captionSyncOffsetSeconds = extractCaptionSyncOffsetSeconds(clip.captionData);
  const syncedCaptionCues = shiftCaptionCueOverlays(sourceCaptionCues, captionSyncOffsetSeconds);
  const renderCaptionCues = remapCaptionCueOverlaysForSpeechCleanup(syncedCaptionCues, speechCleanupPlan);
  const renderCaptionData = clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
    ? { ...(clip.captionData as Record<string, unknown>), cues: renderCaptionCues }
    : clip.captionData;

  const renderedClipExists = await fileExists(renderedPath);
  const subtitleExists = await fileExists(subtitlePath) || renderCaptionCues.length > 0;
  const existingOutput = await fileExists(captionedVideoPath);
  const canReuseExistingOutput = existingOutput
    && clip.captionBurnStatus === "COMPLETED"
    && clip.captionBurnFreshness === "UP_TO_DATE"
    && hasCurrentCaptionRendererVersion(clip.captionData)
    && !options?.force
    && !options?.allowReburn;

  const eligibility = validateCaptionBurnEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    captionStatus: clip.captionStatus,
    captionBurnStatus: clip.captionBurnStatus,
    renderedClipExists,
    subtitleExists,
    allowReburn: Boolean(options?.allowReburn || canReuseExistingOutput),
    transcriptSafetyStatus: clip.transcriptSafetyStatus,
  });

  if (!eligibility.ok) {
    throw new Error(eligibility.reason ?? "Clip is not eligible for caption burn.");
  }

  if (!shouldApplyCaptionsToClip(clip.captionData)) {
    throw new Error("Captions are disabled for this clip in Clip Studio.");
  }

  if (canReuseExistingOutput) {
    const outputStat = await stat(captionedVideoPath).catch(() => null);
    const burnedAt = new Date();
    const brandingSettings = await getBrandingSettings();
    const captionStylePresetId = resolveClipCaptionStylePresetId(
      clip.captionData,
      options?.captionStylePresetId ?? (brandingSettings.defaultCaptionStyleName as CaptionStylePresetId),
    );
    const captionDesign = resolveCaptionDesign(renderCaptionData, captionStylePresetId);
    const captionPosition = captionDesign.layout.verticalPosition;
    const captionAppearance = resolveCaptionAppearance(renderCaptionData);
    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        ...buildCaptionBurnMetadata({
          outputPath: captionedVideoPath,
          burnedAt,
          captionStylePresetId,
          captionSafeArea: resolveCaptionSafeArea(clip.captionData),
          captionPosition,
          captionAppearance,
          captionDesign,
          captionData: clip.captionData,
        }),
        captionBurnFreshness: "UP_TO_DATE",
        assetInvalidationReason: null,
      },
    });
    await recordClipArtifact({
      clipCandidateId: clip.id,
      kind: "CAPTIONED",
      filePath: captionedVideoPath,
      sizeBytes: outputStat?.size ?? null,
      metadata: {
        reusedExistingFile: true,
        captionStylePresetId,
        captionPosition,
      },
      editPlan: {
        editPlanId: editPlanGuard.editPlanId,
        planHash: editPlanGuard.planHash,
      },
    });

    await appendJobLog(jobId, `Reused existing captioned video for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Reused captioned video for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      captionedVideoPath,
      burnedAt,
      reusedExistingFile: true,
    };
  }

  await assertClipEditPlanStillActive(editPlanGuard);

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
  const captionDesign = resolveCaptionDesign(renderCaptionData, captionStylePresetId);
  const resolvedCaptionStylePresetId = captionDesign.presetId;
  const captionPosition = captionDesign.layout.verticalPosition;
  const captionAppearance = resolveCaptionAppearance(renderCaptionData);
  const captionRevealMode = extractCaptionRevealMode(clip.captionData);
  const layoutCaptionCues = splitCaptionCueOverlaysForLayout(
    renderCaptionCues,
    captionAppearance,
    captionDesign,
  );
  const styledLayoutCaptionCues = layoutCaptionCues.map((cue) => ({
    ...cue,
    text: formatCaptionOverlayText(
      cue.text,
      captionAppearance,
      resolvedCaptionStylePresetId,
      captionDesign,
    ),
    ...(cue.wordTimings
      ? {
          wordTimings: cue.wordTimings.map((timing) => ({
            ...timing,
            text: formatCaptionOverlayText(
              timing.text,
              captionAppearance,
              resolvedCaptionStylePresetId,
              captionDesign,
            ),
          })),
        }
      : {}),
  }));
  const layoutWasSplit = layoutCaptionCues.length !== renderCaptionCues.length;
  const captionTextWasAdjusted = styledLayoutCaptionCues.some(
    (cue, index) => cue.text !== layoutCaptionCues[index]?.text,
  );
  const subtitleFileExists = await fileExists(subtitlePath);
  const captionTimingWasAdjusted = Boolean(speechCleanupPlan?.enabled) || Math.abs(captionSyncOffsetSeconds) >= 0.001;
  const shouldMaterializeCaptionCues = styledLayoutCaptionCues.length > 0
    && (captionTimingWasAdjusted || layoutWasSplit || captionTextWasAdjusted || !subtitleFileExists);
  const remappedSubtitlePath = shouldMaterializeCaptionCues
    ? (subtitleFileExists
        ? tempCaptionedVideoPath.replace(/\.mp4$/i, ".studio-captions.srt")
        : subtitlePath)
    : null;

  if (remappedSubtitlePath) {
    await writeFile(/* turbopackIgnore: true */ remappedSubtitlePath, buildSrtFromCaptionCueOverlays(styledLayoutCaptionCues), "utf8");
    await appendJobLog(
      jobId,
      speechCleanupPlan?.enabled
        ? "Caption timing remapped to the speech-cleaned render timeline with readable phrase windows."
        : Math.abs(captionSyncOffsetSeconds) >= 0.001
          ? `Caption sync adjusted by ${captionSyncOffsetSeconds > 0 ? "+" : ""}${captionSyncOffsetSeconds.toFixed(2)} seconds.`
        : "Long caption cues split into readable phrase windows without dropping spoken words.",
    );
  }

  let usedWordHighlightOverlay = false;
  const wordHighlightCues = shouldUseWordHighlightOverlay(clip.captionData)
    ? expandCaptionCueWordHighlightOverlays(styledLayoutCaptionCues)
    : [];
  const singleWordCues = captionRevealMode === "single-word"
    ? expandCaptionCueSingleWordOverlays(styledLayoutCaptionCues)
    : [];
  const requiresCaptionDesignOverlay = requiresCaptionImageOverlayForDesign(
    clip.captionData,
    captionDesign,
  );
  const requiresStaticCaptionOverlay =
    requiresCaptionDesignOverlay
    || (
      captionPosition === "middle"
      && captionDesign.layout.verticalOffset !== 0
    );
  const useStaticCaptionOverlay =
    captionRevealMode !== "single-word"
    && shouldUseStaticCaptionImageOverlay(
      requiresStaticCaptionOverlay,
      styledLayoutCaptionCues.length,
    );
  const singleWordOverlayLimit = captionDesign.highlighting.reducedMotion
    ? MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES
    : MAX_WORD_HIGHLIGHT_OVERLAY_CUES;
  const useSingleWordPopOverlay =
    singleWordCues.length > 0
    && singleWordCues.length <= singleWordOverlayLimit;
  const skippedOversizedWordHighlightOverlay =
    wordHighlightCues.length > MAX_WORD_HIGHLIGHT_OVERLAY_CUES;

  if (skippedOversizedWordHighlightOverlay) {
    await appendJobLog(jobId, `Caption burn skipped active-word image overlays because ${wordHighlightCues.length} overlays exceeds the ${MAX_WORD_HIGHLIGHT_OVERLAY_CUES} local limit.`);
    await appendPipelineLog(clip.sermonId, "Caption burn omitted active-word animation because its overlay graph is too large.");
  }

  if (wordHighlightCues.length > 0 && wordHighlightCues.length <= MAX_WORD_HIGHLIGHT_OVERLAY_CUES) {
    usedWordHighlightOverlay = true;
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
      captionStylePresetId: resolvedCaptionStylePresetId,
      captionSafeArea,
      captionDesign,
    });
  } else if (useStaticCaptionOverlay || useSingleWordPopOverlay) {
    await appendJobLog(
      jobId,
      useSingleWordPopOverlay
        ? captionDesign.highlighting.reducedMotion
          ? "Caption burn using reduced-motion one-word image overlays."
          : "Caption burn using animated one-word image overlays."
        : "Caption burn using image overlays for design controls that require exact SVG rendering.",
    );
    await runFfmpegCaptionOverlayFallback({
      sermonId: clip.sermonId,
      renderedPath,
      outputPath: tempCaptionedVideoPath,
      ffmpegPath: options?.ffmpegPath,
      jobId,
      cues: useSingleWordPopOverlay ? singleWordCues : styledLayoutCaptionCues,
      captionPosition,
      appearance: captionAppearance,
      captionStylePresetId: resolvedCaptionStylePresetId,
      captionSafeArea,
      animateWordPop: useSingleWordPopOverlay,
      captionDesign,
    });
  } else {
    if (
      requiresStaticCaptionOverlay
      && styledLayoutCaptionCues.length > MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES
    ) {
      await appendJobLog(
        jobId,
        `Caption design has ${styledLayoutCaptionCues.length} cues, above the ${MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES} exact-design overlay limit. Using the efficient ASS renderer to keep this unusually long export reliable.`,
      );
      await appendPipelineLog(
        clip.sermonId,
        "Caption burn using bounded ASS fallback because the exact-design overlay graph is too large.",
      );
    }
    if (
      captionRevealMode === "single-word"
      && singleWordCues.length > singleWordOverlayLimit
    ) {
      await appendJobLog(
        jobId,
        `Caption burn skipped one-word image animation because ${singleWordCues.length} word overlays exceeds the ${singleWordOverlayLimit} local limit.`,
      );
      await appendPipelineLog(
        clip.sermonId,
        "Caption burn using bounded ASS fallback because the one-word overlay graph is too large.",
      );
    }
    try {
      await runFfmpegCaptionBurn({
        sermonId: clip.sermonId,
        renderedPath,
        subtitlePath: remappedSubtitlePath ?? subtitlePath,
        outputPath: tempCaptionedVideoPath,
        ffmpegPath: options?.ffmpegPath,
        jobId,
        captionStylePresetId: resolvedCaptionStylePresetId,
        captionSafeArea,
        captionPosition,
        appearance: captionAppearance,
        captionDesign,
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
        cues: styledLayoutCaptionCues,
        captionPosition,
        appearance: captionAppearance,
        captionStylePresetId: resolvedCaptionStylePresetId,
        captionSafeArea,
        captionDesign,
      });
    }
  }
  if (remappedSubtitlePath) {
    await unlink(/* turbopackIgnore: true */ remappedSubtitlePath).catch(() => undefined);
  }

  let promotedOutputIdentity: PromotedMediaIdentity | null = null;
  try {
    await assertClipEditPlanStillActive(editPlanGuard);
    await rename(tempCaptionedVideoPath, captionedVideoPath);
    promotedOutputIdentity = await capturePromotedMediaIdentity(captionedVideoPath);
  } catch (error) {
    await unlink(tempCaptionedVideoPath).catch(() => undefined);
    throw error;
  }

  try {
    const outputStat = await stat(captionedVideoPath);
    if (outputStat.size <= 0) {
      throw new Error("Caption burn produced an empty output file.");
    }

    const burnedAt = new Date();
    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        ...buildCaptionBurnMetadata({
          outputPath: captionedVideoPath,
          burnedAt,
          captionStylePresetId: resolvedCaptionStylePresetId,
          captionSafeArea,
          captionPosition,
          captionAppearance,
          captionDesign,
          captionData: clip.captionData,
        }),
        captionBurnFreshness: "UP_TO_DATE",
        captionBurnAssetVersion: { increment: 1 },
        overlayFreshness: "NEEDS_REGENERATION",
        exportFreshness: "NEEDS_REGENERATION",
        assetInvalidationReason: "Caption burn regenerated. Overlay and export assets now require regeneration.",
      },
    });
    await recordClipArtifact({
      clipCandidateId: clip.id,
      kind: "CAPTIONED",
      filePath: captionedVideoPath,
      sizeBytes: outputStat.size,
      metadata: {
        reusedExistingFile: false,
        captionStylePresetId: resolvedCaptionStylePresetId,
        captionPosition,
        wordHighlightOverlay: usedWordHighlightOverlay,
      },
      editPlan: {
        editPlanId: editPlanGuard.editPlanId,
        planHash: editPlanGuard.planHash,
      },
    });

    await appendJobLog(jobId, `Caption burn completed for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Caption burn completed for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      captionedVideoPath,
      burnedAt,
      reusedExistingFile: false,
    };
  } catch (error) {
    const completionError = await preferStaleClipCompositionError(editPlanGuard, error);
    if (promotedOutputIdentity && isStaleClipCompositionError(completionError)) {
      await discardPromotedMediaIfUnchanged(captionedVideoPath, promotedOutputIdentity);
    }
    throw completionError;
  }
}

export async function burnCaptionsIntoRenderedClip(
  clipId: string,
  options?: CaptionBurnOptions,
): Promise<CaptionBurnResult> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    throw new Error("Clip id is required for caption burn.");
  }

  const { plan: startedEditPlan } = await upsertActiveClipEditPlanForClip({
    clipCandidateId: normalizedClipId,
    createdBy: "caption_burn",
    createdReason: "caption_burn_input_snapshot",
  });
  const editPlanGuard = {
    clipCandidateId: normalizedClipId,
    editPlanId: startedEditPlan.id,
    planHash: startedEditPlan.planHash,
  };

  const clip = await loadClipForCaptionBurn(normalizedClipId);
  await assertClipEditPlanStillActive(editPlanGuard);
  const job = await createProcessingJob(clip.sermonId, "BURN_SUBTITLES");
  const renderedPath = clip.renderedFilePath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
  const subtitlePath = clip.subtitleFilePath?.trim() || clip.srtPath?.trim() || getClipSrtPath(clip.sermonId, clip.id);
  const storedCaptionCues = extractCaptionCueOverlays(clip.captionData);

  const eligibility = validateCaptionBurnEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    captionStatus: clip.captionStatus,
    captionBurnStatus: clip.captionBurnStatus,
    renderedClipExists: await fileExists(renderedPath),
    subtitleExists: await fileExists(subtitlePath) || storedCaptionCues.length > 0,
    allowReburn: Boolean(options?.allowReburn),
    transcriptSafetyStatus: clip.transcriptSafetyStatus,
  });

  if (!eligibility.ok) {
    throw new Error(eligibility.reason ?? "Clip is not eligible for caption burn.");
  }

  let didClaimBurnStart = false;
  try {
    await claimCaptionBurnStart(editPlanGuard);
    didClaimBurnStart = true;
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Caption burn started for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Caption burn requested for clip ${clip.id}.`);

    const result = await burnCaptionsForClipCore(
      clip,
      options,
      job.id,
      editPlanGuard,
    );

    await markJobSucceeded(
      job.id,
      result.reusedExistingFile
        ? `Reused existing captioned video for ${clip.id}.`
        : `Captioned video generated for ${clip.id}.`,
    );

    return result;
  } catch (error) {
    const completionError = await preferStaleClipCompositionError(editPlanGuard, error);
    const message = completionError instanceof Error ? completionError.message : "Unknown caption burn error.";
    const captionedVideoPath = getCaptionedClipPath(clip.sermonId, clip.id);
    await unlink(getTempBurnPath(captionedVideoPath, editPlanGuard.editPlanId)).catch(() => undefined);
    if (isStaleClipCompositionError(completionError)) {
      await markJobFailed(job.id, message, "Stale caption burn discarded after newer Clip Studio changes.").catch(() => undefined);
      await appendPipelineLog(clip.sermonId, `Discarded stale caption burn for clip ${clip.id}: ${message}`).catch(() => undefined);
      throw completionError;
    }
    const failureRecorded = didClaimBurnStart
      ? await tryUpdateClipCandidateForActiveEditPlan({
          guard: editPlanGuard,
          data: {
            captionBurnStatus: "FAILED",
            captionBurnError: message,
            captionBurnFreshness: "FAILED",
          },
        }).catch(() => false)
      : false;
    if (failureRecorded) {
      await recordClipArtifact({
        clipCandidateId: clip.id,
        kind: "CAPTIONED",
        status: "FAILED",
        errorMessage: message,
        editPlan: {
          editPlanId: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
        },
      }).catch(() => undefined);
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
  requiresCaptionImageOverlayForDesign,
  shouldUseStaticCaptionImageOverlay,
  resolveClipCaptionStylePresetId,
  shouldApplyCaptionsToClip,
  shouldUseWordHighlightOverlay,
  hasCurrentCaptionRendererVersion,
  extractCaptionCueOverlays,
  resolveMatchingCaptionWordTimings,
  shiftCaptionCueOverlays,
  remapCaptionCueOverlaysForSpeechCleanup,
  expandCaptionCueWordHighlightOverlays,
  expandCaptionCueSingleWordOverlays,
  buildSrtFromCaptionCueOverlays,
  formatCaptionOverlayText,
  buildCaptionOverlaySvg,
  buildCaptionOverlayFilterGraph,
  buildCaptionOverlayImageInputArgs,
  splitCaptionCueOverlaysForLayout,
  captionOverlayXExpression,
  captionOverlayYExpression,
  shouldUseCaptionOverlayFallback,
  MAX_WORD_HIGHLIGHT_OVERLAY_CUES,
  MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES,
  CAPTION_RENDERER_VERSION,
};
