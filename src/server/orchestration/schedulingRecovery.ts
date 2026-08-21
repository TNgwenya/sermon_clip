import type { OrchestrationJobStatus, OrchestrationLane } from "./contracts";

export type RetryFailureCode =
  | "TRANSIENT_NETWORK"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_QUOTA"
  | "DEPENDENCY_UNAVAILABLE"
  | "STORAGE_TEMPORARY"
  | "WORKER_LOST"
  | "TIMEOUT"
  | "UNKNOWN"
  | "INVALID_INPUT"
  | "AUTHORIZATION_DENIED"
  | "SAFETY_BLOCK"
  | "UNSUPPORTED_MEDIA"
  | "ARTIFACT_INTEGRITY";

export type RetryPolicy = Readonly<{
  retryable: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}>;

export type SchedulingJob = Readonly<{
  id: string;
  organizationId: string;
  lane: OrchestrationLane;
  status: OrchestrationJobStatus;
  priority: number;
  availableAt: Date;
  createdAt: Date;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastFailureRetryable: boolean | null;
}>;

export type SchedulingPatch = Partial<
  Pick<
    SchedulingJob,
    | "status"
    | "availableAt"
    | "attemptCount"
    | "leaseOwner"
    | "leaseToken"
    | "leaseExpiresAt"
    | "cancelRequestedAt"
    | "cancelledAt"
    | "completedAt"
    | "deadLetteredAt"
    | "lastFailureCode"
    | "lastFailureMessage"
    | "lastFailureRetryable"
  >
>;

export type TransitionDenialCode =
  | "INVALID_LEASE"
  | "NOT_AVAILABLE"
  | "ATTEMPTS_EXHAUSTED"
  | "LEASE_OWNERSHIP_LOST"
  | "LEASE_EXPIRED"
  | "CANCELLATION_REQUESTED"
  | "ALREADY_TERMINAL"
  | "NOT_REPLAYABLE"
  | "STALE_REPLAY_REQUEST"
  | "REPLAY_REASON_REQUIRED";

export type TransitionDecision =
  | Readonly<{ accepted: true; patch: SchedulingPatch }>
  | Readonly<{ accepted: false; code: TransitionDenialCode; message: string }>;

export type LeaseIdentity = Readonly<{
  owner: string;
  token: string;
}>;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const RETRY_POLICIES: Readonly<Record<RetryFailureCode, RetryPolicy>> = {
  TRANSIENT_NETWORK: {
    retryable: true,
    maxAttempts: 5,
    baseDelayMs: 10 * SECOND,
    maxDelayMs: 5 * MINUTE,
    jitterRatio: 0.2,
  },
  PROVIDER_RATE_LIMIT: {
    retryable: true,
    maxAttempts: 6,
    baseDelayMs: 30 * SECOND,
    maxDelayMs: 30 * MINUTE,
    jitterRatio: 0.2,
  },
  PROVIDER_QUOTA: {
    retryable: true,
    maxAttempts: 4,
    baseDelayMs: 5 * MINUTE,
    maxDelayMs: 2 * 60 * MINUTE,
    jitterRatio: 0.1,
  },
  DEPENDENCY_UNAVAILABLE: {
    retryable: true,
    maxAttempts: 5,
    baseDelayMs: 30 * SECOND,
    maxDelayMs: 15 * MINUTE,
    jitterRatio: 0.2,
  },
  STORAGE_TEMPORARY: {
    retryable: true,
    maxAttempts: 5,
    baseDelayMs: 15 * SECOND,
    maxDelayMs: 10 * MINUTE,
    jitterRatio: 0.2,
  },
  WORKER_LOST: {
    retryable: true,
    maxAttempts: 4,
    baseDelayMs: 5 * SECOND,
    maxDelayMs: 2 * MINUTE,
    jitterRatio: 0.2,
  },
  TIMEOUT: {
    retryable: true,
    maxAttempts: 4,
    baseDelayMs: 30 * SECOND,
    maxDelayMs: 10 * MINUTE,
    jitterRatio: 0.2,
  },
  UNKNOWN: {
    retryable: true,
    maxAttempts: 2,
    baseDelayMs: 30 * SECOND,
    maxDelayMs: 2 * MINUTE,
    jitterRatio: 0.1,
  },
  INVALID_INPUT: {
    retryable: false,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  },
  AUTHORIZATION_DENIED: {
    retryable: false,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  },
  SAFETY_BLOCK: {
    retryable: false,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  },
  UNSUPPORTED_MEDIA: {
    retryable: false,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  },
  ARTIFACT_INTEGRITY: {
    retryable: false,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  },
};

