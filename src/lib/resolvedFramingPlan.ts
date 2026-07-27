import type { ClipExportLayoutStrategy, VideoSubjectTrackingSource } from "@prisma/client";

import type { FramingPersonality } from "@/lib/clipExportSettings";
import {
  resolveIntelligentFramingDecision,
  type ClipFramingMoment,
  type IntelligentFramingDecision,
} from "@/lib/clipFramingIntelligence";
import type { FramingTreatment } from "@/lib/clipFraming";
import type { ManualCropKeyframe } from "@/lib/manualCrop";

export const RESOLVED_FRAMING_PLAN_SCHEMA_VERSION = 1 as const;
export const RESOLVED_FRAMING_MASTER_WIDTH = 1080;
export const RESOLVED_FRAMING_MASTER_HEIGHT = 1920;
export const MAX_RESOLVED_FRAMING_TIMELINE_POINTS = 48;

export type ResolvedFramingPlanStatus = "READY" | "FALLBACK" | "PASSTHROUGH";
export type ResolvedFramingTrackingStatus =
  | "MANUAL"
  | "MODEL"
  | "HEURISTIC"
  | "UNAVAILABLE";
export type ResolvedFramingSourceRole =
  | "ORIGINAL_SOURCE"
  | "CANONICAL_PORTRAIT_MASTER"
  | "PREPARED_DERIVATIVE";
export type ResolvedFramingApplicationMode =
  | "APPLY_AT_BASE_RENDER"
  | "APPLY_TO_ORIGINAL_EXPORT"
  | "PASSTHROUGH_EXISTING_MASTER";

export type ResolvedFramingTimelinePoint = {
  timeSeconds: number;
  centerX: number;
  centerY: number;
  zoom: number;
  confidence: number;
  sceneId: string;
  stabilized: boolean;
  rejected: boolean;
  frozen: boolean;
};

export type ResolvedFramingSafeBounds = {
  minCenterX: number;
  maxCenterX: number;
  minCenterY: number;
  maxCenterY: number;
  minZoom: number;
  maxZoom: number;
};

export type ResolvedFramingPlanDocument = {
  schemaVersion: typeof RESOLVED_FRAMING_PLAN_SCHEMA_VERSION;
  identity: {
    clipCandidateId: string;
    editPlanId: string;
    editPlanHash: string;
  };
  requested: {
    layout: ClipExportLayoutStrategy;
    personality: FramingPersonality;
  };
  effective: {
    layout: ClipExportLayoutStrategy;
    personality: FramingPersonality;
    resolvedPersonality: Exclude<FramingPersonality, "AUTO_INTELLIGENT">;
    treatment: FramingTreatment;
    shotStyle: IntelligentFramingDecision["shotStyle"];
    zoom: number;
    motionSmoothing: IntelligentFramingDecision["motionSmoothing"];
    captionSafeArea: IntelligentFramingDecision["captionSafeArea"];
  };
  geometry: {
    source: {
      width: number;
      height: number;
      aspectRatio: number;
      role: ResolvedFramingSourceRole;
      alreadyPortrait: boolean;
      alreadyFramed: boolean;
    };
    master: {
      width: typeof RESOLVED_FRAMING_MASTER_WIDTH;
      height: typeof RESOLVED_FRAMING_MASTER_HEIGHT;
      aspectRatio: number;
    };
    safeBounds: ResolvedFramingSafeBounds;
  };
  tracking: {
    status: ResolvedFramingTrackingStatus;
    source: VideoSubjectTrackingSource | "MANUAL" | null;
    sampleCount: number;
    boundedPointCount: number;
    averageConfidence: number;
    timeline: ResolvedFramingTimelinePoint[];
  };
  application: {
    mode: ResolvedFramingApplicationMode;
    framingAlreadyApplied: boolean;
    preventDoubleApplication: true;
  };
  resolution: {
    status: ResolvedFramingPlanStatus;
    fallbackApplied: boolean;
    fallbackCode: string | null;
    fallbackReason: string | null;
    reasonCodes: string[];
    summary: string;
  };
  quality: {
    visualQualityScore: number;
    speakerVisiblePercentage: number;
    averageTrackingConfidence: number;
    cropStabilityScore: number;
    frameQualityLabel: IntelligentFramingDecision["frameQualityLabel"];
    manualCropRecommended: boolean;
    frameQualitySummary: string;
  };
};

