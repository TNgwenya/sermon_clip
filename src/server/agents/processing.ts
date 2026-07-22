import type { Prisma, ProcessingJob, ProcessingJobType, SermonStatus } from "@prisma/client";

import {
  buildClipGenerationPreviewCheckpoint,
  clipGenerationIntentsMatch,
} from "@/lib/clipGenerationRetry";
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
const MAX_PROCESSING_JOB_LOG_CHARACTERS = 120_000;
const MAX_PROCESSING_JOB_LOG_ENTRY_CHARACTERS = 8_000;
const MAX_PROCESSING_ERROR_STACK_CHARACTERS = 4_000;

export type ProcessingFailureDiagnostics = {
  error?: unknown;
  code?: string;
  stage?: string;
  retryable?: boolean;
  workerId?: string;
  parentJobId?: string;
  sermonStatus?: string;
  details?: Record<string, unknown>;
};

export type SerializedProcessingError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
  cause?: SerializedProcessingError;
};

export class ActiveProcessingJobError extends Error {
  readonly code = "PROCESSING_JOB_ALREADY_ACTIVE";
  readonly existingJobId: string;
  readonly sermonId: string;
  readonly jobType: ProcessingJobType;
  readonly activeStatus: ProcessingJob["status"];

  constructor(job: ProcessingJob) {
    super(`A ${job.type} job is already ${job.status.toLowerCase()} for this sermon.`);
    this.name = "ActiveProcessingJobError";
    this.existingJobId = job.id;
    this.sermonId = job.sermonId;
    this.jobType = job.type;
    this.activeStatus = job.status;
  }
}

export type ProcessingJobExecution = "INLINE" | "QUEUED";

export type QueuedProcessingJobResult = {
  id: string;
  reusedExisting: boolean;
  intentConflict: boolean;
};

