import { describe, expect, it } from "vitest";

import type { OrchestrationQueueEnvelope } from "./contracts";
import { InMemoryOrchestrationQueueAdapter } from "./inMemoryQueueAdapter";

function envelope(messageKey: string, lane: OrchestrationQueueEnvelope["lane"]): OrchestrationQueueEnvelope {
  return {
    schema: "sermon-clip.orchestration-job",
    schemaVersion: 1,
    messageKey,
    deliverySequence: 1,
    jobId: `job:${messageKey}`,
    organizationId: "org-1",
    sermonId: "sermon-1",
    lane,
    idempotencyKey: `idem:${messageKey}`,
    intentHash: `hash:${messageKey}`,
    payloadVersion: 1,
    payload: { safe: true },
    correlationId: "correlation-1",
    parentJobId: null,
    priority: 0,
    availableAt: "2026-08-21T12:00:00.000Z",
    enqueuedAt: "2026-08-21T12:00:00.000Z",
  };
}

describe("InMemoryOrchestrationQueueAdapter", () => {
  it("deduplicates a dispatcher retry by immutable message key", async () => {
    const adapter = new InMemoryOrchestrationQueueAdapter({
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });
    const message = envelope("message-1", "PREVIEW");
    const first = await adapter.publish(message, { lane: "PREVIEW" });
    const retried = await adapter.publish(message, { lane: "PREVIEW" });
    expect(retried).toEqual(first);
    expect(adapter.messages()).toHaveLength(1);
  });

  it("supports lane-selective deterministic consumption in tests", async () => {
    const adapter = new InMemoryOrchestrationQueueAdapter();
    await adapter.publish(envelope("transcribe", "TRANSCRIPTION"), { lane: "TRANSCRIPTION" });
    await adapter.publish(envelope("preview", "PREVIEW"), { lane: "PREVIEW" });
    expect(adapter.takeNext("PREVIEW")?.envelope.messageKey).toBe("preview");
    expect(adapter.takeNext()?.envelope.messageKey).toBe("transcribe");
    expect(adapter.takeNext()).toBeNull();
  });
});
