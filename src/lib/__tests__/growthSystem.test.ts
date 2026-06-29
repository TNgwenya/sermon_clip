import { describe, expect, it } from "vitest";

import {
  assessTrendForMinistry,
  buildEventCampaignPlan,
  buildGrowthRecommendations,
  buildPlatformSnapshots,
  classifyMinistryTheme,
  getClipGrowthScore,
  predictPostPerformance,
  type GrowthClipInput,
} from "@/lib/growthSystem";
import type { ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";

function buildClip(overrides: Partial<GrowthClipInput> = {}): GrowthClipInput {
  return {
    id: "clip-1",
    title: "Bring your anxiety to God in prayer",
    hook: "What do you do when anxiety gets loud?",
    caption: "Prayer is not a last resort. Bring it to God today.",
    hashtags: ["#Prayer", "#Faith", "#Church"],
    score: 71,
    finalQualityScore: 82,
    overallPostScore: 79,
    qualityLabel: "POST_READY",
    postReadyStatus: "POST_READY",
    smartClipCategory: "PRAYER",
    intendedAudience: "People needing encouragement",
    durationSeconds: 42,
    exportStatus: "COMPLETED",
    status: "EXPORTED",
    sermon: {
      id: "sermon-1",
      title: "Peace in the storm",
      churchName: "Grace Church",
      speakerName: "Pastor Sam",
      intelligence: {
        centralTheme: "God meets people in anxious moments.",
        summary: "A sermon about prayer and peace.",
      },
    },
    ...overrides,
  };
}

function buildScheduledPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: "post-1",
    postingDraftId: "draft-1",
    socialAccountId: "account-1",
    socialAccountLabel: "Grace Instagram",
    socialAccountExternalProvider: null,
    socialAccountExternalAccountId: null,
    socialAccountExternalPlatform: null,
    clipIds: ["other-clip"],
    platform: "Instagram",
    postingSlot: "Wed evening",
    title: "",
    caption: "",
    note: "",
    status: "PLANNED",
    automationMode: "MANUAL",
    scheduledFor: null,
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
    idempotencyKey: "draft-1:instagram",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "account-1",
    platform: "Instagram",
    label: "Grace Instagram",
    handle: "@gracechurch",
    status: "CONNECTED",
    externalProvider: null,
    externalAccountId: null,
    externalPlatform: null,
    profileUrl: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("growth system", () => {
  it("scores exported post-ready clips higher than unprepared clips", () => {
    const readyClip = buildClip();
    const roughClip = buildClip({
      finalQualityScore: 58,
      qualityLabel: "NEEDS_EDITING",
      postReadyStatus: "NEEDS_EDITING",
      exportStatus: "NOT_EXPORTED",
      status: "APPROVED",
      durationSeconds: 120,
    });

    expect(getClipGrowthScore(readyClip)).toBeGreaterThan(getClipGrowthScore(roughClip));
    expect(getClipGrowthScore(readyClip)).toBeLessThanOrEqual(100);
  });

  it("classifies ministry themes from clip language", () => {
    expect(classifyMinistryTheme(buildClip())).toBe("Prayer");
    expect(classifyMinistryTheme(buildClip({
      title: "How John 3 reveals the love of God",
      caption: "The scripture shows us God's grace.",
      hook: "Open the Bible with me.",
      smartClipCategory: "SCRIPTURE_TEACHING",
    }))).toBe("Scripture teaching");
    expect(classifyMinistryTheme(buildClip({
      title: "Youth night is this Friday",
      caption: "Register for the youth event.",
      hook: "Bring a friend to service.",
      smartClipCategory: "EVENT",
    }))).toBe("Event promotion");
  });

  it("builds platform snapshots for connected and manually tracked channels", () => {
    const snapshots = buildPlatformSnapshots({
      accounts: [buildAccount()],
      scheduledPosts: [buildScheduledPost()],
      clips: [buildClip()],
    });

    expect(snapshots.find((item) => item.platform === "Instagram")).toMatchObject({
      status: "CONNECTED",
      plannedPosts: 1,
    });
    expect(snapshots.find((item) => item.platform === "Threads")?.status).toBe("MANUAL_TRACKING");
  });

  it("creates explainable recommendations and excludes already scheduled clips", () => {
    const recommendations = buildGrowthRecommendations({
      clips: [
        buildClip(),
        buildClip({ id: "clip-2", title: "A testimony of grace", caption: "This testimony strengthened our faith." }),
      ],
      scheduledPosts: [buildScheduledPost({ clipIds: ["clip-1"] })],
      accounts: [buildAccount()],
      limit: 3,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].sourceClipId).toBe("clip-2");
    expect(recommendations[0].rationale.join(" ")).toContain("Human approval");
    expect(recommendations[0].prediction.reachHigh).toBeGreaterThan(recommendations[0].prediction.reachLow);
  });

  it("predicts higher confidence for strong prepared clips", () => {
    const prediction = predictPostPerformance(buildClip(), 3);

    expect(prediction.confidence).toBe("High");
    expect(prediction.engagementRate).toBeGreaterThan(3);
    expect(prediction.reasoning.length).toBeGreaterThan(1);
  });

  it("filters manipulative trends and allows ministry-fit formats", () => {
    expect(assessTrendForMinistry("shock reaction rage bait").decision).toBe("Avoid");
    expect(assessTrendForMinistry("quiet prayer reflection format")).toMatchObject({
      decision: "Use",
    });
  });

  it("builds a complete event campaign arc", () => {
    const plan = buildEventCampaignPlan({
      eventName: "Worship Night",
      eventType: "worship night",
      startsAt: new Date("2026-08-15T18:00:00.000Z"),
    });

    expect(plan.name).toContain("Worship Night");
    expect(plan.phases.map((phase) => phase.name)).toEqual([
      "Awareness",
      "Invitation",
      "Final reminder",
      "Recap and follow-up",
    ]);
  });
});
