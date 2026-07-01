import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import type { CaptionStylePresetId } from "@/lib/captionStylePresets";
import type { EditableCaptionCue } from "@/lib/clipStudioEditing";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ClipStudioStatus = "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
export type ClipStudioRenderStatus = "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
export type ClipStudioCaptionStatus = "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";

// ─── Caption Package ────────────────────────────────────────────────────────

export type CaptionPackage = {
  primaryCaption: string | null;
  shortCaption: string | null;
  platformCaption: string | null;
  hashtags: string[];
  qualityScore: number | null;
  qualityReason: string | null;
  warnings: string[];
};

export type CaptionGuidance = {
  qualityScore: number | null;
  qualityReason: string | null;
  warnings: string[];
  translationUncertainty: string | null;
  improvementSuggestions: string[];
};

export type HookOverlayAnimation = "none" | "fade" | "pan-in" | "pop";
export type HookOverlayPosition = "top" | "center" | "lower";
export type HookOverlaySize = "small" | "medium" | "large";

export type HookOverlayConfig = {
  enabled: boolean;
  text: string;
  position: HookOverlayPosition;
  startSeconds: number;
  durationSeconds: number;
  animation: HookOverlayAnimation;
  size: HookOverlaySize;
  bold: boolean;
};

export type SpeechCleanupSettings = {
  removeDeadAir: boolean;
  tightenLongPauses: boolean;
  flagFillerWords: boolean;
};

export const DEFAULT_SPEECH_CLEANUP_SETTINGS: SpeechCleanupSettings = {
  removeDeadAir: false,
  tightenLongPauses: false,
  flagFillerWords: true,
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeQualityScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value > 1 && value <= 10) {
    return value / 10;
  }

  return value >= 0 && value <= 1 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isCaptionStylePresetId(value: unknown): value is CaptionStylePresetId {
  return (
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
  );
}

export function extractOnVideoCaptionCues(
  captionData: unknown,
  fallbackCaption: string | null,
  fallbackDurationSeconds: number | null,
): EditableCaptionCue[] {
  const data = asObject(captionData);
  const cues = Array.isArray(data?.["cues"]) ? data["cues"] : [];

  const parsedCues = cues.flatMap((cue, index) => {
    const record = asObject(cue);
    if (!record) {
      return [];
    }

    const startSeconds = asNumber(record["startSeconds"]);
    const endSeconds = asNumber(record["endSeconds"]);
    const text = typeof record["text"] === "string" ? record["text"].replace(/\s+/g, " ").trim() : "";

    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) {
      return [];
    }

    return [{
      index: Number(record["index"]) || index + 1,
      startSeconds,
      endSeconds,
      text,
    }];
  });

  if (parsedCues.length > 0) {
    return parsedCues.map((cue, index) => ({ ...cue, index: index + 1 }));
  }

  const fallbackText = fallbackCaption?.replace(/\s+/g, " ").trim();
  if (!fallbackText) {
    return [];
  }

  return [{
    index: 1,
    startSeconds: 0,
    endSeconds: Math.min(6, Math.max(1, fallbackDurationSeconds ?? 6)),
    text: fallbackText,
  }];
}

export function extractCaptionStyleOverride(captionData: unknown): CaptionStylePresetId | "" {
  const data = asObject(captionData);
  const value = data?.["captionStylePresetId"];

  return isCaptionStylePresetId(value) ? value : "";
}

export function extractApplyCaptionsToClip(captionData: unknown): boolean {
  const data = asObject(captionData);
  return typeof data?.["applyCaptionsToClip"] === "boolean" ? data["applyCaptionsToClip"] : true;
}

export function extractSpeechCleanupSettings(captionData: unknown): SpeechCleanupSettings {
  const data = asObject(captionData);
  const speechCleanup = asObject(data?.["speechCleanup"]);

  return {
    removeDeadAir: typeof speechCleanup?.["removeDeadAir"] === "boolean"
      ? speechCleanup["removeDeadAir"]
      : DEFAULT_SPEECH_CLEANUP_SETTINGS.removeDeadAir,
    tightenLongPauses: typeof speechCleanup?.["tightenLongPauses"] === "boolean"
      ? speechCleanup["tightenLongPauses"]
      : DEFAULT_SPEECH_CLEANUP_SETTINGS.tightenLongPauses,
    flagFillerWords: typeof speechCleanup?.["flagFillerWords"] === "boolean"
      ? speechCleanup["flagFillerWords"]
      : DEFAULT_SPEECH_CLEANUP_SETTINGS.flagFillerWords,
  };
}

