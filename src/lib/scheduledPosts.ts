import type {
  PostingAutomationMode as PrismaPostingAutomationMode,
  PostingPlatform as PrismaPostingPlatform,
  ScheduledPostStatus as PrismaScheduledPostStatus,
  ScheduledPostWorkerStatus as PrismaScheduledPostWorkerStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  fromPrismaPostingPlatform,
  type PostingPlatform,
} from "@/lib/postingDrafts";

export type ScheduledPost = {
  id: string;
  postingDraftId: string | null;
  socialAccountId: string | null;
  socialAccountLabel: string | null;
  clipIds: string[];
  platform: PostingPlatform;
  postingSlot: string;
  title: string;
  caption: string;
  note: string;
  status: PrismaScheduledPostStatus;
  automationMode: PrismaPostingAutomationMode;
  scheduledFor: string | null;
  timezone: string | null;
  workerStatus: PrismaScheduledPostWorkerStatus;
  attemptCount: number;
  claimedAt: string | null;
  workerId: string | null;
  lastAttemptAt: string | null;
  externalPostId: string | null;
  publishedUrl: string | null;
  publishError: string | null;
  finalPrivacyStatus: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export type ManualPublishingStatus = "READY_FOR_MEDIA_TEAM" | "POSTED" | "FAILED" | "SKIPPED";
export type ScheduledPostAction = "POST_NOW";

const MANUAL_PUBLISHING_STATUSES: ManualPublishingStatus[] = ["READY_FOR_MEDIA_TEAM", "POSTED", "FAILED", "SKIPPED"];
const SCHEDULED_POST_ACTIONS: ScheduledPostAction[] = ["POST_NOW"];

function normalizeClipIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function toScheduledPost(input: {
  id: string;
  postingDraftId: string | null;
  socialAccountId: string | null;
  clipIdsJson: unknown;
  platform: PrismaPostingPlatform;
  postingSlot: string;
  title: string | null;
  caption: string | null;
  note: string | null;
  status: PrismaScheduledPostStatus;
  automationMode: PrismaPostingAutomationMode;
  scheduledFor: Date | null;
  timezone: string | null;
  workerStatus: PrismaScheduledPostWorkerStatus;
  attemptCount: number;
  claimedAt: Date | null;
  workerId: string | null;
  lastAttemptAt: Date | null;
  externalPostId: string | null;
  publishedUrl: string | null;
  publishError: string | null;
  finalPrivacyStatus: string | null;
  idempotencyKey: string;
  createdAt: Date;
  socialAccount: { label: string } | null;
}): ScheduledPost {
  return {
    id: input.id,
    postingDraftId: input.postingDraftId,
    socialAccountId: input.socialAccountId,
    socialAccountLabel: input.socialAccount?.label ?? null,
    clipIds: normalizeClipIds(input.clipIdsJson),
    platform: fromPrismaPostingPlatform(input.platform),
    postingSlot: input.postingSlot,
    title: input.title ?? "",
    caption: input.caption ?? "",
    note: input.note ?? "",
    status: input.status,
    automationMode: input.automationMode,
    scheduledFor: input.scheduledFor?.toISOString() ?? null,
    timezone: input.timezone,
    workerStatus: input.workerStatus,
    attemptCount: input.attemptCount,
    claimedAt: input.claimedAt?.toISOString() ?? null,
    workerId: input.workerId,
    lastAttemptAt: input.lastAttemptAt?.toISOString() ?? null,
    externalPostId: input.externalPostId,
    publishedUrl: input.publishedUrl,
    publishError: input.publishError,
    finalPrivacyStatus: input.finalPrivacyStatus,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt.toISOString(),
  };
}

export async function listScheduledPosts(): Promise<ScheduledPost[]> {
  const posts = await prisma.scheduledPost.findMany({
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return posts.map(toScheduledPost);
}

export function normalizeManualPublishingStatus(value: unknown): ManualPublishingStatus | null {
  return typeof value === "string" && MANUAL_PUBLISHING_STATUSES.includes(value as ManualPublishingStatus)
    ? value as ManualPublishingStatus
    : null;
}

export function normalizeScheduledPostAction(value: unknown): ScheduledPostAction | null {
  return typeof value === "string" && SCHEDULED_POST_ACTIONS.includes(value as ScheduledPostAction)
    ? value as ScheduledPostAction
    : null;
}

export async function updateScheduledPostStatus(input: {
  id: string;
  status: ManualPublishingStatus;
}): Promise<ScheduledPost | null> {
  const existing = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    select: { id: true },
  });

  if (!existing) {
    return null;
  }

  const post = await prisma.scheduledPost.update({
    where: { id: input.id },
    data: { status: input.status },
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
  });

  return toScheduledPost(post);
}

export async function postScheduledPostNow(input: {
  id: string;
  now?: Date;
}): Promise<ScheduledPost | null> {
  const now = input.now ?? new Date();

  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      automationMode: "AUTOMATIC",
      status: { in: ["PLANNED", "FAILED"] },
    },
    data: {
      status: "PLANNED",
      workerStatus: "IDLE",
      postingSlot: "Post now",
      scheduledFor: now,
      claimedAt: null,
      workerId: null,
      publishError: null,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
  });

  return post ? toScheduledPost(post) : null;
}

