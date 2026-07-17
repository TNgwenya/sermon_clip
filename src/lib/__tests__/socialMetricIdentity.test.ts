import { describe, expect, it } from "vitest";

import { socialMetricDedupeKey } from "@/lib/socialMetricIdentity";

describe("social metric identity", () => {
  it("keeps repeated syncs for the same account, post, and day idempotent", () => {
    const first = socialMetricDedupeKey({
      source: "API",
      platform: "YouTube Shorts",
      socialAccountId: "account-1",
      platformPostId: "post-1",
      capturedAt: new Date("2026-07-16T01:00:00.000Z"),
    });
    const laterSameDay = socialMetricDedupeKey({
      source: "API",
      platform: "YouTube Shorts",
      socialAccountId: "account-1",
      platformPostId: "post-1",
      capturedAt: new Date("2026-07-16T22:00:00.000Z"),
    });

    expect(first).toBe(laterSameDay);
    expect(first).toContain("account-1:post-1:2026-07-16");
  });

  it("keeps different accounts and days distinct", () => {
    const base = {
      source: "API",
      platform: "Facebook",
      capturedAt: new Date("2026-07-16T00:00:00.000Z"),
    };

    expect(socialMetricDedupeKey({ ...base, socialAccountId: "one" }))
      .not.toBe(socialMetricDedupeKey({ ...base, socialAccountId: "two" }));
    expect(socialMetricDedupeKey({ ...base, socialAccountId: "one" }))
      .not.toBe(socialMetricDedupeKey({ ...base, socialAccountId: "one", capturedAt: new Date("2026-07-17T00:00:00.000Z") }));
  });
});
