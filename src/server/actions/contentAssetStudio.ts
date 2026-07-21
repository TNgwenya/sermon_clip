"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  CONTENT_GRAPHIC_TEMPLATE_IDS,
  isDesignableContentAssetType,
  readContentDesignStudioDocument,
  serializeCarouselStudioBody,
  type CarouselStudioSlide,
} from "@/lib/contentGraphicTemplates";
import { getBrandingSettings } from "@/server/branding/settings";
import {
  renderApprovedNonVideoAssets,
  toContentAssetFilePersistenceInput,
} from "@/server/contentAssets/nonVideoAssetRenderer";

const slideSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  role: z.enum(["COVER", "CONTENT", "CTA"]),
  templateId: z.enum(CONTENT_GRAPHIC_TEMPLATE_IDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1_200),
  scripture: z.string().trim().max(200).nullable(),
});

const contentAssetDesignSchema = z.object({
  assetId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  templateId: z.enum(CONTENT_GRAPHIC_TEMPLATE_IDS),
  bodyContent: z.string().trim().max(20_000).optional(),
  relatedScripture: z.string().trim().max(200).nullable().optional(),
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
        metadataJson: true,
        contentOpportunityId: true,
        contentOpportunity: {
          select: {
            opportunityType: true,
            status: true,
            relatedScripture: true,
            sourceTranscriptExcerpt: true,
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

    const slides = parsed.data.slides as CarouselStudioSlide[];
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
    const existingDesign = readContentDesignStudioDocument({
      metadata: currentMetadata,
      assetType: asset.assetType,
      title: asset.title,
      bodyContent: asset.bodyContent,
    });
    const designChanged = parsed.data.title !== asset.title
      || bodyContent !== (asset.bodyContent?.trim() ?? "")
      || relatedScripture !== existingRelatedScripture
      || parsed.data.templateId !== existingDesign.templateId
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
    const metadataJson = {
      ...currentMetadata,
      relatedScripture,
      designStudio: {
        version: 1,
        templateId: parsed.data.templateId,
        slides,
        updatedAt: updatedAt.toISOString(),
        renderRequired: !parsed.data.rerender,
        renderedAt: parsed.data.rerender ? updatedAt.toISOString() : null,
      },
    };

    let renderedFiles: ReturnType<typeof toContentAssetFilePersistenceInput>[] = [];
    if (parsed.data.rerender) {
      const branding = await getBrandingSettings();
      const rendered = await renderApprovedNonVideoAssets({
        sermonId: asset.sermonId,
        opportunityId: asset.contentOpportunityId ?? asset.id,
        opportunityType: sourceTypeForAsset(asset.assetType, asset.contentOpportunity?.opportunityType),
        status: asset.contentOpportunity?.status === "USED" ? "USED" : "APPROVED",
        title: parsed.data.title,
        approvedContent: bodyContent,
        sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
        relatedScripture,
        branding: {
          churchName: branding.churchName,
          primaryColor: branding.primaryBrandColor,
          secondaryColor: branding.secondaryBrandColor,
          fontFamily: branding.defaultFontFamily,
        },
        templateId: parsed.data.templateId,
        carouselSlides: asset.assetType === "CAROUSEL" ? slides : undefined,
      });
      renderedFiles = rendered.files.map(toContentAssetFilePersistenceInput);
      if (renderedFiles.length === 0) {
        return { success: false, message: "No production artwork was rendered. Review the design and try again." };
      }
    }

    await prisma.contentAsset.update({
      where: { id: asset.id },
      data: {
        title: parsed.data.title,
        bodyContent,
        metadataJson,
        status: parsed.data.rerender ? "READY" : "PREPARED",
        readyAt: parsed.data.rerender ? updatedAt : null,
        preparedAt: updatedAt,
        files: {
          deleteMany: {},
          ...(parsed.data.rerender ? { create: renderedFiles } : {}),
        },
      },
    });

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
