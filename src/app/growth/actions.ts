"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

import {
  buildEventCampaignPlan,
  buildGrowthRecommendations,
  growthPlatformToPostingPlatform,
  predictPostPerformance,
  postingPlatformToGrowthPlatform,
  type GrowthClipInput,
  type GrowthPlatform,
  type GrowthRecommendation,
} from "@/lib/growthSystem";
import { createPostingDraft, fromPrismaPostingPlatform, type PostingPlatform } from "@/lib/postingDrafts";
import { prisma } from "@/lib/prisma";
import { resolveReadyMedia } from "@/lib/readyMedia";
import { listScheduledPosts } from "@/lib/scheduledPosts";
import { listSocialAccounts } from "@/lib/socialAccounts";
import { calculatePercentError } from "@/lib/growthPersistence";
import { socialMetricDedupeKey } from "@/lib/socialMetricIdentity";
import {
  fetchInstagramAccountMetrics,
  fetchFacebookPageDailyMetrics,
} from "@/server/integrations/metaAnalytics";
import {
  getConnectedCredentials,
  markCredentialSyncError,
  markCredentialSyncSuccess,
  upsertSocialCredential,
} from "@/server/integrations/socialCredentials";
import { upsertSocialMetricSnapshots } from "@/server/integrations/socialMetricPersistence";
import {
  fetchThreadsPostMetrics,
} from "@/server/integrations/threadsAnalytics";
import {
  fetchTikTokVideoMetrics,
  refreshTikTokAccessToken,
} from "@/server/integrations/tiktokAnalytics";
import {
  fetchYouTubeDailyAnalytics,
  fetchYouTubeDailyAnalyticsWithAccessToken,
  getDefaultYouTubeAnalyticsWindow,
  getYouTubeAnalyticsConfigFromEnv,
  refreshYouTubeAccessToken,
} from "@/server/integrations/youtubeAnalytics";

function parseGrowthPlatforms(value: FormDataEntryValue | null): GrowthPlatform[] {
  if (typeof value !== "string") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is GrowthPlatform => typeof item === "string");
}

function uniquePostingPlatforms(platforms: GrowthPlatform[]): PostingPlatform[] {
  return Array.from(new Set(
    platforms
      .map(growthPlatformToPostingPlatform)
      .filter((platform): platform is PostingPlatform => platform !== null),
  ));
}

