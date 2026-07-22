"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import {
  normalizeContentArtworkSettings,
  normalizeContentArtworkTextOverrides,
} from "@/lib/contentArtworkDesign";
import { prisma } from "@/lib/prisma";
import {
  CONTENT_GRAPHIC_TEMPLATE_IDS,
  getContentGraphicTemplate,
  getDefaultTemplateId,
  isDesignableContentAssetType,
  readContentDesignStudioDocument,
  serializeCarouselStudioBody,
  type CarouselStudioSlide,
} from "@/lib/contentGraphicTemplates";
import { getBrandingSettings } from "@/server/branding/settings";
import { readBrandingArtworkLogoDataUrl } from "@/server/branding/artworkLogo";
import { createArtworkBrandFingerprint } from "@/server/branding/artworkBrandFingerprint";
import {
  renderApprovedNonVideoAssets,
  toContentAssetFilePersistenceInput,
} from "@/server/contentAssets/nonVideoAssetRenderer";
import { createAssetRevision } from "@/server/contentRevisionService";
import { recordContentFunnelEvent } from "@/server/contentFunnelTelemetry";
import { validateScriptureReference } from "@/lib/contentIntegrity";

const slideSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  role: z.enum(["COVER", "CONTENT", "CTA"]),
  templateId: z.enum(CONTENT_GRAPHIC_TEMPLATE_IDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1_200),
  scripture: z.string().trim().max(200).nullable(),
  textOverrides: z.unknown().optional(),
});

const contentAssetDesignSchema = z.object({
  assetId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  templateId: z.enum(CONTENT_GRAPHIC_TEMPLATE_IDS),
  bodyContent: z.string().trim().max(20_000).optional(),
  relatedScripture: z.string().trim().max(200).nullable().optional(),
  scriptureAccuracyConfirmed: z.boolean().optional(),
  artwork: z.unknown().optional(),
  textOverrides: z.unknown().optional(),
  slides: z.array(slideSchema).max(10).default([]),
  rerender: z.boolean().default(false),
}).superRefine((value, context) => {
  const ids = value.slides.map((slide) => slide.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["slides"], message: "Every carousel slide needs a unique ID." });
  }
});

export type ContentAssetDesignInput = z.infer<typeof contentAssetDesignSchema>;

export type ContentAssetDesignActionResult = {
  success: boolean;
  message: string;
  contentAssetId?: string;
  renderedFileCount?: number;
};

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function sourceTypeForAsset(assetType: string, sourceType?: string | null): string {
  if (sourceType) return sourceType;
  if (assetType === "CAROUSEL") return "CAROUSEL_IDEA";
  return assetType;
}

