import Link from "next/link";

import {
  buildContentFollowUpRecommendations,
  buildContentPerformanceSummaries,
  matchMetricToScheduledPost,
  type ContentPerformancePost,
} from "@/lib/contentPerformance";
import { normalizeSuggestedPostingPlatform } from "@/lib/contentPublishing";
import { prisma } from "@/lib/prisma";
import { deriveSermonPointKey, nextMondayDateInput, type WeeklyPlanCandidate } from "@/lib/weeklyPlan";
import { WeeklyPlanBuilder } from "@/app/weekly-plan/weekly-plan-builder";
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

export default async function WeeklyPlanPage() {
  const loadedAt = new Date();
  const [sermonRecords, scheduledRecords, postedRecords, metricRecords] = await Promise.all([
    prisma.sermon.findMany({
      where: {
        OR: [
          { contentAssets: { some: { status: { in: ["PREPARED", "READY", "SCHEDULED"] } } } },
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
          where: { status: { in: ["PREPARED", "READY", "SCHEDULED"] } },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: {
            id: true,
            assetType: true,
            title: true,
            caption: true,
            bodyContent: true,
            platform: true,
            metadataJson: true,
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
        status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "POSTING", "POSTED"] },
      },
      select: { clipIdsJson: true, platform: true, scheduledFor: true, status: true },
      take: 500,
    }),
    prisma.scheduledPost.findMany({
      where: { status: "POSTED" },
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
    const assets: WeeklyPlanCandidate[] = sermon.contentAssets.map((asset) => {
      const metadata = jsonObject(asset.metadataJson);
      const relatedScripture = asset.contentOpportunity?.relatedScripture
        || (typeof metadata.relatedScripture === "string" ? metadata.relatedScripture : null);
      return {
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
      };
    });
    const clips: WeeklyPlanCandidate[] = sermon.clipCandidates.map((clip) => ({
      id: clip.id,
      sourceKind: "CLIP",
      sermonId: sermon.id,
      title: clip.title,
      caption: clip.caption?.trim() || clip.title,
      contentType: clip.smartClipCategory || clip.qualityClipCategory || "VIDEO_CLIP",
      pointKey: deriveSermonPointKey({
        title: clip.title,
        contentType: clip.smartClipCategory || clip.qualityClipCategory,
      }),
      suggestedPlatform: normalizeSuggestedPostingPlatform(clip.bestPlatform),
      qualityScore: clip.finalQualityScore ?? clip.overallPostScore ?? clip.score,
      alreadyScheduled: clipSchedules.get(clip.id) ?? [],
    }));
    return [...assets, ...clips];
  });

  const performanceClipIds = Array.from(new Set(postedRecords.flatMap((post) => jsonStringArray(post.clipIdsJson))));
  const performanceClipRecords = performanceClipIds.length > 0
    ? await prisma.clipCandidate.findMany({
        where: { id: { in: performanceClipIds } },
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
          <p className="kicker">Operational weekly plan</p>
          <h1>One reviewed ministry week</h1>
          <p className={styles.muted}>Assemble clips and approved sermon material, spot repeated ideas, then place the reviewed week on the mixed-content calendar.</p>
        </div>
        <nav className={styles.heroActions} aria-label="Weekly plan actions">
          <Link className="button primary" href="/ready-to-post">Publishing desk</Link>
          <Link className="button secondary" href="/opportunities">Content ideas</Link>
          <Link className="button secondary" href="/growth">Growth insights</Link>
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
        performance={performance}
        recommendations={recommendations}
        recentPublishedPosts={recentPublishedPosts}
      />
    </main>
  );
}

export const __weeklyPlanPageTestUtils = { jsonStringArray };
