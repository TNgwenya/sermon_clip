import { createHash } from "node:crypto";

export const ORCHESTRATION_LANES = [
  "INTAKE_MATERIALIZATION",
  "TRANSCRIPTION",
  "INTELLIGENCE",
  "PREVIEW",
  "FINAL_RENDER_EXPORT",
  "CONTENT_WEEK",
  "PUBLISHING",
] as const;

export type OrchestrationLane = (typeof ORCHESTRATION_LANES)[number];

export const ORCHESTRATION_JOB_STATUSES = [
  "PENDING",
  "LEASED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
] as const;

export type OrchestrationJobStatus = (typeof ORCHESTRATION_JOB_STATUSES)[number];

export type PortableJsonPrimitive = string | number | boolean | null;
export type PortableJsonValue =
  | PortableJsonPrimitive
  | PortableJsonValue[]
  | { [key: string]: PortableJsonValue };

export type OrchestrationJobRecord = {
  id: string;
  organizationId: string;
  sermonId: string | null;
  lane: OrchestrationLane;
  status: OrchestrationJobStatus;
  idempotencyKey: string;
  intentHash: string;
  payloadVersion: number;
  payloadJson: PortableJsonValue;
  correlationId: string;
  parentJobId: string | null;
  priority: number;
  availableAt: Date;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastFailureRetryable: boolean | null;
  deadLetteredAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrchestrationQueueEnvelope = {
  schema: "sermon-clip.orchestration-job";
  schemaVersion: 1;
  messageKey: string;
  deliverySequence: number;
  jobId: string;
  organizationId: string;
  sermonId: string | null;
  lane: OrchestrationLane;
  idempotencyKey: string;
  intentHash: string;
  payloadVersion: number;
  payload: PortableJsonValue;
  correlationId: string;
  parentJobId: string | null;
  priority: number;
  availableAt: string;
  enqueuedAt: string;
};

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains a value that is not portable JSON.`);
  }
  if (seen.has(value)) {
    throw new Error(`${path} contains a circular reference.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry, index) => canonicalize(entry, `${path}[${index}]`, seen)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain objects and arrays.`);
    }
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue).sort().map((key) => {
      const entry = objectValue[key];
      if (entry === undefined) {
        throw new Error(`${path}.${key} is undefined and cannot cross a queue boundary.`);
      }
      return `${JSON.stringify(key)}:${canonicalize(entry, `${path}.${key}`, seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalPortableJson(value: PortableJsonValue): string {
  return canonicalize(value, "payload", new Set());
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildOrchestrationIdempotencyKey(input: {
  organizationId: string;
  sermonId?: string | null;
  lane: OrchestrationLane;
  logicalKey: string;
}): string {
  const identity = canonicalPortableJson({
    lane: input.lane,
    logicalKey: requireNonEmpty(input.logicalKey, "logicalKey"),
    organizationId: requireNonEmpty(input.organizationId, "organizationId"),
    sermonId: input.sermonId ? requireNonEmpty(input.sermonId, "sermonId") : null,
  });
  return `orchestration:v1:${input.lane.toLowerCase()}:${sha256(identity)}`;
}

export function buildOrchestrationIntentHash(input: {
  lane: OrchestrationLane;
  sermonId?: string | null;
  parentJobId?: string | null;
  payloadVersion: number;
  payload: PortableJsonValue;
}): string {
  if (!Number.isInteger(input.payloadVersion) || input.payloadVersion < 1) {
    throw new Error("payloadVersion must be a positive integer.");
  }
  return sha256(canonicalPortableJson({
    lane: input.lane,
    parentJobId: input.parentJobId ?? null,
    payload: input.payload,
    payloadVersion: input.payloadVersion,
    sermonId: input.sermonId ?? null,
  }));
}

export function buildOutboxMessageKey(jobId: string, deliverySequence: number): string {
  if (!Number.isInteger(deliverySequence) || deliverySequence < 1) {
    throw new Error("deliverySequence must be a positive integer.");
  }
  return `orchestration-job:${requireNonEmpty(jobId, "jobId")}:delivery:${deliverySequence}`;
}

export function buildQueueEnvelope(input: {
  job: Pick<OrchestrationJobRecord,
    | "id"
    | "organizationId"
    | "sermonId"
    | "lane"
    | "idempotencyKey"
    | "intentHash"
    | "payloadVersion"
    | "payloadJson"
    | "correlationId"
    | "parentJobId"
    | "priority"
    | "availableAt">;
  deliverySequence: number;
  enqueuedAt: Date;
}): OrchestrationQueueEnvelope {
  canonicalPortableJson(input.job.payloadJson);
  return {
    schema: "sermon-clip.orchestration-job",
    schemaVersion: 1,
    messageKey: buildOutboxMessageKey(input.job.id, input.deliverySequence),
    deliverySequence: input.deliverySequence,
    jobId: input.job.id,
    organizationId: input.job.organizationId,
    sermonId: input.job.sermonId,
    lane: input.job.lane,
    idempotencyKey: input.job.idempotencyKey,
    intentHash: input.job.intentHash,
    payloadVersion: input.job.payloadVersion,
    payload: input.job.payloadJson,
    correlationId: input.job.correlationId,
    parentJobId: input.job.parentJobId,
    priority: input.job.priority,
    availableAt: input.job.availableAt.toISOString(),
    enqueuedAt: input.enqueuedAt.toISOString(),
  };
}
