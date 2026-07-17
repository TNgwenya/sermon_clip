import { describe, expect, it } from "vitest";

import { historicalMetricIdentity } from "@/lib/growthPersistence";

const capturedAt = new Date("2026-07-16T12:00:00.000Z");

describe("historical metric identity", () => {
  it("preserves distinct manual rows even when their platform and day match", () => {
    const shared = {
      dedupeKey: null,
      source: "MANUAL",
      platform: "Facebook",
      socialAccountId: null,
      platformPostId: null,
      capturedAt,
    };

    expect(historicalMetricIdentity({ ...shared, id: "manual-1" }))
      .not.toBe(historicalMetricIdentity({ ...shared, id: "manual-2" }));
  });

  it("still collapses legacy API rows with the same daily identity", () => {
    const shared = {
      dedupeKey: null,
      source: "API",
      platform: "YouTube",
      socialAccountId: "account-1",
      platformPostId: "post-1",
      capturedAt,
    };

    expect(historicalMetricIdentity({ ...shared, id: "legacy-1" }))
      .toBe(historicalMetricIdentity({ ...shared, id: "legacy-2" }));
  });
});
