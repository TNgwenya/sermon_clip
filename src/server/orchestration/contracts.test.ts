import { describe, expect, it } from "vitest";

import {
  buildOrchestrationIdempotencyKey,
  buildOrchestrationIntentHash,
  buildOutboxMessageKey,
  buildQueueEnvelope,
  canonicalPortableJson,
} from "./contracts";

describe("portable orchestration contracts", () => {
  it("canonicalizes object keys for deterministic identities", () => {
    expect(canonicalPortableJson({ beta: 2, alpha: { z: true, a: null } })).toBe(
      '{"alpha":{"a":null,"z":true},"beta":2}',
    );
    const first = buildOrchestrationIdempotencyKey({
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "TRANSCRIPTION",
      logicalKey: "canonical-transcript:v1",
    });
    const second = buildOrchestrationIdempotencyKey({
      logicalKey: "canonical-transcript:v1",
      lane: "TRANSCRIPTION",
      sermonId: "sermon-1",
      organizationId: "org-1",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^orchestration:v1:transcription:[a-f0-9]{64}$/);
  });

  it("binds an idempotency identity to an immutable payload intent", () => {
    const base = {
      lane: "PREVIEW" as const,
      sermonId: "sermon-1",
      payloadVersion: 1,
      payload: { clipCandidateId: "clip-1", rank: 1 },
    };
    expect(buildOrchestrationIntentHash(base)).not.toBe(buildOrchestrationIntentHash({
      ...base,
      payload: { clipCandidateId: "clip-2", rank: 1 },
    }));
  });

  it("rejects values that cannot safely cross a vendor-neutral queue boundary", () => {
    expect(() => canonicalPortableJson({ createdAt: new Date() } as never)).toThrow(/plain objects/);
    expect(() => canonicalPortableJson({ missing: undefined } as never)).toThrow(/undefined/);
    expect(() => canonicalPortableJson({ score: Number.NaN })).toThrow(/non-finite/);
  });

  it("builds a versioned envelope and delivery-specific message key", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const job = {
      id: "job-1",
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "PREVIEW",
      idempotencyKey: "idem-1",
      intentHash: "hash-1",
      payloadVersion: 1,
      payloadJson: { clipCandidateId: "clip-1" },
      correlationId: "correlation-1",
      parentJobId: "parent-1",
      priority: 100,
      availableAt: now,
    } satisfies Parameters<typeof buildQueueEnvelope>[0]["job"];
    const envelope = buildQueueEnvelope({ job, deliverySequence: 2, enqueuedAt: now });
    expect(envelope).toMatchObject({
      schema: "sermon-clip.orchestration-job",
      schemaVersion: 1,
      messageKey: "orchestration-job:job-1:delivery:2",
      jobId: "job-1",
      lane: "PREVIEW",
      payload: { clipCandidateId: "clip-1" },
    });
    expect(buildOutboxMessageKey("job-1", 3)).toBe("orchestration-job:job-1:delivery:3");
  });
});
