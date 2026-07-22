import type {
  Prisma,
  PostingAutomationMode as PrismaPostingAutomationMode,
  PostingPlatform as PrismaPostingPlatform,
  ScheduledPostStatus as PrismaScheduledPostStatus,
  ScheduledPostWorkerStatus as PrismaScheduledPostWorkerStatus,
  SocialConnectorProvider,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  markScheduledPostContentAssetsPublished,
  reconcileScheduledPostContentAssetLifecycle,
} from "@/lib/contentAssets";
import {
  fromPrismaPostingPlatform,
  type PostingPlatform,
} from "@/lib/postingDrafts";

export type ScheduledPost = {
  id: string;
  postingDraftId: string | null;
  socialAccountId: string | null;
  socialAccountLabel: string | null;
  socialAccountExternalProvider: string | null;
  socialAccountExternalAccountId: string | null;
  socialAccountExternalPlatform: string | null;
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
  mediaObjectKey: string | null;
  mediaPublicUrl: string | null;
  mediaUploadedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
  contentAssets?: Array<{
    id: string;
    revisionId?: string | null;
    revisionApprovalState?: string | null;
    title: string;
    assetType: string;
    status: string;
    caption: string | null;
    bodyContent: string | null;
    callToAction: string | null;
    hashtags: unknown;
    files: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      filePath: string | null;
      objectKey: string | null;
      publicUrl: string | null;
      width: number | null;
      height: number | null;
      sizeBytes: string | null;
      sortOrder: number;
      metadata: unknown;
    }>;
  }>;
};

export type ManualPublishingStatus = "POSTED" | "SKIPPED";
export type RestorablePublishingStatus = "PLANNED" | "READY_FOR_MEDIA_TEAM" | "FAILED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";
export type ScheduledPostAction = "POST_NOW" | "RESTORE_PREVIOUS";

export class ScheduledPostMutationConflictError extends Error {
  constructor() {
    super("This post is already being sent to the platform. Wait for publishing to finish, then refresh its status.");
    this.name = "ScheduledPostMutationConflictError";
  }
}

const MANUAL_PUBLISHING_STATUSES: ManualPublishingStatus[] = ["POSTED", "SKIPPED"];
const RESTORABLE_PUBLISHING_STATUSES: RestorablePublishingStatus[] = [
  "PLANNED",
  "READY_FOR_MEDIA_TEAM",
  "FAILED",
  "PRIVATE_ONLY_UNVERIFIED",
  "SKIPPED",
];
const SCHEDULED_POST_ACTIONS: ScheduledPostAction[] = ["POST_NOW", "RESTORE_PREVIOUS"];
const STALE_POSTING_CLAIM_MS = 15 * 60_000;
const STALE_POSTING_RECOVERY_READ_INTERVAL_MS = 60_000;
let lastStalePostingRecoveryReadAt = 0;
let stalePostingRecoveryRead: Promise<number> | null = null;
const POSTING_PLATFORM_CREDENTIAL_PROVIDER: Partial<Record<PrismaPostingPlatform, SocialConnectorProvider>> = {
  FACEBOOK: "META_FACEBOOK",
  INSTAGRAM: "META_INSTAGRAM",
  TIKTOK: "TIKTOK",
  YOUTUBE_SHORTS: "YOUTUBE",
};

function isSocialAuthFailure(message: string | null | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return [
    "access token",
    "expired or revoked",
    "session has expired",
    "token has been expired",
    "invalid_grant",
    "invalid token",
    "needs reauth",
    "reauthorize",
    "reauthorise",
    "oauth",
  ].some((pattern) => normalized.includes(pattern));
}

