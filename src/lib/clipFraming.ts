/**
 * Clip framing presets for vertical video exports.
 *
 * Architecture note: SMART_CROP uses stored video subject tracking data when
 * available, falling back to center crop when tracking has not been prepared.
 * All current presets apply deterministic FFmpeg filters.
 */

import type { ClipExportLayoutStrategy } from "@prisma/client";

export type FramingPreset = ClipExportLayoutStrategy;

export type SmartCropPoint = {
  timeSeconds: number;
  centerX: number;
  centerY?: number;
  zoom?: number;
  confidence?: number;
  stabilized?: boolean;
  rejected?: boolean;
  frozen?: boolean;
};

export type SmartCropSafetyResult = {
  unsafe: boolean;
  reason: "NO_TRACKING" | "LATE_TRACKING_START" | "LOW_CONFIDENCE" | "UNSTABLE_TRACKING" | null;
  averageConfidence: number;
  unstableRatio: number;
};

export type EffectiveFramingDecision = {
  requestedPreset: FramingPreset;
  effectivePreset: FramingPreset;
  safety: SmartCropSafetyResult;
  fallbackApplied: boolean;
  reason: string | null;
};

const MAX_DYNAMIC_CROP_POINTS = 6;
const MIN_DYNAMIC_CROP_DELTA_PX = 12;
const MAX_DYNAMIC_CROP_EXPRESSION_LENGTH = 1200;

/**
 * The ordered list of presets a user can select in the UI.
 * SMART_CROP is available once video subject tracking is enabled.
 */
export const SELECTABLE_FRAMING_PRESETS: FramingPreset[] = [
  "CENTER_CROP",
  "LEFT_FOCUS",
  "RIGHT_FOCUS",
  "FIT_BLURRED_BACKGROUND",
  "SMART_CROP",
];

export const DEFAULT_FRAMING_PRESET: FramingPreset = "SMART_CROP";

export const FRAMING_PRESET_LABELS: Record<FramingPreset, string> = {
  CENTER_CROP: "Center",
  LEFT_FOCUS: "Left Focus",
  RIGHT_FOCUS: "Right Focus",
  FIT_BLURRED_BACKGROUND: "Fit with Blur Background",
  SMART_CROP: "Auto (Smart Crop)",
};

export const FRAMING_PRESET_DESCRIPTIONS: Record<FramingPreset, string> = {
  CENTER_CROP: "Fills the vertical frame with the video, cropped from the center.",
  LEFT_FOCUS: "Fills the vertical frame, keeping the left portion of the source video visible.",
  RIGHT_FOCUS: "Fills the vertical frame, keeping the right portion of the source video visible.",
  FIT_BLURRED_BACKGROUND: "Fits the full video within the frame with a blurred background behind it.",
  SMART_CROP: "Automatically keeps the pastor near the center using subject tracking.",
};

/**
 * Returns true when the value is a recognized FramingPreset string.
 */
export function isValidFramingPreset(value: unknown): value is FramingPreset {
  return (
    typeof value === "string" &&
    ["CENTER_CROP", "LEFT_FOCUS", "RIGHT_FOCUS", "FIT_BLURRED_BACKGROUND", "SMART_CROP"].includes(value)
  );
}

/**
 * Returns the user-selectable framing preset for a clip, falling back to the
 * default when the stored value is null, undefined, or unrecognized.
 */
export function resolveFramingPreset(value: string | null | undefined): FramingPreset {
  if (value !== null && value !== undefined && isValidFramingPreset(value)) {
    return value;
  }

  return DEFAULT_FRAMING_PRESET;
}

export function isFfmpegCropFilterFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("parsed_crop") ||
    (
      normalized.includes("crop") &&
      (
        normalized.includes("failed to configure input pad") ||
        normalized.includes("error reinitializing filters") ||
        normalized.includes("invalid argument") ||
        normalized.includes("nothing was written into output file")
      )
    )
  );
}

export function evaluateSmartCropSafety(points: SmartCropPoint[] | null | undefined): SmartCropSafetyResult {
  if (!points || points.length === 0) {
    return {
      unsafe: true,
      reason: "NO_TRACKING",
      averageConfidence: 0,
      unstableRatio: 1,
    };
  }

  const sortedPoints = points
    .filter((point) => Number.isFinite(point.timeSeconds) && Number.isFinite(point.centerX))
    .sort((left, right) => left.timeSeconds - right.timeSeconds);

  if (sortedPoints.length === 0) {
    return {
      unsafe: true,
      reason: "NO_TRACKING",
      averageConfidence: 0,
      unstableRatio: 1,
    };
  }

  const averageConfidence =
    sortedPoints.reduce((sum, point) => sum + (point.confidence ?? 0.5), 0) / sortedPoints.length;
  const unstableCount = sortedPoints.filter((point) => point.frozen || point.rejected).length;
  const unstableRatio = unstableCount / sortedPoints.length;

  if (sortedPoints[0].timeSeconds > 3) {
    return {
      unsafe: true,
      reason: "LATE_TRACKING_START",
      averageConfidence,
      unstableRatio,
    };
  }

  if (averageConfidence < 0.52) {
    return {
      unsafe: true,
      reason: "LOW_CONFIDENCE",
      averageConfidence,
      unstableRatio,
    };
  }

  if (unstableRatio > 0.35) {
    return {
      unsafe: true,
      reason: "UNSTABLE_TRACKING",
      averageConfidence,
      unstableRatio,
    };
  }

  return {
    unsafe: false,
    reason: null,
    averageConfidence,
    unstableRatio,
  };
}

