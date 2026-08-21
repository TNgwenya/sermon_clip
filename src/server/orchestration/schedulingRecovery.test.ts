import { describe, expect, it } from "vitest";

import type { OrchestrationJobStatus, OrchestrationLane } from "./contracts";
import {
  acknowledgeCancellation,
  acquireLease,
  completeLease,
  computeRetryDelayMs,
  failLease,
  listDeadLetters,
  recoverExpiredLease,
  renewLease,
  replayTerminalJob,
  requestCancellation,
  retryPolicyFor,
  selectFairPendingJobs,
  type SchedulingJob,
  type SchedulingPatch,
} from "./schedulingRecovery";

const NOW = new Date("2026-08-21T10:00:00.000Z");
const LEASE = { owner: "media-worker-1", token: "lease-token-1" } as const;

function job(overrides: Partial<SchedulingJob> = {}): SchedulingJob {
  return {
    id: "job-1",
    organizationId: "church-a",
    lane: "TRANSCRIPTION" as OrchestrationLane,
    status: "PENDING" as OrchestrationJobStatus,
    priority: 0,
    availableAt: new Date("2026-08-21T09:00:00.000Z"),
    createdAt: new Date("2026-08-21T08:00:00.000Z"),
    attemptCount: 0,
    maxAttempts: 4,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    cancelledAt: null,
    completedAt: null,
    deadLetteredAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    ...overrides,
  };
}

function leasedJob(overrides: Partial<SchedulingJob> = {}): SchedulingJob {
  return job({
    status: "LEASED" as OrchestrationJobStatus,
    attemptCount: 1,
    leaseOwner: LEASE.owner,
    leaseToken: LEASE.token,
    leaseExpiresAt: new Date("2026-08-21T10:05:00.000Z"),
    ...overrides,
  });
}

function expectPatch(decision: ReturnType<typeof acquireLease>): SchedulingPatch {
  expect(decision.accepted).toBe(true);
  if (!decision.accepted) throw new Error(decision.message);
  return decision.patch;
}

describe("orchestration lease ownership", () => {
  it("leases only eligible pending work and increments the attempt atomically", () => {
    const patch = expectPatch(acquireLease(job(), {
      ...LEASE,
      now: NOW,
      leaseDurationMs: 60_000,
    }));

    expect(patch).toMatchObject({
      status: "LEASED",
      attemptCount: 1,
      leaseOwner: LEASE.owner,
      leaseToken: LEASE.token,
      leaseExpiresAt: new Date("2026-08-21T10:01:00.000Z"),
    });
  });

  it("refuses delayed, cancelled, and exhausted work", () => {
    const delayed = acquireLease(job({ availableAt: new Date("2026-08-21T10:00:01.000Z") }), {
      ...LEASE,
      now: NOW,
      leaseDurationMs: 60_000,
    });
    const cancelled = acquireLease(job({ cancelRequestedAt: NOW }), {
      ...LEASE,
      now: NOW,
      leaseDurationMs: 60_000,
    });
    const exhausted = acquireLease(job({ attemptCount: 4 }), {
      ...LEASE,
      now: NOW,
      leaseDurationMs: 60_000,
    });

    expect(delayed).toMatchObject({ accepted: false, code: "NOT_AVAILABLE" });
    expect(cancelled).toMatchObject({ accepted: false, code: "CANCELLATION_REQUESTED" });
    expect(exhausted).toMatchObject({ accepted: false, code: "ATTEMPTS_EXHAUSTED" });
  });

  it("rejects a stale owner token and a renewal after lease expiry", () => {
    const stolen = renewLease(leasedJob(), {
      owner: LEASE.owner,
      token: "old-token",
      now: NOW,
      leaseDurationMs: 60_000,
    });
    const expired = renewLease(leasedJob({ leaseExpiresAt: NOW }), {
      ...LEASE,
      now: NOW,
      leaseDurationMs: 60_000,
    });

    expect(stolen).toMatchObject({ accepted: false, code: "LEASE_OWNERSHIP_LOST" });
    expect(expired).toMatchObject({ accepted: false, code: "LEASE_EXPIRED" });
  });

  it("does not allow an expired worker to complete work", () => {
    const decision = completeLease(
      leasedJob({ leaseExpiresAt: new Date("2026-08-21T09:59:59.999Z") }),
      { ...LEASE, now: NOW },
    );
    expect(decision).toMatchObject({ accepted: false, code: "LEASE_EXPIRED" });
  });
});

