import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildScheduledPostSermonLabel,
  buildScheduledPostTypeLabel,
  ReadyQueueExperience,
  type ReadyQueueClip,
  selectVisibleCalendarPosts,
} from "@/app/ready-to-post/ready-queue-experience";
import type { ScheduledPost } from "@/lib/scheduledPosts";

function buildScheduledPost(index: number): ScheduledPost {
  const scheduledFor = new Date();
  scheduledFor.setHours(10 + index, 0, 0, 0);

  return {
    id: `post-${index}`,
    postingDraftId: null,
    socialAccountId: null,
    socialAccountLabel: null,
    socialAccountExternalProvider: null,
    socialAccountExternalAccountId: null,
    socialAccountExternalPlatform: null,
    clipIds: [],
    platform: "Instagram",
    postingSlot: "Weekly plan",
    title: `Planned message ${index}`,
    caption: `Caption ${index}`,
    note: "",
    status: "PLANNED",
    automationMode: "MANUAL",
    scheduledFor: scheduledFor.toISOString(),
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
    idempotencyKey: `planned-message-${index}`,
    createdAt: new Date(index * 1000).toISOString(),
  };
}

function renderPlanner(contentAssetFocus = false): string {
  return renderToStaticMarkup(
    <ReadyQueueExperience
      clips={[]}
      initialDrafts={[]}
      packageHistory={[]}
      initialSocialAccounts={[]}
      initialScheduledPosts={[0, 1, 2].map(buildScheduledPost)}
      initialPublishingServiceHealth={{
        status: "ONLINE",
        lastSeenAt: new Date().toISOString(),
        workerId: "test-worker",
        dryRun: true,
        ageSeconds: 0,
        capabilities: null,
        summary: "Publishing test service is online.",
      }}
      contentAssetFocus={contentAssetFocus}
    />,
  );
}

function buildReadyClip(): ReadyQueueClip {
  return {
    id: "clip-1",
    title: "Darkness They Don't Want Jesus",
    hook: "Look at the light",
    caption: "The entrance of God's Word brings light.",
    hashtags: ["#Faith"],
    score: 8.4,
    finalQualityScore: 8.2,
    qualityLabel: "POST_READY",
    postReadyStatus: "POST_READY",
    postReadyReasons: [],
    postReadyBlockers: [],
    recommendedNextAction: "POST_NOW",
    qualityWarnings: [],
    qualityReasons: [],
    pastorFriendlyReason: null,
    qualitySummary: "Ready to share.",
    visualConfidenceScore: 8,
    audioQualityScore: 8,
    captionQualityScore: 8,
    manualCropRecommended: false,
    smartClipCategory: "Faith",
    intendedAudience: "Church",
    mediaReady: true,
    estimatedBytes: 1_000,
    remotePreviewUrl: null,
    sermon: {
      id: "sermon-1",
      title: "Fix your eyes on Jesus",
      churchName: "Melusi Christian Community",
    },
  };
}

describe("ready-to-post compact planner", () => {
  it("defaults to seven days and limits a busy day to two posts", () => {
    const markup = renderPlanner();

    expect(markup.match(/class="social-calendar-day /g)).toHaveLength(7);
    expect(markup).toContain("aria-pressed=\"true\">7 days");
    expect(markup.match(/class="social-calendar-post is-planned[^\"]*"/g)).toHaveLength(2);
    expect(markup).toContain("Show 1 more");
  });

  it("keeps calendar cards concise and moves copy and actions to one selected review surface", () => {
    const markup = renderPlanner();
    const firstEvent = markup.match(/<button[^>]*class="social-calendar-post[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(firstEvent).toContain("Planned message 0");
    expect(firstEvent).toContain("Instagram");
    expect(firstEvent).toContain("Planned");
    expect(firstEvent).not.toContain("Caption 0");
    expect(firstEvent).not.toContain("Manage post");
    expect(markup.match(/Selected calendar item/g)).toHaveLength(1);
    expect(markup).toContain("Caption 0");
    expect(markup).toContain("Save new time");
    expect(markup).toContain("Mark posted");
  });

  it("returns every post when a calendar day is expanded", () => {
    const posts = ["first", "second", "third"];

    expect(selectVisibleCalendarPosts(posts, false)).toEqual(["first", "second"]);
    expect(selectVisibleCalendarPosts(posts, true)).toEqual(posts);
  });

  it("keeps the planner and planned posts while hiding clip-only workspaces", () => {
    const markup = renderPlanner(true);

    expect(markup).toContain("Plan what goes out next");
    expect(markup).toContain("Planned posts");
    expect(markup).not.toContain("Choose the message");
    expect(markup).not.toContain("Channels and downloads");
    expect(markup).not.toContain("Plan selected clip");
  });

  it("keeps content-only posts visible inside a sermon-scoped calendar", () => {
    const post = buildScheduledPost(0);
    post.title = "Grace for today";
    post.contentAssets = [{
      id: "asset-1",
      sermonId: "sermon-1",
      sermonTitle: "Grace Under Pressure",
      title: "Grace for today",
      assetType: "QUOTE_GRAPHIC",
      status: "SCHEDULED",
      caption: "Grace meets us here.",
      bodyContent: "Grace meets us here.",
      callToAction: null,
      hashtags: [],
      files: [],
    }];
    const markup = renderToStaticMarkup(
      <ReadyQueueExperience
        clips={[]}
        clipScopeIds={["clip-from-sermon"]}
        contentAssetScopeIds={["asset-1"]}
        initialDrafts={[]}
        packageHistory={[]}
        initialSocialAccounts={[]}
        initialScheduledPosts={[post]}
        initialPublishingServiceHealth={{
          status: "ONLINE",
          lastSeenAt: new Date().toISOString(),
          workerId: "test-worker",
          dryRun: true,
          ageSeconds: 0,
          capabilities: null,
          summary: "Publishing test service is online.",
        }}
      />,
    );

    expect(markup).toContain("Grace for today");
    expect(markup).toContain("Grace Under Pressure");
    expect(buildScheduledPostSermonLabel(post, [])).toBe("Grace Under Pressure");
    expect(buildScheduledPostTypeLabel(post)).toBe("Quote Graphic");
  });

  it("gives every planned post a programmatic calendar focus target", () => {
    const markup = renderPlanner();

    expect(markup).toContain('id="posting-calendar"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('id="scheduled-post-post-0"');
    expect(markup).toContain("Instagram: Planned message 0. Sermon not linked. Planned.");
  });

  it("keeps a directly focused clip visible after it has moved into the publishing plan", () => {
    const post = buildScheduledPost(0);
    post.clipIds = ["clip-1"];
    const markup = renderToStaticMarkup(
      <ReadyQueueExperience
        clips={[buildReadyClip()]}
        clipScopeIds={["clip-1"]}
        initialFocusedClipId="clip-1"
        initialDrafts={[]}
        packageHistory={[]}
        initialSocialAccounts={[]}
        initialScheduledPosts={[post]}
        initialPublishingServiceHealth={{
          status: "ONLINE",
          lastSeenAt: new Date().toISOString(),
          workerId: "test-worker",
          dryRun: true,
          ageSeconds: 0,
          capabilities: null,
          summary: "Publishing test service is online.",
        }}
      />,
    );

    expect(markup).toContain("Darkness They Don&#x27;t Want Jesus");
    expect(markup).toContain("Final video prepared");
    expect(markup).toContain("Already scheduled");
    expect(markup).not.toContain(">Schedule</button>");
    expect(markup).not.toContain("All prepared clips are already scheduled");
  });
});
