import { describe, expect, it } from "vitest";

import {
  __scheduledPostsTestUtils,
  isScheduledPostMutationLocked,
  isScheduledPostReschedulable,
  normalizeCompleteScheduledPostStatus,
  normalizeManualPublishingStatus,
  normalizeRestorablePublishingStatus,
  normalizeScheduledPostAction,
  normalizeWorkerCompletionReceipt,
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

  it("keeps internal restore statuses out of the general status mutation", () => {
    expect(normalizeManualPublishingStatus("PLANNED")).toBeNull();
    expect(normalizeManualPublishingStatus("FAILED")).toBeNull();
    expect(normalizeManualPublishingStatus("READY_FOR_MEDIA_TEAM")).toBeNull();
    expect(normalizeRestorablePublishingStatus("PLANNED")).toBe("PLANNED");
    expect(normalizeRestorablePublishingStatus("PRIVATE_ONLY_UNVERIFIED")).toBe("PRIVATE_ONLY_UNVERIFIED");
    expect(normalizeScheduledPostAction("RESTORE_PREVIOUS")).toBe("RESTORE_PREVIOUS");
  });

  it("locks every mutation while the publishing worker owns the post", () => {
    expect(isScheduledPostMutationLocked({
      status: "POSTING",
      claimedAt: new Date("2026-07-09T20:00:00.000Z"),
      workerStatus: "CLAIMED",
    })).toBe(true);
    expect(isScheduledPostMutationLocked({
      status: "PLANNED",
      claimedAt: null,
      workerStatus: "IDLE",
    })).toBe(false);
  });

  it("does not reschedule posts with provider evidence or unresolved publishing state", () => {
    expect(isScheduledPostReschedulable({
      status: "FAILED",
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
    })).toBe(true);
    expect(isScheduledPostReschedulable({
      status: "PRIVATE_ONLY_UNVERIFIED",
      externalPostId: "provider-1",
      publishedUrl: null,
      finalPrivacyStatus: "processing",
    })).toBe(false);
  });
});

describe("scheduled post receipts", () => {
  it("downgrades private or evidence-free publication claims to verification required", () => {
    expect(normalizeWorkerCompletionReceipt({
      status: "POSTED",
      externalPostId: "youtube-1",
      finalPrivacyStatus: "private",
    }).status).toBe("PRIVATE_ONLY_UNVERIFIED");
    expect(normalizeWorkerCompletionReceipt({
      status: "POSTED",
      finalPrivacyStatus: "published",
    }).status).toBe("PRIVATE_ONLY_UNVERIFIED");
  });

  it("keeps confirmed public publication receipts posted", () => {
    expect(normalizeWorkerCompletionReceipt({
      status: "POSTED",
      externalPostId: "provider-1",
      publishedUrl: "https://example.com/post/1",
      finalPrivacyStatus: "published",
    })).toEqual({ status: "POSTED", publishError: null });
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

  it("uses a bounded stale claim window before requiring platform verification", () => {
    expect(__scheduledPostsTestUtils.STALE_POSTING_CLAIM_MS).toBe(15 * 60_000);
  });
});
