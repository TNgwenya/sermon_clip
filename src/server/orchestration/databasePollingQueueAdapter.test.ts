import { describe, expect, it } from "vitest";

import { DatabasePollingQueueAdapter } from "./databasePollingQueueAdapter";

describe("database polling queue adapter", () => {
  it("acknowledges the durable database signal without a cloud dependency", async () => {
    const now = new Date("2026-08-21T12:00:00Z");
    const adapter = new DatabasePollingQueueAdapter({ now: () => now });
    const receipt = await adapter.publish({
      schema: "sermon-clip.orchestration-job",
      schemaVersion: 1,
      messageKey: "orchestration-job:job-1:delivery:1",
      deliverySequence: 1,
      jobId: "job-1",
      organizationId: "org-1",
      sermonId: "sermon-1",
      lane: "INTAKE_MATERIALIZATION",
      idempotencyKey: "idempotency-1",
      intentHash: "intent-1",
      payloadVersion: 1,
      payload: {},
      correlationId: "correlation-1",
      parentJobId: null,
      priority: 100,
      availableAt: now.toISOString(),
      enqueuedAt: now.toISOString(),
    }, { lane: "INTAKE_MATERIALIZATION" });

    expect(receipt).toEqual({
      providerMessageId: "database-polling:orchestration-job:job-1:delivery:1",
      acceptedAt: now,
    });
  });
});
