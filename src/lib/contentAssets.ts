import type {
  ContentAssetStatus as PrismaContentAssetStatus,
  ContentAssetType as PrismaContentAssetType,
  PostingPlatform as PrismaPostingPlatform,
  ScheduledPostStatus as PrismaScheduledPostStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type ContentAssetType = PrismaContentAssetType;
export type ContentAssetStatus = PrismaContentAssetStatus;

export type ContentAssetTenantScope = Readonly<{
  organizationId: string;
  campusId?: string | null;
}>;

function contentAssetTenantWhere(scope?: ContentAssetTenantScope) {
  return scope
    ? {
        organizationId: scope.organizationId,
        ...(scope.campusId ? { campusId: scope.campusId } : {}),
      }
    : {};
}

export const CONTENT_ASSET_TYPES: ContentAssetType[] = [
  "QUOTE_GRAPHIC",
  "SCRIPTURE_GRAPHIC",
  "CAROUSEL",
  "TEXT_POST",
  "DEVOTIONAL",
  "PRAYER",
  "INVITATION",
  "DISCUSSION",
  "SERMON_RECAP",
  "STORY",
  "GUIDE",
  "EMAIL",
  "NEWSLETTER",
  "BLOG",
  "OTHER",
];

export const CONTENT_ASSET_STATUSES: ContentAssetStatus[] = [
  "GENERATED",
  "APPROVED",
  "PREPARED",
  "READY",
  "SCHEDULED",
  "PUBLISHED",
  "ARCHIVED",
];

const CREATABLE_CONTENT_ASSET_STATUSES = new Set<ContentAssetStatus>([
  "GENERATED",
  "APPROVED",
  "PREPARED",
  "READY",
]);

const CONTENT_ASSET_TRANSITIONS: Record<ContentAssetStatus, ReadonlySet<ContentAssetStatus>> = {
  GENERATED: new Set(["APPROVED", "ARCHIVED"]),
  APPROVED: new Set(["GENERATED", "PREPARED", "ARCHIVED"]),
  PREPARED: new Set(["APPROVED", "READY", "ARCHIVED"]),
  READY: new Set(["PREPARED", "SCHEDULED", "ARCHIVED"]),
  SCHEDULED: new Set(["READY", "PUBLISHED", "ARCHIVED"]),
  PUBLISHED: new Set(["ARCHIVED"]),
  ARCHIVED: new Set(),
};

type StoredContentAsset = Prisma.ContentAssetGetPayload<{
  include: { files: true };
}>;

export type ContentAssetFileRecord = {
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
  metadata: Prisma.JsonValue | null;
};

export type ContentAssetRecord = {
  id: string;
  sermonId: string;
  contentOpportunityId: string | null;
  assetType: ContentAssetType;
  status: ContentAssetStatus;
  platform: PrismaPostingPlatform | null;
  title: string;
  bodyContent: string | null;
  caption: string | null;
  hashtags: Prisma.JsonValue | null;
  callToAction: string | null;
  metadata: Prisma.JsonValue | null;
  approvedAt: string | null;
  preparedAt: string | null;
  readyAt: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  files: ContentAssetFileRecord[];
};

export type ContentAssetFileInput = {
  fileName: string;
  mimeType: string;
  filePath?: string | null;
  objectKey?: string | null;
  publicUrl?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | bigint | null;
  sortOrder?: number;
  metadata?: Prisma.InputJsonValue;
};

export class ContentAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAssetValidationError";
  }
}

export class ContentAssetTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAssetTransitionError";
  }
}

export type LinkedScheduledPostLifecycle = {
  status: PrismaScheduledPostStatus;
  scheduledFor: Date | null;
};

export type ReconciledContentAssetLifecycle = {
  status: "READY" | "SCHEDULED" | "PUBLISHED";
  readyAt?: Date;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  archivedAt: null;
};

/**
 * Resolve the aggregate lifecycle for an asset that may be reused by several
 * scheduled posts. A confirmed publication wins, then any non-skipped link
 * keeps the asset scheduled. With no live links the production asset unlocks.
 */
