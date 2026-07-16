import { describe, expect, it } from "vitest";

import {
  buildContentFollowUpRecommendations,
  buildContentPerformanceSummaries,
  matchMetricToScheduledPost,
  type ContentPerformanceMetric,
  type ContentPerformancePost,
} from "@/lib/contentPerformance";

const post: ContentPerformancePost = {
  id: "post-1",
  socialAccountId: "account-1",
  platform: "INSTAGRAM",
  status: "POSTED",
  title: "Faith carousel",
  externalPostId: "ig-123",
  publishedUrl: "https://instagram.example/p/123",
  scheduledFor: "2026-07-20T16:00:00.000Z",
  contentAssets: [{
    id: "asset-1",
    sermonId: "sermon-1",
    sermonTitle: "Faith in the storm",
    title: "Five truths about faith",
    assetType: "CAROUSEL",
  }],
  clips: [],
};

const metric: ContentPerformanceMetric = {
  id: "metric-1",
  socialAccountId: "account-1",
  platformPostId: "ig-123",
  postUrl: null,
  platform: "INSTAGRAM",
  reach: 1_200,
  views: 1_500,
  impressions: 1_600,
  likes: 110,
  comments: 9,
  shares: 12,
  saves: 18,
  clickThroughs: 4,
  eventSignups: 1,
  engagementRate: 8.4,
  capturedAt: "2026-07-22T10:00:00.000Z",
};

describe("content performance traceability", () => {
  it("matches metrics using explicit scheduled post metadata or platform evidence", () => {
    expect(matchMetricToScheduledPost(metric, post)).toBe(true);
    expect(matchMetricToScheduledPost({
      ...metric,
      platformPostId: null,
      rawMetrics: { scheduledPostId: "post-1" },
    }, post)).toBe(true);
  });

  it("rejects matching identifiers from another platform or connected account", () => {
    expect(matchMetricToScheduledPost({
      ...metric,
      platform: "FACEBOOK",
    }, post)).toBe(false);
    expect(matchMetricToScheduledPost({
      ...metric,
      socialAccountId: "account-2",
    }, post)).toBe(false);
    expect(matchMetricToScheduledPost({
      ...metric,
      socialAccountId: null,
      rawMetrics: { socialAccountId: "account-2" },
    }, post)).toBe(false);
  });

  it("normalizes YouTube analytics to the YouTube Shorts scheduled platform", () => {
    expect(matchMetricToScheduledPost({
      ...metric,
      platform: "YouTube",
    }, {
      ...post,
      platform: "YOUTUBE_SHORTS",
    })).toBe(true);
  });

  it("aggregates performance back to the source asset and sermon", () => {
    const [summary] = buildContentPerformanceSummaries({
      posts: [post],
      metrics: [
        { ...metric, id: "metric-old", reach: 800, capturedAt: "2026-07-21T10:00:00.000Z" },
        metric,
      ],
    });
    expect(summary.sourceId).toBe("asset-1");
    expect(summary.sermonId).toBe("sermon-1");
    expect(summary.reach).toBe(1_200);
    expect(summary.saves).toBe(18);
    expect(summary.averageEngagementRate).toBe(8.4);
  });

  it("recommends follow-ups from real response signals", () => {
    const summaries = buildContentPerformanceSummaries({ posts: [post], metrics: [metric] });
    const recommendations = buildContentFollowUpRecommendations(summaries);
    expect(recommendations.map((item) => item.followUpType)).toEqual(expect.arrayContaining([
      "DISCUSSION",
      "DEVOTIONAL",
      "CAROUSEL",
      "INVITATION",
    ]));
    expect(new Set(recommendations.map((item) => `${item.sourceId}:${item.followUpType}`)).size).toBe(recommendations.length);
  });
});
