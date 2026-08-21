import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  buildOrchestrationIdempotencyKey,
  buildOrchestrationIntentHash,
  buildQueueEnvelope,
  canonicalPortableJson,
  type OrchestrationJobRecord,
  type OrchestrationLane,
  type OrchestrationQueueEnvelope,
  type PortableJsonValue,
} from "./contracts";
import {
  QueuePublishError,
  type OrchestrationQueueAdapter,
  type QueuePublishReceipt,
} from "./queueAdapter";

const OUTBOX_TOPIC = "sermon-clip.orchestration.v1";
const OUTBOX_CLAIM_LIMIT = 8;

export type EnqueueOrchestrationJobInput = {
  organizationId: string;
  sermonId?: string | null;
  lane: OrchestrationLane;
  logicalKey: string;
  payload: PortableJsonValue;
  payloadVersion?: number;
  correlationId?: string;
  parentJobId?: string | null;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
};

export type EnqueueOrchestrationJobResult = {
  job: OrchestrationJobRecord;
  created: boolean;
  outboxMessageKey: string;
};

export type ClaimedOutboxEvent = {
  id: string;
  organizationId: string;
  orchestrationJobId: string;
  deliverySequence: number;
  claimToken: string;
  publishAttemptCount: number;
  maxPublishAttempts: number;
  envelope: OrchestrationQueueEnvelope;
  lane: OrchestrationLane;
  availableAt: Date;
};

export class OrchestrationIdempotencyConflictError extends Error {
  readonly jobId: string;
  readonly idempotencyKey: string;

  constructor(job: { id: string; idempotencyKey: string }) {
    super("The orchestration idempotency key is already bound to a different immutable intent.");
    this.name = "OrchestrationIdempotencyConflictError";
    this.jobId = job.id;
    this.idempotencyKey = job.idempotencyKey;
  }
}

export class OutboxClaimLostError extends Error {
  constructor(eventId: string) {
    super(`Outbox claim was lost before event ${eventId} could be updated.`);
    this.name = "OutboxClaimLostError";
  }
}

function asInputJson(value: PortableJsonValue): Prisma.InputJsonValue {
  canonicalPortableJson(value);
  return value as Prisma.InputJsonValue;
}

function asPortableJson(value: Prisma.JsonValue): PortableJsonValue {
  canonicalPortableJson(value as PortableJsonValue);
  return value as PortableJsonValue;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return resolved;
}

function finiteInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || !Number.isSafeInteger(resolved)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return resolved;
}

function normalizeInput(input: EnqueueOrchestrationJobInput) {
  const payloadVersion = positiveInteger(input.payloadVersion, 1, "payloadVersion");
  const maxAttempts = positiveInteger(input.maxAttempts, 3, "maxAttempts");
  const priority = finiteInteger(input.priority, 0, "priority");
  const idempotencyKey = buildOrchestrationIdempotencyKey(input);
  const intentHash = buildOrchestrationIntentHash({
    lane: input.lane,
    sermonId: input.sermonId,
    parentJobId: input.parentJobId,
    payloadVersion,
    payload: input.payload,
  });
  return {
    ...input,
    sermonId: input.sermonId ?? null,
    parentJobId: input.parentJobId ?? null,
    payloadVersion,
    maxAttempts,
    priority,
    idempotencyKey,
    intentHash,
    correlationId: input.correlationId?.trim() || randomUUID(),
    availableAt: input.availableAt ?? new Date(),
  };
}

function assertIntentMatches(
  existing: { id: string; idempotencyKey: string; intentHash: string },
  intentHash: string,
): void {
  if (existing.intentHash !== intentHash) {
    throw new OrchestrationIdempotencyConflictError(existing);
  }
}

function jobRecord(job: {
  payloadJson: Prisma.JsonValue;
} & Omit<OrchestrationJobRecord, "payloadJson">): OrchestrationJobRecord {
  return { ...job, payloadJson: asPortableJson(job.payloadJson) };
}

function envelopeFromJson(value: Prisma.JsonValue): OrchestrationQueueEnvelope {
  canonicalPortableJson(value as PortableJsonValue);
  const envelope = value as unknown as OrchestrationQueueEnvelope;
  if (envelope.schema !== "sermon-clip.orchestration-job" || envelope.schemaVersion !== 1) {
    throw new Error("Outbox event contains an unsupported orchestration envelope.");
  }
  return envelope;
}

export type OrchestrationTransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Atomically persists the immutable job intent and its initial queue delivery.
 * Publishing is deliberately separate: an outbox dispatcher may retry it
 * without ever losing the database commit or creating a second logical job.
 */
export async function enqueueOrchestrationJob(
  input: EnqueueOrchestrationJobInput,
): Promise<EnqueueOrchestrationJobResult> {
  return prisma.$transaction((transaction) => enqueueOrchestrationJobInTransaction(transaction, input));
}