export function resolveEffectiveFramingPreset(input: {
  requestedPreset: FramingPreset;
  smartCropPoints?: SmartCropPoint[] | null;
  hasManualCrop?: boolean;
}): EffectiveFramingDecision {
  const safety =
    input.requestedPreset === "SMART_CROP" && !input.hasManualCrop
      ? evaluateSmartCropSafety(input.smartCropPoints)
      : { unsafe: false, reason: null, averageConfidence: 1, unstableRatio: 0 };
  const fallbackApplied = input.requestedPreset === "SMART_CROP" && safety.unsafe;
  const effectivePreset = fallbackApplied ? "FIT_BLURRED_BACKGROUND" : input.requestedPreset;
  const reason = fallbackApplied
    ? `Auto Intelligent framing was not safe enough (${safety.reason ?? "unsafe tracking"}), so full-stage blurred framing was used.`
    : null;

  return {
    requestedPreset: input.requestedPreset,
    effectivePreset,
    safety,
    fallbackApplied,
    reason,
  };
}

export function getSmartCropFilterRiskReason(filter: string): string | null {
  const dynamicBranchCount = (filter.match(/if\(lte/g) ?? []).length;

  if (filter.length > MAX_DYNAMIC_CROP_EXPRESSION_LENGTH + 700) {
    return `filter expression is too long (${filter.length} characters)`;
  }

  if (dynamicBranchCount > MAX_DYNAMIC_CROP_POINTS) {
    return `filter expression has too many moving crop points (${dynamicBranchCount})`;
  }

  return null;
}

function toFixedNumber(value: number, digits = 3): string {
  return Number(value.toFixed(digits)).toString();
}

function escapeFfmpegExpression(value: string): string {
  return value.replace(/,/g, "\\,");
}

function toEvenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function buildDynamicCropExpression(points: Array<{ timeSeconds: number; cropX: number }>): string {
  const sortedPoints = points
    .filter((point) => Number.isFinite(point.timeSeconds) && Number.isFinite(point.cropX))
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .filter((point, index, array) => index === 0 || point.timeSeconds > array[index - 1].timeSeconds);

  if (sortedPoints.length === 0) {
    return "0";
  }

  if (sortedPoints.length === 1) {
    return String(sortedPoints[0].cropX);
  }

  let expression = String(sortedPoints[sortedPoints.length - 1].cropX);
  for (let index = sortedPoints.length - 2; index >= 0; index -= 1) {
    const current = sortedPoints[index];
    const next = sortedPoints[index + 1];
    const duration = next.timeSeconds - current.timeSeconds;
    const progress = duration > 0
      ? `min(max((t-${toFixedNumber(current.timeSeconds)})/${toFixedNumber(duration)},0),1)`
      : "0";
    const easedProgress = `(3*pow(${progress},2)-2*pow(${progress},3))`;
    const interpolation = duration > 0
      ? `(${current.cropX}+(${next.cropX - current.cropX})*${easedProgress})`
      : String(current.cropX);

    expression = `if(lte(t,${toFixedNumber(next.timeSeconds)}),${interpolation},${expression})`;
  }

  const first = sortedPoints[0];
  return `if(lte(t,${toFixedNumber(first.timeSeconds)}),${first.cropX},${expression})`;
}

function simplifyCropPoints(points: Array<{ timeSeconds: number; cropX: number }>): Array<{ timeSeconds: number; cropX: number }> {
  const orderedPoints = points
    .filter((point) => Number.isFinite(point.timeSeconds) && Number.isFinite(point.cropX))
    .sort((left, right) => left.timeSeconds - right.timeSeconds);

  if (orderedPoints.length <= 1) {
    return orderedPoints;
  }

  const dedupedByTime: Array<{ timeSeconds: number; cropX: number }> = [];
  for (const point of orderedPoints) {
    const previous = dedupedByTime[dedupedByTime.length - 1];
    if (previous && Math.abs(previous.timeSeconds - point.timeSeconds) < 0.05) {
      previous.cropX = point.cropX;
      continue;
    }
    dedupedByTime.push(point);
  }

  const meaningfulPoints: Array<{ timeSeconds: number; cropX: number }> = [];
  for (const point of dedupedByTime) {
    const previous = meaningfulPoints[meaningfulPoints.length - 1];
    if (previous && Math.abs(previous.cropX - point.cropX) < MIN_DYNAMIC_CROP_DELTA_PX) {
      continue;
    }
    meaningfulPoints.push(point);
  }

  const sourcePoints = meaningfulPoints.length > 0 ? meaningfulPoints : dedupedByTime;
  if (sourcePoints.length <= MAX_DYNAMIC_CROP_POINTS) {
    return sourcePoints;
  }

  const selected = new Map<number, { timeSeconds: number; cropX: number }>();
  const lastIndex = sourcePoints.length - 1;
  const step = lastIndex / (MAX_DYNAMIC_CROP_POINTS - 1);

  for (let index = 0; index < MAX_DYNAMIC_CROP_POINTS; index += 1) {
    const sourceIndex = Math.round(index * step);
    selected.set(sourceIndex, sourcePoints[sourceIndex]);
  }

  selected.set(0, sourcePoints[0]);
  selected.set(lastIndex, sourcePoints[lastIndex]);

  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
}

/**
 * Builds the FFmpeg -filter_complex string for vertical 9:16 (1080x1920) output.
 *
 * All filters output a [v] stream. Callers must map [v] and 0:a? separately.
 *
 * SMART_CROP uses the provided normalized subject center when available.
 */
export function buildVerticalFramingFilter(
  preset: FramingPreset,
  options?: {
    inputLabel?: string;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    subjectCenterX?: number | null;
    subjectCenterY?: number | null;
    subjectCenters?: SmartCropPoint[] | null;
    zoom?: number | null;
  },
): string {
  const inputLabel = options?.inputLabel ?? "0:v";

  switch (preset) {
    case "LEFT_FOCUS":
      // Scale to fill 1080x1920, crop from the left side (x=0).
      return `[${inputLabel}]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:0:0,setsar=1,format=yuv420p[v]`;

    case "RIGHT_FOCUS":
      // Scale to fill 1080x1920, crop from the right side (x=iw-ow).
      return `[${inputLabel}]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:iw-ow:0,setsar=1,format=yuv420p[v]`;

    case "FIT_BLURRED_BACKGROUND":
      // Scale the source to fill 1080x1920 and blur it as background.
      // Then overlay the original scaled-to-fit video centered on top.
      return (
        `[${inputLabel}]setpts=PTS-STARTPTS,split=2[base_bg][base_fg];` +
        "[base_bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:1[bg];" +
        "[base_fg]scale=1080:-2:force_original_aspect_ratio=decrease[fg];" +
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]"
      );

    case "SMART_CROP":
      if (options?.sourceWidth && options.sourceHeight && typeof options.subjectCenterX === "number") {
        const zoom = Math.max(1, Math.min(1.45, options.zoom ?? 1));
        const scale = Math.max(1080 / options.sourceWidth, 1920 / options.sourceHeight) * zoom;
        const scaledWidth = toEvenDimension(options.sourceWidth * scale);
        const scaledHeight = toEvenDimension(options.sourceHeight * scale);
        const maxX = Math.max(0, scaledWidth - 1080);
        const maxY = Math.max(0, scaledHeight - 1920);
        const centers = options.subjectCenters?.length
          ? options.subjectCenters
          : [{ timeSeconds: 0, centerX: options.subjectCenterX }];
        const cropPoints = centers.map((point) => {
          const subjectCenterX = Math.max(0, Math.min(1, point.centerX));
          const cropX = Math.max(0, Math.min(maxX, Math.round(subjectCenterX * scaledWidth - 540)));
          return {
            timeSeconds: Math.max(0, point.timeSeconds),
            cropX,
          };
        });
        const simplifiedCropPoints = simplifyCropPoints(cropPoints);
        const rawCropXExpression = simplifiedCropPoints.length > 1
          ? buildDynamicCropExpression(simplifiedCropPoints)
          : String(simplifiedCropPoints[0]?.cropX ?? 0);
        const staticCropX = String(Math.max(0, Math.min(maxX, Math.round(options.subjectCenterX * scaledWidth - 540))));
        const safeCropXExpression = rawCropXExpression.length > MAX_DYNAMIC_CROP_EXPRESSION_LENGTH
          ? staticCropX
          : rawCropXExpression;
        const cropXExpression = escapeFfmpegExpression(`min(max(${safeCropXExpression},0),${maxX})`);
        const cropY = typeof options.subjectCenterY === "number"
          ? Math.max(
              0,
              Math.min(
                maxY,
                Math.round(Math.max(0, Math.min(1, options.subjectCenterY)) * scaledHeight - 960),
              ),
            )
          : Math.max(0, Math.min(maxY, Math.round(maxY * 0.18)));

        return `[${inputLabel}]setpts=PTS-STARTPTS,scale=${scaledWidth}:${scaledHeight},crop=1080:1920:${cropXExpression}:${cropY},setsar=1,format=yuv420p[v]`;
      }

      return `[${inputLabel}]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v]`;

    case "CENTER_CROP":
    default:
      // Scale to fill 1080x1920, crop from the center (default FFmpeg crop behaviour).
      return `[${inputLabel}]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v]`;
  }
}

export const __clipFramingTestUtils = {
  simplifyCropPoints,
  buildDynamicCropExpression,
};
