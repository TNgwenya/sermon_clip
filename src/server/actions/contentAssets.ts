"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CONTENT_ASSET_TYPES,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
} from "@/lib/contentPublishing";
import {
  buildCarouselStudioSlides,
  isDesignableContentAssetType,
  readContentDesignStudioDocument,
  type CarouselStudioSlide,
} from "@/lib/contentGraphicTemplates";
import {
  runContentPublishingPreflight,
  selectContentPublishingFiles,
} from "@/lib/contentPublishingPreflight";
import { fromPrismaPostingPlatform } from "@/lib/postingDrafts";
import { isValidIanaTimeZone, resolveScheduledInstant } from "@/lib/postingSchedule";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { uploadContentAssetFileToR2 } from "@/server/contentAssets/contentAssetPublicStorage";

const contentPublishingPlatformSchema = z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE_SHORTS", "FACEBOOK"]);
const contentAssetTypeSchema = z.enum(CONTENT_ASSET_TYPES);

const composerSchema = z.object({
  assetId: z.string().trim().min(1).optional(),
  sermonId: z.string().trim().min(1),
  opportunityId: z.string().trim().min(1).optional(),
  platform: contentPublishingPlatformSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  bodyContent: z.string().trim().min(1).max(20_000),
  caption: z.string().trim().max(10_000).optional(),
  hashtags: z.array(z.string().trim().max(100)).max(30).optional(),
  callToAction: z.string().trim().max(500).optional(),
});

const scheduleSchema = z.object({
  assetId: z.string().trim().min(1),
  platform: contentPublishingPlatformSchema,
  scheduledFor: z.string().trim().min(1).max(40),
  timezone: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(255),
  caption: z.string().trim().min(1).max(63_206),
  postingSlot: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(500).optional(),
  automationMode: z.enum(["MANUAL", "AUTOMATIC"]).default("MANUAL"),
  socialAccountId: z.string().trim().min(1).optional(),
});

export type ContentAssetComposerInput = z.infer<typeof composerSchema>;
export type ContentAssetScheduleInput = z.input<typeof scheduleSchema>;

export type ContentAssetActionResult = {
  success: boolean;
  message: string;
  contentAssetId?: string;
  readyToPostHref?: string;
  scheduledPostId?: string;
};

function revalidateContentPublishingPaths(sermonId: string, contentAssetId?: string): void {
  revalidatePath("/opportunities");
  revalidatePath("/ready-to-post");
  revalidatePath(`/opportunities?sermonId=${sermonId}`);
  revalidatePath(`/sermons/${sermonId}`);
  if (contentAssetId) {
    revalidatePath(`/ready-to-post?contentAssetId=${contentAssetId}`);
  }
}

