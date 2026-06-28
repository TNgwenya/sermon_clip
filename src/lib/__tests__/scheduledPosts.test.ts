import { describe, expect, it } from "vitest";

import { normalizeCompleteScheduledPostStatus } from "@/lib/scheduledPosts";

describe("scheduled post completion status", () => {
  it("accepts worker dry-run completions as skipped instead of posted", () => {
    expect(normalizeCompleteScheduledPostStatus("SKIPPED")).toBe("SKIPPED");
  });

  it("rejects unknown worker completion statuses", () => {
    expect(normalizeCompleteScheduledPostStatus("DRY_RUN")).toBeNull();
  });
});