async function markScheduledPostSocialAccountNeedsReview(input: {
  socialAccountId: string | null;
  platform: PrismaPostingPlatform;
  publishError: string | null | undefined;
}): Promise<void> {
  if (!input.socialAccountId || !isSocialAuthFailure(input.publishError)) {
    return;
  }

  const provider = POSTING_PLATFORM_CREDENTIAL_PROVIDER[input.platform];

  await prisma.$transaction([
    prisma.socialAccount.update({
      where: { id: input.socialAccountId },
      data: { status: "NEEDS_REVIEW" },
    }),
    ...(provider
      ? [
          prisma.socialCredential.updateMany({
            where: {
              socialAccountId: input.socialAccountId,
              provider,
            },
            data: {
              status: "NEEDS_REAUTH",
              lastError: input.publishError,
            },
          }),
        ]
      : []),
  ]).catch(() => undefined);
}

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
  mediaObjectKey: string | null;
  mediaPublicUrl: string | null;
  mediaUploadedAt: Date | null;
  idempotencyKey: string;
  createdAt: Date;
  socialAccount: {
    label: string;
    externalProvider: string | null;
    externalAccountId: string | null;
    externalPlatform: string | null;
  } | null;
  contentAssetLinks?: Array<{
    contentAssetRevision?: {
      id: string;
      approvalState: string;
      title: string;
      bodyContent: string | null;
      caption: string | null;
      hashtagsJson: unknown;
      callToAction: string | null;
    } | null;
    contentAsset: {
      id: string;
      title: string;
      assetType: string;
      status: string;
      caption: string | null;
      bodyContent: string | null;
      callToAction: string | null;
      hashtagsJson: unknown;
      files?: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        filePath: string | null;
        objectKey: string | null;
        publicUrl: string | null;
        width: number | null;
        height: number | null;
        sizeBytes: bigint | null;
        sortOrder: number;
        metadataJson: unknown;
      }>;
    };
  }>;
}): ScheduledPost {
  return {
    id: input.id,
    postingDraftId: input.postingDraftId,
    socialAccountId: input.socialAccountId,
    socialAccountLabel: input.socialAccount?.label ?? null,
    socialAccountExternalProvider: input.socialAccount?.externalProvider ?? null,
    socialAccountExternalAccountId: input.socialAccount?.externalAccountId ?? null,
    socialAccountExternalPlatform: input.socialAccount?.externalPlatform ?? null,
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
    mediaObjectKey: input.mediaObjectKey,
    mediaPublicUrl: input.mediaPublicUrl,
    mediaUploadedAt: input.mediaUploadedAt?.toISOString() ?? null,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt.toISOString(),
    contentAssets: (input.contentAssetLinks ?? []).map(({ contentAsset, contentAssetRevision }) => ({
      id: contentAsset.id,
      revisionId: contentAssetRevision?.id ?? null,
      revisionApprovalState: contentAssetRevision?.approvalState ?? null,
      title: contentAssetRevision?.title ?? contentAsset.title,
      assetType: contentAsset.assetType,
      status: contentAsset.status,
      caption: contentAssetRevision?.caption ?? contentAsset.caption,
      bodyContent: contentAssetRevision?.bodyContent ?? contentAsset.bodyContent,
      callToAction: contentAssetRevision?.callToAction ?? contentAsset.callToAction,
      hashtags: contentAssetRevision?.hashtagsJson ?? contentAsset.hashtagsJson,
      files: (contentAsset.files ?? []).map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        filePath: file.filePath,
        objectKey: file.objectKey,
        publicUrl: file.publicUrl,
        width: file.width,
        height: file.height,
        sizeBytes: file.sizeBytes?.toString() ?? null,
        sortOrder: file.sortOrder,
        metadata: file.metadataJson,
      })),
    })),
  };
}

async function recoverStaleScheduledPostClaimsForRead(): Promise<void> {
  const now = Date.now();
  if (stalePostingRecoveryRead) {
    await stalePostingRecoveryRead;
    return;
  }

  if (now - lastStalePostingRecoveryReadAt < STALE_POSTING_RECOVERY_READ_INTERVAL_MS) {
    return;
  }

  lastStalePostingRecoveryReadAt = now;
  stalePostingRecoveryRead = recoverStaleScheduledPostClaims(new Date(now))
    .finally(() => {
      stalePostingRecoveryRead = null;
    });

  await stalePostingRecoveryRead;
}

