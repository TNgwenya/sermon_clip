import { describe, expect, it } from "vitest";

import { summarizeMediaWorkerHealth } from "@/lib/mediaWorkerHealth";

describe("media worker health", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");

  it("makes missing media capacity explicit", () => {
    expect(summarizeMediaWorkerHealth({ heartbeat: null, now })).toMatchObject({
      status: "NOT_SEEN",
      lastSeenAt: null,
      ageSeconds: null,
    });
  });

  it("reports a recent heartbeat as online", () => {
    expect(summarizeMediaWorkerHealth({
      heartbeat: {
        workerId: "media-1",
        heartbeatAt: new Date("2026-08-21T09:59:30.000Z"),
        detailsJson: { processing: true, pollIntervalSeconds: 15 },
      },
      now,
      staleAfterMs: 120_000,
    })).toMatchObject({
      status: "ONLINE",
      workerId: "media-1",
      ageSeconds: 30,
      details: { processing: true, pollIntervalSeconds: 15 },
    });
  });

  it("reports stale capacity without claiming queued work is lost", () => {
    const health = summarizeMediaWorkerHealth({
      heartbeat: {
        workerId: "media-1",
        heartbeatAt: new Date("2026-08-21T09:55:00.000Z"),
      },
      now,
      staleAfterMs: 120_000,
    });

    expect(health.status).toBe("STALE");
    expect(health.summary).toContain("remain queued");
  });
});
