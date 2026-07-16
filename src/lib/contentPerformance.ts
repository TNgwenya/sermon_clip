export type ContentPerformanceMetric = {
  id: string;
  socialAccountId?: string | null;
  platformPostId: string | null;
  postUrl: string | null;
  platform: string;
  reach: number | null;
  views: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clickThroughs: number | null;
  eventSignups: number | null;
  engagementRate: number | null;
  capturedAt: string;
  rawMetrics?: unknown;
};

export type ContentPerformancePost = {
  id: string;
  socialAccountId?: string | null;
  platform: string;
  status: string;
  title: string;
  externalPostId: string | null;
  publishedUrl: string | null;
  scheduledFor: string | null;
  contentAssets: Array<{
    id: string;
    sermonId: string;
    sermonTitle: string;
    title: string;
    assetType: string;
  }>;
  clips: Array<{
    id: string;
    sermonId: string;
    sermonTitle: string;
    title: string;
    contentType: string;
  }>;
};

export type ContentPerformanceSummary = {
  sourceKind: "CONTENT_ASSET" | "CLIP";
  sourceId: string;
  sermonId: string;
  sermonTitle: string;
  title: string;
  contentType: string;
  postCount: number;
  platforms: string[];
  reach: number;
  views: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clickThroughs: number;
  eventSignups: number;
  averageEngagementRate: number | null;
  latestCapturedAt: string | null;
  publishedUrls: string[];
};