export function resolveContentAssetLifecycleFromScheduledPosts(input: {
  links: LinkedScheduledPostLifecycle[];
  currentReadyAt: Date | null;
  currentPublishedAt: Date | null;
  now?: Date;
}): ReconciledContentAssetLifecycle {
  const now = input.now ?? new Date();
  const activeLinks = input.links.filter((link) => link.status !== "SKIPPED");
  const scheduledDates = activeLinks
    .flatMap((link) => link.scheduledFor ? [link.scheduledFor] : [])
    .sort((left, right) => left.getTime() - right.getTime());

  if (activeLinks.some((link) => link.status === "POSTED")) {
    return {
      status: "PUBLISHED",
      scheduledAt: scheduledDates[0] ?? null,
      publishedAt: input.currentPublishedAt ?? now,
      archivedAt: null,
    };
  }

  if (activeLinks.length > 0) {
    return {
      status: "SCHEDULED",
      scheduledAt: scheduledDates[0] ?? now,
      publishedAt: null,
      archivedAt: null,
    };
  }

  return {
    status: "READY",
    readyAt: input.currentReadyAt ?? now,
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
  };
}

export function normalizeContentAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.trim();
    return normalized ? [normalized] : [];
  })));
}

export function canTransitionContentAssetStatus(
  current: ContentAssetStatus,
  next: ContentAssetStatus,
): boolean {
  return current === next || CONTENT_ASSET_TRANSITIONS[current].has(next);
}

export function buildContentAssetStatusUpdate(input: {
  current: ContentAssetStatus;
  next: ContentAssetStatus;
  now?: Date;
}): {
  status: ContentAssetStatus;
  approvedAt?: Date | null;
  preparedAt?: Date | null;
  readyAt?: Date | null;
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  archivedAt?: Date | null;
} {
  if (!canTransitionContentAssetStatus(input.current, input.next)) {
    throw new ContentAssetTransitionError(
      `Content asset cannot move from ${input.current} to ${input.next}.`,
    );
  }

  if (input.current === input.next) return { status: input.next };

  const now = input.now ?? new Date();
  switch (input.next) {
    case "GENERATED":
      return {
        status: input.next,
        approvedAt: null,
        preparedAt: null,
        readyAt: null,
        scheduledAt: null,
        publishedAt: null,
        archivedAt: null,
      };
    case "APPROVED":
      return {
        status: input.next,
        approvedAt: now,
        preparedAt: null,
        readyAt: null,
        scheduledAt: null,
        publishedAt: null,
        archivedAt: null,
      };
    case "PREPARED":
      return {
        status: input.next,
        preparedAt: now,
        readyAt: null,
        scheduledAt: null,
        publishedAt: null,
        archivedAt: null,
      };
    case "READY":
      return {
        status: input.next,
        readyAt: now,
        scheduledAt: null,
        publishedAt: null,
        archivedAt: null,
      };
    case "SCHEDULED":
      return {
        status: input.next,
        scheduledAt: now,
        publishedAt: null,
        archivedAt: null,
      };
    case "PUBLISHED":
      return {
        status: input.next,
        publishedAt: now,
        archivedAt: null,
      };
    case "ARCHIVED":
      return { status: input.next, archivedAt: now };
  }
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizePositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContentAssetValidationError(`${label} must be a positive whole number.`);
  }
  return value;
}

function normalizeSizeBytes(value: number | bigint | null | undefined): bigint | null {
  if (value == null) return null;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new ContentAssetValidationError("File size must be a non-negative whole number.");
  }
  const normalized = BigInt(value);
  if (normalized < BigInt(0)) {
    throw new ContentAssetValidationError("File size must be non-negative.");
  }
  return normalized;
}

function normalizeFileInput(input: ContentAssetFileInput, fallbackSortOrder: number) {
  const fileName = input.fileName.trim();
  const mimeType = input.mimeType.trim().toLowerCase();
  const filePath = cleanOptionalString(input.filePath);
  const objectKey = cleanOptionalString(input.objectKey);
  const publicUrl = cleanOptionalString(input.publicUrl);
  const sortOrder = input.sortOrder ?? fallbackSortOrder;

  if (!fileName) throw new ContentAssetValidationError("Every content asset file needs a file name.");
  if (!mimeType) throw new ContentAssetValidationError("Every content asset file needs a MIME type.");
  if (!filePath && !objectKey && !publicUrl) {
    throw new ContentAssetValidationError(
      `Content asset file ${fileName} needs a local path, storage object key, or public URL.`,
    );
  }
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    throw new ContentAssetValidationError("File order must be a non-negative whole number.");
  }

  return {
    fileName,
    mimeType,
    filePath,
    objectKey,
    publicUrl,
    width: normalizePositiveInteger(input.width, "File width"),
    height: normalizePositiveInteger(input.height, "File height"),
    sizeBytes: normalizeSizeBytes(input.sizeBytes),
    sortOrder,
    metadataJson: input.metadata,
  };
}