function immutableContentAssetComposerMessage(status: string): string | null {
  if (status === "SCHEDULED") {
    return "This content asset is locked while it is scheduled. Cancel its scheduled posts before changing this version.";
  }
  if (status === "PUBLISHED" || status === "ARCHIVED") {
    return "Published and archived content assets are read-only. Create a new asset from the sermon’s Content Ideas instead.";
  }
  return null;
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function rebuildCarouselSlidesWithSavedDesign(input: {
  content: string;
  title: string;
  savedSlides: CarouselStudioSlide[];
}): CarouselStudioSlide[] {
  return buildCarouselStudioSlides(input.content, input.title).map((slide, index) => {
    const saved = input.savedSlides[index];
    return saved
      ? {
          ...slide,
          id: saved.id,
          role: saved.role,
          templateId: saved.templateId,
          scripture: saved.scripture,
        }
      : slide;
  });
}

export async function prepareContentOpportunityForPublishingAction(
  input: ContentAssetComposerInput,
): Promise<ContentAssetActionResult> {
  const parsed = composerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Publishing preparation could not be saved: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }

  try {
    const requestedAsset = parsed.data.assetId
      ? await prisma.contentAsset.findFirst({
          where: { id: parsed.data.assetId, sermonId: parsed.data.sermonId },
          select: {
            id: true,
            status: true,
            contentOpportunityId: true,
            assetType: true,
            title: true,
            bodyContent: true,
            metadataJson: true,
          },
        })
      : null;

    if (parsed.data.assetId && !requestedAsset) {
      return { success: false, message: "The prepared content asset could not be found." };
    }
    const requestedAssetLock = requestedAsset
      ? immutableContentAssetComposerMessage(requestedAsset.status)
      : null;
    if (requestedAssetLock) {
      return { success: false, message: requestedAssetLock };
    }

    const opportunityId = parsed.data.opportunityId ?? requestedAsset?.contentOpportunityId ?? null;
    const opportunity = opportunityId
      ? await prisma.contentOpportunity.findFirst({
          where: { id: opportunityId, sermonId: parsed.data.sermonId },
          select: {
            id: true,
            opportunityType: true,
            status: true,
            sourceTranscriptExcerpt: true,
            suggestedPlatform: true,
            relatedScripture: true,
            aiReason: true,
          },
        })
      : null;

    if (opportunityId && !opportunity) {
      return { success: false, message: "The approved publishing idea could not be found." };
    }

    if (opportunity && opportunity.status !== "APPROVED" && opportunity.status !== "USED") {
      return { success: false, message: "Approve this generated content before preparing it for publishing." };
    }

    if (
      opportunity?.opportunityType === "QUOTE_GRAPHIC"
      && !opportunity.sourceTranscriptExcerpt?.trim()
    ) {
      return { success: false, message: "This pastor quote still needs transcript evidence before publishing." };
    }

    const existingAsset = requestedAsset ?? (opportunity
      ? await prisma.contentAsset.findFirst({
          where: {
            contentOpportunityId: opportunity.id,
            status: { not: "ARCHIVED" },
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            status: true,
            contentOpportunityId: true,
            assetType: true,
            title: true,
            bodyContent: true,
            metadataJson: true,
          },
        })
      : null);
    const existingAssetLock = existingAsset
      ? immutableContentAssetComposerMessage(existingAsset.status)
      : null;
    if (existingAssetLock) {
      return { success: false, message: existingAssetLock };
    }
    const hashtags = normalizeContentHashtags(parsed.data.hashtags);
    const platform = parsed.data.platform
      ?? normalizeSuggestedPostingPlatform(opportunity?.suggestedPlatform)
      ?? null;
    const assetType = contentAssetTypeSchema.parse(
      existingAsset?.assetType
      ?? (opportunity ? mapOpportunityTypeToContentAssetType(opportunity.opportunityType) : "TEXT_POST"),
    );
    const now = new Date();
    const isDesignable = isDesignableContentAssetType(assetType);
    const artworkChanged = !existingAsset
      || parsed.data.title.trim() !== existingAsset.title.trim()
      || parsed.data.bodyContent.trim() !== (existingAsset.bodyContent?.trim() ?? "");
    const shouldInvalidateArtwork = isDesignable && artworkChanged;
    const status: "PREPARED" | "READY" = isDesignable
      ? shouldInvalidateArtwork || existingAsset?.status !== "READY" ? "PREPARED" : "READY"
      : "READY";
    const existingMetadata = asMetadataRecord(existingAsset?.metadataJson);
    const designDocument = isDesignable
      ? readContentDesignStudioDocument({
          metadata: existingMetadata,
          assetType,
          title: existingAsset?.title ?? parsed.data.title,
          bodyContent: existingAsset?.bodyContent ?? parsed.data.bodyContent,
        })
      : null;
    const bodyChanged = parsed.data.bodyContent.trim() !== (existingAsset?.bodyContent?.trim() ?? "");
    const designSlides = assetType === "CAROUSEL"
      ? bodyChanged
        ? rebuildCarouselSlidesWithSavedDesign({
            content: parsed.data.bodyContent,
            title: parsed.data.title,
            savedSlides: designDocument?.slides ?? [],
          })
        : designDocument?.slides ?? buildCarouselStudioSlides(parsed.data.bodyContent, parsed.data.title)
      : designDocument?.slides ?? [];
    const existingDesignMetadata = asMetadataRecord(existingMetadata.designStudio);
    const metadataJson = {
      ...existingMetadata,
      manualHandoffRequired: true,
      sourceOpportunityType: opportunity?.opportunityType ?? existingMetadata.sourceOpportunityType ?? null,
      relatedScripture: Object.prototype.hasOwnProperty.call(existingMetadata, "relatedScripture")
        ? existingMetadata.relatedScripture ?? null
        : opportunity?.relatedScripture ?? null,
      sourceTranscriptExcerpt: opportunity?.sourceTranscriptExcerpt ?? existingMetadata.sourceTranscriptExcerpt ?? null,
      groundingNote: opportunity?.aiReason ?? existingMetadata.groundingNote ?? null,
      ...(shouldInvalidateArtwork && designDocument
        ? {
            designStudio: {
              ...existingDesignMetadata,
              version: 1,
              templateId: designDocument.templateId,
              slides: designSlides,
              updatedAt: now.toISOString(),
              renderRequired: true,
              renderedAt: null,
            },
          }
        : {}),
    };
    const data = {
      sermonId: parsed.data.sermonId,
      contentOpportunityId: opportunity?.id ?? existingAsset?.contentOpportunityId ?? null,
      assetType,
      status,
      platform,
      title: parsed.data.title,
      bodyContent: parsed.data.bodyContent,
      caption: parsed.data.caption?.trim() || parsed.data.bodyContent,
      hashtagsJson: hashtags,
      callToAction: parsed.data.callToAction?.trim() || null,
      metadataJson,
      approvedAt: now,
      preparedAt: now,
      ...(shouldInvalidateArtwork
        ? { readyAt: null }
        : !isDesignable
          ? { readyAt: now }
          : {}),
    };

    const contentAssetId = existingAsset?.id ?? randomUUID();
    const contentAsset = existingAsset
      ? await prisma.contentAsset.update({
          where: { id: existingAsset.id },
          data: {
            ...data,
            // Artwork-source changes invalidate production files. Caption,
            // hashtag, platform and CTA edits preserve every existing output.
            ...(artworkChanged ? { files: { deleteMany: {} } } : {}),
          },
          select: { id: true },
        })
      : await prisma.contentAsset.create({
          data: {
            id: contentAssetId,
            ...data,
          },
          select: { id: true },
        });

    revalidateContentPublishingPaths(parsed.data.sermonId, contentAsset.id);
    return {
      success: true,
      message: shouldInvalidateArtwork
        ? "Draft saved. Choose a design, preview every format, then render the final artwork."
        : isDesignable
          ? "Post details saved. The current artwork remains ready."
        : "Content prepared and added to Ready to Post.",
      contentAssetId: contentAsset.id,
      readyToPostHref: `/ready-to-post?contentAssetId=${contentAsset.id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Content preparation failed.",
    };
  }
}

export async function updateContentAssetComposerAction(
  input: ContentAssetComposerInput,
): Promise<ContentAssetActionResult> {
  return prepareContentOpportunityForPublishingAction(input);
}

function normalizedCredentialScopes(value: unknown): Set<string> {
  return new Set(Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string").map((scope) => scope.trim())
    : []);
}

async function validateAutomaticMetaAccount(input: {
  socialAccountId: string | undefined;
  platform: "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE_SHORTS";
}): Promise<{ id: string } | null> {
  if (input.platform !== "INSTAGRAM" && input.platform !== "FACEBOOK") return null;
  if (!input.socialAccountId) return null;
  const provider = input.platform === "INSTAGRAM" ? "META_INSTAGRAM" : "META_FACEBOOK";
  const requiredScope = input.platform === "INSTAGRAM" ? "instagram_content_publish" : "pages_manage_posts";
  const account = await prisma.socialAccount.findUnique({
    where: { id: input.socialAccountId },
    select: {
      id: true,
      platform: true,
      status: true,
      credentials: {
        where: { provider, status: "CONNECTED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          accessTokenCiphertext: true,
          scopesJson: true,
          expiresAt: true,
        },
      },
    },
  });
  const credential = account?.credentials[0];
  if (
    !account
    || account.platform !== input.platform
    || account.status !== "CONNECTED"
    || !credential?.accessTokenCiphertext
    || (credential.expiresAt && credential.expiresAt.getTime() <= Date.now() + 60_000)
    || !normalizedCredentialScopes(credential.scopesJson).has(requiredScope)
  ) {
    return null;
  }
  return { id: account.id };
}

async function prepareAutomaticContentAssetMedia(input: {
  assetId: string;
  assetType: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    filePath: string | null;
    objectKey: string | null;
    publicUrl: string | null;
    width: number | null;
    height: number | null;
    sizeBytes: bigint | null;
    metadataJson: Prisma.JsonValue | null;
  }>;
}): Promise<typeof input.files> {
  const platform = fromPrismaPostingPlatform(input.platform);
  const normalizedFiles = input.files.map((file) => ({
    ...file,
    sizeBytes: file.sizeBytes ? Number(file.sizeBytes) : null,
  }));
  const publishingFiles = selectContentPublishingFiles({
    assetType: input.assetType,
    platform,
    files: normalizedFiles,
  });
  if (publishingFiles.length === 0) {
    throw new Error("Render a platform-ready image before automatic publishing.");
  }
  if (input.assetType === "CAROUSEL" && (publishingFiles.length < 2 || publishingFiles.length > 10)) {
    throw new Error("A Meta carousel needs between 2 and 10 publishing slides.");
  }
  if (input.platform === "INSTAGRAM" && publishingFiles.some((file) => file.mimeType !== "image/jpeg" && file.mimeType !== "image/jpg")) {
    throw new Error("Render JPEG publishing media before automatic Instagram posting.");
  }

  const publishedByFileId = new Map<string, { objectKey: string; publicUrl: string; sizeBytes: bigint }>();
  for (const file of publishingFiles) {
    if (/^https:\/\//i.test(file.publicUrl?.trim() ?? "")) continue;
    if (!file.filePath?.trim()) {
      throw new Error(`Publishing image ${file.fileName} has no local file to upload. Render it again before scheduling.`);
    }
    const uploaded = await uploadContentAssetFileToR2({
      contentAssetId: input.assetId,
      fileId: file.id,
      fileName: file.fileName,
      filePath: file.filePath,
      mimeType: file.mimeType,
    });
    const update = {
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.publicUrl,
      sizeBytes: BigInt(uploaded.sizeBytes),
    };
    await prisma.contentAssetFile.update({
      where: { id: file.id },
      data: update,
    });
    publishedByFileId.set(file.id, update);
  }

  return input.files.map((file) => {
    const uploaded = publishedByFileId.get(file.id);
    return uploaded ? { ...file, ...uploaded } : file;
  });
}

export async function scheduleContentAssetAction(
  input: ContentAssetScheduleInput,
): Promise<ContentAssetActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `The handoff could not be scheduled: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }

  if (!isValidIanaTimeZone(parsed.data.timezone)) {
    return { success: false, message: "Choose a valid IANA timezone, such as Africa/Johannesburg." };
  }
  const scheduledFor = resolveScheduledInstant(parsed.data.scheduledFor, parsed.data.timezone);
  if (!scheduledFor) {
    return { success: false, message: "Choose a valid date and time in the selected timezone." };
  }
  if (scheduledFor.getTime() < Date.now() - 60_000) {
    return { success: false, message: "Choose a future date and time for this handoff." };
  }

  try {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: parsed.data.assetId },
      select: {
        id: true,
        sermonId: true,
        status: true,
        assetType: true,
        platform: true,
        caption: true,
        metadataJson: true,
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
            metadataJson: true,
          },
        },
        contentOpportunity: {
          select: { sourceTranscriptExcerpt: true },
        },
      },
    });
    if (!asset || !["READY", "SCHEDULED"].includes(asset.status)) {
      return { success: false, message: "Finish rendering this approved content before placing it on the calendar." };
    }

    const automatic = parsed.data.automationMode === "AUTOMATIC";
    if (automatic && parsed.data.platform !== "INSTAGRAM" && parsed.data.platform !== "FACEBOOK") {
      return { success: false, message: "Automatic non-video publishing is currently available for Facebook and Instagram images." };
    }
    const metaAccount = automatic
      ? await validateAutomaticMetaAccount({
          socialAccountId: parsed.data.socialAccountId,
          platform: parsed.data.platform,
        })
      : null;
    if (automatic && !metaAccount) {
      return {
        success: false,
        message: `Choose a connected ${fromPrismaPostingPlatform(parsed.data.platform)} account with publishing permission. Reconnect it in Social settings if permissions changed.`,
      };
    }
    const publishingServiceHealth = automatic ? await getPublishingServiceHealth() : null;
    if (publishingServiceHealth && publishingServiceHealth.status !== "ONLINE") {
      return {
        success: false,
        message: publishingServiceHealth.status === "STALE"
          ? "The publishing service has not checked in recently. Restart it before scheduling an automatic post."
          : "Start the publishing service and wait for its first check-in before scheduling an automatic post.",
      };
    }
    if (publishingServiceHealth?.dryRun) {
      return {
        success: false,
        message: "The publishing service is in test mode. Turn off dry-run mode before scheduling an automatic post.",
      };
    }

    const metadata = asset.metadataJson && typeof asset.metadataJson === "object" && !Array.isArray(asset.metadataJson)
      ? asset.metadataJson as Record<string, unknown>
      : {};
    const buildPreflight = (files: typeof asset.files) => runContentPublishingPreflight({
        assetType: asset.assetType,
        status: asset.status,
        platform: fromPrismaPostingPlatform(parsed.data.platform),
        caption: parsed.data.caption,
        automationMode: parsed.data.automationMode,
        metaConnectionReady: automatic ? Boolean(metaAccount) : undefined,
        sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
        translationNeedsReview: metadata.translationNeedsReview === true,
        files: files.map((file) => {
          const fileMetadata = file.metadataJson && typeof file.metadataJson === "object" && !Array.isArray(file.metadataJson)
            ? file.metadataJson as Record<string, unknown>
            : {};
          return {
            fileName: file.fileName,
            mimeType: file.mimeType,
            publicUrl: file.publicUrl,
            width: file.width,
            height: file.height,
            sizeBytes: file.sizeBytes ? Number(file.sizeBytes) : null,
            overflowDetected: fileMetadata.overflowDetected === true,
          };
        }),
      });
    const initialPreflight = buildPreflight(asset.files);
    const preUploadBlocker = initialPreflight.checks.find((item) => (
      item.status === "BLOCKED" && (!automatic || item.id !== "public-media")
    ));
    if (preUploadBlocker) {
      return { success: false, message: preUploadBlocker.summary };
    }

    const duplicateWindowStart = new Date(scheduledFor.getTime() - 7 * 24 * 60 * 60_000);
    const duplicateWindowEnd = new Date(scheduledFor.getTime() + 7 * 24 * 60 * 60_000);
    const duplicateSchedule = await prisma.scheduledPostContentAsset.findFirst({
      where: {
        contentAssetId: asset.id,
        scheduledPost: {
          platform: parsed.data.platform,
          status: { in: ["PLANNED", "READY_FOR_MEDIA_TEAM", "POSTING", "POSTED"] },
          scheduledFor: { gte: duplicateWindowStart, lte: duplicateWindowEnd },
        },
      },
      select: { scheduledPost: { select: { scheduledFor: true } } },
    });
    if (duplicateSchedule) {
      const existingDate = duplicateSchedule.scheduledPost.scheduledFor;
      return {
        success: false,
        message: `This exact asset is already planned for ${fromPrismaPostingPlatform(parsed.data.platform)}${existingDate ? ` on ${existingDate.toLocaleString()}` : ""}. Choose another platform, date, or asset.`,
      };
    }

    const preparedFiles = automatic && initialPreflight.checks.some((item) => item.id === "public-media" && item.status === "BLOCKED")
      ? await prepareAutomaticContentAssetMedia({
          assetId: asset.id,
          assetType: asset.assetType,
          platform: parsed.data.platform as "INSTAGRAM" | "FACEBOOK",
          files: asset.files,
        })
      : asset.files;
    const finalPreflight = automatic ? buildPreflight(preparedFiles) : initialPreflight;
    if (!finalPreflight.canSchedule) {
      const blocker = finalPreflight.checks.find((item) => item.status === "BLOCKED");
      return { success: false, message: blocker?.summary ?? "Publishing preflight found an item to resolve." };
    }

    const postingSlot = parsed.data.postingSlot?.trim()
      || new Intl.DateTimeFormat("en", {
        timeZone: parsed.data.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(scheduledFor);
    const idempotencyKey = [
      "content-asset",
      asset.id,
      parsed.data.platform,
      scheduledFor.toISOString(),
    ].join(":");

    const scheduledPost = await prisma.$transaction(async (tx) => {
      const post = await tx.scheduledPost.create({
        data: {
          clipIdsJson: [],
          platform: parsed.data.platform,
          socialAccountId: automatic ? metaAccount?.id : null,
          postingSlot,
          title: parsed.data.title,
          caption: parsed.data.caption,
          note: parsed.data.note?.trim() || (automatic
            ? "Automatic Meta publishing for generated sermon content."
            : "Manual upload handoff for generated sermon content."),
          status: automatic ? "PLANNED" : "READY_FOR_MEDIA_TEAM",
          automationMode: parsed.data.automationMode,
          scheduledFor,
          timezone: parsed.data.timezone,
          idempotencyKey,
          contentAssetLinks: {
            create: {
              contentAssetId: asset.id,
              sortOrder: 0,
            },
          },
        },
        select: { id: true },
      });

      await tx.contentAsset.update({
        where: { id: asset.id },
        data: {
          status: "SCHEDULED",
          platform: parsed.data.platform,
          title: parsed.data.title,
          caption: parsed.data.caption,
          scheduledAt: scheduledFor,
        },
      });

      return post;
    });

    revalidateContentPublishingPaths(asset.sermonId, asset.id);
    return {
      success: true,
      message: automatic
        ? "Automatic publishing added to the mixed-content calendar."
        : "Manual publishing handoff added to the mixed-content calendar.",
      contentAssetId: asset.id,
      scheduledPostId: scheduledPost.id,
      readyToPostHref: `/ready-to-post?contentAssetId=${asset.id}`,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return {
        success: false,
        message: "This exact asset is already scheduled for that platform and time.",
      };
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : "The content could not be scheduled.",
    };
  }
}

export async function scheduleContentAssetManualAction(
  input: ContentAssetScheduleInput,
): Promise<ContentAssetActionResult> {
  return scheduleContentAssetAction({
    ...input,
    automationMode: "MANUAL",
    socialAccountId: undefined,
  });
}