export function extractHookOverlayConfig(
  captionData: unknown,
  fallbackHook: string | null,
): HookOverlayConfig {
  const data = asObject(captionData);
  const hookOverlay = asObject(data?.["hookOverlay"]);
  const fallbackText = fallbackHook?.trim() ?? "";
  const position = hookOverlay?.["position"];
  const animation = hookOverlay?.["animation"];
  const size = hookOverlay?.["size"];

  return {
    enabled: typeof hookOverlay?.["enabled"] === "boolean" ? hookOverlay["enabled"] : Boolean(fallbackText),
    text: typeof hookOverlay?.["text"] === "string" ? hookOverlay["text"] : fallbackText,
    position: position === "top" || position === "center" || position === "lower" ? position : "top",
    startSeconds: asNumber(hookOverlay?.["startSeconds"]) ?? 0,
    durationSeconds: asNumber(hookOverlay?.["durationSeconds"]) ?? 6,
    animation: animation === "fade" || animation === "pan-in" || animation === "pop" || animation === "none" ? animation : "fade",
    size: size === "small" || size === "medium" || size === "large" ? size : "medium",
    bold: typeof hookOverlay?.["bold"] === "boolean" ? hookOverlay["bold"] : true,
  };
}

export function extractCaptionPackage(
  captionData: unknown,
  fallbackCaption: string | null,
  fallbackHashtags: string[],
): CaptionPackage {
  const empty: CaptionPackage = {
    primaryCaption: null,
    shortCaption: null,
    platformCaption: null,
    hashtags: fallbackHashtags,
    qualityScore: null,
    qualityReason: null,
    warnings: [],
  };

  if (!captionData || typeof captionData !== "object") {
    return { ...empty, primaryCaption: fallbackCaption };
  }

  const data = captionData as Record<string, unknown>;
  const captionPackage = asObject(data["captionPackage"]);

  const primaryCaption =
    typeof data["primaryCaption"] === "string"
      ? data["primaryCaption"]
      : typeof captionPackage?.["primaryCaption"] === "string"
        ? captionPackage["primaryCaption"]
      : typeof data["caption"] === "string"
        ? data["caption"]
        : fallbackCaption;

  const shortCaption =
    typeof data["shortCaption"] === "string"
      ? data["shortCaption"]
      : typeof captionPackage?.["shortCaption"] === "string"
        ? captionPackage["shortCaption"]
        : null;

  const platformCaption =
    typeof data["platformCaption"] === "string"
      ? data["platformCaption"]
      : typeof captionPackage?.["platformCaption"] === "string"
        ? captionPackage["platformCaption"]
      : typeof data["platformFriendlyCaption"] === "string"
        ? data["platformFriendlyCaption"]
        : null;

  const hashtags = asStringArray(data["hashtags"]);
  const packageHashtags = asStringArray(captionPackage?.["optionalHashtags"]);
  const resolvedHashtags = hashtags.length > 0 ? hashtags : packageHashtags.length > 0 ? packageHashtags : fallbackHashtags;

  const qualityScore =
    normalizeQualityScore(data["qualityScore"]) ?? normalizeQualityScore(captionPackage?.["captionQualityScore"]);

  const qualityReason =
    typeof data["qualityReason"] === "string"
      ? data["qualityReason"]
      : typeof data["captionReason"] === "string"
        ? data["captionReason"]
        : typeof captionPackage?.["captionReason"] === "string"
          ? captionPackage["captionReason"]
          : null;

  const warnings = [
    ...asStringArray(data["warnings"]),
    ...asStringArray(data["captionWarnings"]),
    ...asStringArray(captionPackage?.["captionWarnings"]),
  ];

  return {
    primaryCaption,
    shortCaption,
    platformCaption,
    hashtags: resolvedHashtags,
    qualityScore,
    qualityReason,
    warnings,
  };
}