function initialLifecycleTimestamps(status: ContentAssetStatus, now: Date) {
  const statusOrder: ContentAssetStatus[] = ["GENERATED", "APPROVED", "PREPARED", "READY"];
  const currentIndex = statusOrder.indexOf(status);
  return {
    approvedAt: currentIndex >= 1 ? now : null,
    preparedAt: currentIndex >= 2 ? now : null,
    readyAt: currentIndex >= 3 ? now : null,
  };
}

function toContentAssetRecord(asset: StoredContentAsset): ContentAssetRecord {
  return {
    id: asset.id,
    sermonId: asset.sermonId,
    contentOpportunityId: asset.contentOpportunityId,
    assetType: asset.assetType,
    status: asset.status,
    platform: asset.platform,
    title: asset.title,
    bodyContent: asset.bodyContent,
    caption: asset.caption,
    hashtags: asset.hashtagsJson,
    callToAction: asset.callToAction,
    metadata: asset.metadataJson,
    approvedAt: asset.approvedAt?.toISOString() ?? null,
    preparedAt: asset.preparedAt?.toISOString() ?? null,
    readyAt: asset.readyAt?.toISOString() ?? null,
    scheduledAt: asset.scheduledAt?.toISOString() ?? null,
    publishedAt: asset.publishedAt?.toISOString() ?? null,
    archivedAt: asset.archivedAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    files: [...asset.files]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime())
      .map((file) => ({
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
  };
}

export async function createContentAsset(input: {
  tenantScope?: ContentAssetTenantScope;
  sermonId: string;
  contentOpportunityId?: string | null;
  assetType: ContentAssetType;
  status?: ContentAssetStatus;
  platform?: PrismaPostingPlatform | null;
  title: string;
  bodyContent?: string | null;
  caption?: string | null;
  hashtags?: Prisma.InputJsonValue;
  callToAction?: string | null;
  metadata?: Prisma.InputJsonValue;
  files?: ContentAssetFileInput[];
  now?: Date;
}): Promise<ContentAssetRecord> {
  const sermonId = input.sermonId.trim();
  const title = input.title.trim();
  const contentOpportunityId = cleanOptionalString(input.contentOpportunityId);
  const status = input.status ?? "GENERATED";
  const now = input.now ?? new Date();

  if (!sermonId) throw new ContentAssetValidationError("A source sermon is required.");
  if (!title) throw new ContentAssetValidationError("A content asset title is required.");
  if (!CREATABLE_CONTENT_ASSET_STATUSES.has(status)) {
    throw new ContentAssetValidationError(
      "New content assets must begin as generated, approved, prepared, or ready.",
    );
  }

  const files = (input.files ?? []).map(normalizeFileInput);
  const sermon = await prisma.sermon.findFirst({
    where: {
      id: sermonId,
      ...contentAssetTenantWhere(input.tenantScope),
    },
    select: {
      id: true,
      organizationId: true,
      campusId: true,
    },
  });
  if (!sermon?.organizationId) {
    throw new ContentAssetValidationError("The source sermon could not be found in this workspace.");
  }

  if (contentOpportunityId) {
    const opportunity = await prisma.contentOpportunity.findFirst({
      where: {
        id: contentOpportunityId,
        sermonId,
        organizationId: sermon.organizationId,
        campusId: sermon.campusId,
      },
      select: { sermonId: true },
    });
    if (!opportunity || opportunity.sermonId !== sermonId) {
      throw new ContentAssetValidationError(
        "The selected content opportunity does not belong to the source sermon.",
      );
    }
  }

  const lifecycle = initialLifecycleTimestamps(status, now);
  const created = await prisma.contentAsset.create({
    data: {
      organizationId: sermon.organizationId,
      campusId: sermon.campusId,
      sermonId,
      contentOpportunityId,
      assetType: input.assetType,
      status,
      platform: input.platform ?? null,
      title,
      bodyContent: cleanOptionalString(input.bodyContent),
      caption: cleanOptionalString(input.caption),
      hashtagsJson: input.hashtags,
      callToAction: cleanOptionalString(input.callToAction),
      metadataJson: input.metadata,
      ...lifecycle,
      files: files.length > 0 ? { create: files } : undefined,
    },
    include: { files: true },
  });

  return toContentAssetRecord(created);
}

export async function getContentAsset(
  id: string,
  tenantScope?: ContentAssetTenantScope,
): Promise<ContentAssetRecord | null> {
  const asset = await prisma.contentAsset.findFirst({
    where: { id, ...contentAssetTenantWhere(tenantScope) },
    include: { files: true },
  });
  return asset ? toContentAssetRecord(asset) : null;
}

export async function listContentAssets(input: {
  tenantScope?: ContentAssetTenantScope;
  sermonId?: string;
  status?: ContentAssetStatus;
  assetType?: ContentAssetType;
  platform?: PrismaPostingPlatform | null;
  take?: number;
} = {}): Promise<ContentAssetRecord[]> {
  const assets = await prisma.contentAsset.findMany({
    where: {
      ...contentAssetTenantWhere(input.tenantScope),
      sermonId: input.sermonId,
      status: input.status,
      assetType: input.assetType,
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
    },
    include: { files: true },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, input.take ?? 100)),
  });
  return assets.map(toContentAssetRecord);
}

