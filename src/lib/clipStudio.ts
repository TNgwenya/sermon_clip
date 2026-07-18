import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import { isCaptionStylePresetId as isKnownCaptionStylePresetId, type CaptionStylePresetId } from "@/lib/captionStylePresets";
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
  titleOptions: string[];
  hookOptions: string[];
  ctaOptions: string[];
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
export type BrollCardTone = "scripture" | "quote" | "application" | "context";
export type BrollCardPosition = "full" | "upper" | "lower";
export type CaptionPosition = "top" | "middle" | "lower";
export type CaptionFontScale = "compact" | "regular" | "large";
export type CaptionMaxLines = 2 | 3 | 4;
export type SpeechCleanupIntensity = "normal" | "more" | "strong" | "maximum";

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

export type HookOverlayVisibilityResult = {
  hookOverlay: HookOverlayConfig;
  error: string | null;
  wasClamped: boolean;
};

export type BrollCardConfig = {
  id: string;
  enabled: boolean;
  text: string;
  label: string;
  startSeconds: number;
  durationSeconds: number;
  tone: BrollCardTone;
  position: BrollCardPosition;
};

export type BrollLayerConfig = {
  enabled: boolean;
  cards: BrollCardConfig[];
};

export type SpeechCleanupSettings = {
  removeDeadAir: boolean;
  tightenLongPauses: boolean;
  flagFillerWords: boolean;
  intensity: SpeechCleanupIntensity;
};

export type SpeechCleanupProfile = {
  intensity: SpeechCleanupIntensity;
  edgeSpeechPadSeconds: number;
  internalSpeechPadSeconds: number;
  minEdgeSilenceSeconds: number;
  minInternalSilenceSeconds: number;
  silenceDetectNoiseDb: number;
  silenceDetectDurationSeconds: number;
};

export type CaptionAppearanceSettings = {
  fontScale: CaptionFontScale;
  maxLines: CaptionMaxLines;
  uppercase: boolean;
  verticalOffset: number;
};

export const DEFAULT_SPEECH_CLEANUP_SETTINGS: SpeechCleanupSettings = {
  removeDeadAir: false,
  tightenLongPauses: false,
  flagFillerWords: true,
  intensity: "normal",
};

export const SPEECH_CLEANUP_INTENSITIES: SpeechCleanupIntensity[] = ["normal", "more", "strong", "maximum"];

export const SPEECH_CLEANUP_INTENSITY_LABELS: Record<SpeechCleanupIntensity, string> = {
  normal: "Normal",
  more: "More",
  strong: "Strong",
  maximum: "Maximum",
};

const SPEECH_CLEANUP_PROFILES: Record<SpeechCleanupIntensity, SpeechCleanupProfile> = {
  normal: {
    intensity: "normal",
    edgeSpeechPadSeconds: 0.12,
    internalSpeechPadSeconds: 0.18,
    minEdgeSilenceSeconds: 0.5,
    minInternalSilenceSeconds: 1.2,
    silenceDetectNoiseDb: -35,
    silenceDetectDurationSeconds: 0.3,
  },
  more: {
    intensity: "more",
    edgeSpeechPadSeconds: 0.1,
    internalSpeechPadSeconds: 0.14,
    minEdgeSilenceSeconds: 0.35,
    minInternalSilenceSeconds: 0.85,
    silenceDetectNoiseDb: -33,
    silenceDetectDurationSeconds: 0.24,
  },
  strong: {
    intensity: "strong",
    edgeSpeechPadSeconds: 0.08,
    internalSpeechPadSeconds: 0.1,
    minEdgeSilenceSeconds: 0.25,
    minInternalSilenceSeconds: 0.55,
    silenceDetectNoiseDb: -31,
    silenceDetectDurationSeconds: 0.18,
  },
  maximum: {
    intensity: "maximum",
    edgeSpeechPadSeconds: 0.05,
    internalSpeechPadSeconds: 0.07,
    minEdgeSilenceSeconds: 0.18,
    minInternalSilenceSeconds: 0.32,
    silenceDetectNoiseDb: -28,
    silenceDetectDurationSeconds: 0.12,
  },
};

export function normalizeSpeechCleanupIntensity(value: unknown): SpeechCleanupIntensity {
  return value === "more" || value === "strong" || value === "maximum" ? value : "normal";
}

export function resolveSpeechCleanupProfile(value: unknown): SpeechCleanupProfile {
  return SPEECH_CLEANUP_PROFILES[normalizeSpeechCleanupIntensity(value)];
}

export const DEFAULT_CAPTION_APPEARANCE_SETTINGS: CaptionAppearanceSettings = {
  fontScale: "regular",
  maxLines: 4,
  uppercase: false,
  verticalOffset: 0,
};

export const DEFAULT_BROLL_LAYER_CONFIG: BrollLayerConfig = {
  enabled: false,
  cards: [],
};

