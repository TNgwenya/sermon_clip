import { isLocalUploadSourceUrl } from "@/lib/sermonIntake";
import {
  hasCompleteWorshipSermonRange,
  WORSHIP_SERMON_RANGE_REQUIRED_MESSAGE,
} from "@/lib/sermonSegment";
import type { OrchestrationLane } from "./contracts";
import type { LaneCompletion, SermonWorkflowPayloadV1 } from "./sermonWorkflow";

export type SermonLaneExecutionResult = {
  completion: LaneCompletion;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type SermonLaneDependencies = {
  intakeMaterialization: (payload: SermonWorkflowPayloadV1) => Promise<{ sourceReused: boolean; audioReused: boolean }>;
  transcribe: (payload: SermonWorkflowPayloadV1) => Promise<{ reliableForClipping: boolean; reused: boolean }>;
  buildIntelligenceAndSuggestions: (payload: SermonWorkflowPayloadV1) => Promise<{ suggestionCount: number; reused: boolean }>;
  preparePriorityPreviews: (payload: SermonWorkflowPayloadV1) => Promise<{
    prepared: number;
    deferred: number;
    firstBrandedPreviewReady: boolean;
  }>;
  buildContentWeek: (payload: SermonWorkflowPayloadV1) => Promise<{
    opportunityCount: number;
    reused: boolean;
    weekDraftReady: boolean;
    weekDraftId: string | null;
  }>;
  exportApprovedContent: (payload: SermonWorkflowPayloadV1 & { approvalReference: string }) => Promise<{ exportCount: number }>;
  publishApprovedContent?: (
    payload: SermonWorkflowPayloadV1 & { approvalReference: string; publishIntentReference: string },
  ) => Promise<{ publicationCount: number }>;
};

export class OrchestrationStageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrchestrationStageError";
    this.code = code;
  }
}

function readPayload(value: unknown): SermonWorkflowPayloadV1 & {
  approvalReference?: string | null;
  publishIntentReference?: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrchestrationStageError("INVALID_INPUT", "The orchestration payload must be an object.");
  }
  const payload = value as Partial<SermonWorkflowPayloadV1> & {
    approvalReference?: unknown;
    publishIntentReference?: unknown;
  };
  if (
    payload.kind !== "SERMON_WORKFLOW"
    || typeof payload.sermonId !== "string"
    || !payload.sermonId.trim()
    || typeof payload.sourceRevision !== "string"
    || !payload.sourceRevision.trim()
    || typeof payload.force !== "boolean"
    || !Number.isInteger(payload.previewLimit)
    || Number(payload.previewLimit) < 1
    || typeof payload.requireBrandedFirstPreview !== "boolean"
  ) {
    throw new OrchestrationStageError("INVALID_INPUT", "The sermon workflow payload is invalid or unsupported.");
  }
  return payload as SermonWorkflowPayloadV1 & {
    approvalReference?: string | null;
    publishIntentReference?: string | null;
  };
}

function requiredReference(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OrchestrationStageError("AUTHORIZATION_DENIED", `${name} is required for this lane.`);
  }
  return value.trim();
}

