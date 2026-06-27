import type { ProcessingJob, ProcessingJobType, SermonStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { appendPipelineLog } from "@/server/agents/storage";
import { updateSermonStatus } from "@/server/status/sermonStatus";

type RetryableStepOptions = {
  sermonId: string;
  jobType: ProcessingJobType;
  nextSermonStatus: SermonStatus;
  maxAttempts?: number;
  run: () => Promise<void>;
};

export async function createProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
): Promise<ProcessingJob> {
  return prisma.processingJob.create({
    data: {
      sermonId,
      type,
      status: "PENDING",
    },
  });
}

function timestampedMessage(message: string): string {
  return `[${new Date().toISOString()}] ${message}`;
}

async function mergeLogs(jobId: string, logs?: string): Promise<string | undefined> {
  if (!logs) {
    return undefined;
  }

  const existing = await prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { logs: true },
  });

  const nextChunk = timestampedMessage(logs);
  return existing?.logs ? `${existing.logs}\n${nextChunk}` : nextChunk;
}

export async function appendJobLog(jobId: string, message: string): Promise<void> {
  const logs = await mergeLogs(jobId, message);

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { logs: logs ?? null },
  });
}

export async function markJobRunning(jobId: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
    },
  });
}

export async function markJobSucceeded(jobId: string, logs?: string): Promise<void> {
  const mergedLogs = await mergeLogs(jobId, logs);

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      logs: mergedLogs,
      errorMessage: null,
    },
  });
}

export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  logs?: string,
): Promise<void> {
  const mergedLogs = await mergeLogs(jobId, logs);

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage,
      logs: mergedLogs,
    },
  });
}

export async function executeRetryableStep({
  sermonId,
  jobType,
  nextSermonStatus,
  maxAttempts = 3,
  run,
}: RetryableStepOptions): Promise<void> {
  const job = await createProcessingJob(sermonId, jobType);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await markJobRunning(job.id);
      await appendJobLog(job.id, `Attempt ${attempt}/${maxAttempts} started.`);
      await appendPipelineLog(sermonId, `${jobType} attempt ${attempt}/${maxAttempts} started.`);

      await run();

      await updateSermonStatus(sermonId, nextSermonStatus);
      await markJobSucceeded(job.id, `Attempt ${attempt}/${maxAttempts} succeeded.`);
      await appendPipelineLog(sermonId, `${jobType} attempt ${attempt}/${maxAttempts} succeeded.`);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown processing error.";
      await appendJobLog(job.id, `Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}`);
      await markJobFailed(job.id, errorMessage, `Attempt ${attempt}/${maxAttempts} failed.`);
      await appendPipelineLog(sermonId, `${jobType} attempt ${attempt}/${maxAttempts} failed: ${errorMessage}`);

      if (attempt === maxAttempts) {
        await updateSermonStatus(sermonId, "FAILED");
        throw error;
      }

      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          errorMessage: null,
          completedAt: null,
        },
      });
    }
  }
}