function normalizeText(value: FormDataEntryValue | null, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeDate(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildGrowthRedirect(params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `/growth?${searchParams.toString()}`;
}

function parseSavedRecommendation(value: unknown): GrowthRecommendation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<GrowthRecommendation>;
  if (
    typeof candidate.sourceClipId !== "string"
    || typeof candidate.title !== "string"
    || !Array.isArray(candidate.platforms)
  ) {
    return null;
  }

  return candidate as GrowthRecommendation;
}

function buildGuardrailResult(input: {
  title: string;
  guardrails: unknown;
}): { result: "PASS" | "NEEDS_REVIEW" | "FAIL"; issues: string[]; suggestedRevision: string | null } {
  const title = input.title.toLowerCase();
  const guardrails = Array.isArray(input.guardrails)
    ? input.guardrails.filter((item): item is string => typeof item === "string")
    : [];
  const issues = [...guardrails];

  if (title.match(/guarantee|miracle cure|expose|destroy|humiliate|shock/)) {
    return {
      result: "FAIL",
      issues: [...issues, "Avoid sensational, coercive, or misleading language."],
      suggestedRevision: "Rewrite the recommendation with a pastoral, truthful, and non-manipulative call to action.",
    };
  }

  if (title.match(/testimony|salvation|altar|giving|children|youth/)) {
    return {
      result: "NEEDS_REVIEW",
      issues: [...issues, "Human review is required for sensitive ministry context."],
      suggestedRevision: "Confirm consent, context, and church leadership approval before scheduling.",
    };
  }

  return {
    result: "PASS",
    issues: issues.length > 0 ? issues : ["Human approval remains required before publishing."],
    suggestedRevision: null,
  };
}

export async function createGrowthRecommendationDraft(formData: FormData) {
  const controlPanelMode = process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true";
  const clipId = normalizeText(formData.get("clipId"));
  const title = normalizeText(formData.get("title"));
  const caption = normalizeText(formData.get("caption"));
  const note = normalizeText(formData.get("note"));
  const postingSlot = normalizeText(formData.get("postingSlot"), "Recommended growth window");
  const platforms = uniquePostingPlatforms(parseGrowthPlatforms(formData.get("platforms")));

  if (!clipId || platforms.length === 0) {
    redirect("/growth?draft=invalid");
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      title: true,
      hook: true,
      caption: true,
      hashtags: true,
      score: true,
      finalQualityScore: true,
      overallPostScore: true,
      qualityLabel: true,
      postReadyStatus: true,
      smartClipCategory: true,
      intendedAudience: true,
      durationSeconds: true,
      exportFormat: true,
      exportStatus: true,
      status: true,
      exportedFilePath: true,
      exportPath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      renderedFilePath: true,
      sermon: {
        select: {
          id: true,
          title: true,
          churchName: true,
          speakerName: true,
          intelligence: {
            select: {
              centralTheme: true,
              summary: true,
            },
          },
        },
      },
    },
  });

  if (!clip || (clip.exportStatus !== "COMPLETED" && clip.status !== "EXPORTED")) {
    redirect("/growth?draft=not-ready");
  }

  const media = await resolveReadyMedia(clip, { trustMetadata: controlPanelMode });
  if (!media.mediaReady) {
    redirect(`/ready-to-post?clipId=${clipId}`);
  }

  const draft = await createPostingDraft({
    clipIds: [clip.id],
    platforms,
    postingSlot,
    caption: caption || clip.caption,
    title: title || clip.title,
    note,
    automationMode: "MANUAL",
  });

  const scheduledPosts = await prisma.scheduledPost.findMany({
    where: { postingDraftId: draft.id },
    select: {
      id: true,
      platform: true,
    },
  });

  const growthClip: GrowthClipInput = clip;
  try {
    await prisma.postPerformancePrediction.createMany({
      data: scheduledPosts.map((post) => {
        const growthPlatform = postingPlatformToGrowthPlatform(fromPrismaPostingPlatform(post.platform));
        const prediction = predictPostPerformance(growthClip, platforms.length);

        return {
          scheduledPostId: post.id,
          clipIdsJson: [clip.id],
          platform: growthPlatform,
          predictedReachLow: prediction.reachLow,
          predictedReachHigh: prediction.reachHigh,
          predictedEngagementRate: prediction.engagementRate,
          predictedFollowerGrowthLow: prediction.followerGrowthLow,
          predictedFollowerGrowthHigh: prediction.followerGrowthHigh,
          predictedWatchTimeSeconds: prediction.expectedWatchTimeSeconds,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
        };
      }),
    });
  } catch (error) {
    console.warn("Created growth draft without prediction persistence.", error);
  }

  revalidatePath("/growth");
  revalidatePath("/ready-to-post");
  redirect(`/ready-to-post?clipId=${clip.id}`);
}

export async function updateGrowthRecommendationStatus(formData: FormData) {
  const recommendationId = normalizeText(formData.get("recommendationId"));
  const status = normalizeText(formData.get("status"));
  const allowed = ["APPROVED", "REJECTED", "NEEDS_REVIEW", "SCHEDULED", "LEARNED"];

  if (!recommendationId || !allowed.includes(status)) {
    redirect("/growth?recommendations=invalid");
  }

  try {
    await prisma.growthRecommendation.update({
      where: { id: recommendationId },
      data: { status: status as "APPROVED" | "REJECTED" | "NEEDS_REVIEW" | "SCHEDULED" | "LEARNED" },
    });
  } catch (error) {
    console.warn("Unable to update growth recommendation status.", error);
    redirect("/growth?recommendations=not-persisted");
  }

  revalidatePath("/growth");
  redirect("/growth?recommendations=updated");
}

