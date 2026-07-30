import { isIP } from "node:net";

import type {
  ContentAssetStatus,
  ContentAssetType,
  PublicSermonPageStatus,
} from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isTrustedContentAssetPublicUrl } from "@/server/contentAssets/contentAssetPublicStorage";

const PUBLIC_ASSET_STATUSES = new Set<ContentAssetStatus>([
  "APPROVED",
  "READY",
  "PUBLISHED",
]);
const RESERVED_SLUGS = new Set(["admin", "api", "new", "share"]);
const publicSermonSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicSermonTenantScope = Readonly<{
  organizationId: string;
  campusId?: string;
}>;

export type PublicSermonManagementInput = {
  sermonId: string;
  slug: string;
  title: string;
  summary: string | null;
  primaryCtaLabel: string | null;
  primaryCtaUrl: string | null;
  intent: "SAVE" | "PUBLISH" | "ARCHIVE";
  actorUserId: string;
  tenantScope: PublicSermonTenantScope;
};

export type PublicSermonAsset = {
  id: string;
  assetType: ContentAssetType;
  title: string;
  body: string | null;
  caption: string | null;
  callToAction: string | null;
  hashtags: string[];
  media: Array<{
    id: string;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    alt: string;
  }>;
};

export type PublicSermonPageView = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  primaryCtaLabel: string | null;
  ctaEndpoint: string | null;
  church: {
    name: string;
    primaryColor: string;
    secondaryColor: string;
    logoEndpoint: string | null;
  };
  sermon: {
    title: string;
    speakerName: string;
    churchName: string;
    sermonDate: string | null;
    youtubeWatchUrl: string;
    youtubeEmbedUrl: string;
    scriptureReferences: string[];
  };
  assets: PublicSermonAsset[];
  publishedAt: string | null;
};

export class PublicSermonSlugConflictError extends Error {
  constructor() {
    super("That public page address is already in use. Choose another slug.");
    this.name = "PublicSermonSlugConflictError";
  }
}

export class PublicSermonNotFoundError extends Error {
  constructor() {
    super("This sermon is not available in the active workspace.");
    this.name = "PublicSermonNotFoundError";
  }
}

export class PublicSermonSourceUnavailableError extends Error {
  constructor() {
    super("Publish this hub only after the sermon has a public YouTube video.");
    this.name = "PublicSermonSourceUnavailableError";
  }
}

function nullableTrimmedString(max: number) {
  return z
    .union([z.string().trim().max(max), z.null(), z.undefined()])
    .transform((value) => value?.trim() || null);
}

export const publicSermonManagementSchema = z
  .object({
    sermonId: z.string().trim().min(1),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Use at least three characters.")
      .max(80, "Keep the slug under 80 characters.")
      .regex(publicSermonSlugPattern, "Use lowercase letters, numbers, and single hyphens.")
      .refine((value) => !RESERVED_SLUGS.has(value), "Choose a different public page address."),
    title: z.string().trim().min(3, "Add a public page title.").max(140, "Keep the title under 140 characters."),
    summary: nullableTrimmedString(1_000),
    primaryCtaLabel: nullableTrimmedString(60),
    primaryCtaUrl: nullableTrimmedString(2_000),
    intent: z.enum(["SAVE", "PUBLISH", "ARCHIVE"]),
    actorUserId: z.string().trim().min(1),
    tenantScope: z.object({
      organizationId: z.string().trim().min(1),
      campusId: z.string().trim().min(1).optional(),
    }),
  })
  .superRefine((value, context) => {
    const hasLabel = Boolean(value.primaryCtaLabel);
    const hasUrl = Boolean(value.primaryCtaUrl);
    if (hasLabel !== hasUrl) {
      const message = "Add both a CTA label and a safe HTTPS destination, or leave both blank.";
      context.addIssue({
        code: "custom",
        path: hasLabel ? ["primaryCtaUrl"] : ["primaryCtaLabel"],
        message,
      });
    }
    if (value.primaryCtaUrl && !safeExternalCtaUrl(value.primaryCtaUrl)) {
      context.addIssue({
        code: "custom",
        path: ["primaryCtaUrl"],
        message: "Use a public HTTPS address. Private, local, and credential-bearing URLs are not allowed.",
      });
    }
  });

