import Link from "next/link";

import {
  buildContentFollowUpRecommendations,
  buildContentPerformanceSummaries,
  matchMetricToScheduledPost,
  type ContentPerformancePost,
} from "@/lib/contentPerformance";
import {
  formatContentPublishingPlatform,
  isVideoClipOpportunityType,
  normalizeSuggestedPostingPlatform,
} from "@/lib/contentPublishing";
import { supportsManualContentHandoffWithoutMedia } from "@/lib/contentPublishingPreflight";
import { hasApprovedAssetPublishingRevision } from "@/lib/contentWorkflowUi";
import { prisma } from "@/lib/prisma";
import {
  deriveSermonPointKey,
  isWeeklyPlanCopyReady,
  nextMondayDateInput,
  type WeeklyPlanCandidate,
} from "@/lib/weeklyPlan";
import { WeeklyPlanBuilder } from "@/app/weekly-plan/weekly-plan-builder";
import { getSermonStoragePath } from "@/server/agents/storage";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { checkContentAssetMediaPresence } from "@/server/contentAssets/contentAssetMediaReadiness";
import { tenantScope } from "@/server/tenancy/scope";
import styles from "./weekly-plan.module.css";

export const dynamic = "force-dynamic";

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function mapWithConcurrency<T, Result>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<Result>,
): Promise<Result[]> {
  if (items.length === 0) return [];
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(items.length, Math.max(1, Math.trunc(concurrency))) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    },
  ));
  return results;
}

type WeeklyPlanSearchParams = {
  sermonId?: string;
};

