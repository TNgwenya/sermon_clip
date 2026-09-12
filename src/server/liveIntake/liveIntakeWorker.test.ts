import { describe, expect, it, vi } from "vitest";

import {
  __liveIntakeWorkerTestUtils,
  createLiveIntakeWorker,
  type LiveIntakeWorkerDependencies,
  type LiveIntakeWorkerRecording,
} from "./liveIntakeWorker";

const candidate: LiveIntakeWorkerRecording = {
  id: "recording-1",
  providerRecordingId: "provider-recording-1",
  organizationId: "org-1",
  durationSeconds: 120,
  materializationAttemptCount: 2,
};

function dependencies(overrides: Partial<LiveIntakeWorkerDependencies> = {}): LiveIntakeWorkerDependencies {
  return {
    listActiveInputs: vi.fn().mockResolvedValue([{ providerInputId: "input-1" }]),
    listReadyRecordings: vi.fn().mockResolvedValue([{ providerRecordingId: "provider-recording-1", title: "Sunday live recording", durationSeconds: 120 }]),
    receive: vi.fn().mockResolvedValue({ accepted: true, duplicate: false }),
    recoverStalled: vi.fn().mockResolvedValue(0),
    listCandidates: vi.fn().mockResolvedValue([candidate]),
    claim: vi.fn().mockResolvedValue(candidate),
    markPending: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markIgnored: vi.fn().mockResolvedValue(undefined),
    materialize: vi.fn().mockResolvedValue({ state: "materialized", sermonId: "sermon-1", sourceAsset: {} }),
    ...overrides,
  };
}

describe("live intake worker polling", () => {
  it("timestamps claims and retries when they happen after slow discovery and earlier transfers", async () => {
    const startedAt = Date.parse("2026-08-23T12:00:00.000Z");
    let elapsed = 0;
    const minute = 60_000;
    const second = { ...candidate, id: "recording-2" };
    const deps = dependencies({
      listReadyRecordings: vi.fn(async () => {
        elapsed += 35 * minute;
        return [];
      }),
      listCandidates: vi.fn().mockResolvedValue([candidate, second]),
      claim: vi.fn(async (recording) => recording),
      materialize: vi.fn(async (recording) => {
        elapsed += 10 * minute;
        if (recording.id === candidate.id) return { state: "pending" as const };
        throw new Error("Temporary transfer failure");
      }),
    });

    const result = await createLiveIntakeWorker(deps, {
      now: () => new Date(startedAt + elapsed),
      pendingRetryMs: minute,
      failureRetryMs: minute,
    })();

    expect(result).toEqual(expect.objectContaining({ pending: 1, failed: 1 }));
    expect(deps.listCandidates).toHaveBeenCalledWith(new Date(startedAt + 35 * minute), 10);
    expect(deps.claim).toHaveBeenNthCalledWith(1, candidate, new Date(startedAt + 35 * minute));
    expect(deps.claim).toHaveBeenNthCalledWith(2, second, new Date(startedAt + 45 * minute));
    expect(deps.markPending).toHaveBeenCalledWith(candidate.id, new Date(startedAt + 46 * minute));
    expect(deps.markFailed).toHaveBeenCalledWith(second.id, new Date(startedAt + 59 * minute));
  });

  it("discovers authenticated provider recordings, receipts them idempotently, then materializes only a claimed record", async () => {
    const deps = dependencies();
    const cycle = createLiveIntakeWorker(deps, { now: () => new Date("2026-08-23T12:00:00.000Z") });

    await expect(cycle()).resolves.toEqual(expect.objectContaining({ discovered: 1, received: 1, materialized: 1, failed: 0 }));
    expect(deps.receive).toHaveBeenCalledWith(expect.objectContaining({ providerInputId: "input-1", providerRecordingId: "provider-recording-1" }));
    expect(deps.claim).toHaveBeenCalledWith(candidate, expect.any(Date));
    expect(deps.materialize).toHaveBeenCalledWith(candidate);
  });

  it("returns a pending MP4 to RECEIVED with a bounded retry without queueing it", async () => {
    const deps = dependencies({ materialize: vi.fn().mockResolvedValue({ state: "pending" }) });
    const cycle = createLiveIntakeWorker(deps, { now: () => new Date("2026-08-23T12:00:00.000Z"), pendingRetryMs: 30_000 });
    await expect(cycle()).resolves.toEqual(expect.objectContaining({ pending: 1, materialized: 0 }));
    expect(deps.markPending).toHaveBeenCalledWith("recording-1", new Date("2026-08-23T12:00:30.000Z"));
  });

  it("does not retry a recording above the supported MP4 duration", async () => {
    const long = { ...candidate, durationSeconds: __liveIntakeWorkerTestUtils.FOUR_HOURS_SECONDS + 1 };
    const deps = dependencies({ listCandidates: vi.fn().mockResolvedValue([long]) });
    await createLiveIntakeWorker(deps)();
    expect(deps.markIgnored).toHaveBeenCalledWith("recording-1", expect.stringMatching(/four hours/i));
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.materialize).not.toHaveBeenCalled();
  });

  it("backs off failed transfers without storing provider error content", async () => {
    const deps = dependencies({ materialize: vi.fn().mockRejectedValue(new Error("https://one-time.example/?secret=do-not-store")) });
    const cycle = createLiveIntakeWorker(deps, {
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      failureRetryMs: 60_000,
      maxFailureRetryMs: 600_000,
    });
    await expect(cycle()).resolves.toEqual(expect.objectContaining({ failed: 1 }));
    // The worker is claiming its third attempt, which quadruples the one-minute base delay. The database helper stores
    // only its fixed safe message, not the thrown provider URL.
    expect(deps.markFailed).toHaveBeenCalledWith("recording-1", new Date("2026-08-23T12:04:00.000Z"));
    expect(__liveIntakeWorkerTestUtils.safeFailureReason()).not.toContain("secret");
  });
});
