import {
  Prisma,
  type PostingAutomationMode as PrismaPostingAutomationMode,
  type PostingPlatform as PrismaPostingPlatform,
  type ScheduledPostStatus as PrismaScheduledPostStatus,
  type ScheduledPostWorkerStatus as PrismaScheduledPostWorkerStatus,
  type SocialConnectorProvider,
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
import {
  assessDuplicatePublicationGuard,
  buildDuplicatePublicationGuardInputs,
  sealApprovedPreview,
  verifyScheduledPayloadIdentity,
  type ApprovedPreviewReceipt,
  type DuplicatePublicationGuardInputs,
  type DuplicatePublicationRecord,
} from "@/server/publishing/publicationIntegrity";

export type ClipPostingCompositionIdentity = {
  schemaVersion: 1;
  clipId: string;
  editPlanId: string;
  artifactId: string;
  planHash: string;
  filePath: string;
  sizeBytes: number | null;
  snapshotSha256: string | null;
  snapshotSizeBytes: number | null;
};

export type ScheduledPostPublicationGuard = Pick<
  DuplicatePublicationGuardInputs,
  | "approvedPreviewIdentity"
  | "retryIdempotencyKey"
  | "semanticDuplicateKey"
  | "destinationPayloadKey"
>;

type StoredPublicationIntegrity = {
  schemaVersion: 1;
  approvedPreview: ApprovedPreviewReceipt;
  guard: DuplicatePublicationGuardInputs;
};

type StoredCompositionReceipt = {
  schemaVersion: 2;
  compositionIdentities: ClipPostingCompositionIdentity[];
  publicationIntegrity: StoredPublicationIntegrity;
};

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
  compositionReceipt?: ClipPostingCompositionIdentity[] | null;
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

export class ClipCompositionPublishingConflictError extends Error {
  constructor() {
    super("This clip is being published right now. Wait for the platform receipt before saving a new Studio composition.");
    this.name = "ClipCompositionPublishingConflictError";
  }
}

export class ScheduledPostPublicationIntegrityError extends Error {
  constructor() {
    super("Publishing could not be confirmed because the approved preview no longer matches this claimed post.");
    this.name = "ScheduledPostPublicationIntegrityError";
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

export async function assertClipCompositionNotActivelyPublishing(clipId: string): Promise<void> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    throw new Error("Clip id is required before checking the publishing lock.");
  }

  const activePost = await prisma.scheduledPost.findFirst({
    where: {
      status: "POSTING",
      workerStatus: { in: ["CLAIMED", "POSTING"] },
      claimedAt: { not: null },
      clipIdsJson: {
        array_contains: [normalizedClipId],
      },
    },
    select: { id: true },
  });
  if (activePost) {
    throw new ClipCompositionPublishingConflictError();
  }
}

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

function normalizeClipPostingCompositionIdentity(value: unknown): ClipPostingCompositionIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sizeBytes = record["sizeBytes"];
  const snapshotSha256 = record["snapshotSha256"];
  const snapshotSizeBytes = record["snapshotSizeBytes"];
  if (
    record["schemaVersion"] !== 1
    || typeof record["clipId"] !== "string"
    || typeof record["editPlanId"] !== "string"
    || typeof record["artifactId"] !== "string"
    || typeof record["planHash"] !== "string"
    || typeof record["filePath"] !== "string"
    || ![record["clipId"], record["editPlanId"], record["artifactId"], record["planHash"], record["filePath"]]
      .every((item) => typeof item === "string" && item.trim().length > 0)
    || !(
      sizeBytes === null
      || (
        typeof sizeBytes === "number"
        && Number.isSafeInteger(sizeBytes)
        && sizeBytes > 0
      )
    )
    || !(
      snapshotSha256 === null
      || (
        typeof snapshotSha256 === "string"
        && /^[a-f0-9]{64}$/.test(snapshotSha256)
      )
    )
    || !(
      snapshotSizeBytes === null
      || (
        typeof snapshotSizeBytes === "number"
        && Number.isSafeInteger(snapshotSizeBytes)
        && snapshotSizeBytes > 0
      )
    )
    || ((snapshotSha256 === null) !== (snapshotSizeBytes === null))
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    clipId: record["clipId"].trim(),
    editPlanId: record["editPlanId"].trim(),
    artifactId: record["artifactId"].trim(),
    planHash: record["planHash"].trim(),
    filePath: record["filePath"].trim(),
    sizeBytes,
    snapshotSha256,
    snapshotSizeBytes,
  };
}

