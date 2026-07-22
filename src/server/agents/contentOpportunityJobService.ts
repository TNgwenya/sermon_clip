import type { Prisma } from "@prisma/client";

import {
  buildQueuedContentOpportunityJobSummary,
  contentOpportunityJobOptions,
  formatContentOpportunityGenerationResult,
  parseContentOpportunityJobSummary,
  updateContentOpportunityJobProgress,
  type ContentOpportunityGenerationResultShape,
  type ContentOpportunityJobRequest,
} from "@/lib/contentOpportunityJobs";
import { prisma } from "@/lib/prisma";
import {
  createProcessingJob,
  markJobFailed,
  markJobSucceeded,
  queueSermonProcessingJob,
} from "@/server/agents/processing";
import { generateContentOpportunities } from "@/server/agents/contentMultiplicationService";
import { recordContentFunnelEvent } from "@/server/contentFunnelTelemetry";

export type ContentOpportunityGenerationRequestResult =
  | {
      execution: "QUEUED";
      jobId: string;
      reusedExisting: boolean;
      intentConflict: boolean;
      progress: "QUEUED" | "RUNNING" | "COMPLETED";
    }
  | {
      execution: "INLINE";
      jobId: string;
      result: ContentOpportunityGenerationResultShape;
    };

function totalQuantity(quantities: Partial<Record<string, number>>): number {
  return Object.values(quantities).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function generationTelemetryMetadata(
  request: ContentOpportunityJobRequest,
  result?: ContentOpportunityGenerationResultShape,
) {
  return {
    generationMode: request.mode,
    presetId: request.presetId ?? null,
    opportunityType: request.targetType ?? null,
    ...(result
      ? {
          complete: result.complete,
          repairPasses: result.repairPasses,
          requestedCount: totalQuantity(result.requestedQuantities),
          generatedCount: result.opportunityCount,
          archivedCount: result.archivedCount,
          missingCount: result.shortfalls.reduce((sum, item) => sum + item.missing, 0),
          shortfallTypes: result.shortfalls.filter((item) => item.missing > 0).map((item) => item.opportunityType),
        }
      : {}),
  } as const;
}

async function assertGenerationSourceReady(sermonId: string): Promise<void> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      transcript: { select: { id: true } },
      transcriptSegments: {
        select: { id: true },
        orderBy: { startTimeSeconds: "asc" },
        take: 1,
      },
    },
  });
  if (!sermon) {
    throw new Error("The selected sermon could not be found.");
  }
  if (!sermon.transcript && sermon.transcriptSegments.length === 0) {
    throw new Error("Finish the sermon transcript before generating content ideas.");
  }
}

async function recordGenerationResult(input: {
  sermonId: string;
  jobId: string;
  request: ContentOpportunityJobRequest;
  result: ContentOpportunityGenerationResultShape;
  startedAt: Date | null;
}): Promise<void> {
  const durationMs = input.startedAt
    ? Math.max(0, Date.now() - input.startedAt.getTime())
    : null;
  await recordContentFunnelEvent({
    eventType: "GENERATION_COMPLETED",
    sermonId: input.sermonId,
    processingJobId: input.jobId,
    dedupeKey: `content-generation-completed:${input.jobId}`,
    durationMs,
    metadata: generationTelemetryMetadata(input.request, input.result),
  });
  if (!input.result.complete) {
    await recordContentFunnelEvent({
      eventType: "GENERATION_SHORTFALL",
      sermonId: input.sermonId,
      processingJobId: input.jobId,
      dedupeKey: `content-generation-shortfall:${input.jobId}`,
      metadata: generationTelemetryMetadata(input.request, input.result),
    });
  }
}