export async function transitionContentAssetStatus(input: {
  tenantScope?: ContentAssetTenantScope;
  id: string;
  status: ContentAssetStatus;
  now?: Date;
}): Promise<ContentAssetRecord | null> {
  const current = await prisma.contentAsset.findFirst({
    where: { id: input.id, ...contentAssetTenantWhere(input.tenantScope) },
    select: { status: true },
  });
  if (!current) return null;

  const data = buildContentAssetStatusUpdate({
    current: current.status,
    next: input.status,
    now: input.now,
  });
  if (current.status !== input.status) {
    const updated = await prisma.contentAsset.updateMany({
      where: {
        id: input.id,
        status: current.status,
        ...contentAssetTenantWhere(input.tenantScope),
      },
      data,
    });
    if (updated.count === 0) {
      throw new ContentAssetTransitionError(
        "The content asset changed while its lifecycle was being updated. Refresh and try again.",
      );
    }
  }

  return getContentAsset(input.id, input.tenantScope);
}

export async function attachContentAssetsToScheduledPost(input: {
  tenantScope?: ContentAssetTenantScope;
  scheduledPostId: string;
  contentAssetIds: string[];
  now?: Date;
}): Promise<{ scheduledPostId: string; contentAssetIds: string[] }> {
  const scheduledPostId = input.scheduledPostId.trim();
  const contentAssetIds = normalizeContentAssetIds(input.contentAssetIds);
  const now = input.now ?? new Date();
  if (!scheduledPostId) throw new ContentAssetValidationError("A scheduled post is required.");
  if (contentAssetIds.length === 0) {
    throw new ContentAssetValidationError("Choose at least one ready content asset to schedule.");
  }

  await prisma.$transaction(async (tx) => {
    const scheduledPost = await tx.scheduledPost.findFirst({
      where: {
        id: scheduledPostId,
        ...contentAssetTenantWhere(input.tenantScope),
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        platform: true,
      },
    });

    if (!scheduledPost) throw new ContentAssetValidationError("The scheduled post no longer exists.");
    if (!scheduledPost.organizationId) {
      throw new ContentAssetValidationError("The scheduled post is missing tenant ownership.");
    }
    const assets = await tx.contentAsset.findMany({
      where: {
        id: { in: contentAssetIds },
        organizationId: scheduledPost.organizationId,
        campusId: scheduledPost.campusId,
      },
      select: { id: true, platform: true, status: true },
    });
    if (assets.length !== contentAssetIds.length) {
      throw new ContentAssetValidationError("One or more selected content assets no longer exist.");
    }

    for (const asset of assets) {
      if (asset.status !== "READY" && asset.status !== "SCHEDULED") {
        throw new ContentAssetValidationError(
          `Content asset ${asset.id} must be ready before it can be scheduled.`,
        );
      }
      if (asset.platform && asset.platform !== scheduledPost.platform) {
        throw new ContentAssetValidationError(
          `Content asset ${asset.id} was prepared for ${asset.platform}, not ${scheduledPost.platform}.`,
        );
      }
    }

    await Promise.all(contentAssetIds.map((contentAssetId, sortOrder) => (
      tx.scheduledPostContentAsset.upsert({
        where: { scheduledPostId_contentAssetId: { scheduledPostId, contentAssetId } },
        create: { scheduledPostId, contentAssetId, sortOrder },
        update: { sortOrder },
      })
    )));
    await tx.contentAsset.updateMany({
      where: {
        id: { in: contentAssetIds },
        organizationId: scheduledPost.organizationId,
        campusId: scheduledPost.campusId,
        status: "READY",
      },
      data: { status: "SCHEDULED", scheduledAt: now, publishedAt: null, archivedAt: null },
    });
  });

  return { scheduledPostId, contentAssetIds };
}