export function normalizeClipPostingCompositionIdentities(
  value: unknown,
): ClipPostingCompositionIdentity[] | null {
  const source = (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>)["schemaVersion"] === 2
  )
    ? (value as Record<string, unknown>)["compositionIdentities"]
    : value;
  if (!Array.isArray(source)) {
    return null;
  }

  const identities = source.map(normalizeClipPostingCompositionIdentity);
  return identities.every((identity): identity is ClipPostingCompositionIdentity => identity !== null)
    ? identities
    : null;
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
  compositionReceiptJson?: unknown;
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
    compositionReceipt: normalizeClipPostingCompositionIdentities(input.compositionReceiptJson),
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
  organizationId?: string | null;
  campusId?: string | null;
  take?: number;
  includeContentAssetFiles?: boolean;
};

export type ScheduledPostTenantScope = Readonly<{
  organizationId: string;
  campusId?: string | null;
}>;

function scheduledPostTenantWhere(scope: ScheduledPostTenantScope) {
  return {
    organizationId: scope.organizationId,
    ...(scope.campusId
      ? { OR: [{ campusId: scope.campusId }, { campusId: null }] }
      : {}),
  };
}

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
      ...(options.organizationId
        ? {
            organizationId: options.organizationId,
            ...(options.campusId
              ? { OR: [{ campusId: options.campusId }, { campusId: null }] }
              : {}),
          }
        : {}),
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

async function mutationAppliedOrThrowConflict(
  id: string,
  count: number,
  tenantScope: ScheduledPostTenantScope,
): Promise<boolean> {
  if (count > 0) {
    return true;
  }

  const existing = await prisma.scheduledPost.findFirst({
    where: {
      id,
      ...scheduledPostTenantWhere(tenantScope),
    },
    select: { status: true, claimedAt: true, workerStatus: true },
  });
  if (existing && isScheduledPostMutationLocked(existing)) {
    throw new ScheduledPostMutationConflictError();
  }

  return false;
}

export async function updateScheduledPostStatus(input: {
  tenantScope: ScheduledPostTenantScope;
  id: string;
  status: ManualPublishingStatus;
}): Promise<ScheduledPost | null> {
  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
  if (!(await mutationAppliedOrThrowConflict(
    input.id,
    updateResult.count,
    input.tenantScope,
  ))) {
    return null;
  }
  if (input.status === "POSTED") {
    await markScheduledPostContentAssetsPublished({
      tenantScope: input.tenantScope,
      scheduledPostId: input.id,
    });
  } else {
    await reconcileScheduledPostContentAssetLifecycle({
      tenantScope: input.tenantScope,
      scheduledPostId: input.id,
    });
  }

  const post = await prisma.scheduledPost.findFirst({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
  tenantScope: ScheduledPostTenantScope;
  id: string;
  status: RestorablePublishingStatus;
  expectedCurrentStatus: "POSTED" | "SKIPPED";
}): Promise<ScheduledPost | null> {
  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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

  await reconcileScheduledPostContentAssetLifecycle({
    tenantScope: input.tenantScope,
    scheduledPostId: input.id,
  });

  const post = await prisma.scheduledPost.findFirst({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
    },
  });

  return post ? toScheduledPost(post) : null;
}

export async function updateScheduledPostSchedule(input: {
  tenantScope: ScheduledPostTenantScope;
  id: string;
  scheduledFor: Date;
  timezone?: string | null;
}): Promise<ScheduledPost | null> {
  const existing = await prisma.scheduledPost.findFirst({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
    },
    select: { id: true, automationMode: true },
  });

  if (!existing) {
    return null;
  }

  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
  if (!(await mutationAppliedOrThrowConflict(
    input.id,
    updateResult.count,
    input.tenantScope,
  ))) {
    return null;
  }

  const post = await prisma.scheduledPost.findFirst({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
    },
  });

  return post ? toScheduledPost(post) : null;
}