export async function enqueueContentOpportunityGeneration(input: {
  sermonId: string;
  request: ContentOpportunityJobRequest;
}): Promise<Extract<ContentOpportunityGenerationRequestResult, { execution: "QUEUED" }>> {
  await assertGenerationSourceReady(input.sermonId);
  const summary = buildQueuedContentOpportunityJobSummary(input.request);
  const queued = await queueSermonProcessingJob(
    input.sermonId,
    "GENERATE_CONTENT_OPPORTUNITIES",
    summary as unknown as Prisma.InputJsonObject,
  );
  await recordContentFunnelEvent({
    eventType: "GENERATION_REQUESTED",
    sermonId: input.sermonId,
    processingJobId: queued.id,
    dedupeKey: `content-generation-requested:${queued.id}`,
    metadata: {
      ...generationTelemetryMetadata(input.request),
      queueReused: queued.reusedExisting,
      queueIntentConflict: queued.intentConflict,
    },
  });
  const activeStatus = queued.reusedExisting
    ? await prisma.processingJob.findUnique({
        where: { id: queued.id },
        select: { status: true },
      })
    : null;
  const progress = activeStatus?.status === "RUNNING"
    ? "RUNNING" as const
    : activeStatus?.status === "SUCCEEDED"
      ? "COMPLETED" as const
      : "QUEUED" as const;
  return {
    execution: "QUEUED",
    jobId: queued.id,
    reusedExisting: queued.reusedExisting,
    intentConflict: queued.intentConflict,
    progress,
  };
}

export async function processContentOpportunityGenerationJob(input: {
  jobId: string;
  sermonId: string;
}): Promise<string> {
  const job = await prisma.processingJob.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      sermonId: true,
      type: true,
      status: true,
      startedAt: true,
      generationSummary: true,
    },
  });
  if (!job || job.sermonId !== input.sermonId || job.type !== "GENERATE_CONTENT_OPPORTUNITIES") {
    throw new Error("The content generation job does not match this sermon.");
  }
  const queuedSummary = parseContentOpportunityJobSummary(job.generationSummary);
  if (!queuedSummary) {
    throw new Error("The content generation job is missing a valid privacy-safe request summary.");
  }
  if (queuedSummary.progress.stage === "COMPLETED" && queuedSummary.result) {
    await recordGenerationResult({
      sermonId: input.sermonId,
      jobId: input.jobId,
      request: queuedSummary.request,
      result: queuedSummary.result,
      startedAt: job.startedAt,
    });
    return formatContentOpportunityGenerationResult(
      queuedSummary.result,
      queuedSummary.request.targetType,
    );
  }
  if (job.status !== "RUNNING" && job.status !== "PENDING") {
    throw new Error(`The content generation job is already ${job.status.toLowerCase()}.`);
  }

  const runningSummary = updateContentOpportunityJobProgress(
    queuedSummary,
    "RUNNING",
    10,
    new Date(),
    "LOADING_CONTEXT",
  );
  const running = await prisma.processingJob.updateMany({
    where: {
      id: job.id,
      sermonId: input.sermonId,
      type: "GENERATE_CONTENT_OPPORTUNITIES",
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? new Date(),
      heartbeatAt: new Date(),
      generationSummary: runningSummary as unknown as Prisma.InputJsonObject,
    },
  });
  if (running.count !== 1) {
    throw new Error("The content generation job was claimed by another worker.");
  }

  let progressSummary = runningSummary;
  try {
    const options = contentOpportunityJobOptions(runningSummary);
    const result = await generateContentOpportunities(input.sermonId, {
      ...options,
      processingJob: {
        id: job.id,
        summary: runningSummary,
      },
      onProgress: async ({ phase, percent }) => {
        progressSummary = updateContentOpportunityJobProgress(
          progressSummary,
          "RUNNING",
          percent,
          new Date(),
          phase,
        );
        const checkpointed = await prisma.processingJob.updateMany({
          where: {
            id: job.id,
            sermonId: input.sermonId,
            type: "GENERATE_CONTENT_OPPORTUNITIES",
            status: "RUNNING",
          },
          data: {
            heartbeatAt: new Date(),
            generationSummary: progressSummary as unknown as Prisma.InputJsonObject,
          },
        });
        if (checkpointed.count !== 1) {
          throw new Error("The content generation worker lost its job lease.");
        }
      },
    });
    await recordGenerationResult({
      sermonId: input.sermonId,
      jobId: input.jobId,
      request: runningSummary.request,
      result,
      startedAt: job.startedAt,
    });
    return formatContentOpportunityGenerationResult(result, runningSummary.request.targetType);
  } catch (error) {
    // The content rows and COMPLETED checkpoint commit atomically. If a
    // non-essential pipeline log fails after that commit, acknowledge the
    // completed work instead of rerunning an expensive generation request.
    const latest = await prisma.processingJob.findUnique({
      where: { id: job.id },
      select: { generationSummary: true },
    });
    const latestSummary = parseContentOpportunityJobSummary(latest?.generationSummary);
    if (latestSummary?.progress.stage === "COMPLETED" && latestSummary.result) {
      await recordGenerationResult({
        sermonId: input.sermonId,
        jobId: input.jobId,
        request: latestSummary.request,
        result: latestSummary.result,
        startedAt: job.startedAt,
      });
      return formatContentOpportunityGenerationResult(
        latestSummary.result,
        latestSummary.request.targetType,
      );
    }

    await prisma.processingJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: {
        generationSummary: updateContentOpportunityJobProgress(
          progressSummary,
          "FAILED",
          progressSummary.progress.percent,
          new Date(),
          "FAILED",
        ) as unknown as Prisma.InputJsonObject,
      },
    });
    throw error;
  }
}

