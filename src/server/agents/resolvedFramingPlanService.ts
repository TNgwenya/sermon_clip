import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveExportSettings } from "@/lib/clipExportSettings";
import { normalizeManualCropKeyframes } from "@/lib/manualCrop";
import {
  buildResolvedFramingPlanDocument,
  RESOLVED_FRAMING_PLAN_SCHEMA_VERSION,
  type ResolvedFramingApplicationMode,
  type ResolvedFramingPlanDocument,
} from "@/lib/resolvedFramingPlan";
import type { ClipEditPlanGuard } from "@/server/agents/clipEditPlanService";
import {
  DEFAULT_MAX_ON_DEMAND_TRACKING_SAMPLES,
  refreshVideoSubjectTracking,
  resolveSmartCropTrackingSnapshot,
} from "@/server/agents/videoSubjectTrackingService";
import { getMediaDimensions } from "@/server/media/ffmpeg";
import { hashStableJson } from "@/server/utils/stableJson";

export type PersistedResolvedFramingPlan = {
  plan: ResolvedFramingPlanDocument;
  planHash: string;
  status: ResolvedFramingPlanDocument["resolution"]["status"];
  resolvedAt: Date;
  reused: boolean;
};

export type EnsureResolvedFramingPlanOptions = {
  guard: ClipEditPlanGuard;
  sourceVideoPath: string;
  ffmpegPath?: string;
  allowTrackingGeneration?: boolean;
  maxTrackingSamples?: number;
  applicationMode?: Exclude<
    ResolvedFramingApplicationMode,
    "PASSTHROUGH_EXISTING_MASTER"
  >;
};

function parseResolvedFramingPlan(value: unknown): ResolvedFramingPlanDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ResolvedFramingPlanDocument>;
  if (
    record.schemaVersion !== RESOLVED_FRAMING_PLAN_SCHEMA_VERSION
    || !record.identity
    || !record.requested
    || !record.effective
    || !record.geometry
    || !record.tracking
    || !Array.isArray(record.tracking.timeline)
    || !record.application
    || !record.resolution
    || !record.quality
  ) {
    return null;
  }

  return record as ResolvedFramingPlanDocument;
}

function persistedPlanFromRecord(record: {
  resolvedFramingPlan: unknown;
  resolvedFramingPlanHash: string | null;
  framingPlanStatus: "READY" | "FALLBACK" | "PASSTHROUGH" | null;
  framingPlanResolvedAt: Date | null;
} | null): PersistedResolvedFramingPlan | null {
  const plan = parseResolvedFramingPlan(record?.resolvedFramingPlan);
  if (
    !record
    || !plan
    || !record.resolvedFramingPlanHash
    || !record.framingPlanStatus
    || !record.framingPlanResolvedAt
  ) {
    return null;
  }

  return {
    plan,
    planHash: record.resolvedFramingPlanHash,
    status: record.framingPlanStatus,
    resolvedAt: record.framingPlanResolvedAt,
    reused: true,
  };
}

export async function getResolvedFramingPlanForGuard(
  guard: ClipEditPlanGuard,
): Promise<PersistedResolvedFramingPlan | null> {
  const record = await prisma.clipEditPlan.findFirst({
    where: {
      id: guard.editPlanId,
      clipCandidateId: guard.clipCandidateId,
      planHash: guard.planHash,
      status: "ACTIVE",
    },
    select: {
      resolvedFramingPlan: true,
      resolvedFramingPlanHash: true,
      framingPlanStatus: true,
      framingPlanResolvedAt: true,
    },
  });

  return persistedPlanFromRecord(record);
}

/**
 * Read-only interface for Studio/preview consumers. It never starts tracking
 * and returns only the plan attached to the current active clip revision.
 */
export async function getActiveResolvedFramingPlan(
  clipCandidateId: string,
): Promise<PersistedResolvedFramingPlan | null> {
  const record = await prisma.clipEditPlan.findFirst({
    where: {
      clipCandidateId,
      status: "ACTIVE",
    },
    orderBy: { version: "desc" },
    select: {
      resolvedFramingPlan: true,
      resolvedFramingPlanHash: true,
      framingPlanStatus: true,
      framingPlanResolvedAt: true,
    },
  });

  return persistedPlanFromRecord(record);
}