describe("reason-aware retry and stale lease recovery", () => {
  it("keeps exponential jitter inside the documented bounds", () => {
    const policy = retryPolicyFor("TRANSIENT_NETWORK");
    expect(computeRetryDelayMs({ attemptCount: 3, policy, random: () => 0 })).toBe(32_000);
    expect(computeRetryDelayMs({ attemptCount: 3, policy, random: () => 1 })).toBe(48_000);
    expect(computeRetryDelayMs({ attemptCount: 99, policy, random: () => 1 })).toBe(300_000);
  });

  it("honours Retry-After without exceeding the policy cap", () => {
    const policy = retryPolicyFor("PROVIDER_RATE_LIMIT");
    expect(computeRetryDelayMs({
      attemptCount: 1,
      policy,
      random: () => 0.5,
      retryAfterMs: 90_000,
    })).toBe(90_000);
    expect(computeRetryDelayMs({
      attemptCount: 1,
      policy,
      random: () => 0.5,
      retryAfterMs: 60 * 60_000,
    })).toBe(30 * 60_000);
  });

  it("returns a transient failure to pending with its lease cleared", () => {
    const decision = failLease(leasedJob({ attemptCount: 2 }), {
      ...LEASE,
      now: NOW,
      failureCode: "TRANSIENT_NETWORK",
      failureMessage: "Temporary connection reset",
      random: () => 0.5,
    });
    const patch = expectPatch(decision);

    expect(patch).toMatchObject({
      status: "PENDING",
      availableAt: new Date("2026-08-21T10:00:20.000Z"),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastFailureRetryable: true,
    });
  });

  it("dead-letters non-retryable failures and exhausted transient failures", () => {
    const invalid = failLease(leasedJob(), {
      ...LEASE,
      now: NOW,
      failureCode: "INVALID_INPUT",
      failureMessage: "No audio track",
    });
    const exhausted = failLease(leasedJob({ attemptCount: 4 }), {
      ...LEASE,
      now: NOW,
      failureCode: "TRANSIENT_NETWORK",
      failureMessage: "Still unavailable",
    });

    expect(expectPatch(invalid)).toMatchObject({
      status: "DEAD_LETTER",
      lastFailureRetryable: false,
      deadLetteredAt: NOW,
    });
    expect(expectPatch(exhausted)).toMatchObject({
      status: "DEAD_LETTER",
      lastFailureRetryable: false,
      deadLetteredAt: NOW,
    });
  });

  it("recovers an expired lease with backoff, then dead-letters at its cap", () => {
    const stale = leasedJob({ leaseExpiresAt: new Date("2026-08-21T09:59:00.000Z") });
    const recovered = recoverExpiredLease(stale, { now: NOW, random: () => 0.5 });
    const exhausted = recoverExpiredLease(
      leasedJob({
        attemptCount: 4,
        leaseExpiresAt: new Date("2026-08-21T09:59:00.000Z"),
      }),
      { now: NOW },
    );

    expect(expectPatch(recovered)).toMatchObject({
      status: "PENDING",
      availableAt: new Date("2026-08-21T10:00:05.000Z"),
      lastFailureCode: "WORKER_LOST",
      lastFailureRetryable: true,
      leaseOwner: null,
    });
    expect(expectPatch(exhausted)).toMatchObject({
      status: "DEAD_LETTER",
      lastFailureCode: "WORKER_LOST",
      lastFailureRetryable: false,
    });
  });
});