export async function reviewGrowthRecommendationGuardrails(formData: FormData) {
  const recommendationId = normalizeText(formData.get("recommendationId"));
  if (!recommendationId) {
    redirect("/growth?guardrails=invalid");
  }

  try {
    const recommendation = await prisma.growthRecommendation.findUnique({
      where: { id: recommendationId },
      select: {
        id: true,
        title: true,
        guardrails: true,
      },
    });

    if (!recommendation) {
      redirect("/growth?guardrails=invalid");
    }

    const review = buildGuardrailResult({
      title: recommendation.title,
      guardrails: recommendation.guardrails,
    });

    await prisma.growthGuardrailReview.create({
      data: {
        targetType: "GrowthRecommendation",
        targetId: recommendation.id,
        result: review.result,
        issuesJson: review.issues,
        suggestedRevision: review.suggestedRevision,
        reviewedBy: "growth-system-v1",
      },
    });
  } catch (error) {
    console.warn("Unable to persist growth guardrail review.", error);
    redirect("/growth?guardrails=not-persisted");
  }

  revalidatePath("/growth");
  redirect("/growth?guardrails=saved");
}

export async function createDraftFromSavedRecommendation(formData: FormData) {
  const recommendationId = normalizeText(formData.get("recommendationId"));
  if (!recommendationId) {
    redirect("/growth?draft=invalid");
  }

  try {
    const recommendationRecord = await prisma.growthRecommendation.findUnique({
      where: { id: recommendationId },
      select: {
        id: true,
        recommendationJson: true,
      },
    });
    const recommendation = parseSavedRecommendation(recommendationRecord?.recommendationJson);

    if (!recommendation) {
      redirect("/growth?draft=invalid");
    }

    const platforms = uniquePostingPlatforms(recommendation.platforms);
    if (platforms.length === 0) {
      redirect("/growth?draft=invalid");
    }

    const clip = await prisma.clipCandidate.findUnique({
      where: { id: recommendation.sourceClipId },
      select: {
        id: true,
        title: true,
        hook: true,
        caption: true,
        hashtags: true,
        score: true,
        finalQualityScore: true,
        overallPostScore: true,
        qualityLabel: true,
        postReadyStatus: true,
        smartClipCategory: true,
        intendedAudience: true,
        durationSeconds: true,
        exportStatus: true,
        status: true,
        sermon: {
          select: {
            id: true,
            title: true,
            churchName: true,
            speakerName: true,
            intelligence: {
              select: {
                centralTheme: true,
                summary: true,
              },
            },
          },
        },
      },
    });

    const draft = await createPostingDraft({
      clipIds: [recommendation.sourceClipId],
      platforms,
      postingSlot: recommendation.postingWindow,
      caption: recommendation.caption,
      title: recommendation.title,
      note: `Saved growth recommendation: ${recommendation.rationale.join(" ")} Guardrails: ${recommendation.guardrails.join(" ")}`,
      automationMode: "MANUAL",
    });
    const scheduledPosts = await prisma.scheduledPost.findMany({
      where: { postingDraftId: draft.id },
      select: { id: true, platform: true },
    });

    if (clip) {
      await prisma.postPerformancePrediction.createMany({
        data: scheduledPosts.map((post) => {
          const prediction = predictPostPerformance(clip, platforms.length);
          return {
            scheduledPostId: post.id,
            clipIdsJson: [clip.id],
            platform: postingPlatformToGrowthPlatform(fromPrismaPostingPlatform(post.platform)),
            predictedReachLow: prediction.reachLow,
            predictedReachHigh: prediction.reachHigh,
            predictedEngagementRate: prediction.engagementRate,
            predictedFollowerGrowthLow: prediction.followerGrowthLow,
            predictedFollowerGrowthHigh: prediction.followerGrowthHigh,
            predictedWatchTimeSeconds: prediction.expectedWatchTimeSeconds,
            confidence: prediction.confidence,
            reasoning: prediction.reasoning,
          };
        }),
      });
    }

    await prisma.growthRecommendation.update({
      where: { id: recommendationId },
      data: { status: "SCHEDULED" },
    });
  } catch (error) {
    console.warn("Unable to create draft from saved recommendation.", error);
    redirect("/growth?draft=not-persisted");
  }

  revalidatePath("/growth");
  revalidatePath("/ready-to-post");
  redirect("/growth?draft=saved");
}