export function inferBrollCardTone(value: string): BrollCardTone {
  const text = value.replace(/\s+/g, " ").trim();
  if (/\b(?:[1-3]\s*)?[A-Za-z]{2,}\s+\d{1,3}:\d{1,3}\b/.test(text)) {
    return "scripture";
  }

  if (/\b(?:remember|choose|pray|share|invite|trust|believe|we\s+(?:must|should|need)|you\s+(?:must|should|need|can))\b/i.test(text)) {
    return "application";
  }

  if (/\b(?:because|when|while|before|after|in\s+this\s+(?:passage|chapter|moment))\b/i.test(text)) {
    return "context";
  }

  return "quote";
}

export function labelForBrollTone(tone: BrollCardTone): string {
  if (tone === "scripture") return "Scripture";
  if (tone === "application") return "Put it into practice";
  if (tone === "context") return "Context";
  return "Key quote";
}

export function resolveNextBrollCardStart(input: {
  clipDurationSeconds: number;
  previewSeconds: number;
  cards: Array<Pick<BrollCardConfig, "startSeconds" | "durationSeconds">>;
}): number {
  const durationSeconds = Math.max(1, input.clipDurationSeconds);
  const latestStartSeconds = Math.max(0, durationSeconds - 1);
  if (Number.isFinite(input.previewSeconds) && input.previewSeconds >= 0.5) {
    return Number(Math.min(latestStartSeconds, input.previewSeconds).toFixed(1));
  }

  const latestCardEnd = input.cards.reduce(
    (latest, card) => Math.max(latest, card.startSeconds + card.durationSeconds),
    0,
  );
  const suggestedStart = input.cards.length === 0
    ? Math.max(1.5, durationSeconds * 0.28)
    : latestCardEnd + Math.max(0.75, durationSeconds * 0.04);
  const distributedFallback = durationSeconds * Math.min(0.78, 0.28 + input.cards.length * 0.18);

  return Number(Math.min(latestStartSeconds, suggestedStart <= latestStartSeconds ? suggestedStart : distributedFallback).toFixed(1));
}

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
  return isKnownCaptionStylePresetId(value);
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

export function extractCaptionPosition(captionData: unknown): CaptionPosition {
  const data = asObject(captionData);
  const value = data?.["captionPosition"];

  return value === "top" || value === "middle" || value === "lower" ? value : "lower";
}

export function extractApplyCaptionsToClip(captionData: unknown): boolean {
  const data = asObject(captionData);
  return typeof data?.["applyCaptionsToClip"] === "boolean" ? data["applyCaptionsToClip"] : true;
}

export function normalizeCaptionAppearanceSettings(value: unknown): CaptionAppearanceSettings {
  const appearance = asObject(value);
  const rawFontScale = appearance?.["fontScale"];
  const fontScale: CaptionFontScale =
    rawFontScale === "compact" || rawFontScale === "regular" || rawFontScale === "large"
      ? rawFontScale
      : DEFAULT_CAPTION_APPEARANCE_SETTINGS.fontScale;
  const rawMaxLines = asNumber(appearance?.["maxLines"]);
  const maxLines: CaptionMaxLines =
    rawMaxLines === 2 || rawMaxLines === 3 || rawMaxLines === 4
      ? rawMaxLines
      : DEFAULT_CAPTION_APPEARANCE_SETTINGS.maxLines;
  const rawVerticalOffset = asNumber(appearance?.["verticalOffset"]);
  const verticalOffset =
    rawVerticalOffset === null
      ? DEFAULT_CAPTION_APPEARANCE_SETTINGS.verticalOffset
      : Math.max(-48, Math.min(48, Math.round(rawVerticalOffset)));

  return {
    fontScale,
    maxLines,
    uppercase: typeof appearance?.["uppercase"] === "boolean"
      ? appearance["uppercase"]
      : DEFAULT_CAPTION_APPEARANCE_SETTINGS.uppercase,
    verticalOffset,
  };
}