export function extractCaptionGuidance(captionData: unknown): CaptionGuidance {
  if (!captionData || typeof captionData !== "object") {
    return {
      qualityScore: null,
      qualityReason: null,
      warnings: [],
      translationUncertainty: null,
      improvementSuggestions: [],
    };
  }

  const data = captionData as Record<string, unknown>;
  const captionPackage = asObject(data["captionPackage"]);
  const languageHints = asObject(data["languageHints"]);

  const qualityScore =
    normalizeQualityScore(data["qualityScore"]) ?? normalizeQualityScore(captionPackage?.["captionQualityScore"]);

  const qualityReason =
    typeof data["qualityReason"] === "string"
      ? data["qualityReason"]
      : typeof data["captionReason"] === "string"
        ? data["captionReason"]
        : typeof captionPackage?.["captionReason"] === "string"
          ? captionPackage["captionReason"]
          : null;

  const warnings = [
    ...asStringArray(data["warnings"]),
    ...asStringArray(data["captionWarnings"]),
    ...asStringArray(captionPackage?.["captionWarnings"]),
  ];

  const translationUncertainty =
    typeof data["translationUncertaintyNote"] === "string"
      ? data["translationUncertaintyNote"]
      : typeof languageHints?.["translationUncertaintyNote"] === "string"
        ? languageHints["translationUncertaintyNote"]
        : null;

  const improvementSuggestions = asStringArray(data["improvementSuggestions"]);

  return {
    qualityScore,
    qualityReason,
    warnings,
    translationUncertainty,
    improvementSuggestions,
  };
}

export function hasCaptionPackage(pkg: CaptionPackage): boolean {
  return Boolean(
    pkg.primaryCaption || pkg.shortCaption || pkg.platformCaption || pkg.hashtags.length > 0,
  );
}

// ─── Social Score ───────────────────────────────────────────────────────────

export type SocialScoreDisplay = {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger" | "accent";
};

export function formatSocialScore(value: string | null | undefined): SocialScoreDisplay {
  if (!value) {
    return { label: "Social potential", value: "Not assessed", tone: "neutral" };
  }

  const lower = value.toLowerCase();
  if (lower.includes("high") || lower.includes("strong") || lower.includes("excellent")) {
    return { label: "Social potential", value, tone: "success" };
  }
  if (lower.includes("low") || lower.includes("weak") || lower.includes("poor")) {
    return { label: "Social potential", value, tone: "warning" };
  }
  return { label: "Social potential", value, tone: "accent" };
}

// ─── Ministry Score ─────────────────────────────────────────────────────────

export type MinistryScoreDisplay = {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger" | "accent";
};

export function formatMinistryScore(value: string | null | undefined): MinistryScoreDisplay {
  if (!value) {
    return { label: "Ministry value", value: "Not assessed", tone: "neutral" };
  }

  const lower = value.toLowerCase();
  if (lower.includes("high") || lower.includes("strong") || lower.includes("excellent")) {
    return { label: "Ministry value", value, tone: "success" };
  }
  if (lower.includes("low") || lower.includes("weak") || lower.includes("poor")) {
    return { label: "Ministry value", value, tone: "warning" };
  }
  return { label: "Ministry value", value, tone: "accent" };
}

// ─── Clip Status Display ────────────────────────────────────────────────────

export function formatClipStatusLabel(
  status: ClipStudioStatus,
  options?: { isManuallyEdited?: boolean; renderStatus?: ClipStudioRenderStatus },
): string {
  if (status === "REJECTED") {
    return "Rejected";
  }

  if (options?.renderStatus === "COMPLETED") {
    return "Video ready";
  }

  if (status === "APPROVED") {
    return "Approved";
  }

  if (options?.isManuallyEdited) {
    return "Edited";
  }

  switch (status) {
    case "SUGGESTED":
      return "Needs Review";
    case "EXPORTED":
      return "Ready to post";
    default:
      return "Needs Review";
  }
}

