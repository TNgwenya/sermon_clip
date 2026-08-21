import { describe, expect, it, vi } from "vitest";

import type { OrchestrationJobRecord } from "./contracts";
import { runClaimedOrchestrationJob } from "./orchestrationWorkerRuntime";
import { buildSermonWorkflowPayload } from "./sermonWorkflow";

const payload = buildSermonWorkflowPayload({ sermonId: "sermon-1", sourceRevision: "revision-1" });
const job: OrchestrationJobRecord = {
  id: "job-1", organizationId: "org-1", sermonId: "sermon-1",
  lane: "INTELLIGENCE", status: "LEASED", idempotencyKey: "key", intentHash: "intent",
  payloadVersion: 1, payloadJson: payload, correlationId: "correlation-1", parentJobId: null,
  priority: 100, availableAt: new Date(), attemptCount: 1, maxAttempts: 3,
  leaseOwner: "worker-1", leaseToken: "token-1", leaseExpiresAt: new Date(Date.now() + 60_000),
  cancelRequestedAt: null, cancellationReason: null, cancelledAt: null,
  lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null,
  deadLetteredAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const lease = { owner: "worker-1", token: "token-1" };

function store() {
  return {
    completeAndEnqueueFollowOn: vi.fn().mockResolvedValue({}),
    acknowledgeCancel: vi.fn().mockResolvedValue({}),
    fail: vi.fn().mockResolvedValue({}),
  };
}

describe("orchestration worker runtime", () => {
  it("atomically completes intelligence and enqueues the priority preview child", async () => {
    const target = store();
    await expect(runClaimedOrchestrationJob({
      job,
      lease,
      store: target,
      execute: vi.fn().mockResolvedValue({
        completion: { lane: "INTELLIGENCE", suggestionsReady: true },
        summary: "suggestions ready",
        evidence: {},
      }),
    })).resolves.toBe("SUCCEEDED");
    expect(target.completeAndEnqueueFollowOn).toHaveBeenCalledWith(expect.objectContaining({
      followOn: expect.objectContaining({ lane: "PREVIEW", priority: 100, sermonId: "sermon-1" }),
    }));
    expect(target.fail).not.toHaveBeenCalled();
  });

  it("records a reason-aware stage failure without completing", async () => {
    const target = store();
    await runClaimedOrchestrationJob({
      job,
      lease,
      store: target,
      execute: vi.fn().mockRejectedValue(Object.assign(new Error("unsafe transcript"), { code: "SAFETY_BLOCK" })),
    });
    expect(target.fail).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "SAFETY_BLOCK" }));
    expect(target.completeAndEnqueueFollowOn).not.toHaveBeenCalled();
  });
});
