import { describe, expect, it } from "vitest";

import { summarizePublishingServiceHealth } from "@/lib/publishingServiceHealth";

describe("publishing service health", () => {
  const now = new Date("2026-07-09T20:00:00.000Z");

  it("keeps automatic publishing explicit when no worker has checked in", () => {
    expect(summarizePublishingServiceHealth({ heartbeat: null, now })).toMatchObject({
      status: "NOT_SEEN",
      lastSeenAt: null,
      ageSeconds: null,
    });
  });

  it("reports a recent live worker signal as online", () => {
    expect(summarizePublishingServiceHealth({
      heartbeat: {
        workerId: "posting-1",
        dryRun: false,
        heartbeatAt: new Date("2026-07-09T19:59:30.000Z"),
      },
      now,
      staleAfterMs: 120_000,
    })).toMatchObject({
      status: "ONLINE",
      workerId: "posting-1",
      dryRun: false,
      ageSeconds: 30,
    });
  });

  it("normalizes provider-aware TikTok worker capabilities", () => {
    const health = summarizePublishingServiceHealth({
      heartbeat: {
        workerId: "posting-1",
        dryRun: false,
        heartbeatAt: new Date("2026-07-09T19:59:30.000Z"),
        detailsJson: {
          capabilities: {
            tiktokProviderMode: "direct",
            tiktokDirectEnabled: true,
            tiktokDirectConfigured: true,
            tiktokOAuthClientConfigured: true,
            tiktokDirectPrivacy: "SELF_ONLY",
          },
        },
      },
      now,
      staleAfterMs: 120_000,
    });

    expect(health.capabilities).toMatchObject({
      tiktokProviderMode: "direct",
      tiktokDirectEnabled: true,
      tiktokDirectConfigured: true,
      tiktokOAuthClientConfigured: true,
      tiktokDirectPrivacy: "SELF_ONLY",
      tiktokPrivacy: "SELF_ONLY",
    });
  });

  it("keeps test mode visible even while the service is healthy", () => {
    const health = summarizePublishingServiceHealth({
      heartbeat: {
        workerId: "posting-test",
        dryRun: true,
        heartbeatAt: new Date("2026-07-09T19:59:45.000Z"),
      },
      now,
      staleAfterMs: 120_000,
    });

    expect(health.status).toBe("ONLINE");
    expect(health.dryRun).toBe(true);
    expect(health.summary).toContain("test mode");
  });

  it("leaves scheduled work safely queued after a stale signal", () => {
    const health = summarizePublishingServiceHealth({
      heartbeat: {
        workerId: "posting-1",
        dryRun: false,
        heartbeatAt: new Date("2026-07-09T19:55:00.000Z"),
      },
      now,
      staleAfterMs: 120_000,
    });

    expect(health.status).toBe("STALE");
    expect(health.summary).toContain("safely queued");
  });
});