/**
 * Transaction-aware variant for atomically writing a domain checkpoint and
 * its follow-on orchestration job. A short advisory transaction lock closes
 * the concurrent first-enqueue race without relying on a failed transaction.
 */
export async function enqueueOrchestrationJobInTransaction(
  transaction: OrchestrationTransactionClient,
  input: EnqueueOrchestrationJobInput,
): Promise<EnqueueOrchestrationJobResult> {
  const normalized = normalizeInput(input);
  const lockKey = `orchestration-enqueue:${normalized.organizationId}:${normalized.idempotencyKey}`;
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"
  `;
  const existing = await transaction.orchestrationJob.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: normalized.organizationId,
        idempotencyKey: normalized.idempotencyKey,
      },
    },
    include: { outboxEvents: { orderBy: { deliverySequence: "asc" }, take: 1 } },
  });
  if (existing) {
    assertIntentMatches(existing, normalized.intentHash);
    const initialOutbox = existing.outboxEvents[0];
    if (!initialOutbox) throw new Error(`Orchestration job ${existing.id} has no outbox event.`);
    return {
      job: jobRecord(existing),
      created: false,
      outboxMessageKey: initialOutbox.messageKey,
    };
  }

  const created = await transaction.orchestrationJob.create({
    data: {
      organizationId: normalized.organizationId,
      sermonId: normalized.sermonId,
      lane: normalized.lane,
      idempotencyKey: normalized.idempotencyKey,
      intentHash: normalized.intentHash,
      payloadVersion: normalized.payloadVersion,
      payloadJson: asInputJson(normalized.payload),
      correlationId: normalized.correlationId,
      parentJobId: normalized.parentJobId,
      priority: normalized.priority,
      availableAt: normalized.availableAt,
      maxAttempts: normalized.maxAttempts,
    },
  });
  const envelope = buildQueueEnvelope({
    job: jobRecord(created),
    deliverySequence: 1,
    enqueuedAt: new Date(),
  });
  const outbox = await transaction.orchestrationOutboxEvent.create({
    data: {
      organizationId: created.organizationId,
      orchestrationJobId: created.id,
      deliverySequence: 1,
      topic: OUTBOX_TOPIC,
      messageKey: envelope.messageKey,
      payloadVersion: envelope.schemaVersion,
      payloadJson: asInputJson(envelope),
      availableAt: created.availableAt,
    },
  });
  return { job: jobRecord(created), created: true, outboxMessageKey: outbox.messageKey };
}

/** Append-only redrive: prior delivery attempts remain available for audit. */
export async function appendOutboxDelivery(jobId: string, now = new Date()): Promise<string> {
  return prisma.$transaction((transaction) => appendOutboxDeliveryInTransaction(transaction, jobId, now));
}

export async function appendOutboxDeliveryInTransaction(
  transaction: OrchestrationTransactionClient,
  jobId: string,
  now = new Date(),
): Promise<string> {
  await transaction.$queryRaw`
    SELECT "id" FROM "OrchestrationJob" WHERE "id" = ${jobId} FOR UPDATE
  `;
  const job = await transaction.orchestrationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Orchestration job ${jobId} was not found.`);
  const previous = await transaction.orchestrationOutboxEvent.findFirst({
    where: { orchestrationJobId: jobId },
    orderBy: { deliverySequence: "desc" },
    select: { deliverySequence: true },
  });
  const deliverySequence = (previous?.deliverySequence ?? 0) + 1;
  const envelope = buildQueueEnvelope({
    job: jobRecord(job),
    deliverySequence,
    enqueuedAt: now,
  });
  const outbox = await transaction.orchestrationOutboxEvent.create({
    data: {
      organizationId: job.organizationId,
      orchestrationJobId: job.id,
      deliverySequence,
      topic: OUTBOX_TOPIC,
      messageKey: envelope.messageKey,
      payloadVersion: envelope.schemaVersion,
      payloadJson: asInputJson(envelope),
      availableAt: now,
    },
  });
  return outbox.messageKey;
}

