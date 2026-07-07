import { describe, expect, it } from "vitest";

import {
  __scheduledPostsTestUtils,
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

describe("scheduled post auth failures", () => {
  it("detects expired YouTube and Facebook token errors", () => {
    expect(__scheduledPostsTestUtils.isSocialAuthFailure("Token has been expired or revoked.")).toBe(true);
    expect(
      __scheduledPostsTestUtils.isSocialAuthFailure(
        "Error validating access token: Session has expired on Tuesday, 30-Jun-26 11:00:00 PDT.",
      ),
    ).toBe(true);
  });

  it("does not mark ordinary publishing failures as account auth issues", () => {
    expect(__scheduledPostsTestUtils.isSocialAuthFailure("No local video file exists for this scheduled post.")).toBe(false);
  });
});

describe("scheduled post worker queue", () => {
  it("does not automatically retry failed posts", () => {
    expect(__scheduledPostsTestUtils.ACTIVE_AUTOMATION_STATUSES).toEqual(["PLANNED"]);
  });
});
