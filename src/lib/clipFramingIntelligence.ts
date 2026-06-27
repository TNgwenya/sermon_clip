import type { ClipExportLayoutStrategy } from "@prisma/client";

import {
  type FramingPersonality,
  FRAMING_PERSONALITY_LABELS,
} from "@/lib/clipExportSettings";
import {
  evaluateSmartCropSafety,
  type SmartCropPoint,
  type SmartCropSafetyResult,
} from "@/lib/clipFraming";

export type ClipFramingMoment = {
  title?: string | null;
  hook?: string | null;
  transcriptText?: string | null;
  category?: string | null;
  ministryValue?: string | null;
  emotionalImpactScore?: number | null;
  hookStrengthScore?: number | null;
  shareabilityScore?: number | null;
  durationSeconds?: number | null;
};

export type IntelligentFramingDecision = {
  requestedLayout: ClipExportLayoutStrategy;
  requestedPersonality: FramingPersonality;
  resolvedPersonality: Exclude<FramingPersonality, "AUTO_INTELLIGENT">;
  shotStyle:
    | "TEACHING_MEDIUM"
    | "STATIONARY_SPEAKER_TIGHT"
    | "MOVING_SPEAKER_MEDIUM"
    | "EMOTIONAL_MEDIUM_CLOSE"
    | "HOOK_TIGHT"
    | "WORSHIP_WIDE"
    | "GROUP_STAGE"
    | "SAFE_FULL_STAGE";
  effectiveLayout: ClipExportLayoutStrategy;
  zoom: number;
  motionSmoothing: "STATIC" | "GENTLE" | "DYNAMIC";
  captionSafeArea: "STANDARD" | "RAISED" | "LOWER_MINIMAL";
  visualQualityScore: number;
  speakerVisiblePercentage: number;
  averageTrackingConfidence: number;
  cropStabilityScore: number;
  frameQualityLabel: "GOOD" | "REVIEW" | "WEAK";
  manualCropRecommended: boolean;
  fallbackApplied: boolean;
  safety: SmartCropSafetyResult;
  reasonCodes: string[];
  pastorSummary: string;
  frameQualitySummary: string;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedText(input: ClipFramingMoment): string {
  return [input.title, input.hook, input.category, input.ministryValue, input.transcriptText]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

function inferAutomaticPersonality(input: ClipFramingMoment): Exclude<FramingPersonality, "AUTO_INTELLIGENT"> {
  const text = normalizedText(input);
  const emotionalImpact = input.emotionalImpactScore ?? 0;
  const hookStrength = input.hookStrengthScore ?? 0;
  const shareability = input.shareabilityScore ?? 0;
  const durationSeconds = input.durationSeconds ?? 0;

  if (/\b(worship|praise|altar|prayer|pray|choir|song|sing|ministry|response|congregation)\b/i.test(text)) {
    return "WORSHIP_WIDE";
  }

  if (emotionalImpact >= 8 || /\b(testimony|heart|healed|cry|grace|mercy|forgive|broken|restored)\b/i.test(text)) {
    return "CINEMATIC_CLOSE";
  }

  if ((hookStrength >= 8 || shareability >= 8) && durationSeconds <= 90) {
    return "SOCIAL_PUNCHY";
  }

  return "SPEAKER_FOCUS";
}

function trackingStats(points: SmartCropPoint[] | null | undefined): {
  averageConfidence: number;
  maxJump: number;
  movement: number;
  rejectedRatio: number;
  pointCount: number;
} {
  const sorted = (points ?? [])
    .filter((point) => Number.isFinite(point.timeSeconds) && Number.isFinite(point.centerX))
    .sort((left, right) => left.timeSeconds - right.timeSeconds);

  if (sorted.length === 0) {
    return {
      averageConfidence: 0,
      maxJump: 1,
      movement: 1,
      rejectedRatio: 1,
      pointCount: 0,
    };
  }

  const jumps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    jumps.push(Math.abs(sorted[index].centerX - sorted[index - 1].centerX));
  }

  return {
    averageConfidence: average(sorted.map((point) => point.confidence ?? 0.5)),
    maxJump: jumps.length > 0 ? Math.max(...jumps) : 0,
    movement: average(jumps),
    rejectedRatio: sorted.filter((point) => point.rejected || point.frozen).length / sorted.length,
    pointCount: sorted.length,
  };
}

function inferShotStyle(input: {
  personality: Exclude<FramingPersonality, "AUTO_INTELLIGENT">;
  moment: ClipFramingMoment;
  stats: ReturnType<typeof trackingStats>;
}): IntelligentFramingDecision["shotStyle"] {
  const text = normalizedText(input.moment);
  const emotionalImpact = input.moment.emotionalImpactScore ?? 0;
  const hookStrength = input.moment.hookStrengthScore ?? 0;
  const shareability = input.moment.shareabilityScore ?? 0;
  const durationSeconds = input.moment.durationSeconds ?? 0;
  const moving = input.stats.movement >= 0.035 || input.stats.maxJump >= 0.1;

  if (input.personality === "SAFE_FULL_STAGE") {
    return "SAFE_FULL_STAGE";
  }

  if (input.personality === "WORSHIP_WIDE" || /\b(worship|praise|choir|song|sing|altar|response)\b/i.test(text)) {
    return "WORSHIP_WIDE";
  }

  if (/\b(team|group|people join|congregation|ministry line|prayer line|join the stage|on stage together)\b/i.test(text)) {
    return "GROUP_STAGE";
  }

  if (input.personality === "CINEMATIC_CLOSE" || emotionalImpact >= 8) {
    return moving ? "MOVING_SPEAKER_MEDIUM" : "EMOTIONAL_MEDIUM_CLOSE";
  }

  if (input.personality === "SOCIAL_PUNCHY" || ((hookStrength >= 8 || shareability >= 8) && durationSeconds <= 90)) {
    return moving ? "MOVING_SPEAKER_MEDIUM" : "HOOK_TIGHT";
  }

  if (moving) {
    return "MOVING_SPEAKER_MEDIUM";
  }

  if (input.stats.movement <= 0.012 && input.stats.maxJump <= 0.04) {
    return "STATIONARY_SPEAKER_TIGHT";
  }

  return "TEACHING_MEDIUM";
}

function zoomForShotStyle(input: {
  shotStyle: IntelligentFramingDecision["shotStyle"];
  stats: ReturnType<typeof trackingStats>;
  hasManualCrop: boolean;
}): number {
  const baseZoomByShot: Record<IntelligentFramingDecision["shotStyle"], number> = {
    TEACHING_MEDIUM: 1.1,
    STATIONARY_SPEAKER_TIGHT: 1.16,
    MOVING_SPEAKER_MEDIUM: 1.06,
    EMOTIONAL_MEDIUM_CLOSE: 1.2,
    HOOK_TIGHT: 1.18,
    WORSHIP_WIDE: 1,
    GROUP_STAGE: 1,
    SAFE_FULL_STAGE: 1,
  };

  let zoom = baseZoomByShot[input.shotStyle];

  if (!input.hasManualCrop) {
    if (input.stats.movement >= 0.05 || input.stats.maxJump >= 0.12) {
      zoom -= 0.05;
    }
    if (input.stats.averageConfidence > 0 && input.stats.averageConfidence < 0.65) {
      zoom -= 0.04;
    }
    if (input.stats.rejectedRatio > 0.2) {
      zoom -= 0.04;
    }
  }

  return clamp(zoom, 1, 1.22);
}

function frameQualityLabel(score: number): IntelligentFramingDecision["frameQualityLabel"] {
  if (score >= 7.8) {
    return "GOOD";
  }
  if (score >= 6.5) {
    return "REVIEW";
  }
  return "WEAK";
}

function frameQualitySummary(input: {
  label: IntelligentFramingDecision["frameQualityLabel"];
  effectiveLayout: ClipExportLayoutStrategy;
  shotStyle: IntelligentFramingDecision["shotStyle"];
  speakerVisiblePercentage: number;
  cropStabilityScore: number;
  averageTrackingConfidence: number;
  manualCropRecommended: boolean;
}): string {
  if (input.label === "GOOD") {
    return `Frame quality: Good. Pastor centered, ${input.speakerVisiblePercentage.toFixed(0)}% visibility, no major crop instability.`;
  }

  if (input.manualCropRecommended) {
    const reason =
      input.effectiveLayout === "FIT_BLURRED_BACKGROUND"
        ? "safe full-stage fallback is being used"
        : input.averageTrackingConfidence < 0.6
          ? "tracking confidence is low"
          : input.cropStabilityScore < 6.5
            ? "crop motion may feel unstable"
            : "pastor visibility needs review";
    return `Manual crop recommended: ${reason}.`;
  }

  return `Frame quality: Review. ${input.shotStyle.toLowerCase().replace(/_/g, " ")} framing is usable but may need a pastor check.`;
}

export function resolveIntelligentFramingDecision(input: {
  requestedLayout: ClipExportLayoutStrategy;
  requestedPersonality?: FramingPersonality | null;
  smartCropPoints?: SmartCropPoint[] | null;
  hasManualCrop?: boolean;
  moment?: ClipFramingMoment;
}): IntelligentFramingDecision {
  const requestedPersonality = input.requestedPersonality ?? "AUTO_INTELLIGENT";
  const resolvedPersonality =
    requestedPersonality === "AUTO_INTELLIGENT"
      ? inferAutomaticPersonality(input.moment ?? {})
      : requestedPersonality;
  const reasonCodes: string[] = [`PERSONALITY_${resolvedPersonality}`];
  const stats = trackingStats(input.smartCropPoints);
  const shotStyle = inferShotStyle({
    personality: resolvedPersonality,
    moment: input.moment ?? {},
    stats,
  });
  reasonCodes.push(`SHOT_${shotStyle}`);
  const safety =
    input.requestedLayout === "SMART_CROP" && !input.hasManualCrop
      ? evaluateSmartCropSafety(input.smartCropPoints)
      : { unsafe: false, reason: null, averageConfidence: 1, unstableRatio: 0 };

  let effectiveLayout = input.requestedLayout;
  if (shotStyle === "SAFE_FULL_STAGE" || shotStyle === "WORSHIP_WIDE" || shotStyle === "GROUP_STAGE") {
    effectiveLayout = "FIT_BLURRED_BACKGROUND";
    reasonCodes.push(
      shotStyle === "SAFE_FULL_STAGE"
        ? "SAFE_FULL_STAGE_SELECTED"
        : shotStyle === "GROUP_STAGE"
          ? "GROUP_STAGE_CONTEXT"
          : "WORSHIP_STAGE_CONTEXT",
    );
  } else if (input.requestedLayout === "SMART_CROP" && safety.unsafe && !input.hasManualCrop) {
    effectiveLayout = "FIT_BLURRED_BACKGROUND";
    reasonCodes.push(`SMART_CROP_FALLBACK_${safety.reason ?? "UNSAFE"}`);
  }

  const zoom = effectiveLayout === "SMART_CROP"
    ? zoomForShotStyle({ shotStyle, stats, hasManualCrop: Boolean(input.hasManualCrop) })
    : 1;
  const motionSmoothing =
    stats.movement >= 0.05 || stats.maxJump >= 0.12
      ? "DYNAMIC"
      : stats.movement >= 0.018
        ? "GENTLE"
        : "STATIC";
  const captionSafeArea =
    zoom >= 1.14 || shotStyle === "EMOTIONAL_MEDIUM_CLOSE" || shotStyle === "HOOK_TIGHT"
      ? "RAISED"
      : shotStyle === "WORSHIP_WIDE" || shotStyle === "GROUP_STAGE"
        ? "LOWER_MINIMAL"
        : "STANDARD";
  const cropStabilityScore = clamp(10 - stats.maxJump * 18 - stats.rejectedRatio * 3, 0, 10);
  const speakerVisiblePercentage = effectiveLayout === "SMART_CROP"
    ? clamp(72 + (zoom - 1) * 28, 68, 88)
    : 100;
  const visualQualityScore = clamp(
    (stats.averageConfidence * 5.5) +
      (cropStabilityScore * 0.35) +
      (effectiveLayout === "SMART_CROP" ? 1.1 : 0.35) +
      (input.hasManualCrop ? 0.4 : 0),
    0,
    10,
  );
  const fallbackApplied = input.requestedLayout !== effectiveLayout;
  const qualityLabel = frameQualityLabel(visualQualityScore);
  const manualCropRecommended =
    qualityLabel === "WEAK" ||
    (effectiveLayout === "FIT_BLURRED_BACKGROUND" && shotStyle !== "WORSHIP_WIDE" && shotStyle !== "GROUP_STAGE" && shotStyle !== "SAFE_FULL_STAGE") ||
    (effectiveLayout === "SMART_CROP" && (speakerVisiblePercentage < 70 || cropStabilityScore < 6.5 || stats.averageConfidence < 0.58));
  const pastorSummary =
    effectiveLayout === "SMART_CROP"
      ? `${FRAMING_PERSONALITY_LABELS[resolvedPersonality]} uses ${shotStyle.toLowerCase().replace(/_/g, " ")} at ${zoom.toFixed(2)}x with ${motionSmoothing.toLowerCase()} crop motion.`
      : `${FRAMING_PERSONALITY_LABELS[resolvedPersonality]} keeps the full stage visible for ${shotStyle.toLowerCase().replace(/_/g, " ")}.`;
  const qualitySummary = frameQualitySummary({
    label: qualityLabel,
    effectiveLayout,
    shotStyle,
    speakerVisiblePercentage,
    cropStabilityScore,
    averageTrackingConfidence: stats.averageConfidence,
    manualCropRecommended,
  });

  return {
    requestedLayout: input.requestedLayout,
    requestedPersonality,
    resolvedPersonality,
    shotStyle,
    effectiveLayout,
    zoom,
    motionSmoothing,
    captionSafeArea,
    visualQualityScore: Number(visualQualityScore.toFixed(2)),
    speakerVisiblePercentage: Number(speakerVisiblePercentage.toFixed(1)),
    averageTrackingConfidence: Number(stats.averageConfidence.toFixed(2)),
    cropStabilityScore: Number(cropStabilityScore.toFixed(2)),
    frameQualityLabel: qualityLabel,
    manualCropRecommended,
    fallbackApplied,
    safety,
    reasonCodes,
    pastorSummary,
    frameQualitySummary: qualitySummary,
  };
}