export function clipStatusTone(status: ClipStudioStatus): "neutral" | "success" | "warning" | "danger" | "accent" {
  switch (status) {
    case "SUGGESTED":
      return "warning";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
    case "EXPORTED":
      return "accent";
  }
}

export function renderStatusLabel(status: ClipStudioRenderStatus): string {
  switch (status) {
    case "NOT_RENDERED":
      return "Not prepared";
    case "QUEUED":
      return "Waiting to prepare";
    case "RENDERING":
      return "Preparing video…";
    case "COMPLETED":
      return "Video ready";
    case "FAILED":
      return "Video needs attention";
  }
}

// ─── Duration Formatting ────────────────────────────────────────────────────

export function formatClipDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "Unknown";
  }
  return formatSecondsForPastorView(seconds);
}

// ─── Language Hints ─────────────────────────────────────────────────────────

export type LanguageHint = {
  detectedLanguage: string | null;
  isMixed: boolean;
  translatedFrom: string | null;
  originalPhrase: string | null;
  englishMeaning: string | null;
  translationConfidence: string | null;
  uncertaintyNote: string | null;
};

export function extractLanguageHints(data: unknown): LanguageHint | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const root = data as Record<string, unknown>;
  const nested = asObject(root["languageHints"]);
  const d = nested ?? root;

  const detectedLanguage =
    typeof d["detectedLanguage"] === "string" ? d["detectedLanguage"] : null;
  const isMixed = d["isMixed"] === true || d["mixedLanguage"] === true;
  const translatedFrom =
    typeof d["translatedFrom"] === "string" ? d["translatedFrom"] : null;
  const originalPhrase =
    typeof d["originalPhrase"] === "string" ? d["originalPhrase"] : null;
  const englishMeaning =
    typeof d["englishMeaning"] === "string" ? d["englishMeaning"] : null;
  const translationConfidence =
    typeof d["translationConfidence"] === "string"
      ? d["translationConfidence"]
      : typeof d["translationConfidence"] === "number"
        ? String(d["translationConfidence"])
        : null;
  const uncertaintyNote =
    typeof d["uncertaintyNote"] === "string"
      ? d["uncertaintyNote"]
      : typeof d["translationUncertaintyNote"] === "string"
        ? d["translationUncertaintyNote"]
        : null;

  // Only return if there is something meaningful to show
  if (
    !detectedLanguage &&
    !isMixed &&
    !translatedFrom &&
    !originalPhrase &&
    !englishMeaning
  ) {
    return null;
  }

  return {
    detectedLanguage,
    isMixed,
    translatedFrom,
    originalPhrase,
    englishMeaning,
    translationConfidence,
    uncertaintyNote,
  };
}

// ─── Transcript Excerpt ─────────────────────────────────────────────────────

const TRANSCRIPT_PREVIEW_CHAR_LIMIT = 600;

export function formatTranscriptExcerpt(text: string | null | undefined): string | null {
  if (!text || !text.trim()) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length <= TRANSCRIPT_PREVIEW_CHAR_LIMIT) {
    return trimmed;
  }

  const truncated = trimmed.slice(0, TRANSCRIPT_PREVIEW_CHAR_LIMIT);
  const lastSpace = truncated.lastIndexOf(" ");
  const boundary = lastSpace > TRANSCRIPT_PREVIEW_CHAR_LIMIT * 0.8 ? lastSpace : TRANSCRIPT_PREVIEW_CHAR_LIMIT;
  return truncated.slice(0, boundary) + "…";
}

// ─── Timing Display ─────────────────────────────────────────────────────────

export type ClipTimingDisplay = {
  startLabel: string;
  endLabel: string;
  durationLabel: string;
};

export function buildClipTimingDisplay(
  startTimeSeconds: number,
  endTimeSeconds: number,
  durationSeconds: number,
): ClipTimingDisplay {
  return {
    startLabel: formatSecondsForPastorView(startTimeSeconds),
    endLabel: formatSecondsForPastorView(endTimeSeconds),
    durationLabel: formatClipDuration(durationSeconds),
  };
}