export async function saveGrowthCampaign(formData: FormData) {
  const eventName = normalizeText(formData.get("eventName"), "Upcoming church event");
  const eventType = normalizeText(formData.get("eventType"), "church gathering");
  const startsAt = normalizeDate(formData.get("eventDate"));
  const eventDate = typeof formData.get("eventDate") === "string" ? String(formData.get("eventDate")) : "";
  const signupUrl = normalizeText(formData.get("signupUrl"));
  const plan = buildEventCampaignPlan({ eventName, eventType, startsAt });

  try {
    await prisma.growthCampaign.create({
      data: {
        name: plan.name,
        eventName,
        eventType,
        objective: plan.objective,
        startsAt,
        signupUrl: signupUrl || null,
        phases: {
          create: plan.phases.map((phase, index) => ({
            name: phase.name,
            timing: phase.timing,
            content: phase.content,
            cta: phase.cta,
            orderIndex: index,
          })),
        },
      },
    });
  } catch (error) {
    console.warn("Unable to persist growth campaign.", error);
    redirect(buildGrowthRedirect({
      campaign: "not-persisted",
      eventName,
      eventType,
      ...(eventDate ? { eventDate } : {}),
      ...(signupUrl ? { signupUrl } : {}),
    }));
  }

  revalidatePath("/growth");
  redirect(buildGrowthRedirect({
    campaign: "saved",
    eventName,
    eventType,
    ...(eventDate ? { eventDate } : {}),
    ...(signupUrl ? { signupUrl } : {}),
  }));
}

