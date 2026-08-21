import { describe, expect, it, vi } from "vitest";

import type { OrchestrationJobRecord, OrchestrationJobStatus } from "./contracts";
import {
  createPrismaSchedulerStore,
  SchedulerTransitionDeniedError,
  type PrismaSchedulerClient,
} from "./prismaSchedulerStore";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const LEASE = { owner: "worker-1", token: "token-1" } as const;

function job(overrides: Partial<OrchestrationJobRecord> = {}): OrchestrationJobRecord {
  return {
    id: "job-1",
    organizationId: "church-a",
    sermonId: "sermon-1",
    lane: "TRANSCRIPTION",
    status: "PENDING",
    idempotencyKey: "idem-1",
    intentHash: "intent-1",
    payloadVersion: 1,
    payloadJson: { sermonId: "sermon-1" },
    correlationId: "correlation-1",
    parentJobId: null,
    priority: 0,
    availableAt: new Date("2026-08-21T11:00:00.000Z"),
    attemptCount: 0,
    maxAttempts: 4,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    cancellationReason: null,
    cancelledAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    deadLetteredAt: null,
    completedAt: null,
    createdAt: new Date("2026-08-21T10:00:00.000Z"),
    updatedAt: new Date("2026-08-21T10:00:00.000Z"),
    ...overrides,
  };
}

function leasedJob(overrides: Partial<OrchestrationJobRecord> = {}): OrchestrationJobRecord {
  return job({
    status: "LEASED",
    attemptCount: 1,
    leaseOwner: LEASE.owner,
    leaseToken: LEASE.token,
    leaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
    ...overrides,
  });
}

type OutboxRecord = {
  organizationId: string;
  orchestrationJobId: string;
  deliverySequence: number;
  data?: Record<string, unknown>;
};

function matchesWhere(candidate: OrchestrationJobRecord, where: Record<string, unknown>): boolean {
  if (typeof where.id === "string" && candidate.id !== where.id) return false;
  if (typeof where.organizationId === "string" && candidate.organizationId !== where.organizationId) return false;
  if (where.organizationId && typeof where.organizationId === "object" && "in" in where.organizationId) {
    if (!(where.organizationId.in as string[]).includes(candidate.organizationId)) return false;
  }
  if (typeof where.status === "string" && candidate.status !== where.status) return false;
  if (where.status && typeof where.status === "object" && "in" in where.status) {
    if (!(where.status.in as OrchestrationJobStatus[]).includes(candidate.status)) return false;
  }
  if (typeof where.lane === "string" && candidate.lane !== where.lane) return false;
  if (where.cancelRequestedAt === null && candidate.cancelRequestedAt !== null) return false;
  if (typeof where.leaseOwner === "string" && candidate.leaseOwner !== where.leaseOwner) return false;
  if (typeof where.leaseToken === "string" && candidate.leaseToken !== where.leaseToken) return false;
  if (where.updatedAt instanceof Date && candidate.updatedAt.getTime() !== where.updatedAt.getTime()) return false;
  if (where.availableAt && typeof where.availableAt === "object" && "lte" in where.availableAt) {
    if (candidate.availableAt.getTime() > (where.availableAt.lte as Date).getTime()) return false;
  }
  if (where.leaseExpiresAt && typeof where.leaseExpiresAt === "object" && "lte" in where.leaseExpiresAt) {
    if (!candidate.leaseExpiresAt || candidate.leaseExpiresAt.getTime() > (where.leaseExpiresAt.lte as Date).getTime()) return false;
  }
  return true;
}

