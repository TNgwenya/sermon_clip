import { prisma } from "@/lib/prisma";
import { socialMetricDedupeKey } from "@/lib/socialMetricIdentity";

export type PersistenceResult<T> = {
  available: boolean;
  items: T[];
};

export type SavedGrowthRecommendation = {
  id: string;
  title: string;
  priority: number;
  status: string;
  sourceClipId: string | null;
  sourceSermonId: string | null;
  platforms: string[];
  guardrailResult: string | null;
  createdAt: string;
};

export type PredictionReport = {
  id: string;
  platform: string;
  confidence: string;
  predictedReachLow: number;
  predictedReachHigh: number;
  predictedEngagementRate: number;
  predictedFollowerGrowthLow: number;
  predictedFollowerGrowthHigh: number;
  predictedWatchTimeSeconds: number;
  reasoning: string[];
  createdAt: string;
  scheduledPost: {
    id: string;
    title: string;
    postingSlot: string;
    status: string;
    publishedUrl: string | null;
  } | null;
  latestResult: {
    actualReach: number | null;
    actualEngagementRate: number | null;
    actualFollowerGrowth: number | null;
    actualWatchTimeSeconds: number | null;
    reachErrorPercent: number | null;
    engagementErrorPercent: number | null;
    evaluatedAt: string;
  } | null;
};

export type HistoricalPerformanceBaseline = {
  platform: string;
  snapshotCount: number;
  averageReach: number | null;
  averageViews: number | null;
  averageEngagementRate: number | null;
  totalFollowerGrowth: number;
  totalWatchTimeSeconds: number;
};