export type ResolvedFramingTrackingPointInput = {
  timeSeconds: number;
  centerX: number;
  centerY?: number;
  zoom?: number;
  confidence?: number;
  sceneId?: string | number | null;
  sceneCut?: boolean;
  stabilized?: boolean;
  rejected?: boolean;
  frozen?: boolean;
};

export type BuildResolvedFramingPlanInput = {
  clipCandidateId: string;
  editPlanId: string;
  editPlanHash: string;
  requestedLayout: ClipExportLayoutStrategy;
  requestedPersonality: FramingPersonality;
  sourceGeometry: {
    width: number;
    height: number;
    role: ResolvedFramingSourceRole;
    alreadyFramed?: boolean;
  };
  applicationMode?: Exclude<ResolvedFramingApplicationMode, "PASSTHROUGH_EXISTING_MASTER">;
  trackingSource?: VideoSubjectTrackingSource | null;
  trackingPoints?: ResolvedFramingTrackingPointInput[];
  manualCropKeyframes?: ManualCropKeyframe[];
  moment?: ClipFramingMoment;
};

export type ResolvedFramingPlanConsumption = {
  layout: ClipExportLayoutStrategy;
  treatment: FramingTreatment;
  smartCrop: ReturnType<typeof resolvedFramingPlanToSmartCropOptions>;
  shouldApplyFraming: boolean;
  framingAlreadyApplied: boolean;
  preserveWithSafeFit: boolean;
  reason: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function isPortraitMaster(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }
  const aspectRatio = width / height;
  const masterAspectRatio = RESOLVED_FRAMING_MASTER_WIDTH / RESOLVED_FRAMING_MASTER_HEIGHT;
  return height > width && Math.abs(aspectRatio - masterAspectRatio) <= 0.025;
}

export function calculateResolvedFramingSafeBounds(input: {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth?: number;
  outputHeight?: number;
  zoom: number;
}): ResolvedFramingSafeBounds {
  const sourceWidth = Math.max(2, input.sourceWidth);
  const sourceHeight = Math.max(2, input.sourceHeight);
  const outputWidth = Math.max(2, input.outputWidth ?? RESOLVED_FRAMING_MASTER_WIDTH);
  const outputHeight = Math.max(2, input.outputHeight ?? RESOLVED_FRAMING_MASTER_HEIGHT);
  const zoom = clamp(input.zoom, 1, 1.45);
  const scale = Math.max(outputWidth / sourceWidth, outputHeight / sourceHeight) * zoom;
  const visibleWidthRatio = clamp(outputWidth / (sourceWidth * scale), 0, 1);
  const visibleHeightRatio = clamp(outputHeight / (sourceHeight * scale), 0, 1);
  const halfVisibleWidth = visibleWidthRatio / 2;
  const halfVisibleHeight = visibleHeightRatio / 2;

  return {
    minCenterX: round(halfVisibleWidth),
    maxCenterX: round(1 - halfVisibleWidth),
    minCenterY: round(halfVisibleHeight),
    maxCenterY: round(1 - halfVisibleHeight),
    minZoom: 1,
    maxZoom: 1.45,
  };
}

function inferSceneIds(points: ResolvedFramingTrackingPointInput[]): Array<ResolvedFramingTrackingPointInput & { sceneId: string }> {
  let inferredScene = 1;
  return points.map((point, index) => {
    const previous = points[index - 1];
    const explicitSceneId = point.sceneId === null || point.sceneId === undefined
      ? null
      : String(point.sceneId);
    if (explicitSceneId) {
      return { ...point, sceneId: explicitSceneId };
    }

    const centerY = point.centerY ?? 0.45;
    const previousCenterY = previous?.centerY ?? 0.45;
    const largeFrameJump = previous
      ? Math.abs(point.centerX - previous.centerX) >= 0.42
        || Math.abs(centerY - previousCenterY) >= 0.34
      : false;
    const longGap = previous ? point.timeSeconds - previous.timeSeconds >= 7 : false;
    if (index > 0 && (point.sceneCut || (largeFrameJump && longGap))) {
      inferredScene += 1;
    }

    return { ...point, sceneId: `scene-${inferredScene}` };
  });
}

