import type { ClipArtifactKind, ClipArtifactStatus, ClipExportFormat, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashStableJson } from "@/server/utils/stableJson";
import { extractSpeechCleanupCutPlan } from "@/lib/speechCleanupPlan";
import {
  extractCaptionRevealMode,
  extractCaptionSyncOffsetSeconds,
} from "@/lib/clipStudio";

const CLIP_EDIT_PLAN_SCHEMA_VERSION = 2;

const clipEditPlanSelect = {
  id: true,
  sermonId: true,
  startTimeSeconds: true,
  endTimeSeconds: true,
  adjustedStartTimeSeconds: true,
  adjustedEndTimeSeconds: true,
  durationSeconds: true,
  transcriptText: true,
  title: true,
  hook: true,
  caption: true,
  hashtags: true,
  exportFormat: true,
  exportLayoutStrategy: true,
  manualCropKeyframes: true,
  captionData: true,
} satisfies Prisma.ClipCandidateSelect;

type ClipForEditPlan = Prisma.ClipCandidateGetPayload<{ select: typeof clipEditPlanSelect }>;

export type ClipEditPlanSnapshot = {
  sourceStartTimeSeconds: number;
  sourceEndTimeSeconds: number;
  cleanedDurationSeconds: number | null;
  planHash: string;
  captionCueHash: string | null;
  cropPlanHash: string | null;
  exportSettingsHash: string | null;
  planJson: Prisma.InputJsonValue;
  cleanupPlanJson: Prisma.InputJsonValue | null;
};

export type ClipEditPlanGuard = {
  clipCandidateId: string;
  editPlanId: string;
  planHash: string;
};

export const STALE_CLIP_COMPOSITION_ERROR_CODE = "STALE_CLIP_COMPOSITION" as const;

export class StaleClipCompositionError extends Error {
  readonly code = STALE_CLIP_COMPOSITION_ERROR_CODE;
  readonly clipCandidateId: string;
  readonly expectedEditPlanId: string;
  readonly expectedPlanHash: string;
  readonly activeEditPlanId: string | null;
  readonly activePlanHash: string | null;

  constructor(input: ClipEditPlanGuard & {
    activeEditPlanId?: string | null;
    activePlanHash?: string | null;
  }) {
    super("Clip Studio changes were saved while this media was being generated. The stale output was discarded; rebuild it from the latest composition.");
    this.name = "StaleClipCompositionError";
    this.clipCandidateId = input.clipCandidateId;
    this.expectedEditPlanId = input.editPlanId;
    this.expectedPlanHash = input.planHash;
    this.activeEditPlanId = input.activeEditPlanId ?? null;
    this.activePlanHash = input.activePlanHash ?? null;
  }
}

export function isStaleClipCompositionError(error: unknown): error is StaleClipCompositionError {
  return error instanceof StaleClipCompositionError
    || Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === STALE_CLIP_COMPOSITION_ERROR_CODE,
    );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableJsonValue(value: unknown): Prisma.InputJsonValue | null {
  return value === null || value === undefined ? null : toJsonValue(value);
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof record[key] === "boolean" ? Boolean(record[key]) : fallback;
}