export function normalizePublicSermonSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function safeExternalCtaUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !hostname.includes(".")
      || isIP(hostname) !== 0
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".test")
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function youtubePublicVideo(value: string): {
  watchUrl: string;
  embedUrl: string;
} | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId: string | null = null;
    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (["embed", "live", "shorts"].includes(parts[0] ?? "")) {
          videoId = parts[1] ?? null;
        }
      }
    }
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
    return {
      watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
    };
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

type AssetProjectionInput = {
  id: string;
  assetType: ContentAssetType;
  status: ContentAssetStatus;
  title: string;
  bodyContent: string | null;
  caption: string | null;
  hashtagsJson: unknown;
  callToAction: string | null;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  currentRevision: {
    id: string;
    title: string;
    bodyContent: string | null;
    caption: string | null;
    hashtagsJson: unknown;
    callToAction: string | null;
    approvalState: string;
  } | null;
  approvedRevision: {
    id: string;
    title: string;
    bodyContent: string | null;
    caption: string | null;
    hashtagsJson: unknown;
    callToAction: string | null;
    approvalState: string;
  } | null;
  files: Array<{
    id: string;
    publicUrl: string | null;
    mimeType: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }>;
};

export function projectPublicAsset(
  asset: AssetProjectionInput,
  trustedPublicUrl: (value: string | null | undefined) => boolean = isTrustedContentAssetPublicUrl,
): PublicSermonAsset | null {
  const approvedRevision = asset.approvedRevision?.approvalState === "APPROVED"
    ? asset.approvedRevision
    : null;
  const currentApprovedRevision = asset.currentRevision?.approvalState === "APPROVED"
    ? asset.currentRevision
    : null;
  const legacyApprovedAsset = !asset.currentRevisionId && PUBLIC_ASSET_STATUSES.has(asset.status);
  const publicCopy = approvedRevision ?? currentApprovedRevision ?? (legacyApprovedAsset
    ? {
        id: "legacy-approved-asset",
        title: asset.title,
        bodyContent: asset.bodyContent,
        caption: asset.caption,
        hashtagsJson: asset.hashtagsJson,
        callToAction: asset.callToAction,
        approvalState: "APPROVED",
      }
    : null);
  if (!publicCopy) return null;

  const filesMatchPublicCopy = legacyApprovedAsset
    || (
      asset.currentRevisionId === publicCopy.id
      && (
        asset.approvedRevisionId === publicCopy.id
        || currentApprovedRevision?.id === publicCopy.id
      )
    );
  const media = filesMatchPublicCopy
    ? asset.files
        .filter((file) => file.mimeType.startsWith("image/") && trustedPublicUrl(file.publicUrl))
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .slice(0, asset.assetType === "CAROUSEL" ? 10 : 1)
        .map((file, index) => ({
          id: file.id,
          url: file.publicUrl!.trim(),
          mimeType: file.mimeType,
          width: file.width,
          height: file.height,
          alt: asset.assetType === "CAROUSEL"
            ? `${publicCopy.title}, slide ${index + 1}`
            : publicCopy.title,
        }))
    : [];

  return {
    id: asset.id,
    assetType: asset.assetType,
    title: publicCopy.title.trim(),
    body: publicCopy.bodyContent?.trim() || null,
    caption: publicCopy.caption?.trim() || null,
    callToAction: publicCopy.callToAction?.trim() || null,
    hashtags: stringList(publicCopy.hashtagsJson),
    media,
  };
}

function publicStatusForIntent(
  intent: PublicSermonManagementInput["intent"],
  currentStatus: PublicSermonPageStatus | null,
): PublicSermonPageStatus {
  if (intent === "PUBLISH") return "PUBLISHED";
  if (intent === "ARCHIVE") return "ARCHIVED";
  return currentStatus ?? "DRAFT";
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "P2002",
  );
}

