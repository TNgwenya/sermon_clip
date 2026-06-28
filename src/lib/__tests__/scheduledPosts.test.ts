import { describe, expect, it } from "vitest";

import {
  normalizeCompleteScheduledPostStatus,
  normalizeScheduledPostAction,
} from "@/lib/scheduledPosts";

describe("scheduled post completion status", () => {
  it("accepts worker dry-run completions as skipped instead of posted", () => {
    expect(normalizeCompleteScheduledPostStatus("SKIPPED")).toBe("SKIPPED");
  });

  it("rejects unknown worker completion statuses", () => {
    expect(normalizeCompleteScheduledPostStatus("DRY_RUN")).toBeNull();
  });
});

describe("scheduled post actions", () => {
  it("accepts moving an automatic post to post now", () => {
    expect(normalizeScheduledPostAction("POST_NOW")).toBe("POST_NOW");
  });

  it("rejects unknown scheduled post actions", () => {
    expect(normalizeScheduledPostAction("POST_LATER")).toBeNull();
  });
});