export type ListScheduledPostsOptions = {
  scheduledPostId?: string | null;
  contentAssetId?: string | null;
  take?: number;
  includeContentAssetFiles?: boolean;
};

function normalizeScheduledPostListTake(value: number | undefined, hasExactId: boolean): number {
  if (hasExactId) return 1;
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(100, Math.trunc(value ?? 100)));
}

export async function listScheduledPosts(
  options: ListScheduledPostsOptions = {},
): Promise<ScheduledPost[]> {
  // Worker-facing queue reads still recover every time. Pastor-facing list
  // reads only need to run the 15-minute stale-claim repair once per minute.
  await recoverStaleScheduledPostClaimsForRead();
  const scheduledPostId = options.scheduledPostId?.trim() || null;
  const contentAssetId = options.contentAssetId?.trim() || null;
  const posts = await prisma.scheduledPost.findMany({
    where: {
      ...(scheduledPostId ? { id: scheduledPostId } : {}),
      ...(contentAssetId
        ? { contentAssetLinks: { some: { contentAssetId } } }
        : {}),
    },
    include: {
      socialAccount: {
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
      },
      contentAssetLinks: {
        orderBy: { sortOrder: "asc" },
        select: {
          contentAsset: {
            select: {
              id: true,
              title: true,
              assetType: true,
              status: true,
              caption: true,
              bodyContent: true,
              callToAction: true,
              hashtagsJson: true,
              ...(options.includeContentAssetFiles === false
                ? {}
                : {
                    files: {
                      orderBy: { sortOrder: "asc" as const },
                      select: {
                        id: true,
                        fileName: true,
                        mimeType: true,
                        filePath: true,
                        objectKey: true,
                        publicUrl: true,
                        width: true,
                        height: true,
                        sizeBytes: true,
                        sortOrder: true,
                        metadataJson: true,
                      },
                    },
                  }),
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: normalizeScheduledPostListTake(options.take, Boolean(scheduledPostId)),
  });

  return posts.map(toScheduledPost);
}

export async function recoverStaleScheduledPostClaims(now = new Date()): Promise<number> {
  const recovered = await prisma.scheduledPost.updateMany({
    where: {
      status: "POSTING",
      claimedAt: { lt: new Date(now.getTime() - STALE_POSTING_CLAIM_MS) },
    },
    data: {
      status: "PRIVATE_ONLY_UNVERIFIED",
      workerStatus: "FAILED",
      claimedAt: null,
      workerId: null,
      publishError: "Publishing confirmation was interrupted. Check the platform before retrying this post.",
    },
  });

  return recovered.count;
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

export function normalizeRestorablePublishingStatus(value: unknown): RestorablePublishingStatus | null {
  return typeof value === "string" && RESTORABLE_PUBLISHING_STATUSES.includes(value as RestorablePublishingStatus)
    ? value as RestorablePublishingStatus
    : null;
}

function workerStatusForEditableStatus(status: ManualPublishingStatus | RestorablePublishingStatus): PrismaScheduledPostWorkerStatus {
  if (status === "FAILED") return "FAILED";
  if (status === "READY_FOR_MEDIA_TEAM" || status === "PLANNED") return "IDLE";
  return "SUCCEEDED";
}

export function isScheduledPostMutationLocked(input: {
  status: PrismaScheduledPostStatus;
  claimedAt: Date | null;
  workerStatus: PrismaScheduledPostWorkerStatus;
}): boolean {
  return input.status === "POSTING"
    || Boolean(input.claimedAt)
    || input.workerStatus === "CLAIMED"
    || input.workerStatus === "POSTING";
}

export function isScheduledPostReschedulable(input: {
  status: PrismaScheduledPostStatus;
  externalPostId: string | null;
  publishedUrl: string | null;
  finalPrivacyStatus: string | null;
}): boolean {
  return (input.status === "PLANNED" || input.status === "READY_FOR_MEDIA_TEAM" || input.status === "FAILED")
    && !input.externalPostId
    && !input.publishedUrl
    && !input.finalPrivacyStatus;
}

async function mutationAppliedOrThrowConflict(id: string, count: number): Promise<boolean> {
  if (count > 0) {
    return true;
  }

  const existing = await prisma.scheduledPost.findUnique({
    where: { id },
    select: { status: true, claimedAt: true, workerStatus: true },
  });
  if (existing && isScheduledPostMutationLocked(existing)) {
    throw new ScheduledPostMutationConflictError();
  }

  return false;
}

export async function updateScheduledPostStatus(input: {
  id: string;
  status: ManualPublishingStatus;
}): Promise<ScheduledPost | null> {
  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: input.status === "SKIPPED"
        ? { notIn: ["POSTING", "POSTED"] }
        : { not: "POSTING" },
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
    },
    data: {
      status: input.status,
      workerStatus: workerStatusForEditableStatus(input.status),
      claimedAt: null,
    },
  });
  if (!(await mutationAppliedOrThrowConflict(input.id, updateResult.count))) {
    return null;
  }
  if (input.status === "POSTED") {
    await markScheduledPostContentAssetsPublished({ scheduledPostId: input.id });
  } else {
    await reconcileScheduledPostContentAssetLifecycle({ scheduledPostId: input.id });
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
      },
      contentAssetLinks: {
        orderBy: { sortOrder: "asc" },
        select: {
          contentAsset: {
            select: {
              id: true,
              title: true,
              assetType: true,
              status: true,
              caption: true,
              bodyContent: true,
              callToAction: true,
              hashtagsJson: true,
              files: {
                orderBy: { sortOrder: "asc" },
                select: {
                  id: true,
                  fileName: true,
                  mimeType: true,
                  filePath: true,
                  objectKey: true,
                  publicUrl: true,
                  width: true,
                  height: true,
                  sizeBytes: true,
                  sortOrder: true,
                  metadataJson: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return post ? toScheduledPost(post) : null;
}

export async function restoreScheduledPostStatus(input: {
  id: string;
  status: RestorablePublishingStatus;
  expectedCurrentStatus: "POSTED" | "SKIPPED";
}): Promise<ScheduledPost | null> {
  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: input.expectedCurrentStatus,
      attemptCount: 0,
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
      ...(input.status === "PLANNED"
        ? {
            automationMode: "AUTOMATIC" as const,
            contentAssetLinks: approvedContentAssetLinkFilter,
          }
        : {}),
    },
    data: {
      status: input.status,
      workerStatus: workerStatusForEditableStatus(input.status),
      claimedAt: null,
      ...(input.status === "PLANNED" || input.status === "READY_FOR_MEDIA_TEAM"
        ? { workerId: null, publishError: null }
        : {}),
    },
  });
  if (updateResult.count === 0) {
    return null;
  }

  await reconcileScheduledPostContentAssetLifecycle({ scheduledPostId: input.id });

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
      },
    },
  });

  return post ? toScheduledPost(post) : null;
}

export async function updateScheduledPostSchedule(input: {
  id: string;
  scheduledFor: Date;
  timezone?: string | null;
}): Promise<ScheduledPost | null> {
  const existing = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    select: { id: true, automationMode: true },
  });

  if (!existing) {
    return null;
  }

  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "FAILED"] },
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
      ...(existing.automationMode === "AUTOMATIC"
        ? { contentAssetLinks: approvedContentAssetLinkFilter }
        : {}),
    },
    data: {
      scheduledFor: input.scheduledFor,
      postingSlot: new Intl.DateTimeFormat("en", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(input.scheduledFor),
      timezone: input.timezone?.trim() || undefined,
      workerStatus: "IDLE",
      claimedAt: null,
      workerId: null,
      publishError: null,
      ...(existing.automationMode === "AUTOMATIC" && input.scheduledFor.getTime() > Date.now()
        ? { status: "PLANNED" as const }
        : {}),
    },
  });
  if (!(await mutationAppliedOrThrowConflict(input.id, updateResult.count))) {
    return null;
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
      },
    },
  });

  return post ? toScheduledPost(post) : null;
}