function selectBoundedTimelinePoints(
  points: Array<ResolvedFramingTrackingPointInput & { sceneId: string }>,
): Array<ResolvedFramingTrackingPointInput & { sceneId: string }> {
  if (points.length <= MAX_RESOLVED_FRAMING_TIMELINE_POINTS) {
    return points;
  }

  const requiredIndexes = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].sceneId !== points[index - 1].sceneId) {
      requiredIndexes.add(index - 1);
      requiredIndexes.add(index);
    }
  }

  const remainingSlots = Math.max(0, MAX_RESOLVED_FRAMING_TIMELINE_POINTS - requiredIndexes.size);
  if (remainingSlots > 0) {
    const step = (points.length - 1) / (remainingSlots + 1);
    for (let index = 1; index <= remainingSlots; index += 1) {
      requiredIndexes.add(Math.round(step * index));
    }
  }

  return [...requiredIndexes]
    .sort((left, right) => left - right)
    .slice(0, MAX_RESOLVED_FRAMING_TIMELINE_POINTS)
    .map((index) => points[index]);
}

export function smoothResolvedFramingTimeline(input: {
  points: ResolvedFramingTrackingPointInput[];
  safeBounds: ResolvedFramingSafeBounds;
  defaultZoom: number;
  motionSmoothing: IntelligentFramingDecision["motionSmoothing"];
}): ResolvedFramingTimelinePoint[] {
  const sorted = input.points
    .filter(
      (point) =>
        Number.isFinite(point.timeSeconds)
        && Number.isFinite(point.centerX),
    )
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .filter((point, index, points) => index === 0 || point.timeSeconds > points[index - 1].timeSeconds);
  const bounded = selectBoundedTimelinePoints(inferSceneIds(sorted));
  const smoothingAlpha = input.motionSmoothing === "DYNAMIC"
    ? 0.46
    : input.motionSmoothing === "GENTLE"
      ? 0.32
      : 0.22;
  const result: ResolvedFramingTimelinePoint[] = [];

  for (const point of bounded) {
    const previous = result.at(-1);
    const sameScene = previous?.sceneId === point.sceneId;
    const rawCenterX = clamp(
      point.centerX,
      input.safeBounds.minCenterX,
      input.safeBounds.maxCenterX,
    );
    const rawCenterY = clamp(
      point.centerY ?? previous?.centerY ?? 0.44,
      input.safeBounds.minCenterY,
      input.safeBounds.maxCenterY,
    );
    const zoom = clamp(
      point.zoom ?? input.defaultZoom,
      input.safeBounds.minZoom,
      input.safeBounds.maxZoom,
    );
    const deltaSeconds = sameScene && previous
      ? Math.max(0.1, point.timeSeconds - previous.timeSeconds)
      : 0;
    const maxXStep = Math.min(0.18, 0.035 + deltaSeconds * 0.06);
    const maxYStep = Math.min(0.12, 0.025 + deltaSeconds * 0.04);

    let centerX = rawCenterX;
    let centerY = rawCenterY;
    let stabilized = Boolean(point.stabilized);
    if (sameScene && previous) {
      const blendedX = previous.centerX + (rawCenterX - previous.centerX) * smoothingAlpha;
      const blendedY = previous.centerY + (rawCenterY - previous.centerY) * smoothingAlpha;
      centerX = clamp(
        blendedX,
        previous.centerX - maxXStep,
        previous.centerX + maxXStep,
      );
      centerY = clamp(
        blendedY,
        previous.centerY - maxYStep,
        previous.centerY + maxYStep,
      );
      stabilized = stabilized
        || Math.abs(centerX - rawCenterX) >= 0.002
        || Math.abs(centerY - rawCenterY) >= 0.002;
    }

    result.push({
      timeSeconds: round(Math.max(0, point.timeSeconds), 2),
      centerX: round(clamp(centerX, input.safeBounds.minCenterX, input.safeBounds.maxCenterX)),
      centerY: round(clamp(centerY, input.safeBounds.minCenterY, input.safeBounds.maxCenterY)),
      zoom: round(zoom, 3),
      confidence: round(clamp(point.confidence ?? 0.5, 0, 1), 3),
      sceneId: point.sceneId,
      stabilized,
      rejected: Boolean(point.rejected),
      frozen: Boolean(point.frozen),
    });
  }

  return result;
}

