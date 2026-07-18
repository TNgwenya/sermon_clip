"use server";

import { createHash } from "node:crypto";

import type { PostingPlatform as PrismaPostingPlatform, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runContentPublishingPreflight } from "@/lib/contentPublishingPreflight";
import { fromPrismaPostingPlatform } from "@/lib/postingDrafts";
import { prisma } from "@/lib/prisma";
import {
  findRepeatedSermonPointWarnings,
  isValidIanaTimeZone,
  WEEKLY_PLAN_OBJECTIVES,
} from "@/lib/weeklyPlan";
import { resolveReadyMedia } from "@/lib/readyMedia";
import { extractCaptionPackage } from "@/lib/clipStudio";
import { buildCanonicalPlatformPayloads } from "@/lib/publishingPayload";

const platformSchema = z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE_SHORTS", "FACEBOOK"]);
const planItemSchema = z.object({
  sourceId: z.string().trim().min(1),
  sourceKind: z.enum(["CLIP", "CONTENT_ASSET"]),
  sermonId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(255),
  caption: z.string().trim().min(1).max(63_206),
  contentType: z.string().trim().min(1).max(100),
  pointKey: z.string().trim().min(1).max(300),
  platform: platformSchema,
  scheduledFor: z.string().datetime(),
});
const weeklyPlanSchema = z.object({
  sermonId: z.string().trim().min(1),
  weekStart: z.string().trim().min(1),
  timezone: z.string().trim().min(1).max(100).refine(isValidIanaTimeZone, "Choose a valid IANA timezone, such as Africa/Johannesburg."),
  objective: z.enum(WEEKLY_PLAN_OBJECTIVES),
  items: z.array(planItemSchema).min(1).max(28),
});

export type BulkScheduleWeeklyPlanInput = z.infer<typeof weeklyPlanSchema>;
export type BulkScheduleWeeklyPlanResult = {
  success: boolean;
  message: string;
  createdCount?: number;
  scheduledPostIds?: string[];
  warnings?: string[];
};

const performanceMetricSchema = z.number().int().nonnegative().max(2_000_000_000).nullable().optional();
const performanceSchema = z.object({
  scheduledPostId: z.string().trim().min(1),
  reach: performanceMetricSchema,
  views: performanceMetricSchema,
  comments: performanceMetricSchema,
  shares: performanceMetricSchema,
  saves: performanceMetricSchema,
  clickThroughs: performanceMetricSchema,
});

export type RecordWeeklyPlanPerformanceInput = z.infer<typeof performanceSchema>;

function normalizeJsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function objectMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type AssetPreflightFile = {
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: bigint | null;
  metadataJson: Prisma.JsonValue | null;
};

function selectPlatformPreflightFiles(input: {
  assetType: string;
  platform: PrismaPostingPlatform;
  files: AssetPreflightFile[];
}): AssetPreflightFile[] {
  const pngFiles = input.files.filter((file) => file.mimeType === "image/png");
  const preferredMimeFiles = pngFiles.length > 0
    ? pngFiles
    : input.files.filter((file) => file.mimeType === "image/jpeg");
  if (input.assetType === "CAROUSEL") {
    const slides = preferredMimeFiles.filter((file) => objectMetadata(file.metadataJson).variant === "CAROUSEL_SLIDE");
    return (slides.length > 0 ? slides : preferredMimeFiles).slice(0, 10);
  }

  const preferredVariant: Partial<Record<PrismaPostingPlatform, string>> = {
    INSTAGRAM: "PORTRAIT",
    FACEBOOK: "FACEBOOK_LANDSCAPE",
    TIKTOK: "STORY",
    YOUTUBE_SHORTS: "PORTRAIT",
  };
  const variant = preferredVariant[input.platform];
  const matches = variant
    ? preferredMimeFiles.filter((file) => objectMetadata(file.metadataJson).variant === variant)
    : [];
  return (matches.length > 0 ? matches : preferredMimeFiles).slice(0, 1);
}

function buildWeeklyPlanIdempotencyKey(item: z.infer<typeof planItemSchema>): string {
  const fingerprint = [
    "weekly-plan-v1",
    item.sourceKind,
    item.sourceId,
    item.platform,
    item.scheduledFor,
  ].join(":");
  return `weekly-plan:${createHash("sha256").update(fingerprint).digest("hex")}`;
}

