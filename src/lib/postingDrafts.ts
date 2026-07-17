import crypto from "node:crypto";

import type {
  PostingDraftStatus as PrismaPostingDraftStatus,
  PostingPlatform as PrismaPostingPlatform,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  buildClipSchedulePlan,
  isValidIanaTimeZone,
  normalizeScheduleIntervalMinutes,
  resolveScheduledInstant,
} from "@/lib/postingSchedule";

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

export function normalizeScheduledFor(value: unknown, timezone = "Africa/Johannesburg"): Date | null {
  return resolveScheduledInstant(value, timezone);
}

export function normalizeTimezone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Africa/Johannesburg";
  }

  return value.trim().slice(0, 80);
}

function buildPostingSlot(scheduledFor: Date | null, fallback: string, timezone: string): string {
  if (!scheduledFor) {
    return fallback.trim() || "This week";
  }

  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
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

export function normalizePostingDraftIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function postingDraftRequestPrefix(value: string): string {
  const digest = crypto.createHash("sha256").update(value).digest("hex");
  return `posting-draft-request:${digest}:`;
}

function postingDraftRequestKey(value: string, payloadFingerprint: string, sequence = 0): string {
  return `${postingDraftRequestPrefix(value)}${payloadFingerprint}${sequence > 0 ? `:${sequence}` : ""}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const postingDraftSelect = {
  id: true,
  clipIdsJson: true,
  platformsJson: true,
  postingSlot: true,
  note: true,
  status: true,
  createdAt: true,
} as const;

async function findPostingDraftByRequestKey(
  requestKey: string,
  payloadFingerprint: string,
): Promise<PostingDraft | null> {
  const scheduledPost = await prisma.scheduledPost.findFirst({
    where: { idempotencyKey: { startsWith: postingDraftRequestPrefix(requestKey) } },
    orderBy: { idempotencyKey: "asc" },
    select: { idempotencyKey: true, postingDraft: { select: postingDraftSelect } },
  });
  if (!scheduledPost) return null;
  if (scheduledPost.idempotencyKey !== postingDraftRequestKey(requestKey, payloadFingerprint)) {
    throw new PostingDraftValidationError(
      "This scheduling request key was already used with different post details. Start a new scheduling request.",
    );
  }
  if (!scheduledPost.postingDraft) {
    throw new PostingDraftValidationError(
      "This scheduling request was already completed, but its draft is no longer available.",
    );
  }
  return toPostingDraft(scheduledPost.postingDraft);
}

function isRetryableIdempotencyRace(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error.code === "P2002" || error.code === "P2034"),
  );
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
  idempotencyKey?: string | null;
}): Promise<PostingDraft> {
  const automationMode = input.automationMode ?? "MANUAL";
  const scheduledFor = input.scheduledFor ?? null;
  const scheduleIntervalMinutes = normalizeScheduleIntervalMinutes(input.scheduleIntervalMinutes, input.clipIds.length);
  const clipSchedulePlan = buildClipSchedulePlan(input.clipIds, scheduledFor, scheduleIntervalMinutes);
  const timezone = input.timezone?.trim() || "Africa/Johannesburg";
  if (!isValidIanaTimeZone(timezone)) {
    throw new PostingDraftValidationError("Choose a valid IANA timezone, such as Africa/Johannesburg.");
  }
  const postingSlot = buildPostingSlot(scheduledFor, input.postingSlot, timezone);
  const caption = input.caption?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const note = input.note?.trim() ?? "";
  const clipCopyById = input.clipCopyById ?? {};
  const platformCopyByClipId = input.platformCopyByClipId ?? {};
  const requestKey = normalizePostingDraftIdempotencyKey(input.idempotencyKey);
  const payloadFingerprint = crypto.createHash("sha256").update(stableJson({
    automationMode,
    caption,
    clipCopyById,
    clipIds: input.clipIds,
    note,
    platformCopyByClipId,
    platforms: input.platforms,
    postingSlot,
    scheduleIntervalMinutes,
    scheduledFor: scheduledFor?.toISOString() ?? null,
    socialAccountIdsByPlatform: Object.fromEntries(input.platforms.map((platform) => [
      platform,
      [...(input.socialAccountIdsByPlatform?.[platform] ?? [])].sort(),
    ])),
    timezone,
    title,
  })).digest("hex");

  if (requestKey) {
    const existingDraft = await findPostingDraftByRequestKey(requestKey, payloadFingerprint);
    if (existingDraft) return existingDraft;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (requestKey) {
        const existingScheduledPost = await tx.scheduledPost.findFirst({
          where: { idempotencyKey: { startsWith: postingDraftRequestPrefix(requestKey) } },
          orderBy: { idempotencyKey: "asc" },
          select: { idempotencyKey: true, postingDraft: { select: postingDraftSelect } },
        });
        if (existingScheduledPost) {
          if (existingScheduledPost.idempotencyKey !== postingDraftRequestKey(requestKey, payloadFingerprint)) {
            throw new PostingDraftValidationError(
              "This scheduling request key was already used with different post details. Start a new scheduling request.",
            );
          }
          if (!existingScheduledPost.postingDraft) {
            throw new PostingDraftValidationError(
              "This scheduling request was already completed, but its draft is no longer available.",
            );
          }
          return { existing: toPostingDraft(existingScheduledPost.postingDraft) } as const;
        }
      }

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

    const scheduledPosts = clipSchedulePlan.flatMap((clipSchedule) => input.platforms.flatMap((platform) => {
        const dbPlatform = PLATFORM_TO_DB[platform];
        const selectedAccountIds = new Set(input.socialAccountIdsByPlatform?.[platform] ?? []);
        const platformAccounts = accounts.filter((item) => item.platform === dbPlatform);
        const selectedAccounts = platformAccounts.filter((item) => selectedAccountIds.has(item.id));
        if (selectedAccountIds.size > 0 && selectedAccounts.length !== selectedAccountIds.size) {
          throw new PostingDraftValidationError(`Choose a connected ${platform} account before scheduling.`);
        }

        if (automationMode === "AUTOMATIC" && selectedAccountIds.size === 0 && platformAccounts.length > 1) {
          throw new PostingDraftValidationError(
            `Choose the exact ${platform} account for this automatic draft. Multiple connected accounts are available.`,
          );
        }

        const targetAccounts = selectedAccounts.length > 0
          ? selectedAccounts
          : automationMode === "AUTOMATIC"
            ? [platformAccounts[0]]
            : [undefined];
        const status: "PLANNED" | "READY_FOR_MEDIA_TEAM" = automationMode === "AUTOMATIC"
          ? "PLANNED"
          : "READY_FOR_MEDIA_TEAM";
        const clipScheduledFor = clipSchedule.scheduledFor;
        const clipPostingSlot = buildPostingSlot(clipScheduledFor, input.postingSlot, timezone);
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
          idempotencyKeyInput: {
            draftId: created.id,
            platform,
            clipIds,
            scheduledFor: clipScheduledFor,
            automationMode,
            socialAccountId: account?.id ?? null,
          },
        }));
      }));

    await tx.scheduledPost.createMany({
      data: scheduledPosts.map(({ idempotencyKeyInput, ...post }, index) => ({
        ...post,
        idempotencyKey: requestKey
          ? postingDraftRequestKey(requestKey, payloadFingerprint, index)
          : buildScheduledPostIdempotencyKey(idempotencyKeyInput),
      })),
    });

      return { created } as const;
    }, { isolationLevel: "Serializable" });

    if ("existing" in result && result.existing) return result.existing;
    return toPostingDraft(result.created);
  } catch (error) {
    if (requestKey && isRetryableIdempotencyRace(error)) {
      const existingDraft = await findPostingDraftByRequestKey(requestKey, payloadFingerprint);
      if (existingDraft) return existingDraft;
    }
    throw error;
  }
}

export function toPrismaPostingPlatform(platform: PostingPlatform): PrismaPostingPlatform {
  return PLATFORM_TO_DB[platform];
}

export function fromPrismaPostingPlatform(platform: PrismaPostingPlatform): PostingPlatform {
  return PLATFORM_FROM_DB[platform];
}