function manualPoints(keyframes: ManualCropKeyframe[]): ResolvedFramingTrackingPointInput[] {
  return keyframes.map((keyframe) => ({
    timeSeconds: keyframe.timeSeconds,
    centerX: keyframe.centerX,
    centerY: keyframe.centerY ?? 0.44,
    zoom: keyframe.zoom,
    confidence: 1,
    sceneId: "manual",
  }));
}

function fallbackReason(code: string): string {
  if (code === "ALREADY_FRAMED_MASTER") {
    return "The input is already a portrait/framed master, so framing is passed through instead of being applied twice.";
  }
  if (code === "MODEL_TRACKING_UNAVAILABLE") {
    return "Reliable subject or speaker tracking was unavailable, so the full-stage blurred layout is used.";
  }
  if (code === "TRACKING_UNSAFE") {
    return "Subject tracking did not meet the confidence and stability guardrails, so the full-stage blurred layout is used.";
  }
  return "The requested framing could not be applied safely, so a full-stage layout is used.";
}

function resolveFramingTreatment(input: {
  requestedLayout: ClipExportLayoutStrategy;
  requestedPersonality: FramingPersonality;
  resolvedPersonality: Exclude<FramingPersonality, "AUTO_INTELLIGENT">;
  effectiveLayout: ClipExportLayoutStrategy;
  passthrough: boolean;
  fallbackApplied: boolean;
}): FramingTreatment {
  if (input.passthrough) {
    return "PASSTHROUGH";
  }
  if (input.effectiveLayout === "LEFT_FOCUS") {
    return "LEFT_FOCUS";
  }
  if (input.effectiveLayout === "RIGHT_FOCUS") {
    return "RIGHT_FOCUS";
  }
  if (input.effectiveLayout === "CENTER_CROP") {
    return "CENTER_CROP";
  }
  if (input.effectiveLayout === "FIT_BLURRED_BACKGROUND") {
    if (!input.fallbackApplied && input.resolvedPersonality === "WORSHIP_WIDE") {
      return "WORSHIP_WIDE";
    }
    if (!input.fallbackApplied && input.resolvedPersonality === "SAFE_FULL_STAGE") {
      return "FULL_STAGE";
    }
    return "BLURRED_BACKGROUND";
  }
  if (input.requestedPersonality === "AUTO_INTELLIGENT") {
    return "AUTO_CONTEXTUAL";
  }
  if (input.resolvedPersonality === "CINEMATIC_CLOSE") {
    return "CINEMATIC_CLOSE";
  }
  if (input.resolvedPersonality === "SOCIAL_PUNCHY") {
    return "SOCIAL_PUNCHY";
  }
  return "SPEAKER_FOCUS";
}

