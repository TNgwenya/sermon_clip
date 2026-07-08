import type { ClipArtifactKind, ClipArtifactStatus, ClipExportFormat, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashStableJson } from "@/server/utils/stableJson";
import { extractSpeechCleanupCutPlan } from "@/lib/speechCleanupPlan";

const CLIP_EDIT_PLAN_SCHEMA_VERSION = 1;

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
  renderedFilePath: true,
  captionedVideoPath: true,
  overlayVideoPath: true,
  exportedFilePath: true,
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
    framingDecision: captionData["framingDecision"] ?? null,
  };
  const exportSettings = {
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    exportSettings: captionData["exportSettings"] ?? null,
    framingPersonality: captionData["framingPersonality"] ?? null,
    exportSource: captionData["exportSource"] ?? null,
    exportQualityProfile: captionData["exportQualityProfile"] ?? null,
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
      cutPlan: speechCleanupPlan,
    },
    captions: {
      applyCaptionsToClip: readBoolean(captionData, "applyCaptionsToClip", true),
      cues: captionCues,
      captionStylePresetId: captionData["captionStylePresetId"] ?? null,
      captionPosition: captionData["captionPosition"] ?? null,
      captionAppearance: captionData["captionAppearance"] ?? null,
      wordHighlightEnabled: readBoolean(captionData, "wordHighlightEnabled", false),
    },
    overlays: {
      hookOverlay: captionData["hookOverlay"] ?? null,
      brollLayer: captionData["brollLayer"] ?? null,
      brandingSettings: captionData["brandingSettings"] ?? null,
    },
    framing: cropPlan,
    export: exportSettings,
    artifactPaths: {
      renderedFilePath: clip.renderedFilePath,
      captionedVideoPath: clip.captionedVideoPath,
      overlayVideoPath: clip.overlayVideoPath,
      exportedFilePath: clip.exportedFilePath,
    },
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

  const plan = await prisma.$transaction(async (tx) => {
    await tx.clipEditPlan.updateMany({
      where: {
        clipCandidateId: clip.id,
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED" },
    });

    return tx.clipEditPlan.create({
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
    });
  });

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
}) {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: input.clipCandidateId },
    select: { id: true, sermonId: true },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${input.clipCandidateId} was not found.`);
  }

  const activePlan = await getActiveClipEditPlan(clip.id);

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