export async function ensureResolvedFramingPlanForActiveRevision(
  options: EnsureResolvedFramingPlanOptions,
): Promise<PersistedResolvedFramingPlan> {
  // A resolved plan is immutable for the lifetime of an active edit revision.
  // A user change must supersede the edit plan before fresh tracking/framing is
  // generated, keeping artifact identity stable and preventing preview/export
  // from silently diverging under the same plan hash.
  const persisted = await getResolvedFramingPlanForGuard(options.guard);
  if (persisted) {
    return persisted;
  }

  const [clip, editPlan, sourceGeometry] = await Promise.all([
    prisma.clipCandidate.findUnique({
      where: { id: options.guard.clipCandidateId },
      select: {
        id: true,
        transcriptText: true,
        smartClipCategory: true,
        ministryValue: true,
        emotionalImpactScore: true,
        hookStrengthScore: true,
        shareabilityScore: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        adjustedStartTimeSeconds: true,
        adjustedEndTimeSeconds: true,
        exportFormat: true,
        exportLayoutStrategy: true,
        manualCropKeyframes: true,
        captionData: true,
      },
    }),
    prisma.clipEditPlan.findFirst({
      where: {
        id: options.guard.editPlanId,
        clipCandidateId: options.guard.clipCandidateId,
        planHash: options.guard.planHash,
        status: "ACTIVE",
      },
      select: {
        id: true,
        planHash: true,
      },
    }),
    getMediaDimensions(options.sourceVideoPath, options.ffmpegPath),
  ]);

  if (!clip) {
    throw new Error(`Clip candidate ${options.guard.clipCandidateId} was not found.`);
  }
  if (!editPlan) {
    throw new Error("The active clip revision changed before framing could be resolved.");
  }

  const exportSettings = resolveExportSettings({
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
    manualCropKeyframes: clip.manualCropKeyframes,
  });
  const boundaries = {
    startTimeSeconds: clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds,
    endTimeSeconds: clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds,
  };
  const manualCropKeyframes = normalizeManualCropKeyframes(clip.manualCropKeyframes);
  let trackingSnapshot = exportSettings.framingMode === "SMART_CROP" && manualCropKeyframes.length === 0
    ? await resolveSmartCropTrackingSnapshot(clip.id, boundaries)
    : null;

  if (
    exportSettings.framingMode === "SMART_CROP"
    && manualCropKeyframes.length === 0
    && trackingSnapshot?.source !== "MODEL"
    && options.allowTrackingGeneration !== false
  ) {
    await refreshVideoSubjectTracking(clip.id, {
      ffmpegPath: options.ffmpegPath,
      maxSamples: options.maxTrackingSamples ?? DEFAULT_MAX_ON_DEMAND_TRACKING_SAMPLES,
    }).catch(() => null);
    trackingSnapshot = await resolveSmartCropTrackingSnapshot(clip.id, boundaries);
  }

  const plan = buildResolvedFramingPlanDocument({
    clipCandidateId: clip.id,
    editPlanId: editPlan.id,
    editPlanHash: editPlan.planHash,
    requestedLayout: exportSettings.framingMode,
    requestedPersonality: exportSettings.framingPersonality,
    sourceGeometry: {
      width: sourceGeometry.width,
      height: sourceGeometry.height,
      role: "ORIGINAL_SOURCE",
      alreadyFramed: false,
    },
    applicationMode: options.applicationMode ?? "APPLY_AT_BASE_RENDER",
    trackingSource: trackingSnapshot?.source ?? null,
    trackingPoints: trackingSnapshot?.timeline ?? [],
    manualCropKeyframes,
    moment: {
      transcriptText: clip.transcriptText,
      category: clip.smartClipCategory,
      ministryValue: clip.ministryValue,
      emotionalImpactScore: clip.emotionalImpactScore,
      hookStrengthScore: clip.hookStrengthScore,
      shareabilityScore: clip.shareabilityScore,
      durationSeconds: boundaries.endTimeSeconds - boundaries.startTimeSeconds,
    },
  });
  const planHash = hashStableJson(plan);
  const resolvedAt = new Date();
  const updated = await prisma.clipEditPlan.updateMany({
    where: {
      id: options.guard.editPlanId,
      clipCandidateId: options.guard.clipCandidateId,
      planHash: options.guard.planHash,
      status: "ACTIVE",
    },
    data: {
      resolvedFramingPlan: plan as unknown as Prisma.InputJsonValue,
      resolvedFramingPlanHash: planHash,
      framingPlanStatus: plan.resolution.status,
      framingPlanResolvedAt: resolvedAt,
    },
  });
  if (updated.count !== 1) {
    throw new Error("The active clip revision changed before its framing plan could be saved.");
  }

  return {
    plan,
    planHash,
    status: plan.resolution.status,
    resolvedAt,
    reused: false,
  };
}

export async function persistResolvedFramingRuntimeFallback(input: {
  guard: ClipEditPlanGuard;
  plan: ResolvedFramingPlanDocument;
  fallbackCode: "FFMPEG_FILTER_RISK" | "FFMPEG_CROP_FAILURE";
  fallbackReason: string;
}): Promise<PersistedResolvedFramingPlan> {
  const reasonCodes = Array.from(new Set([
    ...input.plan.resolution.reasonCodes,
    input.fallbackCode,
  ]));
  const plan: ResolvedFramingPlanDocument = {
    ...input.plan,
    effective: {
      ...input.plan.effective,
      layout: "FIT_BLURRED_BACKGROUND",
      treatment: "BLURRED_BACKGROUND",
      zoom: 1,
    },
    tracking: {
      ...input.plan.tracking,
      boundedPointCount: 0,
      timeline: [],
    },
    resolution: {
      ...input.plan.resolution,
      status: "FALLBACK",
      fallbackApplied: true,
      fallbackCode: input.fallbackCode,
      fallbackReason: input.fallbackReason,
      reasonCodes,
      summary: input.fallbackReason,
    },
    quality: {
      ...input.plan.quality,
      speakerVisiblePercentage: 100,
      manualCropRecommended: true,
      frameQualityLabel: "REVIEW",
      frameQualitySummary: "Frame quality: Review. Safe full-frame fallback was used after the tracked crop could not be rendered reliably.",
    },
  };
  const planHash = hashStableJson(plan);
  const resolvedAt = new Date();
  const updated = await prisma.clipEditPlan.updateMany({
    where: {
      id: input.guard.editPlanId,
      clipCandidateId: input.guard.clipCandidateId,
      planHash: input.guard.planHash,
      status: "ACTIVE",
    },
    data: {
      resolvedFramingPlan: plan as unknown as Prisma.InputJsonValue,
      resolvedFramingPlanHash: planHash,
      framingPlanStatus: "FALLBACK",
      framingPlanResolvedAt: resolvedAt,
    },
  });
  if (updated.count !== 1) {
    throw new Error("The active clip revision changed before its framing fallback could be saved.");
  }

  return {
    plan,
    planHash,
    status: "FALLBACK",
    resolvedAt,
    reused: false,
  };
}

export const __resolvedFramingPlanServiceTestUtils = {
  parseResolvedFramingPlan,
  persistedPlanFromRecord,
};