function accepted(patch: SchedulingPatch): TransitionDecision {
  return { accepted: true, patch };
}

function denied(code: TransitionDenialCode, message: string): TransitionDecision {
  return { accepted: false, code, message };
}

function clearLease(): SchedulingPatch {
  return {
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
}

function isAtOrAfter(left: Date, right: Date): boolean {
  return left.getTime() >= right.getTime();
}

function isTerminal(status: OrchestrationJobStatus): boolean {
  return status === "SUCCEEDED" || status === "CANCELLED" || status === "DEAD_LETTER";
}

export function retryPolicyFor(code: string): RetryPolicy {
  return RETRY_POLICIES[code as RetryFailureCode] ?? RETRY_POLICIES.UNKNOWN;
}

export function computeRetryDelayMs(input: Readonly<{
  attemptCount: number;
  policy: RetryPolicy;
  random?: () => number;
  retryAfterMs?: number | null;
}>): number {
  if (!input.policy.retryable) return 0;

  const exponent = Math.max(0, Math.floor(input.attemptCount) - 1);
  const exponentialDelay = Math.min(
    input.policy.maxDelayMs,
    input.policy.baseDelayMs * (2 ** exponent),
  );
  const randomValue = Math.max(0, Math.min(1, (input.random ?? Math.random)()));
  const jitterFactor = 1 - input.policy.jitterRatio + (2 * input.policy.jitterRatio * randomValue);
  const jitteredDelay = Math.round(exponentialDelay * jitterFactor);
  const requestedDelay = Math.max(0, input.retryAfterMs ?? 0);

  return Math.min(input.policy.maxDelayMs, Math.max(jitteredDelay, requestedDelay));
}

export function validateLeaseOwnership(
  job: SchedulingJob,
  lease: LeaseIdentity,
  now: Date,
): TransitionDecision {
  if (
    job.status !== "LEASED"
    || job.leaseOwner !== lease.owner
    || job.leaseToken !== lease.token
    || !job.leaseExpiresAt
  ) {
    return denied(
      "LEASE_OWNERSHIP_LOST",
      "The job is no longer leased by this worker and token.",
    );
  }
  if (isAtOrAfter(now, job.leaseExpiresAt)) {
    return denied("LEASE_EXPIRED", "The lease expired before this transition.");
  }
  return accepted({});
}

export function acquireLease(
  job: SchedulingJob,
  input: LeaseIdentity & Readonly<{ now: Date; leaseDurationMs: number }>,
): TransitionDecision {
  if (!input.owner.trim() || !input.token.trim() || !Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    return denied("INVALID_LEASE", "A lease needs a worker, a token, and a positive duration.");
  }
  if (job.status !== "PENDING") {
    return denied(
      isTerminal(job.status) ? "ALREADY_TERMINAL" : "INVALID_LEASE",
      "Only a pending job can be leased.",
    );
  }
  if (job.cancelRequestedAt) {
    return denied("CANCELLATION_REQUESTED", "A cancelled job cannot receive a new lease.");
  }
  if (job.availableAt.getTime() > input.now.getTime()) {
    return denied("NOT_AVAILABLE", "The retry delay has not elapsed.");
  }
  if (job.attemptCount >= job.maxAttempts) {
    return denied("ATTEMPTS_EXHAUSTED", "The job has no automatic attempts remaining.");
  }

  return accepted({
    status: "LEASED",
    attemptCount: job.attemptCount + 1,
    leaseOwner: input.owner,
    leaseToken: input.token,
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
  });
}

export function renewLease(
  job: SchedulingJob,
  input: LeaseIdentity & Readonly<{ now: Date; leaseDurationMs: number }>,
): TransitionDecision {
  if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    return denied("INVALID_LEASE", "A lease renewal needs a positive duration.");
  }
  const ownership = validateLeaseOwnership(job, input, input.now);
  if (!ownership.accepted) return ownership;
  if (job.cancelRequestedAt) {
    return denied("CANCELLATION_REQUESTED", "The worker must stop at a safe boundary.");
  }
  return accepted({
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
  });
}

export function completeLease(
  job: SchedulingJob,
  input: LeaseIdentity & Readonly<{ now: Date }>,
): TransitionDecision {
  const ownership = validateLeaseOwnership(job, input, input.now);
  if (!ownership.accepted) return ownership;
  if (job.cancelRequestedAt) {
    return denied("CANCELLATION_REQUESTED", "A requested cancellation must be acknowledged before completion.");
  }
  return accepted({
    status: "SUCCEEDED",
    completedAt: input.now,
    ...clearLease(),
  });
}