function harness(seed: OrchestrationJobRecord[], initialOutbox: OutboxRecord[] = []) {
  const jobs = new Map(seed.map((entry) => [entry.id, structuredClone(entry)]));
  const outbox = [...initialOutbox];
  const audits: Record<string, unknown>[] = [];
  let updateClock = NOW.getTime();

  const transaction = {
    orchestrationJob: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        const matching = [...jobs.values()].filter((entry) => matchesWhere(entry, where));
        return matching.slice(0, typeof args.take === "number" ? args.take : matching.length);
      }),
      findUnique: vi.fn(async (args: Record<string, unknown>) => {
        const compound = (args.where as { id_organizationId: { id: string; organizationId: string } }).id_organizationId;
        const found = jobs.get(compound.id);
        return found?.organizationId === compound.organizationId ? structuredClone(found) : null;
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = args.where as Record<string, unknown>;
        const found = [...jobs.values()].find((entry) => matchesWhere(entry, where));
        if (!found) return { count: 0 };
        const updated = {
          ...found,
          ...(args.data as Partial<OrchestrationJobRecord>),
          updatedAt: new Date(updateClock += 1),
        };
        jobs.set(found.id, updated);
        return { count: 1 };
      }),
    },
    orchestrationOutboxEvent: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = args.where as { organizationId: string; orchestrationJobId: string };
        const prior = outbox
          .filter((entry) => (
            entry.organizationId === where.organizationId
            && entry.orchestrationJobId === where.orchestrationJobId
          ))
          .sort((left, right) => right.deliverySequence - left.deliverySequence)[0];
        return prior ? { deliverySequence: prior.deliverySequence } : null;
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        const data = args.data as Record<string, unknown>;
        outbox.push({
          organizationId: data.organizationId as string,
          orchestrationJobId: data.orchestrationJobId as string,
          deliverySequence: data.deliverySequence as number,
          data,
        });
        return data;
      }),
    },
    auditEvent: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        audits.push(args);
        return args;
      }),
    },
  };
  const client = {
    ...transaction,
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction)),
  } as unknown as PrismaSchedulerClient;

  return { client, transaction, jobs, outbox, audits };
}