export async function saveManagedPublicSermonPage(rawInput: PublicSermonManagementInput) {
  const input = publicSermonManagementSchema.parse(rawInput);
  const safeCtaUrl = safeExternalCtaUrl(input.primaryCtaUrl);
  try {
    return await prisma.$transaction(async (tx) => {
      const sermon = await tx.sermon.findFirst({
        where: {
          id: input.sermonId,
          ...input.tenantScope,
        },
        select: {
          id: true,
          organizationId: true,
          campusId: true,
          youtubeUrl: true,
          publicPage: {
            select: {
              id: true,
              status: true,
              publishedAt: true,
            },
          },
        },
      });
      if (!sermon?.organizationId) throw new PublicSermonNotFoundError();
      if (input.intent === "PUBLISH" && !youtubePublicVideo(sermon.youtubeUrl)) {
        throw new PublicSermonSourceUnavailableError();
      }

      const now = new Date();
      const nextStatus = publicStatusForIntent(input.intent, sermon.publicPage?.status ?? null);
      const lifecycleData = nextStatus === "PUBLISHED"
        ? {
            status: nextStatus,
            publishedAt: sermon.publicPage?.publishedAt ?? now,
            archivedAt: null,
          }
        : nextStatus === "ARCHIVED"
          ? {
              status: nextStatus,
              archivedAt: now,
            }
          : {
              status: nextStatus,
            };
      const commonData = {
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        primaryCtaLabel: input.primaryCtaLabel,
        primaryCtaUrl: safeCtaUrl,
        ...lifecycleData,
      };
      const page = sermon.publicPage
        ? await tx.sermonPublicPage.update({
            where: { id: sermon.publicPage.id },
            data: commonData,
          })
        : await tx.sermonPublicPage.create({
            data: {
              organizationId: sermon.organizationId,
              campusId: sermon.campusId,
              sermonId: sermon.id,
              createdByUserId: input.actorUserId,
              ...commonData,
            },
          });

      await tx.auditEvent.create({
        data: {
          organizationId: sermon.organizationId,
          campusId: sermon.campusId,
          actorType: "USER",
          actorUserId: input.actorUserId,
          action: input.intent === "PUBLISH"
            ? "sermon_public_page.published"
            : input.intent === "ARCHIVE"
              ? "sermon_public_page.archived"
              : "sermon_public_page.saved",
          targetType: "SermonPublicPage",
          targetId: page.id,
          metadataJson: {
            slug: page.slug,
            status: page.status,
            ctaConfigured: Boolean(page.primaryCtaUrl),
          },
        },
      });

      return page;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new PublicSermonSlugConflictError();
    throw error;
  }
}

export async function loadManagedPublicSermonPage(
  sermonId: string,
  tenantScope: PublicSermonTenantScope,
) {
  return prisma.sermon.findFirst({
    where: {
      id: sermonId,
      ...tenantScope,
    },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      youtubeUrl: true,
      sermonDate: true,
      publicPage: {
        select: {
          id: true,
          slug: true,
          status: true,
          title: true,
          summary: true,
          primaryCtaLabel: true,
          primaryCtaUrl: true,
          publishedAt: true,
          archivedAt: true,
          viewCount: true,
          ctaClickCount: true,
          updatedAt: true,
        },
      },
      contentAssets: {
        where: {
          status: { not: "ARCHIVED" },
        },
        select: {
          status: true,
          currentRevisionId: true,
          approvedRevisionId: true,
          currentRevision: { select: { approvalState: true } },
          approvedRevision: { select: { approvalState: true } },
        },
      },
    },
  });
}

export async function loadPublicSermonPage(slug: string): Promise<PublicSermonPageView | null> {
  if (!publicSermonSlugPattern.test(slug) || slug.length > 80) return null;
  const page = await prisma.sermonPublicPage.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      primaryCtaLabel: true,
      primaryCtaUrl: true,
      publishedAt: true,
      organizationId: true,
      campusId: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          churchName: true,
          youtubeUrl: true,
          sermonDate: true,
          scriptureRefs: {
            orderBy: [
              { isPrimary: "desc" },
              { frequencyCount: "desc" },
            ],
            take: 8,
            select: {
              reference: true,
            },
          },
          contentAssets: {
            where: {
              status: { not: "ARCHIVED" },
              OR: [
                { status: { in: ["APPROVED", "READY", "PUBLISHED"] } },
                { currentRevision: { is: { approvalState: "APPROVED" } } },
                { approvedRevision: { is: { approvalState: "APPROVED" } } },
              ],
            },
            orderBy: [
              { publishedAt: "desc" },
              { readyAt: "desc" },
              { approvedAt: "desc" },
            ],
            take: 24,
            select: {
              id: true,
              assetType: true,
              status: true,
              title: true,
              bodyContent: true,
              caption: true,
              hashtagsJson: true,
              callToAction: true,
              currentRevisionId: true,
              approvedRevisionId: true,
              currentRevision: {
                select: {
                  id: true,
                  title: true,
                  bodyContent: true,
                  caption: true,
                  hashtagsJson: true,
                  callToAction: true,
                  approvalState: true,
                },
              },
              approvedRevision: {
                select: {
                  id: true,
                  title: true,
                  bodyContent: true,
                  caption: true,
                  hashtagsJson: true,
                  callToAction: true,
                  approvalState: true,
                },
              },
              files: {
                orderBy: { sortOrder: "asc" },
                select: {
                  id: true,
                  publicUrl: true,
                  mimeType: true,
                  width: true,
                  height: true,
                  sortOrder: true,
                },
              },
            },
          },
        },
      },
      organization: {
        select: {
          name: true,
          brandingSettings: {
            select: {
              churchName: true,
              churchLogoPath: true,
              primaryBrandColor: true,
              secondaryBrandColor: true,
            },
          },
        },
      },
    },
  });
  if (!page) return null;

  const youtube = youtubePublicVideo(page.sermon.youtubeUrl);
  if (!youtube) return null;
  const assets = page.sermon.contentAssets
    .map((asset) => projectPublicAsset(asset))
    .filter((asset): asset is PublicSermonAsset => Boolean(asset));
  const branding = page.organization.brandingSettings;
  const safeCta = safeExternalCtaUrl(page.primaryCtaUrl);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    primaryCtaLabel: safeCta ? page.primaryCtaLabel : null,
    ctaEndpoint: safeCta ? `/api/public/sermons/${encodeURIComponent(page.slug)}/cta` : null,
    church: {
      name: branding?.churchName || page.organization.name || page.sermon.churchName,
      primaryColor: branding?.primaryBrandColor || "#0F766E",
      secondaryColor: branding?.secondaryBrandColor || "#1D4ED8",
      logoEndpoint: branding?.churchLogoPath
        ? `/api/public/sermons/${encodeURIComponent(page.slug)}/logo`
        : null,
    },
    sermon: {
      title: page.sermon.title,
      speakerName: page.sermon.speakerName,
      churchName: page.sermon.churchName,
      sermonDate: page.sermon.sermonDate?.toISOString() ?? null,
      youtubeWatchUrl: youtube.watchUrl,
      youtubeEmbedUrl: youtube.embedUrl,
      scriptureReferences: Array.from(new Set(
        page.sermon.scriptureRefs.map((reference) => reference.reference.trim()).filter(Boolean),
      )),
    },
    assets,
    publishedAt: page.publishedAt?.toISOString() ?? null,
  };
}