function buildClipEditPlanSnapshot(clip: ClipForEditPlan): ClipEditPlanSnapshot {
  const captionData = asRecord(clip.captionData);
  const sourceStartTimeSeconds = clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds;
  const sourceEndTimeSeconds = clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds;
  const speechCleanupPlan = extractSpeechCleanupCutPlan(captionData);
  const captionCues = Array.isArray(captionData["cues"]) ? captionData["cues"] : [];
  const captionCueHash = captionCues.length > 0 ? hashStableJson(captionCues) : null;
  const cropPlan = {
    exportLayoutStrategy: clip.exportLayoutStrategy,
    manualCropKeyframes: clip.manualCropKeyframes ?? null,
  };
  const exportSettings = {
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    exportSettings: captionData["exportSettings"] ?? null,
    framingPersonality: captionData["framingPersonality"] ?? null,
  };
  const planDocument = {
    schemaVersion: CLIP_EDIT_PLAN_SCHEMA_VERSION,
    clip: {
      id: clip.id,
      sermonId: clip.sermonId,
      title: clip.title,
      hook: clip.hook,
      caption: clip.caption,
      hashtags: clip.hashtags,
      transcriptText: clip.transcriptText,
    },
    boundaries: {
      sourceStartTimeSeconds,
      sourceEndTimeSeconds,
      durationSeconds: Number((sourceEndTimeSeconds - sourceStartTimeSeconds).toFixed(3)),
      originalDurationSeconds: clip.durationSeconds,
    },
    speechCleanup: {
      settings: captionData["speechCleanup"] ?? null,
      edits: captionData["speechCleanupEdits"] ?? null,
    },
    captions: {
      applyCaptionsToClip: readBoolean(captionData, "applyCaptionsToClip", true),
      captionStyleSource: captionData["captionStyleSource"] ?? null,
      cues: captionCues,
      captionStylePresetId: captionData["captionStylePresetId"] ?? null,
      captionPosition: captionData["captionPosition"] ?? null,
      captionAppearance: captionData["captionAppearance"] ?? null,
      captionDesign: captionData["captionDesign"] ?? null,
      captionRevealMode: extractCaptionRevealMode(captionData),
      captionSyncOffsetSeconds: extractCaptionSyncOffsetSeconds(captionData),
      wordHighlightEnabled: readBoolean(captionData, "wordHighlightEnabled", false),
    },
    overlays: {
      hookOverlay: captionData["hookOverlay"] ?? null,
      brollLayer: captionData["brollLayer"] ?? null,
      brandingSettings: captionData["brandingSettings"] ?? null,
    },
    framing: cropPlan,
    export: exportSettings,
  };
  const planHash = hashStableJson(planDocument);

  return {
    sourceStartTimeSeconds,
    sourceEndTimeSeconds,
    cleanedDurationSeconds: speechCleanupPlan?.enabled ? speechCleanupPlan.cleanedDurationSeconds : null,
    planHash,
    captionCueHash,
    cropPlanHash: hashStableJson(cropPlan),
    exportSettingsHash: hashStableJson(exportSettings),
    planJson: toJsonValue(planDocument),
    cleanupPlanJson: toNullableJsonValue(speechCleanupPlan),
  };
}

export async function getActiveClipEditPlan(clipCandidateId: string) {
  return prisma.clipEditPlan.findFirst({
    where: {
      clipCandidateId,
      status: "ACTIVE",
    },
    orderBy: { version: "desc" },
  });
}

async function loadActiveClipEditPlanGuard(clipCandidateId: string) {
  return prisma.clipEditPlan.findFirst({
    where: {
      clipCandidateId,
      status: "ACTIVE",
    },
    orderBy: { version: "desc" },
    select: {
      id: true,
      planHash: true,
    },
  });
}

function staleClipCompositionError(
  expected: ClipEditPlanGuard,
  active: { id: string; planHash: string } | null,
): StaleClipCompositionError {
  return new StaleClipCompositionError({
    ...expected,
    activeEditPlanId: active?.id ?? null,
    activePlanHash: active?.planHash ?? null,
  });
}

export async function assertClipEditPlanStillActive(
  expected: ClipEditPlanGuard,
): Promise<{ id: string; planHash: string }> {
  const active = await loadActiveClipEditPlanGuard(expected.clipCandidateId);
  if (
    !active
    || active.id !== expected.editPlanId
    || active.planHash !== expected.planHash
  ) {
    throw staleClipCompositionError(expected, active);
  }

  return active;
}

/**
 * A media command can fail for its own reason after the creator has already
 * saved a newer composition. In that case the superseded plan, not the media
 * error, must control cleanup so the new draft is never marked FAILED.
 */
export async function preferStaleClipCompositionError(
  expected: ClipEditPlanGuard,
  error: unknown,
): Promise<unknown> {
  if (isStaleClipCompositionError(error)) {
    return error;
  }

  try {
    await assertClipEditPlanStillActive(expected);
    return error;
  } catch (guardError) {
    return isStaleClipCompositionError(guardError) ? guardError : error;
  }
}

/**
 * Writes clip completion metadata only while the plan captured at job start is
 * still ACTIVE. The relation predicate makes the comparison and mutation one
 * database operation, closing the gap between a read-only assertion and write.
 */
export async function updateClipCandidateForActiveEditPlan(input: {
  guard: ClipEditPlanGuard;
  data: Prisma.ClipCandidateUpdateManyMutationInput;
}): Promise<void> {
  const result = await prisma.clipCandidate.updateMany({
    where: {
      id: input.guard.clipCandidateId,
      editPlans: {
        some: {
          id: input.guard.editPlanId,
          planHash: input.guard.planHash,
          status: "ACTIVE",
        },
      },
    },
    data: input.data,
  });

  if (result.count !== 1) {
    const active = await loadActiveClipEditPlanGuard(input.guard.clipCandidateId);
    throw staleClipCompositionError(input.guard, active);
  }
}