export async function deleteScheduledPost(input: {
  tenantScope: ScheduledPostTenantScope;
  id: string;
}): Promise<boolean> {
  const contentAssetLinks = await prisma.scheduledPostContentAsset.findMany({
    where: {
      scheduledPostId: input.id,
      scheduledPost: scheduledPostTenantWhere(input.tenantScope),
    },
    select: { contentAssetId: true },
  });
  const deleted = await prisma.scheduledPost.deleteMany({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
      status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "FAILED", "SKIPPED"] },
      attemptCount: 0,
      claimedAt: null,
      workerStatus: { notIn: ["CLAIMED", "POSTING"] },
      externalPostId: null,
      publishedUrl: null,
      finalPrivacyStatus: null,
    },
  });

  const applied = await mutationAppliedOrThrowConflict(
    input.id,
    deleted.count,
    input.tenantScope,
  );
  if (applied && contentAssetLinks.length > 0) {
    await reconcileScheduledPostContentAssetLifecycle({
      tenantScope: input.tenantScope,
      contentAssetIds: contentAssetLinks.map((link) => link.contentAssetId),
    });
  }
  return applied;
}

export async function postScheduledPostNow(input: {
  tenantScope: ScheduledPostTenantScope;
  id: string;
  now?: Date;
}): Promise<ScheduledPost | null> {
  const now = input.now ?? new Date();

  const updateResult = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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

  const post = await prisma.scheduledPost.findFirst({
    where: {
      id: input.id,
      ...scheduledPostTenantWhere(input.tenantScope),
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
    approvedAt: string;
    approvalActorRef: string;
    localFileCandidates: string[];
    compositionIdentity: ClipPostingCompositionIdentity;
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
      status: true,
      updatedAt: true,
      exportStatus: true,
      exportFreshness: true,
      exportFormat: true,
      exportedFilePath: true,
      exportPath: true,
      transcriptSafetyStatus: true,
      editPlans: {
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        take: 2,
        select: {
          id: true,
          planHash: true,
        },
      },
      artifacts: {
        where: {
          kind: "EXPORT",
          status: "READY",
          freshness: "UP_TO_DATE",
          format: "VERTICAL_9_16",
          editPlan: {
            is: { status: "ACTIVE" },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          editPlanId: true,
          planHash: true,
          filePath: true,
          sizeBytes: true,
        },
      },
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
    if (
      clip.transcriptSafetyStatus === "REVIEW_REQUIRED"
      || (clip.status !== "APPROVED" && clip.status !== "EXPORTED")
    ) {
      return null;
    }

    const canonicalOutputPath = clip.exportStatus === "COMPLETED"
      && clip.exportFreshness === "UP_TO_DATE"
      && clip.exportFormat === "VERTICAL_9_16"
      ? clip.exportedFilePath?.trim() || clip.exportPath?.trim() || null
      : null;
    const activePlan = clip.editPlans.length === 1 ? clip.editPlans[0] : null;
    const artifact = canonicalOutputPath && activePlan
      ? clip.artifacts.find((candidate) => (
          candidate.editPlanId === activePlan.id
          && candidate.planHash === activePlan.planHash
          && candidate.filePath?.trim() === canonicalOutputPath
        )) ?? null
      : null;
    if (!canonicalOutputPath || !activePlan || !artifact) {
      return null;
    }

    const compositionIdentity: ClipPostingCompositionIdentity = {
      schemaVersion: 1,
      clipId: clip.id,
      editPlanId: activePlan.id,
      artifactId: artifact.id,
      planHash: activePlan.planHash,
      filePath: canonicalOutputPath,
      sizeBytes: artifact.sizeBytes,
      snapshotSha256: null,
      snapshotSizeBytes: null,
    };
    const readyClip: AutomationUpcomingPost["clips"][number] = {
      id: clip.id,
      title: clip.title,
      caption: clip.caption,
      durationSeconds: clip.durationSeconds,
      hashtags: clip.hashtags,
      approvedAt: clip.updatedAt.toISOString(),
      approvalActorRef: `clip-status:${clip.id}:${clip.status}`,
      // The posting worker must receive one canonical final export. Supplying
      // overlay, caption-burn, or raw-render fallbacks can publish an older or
      // partially composed artifact after a Studio edit.
      localFileCandidates: [canonicalOutputPath],
      compositionIdentity,
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

function compositionIdentitiesForPost(
  post: AutomationUpcomingPost,
): ClipPostingCompositionIdentity[] {
  return post.clips.map((clip) => clip.compositionIdentity);
}

function compositionIdentitiesMatch(
  left: ClipPostingCompositionIdentity[],
  right: ClipPostingCompositionIdentity[],
): boolean {
  return left.length === right.length
    && left.every((identity, index) => {
      const candidate = right[index];
      return Boolean(
        candidate
        && identity.schemaVersion === candidate.schemaVersion
        && identity.clipId === candidate.clipId
        && identity.editPlanId === candidate.editPlanId
        && identity.artifactId === candidate.artifactId
        && identity.planHash === candidate.planHash
        && identity.filePath === candidate.filePath
        && identity.sizeBytes === candidate.sizeBytes
      );
    });
}

function postingSnapshotsAreBound(
  observed: ClipPostingCompositionIdentity[],
  bound: ClipPostingCompositionIdentity[],
): boolean {
  return observed.length === bound.length
    && observed.every((identity, index) => {
      const candidate = bound[index];
      if (
        !candidate
        || !identity.snapshotSha256
        || identity.snapshotSizeBytes === null
        || (
          identity.sizeBytes !== null
          && identity.sizeBytes !== identity.snapshotSizeBytes
        )
      ) {
        return false;
      }

      return candidate.snapshotSha256 === null
        ? candidate.snapshotSizeBytes === null
        : candidate.snapshotSha256 === identity.snapshotSha256
          && candidate.snapshotSizeBytes === identity.snapshotSizeBytes;
    });
}

function compositionIdentityJson(
  identities: ClipPostingCompositionIdentity[],
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(identities)) as Prisma.InputJsonValue;
}

function compositionReceiptJson(input: {
  identities: ClipPostingCompositionIdentity[];
  publicationIntegrity: StoredPublicationIntegrity;
}): Prisma.InputJsonValue {
  const receipt: StoredCompositionReceipt = {
    schemaVersion: 2,
    compositionIdentities: input.identities,
    publicationIntegrity: input.publicationIntegrity,
  };
  return JSON.parse(JSON.stringify(receipt)) as Prisma.InputJsonValue;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeStoredPublicationIntegrity(
  value: unknown,
): StoredPublicationIntegrity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const receipt = value as Record<string, unknown>;
  if (receipt["schemaVersion"] !== 2) {
    return null;
  }
  const rawIntegrity = receipt["publicationIntegrity"];
  if (!rawIntegrity || typeof rawIntegrity !== "object" || Array.isArray(rawIntegrity)) {
    return null;
  }
  const integrity = rawIntegrity as Partial<StoredPublicationIntegrity>;
  if (
    integrity.schemaVersion !== 1
    || !integrity.approvedPreview
    || !integrity.guard
  ) {
    return null;
  }

  try {
    const rebuilt = buildDuplicatePublicationGuardInputs({
      approvedPreview: integrity.approvedPreview,
      scheduledPayload: {
        ...integrity.approvedPreview.content,
        scheduledPostId: integrity.guard.scheduledPostId,
        approvedPreviewIdentity: integrity.approvedPreview.approvedPreviewIdentity,
      },
    });
    const stableJson = (item: unknown): string => {
      if (Array.isArray(item)) {
        return `[${item.map(stableJson).join(",")}]`;
      }
      if (item && typeof item === "object") {
        return `{${Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
          .join(",")}}`;
      }
      return JSON.stringify(item) ?? "null";
    };
    if (!rebuilt.ok || stableJson(rebuilt.guard) !== stableJson(integrity.guard)) {
      return null;
    }
    return integrity as StoredPublicationIntegrity;
  } catch {
    return null;
  }
}

function clipPublicationReceiptMatchesPost(input: {
  post: {
    id: string;
    organizationId: string | null;
    campusId: string | null;
    socialAccountId: string | null;
    clipIdsJson: unknown;
    platform: PrismaPostingPlatform;
    title: string | null;
    caption: string | null;
    status: PrismaScheduledPostStatus;
    workerStatus: PrismaScheduledPostWorkerStatus;
    workerId: string | null;
    compositionReceiptJson: unknown;
  };
  workerId: string;
}): boolean {
  const clipIds = normalizeClipIds(input.post.clipIdsJson);
  if (clipIds.length === 0) {
    // Non-video publishing does not yet have a durable media checksum. Its
    // existing approved-revision and media-preflight gates remain authoritative.
    return true;
  }
  if (
    clipIds.length !== 1
    || input.post.status !== "POSTING"
    || input.post.workerStatus !== "POSTING"
    || input.post.workerId !== input.workerId
  ) {
    return false;
  }

  const integrity = normalizeStoredPublicationIntegrity(
    input.post.compositionReceiptJson,
  );
  const identities = normalizeClipPostingCompositionIdentities(
    input.post.compositionReceiptJson,
  );
  const identity = identities?.[0];
  if (
    !integrity
    || identities?.length !== 1
    || !identity
    || !identity.snapshotSha256
    || clipIds[0] !== identity.clipId
  ) {
    return false;
  }

  const approvedContent = integrity.approvedPreview.content;
  if (
    approvedContent.sourceType !== "CLIP"
    || approvedContent.sourceId !== identity.clipId
    || approvedContent.approvedRevisionId
      !== `${identity.editPlanId}:${identity.planHash}`
    || approvedContent.mediaObjectKey !== `clip-artifact:${identity.artifactId}`
    || approvedContent.mediaChecksumSha256 !== identity.snapshotSha256
  ) {
    return false;
  }

  return verifyScheduledPayloadIdentity({
    approvedPreview: integrity.approvedPreview,
    scheduledPayload: {
      ...approvedContent,
      organizationId: input.post.organizationId ?? "",
      campusId: input.post.campusId,
      platform: fromPrismaPostingPlatform(input.post.platform),
      socialAccountId: input.post.socialAccountId ?? "",
      title: input.post.title ?? "",
      caption: input.post.caption ?? "",
      scheduledPostId: input.post.id,
      approvedPreviewIdentity: integrity.approvedPreview.approvedPreviewIdentity,
    },
  }).status === "VERIFIED";
}

type ClipPublicationIntegrityResult =
  | {
      ok: true;
      integrity: StoredPublicationIntegrity;
      publicGuard: ScheduledPostPublicationGuard;
    }
  | { ok: false; reason: string };

function buildClipPublicationIntegrity(input: {
  post: AutomationScheduledPostRecord;
  readyPost: AutomationUpcomingPost;
  snapshotIdentities: ClipPostingCompositionIdentity[];
}): ClipPublicationIntegrityResult {
  if (
    !input.post.organizationId
    || !input.post.socialAccountId
    || input.readyPost.clips.length !== 1
    || input.readyPost.contentAssets?.length
    || input.snapshotIdentities.length !== 1
  ) {
    return {
      ok: false,
      reason: "Publishing paused because this post does not have one tenant-scoped approved clip and destination account.",
    };
  }

  const clip = input.readyPost.clips[0];
  const identity = input.snapshotIdentities[0];
  if (
    !clip
    || !identity
    || clip.id !== identity.clipId
    || !identity.snapshotSha256
  ) {
    return {
      ok: false,
      reason: "Publishing paused because the approved preview is not bound to the verified final media bytes.",
    };
  }

  const content = {
    organizationId: input.post.organizationId,
    campusId: input.post.campusId,
    sourceType: "CLIP" as const,
    sourceId: clip.id,
    approvedRevisionId: `${identity.editPlanId}:${identity.planHash}`,
    platform: input.readyPost.platform,
    socialAccountId: input.post.socialAccountId,
    title: input.readyPost.title,
    caption: input.readyPost.caption,
    hashtags: normalizeStringArray(clip.hashtags),
    mediaObjectKey: `clip-artifact:${identity.artifactId}`,
    mediaChecksumSha256: identity.snapshotSha256,
  };
  const sealed = sealApprovedPreview({
    approvalState: "APPROVED",
    approvedAt: clip.approvedAt,
    // Clip approval does not yet carry a reviewer relation, so identify the
    // persisted approval state itself without fabricating a user identity.
    approvedByActorRef: clip.approvalActorRef,
    content,
  });
  if (!sealed.ok) {
    return {
      ok: false,
      reason: `Publishing paused because the approved preview identity is incomplete (${sealed.reasons.join(", ")}).`,
    };
  }
  const guarded = buildDuplicatePublicationGuardInputs({
    approvedPreview: sealed.receipt,
    scheduledPayload: {
      ...content,
      scheduledPostId: input.post.id,
      approvedPreviewIdentity: sealed.receipt.approvedPreviewIdentity,
    },
  });
  if (!guarded.ok) {
    return {
      ok: false,
      reason: `Publishing paused because the scheduled payload no longer matches approval (${guarded.reasons.join(", ")}).`,
    };
  }

  return {
    ok: true,
    integrity: {
      schemaVersion: 1,
      approvedPreview: sealed.receipt,
      guard: guarded.guard,
    },
    publicGuard: {
      approvedPreviewIdentity: guarded.guard.approvedPreviewIdentity,
      retryIdempotencyKey: guarded.guard.retryIdempotencyKey,
      semanticDuplicateKey: guarded.guard.semanticDuplicateKey,
      destinationPayloadKey: guarded.guard.destinationPayloadKey,
    },
  };
}

function duplicateRecordStatus(
  post: Pick<AutomationScheduledPostRecord, "status" | "externalPostId">,
): DuplicatePublicationRecord["status"] {
  if (post.externalPostId || post.status === "POSTED" || post.status === "PRIVATE_ONLY_UNVERIFIED") {
    return "PUBLISHED";
  }
  if (post.status === "POSTING") return "PUBLISHING";
  if (post.status === "FAILED") return "FAILED";
  if (post.status === "SKIPPED") return "CANCELLED";
  return "CLAIMED";
}

async function assessExistingClipPublications(input: {
  post: AutomationScheduledPostRecord;
  integrity: StoredPublicationIntegrity;
}): Promise<ReturnType<typeof assessDuplicatePublicationGuard>> {
  const candidates = await prisma.scheduledPost.findMany({
    where: {
      id: { not: input.post.id },
      organizationId: input.post.organizationId,
      campusId: input.post.campusId,
      socialAccountId: input.post.socialAccountId,
      platform: input.post.platform,
      status: { in: ["PLANNED", "POSTING", "POSTED", "PRIVATE_ONLY_UNVERIFIED"] },
      clipIdsJson: {
        array_contains: [input.integrity.guard.sourceId],
      },
    },
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      status: true,
      externalPostId: true,
      compositionReceiptJson: true,
    },
    take: 20,
  });

  const records: DuplicatePublicationRecord[] = candidates.map((candidate) => {
    const stored = normalizeStoredPublicationIntegrity(candidate.compositionReceiptJson);
    const storedGuard = stored?.guard;
    return {
      organizationId: candidate.organizationId ?? "",
      campusId: candidate.campusId,
      scheduledPostId: candidate.id,
      // Legacy rows have no canonical receipt. The tenant/source/destination
      // query already identified them as possible duplicates, so fail closed
      // by comparing them as the current payload.
      retryIdempotencyKey: storedGuard?.retryIdempotencyKey ?? `legacy:${candidate.id}`,
      semanticDuplicateKey: storedGuard?.semanticDuplicateKey
        ?? input.integrity.guard.semanticDuplicateKey,
      destinationPayloadKey: storedGuard?.destinationPayloadKey
        ?? input.integrity.guard.destinationPayloadKey,
      status: duplicateRecordStatus(candidate),
      externalPostId: candidate.externalPostId,
    };
  });

  return assessDuplicatePublicationGuard({
    guard: input.integrity.guard,
    records,
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
      compositionReceiptJson: Prisma.DbNull,
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
    const compositionIdentities = compositionIdentitiesForPost(readyPost);
    const bound = await prisma.scheduledPost.updateMany({
      where: {
        id: input.id,
        status: "POSTING",
        workerStatus: "CLAIMED",
        workerId: input.workerId,
        claimedAt: now,
      },
      data: {
        // Bind the claim before it leaves the API. Completion intentionally
        // keeps this JSON so it becomes part of the durable publish receipt.
        compositionReceiptJson: compositionIdentities.length > 0
          ? compositionIdentityJson(compositionIdentities)
          : Prisma.DbNull,
      },
    });

    return bound.count === 1 ? readyPost : null;
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

export type ScheduledPostCompositionValidationResult =
  | { valid: true; publicationGuard: ScheduledPostPublicationGuard }
  | { valid: false; released: boolean; reason: string };

export async function revalidateClaimedScheduledPostComposition(input: {
  id: string;
  workerId: string;
  compositionIdentities: ClipPostingCompositionIdentity[];
  now?: Date;
}): Promise<ScheduledPostCompositionValidationResult> {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: input.id },
    include: automationScheduledPostInclude,
  });
  if (
    !post
    || post.status !== "POSTING"
    || (post.workerStatus !== "CLAIMED" && post.workerStatus !== "POSTING")
    || post.workerId !== input.workerId
    || post.claimedAt === null
  ) {
    return {
      valid: false,
      released: false,
      reason: "The posting claim is no longer active.",
    };
  }

  const boundIdentities = normalizeClipPostingCompositionIdentities(post.compositionReceiptJson);
  const readyPost = (await buildReadyAutomationPosts([post]))[0] ?? null;
  const currentIdentities = readyPost ? compositionIdentitiesForPost(readyPost) : null;
  const compositionIsCurrent = Boolean(
    boundIdentities
    && currentIdentities
    && compositionIdentitiesMatch(input.compositionIdentities, boundIdentities)
    && compositionIdentitiesMatch(input.compositionIdentities, currentIdentities)
    && postingSnapshotsAreBound(input.compositionIdentities, boundIdentities)
  );

  if (compositionIsCurrent) {
    const publicationIntegrity = buildClipPublicationIntegrity({
      post,
      readyPost: readyPost as AutomationUpcomingPost,
      snapshotIdentities: input.compositionIdentities,
    });
    if (publicationIntegrity.ok) {
      const duplicateAssessment = await assessExistingClipPublications({
        post,
        integrity: publicationIntegrity.integrity,
      });
      if (duplicateAssessment.status === "BLOCKED") {
        const released = await prisma.scheduledPost.updateMany({
          where: {
            id: input.id,
            status: "POSTING",
            workerId: input.workerId,
            claimedAt: { not: null },
          },
          data: {
            status: "PLANNED",
            workerStatus: "IDLE",
            claimedAt: null,
            workerId: null,
            publishError: "Publishing paused because this approved clip may already be publishing or published to the selected account.",
            mediaObjectKey: null,
            mediaPublicUrl: null,
            mediaUploadedAt: null,
            compositionReceiptJson: Prisma.DbNull,
          },
        });
        return {
          valid: false,
          released: released.count === 1,
          reason: "This exact approved clip may already be publishing or published to the selected account.",
        };
      }
    }
    if (!publicationIntegrity.ok) {
      const released = await prisma.scheduledPost.updateMany({
        where: {
          id: input.id,
          status: "POSTING",
          workerId: input.workerId,
          claimedAt: { not: null },
        },
        data: {
          status: "PLANNED",
          workerStatus: "IDLE",
          claimedAt: null,
          workerId: null,
          publishError: publicationIntegrity.reason,
          mediaObjectKey: null,
          mediaPublicUrl: null,
          mediaUploadedAt: null,
          compositionReceiptJson: Prisma.DbNull,
        },
      });
      return {
        valid: false,
        released: released.count === 1,
        reason: publicationIntegrity.reason,
      };
    }

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
        compositionReceiptJson: compositionReceiptJson({
          identities: input.compositionIdentities,
          publicationIntegrity: publicationIntegrity.integrity,
        }),
      },
    });

    return renewed.count === 1
      ? {
          valid: true,
          publicationGuard: publicationIntegrity.publicGuard,
        }
      : {
          valid: false,
          released: false,
          reason: "The posting claim changed while its composition was being verified.",
        };
  }

  const released = await prisma.scheduledPost.updateMany({
    where: {
      id: input.id,
      status: "POSTING",
      workerId: input.workerId,
      claimedAt: { not: null },
    },
    data: {
      status: "PLANNED",
      workerStatus: "IDLE",
      claimedAt: null,
      workerId: null,
      publishError: "Publishing paused because the claimed clip composition changed. Review the latest final video before retrying.",
      mediaObjectKey: null,
      mediaPublicUrl: null,
      mediaUploadedAt: null,
      compositionReceiptJson: Prisma.DbNull,
    },
  });

  return {
    valid: false,
    released: released.count === 1,
    reason: "The claimed clip composition is no longer the current ready final export.",
  };
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
  if (
    input.status === "POSTED"
    || input.status === "PRIVATE_ONLY_UNVERIFIED"
  ) {
    const activePost = await prisma.scheduledPost.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        socialAccountId: true,
        clipIdsJson: true,
        platform: true,
        title: true,
        caption: true,
        status: true,
        workerStatus: true,
        workerId: true,
        compositionReceiptJson: true,
      },
    });
    if (
      activePost?.status === "POSTING"
      && !clipPublicationReceiptMatchesPost({
        post: activePost,
        workerId: input.workerId,
      })
    ) {
      throw new ScheduledPostPublicationIntegrityError();
    }
  }
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
  clipPublicationReceiptMatchesPost,
  ACTIVE_AUTOMATION_STATUSES,
  STALE_POSTING_CLAIM_MS,
};