describe("PrismaSchedulerStore", () => {
  it("fairly claims the least recently served church with a fenced lease", async () => {
    const db = harness([
      job({ id: "a-pending", organizationId: "church-a", idempotencyKey: "a" }),
      job({ id: "b-pending", organizationId: "church-b", idempotencyKey: "b" }),
      job({
        id: "a-prior",
        organizationId: "church-a",
        status: "SUCCEEDED",
        idempotencyKey: "a-prior",
        completedAt: new Date("2026-08-21T11:59:00Z"),
        updatedAt: new Date("2026-08-21T11:59:00Z"),
      }),
      job({
        id: "b-prior",
        organizationId: "church-b",
        status: "SUCCEEDED",
        idempotencyKey: "b-prior",
        completedAt: new Date("2026-08-21T11:00:00Z"),
        updatedAt: new Date("2026-08-21T11:00:00Z"),
      }),
    ]);
    const store = createPrismaSchedulerStore({ client: db.client, randomUUID: () => "new-token" });

    const claimed = await store.claimFair({
      workerId: "worker-2",
      leaseDurationMs: 60_000,
      now: NOW,
    });

    expect(claimed).toMatchObject({
      job: {
        id: "b-pending",
        status: "LEASED",
        attemptCount: 1,
        leaseOwner: "worker-2",
        leaseToken: "new-token",
        leaseExpiresAt: new Date("2026-08-21T12:01:00Z"),
      },
      lease: { owner: "worker-2", token: "new-token" },
    });
    expect(db.transaction.orchestrationJob.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      distinct: ["organizationId"],
    }));
  });

  it("fences lease renewal and completion by organization, owner, and token", async () => {
    const db = harness([leasedJob()]);
    const store = createPrismaSchedulerStore({ client: db.client });

    await expect(store.renew({
      organizationId: "church-a",
      jobId: "job-1",
      lease: { ...LEASE, token: "stale" },
      leaseDurationMs: 60_000,
      now: NOW,
    })).rejects.toMatchObject({
      name: "SchedulerTransitionDeniedError",
      code: "LEASE_OWNERSHIP_LOST",
    });
    await expect(store.complete({
      organizationId: "church-b",
      jobId: "job-1",
      lease: LEASE,
      now: NOW,
    })).rejects.toThrow("was not found in organization church-b");

    const completed = await store.complete({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      now: NOW,
    });
    expect(completed).toMatchObject({ status: "SUCCEEDED", leaseToken: null, completedAt: NOW });
  });

  it("atomically completes a stage and creates its optional follow-on intent", async () => {
    const parent = leasedJob();
    const child = job({
      id: "child-1",
      lane: "INTELLIGENCE",
      status: "PENDING",
      idempotencyKey: "child-idempotency",
      parentJobId: parent.id,
    });
    const db = harness([parent]);
    const enqueueInTransaction = vi.fn(async (transaction, input) => {
      expect(transaction).toBe(db.transaction);
      expect(db.jobs.get(parent.id)?.status).toBe("SUCCEEDED");
      expect(input).toMatchObject({
        organizationId: "church-a",
        sermonId: "sermon-1",
        parentJobId: "job-1",
        correlationId: "correlation-1",
        lane: "INTELLIGENCE",
      });
      return { job: child, created: true, outboxMessageKey: "child-message" };
    });
    const store = createPrismaSchedulerStore({ client: db.client, enqueueInTransaction });

    const result = await store.completeAndEnqueueFollowOn({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      now: NOW,
      followOn: {
        lane: "INTELLIGENCE",
        logicalKey: "sermon-1:intelligence:v1",
        payload: { sermonId: "sermon-1" },
      },
    });

    expect(result).toMatchObject({
      completed: { id: "job-1", status: "SUCCEEDED" },
      followOn: { job: { id: "child-1" }, created: true },
    });
    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    expect(enqueueInTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue a follow-on when completion loses its CAS", async () => {
    const db = harness([leasedJob()]);
    db.transaction.orchestrationJob.updateMany.mockResolvedValueOnce({ count: 0 });
    const enqueueInTransaction = vi.fn();
    const store = createPrismaSchedulerStore({ client: db.client, enqueueInTransaction });

    await expect(store.completeAndEnqueueFollowOn({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      now: NOW,
      followOn: {
        lane: "INTELLIGENCE",
        logicalKey: "sermon-1:intelligence:v1",
        payload: { sermonId: "sermon-1" },
      },
    })).rejects.toMatchObject({ name: "SchedulerTransitionConflictError" });

    expect(enqueueInTransaction).not.toHaveBeenCalled();
  });

  it("records cancellation reason and lets a leased worker acknowledge at a safe boundary", async () => {
    const db = harness([leasedJob()]);
    const store = createPrismaSchedulerStore({ client: db.client });

    const requested = await store.requestCancel({
      organizationId: "church-a",
      jobId: "job-1",
      reason: "Pastor withdrew this upload",
      now: NOW,
    });
    expect(requested).toMatchObject({
      status: "LEASED",
      cancelRequestedAt: NOW,
      cancellationReason: "Pastor withdrew this upload",
    });

    const cancelled = await store.acknowledgeCancel({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      now: new Date("2026-08-21T12:00:01Z"),
    });
    expect(cancelled).toMatchObject({ status: "CANCELLED", leaseToken: null });
  });

  it("atomically appends a new immutable delivery when retry is scheduled", async () => {
    const db = harness([leasedJob()], [{
      organizationId: "church-a",
      orchestrationJobId: "job-1",
      deliverySequence: 1,
    }]);
    const store = createPrismaSchedulerStore({ client: db.client, random: () => 0.5 });

    const failed = await store.fail({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      failureCode: "TRANSIENT_NETWORK",
      failureMessage: "Connection reset",
      now: NOW,
    });

    expect(failed).toMatchObject({
      status: "PENDING",
      availableAt: new Date("2026-08-21T12:00:10Z"),
      lastFailureRetryable: true,
    });
    expect(db.outbox).toHaveLength(2);
    expect(db.outbox[1]).toMatchObject({
      organizationId: "church-a",
      orchestrationJobId: "job-1",
      deliverySequence: 2,
      data: {
        messageKey: "orchestration-job:job-1:delivery:2",
        availableAt: new Date("2026-08-21T12:00:10Z"),
      },
    });
  });

  it("dead-letters a non-retryable failure without publishing another delivery", async () => {
    const db = harness([leasedJob()], [{
      organizationId: "church-a",
      orchestrationJobId: "job-1",
      deliverySequence: 1,
    }]);
    const store = createPrismaSchedulerStore({ client: db.client });

    const failed = await store.fail({
      organizationId: "church-a",
      jobId: "job-1",
      lease: LEASE,
      failureCode: "UNSUPPORTED_MEDIA",
      failureMessage: "Unsupported codec",
      now: NOW,
    });

    expect(failed).toMatchObject({ status: "DEAD_LETTER", deadLetteredAt: NOW });
    expect(db.outbox).toHaveLength(1);
  });

  it("recovers expired leases and redelivers only retryable jobs", async () => {
    const db = harness([
      leasedJob({
        id: "retry",
        leaseExpiresAt: new Date("2026-08-21T11:59:00Z"),
        idempotencyKey: "retry",
      }),
      leasedJob({
        id: "exhausted",
        attemptCount: 4,
        leaseExpiresAt: new Date("2026-08-21T11:58:00Z"),
        idempotencyKey: "exhausted",
      }),
    ]);
    const store = createPrismaSchedulerStore({ client: db.client, random: () => 0.5 });

    const recovered = await store.recoverExpired({ now: NOW });

    expect(recovered.map((entry) => [entry.id, entry.status])).toEqual([
      ["retry", "PENDING"],
      ["exhausted", "DEAD_LETTER"],
    ]);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({ orchestrationJobId: "retry", deliverySequence: 1 });
  });

  it("keeps dead-letter visibility explicitly tenant-scoped", async () => {
    const db = harness([
      job({
        id: "mine",
        organizationId: "church-a",
        status: "DEAD_LETTER",
        deadLetteredAt: new Date("2026-08-21T11:00:00Z"),
      }),
      job({
        id: "other",
        organizationId: "church-b",
        status: "DEAD_LETTER",
        deadLetteredAt: new Date("2026-08-21T10:00:00Z"),
      }),
    ]);
    const store = createPrismaSchedulerStore({ client: db.client });

    const visible = await store.listDeadLetters({ organizationId: "church-a" });

    expect(visible.map((entry) => entry.jobId)).toEqual(["mine"]);
    expect(db.transaction.orchestrationJob.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "church-a", status: "DEAD_LETTER" }),
    }));
  });

  it("replay is stale-safe, audited, and creates the next outbox delivery", async () => {
    const terminalAt = new Date("2026-08-21T11:30:00Z");
    const db = harness([job({
      status: "DEAD_LETTER",
      attemptCount: 4,
      deadLetteredAt: terminalAt,
      completedAt: terminalAt,
      lastFailureCode: "UNSUPPORTED_MEDIA",
      lastFailureMessage: "Old source was unsupported",
      lastFailureRetryable: false,
    })], [{ organizationId: "church-a", orchestrationJobId: "job-1", deliverySequence: 3 }]);
    const store = createPrismaSchedulerStore({ client: db.client });

    await expect(store.replay({
      organizationId: "church-a",
      jobId: "job-1",
      expectedStatus: "DEAD_LETTER",
      expectedTerminalAt: new Date("2026-08-21T11:29:59Z"),
      operatorReason: "Source file was replaced",
      actorType: "SUPPORT",
      resetAttempts: true,
      now: NOW,
    })).rejects.toBeInstanceOf(SchedulerTransitionDeniedError);

    const replayed = await store.replay({
      organizationId: "church-a",
      jobId: "job-1",
      expectedStatus: "DEAD_LETTER",
      expectedTerminalAt: terminalAt,
      operatorReason: "Source file was replaced",
      actorType: "SUPPORT",
      resetAttempts: true,
      now: NOW,
    });

    expect(replayed).toMatchObject({ status: "PENDING", attemptCount: 0, deadLetteredAt: null });
    expect(db.outbox.at(-1)).toMatchObject({ deliverySequence: 4, orchestrationJobId: "job-1" });
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      data: {
        organizationId: "church-a",
        action: "orchestration.job.replayed",
        metadataJson: expect.objectContaining({ reason: "Source file was replaced" }),
      },
    });
  });
});