export type MinistryOutcomeReport = {
  id: string;
  outcomeType: string;
  value: number;
  notes: string;
  occurredAt: string;
  scheduledPostTitle: string | null;
  campaignName: string | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function formatJsonArray(value: unknown): string[] {
  return asStringArray(value).map((item) => item.trim()).filter(Boolean);
}

export function calculatePercentError(actual: number | null, low: number, high: number): number | null {
  if (actual === null || actual < 0) {
    return null;
  }

  const midpoint = (low + high) / 2;
  if (midpoint <= 0) {
    return null;
  }

  return Number((((actual - midpoint) / midpoint) * 100).toFixed(1));
}

export async function listSavedGrowthRecommendations(): Promise<PersistenceResult<SavedGrowthRecommendation>> {
  try {
    const recommendations = await prisma.growthRecommendation.findMany({
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        sourceClipId: true,
        sourceSermonId: true,
        platformsJson: true,
        createdAt: true,
      },
    });
    const guardrails = await prisma.growthGuardrailReview.findMany({
      where: {
        targetType: "GrowthRecommendation",
        targetId: { in: recommendations.map((item) => item.id) },
      },
      orderBy: { reviewedAt: "desc" },
      select: {
        targetId: true,
        result: true,
      },
    });
    const latestGuardrailByTarget = new Map<string, string>();
    guardrails.forEach((guardrail) => {
      if (!latestGuardrailByTarget.has(guardrail.targetId)) {
        latestGuardrailByTarget.set(guardrail.targetId, guardrail.result);
      }
    });

    return {
      available: true,
      items: recommendations.map((item) => ({
        id: item.id,
        title: item.title,
        priority: item.priority,
        status: item.status,
        sourceClipId: item.sourceClipId,
        sourceSermonId: item.sourceSermonId,
        platforms: formatJsonArray(item.platformsJson),
        guardrailResult: latestGuardrailByTarget.get(item.id) ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.warn("Growth recommendation persistence is unavailable.", error);
    return { available: false, items: [] };
  }
}

function average(values: Array<number | null>): number | null {
  const realValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (realValues.length === 0) {
    return null;
  }

  return Number((realValues.reduce((sum, value) => sum + value, 0) / realValues.length).toFixed(1));
}

export function historicalMetricIdentity(snapshot: {
  id: string;
  dedupeKey: string | null;
  source: string;
  platform: string;
  socialAccountId: string | null;
  platformPostId: string | null;
  capturedAt: Date;
}): string {
  if (snapshot.dedupeKey) return snapshot.dedupeKey;
  if (snapshot.source !== "API") return `snapshot:${snapshot.id}`;
  return socialMetricDedupeKey(snapshot);
}

export async function listHistoricalPerformanceBaselines(): Promise<PersistenceResult<HistoricalPerformanceBaseline>> {
  try {
    const snapshots = await prisma.socialMetricSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      take: 250,
      select: {
        id: true,
        dedupeKey: true,
        socialAccountId: true,
        platform: true,
        platformPostId: true,
        source: true,
        capturedAt: true,
        reach: true,
        views: true,
        engagementRate: true,
        followerGrowth: true,
        watchTimeSeconds: true,
      },
    });
    const latestSnapshotByIdentity = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      const identity = historicalMetricIdentity(snapshot);
      if (!latestSnapshotByIdentity.has(identity)) {
        latestSnapshotByIdentity.set(identity, snapshot);
      }
    }
    const dedupedSnapshots = [...latestSnapshotByIdentity.values()];
    const grouped = new Map<string, typeof snapshots>();
    dedupedSnapshots.forEach((snapshot) => {
      grouped.set(snapshot.platform, [...(grouped.get(snapshot.platform) ?? []), snapshot]);
    });

    return {
      available: true,
      items: [...grouped.entries()].map(([platform, items]) => ({
        platform,
        snapshotCount: items.length,
        averageReach: average(items.map((item) => item.reach)),
        averageViews: average(items.map((item) => item.views)),
        averageEngagementRate: average(items.map((item) => item.engagementRate)),
        totalFollowerGrowth: items.reduce((sum, item) => sum + (item.followerGrowth ?? 0), 0),
        totalWatchTimeSeconds: items.reduce((sum, item) => sum + (item.watchTimeSeconds ?? 0), 0),
      })),
    };
  } catch (error) {
    console.warn("Historical performance baselines are unavailable.", error);
    return { available: false, items: [] };
  }
}

export async function listMinistryOutcomeReports(): Promise<PersistenceResult<MinistryOutcomeReport>> {
  try {
    const outcomes = await prisma.ministryOutcome.findMany({
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: {
        id: true,
        outcomeType: true,
        value: true,
        notes: true,
        occurredAt: true,
        scheduledPost: {
          select: {
            title: true,
            postingSlot: true,
          },
        },
        campaign: {
          select: {
            name: true,
          },
        },
      },
    });

    return {
      available: true,
      items: outcomes.map((outcome) => ({
        id: outcome.id,
        outcomeType: outcome.outcomeType,
        value: outcome.value,
        notes: outcome.notes ?? "",
        occurredAt: outcome.occurredAt.toISOString(),
        scheduledPostTitle: outcome.scheduledPost?.title ?? outcome.scheduledPost?.postingSlot ?? null,
        campaignName: outcome.campaign?.name ?? null,
      })),
    };
  } catch (error) {
    console.warn("Ministry outcome reports are unavailable.", error);
    return { available: false, items: [] };
  }
}

export async function listPredictionReports(): Promise<PersistenceResult<PredictionReport>> {
  try {
    const predictions = await prisma.postPerformancePrediction.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        scheduledPost: {
          select: {
            id: true,
            title: true,
            postingSlot: true,
            status: true,
            publishedUrl: true,
          },
        },
        results: {
          orderBy: { evaluatedAt: "desc" },
          take: 1,
          select: {
            actualReach: true,
            actualEngagementRate: true,
            actualFollowerGrowth: true,
            actualWatchTimeSeconds: true,
            reachErrorPercent: true,
            engagementErrorPercent: true,
            evaluatedAt: true,
          },
        },
      },
    });

    return {
      available: true,
      items: predictions.map((prediction) => {
        const latestResult = prediction.results[0] ?? null;

        return {
          id: prediction.id,
          platform: prediction.platform,
          confidence: prediction.confidence,
          predictedReachLow: prediction.predictedReachLow,
          predictedReachHigh: prediction.predictedReachHigh,
          predictedEngagementRate: prediction.predictedEngagementRate,
          predictedFollowerGrowthLow: prediction.predictedFollowerGrowthLow,
          predictedFollowerGrowthHigh: prediction.predictedFollowerGrowthHigh,
          predictedWatchTimeSeconds: prediction.predictedWatchTimeSeconds,
          reasoning: formatJsonArray(prediction.reasoning),
          createdAt: prediction.createdAt.toISOString(),
          scheduledPost: prediction.scheduledPost
            ? {
                id: prediction.scheduledPost.id,
                title: prediction.scheduledPost.title ?? "Untitled post",
                postingSlot: prediction.scheduledPost.postingSlot,
                status: prediction.scheduledPost.status,
                publishedUrl: prediction.scheduledPost.publishedUrl,
              }
            : null,
          latestResult: latestResult
            ? {
                actualReach: latestResult.actualReach,
                actualEngagementRate: latestResult.actualEngagementRate,
                actualFollowerGrowth: latestResult.actualFollowerGrowth,
                actualWatchTimeSeconds: latestResult.actualWatchTimeSeconds,
                reachErrorPercent: latestResult.reachErrorPercent,
                engagementErrorPercent: latestResult.engagementErrorPercent,
                evaluatedAt: latestResult.evaluatedAt.toISOString(),
              }
            : null,
        };
      }),
    };
  } catch (error) {
    console.warn("Prediction reporting is unavailable.", error);
    return { available: false, items: [] };
  }
}