export async function recordPublicSermonCtaClick(slug: string): Promise<string | null> {
  if (!publicSermonSlugPattern.test(slug) || slug.length > 80) return null;
  return prisma.$transaction(async (tx) => {
    const page = await tx.sermonPublicPage.findFirst({
      where: {
        slug,
        status: "PUBLISHED",
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        primaryCtaUrl: true,
      },
    });
    const safeUrl = safeExternalCtaUrl(page?.primaryCtaUrl);
    if (!page || !safeUrl) return null;

    await tx.sermonPublicPage.update({
      where: { id: page.id },
      data: {
        ctaClickCount: { increment: 1 },
        ministryOutcomes: {
          create: {
            organizationId: page.organizationId,
            campusId: page.campusId,
            outcomeType: "WEBSITE_CLICK",
            value: 1,
            notes: "Public sermon page primary CTA click.",
          },
        },
      },
    });
    return safeUrl;
  });
}

export async function loadPublicSermonLogoPath(slug: string): Promise<string | null> {
  if (!publicSermonSlugPattern.test(slug) || slug.length > 80) return null;
  const page = await prisma.sermonPublicPage.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
    },
    select: {
      organization: {
        select: {
          brandingSettings: {
            select: {
              churchLogoPath: true,
            },
          },
        },
      },
    },
  });
  return page?.organization.brandingSettings?.churchLogoPath?.trim() || null;
}
