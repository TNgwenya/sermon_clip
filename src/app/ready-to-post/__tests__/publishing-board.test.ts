import { describe, expect, it } from "vitest";

import {
  buildPublishingBoardSnapshot,
  buildPublishingReceipt,
  type PublishingBoardClip,
} from "@/app/ready-to-post/publishing-board";
import type { PublishingServiceHealth } from "@/lib/publishingServiceHealth";
import type { ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";

function clip(overrides: Partial<PublishingBoardClip> = {}): PublishingBoardClip {
  return {
    id: "clip-1",
    title: "Grace for Monday",
    mediaReady: true,
    qualityLabel: "POST_READY",
    postReadyStatus: "POST_READY",
    postReadyBlockers: [],
    ...overrides,
  };
}

function post(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: "post-1",
    postingDraftId: null,
    socialAccountId: null,
    socialAccountLabel: null,
    socialAccountExternalProvider: null,
    socialAccountExternalAccountId: null,
    socialAccountExternalPlatform: null,
    clipIds: ["clip-1"],
    platform: "Instagram",
    postingSlot: "Monday morning",
    title: "Grace for Monday",
    caption: "Grace meets us here.",
    note: "",
    status: "PLANNED",
    automationMode: "MANUAL",
    scheduledFor: "2026-08-03T08:00:00.000Z",
    timezone: "Africa/Johannesburg",
    workerStatus: "IDLE",
    attemptCount: 0,
    claimedAt: null,
    workerId: null,
    lastAttemptAt: null,
    externalPostId: null,
    publishedUrl: null,
    publishError: null,
    finalPrivacyStatus: null,
    mediaObjectKey: null,
    mediaPublicUrl: null,
    mediaUploadedAt: null,
    idempotencyKey: "post-1-key",
    createdAt: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

function health(overrides: Partial<PublishingServiceHealth> = {}): PublishingServiceHealth {
  return {
    status: "ONLINE",
    lastSeenAt: "2026-08-01T08:00:00.000Z",
    workerId: "worker-1",
    dryRun: false,
    ageSeconds: 2,
    capabilities: null,
    summary: "Publishing service online.",
    ...overrides,
  };
}

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "account-1",
    platform: "Instagram",
    label: "Church Instagram",
    handle: "@church",
    status: "CONNECTED",
    externalProvider: "meta",
    externalAccountId: "instagram-1",
    externalPlatform: "instagram",
    profileUrl: null,
    credentialReady: true,
    createdAt: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("weekly publishing board", () => {
  it("keeps prepared media separate from editorial readiness", () => {
    const snapshot = buildPublishingBoardSnapshot({
      clips: [
        clip(),
        clip({
          id: "clip-2",
          title: "Crop needs review",
          postReadyStatus: "NEEDS_EDITING",
        }),
      ],
      posts: [],
      accounts: [],
      serviceHealth: health(),
    });

    expect(snapshot.readyCount).toBe(1);
    expect(snapshot.needsWorkCount).toBe(1);
    expect(snapshot.decision.title).toContain("Crop needs review");
    expect(snapshot.decision.evidence).toContain("editorial readiness");
  });

  it("claims automatic readiness only with a live service and verified credentials", () => {
    const ready = buildPublishingBoardSnapshot({
      clips: [clip()],
      posts: [],
      accounts: [account()],
      serviceHealth: health(),
    });
    const testMode = buildPublishingBoardSnapshot({
      clips: [clip()],
      posts: [],
      accounts: [account()],
      serviceHealth: health({ dryRun: true }),
    });
    const unverified = buildPublishingBoardSnapshot({
      clips: [clip()],
      posts: [],
      accounts: [account({ credentialReady: false })],
      serviceHealth: health(),
    });

    expect(ready.automaticPublishingReady).toBe(true);
    expect(testMode.automaticPublishingReady).toBe(false);
    expect(testMode.automaticPublishingLabel).toContain("test mode");
    expect(unverified.automaticPublishingReady).toBe(false);
    expect(unverified.automaticPublishingLabel).toBe("No verified automatic channel");
    expect(unverified.manualHandoffAvailable).toBe(true);
  });

  it("puts failed platform results ahead of new scheduling suggestions", () => {
    const snapshot = buildPublishingBoardSnapshot({
      clips: [clip()],
      posts: [post({ status: "FAILED", automationMode: "AUTOMATIC", attemptCount: 2 })],
      accounts: [account()],
      serviceHealth: health(),
    });

    expect(snapshot.attentionCount).toBe(1);
    expect(snapshot.decision.title).toBe("Check the Instagram result");
    expect(snapshot.decision.href).toBe("#posting-calendar");
  });

  it("distinguishes platform receipts from manual confirmations and retry states", () => {
    expect(buildPublishingReceipt(post({
      status: "POSTED",
      publishedUrl: "https://example.com/post",
    })).label).toBe("Platform receipt confirmed");
    expect(buildPublishingReceipt(post({
      status: "POSTED",
      publishedUrl: null,
    })).detail).toContain("manual confirmation");
    expect(buildPublishingReceipt(post({
      status: "FAILED",
      attemptCount: 3,
    })).label).toContain("Attempt 3");
  });
});