export function requestCancellation(job: SchedulingJob, now: Date): TransitionDecision {
  if (job.status === "CANCELLED") return accepted({});
  if (isTerminal(job.status) || job.status === "FAILED") {
    return denied("ALREADY_TERMINAL", "The job has already reached a terminal state.");
  }
  if (job.status === "PENDING") {
    return accepted({
      status: "CANCELLED",
      cancelRequestedAt: job.cancelRequestedAt ?? now,
      cancelledAt: now,
      completedAt: now,
      ...clearLease(),
    });
  }
  return accepted({ cancelRequestedAt: job.cancelRequestedAt ?? now });
}

export function acknowledgeCancellation(
  job: SchedulingJob,
  input: LeaseIdentity & Readonly<{ now: Date }>,
): TransitionDecision {
  const ownership = validateLeaseOwnership(job, input, input.now);
  if (!ownership.accepted) return ownership;
  if (!job.cancelRequestedAt) {
    return denied("INVALID_LEASE", "There is no cancellation request to acknowledge.");
  }
  return accepted({
    status: "CANCELLED",
    cancelledAt: input.now,
    completedAt: input.now,
    ...clearLease(),
  });
}

export function failLease(
  job: SchedulingJob,
  input: LeaseIdentity & Readonly<{
    now: Date;
    failureCode: string;
    failureMessage: string;
    retryAfterMs?: number | null;
    random?: () => number;
  }>,
): TransitionDecision {
  const ownership = validateLeaseOwnership(job, input, input.now);
  if (!ownership.accepted) return ownership;
  if (job.cancelRequestedAt) {
    return acknowledgeCancellation(job, input);
  }

  const policy = retryPolicyFor(input.failureCode);
  const attemptLimit = Math.min(job.maxAttempts, policy.maxAttempts);
  const retryable = policy.retryable && job.attemptCount < attemptLimit;
  const failurePatch: SchedulingPatch = {
    lastFailureCode: input.failureCode,
    lastFailureMessage: input.failureMessage,
    lastFailureRetryable: retryable,
    ...clearLease(),
  };

  if (!retryable) {
    return accepted({
      ...failurePatch,
      status: "DEAD_LETTER",
      deadLetteredAt: input.now,
      completedAt: input.now,
    });
  }

  const delayMs = computeRetryDelayMs({
    attemptCount: job.attemptCount,
    policy,
    random: input.random,
    retryAfterMs: input.retryAfterMs,
  });
  return accepted({
    ...failurePatch,
    status: "PENDING",
    availableAt: new Date(input.now.getTime() + delayMs),
  });
}

export function recoverExpiredLease(
  job: SchedulingJob,
  input: Readonly<{ now: Date; random?: () => number }>,
): TransitionDecision {
  if (job.status !== "LEASED" || !job.leaseExpiresAt || input.now.getTime() < job.leaseExpiresAt.getTime()) {
    return denied("INVALID_LEASE", "The job does not have an expired lease.");
  }
  if (job.cancelRequestedAt) {
    return accepted({
      status: "CANCELLED",
      cancelledAt: input.now,
      completedAt: input.now,
      ...clearLease(),
    });
  }

  const policy = retryPolicyFor("WORKER_LOST");
  const retryable = job.attemptCount < Math.min(job.maxAttempts, policy.maxAttempts);
  if (!retryable) {
    return accepted({
      status: "DEAD_LETTER",
      deadLetteredAt: input.now,
      completedAt: input.now,
      lastFailureCode: "WORKER_LOST",
      lastFailureMessage: "The worker lease expired and no recovery attempts remain.",
      lastFailureRetryable: false,
      ...clearLease(),
    });
  }

  const delayMs = computeRetryDelayMs({
    attemptCount: job.attemptCount,
    policy,
    random: input.random,
  });
  return accepted({
    status: "PENDING",
    availableAt: new Date(input.now.getTime() + delayMs),
    lastFailureCode: "WORKER_LOST",
    lastFailureMessage: "The worker lease expired; the job was safely returned to the queue.",
    lastFailureRetryable: true,
    ...clearLease(),
  });
}

function terminalTimestamp(job: SchedulingJob): Date | null {
  return job.status === "DEAD_LETTER" ? job.deadLetteredAt : job.completedAt;
}