function formatPostingSlot(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function resolveWeeklyClipPlatformCopy(input: {
  title: string;
  hook: string;
  caption: string;
  hashtags: Prisma.JsonValue;
  intendedAudience: string | null;
  captionData: Prisma.JsonValue | null;
  platform: PrismaPostingPlatform;
}): { title: string; caption: string } {
  const packageCopy = extractCaptionPackage(
    input.captionData,
    input.caption,
    normalizeJsonStringArray(input.hashtags),
  );
  const platform = fromPrismaPostingPlatform(input.platform);
  const payload = buildCanonicalPlatformPayloads({
    title: input.title,
    hook: input.hook,
    caption: packageCopy.primaryCaption ?? input.caption,
    shortCaption: packageCopy.shortCaption,
    platformCaption: packageCopy.platformCaption,
    hashtags: packageCopy.hashtags,
    intendedAudience: input.intendedAudience,
  })[platform];

  return { title: payload.title, caption: payload.caption };
}

export async function bulkScheduleWeeklyPlanAction(
  input: BulkScheduleWeeklyPlanInput,
): Promise<BulkScheduleWeeklyPlanResult> {
  const parsed = weeklyPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `The weekly plan is incomplete: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }

  const items = parsed.data.items;
  if (items.some((item) => item.sermonId !== parsed.data.sermonId)) {
    return { success: false, message: "Every item in this plan must belong to the selected sermon." };
  }
  const sourceKeys = items.map((item) => `${item.sourceKind}:${item.sourceId}:${item.platform}:${item.scheduledFor}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    return { success: false, message: "Remove duplicate rows from the weekly plan before scheduling." };
  }

  const now = Date.now();
  const invalidDate = items.find((item) => {
    const value = new Date(item.scheduledFor).getTime();
    return !Number.isFinite(value) || value < now - 60_000;
  });
  if (invalidDate) {
    return { success: false, message: `Choose a future time for “${invalidDate.title}”.` };
  }

  const contentAssetIds = items
    .filter((item) => item.sourceKind === "CONTENT_ASSET")
    .map((item) => item.sourceId);
  const clipIds = items
    .filter((item) => item.sourceKind === "CLIP")
    .map((item) => item.sourceId);

  const [sermon, assets, clips] = await Promise.all([
    prisma.sermon.findUnique({
      where: { id: parsed.data.sermonId },
      select: { id: true, title: true },
    }),
    prisma.contentAsset.findMany({
      where: { id: { in: contentAssetIds }, sermonId: parsed.data.sermonId },
      select: {
        id: true,
        status: true,
        assetType: true,
        caption: true,
        metadataJson: true,
        contentOpportunity: { select: { sourceTranscriptExcerpt: true } },
        files: {
          select: {
            mimeType: true,
            width: true,
            height: true,
            sizeBytes: true,
            metadataJson: true,
          },
        },
      },
    }),
    prisma.clipCandidate.findMany({
      where: {
        id: { in: clipIds },
        sermonId: parsed.data.sermonId,
        transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
        OR: [{ exportStatus: "COMPLETED" }, { status: "EXPORTED" }],
      },
      select: {
        id: true,
        title: true,
        hook: true,
        caption: true,
        hashtags: true,
        intendedAudience: true,
        exportFormat: true,
        exportStatus: true,
        exportFreshness: true,
        captionData: true,
        exportedFilePath: true,
        exportPath: true,
        overlayVideoPath: true,
        captionedVideoPath: true,
        renderedFilePath: true,
      },
    }),
  ]);

  if (!sermon) return { success: false, message: "The selected sermon no longer exists." };
  if (assets.length !== new Set(contentAssetIds).size || clips.length !== new Set(clipIds).size) {
    return {
      success: false,
      message: "One or more plan items are no longer approved and ready. Rebuild the weekly plan.",
    };
  }

  const itemByAssetId = new Map(items
    .filter((item) => item.sourceKind === "CONTENT_ASSET")
    .map((item) => [item.sourceId, item]));
  for (const asset of assets) {
    const item = itemByAssetId.get(asset.id);
    if (!item) continue;
    const metadata = objectMetadata(asset.metadataJson);
    const preflightFiles = selectPlatformPreflightFiles({
      assetType: asset.assetType,
      platform: item.platform,
      files: asset.files,
    });
    const preflight = runContentPublishingPreflight({
      assetType: asset.assetType,
      status: asset.status,
      platform: fromPrismaPostingPlatform(item.platform),
      caption: item.caption,
      sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
      translationNeedsReview: metadata.translationNeedsReview === true,
      files: preflightFiles.map((file) => {
        const fileMetadata = objectMetadata(file.metadataJson);
        return {
          mimeType: file.mimeType,
          width: file.width,
          height: file.height,
          sizeBytes: file.sizeBytes ? Number(file.sizeBytes) : null,
          overflowDetected: fileMetadata.overflowDetected === true,
        };
      }),
    });
    if (!preflight.canSchedule) {
      return {
        success: false,
        message: preflight.checks.find((check) => check.status === "BLOCKED")?.summary
          ?? `Resolve the publishing checks for “${item.title}”.`,
      };
    }
  }

  const controlPanelMode = process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true";
  const mediaChecks = await Promise.all(clips.map(async (clip) => ({
    id: clip.id,
    media: await resolveReadyMedia(clip, { trustMetadata: controlPanelMode }),
  })));
  const missingClip = mediaChecks.find((check) => !check.media.mediaReady);
  if (missingClip) {
    return { success: false, message: "One or more clips need their posting media rebuilt before scheduling." };
  }

  const times = items.map((item) => new Date(item.scheduledFor).getTime());
  const windowStart = new Date(Math.min(...times) - 14 * 24 * 60 * 60_000);
  const windowEnd = new Date(Math.max(...times) + 14 * 24 * 60 * 60_000);
  const nearbyPosts = await prisma.scheduledPost.findMany({
    where: {
      scheduledFor: { gte: windowStart, lte: windowEnd },
      status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "POSTING", "POSTED"] },
    },
    select: {
      id: true,
      platform: true,
      scheduledFor: true,
      clipIdsJson: true,
      contentAssetLinks: { select: { contentAssetId: true } },
    },
  });
  const exactDuplicate = items.find((item) => nearbyPosts.some((post) => (
    post.platform === item.platform
    && post.scheduledFor
    && Math.abs(post.scheduledFor.getTime() - new Date(item.scheduledFor).getTime()) <= 14 * 24 * 60 * 60_000
    && (item.sourceKind === "CLIP"
      ? normalizeJsonStringArray(post.clipIdsJson).includes(item.sourceId)
      : post.contentAssetLinks.some((link) => link.contentAssetId === item.sourceId))
  )));
  if (exactDuplicate) {
    return {
      success: false,
      message: `“${exactDuplicate.title}” is already scheduled on ${fromPrismaPostingPlatform(exactDuplicate.platform)} within fourteen days.`,
    };
  }

  const warnings = findRepeatedSermonPointWarnings(items);
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  try {
    const createdPostIds = await prisma.$transaction(async (tx) => {
      const draft = await tx.postingDraft.create({
        data: {
          clipIdsJson: clipIds,
          platformsJson: Array.from(new Set(items.map((item) => fromPrismaPostingPlatform(item.platform)))),
          postingSlot: `Week of ${parsed.data.weekStart}`,
          note: `${parsed.data.objective.toLowerCase()} weekly plan for ${sermon.title}. Human review remains required.`,
          status: "READY_FOR_MEDIA_TEAM",
        },
        select: { id: true },
      });

      const postIds: string[] = [];
      for (const item of items) {
        const scheduledFor = new Date(item.scheduledFor);
        const clip = item.sourceKind === "CLIP" ? clipsById.get(item.sourceId) : null;
        const platformCopy = clip
          ? resolveWeeklyClipPlatformCopy({ ...clip, platform: item.platform })
          : null;
        const post = await tx.scheduledPost.create({
          data: {
            postingDraftId: draft.id,
            clipIdsJson: item.sourceKind === "CLIP" ? [item.sourceId] : [],
            platform: item.platform as PrismaPostingPlatform,
            postingSlot: formatPostingSlot(scheduledFor, parsed.data.timezone),
            title: platformCopy?.title ?? item.title,
            caption: platformCopy?.caption ?? item.caption,
            note: [
              `Weekly plan objective: ${parsed.data.objective.toLowerCase()}.`,
              `Sermon point: ${item.pointKey}.`,
              item.sourceKind === "CONTENT_ASSET"
                ? "Manual non-video handoff; complete any native platform steps before publishing."
                : "Manual clip handoff; automatic publishing can be enabled later from a verified platform workflow.",
            ].join(" "),
            status: "READY_FOR_MEDIA_TEAM",
            automationMode: "MANUAL",
            scheduledFor,
            timezone: parsed.data.timezone,
            idempotencyKey: buildWeeklyPlanIdempotencyKey(item),
            ...(item.sourceKind === "CONTENT_ASSET"
              ? { contentAssetLinks: { create: { contentAssetId: item.sourceId, sortOrder: 0 } } }
              : {}),
          },
          select: { id: true },
        });
        postIds.push(post.id);
      }

      if (contentAssetIds.length > 0) {
        await tx.contentAsset.updateMany({
          where: {
            id: { in: contentAssetIds },
            status: { in: ["PREPARED", "READY"] },
          },
          data: {
            status: "SCHEDULED",
            scheduledAt: new Date(Math.min(...times)),
            publishedAt: null,
            archivedAt: null,
          },
        });
      }
      return postIds;
    });

    revalidatePath("/weekly-plan");
    revalidatePath("/ready-to-post");
    revalidatePath("/growth");
    return {
      success: true,
      message: `${createdPostIds.length} reviewed handoff${createdPostIds.length === 1 ? "" : "s"} added to the mixed-content calendar.`,
      createdCount: createdPostIds.length,
      scheduledPostIds: createdPostIds,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The weekly plan could not be scheduled.";
    if (message.includes("Unique constraint") || message.includes("idempotencyKey")) {
      return { success: false, message: "This exact weekly plan item is already scheduled. Refresh before trying again." };
    }
    return { success: false, message };
  }
}