export async function claimNextOutboxEvent(input: {
  dispatcherId: string;
  leaseDurationMs: number;
  now?: Date;
}): Promise<ClaimedOutboxEvent | null> {
  const now = input.now ?? new Date();
  const leaseDurationMs = positiveInteger(input.leaseDurationMs, 30_000, "leaseDurationMs");
  const dispatcherId = input.dispatcherId.trim();
  if (!dispatcherId) throw new Error("dispatcherId must not be empty.");

  for (let claimAttempt = 0; claimAttempt < OUTBOX_CLAIM_LIMIT; claimAttempt += 1) {
    const claimed = await prisma.$transaction(async (transaction) => {
      const candidate = await transaction.orchestrationOutboxEvent.findFirst({
        where: {
          OR: [
            { status: "PENDING", availableAt: { lte: now } },
            { status: "PUBLISHING", claimExpiresAt: { lt: now } },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        include: { orchestrationJob: { select: { lane: true } } },
      });
      if (!candidate) return null;
      if (candidate.publishAttemptCount >= candidate.maxPublishAttempts) {
        await transaction.orchestrationOutboxEvent.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            publishAttemptCount: candidate.publishAttemptCount,
          },
          data: {
            status: "DEAD_LETTER",
            claimOwner: null,
            claimToken: null,
            claimExpiresAt: null,
            lastError: candidate.lastError ?? "Outbox publish attempts were exhausted.",
          },
        });
        return undefined;
      }
      const claimToken = randomUUID();
      const claimExpiresAt = new Date(now.getTime() + leaseDurationMs);
      const result = await transaction.orchestrationOutboxEvent.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { status: "PENDING", availableAt: { lte: now } },
            { status: "PUBLISHING", claimExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: "PUBLISHING",
          claimOwner: dispatcherId,
          claimToken,
          claimExpiresAt,
          publishAttemptCount: { increment: 1 },
        },
      });
      if (result.count !== 1) return undefined;
      return {
        id: candidate.id,
        organizationId: candidate.organizationId,
        orchestrationJobId: candidate.orchestrationJobId,
        deliverySequence: candidate.deliverySequence,
        claimToken,
        publishAttemptCount: candidate.publishAttemptCount + 1,
        maxPublishAttempts: candidate.maxPublishAttempts,
        envelope: envelopeFromJson(candidate.payloadJson),
        lane: candidate.orchestrationJob.lane,
        availableAt: candidate.availableAt,
      } satisfies ClaimedOutboxEvent;
    });
    if (claimed !== undefined) return claimed;
  }
  return null;
}

export async function acknowledgeOutboxPublish(
  claim: Pick<ClaimedOutboxEvent, "id" | "claimToken">,
  receipt: QueuePublishReceipt,
): Promise<void> {
  const result = await prisma.orchestrationOutboxEvent.updateMany({
    where: { id: claim.id, status: "PUBLISHING", claimToken: claim.claimToken },
    data: {
      status: "PUBLISHED",
      publishedAt: receipt.acceptedAt,
      providerMessageId: receipt.providerMessageId,
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
      lastError: null,
    },
  });
  if (result.count !== 1) throw new OutboxClaimLostError(claim.id);
}

export async function recordOutboxPublishFailure(input: {
  claim: Pick<ClaimedOutboxEvent, "id" | "claimToken" | "publishAttemptCount" | "maxPublishAttempts">;
  error: unknown;
  retryable: boolean;
  retryAt: Date;
}): Promise<"RETRY_SCHEDULED" | "DEAD_LETTERED"> {
  const exhausted = input.claim.publishAttemptCount >= input.claim.maxPublishAttempts;
  const deadLettered = exhausted || !input.retryable;
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const result = await prisma.orchestrationOutboxEvent.updateMany({
    where: { id: input.claim.id, status: "PUBLISHING", claimToken: input.claim.claimToken },
    data: {
      status: deadLettered ? "DEAD_LETTER" : "PENDING",
      availableAt: deadLettered ? undefined : input.retryAt,
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
      lastError: message.slice(0, 4_000),
    },
  });
  if (result.count !== 1) throw new OutboxClaimLostError(input.claim.id);
  return deadLettered ? "DEAD_LETTERED" : "RETRY_SCHEDULED";
}

export async function dispatchNextOutboxEvent(input: {
  adapter: OrchestrationQueueAdapter;
  dispatcherId: string;
  leaseDurationMs?: number;
  now?: Date;
}): Promise<"IDLE" | "PUBLISHED" | "RETRY_SCHEDULED" | "DEAD_LETTERED"> {
  const now = input.now ?? new Date();
  const claim = await claimNextOutboxEvent({
    dispatcherId: input.dispatcherId,
    leaseDurationMs: input.leaseDurationMs ?? 30_000,
    now,
  });
  if (!claim) return "IDLE";
  try {
    const receipt = await input.adapter.publish(claim.envelope, {
      lane: claim.lane,
      notBefore: claim.availableAt,
    });
    await acknowledgeOutboxPublish(claim, receipt);
    return "PUBLISHED";
  } catch (error) {
    const retryable = error instanceof QueuePublishError ? error.retryable : true;
    const delayMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, claim.publishAttemptCount - 1)));
    return recordOutboxPublishFailure({
      claim,
      error,
      retryable,
      retryAt: new Date(now.getTime() + delayMs),
    });
  }
}
