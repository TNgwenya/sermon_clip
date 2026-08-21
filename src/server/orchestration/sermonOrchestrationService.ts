import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { enqueueOrchestrationJob } from "./repository";
import {
  buildOnDemandJob,
  buildSermonWorkflowPayload,
} from "./sermonWorkflow";

export function durableOrchestrationEnabled(): boolean {
  return process.env.ORCHESTRATION_CONTROL_PLANE_ENABLED?.trim().toLowerCase() === "true";
}

export function buildSermonSourceRevision(input: {
  youtubeUrl: string;
  sourceAsset?: {
    objectKey: string;
    etag: string | null;
    versionId: string | null;
    updatedAt: Date;
  } | null;
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
}): string {
  const sourceIdentity = input.sourceAsset
    ? [
        "object",
        input.sourceAsset.objectKey,
        input.sourceAsset.versionId ?? "",
        input.sourceAsset.etag ?? "",
        input.sourceAsset.updatedAt.toISOString(),
      ]
    : ["url", input.youtubeUrl.trim()];
  return createHash("sha256").update(JSON.stringify({
    sourceIdentity,
    sermonRange: input.analyzeFullRecording
      ? "full"
      : [input.sermonStartSeconds, input.sermonEndSeconds],
  })).digest("hex");
}

export async function queueInitialSermonOrchestration(input: {
  sermonId: string;
  force?: boolean;
}) {
  const sermonId = input.sermonId.trim();
  if (!sermonId) throw new Error("sermonId is required.");
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      organizationId: true,
      youtubeUrl: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      sourceAsset: {
        select: {
          objectKey: true,
          etag: true,
          versionId: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!sermon) throw new Error(`Sermon ${sermonId} was not found.`);
  if (!sermon.organizationId) {
    throw new Error("This sermon has no tenant owner and cannot enter the durable orchestration queue.");
  }
  const payload = buildSermonWorkflowPayload({
    sermonId,
    sourceRevision: buildSermonSourceRevision(sermon),
    force: input.force,
  });
  return enqueueOrchestrationJob({
    organizationId: sermon.organizationId,
    sermonId,
    lane: "INTAKE_MATERIALIZATION",
    logicalKey: `sermon-workflow:v1:intake_materialization:${payload.sourceRevision}`,
    payload,
    priority: 100,
    maxAttempts: 3,
  });
}

export async function queueOnDemandSermonOrchestration(input: {
  sermonId: string;
  lane: "CONTENT_WEEK" | "FINAL_RENDER_EXPORT" | "PUBLISHING";
  approvalReference?: string;
  publishIntentReference?: string;
  force?: boolean;
}) {
  const sermon = await prisma.sermon.findUnique({
    where: { id: input.sermonId.trim() },
    select: {
      id: true,
      organizationId: true,
      youtubeUrl: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      sourceAsset: {
        select: { objectKey: true, etag: true, versionId: true, updatedAt: true },
      },
    },
  });
  if (!sermon?.organizationId) throw new Error("A tenant-owned sermon is required.");
  const payload = buildSermonWorkflowPayload({
    sermonId: sermon.id,
    sourceRevision: buildSermonSourceRevision(sermon),
    force: input.force,
  });
  const request = buildOnDemandJob({
    lane: input.lane,
    payload,
    approvalReference: input.approvalReference,
    publishIntentReference: input.publishIntentReference,
  });
  return enqueueOrchestrationJob({
    organizationId: sermon.organizationId,
    sermonId: sermon.id,
    ...request,
  });
}