export async function deleteScheduledPost(input: {
  id: string;
}): Promise<boolean> {
  const contentAssetLinks = await prisma.scheduledPostContentAsset.findMany({
    where: { scheduledPostId: input.id },
    select: { contentAssetId: true },
  });
  const deleted = await prisma.scheduledPost.deleteMany({
    where: {
      id: input.id,
      status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "FAILED", "SKIPPED"] },
      attemptCount: 0,
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
    },
  });

  const applied = await mutationAppliedOrThrowConflict(input.id, deleted.count);
  if (applied && contentAssetLinks.length > 0) {
    await reconcileScheduledPostContentAssetLifecycle({
      contentAssetIds: contentAssetLinks.map((link) => link.contentAssetId),
    });
  }
  return applied;
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
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
      contentAssetLinks: approvedContentAssetLinkFilter,
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
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
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
    durationSeconds: number;
    hashtags: unknown;
    localFileCandidates: string[];
    sermon: {
      id: string;
      title: string;
      churchName: string;
    };
  }>;
};

const ACTIVE_AUTOMATION_STATUSES: PrismaScheduledPostStatus[] = ["PLANNED"];
const approvedContentAssetLinkFilter = {
  every: {
    contentAssetRevision: {
      is: { approvalState: "APPROVED" as const },
    },
  },
};

