import type {
  PostingDraftStatus as PrismaPostingDraftStatus,
  PostingPlatform as PrismaPostingPlatform,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { buildClipSchedulePlan, normalizeScheduleIntervalMinutes } from "@/lib/postingSchedule";

export type PostingPlatform = "TikTok" | "Instagram" | "YouTube Shorts" | "Facebook";

export type PostingDraftStatus = "DRAFT" | "READY_FOR_MEDIA_TEAM";
export type PostingAutomationMode = "MANUAL" | "AUTOMATIC";
export type ClipPostCopy = {
  title?: string;
  caption?: string;
  note?: string;
};
export type PlatformClipPostCopy = Partial<Record<PostingPlatform, ClipPostCopy>>;

export type PostingDraft = {
  id: string;
  clipIds: string[];
  platforms: PostingPlatform[];
  postingSlot: string;
  note: string;
  status: PostingDraftStatus;
  createdAt: string;
};

export const POSTING_PLATFORMS: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];

export class PostingDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingDraftValidationError";
  }
}

const PLATFORM_TO_DB: Record<PostingPlatform, PrismaPostingPlatform> = {
  TikTok: "TIKTOK",
  Instagram: "INSTAGRAM",
  "YouTube Shorts": "YOUTUBE_SHORTS",
  Facebook: "FACEBOOK",
};

const PLATFORM_FROM_DB: Record<PrismaPostingPlatform, PostingPlatform> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE_SHORTS: "YouTube Shorts",
  FACEBOOK: "Facebook",
};

const AUTOMATION_MODES: PostingAutomationMode[] = ["MANUAL", "AUTOMATIC"];

function normalizeJsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function toPostingDraft(input: {
  id: string;
  clipIdsJson: unknown;
  platformsJson: unknown;
  postingSlot: string;
  note: string | null;
  status: PrismaPostingDraftStatus;
  createdAt: Date;
}): PostingDraft {
  return {
    id: input.id,
    clipIds: normalizeJsonStringArray(input.clipIdsJson),
    platforms: normalizeJsonStringArray(input.platformsJson).filter((item): item is PostingPlatform => (
      POSTING_PLATFORMS.includes(item as PostingPlatform)
    )),
    postingSlot: input.postingSlot,
    note: input.note ?? "",
    status: input.status,
    createdAt: input.createdAt.toISOString(),
  };
}

export function normalizePostingPlatforms(value: unknown): PostingPlatform[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is PostingPlatform => (
    typeof item === "string" && POSTING_PLATFORMS.includes(item as PostingPlatform)
  ))));
}

export function normalizeClipIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

export function normalizePostingAutomationMode(value: unknown): PostingAutomationMode {
  return typeof value === "string" && AUTOMATION_MODES.includes(value as PostingAutomationMode)
    ? value as PostingAutomationMode
    : "MANUAL";
}

export function normalizeScheduledFor(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeTimezone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Africa/Johannesburg";
  }

  return value.trim().slice(0, 80);
}

