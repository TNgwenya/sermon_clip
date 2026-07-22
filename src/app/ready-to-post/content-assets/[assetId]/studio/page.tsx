import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentAssetDesignStudio } from "@/app/ready-to-post/content-assets/[assetId]/studio/studio-experience";
import {
  isDesignableContentAssetType,
  readContentDesignStudioDocument,
} from "@/lib/contentGraphicTemplates";
import { validateScriptureReference } from "@/lib/contentIntegrity";
import { prisma } from "@/lib/prisma";
import {
  createArtworkBrandFingerprint,
  readArtworkBrandFingerprint,
} from "@/server/branding/artworkBrandFingerprint";
import { getBrandingSettings } from "@/server/branding/settings";
import { readBrandingArtworkLogoDataUrl } from "@/server/branding/artworkLogo";

function readMetadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function hasMetadataKey(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, key));
}

function withDisplayedTranslation(reference: string | null, translation: string | null): string | null {
  if (!reference || !translation?.trim()) return reference;
  const validation = validateScriptureReference(reference);
  return validation.versionStatus === "MISSING"
    ? `${reference} (${translation.trim().toUpperCase()})`
    : reference;
}

export default async function ContentAssetStudioPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const [asset, branding] = await Promise.all([
    prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        sermonId: true,
        assetType: true,
        status: true,
        title: true,
        bodyContent: true,
        metadataJson: true,
        updatedAt: true,
        sermon: { select: { title: true } },
        contentOpportunity: {
          select: {
            status: true,
            relatedScripture: true,
            scriptureTranslation: true,
            sourceTranscriptExcerpt: true,
          },
        },
        files: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            width: true,
            height: true,
            sortOrder: true,
            metadataJson: true,
          },
        },
      },
    }),
    getBrandingSettings(),
  ]);

  if (!asset || !isDesignableContentAssetType(asset.assetType)) notFound();
  const logoDataUrl = await readBrandingArtworkLogoDataUrl(branding.churchLogoPath);

  const document = readContentDesignStudioDocument({
    metadata: asset.metadataJson,
    assetType: asset.assetType,
    title: asset.title,
    bodyContent: asset.bodyContent,
  });
  const approvedBrandFingerprint = readArtworkBrandFingerprint(asset.metadataJson);
  const currentBrandFingerprint = createArtworkBrandFingerprint({
    churchName: branding.churchName,
    primaryColor: branding.primaryBrandColor,
    secondaryColor: branding.secondaryBrandColor,
    fontFamily: branding.defaultFontFamily,
    logoDataUrl,
  });
  const relatedScripture = hasMetadataKey(asset.metadataJson, "relatedScripture")
    ? readMetadataString(asset.metadataJson, "relatedScripture")
    : asset.contentOpportunity?.relatedScripture ?? null;
  const displayedRelatedScripture = asset.assetType === "SCRIPTURE_GRAPHIC"
    ? withDisplayedTranslation(
        relatedScripture,
        asset.contentOpportunity?.scriptureTranslation ?? null,
      )
    : relatedScripture;

  return (
    <main className="page-shell stack-lg">
      <header className="page-header">
        <div className="stack-sm">
          <p className="kicker">Content Design Studio</p>
          <h1>{asset.assetType === "CAROUSEL" ? "Build the carousel" : "Create artwork people want to share"}</h1>
          <p className="muted">
            Edit the approved words, choose a distinctive church-branded look, and preview every social size before rendering.
          </p>
        </div>
        <nav className="actions-row" aria-label="Design studio navigation">
          <Link className="button tertiary" href={`/ready-to-post?contentAssetId=${asset.id}`}>Back to Ready to Post</Link>
          <Link className="button secondary" href={`/opportunities?sermonId=${asset.sermonId}`}>View source ideas</Link>
        </nav>
      </header>

      <ContentAssetDesignStudio
        initialAsset={{
          id: asset.id,
          assetType: asset.assetType,
          status: asset.status,
          title: asset.title,
          bodyContent: asset.bodyContent ?? "",
          sermonTitle: asset.sermon.title,
          relatedScripture: displayedRelatedScripture,
          scriptureTranslation: asset.contentOpportunity?.scriptureTranslation ?? null,
          sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt ?? null,
          sourceOpportunityStatus: asset.contentOpportunity?.status ?? null,
          brandingChangedSinceRender: Boolean(
            approvedBrandFingerprint
              && approvedBrandFingerprint !== currentBrandFingerprint,
          ),
          design: document,
          updatedAt: asset.updatedAt.toISOString(),
          files: asset.files.map((file) => ({
            id: file.id,
            fileName: file.fileName,
            mimeType: file.mimeType,
            width: file.width,
            height: file.height,
            sortOrder: file.sortOrder,
          })),
        }}
        branding={{
          churchName: branding.churchName,
          primaryColor: branding.primaryBrandColor,
          secondaryColor: branding.secondaryBrandColor,
          fontFamily: branding.defaultFontFamily,
          logoDataUrl,
        }}
      />
    </main>
  );
}