export default async function WeeklyPlanPage({
  searchParams,
}: {
  searchParams: Promise<WeeklyPlanSearchParams>;
}) {
  const params = await searchParams;
  const requestContext = await requireRequestCapability("calendar.read");
  const scope = tenantScope(requestContext);
  const loadedAt = new Date();
  const [sermonRecords, scheduledRecords, postedRecords, metricRecords] = await Promise.all([
    prisma.sermon.findMany({
      where: {
        ...scope,
        OR: [
          { contentAssets: { some: { status: { in: ["READY", "SCHEDULED"] } } } },
          {
            clipCandidates: {
              some: {
                transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
                OR: [{ exportStatus: "COMPLETED" }, { status: "EXPORTED" }],
              },
            },
          },
        ],
      },
      orderBy: [{ sermonDate: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        title: true,
        speakerName: true,
        sermonDate: true,
        intelligence: { select: { centralTheme: true } },
        contentAssets: {
          where: { status: { in: ["READY", "SCHEDULED"] } },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: {
            id: true,
            sermonId: true,
            assetType: true,
            title: true,
            caption: true,
            bodyContent: true,
            platform: true,
            metadataJson: true,
            currentRevisionId: true,
            approvedRevisionId: true,
            currentRevision: {
              select: { approvalState: true },
            },
            files: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                filePath: true,
                objectKey: true,
                publicUrl: true,
                sizeBytes: true,
                sortOrder: true,
              },
            },
            contentOpportunity: {
              select: {
                relatedScripture: true,
                confidenceScore: true,
                opportunityType: true,
              },
            },
            scheduledPostLinks: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                scheduledPost: {
                  select: { platform: true, scheduledFor: true, status: true },
                },
              },
            },
          },
        },
        clipCandidates: {
          where: {
            transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
            OR: [{ exportStatus: "COMPLETED" }, { status: "EXPORTED" }],
          },
          orderBy: [{ finalQualityScore: "desc" }, { score: "desc" }],
          take: 20,
          select: {
            id: true,
            title: true,
            caption: true,
            bestPlatform: true,
            smartClipCategory: true,
            qualityClipCategory: true,
            finalQualityScore: true,
            overallPostScore: true,
            score: true,
          },
        },
      },
    }),
    prisma.scheduledPost.findMany({
      where: {
        ...scope,
        status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "POSTING", "POSTED"] },
      },
      select: { clipIdsJson: true, platform: true, scheduledFor: true, status: true },
      take: 500,
    }),
    prisma.scheduledPost.findMany({
      where: { ...scope, status: "POSTED" },
      orderBy: { scheduledFor: "desc" },
      take: 200,
      select: {
        id: true,
        socialAccountId: true,
        platform: true,
        status: true,
        title: true,
        externalPostId: true,
        publishedUrl: true,
        scheduledFor: true,
        clipIdsJson: true,
        contentAssetLinks: {
          orderBy: { sortOrder: "asc" },
          select: {
            contentAsset: {
              select: {
                id: true,
                title: true,
                assetType: true,
                sermon: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    }),
    prisma.socialMetricSnapshot.findMany({
      where: scope,
      orderBy: { capturedAt: "desc" },
      take: 500,
      select: {
        id: true,
        socialAccountId: true,
        platformPostId: true,
        postUrl: true,
        platform: true,
        reach: true,
        views: true,
        impressions: true,
        likes: true,
        comments: true,
        shares: true,
        saves: true,
        clickThroughs: true,
        eventSignups: true,
        engagementRate: true,
        capturedAt: true,
        rawMetrics: true,
      },
    }),
  ]);

  const contentAssetRecords = sermonRecords.flatMap((sermon) => sermon.contentAssets);
  const contentAssetMediaReadinessEntries = await mapWithConcurrency(
    contentAssetRecords,
    6,
    async (asset) => {
      if (supportsManualContentHandoffWithoutMedia(asset.assetType)) {
        return [asset.id, true] as const;
      }
      const platform = asset.platform
        ? formatContentPublishingPlatform(asset.platform) as "Instagram" | "Facebook" | "TikTok" | "YouTube Shorts"
        : null;
      const result = await checkContentAssetMediaPresence({
        assetType: asset.assetType,
        platform,
        files: asset.files,
        localFileRoot: getSermonStoragePath(asset.sermonId),
      });
      return [asset.id, result.status === "READY"] as const;
    },
  );
  const contentAssetMediaReady = new Map(contentAssetMediaReadinessEntries);
  const clipSchedules = new Map<string, WeeklyPlanCandidate["alreadyScheduled"]>();
  scheduledRecords.forEach((post) => {
    jsonStringArray(post.clipIdsJson).forEach((clipId) => {
      clipSchedules.set(clipId, [
        ...(clipSchedules.get(clipId) ?? []),
        {
          platform: post.platform,
          scheduledFor: post.scheduledFor?.toISOString() ?? null,
          status: post.status,
        },
      ]);
    });
  });

  const candidates: WeeklyPlanCandidate[] = sermonRecords.flatMap((sermon) => {
    const assets: WeeklyPlanCandidate[] = sermon.contentAssets.flatMap((asset) => {
      if (!hasApprovedAssetPublishingRevision({
        currentRevisionId: asset.currentRevisionId,
        approvedRevisionId: asset.approvedRevisionId,
        currentRevisionApprovalState: asset.currentRevision?.approvalState,
      })) {
        return [];
      }
      if (
        !supportsManualContentHandoffWithoutMedia(asset.assetType)
        && contentAssetMediaReady.get(asset.id) !== true
      ) {
        return [];
      }
      const metadata = jsonObject(asset.metadataJson);
      const sourceOpportunityType = asset.contentOpportunity?.opportunityType
        ?? (typeof metadata.sourceOpportunityType === "string" ? metadata.sourceOpportunityType : null);
      if (
        sourceOpportunityType
        && isVideoClipOpportunityType(sourceOpportunityType)
      ) {
        return [];
      }
      const relatedScripture = asset.contentOpportunity?.relatedScripture
        || (typeof metadata.relatedScripture === "string" ? metadata.relatedScripture : null);
      return [{
        id: asset.id,
        sourceKind: "CONTENT_ASSET",
        sermonId: sermon.id,
        title: asset.title,
        caption: asset.caption?.trim() || asset.bodyContent?.trim() || asset.title,
        contentType: asset.assetType,
        pointKey: deriveSermonPointKey({
          title: asset.title,
          contentType: asset.contentOpportunity?.opportunityType ?? asset.assetType,
          relatedScripture,
          explicitPointKey: typeof metadata.sermonPointKey === "string" ? metadata.sermonPointKey : null,
        }),
        relatedScripture,
        suggestedPlatform: asset.platform,
        qualityScore: asset.contentOpportunity?.confidenceScore
          ? asset.contentOpportunity.confidenceScore * 100
          : 65,
        alreadyScheduled: asset.scheduledPostLinks.map((link) => ({
          platform: link.scheduledPost.platform,
          scheduledFor: link.scheduledPost.scheduledFor?.toISOString() ?? null,
          status: link.scheduledPost.status,
        })),
      }];
    });
    const clips: WeeklyPlanCandidate[] = sermon.clipCandidates.flatMap((clip) => {
      const caption = clip.caption?.trim() ?? "";
      if (!isWeeklyPlanCopyReady({ title: clip.title, caption })) return [];
      return [{
        id: clip.id,
        sourceKind: "CLIP",
        sermonId: sermon.id,
        title: clip.title,
        caption,
        contentType: clip.smartClipCategory || clip.qualityClipCategory || "VIDEO_CLIP",
        pointKey: deriveSermonPointKey({
          title: clip.title,
          contentType: clip.smartClipCategory || clip.qualityClipCategory,
        }),
        suggestedPlatform: normalizeSuggestedPostingPlatform(clip.bestPlatform),
        qualityScore: clip.finalQualityScore ?? clip.overallPostScore ?? clip.score,
        alreadyScheduled: clipSchedules.get(clip.id) ?? [],
      }];
    });
    return [...assets, ...clips];
  });

  const performanceClipIds = Array.from(new Set(postedRecords.flatMap((post) => jsonStringArray(post.clipIdsJson))));
  const performanceClipRecords = performanceClipIds.length > 0
    ? await prisma.clipCandidate.findMany({
        where: {
          id: { in: performanceClipIds },
          sermon: scope,
        },
        select: {
          id: true,
          title: true,
          smartClipCategory: true,
          qualityClipCategory: true,
          sermon: { select: { id: true, title: true } },
        },
      })
    : [];
  const performanceClipById = new Map(performanceClipRecords.map((clip) => [clip.id, clip]));
  const performancePosts: ContentPerformancePost[] = postedRecords.map((post) => ({
    id: post.id,
    socialAccountId: post.socialAccountId,
    platform: post.platform,
    status: post.status,
    title: post.title ?? "Untitled post",
    externalPostId: post.externalPostId,
    publishedUrl: post.publishedUrl,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    contentAssets: post.contentAssetLinks.map((link) => ({
      id: link.contentAsset.id,
      sermonId: link.contentAsset.sermon.id,
      sermonTitle: link.contentAsset.sermon.title,
      title: link.contentAsset.title,
      assetType: link.contentAsset.assetType,
    })),
    clips: jsonStringArray(post.clipIdsJson).flatMap((clipId) => {
      const clip = performanceClipById.get(clipId);
      return clip ? [{
        id: clip.id,
        sermonId: clip.sermon.id,
        sermonTitle: clip.sermon.title,
        title: clip.title,
        contentType: clip.smartClipCategory || clip.qualityClipCategory || "VIDEO_CLIP",
      }] : [];
    }),
  }));
  const performance = buildContentPerformanceSummaries({
    posts: performancePosts,
    metrics: metricRecords.map((metric) => ({
      ...metric,
      capturedAt: metric.capturedAt.toISOString(),
    })),
  });
  const recommendations = buildContentFollowUpRecommendations(performance);
  const recentPublishedPosts = postedRecords
    .filter((post) => post.contentAssetLinks.length > 0 || jsonStringArray(post.clipIdsJson).length > 0)
    .slice(0, 30)
    .map((post) => ({
      id: post.id,
      title: post.title ?? "Untitled post",
      platform: post.platform,
      publishedUrl: post.publishedUrl,
      hasMetrics: metricRecords.some((metric) => matchMetricToScheduledPost({
        ...metric,
        capturedAt: metric.capturedAt.toISOString(),
      }, post)),
    }));

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className="kicker">One sermon → one content week</p>
          <h1>Your week, ready to review.</h1>
          <p className={styles.muted}>Sermon Clip selects a balanced mix of your strongest approved clips and branded posts. Keep, change, or replace each piece, then schedule the whole week in one step.</p>
        </div>
        <nav className={styles.heroActions} aria-label="Content Week actions">
          <Link className="button primary" href="#weekly-plan-builder">Review my Content Week</Link>
          <Link className="button tertiary" href="/ready-to-post">Publishing desk</Link>
          <Link className="button tertiary" href="/week-drafts">Draft archive</Link>
        </nav>
      </header>
      <WeeklyPlanBuilder
        sermons={sermonRecords.map((sermon) => ({
          id: sermon.id,
          title: sermon.title,
          speakerName: sermon.speakerName,
          sermonDate: sermon.sermonDate?.toISOString() ?? null,
          centralTheme: sermon.intelligence?.centralTheme ?? null,
        }))}
        candidates={candidates}
        defaultWeekStart={nextMondayDateInput(loadedAt)}
        initialSermonId={sermonRecords.some((sermon) => sermon.id === params.sermonId) ? params.sermonId : null}
        performance={performance}
        recommendations={recommendations}
        recentPublishedPosts={recentPublishedPosts}
      />
    </main>
  );
}

export const __weeklyPlanPageTestUtils = { jsonStringArray };