describe("cancellation and replay safety", () => {
  it("cancels pending jobs immediately and asks leased workers to stop safely", () => {
    const pending = requestCancellation(job(), NOW);
    const leased = requestCancellation(leasedJob(), NOW);

    expect(expectPatch(pending)).toMatchObject({
      status: "CANCELLED",
      cancelRequestedAt: NOW,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    expect(expectPatch(leased)).toEqual({ cancelRequestedAt: NOW });
  });

  it("requires the current lease token to acknowledge cancellation", () => {
    const cancelling = leasedJob({ cancelRequestedAt: new Date("2026-08-21T09:59:00.000Z") });
    const stale = acknowledgeCancellation(cancelling, {
      owner: LEASE.owner,
      token: "stale-token",
      now: NOW,
    });
    const acknowledged = acknowledgeCancellation(cancelling, { ...LEASE, now: NOW });

    expect(stale).toMatchObject({ accepted: false, code: "LEASE_OWNERSHIP_LOST" });
    expect(expectPatch(acknowledged)).toMatchObject({
      status: "CANCELLED",
      cancelledAt: NOW,
      leaseOwner: null,
    });
  });

  it("prevents success from racing past a cancellation request", () => {
    const decision = completeLease(leasedJob({ cancelRequestedAt: NOW }), { ...LEASE, now: NOW });
    expect(decision).toMatchObject({ accepted: false, code: "CANCELLATION_REQUESTED" });
  });

  it("requires an audited, concurrency-checked, explicit attempt reset for replay", () => {
    const terminalAt = new Date("2026-08-21T09:50:00.000Z");
    const dead = job({
      status: "DEAD_LETTER" as OrchestrationJobStatus,
      attemptCount: 4,
      deadLetteredAt: terminalAt,
      completedAt: terminalAt,
      lastFailureCode: "INVALID_INPUT",
      lastFailureMessage: "No audio",
      lastFailureRetryable: false,
    });
    const stale = replayTerminalJob(dead, {
      now: NOW,
      expectedStatus: "DEAD_LETTER",
      expectedTerminalAt: new Date("2026-08-21T09:49:00.000Z"),
      operatorReason: "Source file was replaced",
      resetAttempts: true,
    });
    const noReset = replayTerminalJob(dead, {
      now: NOW,
      expectedStatus: "DEAD_LETTER",
      expectedTerminalAt: terminalAt,
      operatorReason: "Source file was replaced",
    });
    const replayed = replayTerminalJob(dead, {
      now: NOW,
      expectedStatus: "DEAD_LETTER",
      expectedTerminalAt: terminalAt,
      operatorReason: "Source file was replaced",
      resetAttempts: true,
    });

    expect(stale).toMatchObject({ accepted: false, code: "STALE_REPLAY_REQUEST" });
    expect(noReset).toMatchObject({ accepted: false, code: "ATTEMPTS_EXHAUSTED" });
    expect(expectPatch(replayed)).toMatchObject({
      status: "PENDING",
      availableAt: NOW,
      attemptCount: 0,
      deadLetteredAt: null,
      completedAt: null,
      lastFailureCode: null,
    });
  });

  it("never replays cancelled or succeeded jobs", () => {
    for (const status of ["CANCELLED", "SUCCEEDED"] as const) {
      const result = replayTerminalJob(job({
        status: status as OrchestrationJobStatus,
        completedAt: NOW,
      }), {
        now: NOW,
        expectedStatus: "FAILED",
        expectedTerminalAt: NOW,
        operatorReason: "Operator reviewed the failure",
        resetAttempts: true,
      });
      expect(result).toMatchObject({ accepted: false, code: "NOT_REPLAYABLE" });
    }
  });
});

describe("per-church fairness and dead-letter visibility", () => {
  it("round-robins churches while preserving priority and FIFO within each church", () => {
    const selected = selectFairPendingJobs([
      job({ id: "a-low", organizationId: "church-a", priority: 1 }),
      job({ id: "a-high", organizationId: "church-a", priority: 10, createdAt: new Date("2026-08-21T08:30:00Z") }),
      job({ id: "a-next", organizationId: "church-a", priority: 1, createdAt: new Date("2026-08-21T08:01:00Z") }),
      job({ id: "b-one", organizationId: "church-b", priority: 0 }),
      job({ id: "c-one", organizationId: "church-c", priority: 0 }),
    ], { now: NOW, limit: 5 });

    expect(selected.map((candidate) => candidate.id)).toEqual([
      "a-high",
      "b-one",
      "c-one",
      "a-low",
      "a-next",
    ]);
  });

  it("starts with the least recently served church", () => {
    const selected = selectFairPendingJobs([
      job({ id: "a", organizationId: "church-a" }),
      job({ id: "b", organizationId: "church-b" }),
    ], {
      now: NOW,
      limit: 2,
      organizationLastLeasedAt: {
        "church-a": new Date("2026-08-21T09:59:00Z"),
        "church-b": new Date("2026-08-21T09:00:00Z"),
      },
    });

    expect(selected.map((candidate) => candidate.id)).toEqual(["b", "a"]);
  });

  it("excludes delayed, cancelled, leased, and exhausted jobs", () => {
    const selected = selectFairPendingJobs([
      job({ id: "eligible" }),
      job({ id: "delayed", availableAt: new Date("2026-08-21T10:01:00Z") }),
      job({ id: "cancelled", cancelRequestedAt: NOW }),
      leasedJob({ id: "leased" }),
      job({ id: "exhausted", attemptCount: 4 }),
    ], { now: NOW, limit: 10 });

    expect(selected.map((candidate) => candidate.id)).toEqual(["eligible"]);
  });

  it("lists dead letters oldest first and keeps tenant filters explicit", () => {
    const firstAt = new Date("2026-08-21T09:00:00Z");
    const secondAt = new Date("2026-08-21T09:30:00Z");
    const deadLetters = [
      job({
        id: "other",
        organizationId: "church-b",
        status: "DEAD_LETTER" as OrchestrationJobStatus,
        deadLetteredAt: firstAt,
      }),
      job({
        id: "mine",
        organizationId: "church-a",
        status: "DEAD_LETTER" as OrchestrationJobStatus,
        deadLetteredAt: secondAt,
        lastFailureCode: "UNSUPPORTED_MEDIA",
        lastFailureMessage: "Unsupported codec",
      }),
      job({ id: "pending" }),
    ];

    expect(listDeadLetters(deadLetters).map((entry) => entry.jobId)).toEqual(["other", "mine"]);
    expect(listDeadLetters(deadLetters, { organizationId: "church-a" })).toEqual([{
      jobId: "mine",
      organizationId: "church-a",
      lane: "TRANSCRIPTION",
      attempts: 0,
      failureCode: "UNSUPPORTED_MEDIA",
      failureMessage: "Unsupported codec",
      deadLetteredAt: secondAt,
    }]);
  });
});
