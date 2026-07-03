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

const PROCESSING_JOB_DB_RETRY_DELAYS_MS = [500, 1_500, 3_000];

export async function createProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
): Promise<ProcessingJob> {
  return retryProcessingJobDbWrite(() => prisma.processingJob.create({
    data: {
      sermonId,
      type,
      status: "PENDING",
    },
  }));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === "P1001" ||
    code === "P1002" ||
    message.includes("Can't reach database server") ||
    message.includes("Timed out fetching a new connection")
  );
}

async function retryProcessingJobDbWrite<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= PROCESSING_JOB_DB_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === PROCESSING_JOB_DB_RETRY_DELAYS_MS.length) {
        break;
      }
      await sleep(PROCESSING_JOB_DB_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }

  throw lastError;
}

export async function appendJobLog(jobId: string, message: string): Promise<void> {
  try {
    const logs = await retryProcessingJobDbWrite(() => mergeLogs(jobId, message));

    await retryProcessingJobDbWrite(() => prisma.processingJob.update({
      where: { id: jobId },
      data: { logs: logs ?? null },
    }));
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      throw error;
    }
    console.warn(`Processing job log append skipped for ${jobId}: ${message}`);
  }
}

export async function markJobRunning(jobId: string): Promise<void> {
  await retryProcessingJobDbWrite(() => prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
    },
  }));
}

export async function markJobSucceeded(jobId: string, logs?: string): Promise<void> {
  const mergedLogs = await retryProcessingJobDbWrite(() => mergeLogs(jobId, logs));

  await retryProcessingJobDbWrite(() => prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      logs: mergedLogs,
      errorMessage: null,
    },
  }));
}

export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  logs?: string,
): Promise<void> {
  const mergedLogs = await retryProcessingJobDbWrite(() => mergeLogs(jobId, logs));

  await retryProcessingJobDbWrite(() => prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage,
      logs: mergedLogs,
    },
  }));
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