export async function generateCampaignPostingDrafts(formData: FormData) {
  const campaignId = normalizeText(formData.get("campaignId"));
  if (!campaignId) {
    redirect("/growth?campaignPosts=invalid");
  }

  try {
    const campaign = await prisma.growthCampaign.findUnique({
      where: { id: campaignId },
      include: {
        phases: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    if (!campaign) {
      redirect("/growth?campaignPosts=invalid");
    }

    for (const phase of campaign.phases) {
      await createPostingDraft({
        clipIds: [],
        platforms: ["Facebook", "Instagram"],
        postingSlot: `${campaign.eventName}: ${phase.timing}`,
        title: `${campaign.eventName}: ${phase.name}`,
        caption: `${phase.content}\n\n${phase.cta}${campaign.signupUrl ? `\n${campaign.signupUrl}` : ""}`,
        note: `Generated from growth campaign phase ${phase.name}. Human approval required before publishing.`,
        automationMode: "MANUAL",
      });

      await prisma.growthCampaignPhase.update({
        where: { id: phase.id },
        data: { status: "IN_PROGRESS" },
      });
    }

    await prisma.growthCampaign.update({
      where: { id: campaign.id },
      data: { status: "ACTIVE" },
    });
  } catch (error) {
    console.warn("Unable to generate campaign posting drafts.", error);
    redirect("/growth?campaignPosts=not-persisted");
  }

  revalidatePath("/growth");
  revalidatePath("/ready-to-post");
  redirect("/growth?campaignPosts=created");
}

async function loadGrowthClipInputs(): Promise<GrowthClipInput[]> {
  return prisma.clipCandidate.findMany({
    where: {
      OR: [
        { exportStatus: "COMPLETED" },
        { status: { in: ["APPROVED", "EXPORTED"] } },
      ],
    },
    orderBy: [
      { finalQualityScore: "desc" },
      { overallPostScore: "desc" },
      { score: "desc" },
    ],
    select: {
      id: true,
      title: true,
      hook: true,
      caption: true,
      hashtags: true,
      score: true,
      finalQualityScore: true,
      overallPostScore: true,
      qualityLabel: true,
      postReadyStatus: true,
      smartClipCategory: true,
      intendedAudience: true,
      durationSeconds: true,
      exportStatus: true,
      status: true,
      sermon: {
        select: {
          id: true,
          title: true,
          churchName: true,
          speakerName: true,
          intelligence: {
            select: {
              centralTheme: true,
              summary: true,
            },
          },
        },
      },
    },
    take: 60,
  });
}

export async function saveWeeklyGrowthRecommendations() {
  try {
    const [clips, scheduledPosts, accounts] = await Promise.all([
      loadGrowthClipInputs(),
      listScheduledPosts(),
      listSocialAccounts(),
    ]);
    const recommendations = buildGrowthRecommendations({ clips, scheduledPosts, accounts, limit: 6 });

    await prisma.$transaction(async (tx) => {
      await tx.growthRecommendation.updateMany({
        where: { status: { in: ["DRAFT", "NEEDS_REVIEW"] } },
        data: { status: "LEARNED" },
      }).catch(() => undefined);

      await tx.growthRecommendation.createMany({
        data: recommendations.map((recommendation) => ({
          sourceClipId: recommendation.sourceClipId,
          sourceSermonId: recommendation.sourceSermonId,
          recommendationType: "WEEKLY_POSTING_PLAN",
          title: recommendation.title,
          priority: recommendation.priority,
          platformsJson: recommendation.platforms,
          recommendationJson: recommendation,
          rationale: recommendation.rationale,
          guardrails: recommendation.guardrails,
          status: "NEEDS_REVIEW",
        })),
      });
    });
  } catch (error) {
    console.warn("Unable to persist weekly growth recommendations.", error);
    redirect("/growth?recommendations=not-persisted");
  }

  revalidatePath("/growth");
  redirect("/growth?recommendations=saved");
}

export async function recordPredictionActuals(formData: FormData) {
  const predictionId = normalizeText(formData.get("predictionId"));
  const actualReach = normalizeNumber(formData.get("actualReach"));
  const actualEngagementRate = normalizeNumber(formData.get("actualEngagementRate"));
  const actualFollowerGrowth = normalizeNumber(formData.get("actualFollowerGrowth"));
  const actualWatchTimeSeconds = normalizeNumber(formData.get("actualWatchTimeSeconds"));

  if (!predictionId) {
    redirect("/growth?actuals=invalid");
  }

  try {
    const prediction = await prisma.postPerformancePrediction.findUnique({
      where: { id: predictionId },
      select: {
        id: true,
        scheduledPostId: true,
        platform: true,
        predictedReachLow: true,
        predictedReachHigh: true,
        predictedEngagementRate: true,
      },
    });

    if (!prediction) {
      redirect("/growth?actuals=invalid");
    }

    const snapshot = await prisma.socialMetricSnapshot.create({
      data: {
        platform: prediction.platform,
        reach: actualReach,
        engagementRate: actualEngagementRate,
        followerGrowth: actualFollowerGrowth,
        watchTimeSeconds: actualWatchTimeSeconds,
        rawMetrics: {
          source: "manual_prediction_actuals",
          predictionId,
          scheduledPostId: prediction.scheduledPostId,
        },
        source: "MANUAL",
      },
    });

    await prisma.postPredictionResult.create({
      data: {
        predictionId,
        metricSnapshotId: snapshot.id,
        actualReach,
        actualEngagementRate,
        actualFollowerGrowth,
        actualWatchTimeSeconds,
        reachErrorPercent: calculatePercentError(actualReach, prediction.predictedReachLow, prediction.predictedReachHigh),
        engagementErrorPercent: actualEngagementRate === null
          ? null
          : Number((actualEngagementRate - prediction.predictedEngagementRate).toFixed(1)),
      },
    });
  } catch (error) {
    console.warn("Unable to record prediction actuals.", error);
    redirect("/growth?actuals=not-persisted");
  }

  revalidatePath("/growth");
  redirect("/growth?actuals=saved");
}

export async function recordMinistryOutcome(formData: FormData) {
  const scheduledPostId = normalizeText(formData.get("scheduledPostId")) || null;
  const campaignId = normalizeText(formData.get("campaignId")) || null;
  const outcomeType = normalizeText(formData.get("outcomeType"), "OTHER");
  const value = normalizeNumber(formData.get("value")) ?? 1;
  const notes = normalizeText(formData.get("notes"));

  const allowed = [
    "EVENT_SIGNUP",
    "PRAYER_REQUEST",
    "DISCIPLESHIP_STEP",
    "WEBSITE_CLICK",
    "MESSAGE",
    "TESTIMONY",
    "SERVICE_ATTENDANCE",
    "OTHER",
  ];

  if (!allowed.includes(outcomeType)) {
    redirect("/growth?outcome=invalid");
  }

  try {
    await prisma.ministryOutcome.create({
      data: {
        scheduledPostId,
        campaignId,
        outcomeType: outcomeType as "EVENT_SIGNUP" | "PRAYER_REQUEST" | "DISCIPLESHIP_STEP" | "WEBSITE_CLICK" | "MESSAGE" | "TESTIMONY" | "SERVICE_ATTENDANCE" | "OTHER",
        value,
        notes: notes || null,
      },
    });
  } catch (error) {
    console.warn("Unable to record ministry outcome.", error);
    redirect("/growth?outcome=not-persisted");
  }

  revalidatePath("/growth");
  redirect("/growth?outcome=saved");
}

export async function syncYouTubeAnalytics() {
  try {
    const days = Number(process.env.YOUTUBE_ANALYTICS_SYNC_DAYS ?? "28");
    const { startDate, endDate } = getDefaultYouTubeAnalyticsWindow(Number.isFinite(days) ? days : 28);
    const credentials = await getConnectedCredentials("YOUTUBE");

    if (credentials.length > 0) {
      const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
      const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
      if (!clientId || !clientSecret) {
        throw new Error("YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required for stored YouTube OAuth credentials.");
      }

      for (const credential of credentials) {
        try {
          const tokenSet = credential.refreshToken
            ? await refreshYouTubeAccessToken({
                clientId,
                clientSecret,
                refreshToken: credential.refreshToken,
              })
            : null;
          const accessToken = tokenSet?.accessToken ?? credential.accessToken;

          if (tokenSet) {
            await upsertSocialCredential({
              provider: "YOUTUBE",
              externalAccountId: credential.externalAccountId,
              accountName: credential.accountName,
              handle: credential.handle,
              accessToken,
              refreshToken: tokenSet.refreshToken ?? credential.refreshToken,
              tokenType: tokenSet.tokenType ?? credential.tokenType,
              scopes: tokenSet.scope?.split(" ") ?? credential.scopes,
              metadata: credential.metadata as Prisma.InputJsonValue,
              expiresAt: tokenSet.expiresAt,
            });
          }

          const metrics = await fetchYouTubeDailyAnalyticsWithAccessToken({
            accessToken,
            startDate,
            endDate,
            channelId: credential.externalAccountId,
          });

          await upsertSocialMetricSnapshots(metrics.map((metric) => ({
              dedupeKey: socialMetricDedupeKey({
                source: "API",
                platform: "YouTube",
                socialAccountId: credential.socialAccountId,
                externalAccountId: credential.externalAccountId,
                capturedAt: new Date(`${metric.date}T00:00:00.000Z`),
              }),
              socialAccountId: credential.socialAccountId,
              platform: "YouTube",
              views: metric.views,
              watchTimeSeconds: metric.watchTimeSeconds,
              averageViewDurationSeconds: metric.averageViewDurationSeconds,
              likes: metric.likes,
              comments: metric.comments,
              shares: metric.shares,
              followerGrowth: metric.subscribersGained - metric.subscribersLost,
              rawMetrics: asJson({
                ...metric.raw,
                source: "youtube_oauth",
                channelId: credential.externalAccountId,
              }),
              source: "API",
              capturedAt: new Date(`${metric.date}T00:00:00.000Z`),
            })));
          await markCredentialSyncSuccess(credential.id);
        } catch (credentialError) {
          await markCredentialSyncError(credential.id, credentialError);
          console.warn("Unable to sync stored YouTube credential.", credentialError);
        }
      }
    } else {
      const youtubeConfig = getYouTubeAnalyticsConfigFromEnv();
      const metrics = await fetchYouTubeDailyAnalytics({
        config: youtubeConfig,
        startDate,
        endDate,
      });

      await upsertSocialMetricSnapshots(metrics.map((metric) => ({
          dedupeKey: socialMetricDedupeKey({
            source: "API",
            platform: "YouTube",
            externalAccountId: youtubeConfig.channelId,
            capturedAt: new Date(`${metric.date}T00:00:00.000Z`),
          }),
          platform: "YouTube",
          views: metric.views,
          watchTimeSeconds: metric.watchTimeSeconds,
          averageViewDurationSeconds: metric.averageViewDurationSeconds,
          likes: metric.likes,
          comments: metric.comments,
          shares: metric.shares,
          followerGrowth: metric.subscribersGained - metric.subscribersLost,
          rawMetrics: asJson(metric.raw),
          source: "API",
          capturedAt: new Date(`${metric.date}T00:00:00.000Z`),
        })));
    }
  } catch (error) {
    console.warn("Unable to sync YouTube analytics.", error);
    redirect("/growth?youtube=not-synced");
  }

  revalidatePath("/growth");
  redirect("/growth?youtube=synced");
}

function getDefaultSocialAnalyticsWindow(days = 28): { since: string; until: string } {
  const { startDate, endDate } = getDefaultYouTubeAnalyticsWindow(days);
  return { since: startDate, until: endDate };
}

export async function syncMetaAnalytics() {
  try {
    const days = Number(process.env.SOCIAL_ANALYTICS_SYNC_DAYS ?? "28");
    const { since, until } = getDefaultSocialAnalyticsWindow(Number.isFinite(days) ? days : 28);
    const [facebookCredentials, instagramCredentials] = await Promise.all([
      getConnectedCredentials("META_FACEBOOK"),
      getConnectedCredentials("META_INSTAGRAM"),
    ]);

    if (facebookCredentials.length + instagramCredentials.length === 0) {
      redirect("/growth?meta=not-synced");
    }

    for (const credential of facebookCredentials) {
      try {
        const metrics = await fetchFacebookPageDailyMetrics({
          pageId: credential.externalAccountId,
          pageName: credential.accountName,
          accessToken: credential.accessToken,
          since,
          until,
        });
        await upsertSocialMetricSnapshots(metrics.map((metric) => ({
            dedupeKey: socialMetricDedupeKey({
              source: "API",
              platform: metric.platform,
              socialAccountId: credential.socialAccountId,
              externalAccountId: credential.externalAccountId,
              capturedAt: metric.capturedAt,
            }),
            socialAccountId: credential.socialAccountId,
            platform: metric.platform,
            followers: metric.followers,
            views: metric.views,
            reach: metric.reach,
            impressions: metric.impressions,
            engagementRate: metric.engagementRate,
            clickThroughs: metric.clickThroughs,
            rawMetrics: asJson(metric.raw),
            source: "API",
            capturedAt: metric.capturedAt,
          })));
        await markCredentialSyncSuccess(credential.id);
      } catch (credentialError) {
        await markCredentialSyncError(credential.id, credentialError);
        console.warn("Unable to sync Facebook credential.", credentialError);
      }
    }

    for (const credential of instagramCredentials) {
      try {
        const metrics = await fetchInstagramAccountMetrics({
          instagramAccountId: credential.externalAccountId,
          accountName: credential.accountName,
          accessToken: credential.accessToken,
          since,
          until,
        });
        await upsertSocialMetricSnapshots(metrics.map((metric) => ({
            dedupeKey: socialMetricDedupeKey({
              source: "API",
              platform: metric.platform,
              socialAccountId: credential.socialAccountId,
              externalAccountId: credential.externalAccountId,
              platformPostId: typeof metric.raw.mediaId === "string" ? metric.raw.mediaId : null,
              capturedAt: metric.capturedAt,
            }),
            socialAccountId: credential.socialAccountId,
            platform: metric.platform,
            platformPostId: typeof metric.raw.mediaId === "string" ? metric.raw.mediaId : undefined,
            postUrl: typeof metric.raw.permalink === "string" ? metric.raw.permalink : undefined,
            views: metric.views,
            reach: metric.reach,
            impressions: metric.impressions,
            engagementRate: metric.engagementRate,
            likes: metric.likes,
            comments: metric.comments,
            shares: metric.shares,
            saves: metric.saves,
            rawMetrics: asJson(metric.raw),
            source: "API",
            capturedAt: metric.capturedAt,
          })));
        await markCredentialSyncSuccess(credential.id);
      } catch (credentialError) {
        await markCredentialSyncError(credential.id, credentialError);
        console.warn("Unable to sync Instagram credential.", credentialError);
      }
    }
  } catch (error) {
    console.warn("Unable to sync Meta analytics.", error);
    redirect("/growth?meta=not-synced");
  }

  revalidatePath("/growth");
  redirect("/growth?meta=synced");
}

export async function syncTikTokAnalytics() {
  try {
    const credentials = await getConnectedCredentials("TIKTOK");
    const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
    if (credentials.length === 0 || !clientKey || !clientSecret) {
      redirect("/growth?tiktok=not-synced");
    }

    for (const credential of credentials) {
      try {
        const tokenSet = credential.refreshToken
          ? await refreshTikTokAccessToken({
              clientKey,
              clientSecret,
              refreshToken: credential.refreshToken,
            })
          : null;
        const accessToken = tokenSet?.accessToken ?? credential.accessToken;
        if (tokenSet) {
          await upsertSocialCredential({
            provider: "TIKTOK",
            externalAccountId: credential.externalAccountId,
            accountName: credential.accountName,
            handle: credential.handle,
            accessToken,
            refreshToken: tokenSet.refreshToken ?? credential.refreshToken,
            tokenType: tokenSet.tokenType ?? credential.tokenType,
            scopes: tokenSet.scope?.split(",") ?? credential.scopes,
            metadata: credential.metadata as Prisma.InputJsonValue,
            expiresAt: tokenSet.expiresAt,
          });
        }

        const metrics = await fetchTikTokVideoMetrics({ accessToken });
        await upsertSocialMetricSnapshots(metrics.map((metric) => ({
            dedupeKey: socialMetricDedupeKey({
              source: "API",
              platform: "TikTok",
              socialAccountId: credential.socialAccountId,
              externalAccountId: credential.externalAccountId,
              platformPostId: metric.platformPostId,
              capturedAt: metric.capturedAt,
            }),
            socialAccountId: credential.socialAccountId,
            platform: "TikTok",
            platformPostId: metric.platformPostId,
            postUrl: metric.postUrl,
            views: metric.views,
            engagementRate: metric.engagementRate,
            likes: metric.likes,
            comments: metric.comments,
            shares: metric.shares,
            rawMetrics: asJson(metric.raw),
            source: "API",
            capturedAt: metric.capturedAt,
          })));
        await markCredentialSyncSuccess(credential.id);
      } catch (credentialError) {
        await markCredentialSyncError(credential.id, credentialError);
        console.warn("Unable to sync TikTok credential.", credentialError);
      }
    }
  } catch (error) {
    console.warn("Unable to sync TikTok analytics.", error);
    redirect("/growth?tiktok=not-synced");
  }

  revalidatePath("/growth");
  redirect("/growth?tiktok=synced");
}

export async function syncThreadsAnalytics() {
  try {
    const credentials = await getConnectedCredentials("THREADS");
    if (credentials.length === 0) {
      redirect("/growth?threads=not-synced");
    }

    for (const credential of credentials) {
      try {
        const metrics = await fetchThreadsPostMetrics({ accessToken: credential.accessToken });
        await upsertSocialMetricSnapshots(metrics.map((metric) => ({
            dedupeKey: socialMetricDedupeKey({
              source: "API",
              platform: "Threads",
              socialAccountId: credential.socialAccountId,
              externalAccountId: credential.externalAccountId,
              platformPostId: metric.platformPostId,
              capturedAt: metric.capturedAt,
            }),
            socialAccountId: credential.socialAccountId,
            platform: "Threads",
            platformPostId: metric.platformPostId,
            postUrl: metric.postUrl,
            views: metric.views,
            engagementRate: metric.engagementRate,
            likes: metric.likes,
            comments: metric.comments,
            shares: metric.shares,
            rawMetrics: asJson({
              ...metric.raw,
              externalAccountId: credential.externalAccountId,
            }),
            source: "API",
            capturedAt: metric.capturedAt,
          })));
        await markCredentialSyncSuccess(credential.id);
      } catch (credentialError) {
        await markCredentialSyncError(credential.id, credentialError);
        console.warn("Unable to sync Threads credential.", credentialError);
      }
    }
  } catch (error) {
    console.warn("Unable to sync Threads analytics.", error);
    redirect("/growth?threads=not-synced");
  }

  revalidatePath("/growth");
  redirect("/growth?threads=synced");
}