export async function listScheduledPostContentAssets(
  scheduledPostId: string,
  tenantScope?: ContentAssetTenantScope,
): Promise<ContentAssetRecord[]> {
  const links = await prisma.scheduledPostContentAsset.findMany({
    where: {
      scheduledPostId,
      ...(tenantScope
        ? {
            scheduledPost: contentAssetTenantWhere(tenantScope),
            contentAsset: contentAssetTenantWhere(tenantScope),
          }
        : {}),
    },
    include: { contentAsset: { include: { files: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return links.map((link) => toContentAssetRecord(link.contentAsset));
}

export async function markScheduledPostContentAssetsPublished(input: {
  tenantScope?: ContentAssetTenantScope;
  scheduledPostId: string;
  now?: Date;
}): Promise<number> {
  const scheduledPost = await prisma.scheduledPost.findFirst({
    where: {
      id: input.scheduledPostId,
      ...contentAssetTenantWhere(input.tenantScope),
    },
    select: { organizationId: true, campusId: true },
  });
  if (!scheduledPost?.organizationId) return 0;
  const links = await prisma.scheduledPostContentAsset.findMany({
    where: {
      scheduledPostId: input.scheduledPostId,
      contentAsset: {
        organizationId: scheduledPost.organizationId,
        campusId: scheduledPost.campusId,
      },
    },
    select: { contentAssetId: true },
  });
  const contentAssetIds = links.map((link) => link.contentAssetId);
  if (contentAssetIds.length === 0) return 0;

  const result = await prisma.contentAsset.updateMany({
    where: {
      id: { in: contentAssetIds },
      organizationId: scheduledPost.organizationId,
      campusId: scheduledPost.campusId,
      status: { in: ["READY", "SCHEDULED"] },
    },
    data: {
      status: "PUBLISHED",
      publishedAt: input.now ?? new Date(),
      archivedAt: null,
    },
  });
  return result.count;
}

/**
 * Reconcile linked assets after a schedule is skipped, restored, or deleted.
 * Archived assets are intentionally immutable and are never reopened here.
 */
export async function reconcileScheduledPostContentAssetLifecycle(input: {
  tenantScope?: ContentAssetTenantScope;
  scheduledPostId?: string;
  contentAssetIds?: string[];
  now?: Date;
}): Promise<number> {
  const scheduledPost = input.scheduledPostId
    ? await prisma.scheduledPost.findFirst({
        where: {
          id: input.scheduledPostId,
          ...contentAssetTenantWhere(input.tenantScope),
        },
        select: { organizationId: true, campusId: true },
      })
    : null;
  if (input.scheduledPostId && !scheduledPost?.organizationId) return 0;
  const effectiveScope = scheduledPost?.organizationId
    ? {
        organizationId: scheduledPost.organizationId,
        campusId: scheduledPost.campusId,
      }
    : input.tenantScope;
  const requestedIds = normalizeContentAssetIds(input.contentAssetIds ?? []);
  const linkedIds = input.scheduledPostId
    ? (await prisma.scheduledPostContentAsset.findMany({
        where: {
          scheduledPostId: input.scheduledPostId,
          ...(effectiveScope ? { contentAsset: contentAssetTenantWhere(effectiveScope) } : {}),
        },
        select: { contentAssetId: true },
      })).map((link) => link.contentAssetId)
    : [];
  const contentAssetIds = normalizeContentAssetIds([...requestedIds, ...linkedIds]);
  if (contentAssetIds.length === 0) return 0;

  const [assets, links] = await Promise.all([
    prisma.contentAsset.findMany({
      where: {
        id: { in: contentAssetIds },
        ...contentAssetTenantWhere(effectiveScope),
        status: { not: "ARCHIVED" },
      },
      select: { id: true, readyAt: true, publishedAt: true },
    }),
    prisma.scheduledPostContentAsset.findMany({
      where: {
        contentAssetId: { in: contentAssetIds },
        ...(effectiveScope
          ? {
              contentAsset: contentAssetTenantWhere(effectiveScope),
              scheduledPost: contentAssetTenantWhere(effectiveScope),
            }
          : {}),
      },
      select: {
        contentAssetId: true,
        scheduledPost: { select: { status: true, scheduledFor: true } },
      },
    }),
  ]);
  if (assets.length === 0) return 0;

  const linksByAssetId = new Map<string, LinkedScheduledPostLifecycle[]>();
  for (const link of links) {
    const current = linksByAssetId.get(link.contentAssetId) ?? [];
    current.push(link.scheduledPost);
    linksByAssetId.set(link.contentAssetId, current);
  }

  const now = input.now ?? new Date();
  await prisma.$transaction(assets.map((asset) => prisma.contentAsset.update({
    where: { id: asset.id },
    data: resolveContentAssetLifecycleFromScheduledPosts({
      links: linksByAssetId.get(asset.id) ?? [],
      currentReadyAt: asset.readyAt,
      currentPublishedAt: asset.publishedAt,
      now,
    }),
  })));

  return assets.length;
}