const automationScheduledPostInclude = {
  socialAccount: {
    select: {
      label: true,
      externalProvider: true,
      externalAccountId: true,
      externalPlatform: true,
    },
  },
  contentAssetLinks: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      contentAssetRevision: {
        select: {
          id: true,
          approvalState: true,
          title: true,
          bodyContent: true,
          caption: true,
          hashtagsJson: true,
          callToAction: true,
        },
      },
      contentAsset: {
        select: {
          id: true,
          title: true,
          assetType: true,
          status: true,
          caption: true,
          bodyContent: true,
          callToAction: true,
          hashtagsJson: true,
          files: {
            orderBy: { sortOrder: "asc" as const },
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              filePath: true,
              objectKey: true,
              publicUrl: true,
              width: true,
              height: true,
              sizeBytes: true,
              sortOrder: true,
              metadataJson: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ScheduledPostInclude;

type AutomationScheduledPostRecord = Prisma.ScheduledPostGetPayload<{
  include: typeof automationScheduledPostInclude;
}>;

async function buildReadyAutomationPosts(
  posts: AutomationScheduledPostRecord[],
): Promise<AutomationUpcomingPost[]> {
  const clipIds = Array.from(new Set(posts.flatMap((post) => normalizeClipIds(post.clipIdsJson))));
  const clips = await prisma.clipCandidate.findMany({
    where: { id: { in: clipIds } },
    select: {
      id: true,
      title: true,
      caption: true,
      durationSeconds: true,
      hashtags: true,
      exportStatus: true,
      exportFreshness: true,
      exportFormat: true,
      exportedFilePath: true,
      exportPath: true,
      transcriptSafetyStatus: true,
      sermon: {
        select: {
          id: true,
          title: true,
          churchName: true,
        },
      },
    },
  });
  const readyClipEntries = clips.map((clip) => {
    if (clip.transcriptSafetyStatus === "REVIEW_REQUIRED") {
      return null;
    }

    const outputPath = clip.exportStatus === "COMPLETED"
      && clip.exportFreshness === "UP_TO_DATE"
      && clip.exportFormat === "VERTICAL_9_16"
      ? clip.exportedFilePath?.trim() || clip.exportPath?.trim() || null
      : null;
    if (!outputPath) {
      return null;
    }

    const readyClip: AutomationUpcomingPost["clips"][number] = {
      id: clip.id,
      title: clip.title,
      caption: clip.caption,
      durationSeconds: clip.durationSeconds,
      hashtags: clip.hashtags,
      // The posting worker must receive one canonical final export. Supplying
      // overlay, caption-burn, or raw-render fallbacks can publish an older or
      // partially composed artifact after a Studio edit.
      localFileCandidates: [outputPath],
      sermon: clip.sermon,
    };

    return [clip.id, readyClip] as const;
  });
  const readyClipsById = new Map(readyClipEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));

  return posts.flatMap((post) => {
    const scheduledPost = toScheduledPost(post);
    const readyClips = scheduledPost.clipIds.flatMap((clipId) => {
      const clip = readyClipsById.get(clipId);
      return clip ? [clip] : [];
    });

    // A post that references any missing, stale, review-blocked, or otherwise
    // unready clip stays planned but is withheld from the automation worker.
    if (readyClips.length !== scheduledPost.clipIds.length) {
      return [];
    }

    return [{
      ...scheduledPost,
      clips: readyClips,
    }];
  });
}

export async function listUpcomingAutomationPosts(input: {
  now?: Date;
  windowMinutes?: number;
} = {}): Promise<AutomationUpcomingPost[]> {
  const now = input.now ?? new Date();
  const windowMinutes = input.windowMinutes ?? 60 * 24 * 7;
  const windowEnd = new Date(now.getTime() + windowMinutes * 60_000);

  await recoverStaleScheduledPostClaims(now);

  const posts = await prisma.scheduledPost.findMany({
    where: {
      automationMode: "AUTOMATIC",
      scheduledFor: {
        not: null,
        lte: windowEnd,
      },
      status: { in: ACTIVE_AUTOMATION_STATUSES },
      contentAssetLinks: approvedContentAssetLinkFilter,
    },
    include: automationScheduledPostInclude,
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });

  return buildReadyAutomationPosts(posts);
}

export async function claimScheduledPost(input: {
  id: string;
  workerId: string;
  now?: Date;
}): Promise<AutomationUpcomingPost | null> {
  const now = input.now ?? new Date();
  const claimResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      automationMode: "AUTOMATIC",
      scheduledFor: { lte: now },
      status: { in: ACTIVE_AUTOMATION_STATUSES },
      contentAssetLinks: approvedContentAssetLinkFilter,
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
      // Staged video metadata is not tied to a clip composition revision yet.
      // Clear it so the worker stages the exact export returned by this claim.
      mediaObjectKey: null,
      mediaPublicUrl: null,
      mediaUploadedAt: null,
    },
  });

  if (claimResult.count === 0) {
    return null;
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: automationScheduledPostInclude,
  });
  const readyPost = post ? (await buildReadyAutomationPosts([post]))[0] ?? null : null;
  if (readyPost) {
    return readyPost;
  }

  // A clip can be edited or invalidated between the worker's queue sync and
  // this claim. Release the claim without publishing the cached artifact.
  await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: "POSTING",
      workerStatus: "CLAIMED",
      workerId: input.workerId,
      claimedAt: now,
    },
    data: {
      status: "PLANNED",
      workerStatus: "IDLE",
      claimedAt: null,
      workerId: null,
      publishError: "Publishing paused because the clip's final export is missing, stale, or still needs review.",
    },
  });

  return null;
}