export function buildResolvedFramingPlanDocument(
  input: BuildResolvedFramingPlanInput,
): ResolvedFramingPlanDocument {
  const width = Math.max(2, Math.round(input.sourceGeometry.width));
  const height = Math.max(2, Math.round(input.sourceGeometry.height));
  const sourceAlreadyPortrait = isPortraitMaster(width, height);
  const sourceAlreadyFramed = Boolean(input.sourceGeometry.alreadyFramed)
    || input.sourceGeometry.role !== "ORIGINAL_SOURCE";
  const keyframes = input.manualCropKeyframes ?? [];
  const rawTrackingPoints = keyframes.length > 0
    ? manualPoints(keyframes)
    : input.trackingPoints ?? [];
  const trackingStatus: ResolvedFramingTrackingStatus = keyframes.length > 0
    ? "MANUAL"
    : input.trackingSource === "MODEL" && rawTrackingPoints.length > 0
      ? "MODEL"
      : input.trackingSource === "HEURISTIC_CENTER" && rawTrackingPoints.length > 0
        ? "HEURISTIC"
        : "UNAVAILABLE";
  const hasReliableTracking = trackingStatus === "MANUAL" || trackingStatus === "MODEL";
  const preliminaryDecision = resolveIntelligentFramingDecision({
    requestedLayout: input.requestedLayout,
    requestedPersonality: input.requestedPersonality,
    smartCropPoints: rawTrackingPoints,
    hasManualCrop: keyframes.length > 0,
    moment: input.moment,
  });

  let effectiveLayout = preliminaryDecision.effectiveLayout;
  let applicationMode: ResolvedFramingApplicationMode =
    input.applicationMode ?? "APPLY_AT_BASE_RENDER";
  let status: ResolvedFramingPlanStatus = "READY";
  let fallbackApplied = false;
  let fallbackCode: string | null = null;
  let reasonCodes = [...preliminaryDecision.reasonCodes];

  if (sourceAlreadyFramed) {
    effectiveLayout = "CENTER_CROP";
    applicationMode = "PASSTHROUGH_EXISTING_MASTER";
    status = "PASSTHROUGH";
    fallbackCode = "ALREADY_FRAMED_MASTER";
    reasonCodes = [...reasonCodes, fallbackCode];
  } else if (
    input.requestedLayout === "SMART_CROP"
    && !hasReliableTracking
  ) {
    effectiveLayout = "FIT_BLURRED_BACKGROUND";
    status = "FALLBACK";
    fallbackApplied = true;
    fallbackCode = "MODEL_TRACKING_UNAVAILABLE";
    reasonCodes = [...reasonCodes, fallbackCode];
  } else if (
    input.requestedLayout === "SMART_CROP"
    && preliminaryDecision.effectiveLayout === "FIT_BLURRED_BACKGROUND"
    && preliminaryDecision.safety.unsafe
    && ![
      "WORSHIP_WIDE",
      "GROUP_STAGE",
      "SAFE_FULL_STAGE",
    ].includes(preliminaryDecision.shotStyle)
  ) {
    status = "FALLBACK";
    fallbackApplied = true;
    fallbackCode = "TRACKING_UNSAFE";
    reasonCodes = [...reasonCodes, fallbackCode];
  }

  const effectiveZoom = effectiveLayout === "SMART_CROP"
    ? input.requestedPersonality === "AUTO_INTELLIGENT"
      ? clamp(preliminaryDecision.zoom - 0.025, 1, 1.22)
      : preliminaryDecision.zoom
    : 1;
  const treatment = resolveFramingTreatment({
    requestedLayout: input.requestedLayout,
    requestedPersonality: input.requestedPersonality,
    resolvedPersonality: preliminaryDecision.resolvedPersonality,
    effectiveLayout,
    passthrough: applicationMode === "PASSTHROUGH_EXISTING_MASTER",
    fallbackApplied,
  });
  const safeBounds = calculateResolvedFramingSafeBounds({
    sourceWidth: width,
    sourceHeight: height,
    zoom: effectiveZoom,
  });
  const timeline = effectiveLayout === "SMART_CROP"
    ? smoothResolvedFramingTimeline({
        points: rawTrackingPoints,
        safeBounds,
        defaultZoom: effectiveZoom,
        motionSmoothing: preliminaryDecision.motionSmoothing,
      })
    : [];
  const fallbackMessage = fallbackCode ? fallbackReason(fallbackCode) : null;
  const summary = fallbackMessage
    ?? (status === "PASSTHROUGH"
      ? fallbackReason("ALREADY_FRAMED_MASTER")
      : preliminaryDecision.pastorSummary);

  return {
    schemaVersion: RESOLVED_FRAMING_PLAN_SCHEMA_VERSION,
    identity: {
      clipCandidateId: input.clipCandidateId,
      editPlanId: input.editPlanId,
      editPlanHash: input.editPlanHash,
    },
    requested: {
      layout: input.requestedLayout,
      personality: input.requestedPersonality,
    },
    effective: {
      layout: effectiveLayout,
      personality: input.requestedPersonality,
      resolvedPersonality: preliminaryDecision.resolvedPersonality,
      treatment,
      shotStyle: preliminaryDecision.shotStyle,
      zoom: round(effectiveZoom, 3),
      motionSmoothing: preliminaryDecision.motionSmoothing,
      captionSafeArea: preliminaryDecision.captionSafeArea,
    },
    geometry: {
      source: {
        width,
        height,
        aspectRatio: round(width / height, 6),
        role: input.sourceGeometry.role,
        alreadyPortrait: sourceAlreadyPortrait,
        alreadyFramed: sourceAlreadyFramed,
      },
      master: {
        width: RESOLVED_FRAMING_MASTER_WIDTH,
        height: RESOLVED_FRAMING_MASTER_HEIGHT,
        aspectRatio: round(
          RESOLVED_FRAMING_MASTER_WIDTH / RESOLVED_FRAMING_MASTER_HEIGHT,
          6,
        ),
      },
      safeBounds,
    },
    tracking: {
      status: trackingStatus,
      source: keyframes.length > 0 ? "MANUAL" : input.trackingSource ?? null,
      sampleCount: rawTrackingPoints.length,
      boundedPointCount: timeline.length,
      averageConfidence: preliminaryDecision.averageTrackingConfidence,
      timeline,
    },
    application: {
      mode: applicationMode,
      framingAlreadyApplied: applicationMode === "PASSTHROUGH_EXISTING_MASTER",
      preventDoubleApplication: true,
    },
    resolution: {
      status,
      fallbackApplied,
      fallbackCode,
      fallbackReason: fallbackMessage,
      reasonCodes,
      summary,
    },
    quality: {
      visualQualityScore: preliminaryDecision.visualQualityScore,
      speakerVisiblePercentage: effectiveLayout === "SMART_CROP"
        ? preliminaryDecision.speakerVisiblePercentage
        : 100,
      averageTrackingConfidence: preliminaryDecision.averageTrackingConfidence,
      cropStabilityScore: preliminaryDecision.cropStabilityScore,
      frameQualityLabel: preliminaryDecision.frameQualityLabel,
      manualCropRecommended: preliminaryDecision.manualCropRecommended,
      frameQualitySummary: preliminaryDecision.frameQualitySummary,
    },
  };
}