export async function runContentOpportunityGenerationInline(input: {
  sermonId: string;
  request: ContentOpportunityJobRequest;
}): Promise<Extract<ContentOpportunityGenerationRequestResult, { execution: "INLINE" }>> {
  await assertGenerationSourceReady(input.sermonId);
  const summary = buildQueuedContentOpportunityJobSummary(input.request);
  const job = await createProcessingJob(input.sermonId, "GENERATE_CONTENT_OPPORTUNITIES", {
    execution: "INLINE",
    generationSummary: summary as unknown as Prisma.InputJsonObject,
  });
  await recordContentFunnelEvent({
    eventType: "GENERATION_REQUESTED",
    sermonId: input.sermonId,
    processingJobId: job.id,
    dedupeKey: `content-generation-requested:${job.id}`,
    metadata: generationTelemetryMetadata(input.request),
  });
  try {
    await processContentOpportunityGenerationJob({ jobId: job.id, sermonId: input.sermonId });
    const completed = await prisma.processingJob.findUnique({
      where: { id: job.id },
      select: { generationSummary: true },
    });
    const completedSummary = parseContentOpportunityJobSummary(completed?.generationSummary);
    if (!completedSummary?.result) {
      throw new Error("Content generation completed without a result summary.");
    }
    await markJobSucceeded(job.id, formatContentOpportunityGenerationResult(
      completedSummary.result,
      completedSummary.request.targetType,
    ));
    return { execution: "INLINE", jobId: job.id, result: completedSummary.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content generation failed.";
    await markJobFailed(job.id, message, "Inline content opportunity generation failed.", {
      error,
      code: "CONTENT_OPPORTUNITY_GENERATION_FAILED",
      stage: "GENERATE_CONTENT_OPPORTUNITIES",
      retryable: true,
    });
    throw error;
  }
}

export async function requestContentOpportunityGeneration(input: {
  sermonId: string;
  request: ContentOpportunityJobRequest;
}): Promise<ContentOpportunityGenerationRequestResult> {
  return process.env.CONTENT_OPPORTUNITY_GENERATION_EXECUTION?.trim().toUpperCase() === "INLINE"
    ? runContentOpportunityGenerationInline(input)
    : enqueueContentOpportunityGeneration(input);
}