/** Best-effort guarded write for failure metadata; a newer Studio plan wins. */
export async function tryUpdateClipCandidateForActiveEditPlan(input: {
  guard: ClipEditPlanGuard;
  data: Prisma.ClipCandidateUpdateManyMutationInput;
}): Promise<boolean> {
  const result = await prisma.clipCandidate.updateMany({
    where: {
      id: input.guard.clipCandidateId,
      editPlans: {
        some: {
          id: input.guard.editPlanId,
          planHash: input.guard.planHash,
          status: "ACTIVE",
        },
      },
    },
    data: input.data,
  });

  return result.count === 1;
}

export async function upsertActiveClipEditPlanForClip(input: {
  clipCandidateId: string;
  createdBy?: string;
  createdReason?: string;
}) {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: input.clipCandidateId },
    select: clipEditPlanSelect,
  });

  if (!clip) {
    throw new Error(`Clip candidate ${input.clipCandidateId} was not found.`);
  }

  const snapshot = buildClipEditPlanSnapshot(clip);
  const latest = await getActiveClipEditPlan(clip.id);

  if (latest?.planHash === snapshot.planHash) {
    return {
      plan: latest,
      created: false,
      snapshot,
    };
  }

  const latestVersion = await prisma.clipEditPlan.findFirst({
    where: { clipCandidateId: clip.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  // Keep the supersede/create pair and artifact invalidation atomic without an interactive transaction.
  // Interactive transactions expire after five seconds by default, which is
  // too brittle when the hosted database pool needs to wake or reconnect.
  const [, plan] = await prisma.$transaction([
    prisma.clipEditPlan.updateMany({
      where: {
        clipCandidateId: clip.id,
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED" },
    }),
    prisma.clipEditPlan.create({
      data: {
        clipCandidateId: clip.id,
        sermonId: clip.sermonId,
        version: nextVersion,
        status: "ACTIVE",
        planHash: snapshot.planHash,
        sourceStartTimeSeconds: snapshot.sourceStartTimeSeconds,
        sourceEndTimeSeconds: snapshot.sourceEndTimeSeconds,
        cleanedDurationSeconds: snapshot.cleanedDurationSeconds,
        planJson: snapshot.planJson,
        cleanupPlanJson: snapshot.cleanupPlanJson ?? undefined,
        captionCueHash: snapshot.captionCueHash,
        cropPlanHash: snapshot.cropPlanHash,
        exportSettingsHash: snapshot.exportSettingsHash,
        createdBy: input.createdBy ?? "system",
        createdReason: input.createdReason ?? null,
      },
    }),
    prisma.clipArtifact.updateMany({
      where: {
        clipCandidateId: clip.id,
        freshness: "UP_TO_DATE",
        OR: [
          { planHash: null },
          { planHash: { not: snapshot.planHash } },
        ],
      },
      data: {
        freshness: "OUTDATED",
      },
    }),
  ]);

  return {
    plan,
    created: true,
    snapshot,
  };
}

export async function recordClipArtifact(input: {
  clipCandidateId: string;
  kind: ClipArtifactKind;
  status?: ClipArtifactStatus;
  format?: ClipExportFormat | null;
  filePath?: string | null;
  objectKey?: string | null;
  publicUrl?: string | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  errorMessage?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  editPlan?: Pick<ClipEditPlanGuard, "editPlanId" | "planHash"> | null;
}) {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: input.clipCandidateId },
    select: { id: true, sermonId: true },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${input.clipCandidateId} was not found.`);
  }

  const activePlan = input.editPlan
    ? await assertClipEditPlanStillActive({
        clipCandidateId: clip.id,
        editPlanId: input.editPlan.editPlanId,
        planHash: input.editPlan.planHash,
      })
    : await getActiveClipEditPlan(clip.id);

  return prisma.clipArtifact.create({
    data: {
      clipCandidateId: clip.id,
      sermonId: clip.sermonId,
      editPlanId: activePlan?.id ?? null,
      kind: input.kind,
      status: input.status ?? "READY",
      freshness: input.status === "FAILED" ? "FAILED" : "UP_TO_DATE",
      format: input.format ?? null,
      planHash: activePlan?.planHash ?? null,
      filePath: input.filePath ?? null,
      objectKey: input.objectKey ?? null,
      publicUrl: input.publicUrl ?? null,
      sizeBytes: input.sizeBytes ?? null,
      durationSeconds: input.durationSeconds ?? null,
      errorMessage: input.errorMessage ?? null,
      metadataJson: input.metadata ?? undefined,
      generatedAt: new Date(),
    },
  });
}

export const __clipEditPlanTestUtils = {
  buildClipEditPlanSnapshot,
};