export function createSermonLaneExecutor(dependencies: SermonLaneDependencies) {
  return async function executeSermonLane(input: {
    lane: OrchestrationLane;
    payload: unknown;
  }): Promise<SermonLaneExecutionResult> {
    const payload = readPayload(input.payload);

    switch (input.lane) {
      case "INTAKE_MATERIALIZATION": {
        const result = await dependencies.intakeMaterialization(payload);
        return {
          completion: { lane: input.lane },
          summary: "The sermon source and audio are durably materialised.",
          evidence: result,
        };
      }
      case "TRANSCRIPTION": {
        const result = await dependencies.transcribe(payload);
        if (!result.reliableForClipping) {
          throw new OrchestrationStageError(
            "SAFETY_BLOCK",
            "The transcript was preserved, but it is not reliable enough for automatic clip intelligence.",
          );
        }
        return {
          completion: { lane: input.lane },
          summary: "A reliable timed transcript is ready.",
          evidence: result,
        };
      }
      case "INTELLIGENCE": {
        const result = await dependencies.buildIntelligenceAndSuggestions(payload);
        if (result.suggestionCount < 1) {
          throw new OrchestrationStageError("SAFETY_BLOCK", "No faithful standalone clip suggestions passed review checks.");
        }
        return {
          completion: { lane: input.lane, suggestionsReady: true },
          summary: `${result.suggestionCount} ranked clip suggestion(s) are ready.`,
          evidence: result,
        };
      }
      case "PREVIEW": {
        const result = await dependencies.preparePriorityPreviews(payload);
        if (payload.requireBrandedFirstPreview && !result.firstBrandedPreviewReady) {
          throw new OrchestrationStageError(
            "ARTIFACT_INTEGRITY",
            "The suggestions are preserved, but the first branded review preview is not ready.",
          );
        }
        return {
          completion: { lane: input.lane, firstBrandedPreviewReady: result.firstBrandedPreviewReady },
          summary: `Prepared ${result.prepared} priority preview(s); ${result.deferred} remain on demand.`,
          evidence: result,
        };
      }
      case "CONTENT_WEEK": {
        const result = await dependencies.buildContentWeek(payload);
        if (!result.weekDraftReady) {
          throw new OrchestrationStageError(
            "ARTIFACT_INTEGRITY",
            "Content opportunities were preserved, but the reviewable Week Draft is not ready.",
          );
        }
        return {
          completion: { lane: input.lane, requestedContentWeek: true },
          summary: `${result.opportunityCount} Content Week opportunity item(s) are ready.`,
          evidence: result,
        };
      }
      case "FINAL_RENDER_EXPORT": {
        const approvalReference = requiredReference(payload.approvalReference, "approvalReference");
        const result = await dependencies.exportApprovedContent({ ...payload, approvalReference });
        return {
          completion: { lane: input.lane },
          summary: `${result.exportCount} explicitly approved clip(s) were exported.`,
          evidence: { ...result, approvalReference },
        };
      }
      case "PUBLISHING": {
        const approvalReference = requiredReference(payload.approvalReference, "approvalReference");
        const publishIntentReference = requiredReference(payload.publishIntentReference, "publishIntentReference");
        if (!dependencies.publishApprovedContent) {
          throw new OrchestrationStageError(
            "SAFETY_BLOCK",
            "Publishing requires an explicitly configured connector handler and is never automatic.",
          );
        }
        const result = await dependencies.publishApprovedContent({
          ...payload,
          approvalReference,
          publishIntentReference,
        });
        return {
          completion: { lane: input.lane },
          summary: `${result.publicationCount} approved publication(s) were handed to the connector.`,
          evidence: { ...result, approvalReference, publishIntentReference },
        };
      }
    }
  };
}

async function ensureSermonSourceMaterialized(payload: SermonWorkflowPayloadV1): Promise<boolean> {
  const [{ prisma }, storage, guards, sourceAgent, downloadAgent] = await Promise.all([
    import("@/lib/prisma"),
    import("@/server/agents/storage"),
    import("@/server/media/fileGuards"),
    import("@/server/agents/sourceMaterializationAgent"),
    import("@/server/agents/videoDownloadAgent"),
  ]);
  const sermon = await prisma.sermon.findUnique({
    where: { id: payload.sermonId },
    select: {
      id: true,
      title: true,
      youtubeUrl: true,
      includeWorshipMoments: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      sourceAsset: { select: { status: true } },
    },
  });
  if (!sermon) throw new OrchestrationStageError("INVALID_INPUT", "The sermon no longer exists.");
  if (!hasCompleteWorshipSermonRange(sermon)) {
    throw new OrchestrationStageError("INVALID_INPUT", WORSHIP_SERMON_RANGE_REQUIRED_MESSAGE);
  }
  await storage.ensureSermonFolders(sermon.id, sermon.title);
  const sourcePath = storage.getSourceVideoPath(sermon.id);
  const existingSource = await guards.mediaFileIsUsable(sourcePath);
  let sourceReused = existingSource.usable;
  if (!existingSource.usable && sermon.sourceAsset?.status === "READY") {
    const result = await sourceAgent.materializeS3SermonSource(sermon.id);
    sourceReused = result.reusedExistingFile;
  } else if (!existingSource.usable) {
    if (isLocalUploadSourceUrl(sermon.youtubeUrl)) {
      throw new OrchestrationStageError("ARTIFACT_INTEGRITY", "The uploaded recording is incomplete and must be uploaded again.");
    }
    const result = await downloadAgent.downloadSermonVideo(sermon.id, { force: payload.force });
    sourceReused = result.reusedExistingFile;
  }
  return sourceReused;
}

