import { randomUUID as nodeRandomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

import {
  buildQueueEnvelope,
  canonicalPortableJson,
  type OrchestrationJobRecord,
  type OrchestrationLane,
  type PortableJsonValue,
} from "./contracts";
import {
  acknowledgeCancellation,
  acquireLease,
  completeLease,
  failLease,
  listDeadLetters,
  recoverExpiredLease,
  renewLease,
  replayTerminalJob,
  requestCancellation,
  selectFairPendingJobs,
  type DeadLetterView,
  type LeaseIdentity,
  type SchedulingJob,
  type SchedulingPatch,
  type TransitionDecision,
  type TransitionDenialCode,
} from "./schedulingRecovery";
import {
  enqueueOrchestrationJobInTransaction,
  type EnqueueOrchestrationJobInput,
  type EnqueueOrchestrationJobResult,
  type OrchestrationTransactionClient,
} from "./repository";

const OUTBOX_TOPIC = "sermon-clip.orchestration.v1";

type StoredJob = OrchestrationJobRecord;

type StoreJobDelegate = {
  findMany(args: Record<string, unknown>): Promise<StoredJob[]>;
  findUnique(args: Record<string, unknown>): Promise<StoredJob | null>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
};

type StoreOutboxDelegate = {
  findFirst(args: Record<string, unknown>): Promise<{ deliverySequence: number } | null>;
  create(args: Record<string, unknown>): Promise<unknown>;
};

type StoreAuditDelegate = {
  create(args: Record<string, unknown>): Promise<unknown>;
};

export type PrismaSchedulerTransaction = {
  orchestrationJob: StoreJobDelegate;
  orchestrationOutboxEvent: StoreOutboxDelegate;
  auditEvent: StoreAuditDelegate;
};

export type PrismaSchedulerClient = PrismaSchedulerTransaction & {
  $transaction<T>(callback: (transaction: PrismaSchedulerTransaction) => Promise<T>): Promise<T>;
};

export type ClaimedOrchestrationJob = Readonly<{
  job: StoredJob;
  lease: LeaseIdentity;
}>;

export class SchedulerJobNotFoundError extends Error {
  constructor(jobId: string, organizationId: string) {
    super(`Orchestration job ${jobId} was not found in organization ${organizationId}.`);
    this.name = "SchedulerJobNotFoundError";
  }
}

export class SchedulerTransitionDeniedError extends Error {
  readonly code: TransitionDenialCode;

  constructor(decision: Extract<TransitionDecision, { accepted: false }>) {
    super(decision.message);
    this.name = "SchedulerTransitionDeniedError";
    this.code = decision.code;
  }
}

export class SchedulerTransitionConflictError extends Error {
  constructor(jobId: string) {
    super(`Orchestration job ${jobId} changed before the transition could be persisted.`);
    this.name = "SchedulerTransitionConflictError";
  }
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function requireAccepted(decision: TransitionDecision): SchedulingPatch {
  if (!decision.accepted) throw new SchedulerTransitionDeniedError(decision);
  return decision.patch;
}

function schedulingJob(job: StoredJob): SchedulingJob {
  return job;
}

function inputJson(value: PortableJsonValue): PortableJsonValue {
  canonicalPortableJson(value);
  return value;
}

function schedulingData(patch: SchedulingPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
}

async function findScopedJob(
  transaction: PrismaSchedulerTransaction,
  organizationId: string,
  jobId: string,
): Promise<StoredJob> {
  const found = await transaction.orchestrationJob.findUnique({
    where: {
      id_organizationId: {
        id: requireNonEmpty(jobId, "jobId"),
        organizationId: requireNonEmpty(organizationId, "organizationId"),
      },
    },
  });
  if (!found) throw new SchedulerJobNotFoundError(jobId, organizationId);
  return found;
}

async function appendOutboxDelivery(
  transaction: PrismaSchedulerTransaction,
  job: StoredJob,
  enqueuedAt: Date,
): Promise<void> {
  const previous = await transaction.orchestrationOutboxEvent.findFirst({
    where: {
      organizationId: job.organizationId,
      orchestrationJobId: job.id,
    },
    orderBy: { deliverySequence: "desc" },
    select: { deliverySequence: true },
  });
  const deliverySequence = (previous?.deliverySequence ?? 0) + 1;
  const envelope = buildQueueEnvelope({ job, deliverySequence, enqueuedAt });
  await transaction.orchestrationOutboxEvent.create({
    data: {
      organizationId: job.organizationId,
      orchestrationJobId: job.id,
      deliverySequence,
      topic: OUTBOX_TOPIC,
      messageKey: envelope.messageKey,
      payloadVersion: envelope.schemaVersion,
      payloadJson: inputJson(envelope as unknown as PortableJsonValue),
      availableAt: job.availableAt,
    },
  });
}

function leaseWhere(job: StoredJob, lease?: LeaseIdentity): Record<string, unknown> {
  return {
    id: job.id,
    organizationId: job.organizationId,
    status: job.status,
    updatedAt: job.updatedAt,
    ...(lease ? { leaseOwner: lease.owner, leaseToken: lease.token } : {}),
  };
}

async function persistTransition(input: {
  transaction: PrismaSchedulerTransaction;
  job: StoredJob;
  patch: SchedulingPatch;
  lease?: LeaseIdentity;
  additionalData?: Record<string, unknown>;
  appendPendingDeliveryAt?: Date;
}): Promise<StoredJob> {
  const result = await input.transaction.orchestrationJob.updateMany({
    where: leaseWhere(input.job, input.lease),
    data: {
      ...schedulingData(input.patch),
      ...input.additionalData,
    },
  });
  if (result.count !== 1) throw new SchedulerTransitionConflictError(input.job.id);
  const updated = await findScopedJob(
    input.transaction,
    input.job.organizationId,
    input.job.id,
  );
  if (input.patch.status === "PENDING" && input.appendPendingDeliveryAt) {
    await appendOutboxDelivery(input.transaction, updated, input.appendPendingDeliveryAt);
  }
  return updated;
}

export type PrismaSchedulerStoreOptions = Readonly<{
  client?: PrismaSchedulerClient;
  randomUUID?: () => string;
  random?: () => number;
  enqueueInTransaction?: typeof enqueueOrchestrationJobInTransaction;
}>;

export type FollowOnOrchestrationJobInput = Omit<
  EnqueueOrchestrationJobInput,
  "organizationId" | "parentJobId" | "correlationId"
>;

export type CompleteAndEnqueueFollowOnResult = Readonly<{
  completed: StoredJob;
  followOn: EnqueueOrchestrationJobResult | null;
}>;

export class PrismaSchedulerStore {
  readonly #client: PrismaSchedulerClient;
  readonly #randomUUID: () => string;
  readonly #random: () => number;
  readonly #enqueueInTransaction: typeof enqueueOrchestrationJobInTransaction;

  constructor(options: PrismaSchedulerStoreOptions = {}) {
    this.#client = options.client ?? (prisma as unknown as PrismaSchedulerClient);
    this.#randomUUID = options.randomUUID ?? nodeRandomUUID;
    this.#random = options.random ?? Math.random;
    this.#enqueueInTransaction = options.enqueueInTransaction ?? enqueueOrchestrationJobInTransaction;
  }

  async claimFair(input: Readonly<{
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
    lane?: OrchestrationLane;
    scanLimit?: number;
  }>): Promise<ClaimedOrchestrationJob | null> {
    const workerId = requireNonEmpty(input.workerId, "workerId");
    const leaseDurationMs = requirePositiveInteger(input.leaseDurationMs, "leaseDurationMs");
    const scanLimit = requirePositiveInteger(input.scanLimit ?? 200, "scanLimit");
    const now = input.now ?? new Date();

    const candidates = await this.#client.orchestrationJob.findMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        cancelRequestedAt: null,
        ...(input.lane ? { lane: input.lane } : {}),
      },
      // One head job per church prevents a single large backlog from filling
      // the bounded scan before the fair selector sees other churches.
      distinct: ["organizationId"],
      orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
      take: scanLimit,
    });
    if (candidates.length === 0) return null;

    const organizationIds = [...new Set(candidates.map((candidate) => candidate.organizationId))];
    const recent = await this.#client.orchestrationJob.findMany({
      where: {
        organizationId: { in: organizationIds },
        status: { in: ["LEASED", "SUCCEEDED", "FAILED", "DEAD_LETTER"] },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.max(scanLimit, organizationIds.length),
    });
    const organizationLastLeasedAt: Record<string, Date> = {};
    for (const prior of recent) {
      const existing = organizationLastLeasedAt[prior.organizationId];
      if (!existing || prior.updatedAt.getTime() > existing.getTime()) {
        organizationLastLeasedAt[prior.organizationId] = prior.updatedAt;
      }
    }
    const fairCandidates = selectFairPendingJobs(candidates.map(schedulingJob), {
      now,
      limit: candidates.length,
      organizationLastLeasedAt,
    });

    for (const candidate of fairCandidates) {
      const lease = { owner: workerId, token: this.#randomUUID() };
      const patch = requireAccepted(acquireLease(candidate, {
        ...lease,
        now,
        leaseDurationMs,
      }));
      try {
        const claimed = await this.#client.$transaction(async (transaction) => persistTransition({
          transaction,
          job: candidate as StoredJob,
          patch,
        }));
        return { job: claimed, lease };
      } catch (error) {
        if (error instanceof SchedulerTransitionConflictError) continue;
        throw error;
      }
    }
    return null;
  }

  async renew(input: Readonly<{
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    leaseDurationMs: number;
    now?: Date;
  }>): Promise<StoredJob> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(renewLease(schedulingJob(job), {
        ...input.lease,
        now,
        leaseDurationMs: input.leaseDurationMs,
      }));
      return persistTransition({ transaction, job, patch, lease: input.lease });
    });
  }

  async requestCancel(input: Readonly<{
    organizationId: string;
    jobId: string;
    reason: string;
    now?: Date;
  }>): Promise<StoredJob> {
    const reason = requireNonEmpty(input.reason, "reason");
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(requestCancellation(schedulingJob(job), now));
      return persistTransition({
        transaction,
        job,
        patch,
        additionalData: { cancellationReason: reason.slice(0, 1_000) },
      });
    });
  }

  async acknowledgeCancel(input: Readonly<{
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    now?: Date;
  }>): Promise<StoredJob> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(acknowledgeCancellation(schedulingJob(job), {
        ...input.lease,
        now,
      }));
      return persistTransition({ transaction, job, patch, lease: input.lease });
    });
  }

  async complete(input: Readonly<{
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    now?: Date;
  }>): Promise<StoredJob> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(completeLease(schedulingJob(job), { ...input.lease, now }));
      return persistTransition({ transaction, job, patch, lease: input.lease });
    });
  }

  /**
   * Commits the current stage checkpoint and its optional next-stage intent in
   * one database transaction. If either write fails, neither may become
   * visible, closing the crash gap between stage completion and enqueue.
   */
  async completeAndEnqueueFollowOn(input: Readonly<{
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    followOn?: FollowOnOrchestrationJobInput | null;
    now?: Date;
  }>): Promise<CompleteAndEnqueueFollowOnResult> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(completeLease(schedulingJob(job), { ...input.lease, now }));
      const completed = await persistTransition({
        transaction,
        job,
        patch,
        lease: input.lease,
      });
      const followOn = input.followOn
        ? await this.#enqueueInTransaction(
          transaction as unknown as OrchestrationTransactionClient,
          {
            ...input.followOn,
            organizationId: job.organizationId,
            parentJobId: job.id,
            correlationId: job.correlationId,
            sermonId: input.followOn.sermonId ?? job.sermonId,
          },
        )
        : null;
      return { completed, followOn };
    });
  }

  async fail(input: Readonly<{
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    failureCode: string;
    failureMessage: string;
    retryAfterMs?: number | null;
    now?: Date;
  }>): Promise<StoredJob> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(failLease(schedulingJob(job), {
        ...input.lease,
        now,
        failureCode: requireNonEmpty(input.failureCode, "failureCode"),
        failureMessage: requireNonEmpty(input.failureMessage, "failureMessage").slice(0, 4_000),
        retryAfterMs: input.retryAfterMs,
        random: this.#random,
      }));
      return persistTransition({
        transaction,
        job,
        patch,
        lease: input.lease,
        appendPendingDeliveryAt: now,
      });
    });
  }

  async recoverExpired(input: Readonly<{
    now?: Date;
    limit?: number;
  }> = {}): Promise<StoredJob[]> {
    const now = input.now ?? new Date();
    const limit = requirePositiveInteger(input.limit ?? 50, "limit");
    const expired = await this.#client.orchestrationJob.findMany({
      where: { status: "LEASED", leaseExpiresAt: { lte: now } },
      orderBy: { leaseExpiresAt: "asc" },
      take: limit,
    });
    const recovered: StoredJob[] = [];
    for (const candidate of expired) {
      try {
        const updated = await this.#client.$transaction(async (transaction) => {
          const current = await findScopedJob(transaction, candidate.organizationId, candidate.id);
          const patch = requireAccepted(recoverExpiredLease(schedulingJob(current), {
            now,
            random: this.#random,
          }));
          return persistTransition({
            transaction,
            job: current,
            patch,
            appendPendingDeliveryAt: now,
          });
        });
        recovered.push(updated);
      } catch (error) {
        if (error instanceof SchedulerTransitionConflictError || error instanceof SchedulerTransitionDeniedError) {
          continue;
        }
        throw error;
      }
    }
    return recovered;
  }

  async listDeadLetters(input: Readonly<{
    organizationId: string;
    lane?: OrchestrationLane;
    limit?: number;
  }>): Promise<DeadLetterView[]> {
    const organizationId = requireNonEmpty(input.organizationId, "organizationId");
    const limit = requirePositiveInteger(input.limit ?? 100, "limit");
    const jobs = await this.#client.orchestrationJob.findMany({
      where: {
        organizationId,
        status: "DEAD_LETTER",
        ...(input.lane ? { lane: input.lane } : {}),
      },
      orderBy: [{ deadLetteredAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return listDeadLetters(jobs.map(schedulingJob), { organizationId, lane: input.lane });
  }

  async replay(input: Readonly<{
    organizationId: string;
    jobId: string;
    expectedStatus: "FAILED" | "DEAD_LETTER";
    expectedTerminalAt: Date;
    operatorReason: string;
    actorType: "USER" | "SYSTEM" | "SUPPORT" | "API";
    actorUserId?: string | null;
    resetAttempts?: boolean;
    now?: Date;
  }>): Promise<StoredJob> {
    const now = input.now ?? new Date();
    return this.#client.$transaction(async (transaction) => {
      const job = await findScopedJob(transaction, input.organizationId, input.jobId);
      const patch = requireAccepted(replayTerminalJob(schedulingJob(job), {
        now,
        expectedStatus: input.expectedStatus,
        expectedTerminalAt: input.expectedTerminalAt,
        operatorReason: input.operatorReason,
        resetAttempts: input.resetAttempts,
      }));
      const replayed = await persistTransition({
        transaction,
        job,
        patch,
        appendPendingDeliveryAt: now,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: job.organizationId,
          actorType: input.actorType,
          actorUserId: input.actorUserId ?? null,
          action: "orchestration.job.replayed",
          targetType: "OrchestrationJob",
          targetId: job.id,
          metadataJson: {
            lane: job.lane,
            priorStatus: job.status,
            priorAttemptCount: job.attemptCount,
            attemptsReset: Boolean(input.resetAttempts),
            reason: requireNonEmpty(input.operatorReason, "operatorReason").slice(0, 1_000),
          },
        },
      });
      return replayed;
    });
  }
}

export function createPrismaSchedulerStore(
  options: PrismaSchedulerStoreOptions = {},
): PrismaSchedulerStore {
  return new PrismaSchedulerStore(options);
}