export function replayTerminalJob(
  job: SchedulingJob,
  input: Readonly<{
    now: Date;
    expectedStatus: "FAILED" | "DEAD_LETTER";
    expectedTerminalAt: Date;
    operatorReason: string;
    resetAttempts?: boolean;
  }>,
): TransitionDecision {
  if (job.status !== "FAILED" && job.status !== "DEAD_LETTER") {
    return denied("NOT_REPLAYABLE", "Only a failed or dead-letter job can be replayed.");
  }
  if (input.operatorReason.trim().length < 8) {
    return denied("REPLAY_REASON_REQUIRED", "A meaningful operator reason is required for replay.");
  }
  const actualTerminalAt = terminalTimestamp(job);
  if (
    job.status !== input.expectedStatus
    || !actualTerminalAt
    || actualTerminalAt.getTime() !== input.expectedTerminalAt.getTime()
  ) {
    return denied("STALE_REPLAY_REQUEST", "The terminal job changed after the operator reviewed it.");
  }
  if (!input.resetAttempts && job.attemptCount >= job.maxAttempts) {
    return denied(
      "ATTEMPTS_EXHAUSTED",
      "Replay must explicitly reset attempts because the job exhausted its attempt budget.",
    );
  }

  return accepted({
    status: "PENDING",
    availableAt: input.now,
    attemptCount: input.resetAttempts ? 0 : job.attemptCount,
    completedAt: null,
    deadLetteredAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    ...clearLease(),
  });
}

export type FairSchedulingCandidate = SchedulingJob & Readonly<{
  createdAt: Date;
}>;

export function selectFairPendingJobs<T extends FairSchedulingCandidate>(
  candidates: readonly T[],
  input: Readonly<{
    now: Date;
    limit: number;
    organizationLastLeasedAt?: Readonly<Record<string, Date | undefined>>;
  }>,
): T[] {
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit === 0) return [];

  const eligible = candidates.filter((candidate) => (
    candidate.status === "PENDING"
    && !candidate.cancelRequestedAt
    && candidate.availableAt.getTime() <= input.now.getTime()
    && candidate.attemptCount < candidate.maxAttempts
  ));
  const byOrganization = new Map<string, T[]>();
  for (const candidate of eligible) {
    const jobs = byOrganization.get(candidate.organizationId) ?? [];
    jobs.push(candidate);
    byOrganization.set(candidate.organizationId, jobs);
  }
  for (const jobs of byOrganization.values()) {
    jobs.sort((left, right) => (
      right.priority - left.priority
      || left.availableAt.getTime() - right.availableAt.getTime()
      || left.createdAt.getTime() - right.createdAt.getTime()
      || left.id.localeCompare(right.id)
    ));
  }

  const organizationIds = [...byOrganization.keys()].sort((left, right) => {
    const leftLeasedAt = input.organizationLastLeasedAt?.[left]?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightLeasedAt = input.organizationLastLeasedAt?.[right]?.getTime() ?? Number.NEGATIVE_INFINITY;
    return leftLeasedAt - rightLeasedAt || left.localeCompare(right);
  });

  const selected: T[] = [];
  while (selected.length < limit) {
    let selectedInRound = false;
    for (const organizationId of organizationIds) {
      const next = byOrganization.get(organizationId)?.shift();
      if (!next) continue;
      selected.push(next);
      selectedInRound = true;
      if (selected.length === limit) break;
    }
    if (!selectedInRound) break;
  }
  return selected;
}

export type DeadLetterView = Readonly<{
  jobId: string;
  organizationId: string;
  lane: OrchestrationLane;
  attempts: number;
  failureCode: string;
  failureMessage: string;
  deadLetteredAt: Date;
}>;

export function listDeadLetters(
  jobs: readonly SchedulingJob[],
  filters: Readonly<{ organizationId?: string; lane?: OrchestrationLane }> = {},
): DeadLetterView[] {
  return jobs
    .filter((job) => (
      job.status === "DEAD_LETTER"
      && job.deadLetteredAt
      && (!filters.organizationId || job.organizationId === filters.organizationId)
      && (!filters.lane || job.lane === filters.lane)
    ))
    .map((job) => ({
      jobId: job.id,
      organizationId: job.organizationId,
      lane: job.lane,
      attempts: job.attemptCount,
      failureCode: job.lastFailureCode ?? "UNKNOWN",
      failureMessage: job.lastFailureMessage ?? "No failure message was recorded.",
      deadLetteredAt: job.deadLetteredAt!,
    }))
    .sort((left, right) => (
      left.deadLetteredAt.getTime() - right.deadLetteredAt.getTime()
      || left.jobId.localeCompare(right.jobId)
    ));
}