async function ensureSermonMediaMaterialized(payload: SermonWorkflowPayloadV1): Promise<{
  sourceReused: boolean;
  audioReused: boolean;
}> {
  const sourceReused = await ensureSermonSourceMaterialized(payload);
  const { extractSermonAudio } = await import("@/server/agents/audioExtractionAgent");
  const audio = await extractSermonAudio(payload.sermonId, { force: payload.force });
  return { sourceReused, audioReused: audio.reusedExistingFile };
}

export async function createDefaultSermonLaneExecutor() {
  return createSermonLaneExecutor({
    intakeMaterialization: ensureSermonMediaMaterialized,
    transcribe: async (payload) => {
      // A retry may land on a different worker. Re-materialise missing local
      // prerequisites idempotently rather than assuming machine affinity.
      await ensureSermonMediaMaterialized(payload);
      const { transcribeSermonAudio } = await import("@/server/agents/transcriptionAgent");
      const result = await transcribeSermonAudio(payload.sermonId, { force: payload.force });
      return { reliableForClipping: result.reliableForClipping, reused: result.reusedExistingTranscript };
    },
    buildIntelligenceAndSuggestions: async (payload) => {
      const [{ generateSermonIntelligence }, { generateClipSuggestions }, { generateWorshipMomentClips }, { prisma }] = await Promise.all([
        import("@/server/agents/sermonIntelligenceService"),
        import("@/server/agents/clipIntelligenceAgent"),
        import("@/server/agents/worshipMomentService"),
        import("@/lib/prisma"),
      ]);
      const intelligence = await generateSermonIntelligence(payload.sermonId, { force: payload.force });
      if (intelligence.status !== "COMPLETED") {
        throw new OrchestrationStageError("DEPENDENCY_UNAVAILABLE", intelligence.failureReason ?? "Sermon intelligence failed.");
      }
      const suggestions = await generateClipSuggestions(payload.sermonId, { force: payload.force });
      const sermon = await prisma.sermon.findUnique({
        where: { id: payload.sermonId },
        select: { includeWorshipMoments: true },
      });
      const worship = sermon?.includeWorshipMoments
        ? await generateWorshipMomentClips(payload.sermonId, { force: payload.force })
        : null;
      return {
        suggestionCount: suggestions.clipCount + (worship?.clipCount ?? 0),
        reused: suggestions.reusedExistingSuggestions && (worship?.reusedExistingClips ?? true),
      };
    },
    preparePriorityPreviews: async (payload) => {
      await ensureSermonSourceMaterialized(payload);
      const { prepareGeneratedClipReviewAssets } = await import("@/server/agents/clipReviewAssetService");
      const result = await prepareGeneratedClipReviewAssets({
        sermonId: payload.sermonId,
        force: payload.force,
        maxClips: payload.previewLimit,
        prepareFirstBrandedPreview: payload.requireBrandedFirstPreview,
      });
      return {
        prepared: result.prepared,
        deferred: result.deferredClipCount,
        firstBrandedPreviewReady: result.firstBrandedPreviewReady,
      };
    },
    buildContentWeek: async (payload) => {
      const [{ generateContentOpportunities }, { prisma }] = await Promise.all([
        import("@/server/agents/contentMultiplicationService"),
        import("@/lib/prisma"),
      ]);
      const result = await generateContentOpportunities(payload.sermonId, { force: payload.force });
      const weekDraft = await prisma.weekDraft.findFirst({
        where: { sermonId: payload.sermonId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return {
        opportunityCount: result.opportunityCount,
        reused: result.reusedExistingOpportunities,
        weekDraftReady: Boolean(weekDraft),
        weekDraftId: weekDraft?.id ?? null,
      };
    },
    exportApprovedContent: async (payload) => {
      await ensureSermonSourceMaterialized(payload);
      const { exportApprovedClips } = await import("@/server/agents/clipExportAgent");
      const result = await exportApprovedClips(payload.sermonId);
      return { exportCount: result.exportedCount };
    },
  });
}