export async function createProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
  options: {
    execution?: ProcessingJobExecution;
    generationSummary?: Prisma.InputJsonValue;
  } = {},
): Promise<ProcessingJob> {
  const queued = options.execution === "QUEUED";
  const now = new Date();
  try {
    return await retryProcessingJobDbWrite(() => prisma.processingJob.create({
      data: {
        sermonId,
        type,
        status: queued ? "PENDING" : "RUNNING",
        ...(options.generationSummary === undefined
          ? {}
          : { generationSummary: options.generationSummary }),
        ...(queued
          ? {}
          : {
              workerId: `inline:${process.pid}`,
              startedAt: now,
              heartbeatAt: now,
              attemptCount: 1,
            }),
      },
    }));
  } catch (error) {
    // A PostgreSQL partial unique index guarantees that concurrent clicks or
    // workers cannot create two active jobs for the same sermon step. The
    // losing caller must not receive the winner's job: it would then mutate
    // another worker's state and perform the same expensive work twice.
    if (errorCode(error) === "P2002") {
      const existing = await prisma.processingJob.findFirst({
        where: {
          sermonId,
          type,
          status: { in: ["PENDING", "RUNNING"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        throw new ActiveProcessingJobError(existing);
      }
    }

    throw error;
  }
}

function queuedJobResult(input: {
  id: string;
  type: ProcessingJobType;
  existingGenerationSummary: unknown;
  requestedGenerationSummary: unknown;
}): QueuedProcessingJobResult {
  const existingIntentKey = input.existingGenerationSummary
    && typeof input.existingGenerationSummary === "object"
    && !Array.isArray(input.existingGenerationSummary)
    && typeof (input.existingGenerationSummary as { intentKey?: unknown }).intentKey === "string"
    ? (input.existingGenerationSummary as { intentKey: string }).intentKey
    : null;
  const requestedIntentKey = input.requestedGenerationSummary
    && typeof input.requestedGenerationSummary === "object"
    && !Array.isArray(input.requestedGenerationSummary)
    && typeof (input.requestedGenerationSummary as { intentKey?: unknown }).intentKey === "string"
    ? (input.requestedGenerationSummary as { intentKey: string }).intentKey
    : null;
  return {
    id: input.id,
    reusedExisting: true,
    intentConflict: input.type === "GENERATE_CLIPS"
      ? !clipGenerationIntentsMatch(
          input.existingGenerationSummary,
          input.requestedGenerationSummary,
        )
      : requestedIntentKey !== null && existingIntentKey !== requestedIntentKey,
  };
}

export async function queueSermonProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
  generationSummary?: Prisma.InputJsonValue,
): Promise<QueuedProcessingJobResult> {
  // One retry closes the narrow race where the unique-index winner completes
  // between our failed insert and the active-row re-read.
  for (let createAttempt = 0; createAttempt < 2; createAttempt += 1) {
    const existing = await prisma.processingJob.findFirst({
      where: {
        sermonId,
        type,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, generationSummary: true },
    });

    if (existing) {
      return queuedJobResult({
        id: existing.id,
        type,
        existingGenerationSummary: existing.generationSummary,
        requestedGenerationSummary: generationSummary,
      });
    }

    try {
      const job = await createProcessingJob(sermonId, type, {
        execution: "QUEUED",
        generationSummary,
      });
      return { id: job.id, reusedExisting: false, intentConflict: false };
    } catch (error) {
      if (error instanceof ActiveProcessingJobError) {
        const racedJob = await prisma.processingJob.findFirst({
          where: {
            id: error.existingJobId,
            sermonId,
            type,
            status: { in: ["PENDING", "RUNNING"] },
          },
          select: { id: true, generationSummary: true },
        });
        if (racedJob) {
          return queuedJobResult({
            id: racedJob.id,
            type,
            existingGenerationSummary: racedJob.generationSummary,
            requestedGenerationSummary: generationSummary,
          });
        }

        if (createAttempt === 0) {
          continue;
        }
      } else if (errorCode(error) === "P2002" && createAttempt === 0) {
        // createProcessingJob could not find the winner because it completed
        // immediately after enforcing the partial unique index. Retry once.
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to queue ${type} for sermon ${sermonId} after a concurrent job completed.`);
}

export async function resolveProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
  processingJobId?: string,
): Promise<ProcessingJob> {
  if (!processingJobId) return createProcessingJob(sermonId, type);

  const job = await prisma.processingJob.findUnique({ where: { id: processingJobId } });
  if (!job || job.sermonId !== sermonId || job.type !== type) {
    throw new Error(`Processing job ${processingJobId} does not match sermon ${sermonId} and type ${type}.`);
  }
  if (job.status !== "PENDING" && job.status !== "RUNNING") {
    throw new Error(`Processing job ${processingJobId} is already ${job.status}.`);
  }
  return job;
}

export async function ensureProcessingJobRunning(job: ProcessingJob): Promise<void> {
  if (job.status !== "RUNNING" || job.attemptCount < 1) {
    await markJobRunning(job.id);
  }
}

function timestampedMessage(message: string): string {
  const normalized = message.trim().slice(0, MAX_PROCESSING_JOB_LOG_ENTRY_CHARACTERS);
  return `[${new Date().toISOString()}] ${normalized}`;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = String((error as { code?: unknown }).code ?? "").trim();
  return code || undefined;
}

export function serializeProcessingError(error: unknown, depth = 0): SerializedProcessingError {
  const normalized = error instanceof Error ? error : new Error(String(error ?? "Unknown processing error."));
  const serialized: SerializedProcessingError = {
    name: normalized.name || "Error",
    message: normalized.message || "Unknown processing error.",
  };
  const code = errorCode(error);
  if (code) {
    serialized.code = code;
  }
  if (normalized.stack) {
    serialized.stack = normalized.stack.slice(0, MAX_PROCESSING_ERROR_STACK_CHARACTERS);
  }
  if (error && typeof error === "object") {
    const contextEntries = Object.entries(error as Record<string, unknown>)
      .filter(([key, value]) => (
        !["name", "message", "stack", "cause", "code"].includes(key)
        && (value === null || ["string", "number", "boolean"].includes(typeof value))
      ))
      .slice(0, 20) as Array<[string, string | number | boolean | null]>;
    if (contextEntries.length > 0) {
      serialized.context = Object.fromEntries(contextEntries);
    }
  }

  if (depth < 2 && normalized.cause !== undefined) {
    serialized.cause = serializeProcessingError(normalized.cause, depth + 1);
  }

  return serialized;
}

function jsonSafeValue(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (value === null || value === undefined) return String(value ?? "");
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafeValue(item, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && typeof item !== "function")
      .slice(0, 100)
      .map(([key, item]) => [key, jsonSafeValue(item, depth + 1)] as const);
    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }

  return String(value);
}

function diagnosticLogMessage(diagnostics: ProcessingFailureDiagnostics, serialized: SerializedProcessingError): string {
  const fields = {
    code: diagnostics.code ?? serialized.code ?? "PROCESSING_FAILED",
    stage: diagnostics.stage ?? "unknown",
    retryable: diagnostics.retryable ?? false,
    errorType: serialized.name,
    workerId: diagnostics.workerId,
    parentJobId: diagnostics.parentJobId,
    sermonStatus: diagnostics.sermonStatus,
    details: diagnostics.details,
  };
  return `Failure diagnostics ${JSON.stringify(fields)}`;
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
  const nextChunk = timestampedMessage(message);
  try {
    const updated = await retryProcessingJobDbWrite(() => prisma.$executeRaw`
      UPDATE "ProcessingJob"
      SET
        "logs" = RIGHT(
          CASE
            WHEN COALESCE("logs", '') = '' THEN ${nextChunk}
            ELSE "logs" || E'\n' || ${nextChunk}
          END,
          CAST(${MAX_PROCESSING_JOB_LOG_CHARACTERS} AS INTEGER)
        ),
        "updatedAt" = NOW()
      WHERE "id" = ${jobId}
    `);
    if (updated === 0) {
      throw new Error(`Processing job ${jobId} was not found while appending logs.`);
    }
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      throw error;
    }
    console.warn(`Processing job log append skipped for ${jobId}: ${message}`, serializeProcessingError(error));
  }
}

export async function markJobAwaitingClipPreviewPreparation(
  jobId: string,
  currentGenerationSummary: unknown,
  logs?: string,
): Promise<void> {
  const checkpoint = buildClipGenerationPreviewCheckpoint(currentGenerationSummary);
  const updated = await retryProcessingJobDbWrite(() => prisma.processingJob.updateMany({
    where: {
      id: jobId,
      type: "GENERATE_CLIPS",
      status: "RUNNING",
    },
    data: {
      generationSummary: checkpoint as Prisma.InputJsonObject,
    },
  }));

  if (updated.count !== 1) {
    throw new Error(
      `Clip-generation job ${jobId} was no longer running while checkpointing preview preparation.`,
    );
  }

  if (logs) {
    await appendJobLog(jobId, logs);
  }
}

export async function markJobRunning(jobId: string, workerId?: string): Promise<void> {
  await retryProcessingJobDbWrite(() => prisma.processingJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: { not: "RUNNING" } },
        { attemptCount: { lt: 1 } },
      ],
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      heartbeatAt: new Date(),
      attemptCount: { increment: 1 },
      ...(workerId ? { workerId } : {}),
    },
  }));
}

export async function markJobSucceeded(jobId: string, logs?: string): Promise<void> {
  await retryProcessingJobDbWrite(() => prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      heartbeatAt: null,
      errorMessage: null,
    },
  }));

  if (logs) {
    try {
      await appendJobLog(jobId, logs);
    } catch (error) {
      console.error(`Processing job ${jobId} succeeded, but its final log could not be appended.`, serializeProcessingError(error));
    }
  }
}

export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  logs?: string,
  diagnostics: ProcessingFailureDiagnostics = {},
): Promise<void> {
  const serializedError = serializeProcessingError(diagnostics.error ?? new Error(errorMessage));
  const current = await retryProcessingJobDbWrite(() => prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { generationSummary: true },
  }));
  if (!current) {
    throw new Error(`Processing job ${jobId} was not found while recording its failure.`);
  }

  const existingSummary = current.generationSummary
    && typeof current.generationSummary === "object"
    && !Array.isArray(current.generationSummary)
    ? current.generationSummary
    : {};
  const existingFailure = "failure" in existingSummary
    && existingSummary.failure
    && typeof existingSummary.failure === "object"
    && !Array.isArray(existingSummary.failure)
    ? existingSummary.failure
    : null;
  const hasExplicitDiagnostics = diagnostics.error !== undefined
    || diagnostics.code !== undefined
    || diagnostics.stage !== undefined
    || diagnostics.retryable !== undefined
    || diagnostics.workerId !== undefined
    || diagnostics.parentJobId !== undefined
    || diagnostics.sermonStatus !== undefined
    || diagnostics.details !== undefined;
  const nextFailure = {
    version: 1,
    occurredAt: new Date().toISOString(),
    code: diagnostics.code ?? serializedError.code ?? "PROCESSING_FAILED",
    stage: diagnostics.stage ?? "unknown",
    retryable: diagnostics.retryable ?? false,
    workerId: diagnostics.workerId ?? null,
    parentJobId: diagnostics.parentJobId ?? null,
    sermonStatus: diagnostics.sermonStatus ?? null,
    error: serializedError,
    details: diagnostics.details ? jsonSafeValue(diagnostics.details) : {},
  };
  const failure = !hasExplicitDiagnostics && existingFailure ? existingFailure : nextFailure;

  await retryProcessingJobDbWrite(() => prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      heartbeatAt: null,
      errorMessage,
      generationSummary: {
        ...existingSummary,
        failure,
      } as Prisma.InputJsonObject,
    },
  }));

  for (const log of [logs, diagnosticLogMessage(diagnostics, serializedError)]) {
    if (!log) continue;
    try {
      await appendJobLog(jobId, log);
    } catch (error) {
      console.error(`Processing job ${jobId} failed, but a diagnostic log could not be appended.`, serializeProcessingError(error));
    }
  }
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
      await markJobFailed(job.id, errorMessage, `Attempt ${attempt}/${maxAttempts} failed.`, {
        error,
        code: "RETRYABLE_STEP_FAILED",
        stage: jobType,
        retryable: attempt < maxAttempts,
        details: { attempt, maxAttempts },
      });
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
          heartbeatAt: null,
        },
      });
    }
  }
}