export function extractCaptionAppearanceSettings(captionData: unknown): CaptionAppearanceSettings {
  const data = asObject(captionData);
  return normalizeCaptionAppearanceSettings(data?.["captionAppearance"]);
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
    intensity: normalizeSpeechCleanupIntensity(speechCleanup?.["intensity"]),
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

export function normalizeHookOverlayForClipDuration(
  input: {
    enabled: boolean;
    text: string;
    position: string;
    startSeconds: number;
    durationSeconds: number;
    animation: string;
    size: string;
    bold: boolean;
  },
  clipDurationSeconds: number | null,
): HookOverlayVisibilityResult {
  const position: HookOverlayPosition =
    input.position === "top" || input.position === "center" || input.position === "lower"
      ? input.position
      : "top";
  const animation: HookOverlayAnimation =
    input.animation === "fade" || input.animation === "pan-in" || input.animation === "pop" || input.animation === "none"
      ? input.animation
      : "fade";
  const size: HookOverlaySize =
    input.size === "small" || input.size === "medium" || input.size === "large"
      ? input.size
      : "medium";
  const rawStartSeconds = Number.isFinite(input.startSeconds) ? input.startSeconds : 0;
  const rawDurationSeconds = Number.isFinite(input.durationSeconds) ? input.durationSeconds : 6;
  const normalizedStartSeconds = Math.max(0, rawStartSeconds);
  const normalizedDurationSeconds = Math.min(20, Math.max(1, rawDurationSeconds));
  const normalizedBase: HookOverlayConfig = {
    enabled: Boolean(input.enabled),
    text: String(input.text ?? "").trim(),
    position,
    startSeconds: normalizedStartSeconds,
    durationSeconds: normalizedDurationSeconds,
    animation,
    size,
    bold: Boolean(input.bold),
  };

  if (!normalizedBase.enabled) {
    return {
      hookOverlay: normalizedBase,
      error: null,
      wasClamped:
        normalizedStartSeconds !== input.startSeconds ||
        normalizedDurationSeconds !== input.durationSeconds,
    };
  }

  if (clipDurationSeconds === null || !Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
    return {
      hookOverlay: normalizedBase,
      error: "Set a valid clip duration before enabling the hook overlay.",
      wasClamped: false,
    };
  }

  const minimumVisibleSeconds = Math.min(1, clipDurationSeconds);
  const maxStartSeconds = Math.max(0, clipDurationSeconds - minimumVisibleSeconds);
  const startSeconds = Math.min(normalizedStartSeconds, maxStartSeconds);
  const remainingSeconds = Math.max(0, clipDurationSeconds - startSeconds);
  const durationSeconds = Math.min(normalizedDurationSeconds, remainingSeconds);

  if (durationSeconds <= 0) {
    return {
      hookOverlay: normalizedBase,
      error: "Hook timing must include a visible interval inside the current clip.",
      wasClamped: false,
    };
  }

  const hookOverlay = {
    ...normalizedBase,
    startSeconds: Number(startSeconds.toFixed(3)),
    durationSeconds: Number(durationSeconds.toFixed(3)),
  };

  return {
    hookOverlay,
    error: null,
    wasClamped:
      hookOverlay.startSeconds !== input.startSeconds ||
      hookOverlay.durationSeconds !== input.durationSeconds,
  };
}

function normalizeBrollCardTone(value: unknown): BrollCardTone {
  return value === "scripture" || value === "quote" || value === "application" || value === "context"
    ? value
    : "quote";
}

function normalizeBrollCardPosition(value: unknown): BrollCardPosition {
  return value === "full" || value === "upper" || value === "lower" ? value : "full";
}

function normalizeBrollText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

export function normalizeBrollLayerConfig(
  value: unknown,
  durationSeconds?: number | null,
): BrollLayerConfig {
  const layer = asObject(value);
  const cards = Array.isArray(layer?.["cards"]) ? layer["cards"] : [];
  const maxDuration = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : null;

  const normalizedCards = cards.flatMap((card, index): BrollCardConfig[] => {
    const record = asObject(card);
    if (!record) {
      return [];
    }

    const text = normalizeBrollText(record["text"], 180);
    if (!text) {
      return [];
    }

    const id = normalizeBrollText(record["id"], 80) || `broll-${index + 1}`;
    const rawStartSeconds = asNumber(record["startSeconds"]) ?? 0;
    const startUpperBound = maxDuration !== null ? Math.max(0, maxDuration - 0.5) : Number.POSITIVE_INFINITY;
    const startSeconds = Math.max(0, Math.min(rawStartSeconds, startUpperBound));
    const rawDurationSeconds = asNumber(record["durationSeconds"]) ?? 5;
    const remainingDuration = maxDuration !== null ? Math.max(0.5, maxDuration - startSeconds) : 12;
    const durationLimit = Math.min(12, remainingDuration);
    const durationSeconds = Math.min(durationLimit, Math.max(1, rawDurationSeconds));

    return [{
      id,
      enabled: record["enabled"] !== false,
      text,
      label: normalizeBrollText(record["label"], 32) || "Key moment",
      startSeconds: Number(startSeconds.toFixed(2)),
      durationSeconds: Number(durationSeconds.toFixed(2)),
      tone: normalizeBrollCardTone(record["tone"]),
      position: normalizeBrollCardPosition(record["position"]),
    }];
  }).slice(0, 4);

  return {
    enabled: typeof layer?.["enabled"] === "boolean" ? layer["enabled"] : normalizedCards.length > 0,
    cards: normalizedCards,
  };
}

export function extractBrollLayerConfig(
  captionData: unknown,
  durationSeconds?: number | null,
): BrollLayerConfig {
  const data = asObject(captionData);
  return normalizeBrollLayerConfig(data?.["brollLayer"], durationSeconds);
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
    titleOptions: [],
    hookOptions: [],
    ctaOptions: [],
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
  const titleOptions = asStringArray(captionPackage?.["titleOptions"]);
  const hookOptions = asStringArray(captionPackage?.["hookOptions"]);
  const ctaOptions = asStringArray(captionPackage?.["ctaOptions"]);

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
    titleOptions,
    hookOptions,
    ctaOptions,
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