export async function saveContentAssetDesignAction(
  input: ContentAssetDesignInput,
): Promise<ContentAssetDesignActionResult> {
  const parsed = contentAssetDesignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `The design could not be saved: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }

  try {
    const asset = await prisma.contentAsset.findUnique({
      where: { id: parsed.data.assetId },
      select: {
        id: true,
        sermonId: true,
        assetType: true,
        status: true,
        title: true,
        bodyContent: true,
        structuredContentJson: true,
        caption: true,
        hashtagsJson: true,
        callToAction: true,
        metadataJson: true,
        currentRevisionId: true,
        approvedRevisionId: true,
        contentOpportunityId: true,
        contentOpportunity: {
          select: {
            opportunityType: true,
            status: true,
            relatedScripture: true,
            scriptureTranslation: true,
            translationReviewState: true,
            sourceTranscriptExcerpt: true,
            approvedRevisionId: true,
          },
        },
      },
    });

    if (!asset || !isDesignableContentAssetType(asset.assetType)) {
      return { success: false, message: "This publishing design could not be found." };
    }
    if (asset.status !== "PREPARED" && asset.status !== "READY") {
      return {
        success: false,
        message: asset.status === "SCHEDULED"
          ? "Remove this post from its schedule before changing the production artwork."
          : asset.status === "PUBLISHED" || asset.status === "ARCHIVED"
            ? "Published or archived artwork is read-only. Create a new asset from the sermon’s Content Ideas instead."
            : "Approve and prepare this content before opening it in Design Studio.",
      };
    }
    if (
      !asset.contentOpportunityId
      || !asset.contentOpportunity
      || (asset.contentOpportunity.status !== "APPROVED" && asset.contentOpportunity.status !== "USED")
    ) {
      return {
        success: false,
        message: "Design Studio can only change assets connected to an approved or used publishing idea.",
      };
    }
    if (!parsed.data.rerender && asset.assetType !== "CAROUSEL" && !parsed.data.bodyContent?.trim()) {
      return { success: false, message: "Graphic copy cannot be empty." };
    }
    if (asset.assetType === "CAROUSEL" && parsed.data.slides.length === 0) {
      return { success: false, message: "A carousel needs at least one slide." };
    }

    const expectedRootRole = getContentGraphicTemplate(
      getDefaultTemplateId({ assetType: asset.assetType }),
    ).role;
    const selectedRootTemplate = getContentGraphicTemplate(parsed.data.templateId);
    if (selectedRootTemplate.role !== expectedRootRole) {
      return {
        success: false,
        message: `The ${selectedRootTemplate.label} template is not compatible with this ${asset.assetType.toLowerCase().replaceAll("_", " ")} asset.`,
      };
    }
    if (asset.assetType === "CAROUSEL") {
      const incompatibleSlideIndex = parsed.data.slides.findIndex((slide) => (
        getContentGraphicTemplate(slide.templateId).role !== slide.role
      ));
      if (incompatibleSlideIndex !== -1) {
        const slide = parsed.data.slides[incompatibleSlideIndex];
        return {
          success: false,
          message: `Slide ${incompatibleSlideIndex + 1} uses a template that is not compatible with its ${slide.role.toLowerCase()} role.`,
        };
      }
    }

    const slides = parsed.data.slides.map((slide): CarouselStudioSlide => ({
      id: slide.id,
      role: slide.role,
      templateId: slide.templateId,
      title: slide.title,
      body: slide.body,
      scripture: slide.scripture,
      ...(slide.textOverrides == null
        ? {}
        : { textOverrides: normalizeContentArtworkTextOverrides(slide.textOverrides) }),
    }));
    const bodyContent = asset.assetType === "CAROUSEL"
      ? serializeCarouselStudioBody(slides)
      : parsed.data.bodyContent?.trim() ?? "";
    const currentMetadata = asMetadataRecord(asset.metadataJson);
    const existingRelatedScripture = Object.prototype.hasOwnProperty.call(currentMetadata, "relatedScripture")
      ? typeof currentMetadata.relatedScripture === "string"
        ? currentMetadata.relatedScripture.trim() || null
        : null
      : asset.contentOpportunity?.relatedScripture || null;
    const relatedScripture = parsed.data.relatedScripture !== undefined
      ? parsed.data.relatedScripture?.trim() || null
      : existingRelatedScripture;
    let renderRelatedScripture = relatedScripture;
    if (asset.assetType === "SCRIPTURE_GRAPHIC" && parsed.data.rerender) {
      if (!asset.contentOpportunity.scriptureTranslation?.trim()) {
        return { success: false, message: "Choose an approved Scripture translation before rendering final artwork." };
      }
      if (asset.contentOpportunity.translationReviewState !== "APPROVED") {
        return { success: false, message: "Confirm the Scripture translation and verse wording in Content Ideas before rendering." };
      }
      if (!parsed.data.scriptureAccuracyConfirmed) {
        return { success: false, message: "Confirm that the edited verse wording and reference match the selected translation." };
      }
      const scripture = validateScriptureReference(relatedScripture);
      if (!scripture.valid || !scripture.normalizedReference) {
        return {
          success: false,
          message: scripture.errors[0] ?? "Enter a valid Bible reference before rendering final artwork.",
        };
      }
      if (
        scripture.version
        && scripture.version !== asset.contentOpportunity.scriptureTranslation.trim().toUpperCase()
      ) {
        return {
          success: false,
          message: `The reference says ${scripture.version}, but this idea was approved as ${asset.contentOpportunity.scriptureTranslation}.`,
        };
      }
      renderRelatedScripture = `${scripture.normalizedReference} (${asset.contentOpportunity.scriptureTranslation.trim().toUpperCase()})`;
    }
    const existingDesign = readContentDesignStudioDocument({
      metadata: currentMetadata,
      assetType: asset.assetType,
      title: asset.title,
      bodyContent: asset.bodyContent,
    });
    const artwork = normalizeContentArtworkSettings(
      parsed.data.artwork ?? existingDesign.artwork,
      parsed.data.templateId,
    );
    const textOverrides = normalizeContentArtworkTextOverrides(
      parsed.data.textOverrides ?? existingDesign.textOverrides,
    );
    const designChanged = parsed.data.title !== asset.title
      || bodyContent !== (asset.bodyContent?.trim() ?? "")
      || relatedScripture !== existingRelatedScripture
      || parsed.data.templateId !== existingDesign.templateId
      || JSON.stringify(artwork) !== JSON.stringify(existingDesign.artwork)
      || JSON.stringify(textOverrides) !== JSON.stringify(existingDesign.textOverrides)
      || JSON.stringify(slides) !== JSON.stringify(existingDesign.slides);

    if (!parsed.data.rerender && !designChanged) {
      return {
        success: true,
        message: "No design changes to save.",
        contentAssetId: asset.id,
        renderedFileCount: 0,
      };
    }
    const updatedAt = new Date();
    let brandSnapshot: Record<string, unknown> | null = null;
    let renderAttemptId: string | null = null;
    let renderedFiles: ReturnType<typeof toContentAssetFilePersistenceInput>[] = [];
    if (parsed.data.rerender) {
      const branding = await getBrandingSettings();
      const logoDataUrl = await readBrandingArtworkLogoDataUrl(branding.churchLogoPath);
      const renderBranding = {
        churchName: branding.churchName,
        primaryColor: branding.primaryBrandColor,
        secondaryColor: branding.secondaryBrandColor,
        fontFamily: branding.defaultFontFamily,
        logoDataUrl,
      };
      renderAttemptId = randomUUID();
      brandSnapshot = {
        churchName: branding.churchName,
        primaryColor: branding.primaryBrandColor,
        secondaryColor: branding.secondaryBrandColor,
        fontFamily: branding.defaultFontFamily,
        logoApplied: Boolean(logoDataUrl && artwork.showLogo),
        fingerprint: createArtworkBrandFingerprint(renderBranding),
        capturedAt: updatedAt.toISOString(),
      };
      const rendered = await renderApprovedNonVideoAssets({
        sermonId: asset.sermonId,
        opportunityId: asset.contentOpportunityId ?? asset.id,
        opportunityType: sourceTypeForAsset(asset.assetType, asset.contentOpportunity?.opportunityType),
        status: asset.contentOpportunity?.status === "USED" ? "USED" : "APPROVED",
        title: parsed.data.title,
        approvedContent: bodyContent,
        sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
        relatedScripture: renderRelatedScripture,
        scriptureTranslation: asset.contentOpportunity.scriptureTranslation,
        scriptureAccuracyConfirmed: parsed.data.scriptureAccuracyConfirmed === true,
        branding: renderBranding,
        templateId: parsed.data.templateId,
        artwork,
        textOverrides,
        carouselSlides: asset.assetType === "CAROUSEL" ? slides : undefined,
      }, {
        storageKey: `design-${renderAttemptId}`,
      });
      renderedFiles = rendered.files.map(toContentAssetFilePersistenceInput);
      if (renderedFiles.length === 0) {
        return { success: false, message: "No production artwork was rendered. Review the design and try again." };
      }
    }

    const metadataJson = {
      ...currentMetadata,
      relatedScripture,
      ...(asset.assetType === "SCRIPTURE_GRAPHIC"
        ? {
            scriptureTranslation: asset.contentOpportunity.scriptureTranslation ?? null,
            scriptureAccuracyConfirmed: parsed.data.rerender
              ? parsed.data.scriptureAccuracyConfirmed === true
              : false,
            scriptureAccuracyConfirmedAt: parsed.data.rerender ? updatedAt.toISOString() : null,
          }
        : {}),
      designStudio: {
        version: 2,
        templateId: parsed.data.templateId,
        templateVersion: 1,
        artwork,
        textOverrides,
        slides,
        brandSnapshot,
        renderAttemptId,
        updatedAt: updatedAt.toISOString(),
        renderRequired: !parsed.data.rerender,
        renderedAt: parsed.data.rerender ? updatedAt.toISOString() : null,
      },
    };

    let designRevisionId: string | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.contentAsset.update({
        where: { id: asset.id },
        data: {
          title: parsed.data.title,
          bodyContent,
          metadataJson,
          status: parsed.data.rerender ? "READY" : "PREPARED",
          approvedAt: parsed.data.rerender ? updatedAt : undefined,
          readyAt: parsed.data.rerender ? updatedAt : null,
          preparedAt: updatedAt,
          files: {
            deleteMany: {},
            ...(parsed.data.rerender ? { create: renderedFiles } : {}),
          },
        },
      });

      const revision = await createAssetRevision(tx, {
        contentAssetId: asset.id,
        sourceOpportunityRevisionId: asset.contentOpportunity?.approvedRevisionId ?? null,
        title: parsed.data.title,
        bodyContent,
        structuredContentJson: asset.structuredContentJson
          ? asset.structuredContentJson as Prisma.InputJsonValue
          : undefined,
        caption: asset.caption,
        hashtagsJson: asset.hashtagsJson
          ? asset.hashtagsJson as Prisma.InputJsonValue
          : undefined,
        callToAction: asset.callToAction,
        metadataJson: metadataJson as Prisma.InputJsonValue,
        approvalState: parsed.data.rerender ? "APPROVED" : "REAPPROVAL_REQUIRED",
        createdBy: parsed.data.rerender ? "design-render" : "design-editor",
        approvedBy: parsed.data.rerender ? "design-render" : null,
        approvedAt: parsed.data.rerender ? updatedAt : null,
        renderedAt: parsed.data.rerender ? updatedAt : null,
      });
      designRevisionId = revision.id;

      await tx.contentAsset.update({
        where: { id: asset.id },
        data: {
          currentRevisionId: revision.id,
          ...(parsed.data.rerender ? { approvedRevisionId: revision.id } : {}),
        },
      });
    });

    await recordContentFunnelEvent({
      eventType: "DESIGN_SAVED",
      sermonId: asset.sermonId,
      opportunityId: asset.contentOpportunityId,
      contentAssetId: asset.id,
      dedupeKey: designRevisionId
        ? `content-design-saved:${designRevisionId}`
        : `content-design-saved:${asset.id}:${updatedAt.getTime()}`,
      metadata: {
        assetType: asset.assetType,
        renderedFileCount: renderedFiles.length,
      },
    });
    if (!parsed.data.rerender) {
      await recordContentFunnelEvent({
        eventType: "REAPPROVAL_REQUIRED",
        sermonId: asset.sermonId,
        opportunityId: asset.contentOpportunityId,
        contentAssetId: asset.id,
        dedupeKey: designRevisionId
          ? `content-reapproval-required:${designRevisionId}`
          : `content-reapproval-required:${asset.id}:${updatedAt.getTime()}`,
        metadata: {
          assetType: asset.assetType,
          fromStatus: asset.status,
          toStatus: "PREPARED",
        },
      });
    }
    if (parsed.data.rerender) {
      await recordContentFunnelEvent({
        eventType: "DESIGN_RENDERED",
        sermonId: asset.sermonId,
        opportunityId: asset.contentOpportunityId,
        contentAssetId: asset.id,
        dedupeKey: designRevisionId
          ? `content-design-rendered:${designRevisionId}`
          : `content-design-rendered:${asset.id}:${updatedAt.getTime()}`,
        metadata: {
          assetType: asset.assetType,
          renderedFileCount: renderedFiles.length,
        },
      });
    }

    revalidatePath("/ready-to-post");
    revalidatePath(`/ready-to-post?contentAssetId=${asset.id}`);
    revalidatePath(`/ready-to-post/content-assets/${asset.id}/studio`);

    return {
      success: true,
      message: parsed.data.rerender
        ? `Design saved and ${renderedFiles.length} production file${renderedFiles.length === 1 ? "" : "s"} rendered.`
        : "Design saved. Rerender it before scheduling so the production files match the latest copy.",
      contentAssetId: asset.id,
      renderedFileCount: renderedFiles.length,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "The publishing design could not be saved.",
    };
  }
}