function buildPostingSlot(scheduledFor: Date | null, fallback: string): string {
  if (!scheduledFor) {
    return fallback.trim() || "This week";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(scheduledFor);
}

function buildScheduledPostIdempotencyKey(input: {
  draftId: string;
  platform: PostingPlatform;
  clipIds: string[];
  scheduledFor: Date | null;
  automationMode: PostingAutomationMode;
  socialAccountId?: string | null;
}): string {
  return [
    input.draftId,
    input.platform,
    input.socialAccountId ?? "default",
    [...input.clipIds].sort().join("-"),
    input.scheduledFor?.toISOString() ?? "manual",
    input.automationMode,
  ].join(":");
}

export async function listPostingDrafts(): Promise<PostingDraft[]> {
  const drafts = await prisma.postingDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return drafts.map(toPostingDraft);
}

export async function createPostingDraft(input: {
  clipIds: string[];
  platforms: PostingPlatform[];
  socialAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
  postingSlot: string;
  automationMode?: PostingAutomationMode;
  scheduledFor?: Date | null;
  scheduleIntervalMinutes?: number;
  timezone?: string;
  caption?: string;
  title?: string;
  note?: string;
  clipCopyById?: Record<string, ClipPostCopy>;
  platformCopyByClipId?: Record<string, PlatformClipPostCopy>;
}): Promise<PostingDraft> {
  const automationMode = input.automationMode ?? "MANUAL";
  const scheduledFor = input.scheduledFor ?? null;
  const scheduleIntervalMinutes = normalizeScheduleIntervalMinutes(input.scheduleIntervalMinutes, input.clipIds.length);
  const clipSchedulePlan = buildClipSchedulePlan(input.clipIds, scheduledFor, scheduleIntervalMinutes);
  const postingSlot = buildPostingSlot(scheduledFor, input.postingSlot);
  const timezone = input.timezone?.trim() || "Africa/Johannesburg";
  const caption = input.caption?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const note = input.note?.trim() ?? "";
  const clipCopyById = input.clipCopyById ?? {};
  const platformCopyByClipId = input.platformCopyByClipId ?? {};

  const draft = await prisma.$transaction(async (tx) => {
    const created = await tx.postingDraft.create({
      data: {
        clipIdsJson: input.clipIds,
        platformsJson: input.platforms,
        postingSlot,
        note: note || null,
        status: "READY_FOR_MEDIA_TEAM",
      },
    });

    const accounts = await tx.socialAccount.findMany({
      where: {
        platform: { in: input.platforms.map((platform) => PLATFORM_TO_DB[platform]) },
        status: "CONNECTED",
      },
      orderBy: { createdAt: "desc" },
    });

    await tx.scheduledPost.createMany({
      data: clipSchedulePlan.flatMap((clipSchedule) => input.platforms.flatMap((platform) => {
        const dbPlatform = PLATFORM_TO_DB[platform];
        const selectedAccountIds = new Set(input.socialAccountIdsByPlatform?.[platform] ?? []);
        const selectedAccounts = accounts.filter((item) => item.platform === dbPlatform && selectedAccountIds.has(item.id));
        if (selectedAccountIds.size > 0 && selectedAccounts.length !== selectedAccountIds.size) {
          throw new PostingDraftValidationError(`Choose a connected ${platform} account before scheduling.`);
        }

        const fallbackAccount = automationMode === "AUTOMATIC" && (dbPlatform === "TIKTOK" || dbPlatform === "INSTAGRAM")
          ? accounts.find((item) => item.platform === dbPlatform && item.externalProvider === "zernio" && item.externalAccountId)
            ?? accounts.find((item) => item.platform === dbPlatform)
          : accounts.find((item) => item.platform === dbPlatform);
        const targetAccounts = selectedAccounts.length > 0 ? selectedAccounts : [fallbackAccount];
        const status = automationMode === "AUTOMATIC" ? "PLANNED" : "READY_FOR_MEDIA_TEAM";
        const clipScheduledFor = clipSchedule.scheduledFor;
        const clipPostingSlot = buildPostingSlot(clipScheduledFor, input.postingSlot);
        const clipIds = [clipSchedule.clipId];
        const clipCopy = platformCopyByClipId[clipSchedule.clipId]?.[platform]
          ?? clipCopyById[clipSchedule.clipId];
        const clipTitle = clipCopy?.title?.trim() || title;
        const clipCaption = clipCopy?.caption?.trim() || caption;
        const clipNote = clipCopy?.note?.trim() || note;

        return targetAccounts.map((account) => ({
          postingDraftId: created.id,
          socialAccountId: account?.id ?? null,
          clipIdsJson: clipIds,
          platform: dbPlatform,
          postingSlot: clipPostingSlot,
          title: clipTitle || null,
          caption: clipCaption || null,
          note: clipNote || null,
          status,
          automationMode,
          scheduledFor: clipScheduledFor,
          timezone,
          idempotencyKey: buildScheduledPostIdempotencyKey({
            draftId: created.id,
            platform,
            clipIds,
            scheduledFor: clipScheduledFor,
            automationMode,
            socialAccountId: account?.id ?? null,
          }),
        }));
      })),
    });

    return created;
  });

  return toPostingDraft(draft);
}

export function toPrismaPostingPlatform(platform: PostingPlatform): PrismaPostingPlatform {
  return PLATFORM_TO_DB[platform];
}

export function fromPrismaPostingPlatform(platform: PrismaPostingPlatform): PostingPlatform {
  return PLATFORM_FROM_DB[platform];
}