export function resolvedFramingPlanToSmartCropOptions(
  plan: ResolvedFramingPlanDocument,
): {
  sourceWidth: number;
  sourceHeight: number;
  subjectCenterX: number;
  subjectCenterY: number;
  zoom: number;
  subjectCenters: ResolvedFramingTimelinePoint[];
  treatment: FramingTreatment;
} | null {
  if (
    plan.effective.layout !== "SMART_CROP"
    || plan.application.mode === "PASSTHROUGH_EXISTING_MASTER"
    || plan.tracking.timeline.length === 0
  ) {
    return null;
  }

  const first = plan.tracking.timeline[0];
  return {
    sourceWidth: plan.geometry.source.width,
    sourceHeight: plan.geometry.source.height,
    subjectCenterX: first.centerX,
    subjectCenterY: first.centerY,
    zoom: plan.effective.zoom,
    subjectCenters: plan.tracking.timeline,
    treatment: plan.effective.treatment,
  };
}

export function shouldApplyResolvedFramingPlan(
  plan: ResolvedFramingPlanDocument,
): boolean {
  return plan.application.mode !== "PASSTHROUGH_EXISTING_MASTER";
}

export function resolveResolvedFramingPlanConsumption(input: {
  plan: ResolvedFramingPlanDocument;
  sourceRole: ResolvedFramingSourceRole;
  outputWidth: number;
  outputHeight: number;
}): ResolvedFramingPlanConsumption {
  const preparedSource = input.sourceRole !== "ORIGINAL_SOURCE";
  const outputIsCanonicalPortrait =
    input.outputWidth === input.plan.geometry.master.width
    && input.outputHeight === input.plan.geometry.master.height;

  if (
    preparedSource
    || input.plan.application.mode === "PASSTHROUGH_EXISTING_MASTER"
  ) {
    if (outputIsCanonicalPortrait) {
      return {
        layout: "CENTER_CROP",
        treatment: "PASSTHROUGH",
        smartCrop: null,
        shouldApplyFraming: false,
        framingAlreadyApplied: true,
        preserveWithSafeFit: false,
        reason: "The prepared portrait master already contains the canonical framing plan.",
      };
    }

    return {
      layout: "FIT_BLURRED_BACKGROUND",
      treatment: "BLURRED_BACKGROUND",
      smartCrop: null,
      shouldApplyFraming: false,
      framingAlreadyApplied: true,
      preserveWithSafeFit: true,
      reason: "The prepared master is fitted without recropping so captions, overlays, and canonical framing remain intact.",
    };
  }

  return {
    layout: input.plan.effective.layout,
    treatment: input.plan.effective.treatment,
    smartCrop: resolvedFramingPlanToSmartCropOptions(input.plan),
    shouldApplyFraming: true,
    framingAlreadyApplied: false,
    preserveWithSafeFit: false,
    reason: "Canonical framing is applied once to the original source.",
  };
}