export async function renewScheduledPostClaim(input: {
  id: string;
  workerId: string;
  now?: Date;
}): Promise<boolean> {
  const renewed = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: "POSTING",
      workerId: input.workerId,
      claimedAt: { not: null },
    },
    data: {
      workerStatus: "POSTING",
      claimedAt: input.now ?? new Date(),
    },
  });

  return renewed.count > 0;
}

export type CompleteScheduledPostStatus = "POSTED" | "FAILED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";

export function normalizeCompleteScheduledPostStatus(value: unknown): CompleteScheduledPostStatus | null {
  return value === "POSTED" || value === "FAILED" || value === "PRIVATE_ONLY_UNVERIFIED" || value === "SKIPPED"
    ? value
    : null;
}

export function normalizeWorkerCompletionReceipt(input: {
  status: CompleteScheduledPostStatus;
  externalPostId?: string | null;
  publishedUrl?: string | null;
  publishError?: string | null;
  finalPrivacyStatus?: string | null;
}): { status: CompleteScheduledPostStatus; publishError: string | null } {
  const finalState = input.finalPrivacyStatus?.trim().toLowerCase() ?? "";
  const unverifiedFinalStates = new Set([
    "accepted",
    "pending",
    "processing",
    "private",
    "scheduled",
    "self_only",
    "unknown",
    "unpublished",
  ]);
  const hasPublicationEvidence = Boolean(input.externalPostId?.trim() || input.publishedUrl?.trim());
  const shouldRequireVerification = input.status === "POSTED"
    && (!hasPublicationEvidence || unverifiedFinalStates.has(finalState));

  return {
    status: shouldRequireVerification ? "PRIVATE_ONLY_UNVERIFIED" : input.status,
    publishError: shouldRequireVerification
      ? input.publishError?.trim() || "The platform received this upload, but public availability was not confirmed. Check the platform before retrying it."
      : input.publishError?.trim() || null,
  };
}

