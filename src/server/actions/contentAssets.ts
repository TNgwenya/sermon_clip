"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CONTENT_ASSET_TYPES,
  isVideoClipOpportunityType,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
  resolveVideoClipOpportunityWorkflow,
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
import {
  createArtworkBrandFingerprint,
  readArtworkBrandFingerprint,
} from "@/server/branding/artworkBrandFingerprint";
import { readBrandingArtworkLogoDataUrl } from "@/server/branding/artworkLogo";
import { getBrandingSettings } from "@/server/branding/settings";
import { uploadContentAssetFileToR2 } from "@/server/contentAssets/contentAssetPublicStorage";
import { checkContentAssetMediaReadiness } from "@/server/contentAssets/contentAssetMediaReadiness";
import {
  createAssetRevision,
  createOpportunityRevision,
} from "@/server/contentRevisionService";
import { recordContentFunnelEvent } from "@/server/contentFunnelTelemetry";

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

function asRevisionJson(value: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : value as Prisma.InputJsonValue;
}

function scriptureReferenceWithVersion(
  reference: string | null | undefined,
  version: string | null | undefined,
): string | null {
  const trimmedReference = reference?.trim();
  if (!trimmedReference) return null;
  const trimmedVersion = version?.trim().toUpperCase();
  return trimmedVersion ? `${trimmedReference} (${trimmedVersion})` : trimmedReference;
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
            structuredContentJson: true,
            metadataJson: true,
            currentRevisionId: true,
            approvedRevisionId: true,
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
            title: true,
            shortDescription: true,
            bodyContent: true,
            editedContent: true,
            approvedContent: true,
            sourceTranscriptExcerpt: true,
            sourceTranscriptSegmentIds: true,
            sourceStartTimeSeconds: true,
            sourceEndTimeSeconds: true,
            suggestedPlatform: true,
            relatedScripture: true,
            scriptureTranslation: true,
            scriptureVerifiedAt: true,
            translationReviewState: true,
            aiReason: true,
            structuredContentJson: true,
            approvedRevisionId: true,
            relatedClip: {
              select: {
                id: true,
                sermonId: true,
                title: true,
                status: true,
                startTimeSeconds: true,
                endTimeSeconds: true,
                transcriptSafetyStatus: true,
              },
            },
          },
        })
      : null;

    if (opportunityId && !opportunity) {
      return { success: false, message: "The approved publishing idea could not be found." };
    }

    const requestedMetadata = asMetadataRecord(requestedAsset?.metadataJson);
    const requestedSourceOpportunityType = requestedMetadata.sourceOpportunityType;
    if (
      !opportunity
      && typeof requestedSourceOpportunityType === "string"
      && isVideoClipOpportunityType(requestedSourceOpportunityType)
    ) {
      return {
        success: false,
        message: "This legacy asset came from a video clip brief and cannot be edited as a text post. Return to the sermon clip workflow.",
      };
    }

    if (opportunity && opportunity.status !== "APPROVED" && opportunity.status !== "USED") {
      return { success: false, message: "Approve this generated content before preparing it for publishing." };
    }

    if (opportunity && isVideoClipOpportunityType(opportunity.opportunityType)) {
      const workflow = resolveVideoClipOpportunityWorkflow({
        sermonId: parsed.data.sermonId,
        opportunityType: opportunity.opportunityType,
        relatedClip: opportunity.relatedClip,
      });
      return {
        success: false,
        message: workflow
          ? `${workflow.message} Use “${workflow.actionLabel}” from Content Ideas.`
          : "Video clip briefs must be completed in the sermon clip workflow.",
      };
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
            structuredContentJson: true,
            metadataJson: true,
            currentRevisionId: true,
            approvedRevisionId: true,
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
              version: 2,
              templateId: designDocument.templateId,
              templateVersion: 1,
              artwork: designDocument.artwork,
              slides: designSlides,
              brandSnapshot: null,
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
      ...(opportunity?.structuredContentJson
        ? { structuredContentJson: opportunity.structuredContentJson as Prisma.InputJsonValue }
        : existingAsset?.structuredContentJson
          ? { structuredContentJson: existingAsset.structuredContentJson as Prisma.InputJsonValue }
          : {}),
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
    const contentAsset = await prisma.$transaction(async (tx) => {
      let sourceOpportunityRevisionId = opportunity?.approvedRevisionId ?? null;
      if (opportunity && !sourceOpportunityRevisionId) {
        const approvedAt = new Date();
        const opportunityRevision = await createOpportunityRevision(tx, {
          contentOpportunityId: opportunity.id,
          title: opportunity.title,
          shortDescription: opportunity.shortDescription,
          content: opportunity.approvedContent?.trim()
            || opportunity.editedContent?.trim()
            || opportunity.bodyContent,
          structuredContentJson: asRevisionJson(opportunity.structuredContentJson),
          sourceTranscriptExcerpt: opportunity.sourceTranscriptExcerpt,
          sourceTranscriptSegmentIds: asRevisionJson(opportunity.sourceTranscriptSegmentIds),
          sourceStartTimeSeconds: opportunity.sourceStartTimeSeconds,
          sourceEndTimeSeconds: opportunity.sourceEndTimeSeconds,
          relatedScripture: opportunity.relatedScripture,
          scriptureTranslation: opportunity.scriptureTranslation,
          scriptureVerifiedAt: opportunity.scriptureVerifiedAt,
          translationReviewState: opportunity.translationReviewState,
          approvalState: "APPROVED",
          createdBy: "legacy-approval-backfill",
          approvedBy: "legacy-approval-backfill",
          approvedAt,
        });
        sourceOpportunityRevisionId = opportunityRevision.id;
        await tx.contentOpportunity.update({
          where: { id: opportunity.id },
          data: { approvedRevisionId: opportunityRevision.id },
        });
      }

      const savedAsset = existingAsset
        ? await tx.contentAsset.update({
            where: { id: existingAsset.id },
            data: {
              ...data,
              // Artwork-source changes invalidate production files. Caption,
              // hashtag, platform and CTA edits preserve every existing output.
              ...(artworkChanged ? { files: { deleteMany: {} } } : {}),
            },
            select: { id: true },
          })
        : await tx.contentAsset.create({
            data: {
              id: contentAssetId,
              ...data,
            },
            select: { id: true },
          });

      const revision = await createAssetRevision(tx, {
        contentAssetId: savedAsset.id,
        sourceOpportunityRevisionId,
        title: parsed.data.title,
        bodyContent: parsed.data.bodyContent,
        structuredContentJson: asRevisionJson(
          opportunity?.structuredContentJson ?? existingAsset?.structuredContentJson,
        ),
        caption: parsed.data.caption?.trim() || parsed.data.bodyContent,
        hashtagsJson: hashtags,
        callToAction: parsed.data.callToAction?.trim() || null,
        metadataJson: metadataJson as Prisma.InputJsonValue,
        approvalState: "APPROVED",
        createdBy: "content-preparation",
        approvedBy: "content-preparation",
        approvedAt: now,
      });

      await tx.contentAsset.update({
        where: { id: savedAsset.id },
        data: {
          currentRevisionId: revision.id,
          approvedRevisionId: revision.id,
        },
      });
      return savedAsset;
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
    sortOrder: number;
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

async function scheduleContentAssetInternal(
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
        title: true,
        bodyContent: true,
        structuredContentJson: true,
        caption: true,
        hashtagsJson: true,
        callToAction: true,
        metadataJson: true,
        currentRevisionId: true,
        approvedRevisionId: true,
        currentRevision: {
          select: {
            approvalState: true,
            renderedAt: true,
          },
        },
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
        contentOpportunity: {
          select: {
            opportunityType: true,
            sourceTranscriptExcerpt: true,
            approvedRevisionId: true,
            relatedScripture: true,
            scriptureTranslation: true,
            translationReviewState: true,
            relatedClip: {
              select: {
                id: true,
                sermonId: true,
                title: true,
                status: true,
                startTimeSeconds: true,
                endTimeSeconds: true,
                transcriptSafetyStatus: true,
              },
            },
          },
        },
      },
    });
    if (!asset || !["READY", "SCHEDULED"].includes(asset.status)) {
      return { success: false, message: "Finish rendering this approved content before placing it on the calendar." };
    }
    const assetMetadata = asMetadataRecord(asset.metadataJson);
    const sourceOpportunityType = asset.contentOpportunity?.opportunityType
      ?? (typeof assetMetadata.sourceOpportunityType === "string"
        ? assetMetadata.sourceOpportunityType
        : null);
    if (
      sourceOpportunityType
      && isVideoClipOpportunityType(sourceOpportunityType)
    ) {
      const workflow = resolveVideoClipOpportunityWorkflow({
        sermonId: asset.sermonId,
        opportunityType: sourceOpportunityType,
        relatedClip: asset.contentOpportunity?.relatedClip,
      });
      return {
        success: false,
        message: workflow
          ? `${workflow.message} Use “${workflow.actionLabel}” instead of scheduling this legacy text asset.`
          : "This video clip brief cannot be scheduled as a text content asset.",
      };
    }
    if (
      asset.currentRevisionId
      && asset.approvedRevisionId
      && asset.currentRevisionId !== asset.approvedRevisionId
    ) {
      return {
        success: false,
        message: "This content changed after approval. Review and approve the current version before scheduling it.",
      };
    }
    if (asset.currentRevision && asset.currentRevision.approvalState !== "APPROVED") {
      return {
        success: false,
        message: "This content revision still needs approval before scheduling.",
      };
    }
    const approvedBrandFingerprint = readArtworkBrandFingerprint(assetMetadata);
    if (isDesignableContentAssetType(asset.assetType) && approvedBrandFingerprint) {
      const branding = await getBrandingSettings();
      const logoDataUrl = await readBrandingArtworkLogoDataUrl(branding.churchLogoPath);
      const currentBrandFingerprint = createArtworkBrandFingerprint({
        churchName: branding.churchName,
        primaryColor: branding.primaryBrandColor,
        secondaryColor: branding.secondaryBrandColor,
        fontFamily: branding.defaultFontFamily,
        logoDataUrl,
      });
      if (currentBrandFingerprint !== approvedBrandFingerprint) {
        return {
          success: false,
          message: "Your church branding changed after this artwork was approved. Open Design Studio and approve the artwork again before scheduling it.",
        };
      }
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

    const metadata = assetMetadata;
    const buildPreflight = (files: typeof asset.files) => runContentPublishingPreflight({
        assetType: asset.assetType,
        status: asset.status,
        platform: fromPrismaPostingPlatform(parsed.data.platform),
        caption: parsed.data.caption,
        automationMode: parsed.data.automationMode,
        metaConnectionReady: automatic ? Boolean(metaAccount) : undefined,
        sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
        artworkText: asset.bodyContent,
        relatedScripture: scriptureReferenceWithVersion(
          asset.contentOpportunity?.relatedScripture,
          asset.contentOpportunity?.scriptureTranslation,
        ),
        translationNeedsReview: metadata.translationNeedsReview === true,
        translationReview: asset.assetType === "SCRIPTURE_GRAPHIC"
          ? {
              scriptureVersion: asset.contentOpportunity?.scriptureTranslation,
              scriptureVersionRequired: true,
              scriptureVersionApproved: asset.contentOpportunity?.translationReviewState === "APPROVED",
            }
          : undefined,
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

    let preparedFiles = automatic && initialPreflight.checks.some((item) => item.id === "public-media" && item.status === "BLOCKED")
      ? await prepareAutomaticContentAssetMedia({
          assetId: asset.id,
          assetType: asset.assetType,
          platform: parsed.data.platform as "INSTAGRAM" | "FACEBOOK",
          files: asset.files,
        })
      : asset.files;

    if (initialPreflight.checks.some((item) => item.id === "media")) {
      const mediaReadiness = await checkContentAssetMediaReadiness({
        assetType: asset.assetType,
        platform: fromPrismaPostingPlatform(parsed.data.platform),
        files: preparedFiles,
      });
      if (mediaReadiness.status === "BLOCKED") {
        return { success: false, message: mediaReadiness.message };
      }

      const recoveredPublicUrls = new Map(
        mediaReadiness.files
          .filter((file) => file.source === "OBJECT_KEY" && Boolean(file.effectivePublicUrl))
          .map((file) => [file.id, file.effectivePublicUrl as string]),
      );
      if (recoveredPublicUrls.size > 0) {
        for (const [fileId, publicUrl] of recoveredPublicUrls) {
          await prisma.contentAssetFile.update({
            where: { id: fileId },
            data: { publicUrl },
          });
        }
        preparedFiles = preparedFiles.map((file) => {
          const publicUrl = recoveredPublicUrls.get(file.id);
          return publicUrl ? { ...file, publicUrl } : file;
        });
      }
    }

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
      const scheduleMatchesApprovedRevision = Boolean(
        asset.currentRevisionId
        && asset.currentRevisionId === asset.approvedRevisionId
        && parsed.data.title.trim() === asset.title.trim()
        && parsed.data.caption.trim() === (asset.caption?.trim() ?? ""),
      );
      let scheduledRevisionId = scheduleMatchesApprovedRevision
        ? asset.currentRevisionId
        : null;

      if (!scheduledRevisionId) {
        const approvedAt = new Date();
        const revision = await createAssetRevision(tx, {
          contentAssetId: asset.id,
          sourceOpportunityRevisionId: asset.contentOpportunity?.approvedRevisionId ?? null,
          title: parsed.data.title,
          bodyContent: asset.bodyContent,
          structuredContentJson: asRevisionJson(asset.structuredContentJson),
          caption: parsed.data.caption,
          hashtagsJson: asRevisionJson(asset.hashtagsJson),
          callToAction: asset.callToAction,
          metadataJson: asRevisionJson(asset.metadataJson),
          approvalState: "APPROVED",
          createdBy: "publishing-schedule",
          approvedBy: "publishing-schedule",
          approvedAt,
          renderedAt: asset.currentRevision?.renderedAt ?? null,
        });
        scheduledRevisionId = revision.id;
      }

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
              contentAssetRevisionId: scheduledRevisionId,
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
          currentRevisionId: scheduledRevisionId,
          approvedRevisionId: scheduledRevisionId,
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

function classifyContentScheduleFailure(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("already") && normalized.includes("scheduled")) return "DUPLICATE";
  if (normalized.includes("approval") || normalized.includes("approve")) return "APPROVAL_REQUIRED";
  if (normalized.includes("render") || normalized.includes("image") || normalized.includes("media") || normalized.includes("file")) return "MEDIA_NOT_READY";
  if (normalized.includes("publishing service") || normalized.includes("connected") || normalized.includes("permission")) return "PUBLISHING_SERVICE_NOT_READY";
  if (normalized.includes("date") || normalized.includes("time") || normalized.includes("timezone")) return "SCHEDULE_VALIDATION";
  if (normalized.includes("scripture") || normalized.includes("transcript") || normalized.includes("translation")) return "CONTENT_INTEGRITY";
  return "SCHEDULE_BLOCKED";
}

export async function scheduleContentAssetAction(
  input: ContentAssetScheduleInput,
): Promise<ContentAssetActionResult> {
  const startedAt = Date.now();
  const result = await scheduleContentAssetInternal(input);
  const parsedInput = scheduleSchema.safeParse(input);
  const rawInput = input as unknown;
  const rawAssetId = rawInput && typeof rawInput === "object" && "assetId" in rawInput
    ? (rawInput as { assetId?: unknown }).assetId
    : null;
  const assetId = parsedInput.success ? parsedInput.data.assetId : String(rawAssetId ?? "").trim();
  const asset = assetId
    ? await prisma.contentAsset.findUnique({
        where: { id: assetId },
        select: {
          id: true,
          sermonId: true,
          contentOpportunityId: true,
          assetType: true,
        },
      }).catch(() => null)
    : null;
  await recordContentFunnelEvent({
    eventType: result.success ? "SCHEDULE_SUCCEEDED" : "SCHEDULE_FAILED",
    sermonId: asset?.sermonId,
    opportunityId: asset?.contentOpportunityId,
    contentAssetId: asset?.id ?? (assetId || null),
    scheduledPostId: result.scheduledPostId,
    dedupeKey: result.success && result.scheduledPostId
      ? `content-schedule-succeeded:${result.scheduledPostId}`
      : `content-schedule-failed:${assetId || "unknown"}:${randomUUID()}`,
    durationMs: Date.now() - startedAt,
    metadata: {
      assetType: asset?.assetType,
      platform: parsedInput.success ? parsedInput.data.platform : null,
      automationMode: parsedInput.success ? parsedInput.data.automationMode : undefined,
      ...(!result.success ? { failureCode: classifyContentScheduleFailure(result.message) } : {}),
    },
  });
  return result;
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
