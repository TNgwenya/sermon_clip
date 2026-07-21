import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentAssetDesignStudio } from "@/app/ready-to-post/content-assets/[assetId]/studio/studio-experience";
import {
  isDesignableContentAssetType,
  readContentDesignStudioDocument,
} from "@/lib/contentGraphicTemplates";
import { prisma } from "@/lib/prisma";
import { getBrandingSettings } from "@/server/branding/settings";

function readMetadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function hasMetadataKey(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, key));
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
          select: { status: true, relatedScripture: true, sourceTranscriptExcerpt: true },
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

  const document = readContentDesignStudioDocument({
    metadata: asset.metadataJson,
    assetType: asset.assetType,
    title: asset.title,
    bodyContent: asset.bodyContent,
  });
  const relatedScripture = hasMetadataKey(asset.metadataJson, "relatedScripture")
    ? readMetadataString(asset.metadataJson, "relatedScripture")
    : asset.contentOpportunity?.relatedScripture ?? null;

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
          relatedScripture,
          sourceTranscriptExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt ?? null,
          sourceOpportunityStatus: asset.contentOpportunity?.status ?? null,
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
        }}
      />
    </main>
  );
}
