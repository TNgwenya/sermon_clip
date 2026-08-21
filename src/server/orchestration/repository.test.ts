import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    orchestrationJob: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    orchestrationOutboxEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (transactionClient: typeof transaction) => unknown) => (
        callback(transaction)
      )),
      orchestrationJob: transaction.orchestrationJob,
      orchestrationOutboxEvent: {
        ...transaction.orchestrationOutboxEvent,
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import {
  acknowledgeOutboxPublish,
  appendOutboxDelivery,
  enqueueOrchestrationJob,
  OrchestrationIdempotencyConflictError,
  OutboxClaimLostError,
  recordOutboxPublishFailure,
} from "./repository";

const createdAt = new Date("2026-08-21T12:00:00.000Z");

function persistedJob(intentHash: string) {
  return {
    id: "job-1",
    organizationId: "org-1",
    sermonId: "sermon-1",
    lane: "TRANSCRIPTION",
    status: "PENDING",
    idempotencyKey: "ignored-in-fixture",
    intentHash,
    payloadVersion: 1,
    payloadJson: { source: "canonical-audio" },
    correlationId: "correlation-1",
    parentJobId: null,
    priority: 0,
    availableAt: createdAt,
    attemptCount: 0,
    maxAttempts: 3,
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
    createdAt,
    updatedAt: createdAt,
  };
}

describe("enqueueOrchestrationJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRaw.mockResolvedValue([{ lock: "1" }]);
  });

  it("writes the job and initial outbox delivery in one transaction", async () => {
    mocks.transaction.orchestrationJob.findUnique.mockResolvedValue(null);
    mocks.transaction.orchestrationJob.create.mockImplementation(async ({ data }) => ({
      ...persistedJob(data.intentHash),
      ...data,
      id: "job-1",
      status: "PENDING",
      attemptCount: 0,
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
      createdAt,
      updatedAt: createdAt,
    }));
    mocks.transaction.orchestrationOutboxEvent.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "outbox-1",
    }));

    const result = await enqueueOrchestrationJob({
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "TRANSCRIPTION",
      logicalKey: "canonical-transcript:v1",
      payload: { source: "canonical-audio" },
      correlationId: "correlation-1",
    });

    expect(result.created).toBe(true);
    expect(result.outboxMessageKey).toBe("orchestration-job:job-1:delivery:1");
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.orchestrationJob.create).toHaveBeenCalledOnce();
    expect(mocks.transaction.orchestrationOutboxEvent.create).toHaveBeenCalledOnce();
    expect(mocks.transaction.orchestrationOutboxEvent.create.mock.calls[0]?.[0].data.payloadJson).toMatchObject({
      jobId: "job-1",
      organizationId: "org-1",
      lane: "TRANSCRIPTION",
    });
  });

  it("returns the existing job for the same immutable intent", async () => {
    mocks.transaction.orchestrationJob.findUnique.mockImplementation(async ({ where }) => {
      const { buildOrchestrationIntentHash } = await import("./contracts");
      return {
        ...persistedJob(buildOrchestrationIntentHash({
          lane: "TRANSCRIPTION",
          sermonId: "sermon-1",
          parentJobId: null,
          payloadVersion: 1,
          payload: { source: "canonical-audio" },
        })),
        idempotencyKey: where.organizationId_idempotencyKey.idempotencyKey,
        outboxEvents: [{ messageKey: "existing-message" }],
      };
    });
    const result = await enqueueOrchestrationJob({
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "TRANSCRIPTION",
      logicalKey: "canonical-transcript:v1",
      payload: { source: "canonical-audio" },
    });
    expect(result).toMatchObject({ created: false, outboxMessageKey: "existing-message" });
    expect(mocks.transaction.orchestrationJob.create).not.toHaveBeenCalled();
    expect(mocks.transaction.orchestrationOutboxEvent.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key for a different payload", async () => {
    mocks.transaction.orchestrationJob.findUnique.mockResolvedValue({
      ...persistedJob("different-intent-hash"),
      outboxEvents: [{ messageKey: "existing-message" }],
    });
    await expect(enqueueOrchestrationJob({
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "TRANSCRIPTION",
      logicalKey: "canonical-transcript:v1",
      payload: { source: "canonical-audio" },
    })).rejects.toBeInstanceOf(OrchestrationIdempotencyConflictError);
  });
});

describe("outbox publication fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acknowledges publication only with the active claim token", async () => {
    mocks.prisma.orchestrationOutboxEvent.updateMany.mockResolvedValue({ count: 1 });
    await acknowledgeOutboxPublish(
      { id: "outbox-1", claimToken: "claim-1" },
      { providerMessageId: "provider-1", acceptedAt: createdAt },
    );
    expect(mocks.prisma.orchestrationOutboxEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "outbox-1", status: "PUBLISHING", claimToken: "claim-1" },
      data: expect.objectContaining({ status: "PUBLISHED", providerMessageId: "provider-1" }),
    }));
  });

  it("rejects a stale acknowledgement and dead-letters a non-retryable publish failure", async () => {
    mocks.prisma.orchestrationOutboxEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(acknowledgeOutboxPublish(
      { id: "outbox-1", claimToken: "stale-claim" },
      { providerMessageId: "provider-1", acceptedAt: createdAt },
    )).rejects.toBeInstanceOf(OutboxClaimLostError);

    mocks.prisma.orchestrationOutboxEvent.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(recordOutboxPublishFailure({
      claim: {
        id: "outbox-1",
        claimToken: "claim-2",
        publishAttemptCount: 1,
        maxPublishAttempts: 8,
      },
      error: new Error("invalid queue destination"),
      retryable: false,
      retryAt: new Date(createdAt.getTime() + 1_000),
    })).resolves.toBe("DEAD_LETTERED");
    expect(mocks.prisma.orchestrationOutboxEvent.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DEAD_LETTER" }),
    }));
  });

  it("appends a new immutable delivery generation for safe redrive", async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([{ id: "job-1" }]);
    mocks.transaction.orchestrationJob.findUnique.mockResolvedValue(persistedJob("intent-1"));
    mocks.transaction.orchestrationOutboxEvent.findFirst.mockResolvedValue({ deliverySequence: 2 });
    mocks.transaction.orchestrationOutboxEvent.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "outbox-3",
    }));
    await expect(appendOutboxDelivery("job-1", createdAt)).resolves.toBe(
      "orchestration-job:job-1:delivery:3",
    );
    expect(mocks.transaction.orchestrationOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliverySequence: 3,
        messageKey: "orchestration-job:job-1:delivery:3",
      }),
    }));
  });
});