export async function completeScheduledPost(input: {
  id: string;
  workerId: string;
  status: CompleteScheduledPostStatus;
  externalPostId?: string | null;
  publishedUrl?: string | null;
  publishError?: string | null;
  finalPrivacyStatus?: string | null;
  mediaObjectKey?: string | null;
  mediaPublicUrl?: string | null;
  mediaUploadedAt?: Date | null;
}): Promise<ScheduledPost | null> {
  const completion = normalizeWorkerCompletionReceipt(input);
  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: "POSTING",
      claimedAt: { not: null },
      workerId: input.workerId,
    },
    data: {
      status: completion.status,
      workerStatus: completion.status === "FAILED" ? "FAILED" : "SUCCEEDED",
      workerId: input.workerId,
      claimedAt: null,
      externalPostId: input.externalPostId || null,
      publishedUrl: input.publishedUrl || null,
      publishError: completion.publishError,
      finalPrivacyStatus: input.finalPrivacyStatus || null,
      mediaObjectKey: input.mediaObjectKey || undefined,
      mediaPublicUrl: input.mediaPublicUrl || undefined,
      mediaUploadedAt: input.mediaUploadedAt || undefined,
    },
  });
  if (updateResult.count === 0) {
    const alreadyCompleted = await prisma.scheduledPost.findUnique({
      where: { id: input.id },
      include: {
        socialAccount: {
          select: {
            label: true,
            externalProvider: true,
            externalAccountId: true,
            externalPlatform: true,
          },
        },
      },
    });
    if (
      alreadyCompleted
      && alreadyCompleted.status === completion.status
      && alreadyCompleted.workerId === input.workerId
      && (input.externalPostId == null || alreadyCompleted.externalPostId === input.externalPostId)
    ) {
      if (completion.status === "POSTED") {
        await markScheduledPostContentAssetsPublished({ scheduledPostId: input.id });
      } else if (completion.status === "SKIPPED") {
        await reconcileScheduledPostContentAssetLifecycle({ scheduledPostId: input.id });
      }
      return toScheduledPost(alreadyCompleted);
    }
    return null;
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: {
      socialAccount: {
        select: {
          label: true,
          externalProvider: true,
          externalAccountId: true,
          externalPlatform: true,
        },
      },
    },
  }).catch(() => null);

  if (post && completion.status === "FAILED") {
    await markScheduledPostSocialAccountNeedsReview({
      socialAccountId: post.socialAccountId,
      platform: post.platform,
      publishError: completion.publishError,
    });
  }
  if (post && completion.status === "POSTED") {
    await markScheduledPostContentAssetsPublished({ scheduledPostId: input.id });
  } else if (post && completion.status === "SKIPPED") {
    await reconcileScheduledPostContentAssetLifecycle({ scheduledPostId: input.id });
  }

  return post ? toScheduledPost(post) : null;
}

export const __scheduledPostsTestUtils = {
  isSocialAuthFailure,
  ACTIVE_AUTOMATION_STATUSES,
  STALE_POSTING_CLAIM_MS,
};