export async function recordWeeklyPlanPerformanceAction(
  input: RecordWeeklyPlanPerformanceInput,
): Promise<{ success: boolean; message: string }> {
  const parsed = performanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `The performance result is incomplete: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }
  const values = [
    parsed.data.reach,
    parsed.data.views,
    parsed.data.comments,
    parsed.data.shares,
    parsed.data.saves,
    parsed.data.clickThroughs,
  ];
  if (!values.some((value) => typeof value === "number")) {
    return { success: false, message: "Enter at least one result before saving performance." };
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: parsed.data.scheduledPostId },
    select: {
      id: true,
      status: true,
      platform: true,
      socialAccountId: true,
      externalPostId: true,
      publishedUrl: true,
      clipIdsJson: true,
      contentAssetLinks: {
        select: {
          contentAsset: { select: { id: true, sermonId: true } },
        },
      },
    },
  });
  if (!post || post.status !== "POSTED") {
    return { success: false, message: "Mark this handoff as posted before recording its results." };
  }
  const clipIds = normalizeJsonStringArray(post.clipIdsJson);
  if (clipIds.length === 0 && post.contentAssetLinks.length === 0) {
    return { success: false, message: "This post is not linked to a traceable sermon asset." };
  }

  await prisma.socialMetricSnapshot.create({
    data: {
      socialAccountId: post.socialAccountId,
      platform: fromPrismaPostingPlatform(post.platform),
      platformPostId: post.externalPostId,
      postUrl: post.publishedUrl,
      reach: parsed.data.reach ?? null,
      views: parsed.data.views ?? null,
      comments: parsed.data.comments ?? null,
      shares: parsed.data.shares ?? null,
      saves: parsed.data.saves ?? null,
      clickThroughs: parsed.data.clickThroughs ?? null,
      source: "MANUAL",
      rawMetrics: {
        source: "weekly_plan_manual_results",
        scheduledPostId: post.id,
        clipIds,
        contentAssetIds: post.contentAssetLinks.map((link) => link.contentAsset.id),
        sermonIds: Array.from(new Set(post.contentAssetLinks.map((link) => link.contentAsset.sermonId))),
      },
    },
  });
  revalidatePath("/weekly-plan");
  revalidatePath("/growth");
  return { success: true, message: "Performance saved and traced back to the source sermon content." };
}

export const __weeklyPlanActionTestUtils = {
  buildWeeklyPlanIdempotencyKey,
  formatPostingSlot,
  selectPlatformPreflightFiles,
  resolveWeeklyClipPlatformCopy,
};