export type AutomationUpcomingPost = ScheduledPost & {
  clips: Array<{
    id: string;
    title: string;
    caption: string;
    hashtags: unknown;
    localFileCandidates: string[];
    sermon: {
      id: string;
      title: string;
      churchName: string;
    };
  }>;
};

const ACTIVE_AUTOMATION_STATUSES: PrismaScheduledPostStatus[] = ["PLANNED", "FAILED"];

export async function listUpcomingAutomationPosts(input: {
  now?: Date;
  windowMinutes?: number;
} = {}): Promise<AutomationUpcomingPost[]> {
  const now = input.now ?? new Date();
  const windowMinutes = input.windowMinutes ?? 60 * 24 * 7;
  const windowEnd = new Date(now.getTime() + windowMinutes * 60_000);

  const posts = await prisma.scheduledPost.findMany({
    where: {
      automationMode: "AUTOMATIC",
      scheduledFor: {
        not: null,
        lte: windowEnd,
      },
      status: { in: ACTIVE_AUTOMATION_STATUSES },
    },
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });

  const clipIds = Array.from(new Set(posts.flatMap((post) => normalizeClipIds(post.clipIdsJson))));
  const clips = await prisma.clipCandidate.findMany({
    where: { id: { in: clipIds } },
    select: {
      id: true,
      title: true,
      caption: true,
      hashtags: true,
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
        },
      },
    },
  });
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));

  return posts.map((post) => {
    const scheduledPost = toScheduledPost(post);
    return {
      ...scheduledPost,
      clips: scheduledPost.clipIds
        .map((clipId) => clipsById.get(clipId))
        .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
        .map((clip) => ({
          id: clip.id,
          title: clip.title,
          caption: clip.caption,
          hashtags: clip.hashtags,
          localFileCandidates: [
            clip.exportedFilePath,
            clip.exportPath,
            clip.overlayVideoPath,
            clip.captionedVideoPath,
            clip.renderedFilePath,
          ].filter((filePath): filePath is string => Boolean(filePath)),
          sermon: clip.sermon,
        })),
    };
  });
}

export async function claimScheduledPost(input: {
  id: string;
  workerId: string;
  now?: Date;
}): Promise<ScheduledPost | null> {
  const now = input.now ?? new Date();
  const claimResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      automationMode: "AUTOMATIC",
      scheduledFor: { lte: now },
      status: { in: ACTIVE_AUTOMATION_STATUSES },
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
      ],
    },
    data: {
      status: "POSTING",
      workerStatus: "CLAIMED",
      claimedAt: now,
      workerId: input.workerId,
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      publishError: null,
    },
  });

  if (claimResult.count === 0) {
    return null;
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
  });

  return post ? toScheduledPost(post) : null;
}

export type CompleteScheduledPostStatus = "POSTED" | "FAILED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";

export function normalizeCompleteScheduledPostStatus(value: unknown): CompleteScheduledPostStatus | null {
  return value === "POSTED" || value === "FAILED" || value === "PRIVATE_ONLY_UNVERIFIED" || value === "SKIPPED"
    ? value
    : null;
}

export async function completeScheduledPost(input: {
  id: string;
  workerId: string;
  status: CompleteScheduledPostStatus;
  externalPostId?: string | null;
  publishedUrl?: string | null;
  publishError?: string | null;
  finalPrivacyStatus?: string | null;
}): Promise<ScheduledPost | null> {
  const post = await prisma.scheduledPost.update({
    where: { id: input.id },
    data: {
      status: input.status,
      workerStatus: input.status === "FAILED" ? "FAILED" : "SUCCEEDED",
      workerId: input.workerId,
      claimedAt: null,
      externalPostId: input.externalPostId || null,
      publishedUrl: input.publishedUrl || null,
      publishError: input.publishError || null,
      finalPrivacyStatus: input.finalPrivacyStatus || null,
    },
    include: {
      socialAccount: {
        select: { label: true },
      },
    },
  }).catch(() => null);

  return post ? toScheduledPost(post) : null;
}