export type ContentFollowUpRecommendation = {
  sourceId: string;
  sermonId: string;
  title: string;
  priority: number;
  followUpType: "DISCUSSION" | "CAROUSEL" | "INVITATION" | "DEVOTIONAL" | "ANALYTICS";
  rationale: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metricScheduledPostId(metric: ContentPerformanceMetric): string | null {
  const raw = asRecord(metric.rawMetrics);
  const id = raw?.scheduledPostId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function normalizedIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizedPlatform(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (["YOUTUBE", "YOUTUBE_SHORT", "YOUTUBE_SHORTS"].includes(normalized)) return "YOUTUBE_SHORTS";
  return normalized;
}

function metricSocialAccountId(metric: ContentPerformanceMetric): string | null {
  const direct = normalizedIdentity(metric.socialAccountId);
  if (direct) return direct;
  const raw = asRecord(metric.rawMetrics);
  return normalizedIdentity(typeof raw?.socialAccountId === "string" ? raw.socialAccountId : null);
}

export function matchMetricToScheduledPost(
  metric: ContentPerformanceMetric,
  post: Pick<ContentPerformancePost, "id" | "platform" | "socialAccountId" | "externalPostId" | "publishedUrl">,
): boolean {
  if (normalizedPlatform(metric.platform) !== normalizedPlatform(post.platform)) return false;

  const metricAccountId = metricSocialAccountId(metric);
  const postAccountId = normalizedIdentity(post.socialAccountId);
  if (metricAccountId && postAccountId && metricAccountId !== postAccountId) return false;

  const scheduledPostId = metricScheduledPostId(metric);
  if (scheduledPostId && scheduledPostId === post.id) return true;
  if (metric.platformPostId && post.externalPostId && metric.platformPostId === post.externalPostId) return true;
  if (metric.postUrl && post.publishedUrl && metric.postUrl === post.publishedUrl) return true;
  return false;
}

function number(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildContentPerformanceSummaries(input: {
  posts: ContentPerformancePost[];
  metrics: ContentPerformanceMetric[];
}): ContentPerformanceSummary[] {
  const summaries = new Map<string, ContentPerformanceSummary & { engagementRates: number[] }>();

  input.posts
    .filter((post) => post.status === "POSTED")
    .forEach((post) => {
      const matchedMetrics = input.metrics
        .filter((metric) => matchMetricToScheduledPost(metric, post))
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
        .slice(0, 1);
      const sources = [
        ...post.contentAssets.map((asset) => ({
          sourceKind: "CONTENT_ASSET" as const,
          sourceId: asset.id,
          sermonId: asset.sermonId,
          sermonTitle: asset.sermonTitle,
          title: asset.title,
          contentType: asset.assetType,
        })),
        ...post.clips.map((clip) => ({
          sourceKind: "CLIP" as const,
          sourceId: clip.id,
          sermonId: clip.sermonId,
          sermonTitle: clip.sermonTitle,
          title: clip.title,
          contentType: clip.contentType,
        })),
      ];

      sources.forEach((source) => {
        const key = `${source.sourceKind}:${source.sourceId}`;
        const current = summaries.get(key) ?? {
          ...source,
          postCount: 0,
          platforms: [],
          reach: 0,
          views: 0,
          impressions: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          clickThroughs: 0,
          eventSignups: 0,
          averageEngagementRate: null,
          latestCapturedAt: null,
          publishedUrls: [],
          engagementRates: [],
        };
        current.postCount += 1;
        current.platforms = Array.from(new Set([...current.platforms, post.platform]));
        current.publishedUrls = Array.from(new Set([
          ...current.publishedUrls,
          ...(post.publishedUrl ? [post.publishedUrl] : []),
        ]));
        matchedMetrics.forEach((metric) => {
          current.reach += number(metric.reach);
          current.views += number(metric.views);
          current.impressions += number(metric.impressions);
          current.likes += number(metric.likes);
          current.comments += number(metric.comments);
          current.shares += number(metric.shares);
          current.saves += number(metric.saves);
          current.clickThroughs += number(metric.clickThroughs);
          current.eventSignups += number(metric.eventSignups);
          if (typeof metric.engagementRate === "number" && Number.isFinite(metric.engagementRate)) {
            current.engagementRates.push(metric.engagementRate);
          }
          if (!current.latestCapturedAt || metric.capturedAt > current.latestCapturedAt) {
            current.latestCapturedAt = metric.capturedAt;
          }
        });
        current.averageEngagementRate = current.engagementRates.length > 0
          ? Number((current.engagementRates.reduce((sum, value) => sum + value, 0) / current.engagementRates.length).toFixed(1))
          : null;
        summaries.set(key, current);
      });
    });

  return [...summaries.values()]
    .map(({ engagementRates, ...summary }) => {
      void engagementRates;
      return summary;
    })
    .sort((left, right) => (
      (right.reach + right.views + right.shares * 20 + right.saves * 15)
      - (left.reach + left.views + left.shares * 20 + left.saves * 15)
    ));
}

export function buildContentFollowUpRecommendations(
  summaries: ContentPerformanceSummary[],
  limit = 6,
): ContentFollowUpRecommendation[] {
  const ranked = summaries.flatMap((summary): ContentFollowUpRecommendation[] => {
    const recommendations: ContentFollowUpRecommendation[] = [];
    if (!summary.latestCapturedAt) {
      recommendations.push({
        sourceId: summary.sourceId,
        sermonId: summary.sermonId,
        title: `Measure “${summary.title}” before reusing it`,
        priority: 40,
        followUpType: "ANALYTICS",
        rationale: "The post is traceable to this sermon, but no matching platform metrics have been captured yet.",
      });
      return recommendations;
    }
    if (summary.comments >= 5) {
      recommendations.push({
        sourceId: summary.sourceId,
        sermonId: summary.sermonId,
        title: `Turn comments on “${summary.title}” into a pastor response`,
        priority: 80 + Math.min(19, summary.comments),
        followUpType: "DISCUSSION",
        rationale: `${summary.comments} comments indicate an active question or conversation worth answering from the sermon.`,
      });
    }
    if (summary.saves >= 5) {
      recommendations.push({
        sourceId: summary.sourceId,
        sermonId: summary.sermonId,
        title: `Expand “${summary.title}” into a devotional or carousel`,
        priority: 75 + Math.min(20, summary.saves),
        followUpType: summary.contentType.includes("CAROUSEL") ? "DEVOTIONAL" : "CAROUSEL",
        rationale: `${summary.saves} saves suggest people want to revisit and apply this teaching.`,
      });
    }
    if (summary.shares >= 5) {
      recommendations.push({
        sourceId: summary.sourceId,
        sermonId: summary.sermonId,
        title: `Create a follow-up from the same sermon point`,
        priority: 72 + Math.min(20, summary.shares),
        followUpType: "CAROUSEL",
        rationale: `${summary.shares} shares show this sermon point travelled beyond the initial audience.`,
      });
    }
    if (summary.clickThroughs + summary.eventSignups >= 3) {
      recommendations.push({
        sourceId: summary.sourceId,
        sermonId: summary.sermonId,
        title: `Repeat the invitation with a clearer next step`,
        priority: 85 + Math.min(14, summary.clickThroughs + summary.eventSignups),
        followUpType: "INVITATION",
        rationale: `${summary.clickThroughs} clicks and ${summary.eventSignups} sign-ups show measurable ministry intent.`,
      });
    }
    return recommendations;
  }).sort((left, right) => right.priority - left.priority);
  const unique = new Map<string, ContentFollowUpRecommendation>();
  ranked.forEach((recommendation) => {
    const key = `${recommendation.sourceId}:${recommendation.followUpType}`;
    if (!unique.has(key)) unique.set(key, recommendation);
  });
  return [...unique.values()].slice(0, Math.max(1, limit));
}
