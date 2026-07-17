import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { getSermonStoragePath } from "@/server/agents/storage";
import { getBrandingSettings } from "@/server/branding/settings";
import {
  isContentAssetDurableStorageRequired,
  isContentAssetPublicStorageConfigured,
  isTrustedContentAssetPublicUrl,
  uploadContentAssetFileToR2,
} from "@/server/contentAssets/contentAssetPublicStorage";
import { renderContentGuidePdf } from "@/server/contentAssets/guidePdfRenderer";

const PDF_ELIGIBLE_TYPES = new Set(["DEVOTIONAL", "PRAYER", "DISCUSSION", "GUIDE", "SERMON_RECAP"]);
const GUIDE_PDF_SORT_ORDER = 10_000;
const guidePdfGenerations = new Map<string, Promise<GeneratedGuidePdf>>();

export type GeneratedGuidePdf = {
  path: string | null;
  publicUrl: string | null;
  objectKey: string | null;
  fileName: string;
  sizeBytes: number;
};

type PersistGeneratedGuidePdfInput = {
  assetId: string;
  existingFileId?: string | null;
  fileName: string;
  path: string;
  sizeBytes: number;
};

export function getGuidePdfOutputPath(sermonId: string, assetId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sermonId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetId)) {
    throw new Error("Invalid content asset identifier for PDF storage.");
  }
  return path.join(getSermonStoragePath(sermonId), "content-assets", assetId, "ministry-guide.pdf");
}

function getGuidePdfGenerationOutputPath(sermonId: string, assetId: string): string {
  const localOutputPath = getGuidePdfOutputPath(sermonId, assetId);
  return process.env.VERCEL
    ? path.join(os.tmpdir(), "sermon-clip-content-assets", sermonId, assetId, "ministry-guide.pdf")
    : localOutputPath;
}

function buildGuidePdfWorkingPaths(outputPath: string): { stagedOutputPath: string } {
  const requestId = randomUUID();
  const workingDirectory = path.dirname(outputPath);
  return {
    stagedOutputPath: path.join(workingDirectory, `.ministry-guide-${requestId}.pdf`),
  };
}

export async function persistGeneratedGuidePdf(
  input: PersistGeneratedGuidePdfInput,
): Promise<GeneratedGuidePdf> {
  const fileId = input.existingFileId ?? randomUUID();
  const durableStorageConfigured = isContentAssetPublicStorageConfigured();
  if (!durableStorageConfigured && isContentAssetDurableStorageRequired()) {
    throw new Error(
      "Durable content-asset storage is required in this deployment. Configure R2 before generating guide PDFs.",
    );
  }
  const uploaded = durableStorageConfigured
    ? await uploadContentAssetFileToR2({
        contentAssetId: input.assetId,
        fileId,
        fileName: input.fileName,
        filePath: input.path,
        mimeType: "application/pdf",
      })
    : null;

  const fileData = {
    fileName: input.fileName,
    mimeType: "application/pdf",
    filePath: input.path,
    objectKey: uploaded?.objectKey ?? null,
    publicUrl: uploaded?.publicUrl ?? null,
    width: null,
    height: null,
    sizeBytes: BigInt(uploaded?.sizeBytes ?? input.sizeBytes),
    sortOrder: GUIDE_PDF_SORT_ORDER,
    metadataJson: {
      kind: "MINISTRY_GUIDE_PDF",
      durable: Boolean(uploaded),
      ...(uploaded ? { uploadedAt: uploaded.uploadedAt.toISOString() } : {}),
    },
  };
  await prisma.contentAssetFile.upsert({
    where: {
      contentAssetId_sortOrder: {
        contentAssetId: input.assetId,
        sortOrder: GUIDE_PDF_SORT_ORDER,
      },
    },
    create: {
      id: fileId,
      contentAssetId: input.assetId,
      ...fileData,
    },
    update: fileData,
  });

  return {
    path: input.path,
    publicUrl: uploaded?.publicUrl ?? null,
    objectKey: uploaded?.objectKey ?? null,
    fileName: input.fileName,
    sizeBytes: uploaded?.sizeBytes ?? input.sizeBytes,
  };
}

async function generateContentAssetGuidePdfOnce(
  assetId: string,
  forceRegeneration = false,
): Promise<GeneratedGuidePdf> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      sermonId: true,
      assetType: true,
      status: true,
      title: true,
      bodyContent: true,
      updatedAt: true,
      contentOpportunity: { select: { relatedScripture: true, shortDescription: true } },
      files: {
        where: { sortOrder: GUIDE_PDF_SORT_ORDER },
        take: 1,
        select: {
          id: true,
          fileName: true,
          filePath: true,
          objectKey: true,
          publicUrl: true,
          sizeBytes: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!asset || asset.status === "GENERATED" || asset.status === "ARCHIVED") {
    throw new Error("Approve and prepare this guide before creating its PDF.");
  }
  if (!PDF_ELIGIBLE_TYPES.has(asset.assetType)) {
    throw new Error("This content type is not a ministry-guide PDF.");
  }

  const existingFile = asset.files[0];
  const existingIsCurrent = Boolean(
    existingFile && existingFile.updatedAt.getTime() >= asset.updatedAt.getTime(),
  );
  if (!forceRegeneration && existingIsCurrent && isTrustedContentAssetPublicUrl(existingFile?.publicUrl)) {
    return {
      path: existingFile?.filePath ?? null,
      publicUrl: existingFile?.publicUrl ?? null,
      objectKey: existingFile?.objectKey ?? null,
      fileName: existingFile?.fileName ?? "ministry-guide.pdf",
      sizeBytes: Number(existingFile?.sizeBytes ?? 0),
    };
  }
  if (!forceRegeneration && existingIsCurrent && existingFile?.filePath) {
    const cachedStat = await stat(existingFile.filePath).catch(() => null);
    if (cachedStat?.isFile() && cachedStat.size > 0) {
      if (isContentAssetPublicStorageConfigured()) {
        return persistGeneratedGuidePdf({
          assetId: asset.id,
          existingFileId: existingFile.id,
          fileName: existingFile.fileName,
          path: existingFile.filePath,
          sizeBytes: cachedStat.size,
        });
      }
      return {
        path: existingFile.filePath,
        publicUrl: null,
        objectKey: null,
        fileName: existingFile.fileName,
        sizeBytes: cachedStat.size,
      };
    }
  }

  const branding = await getBrandingSettings();
  const outputPath = getGuidePdfGenerationOutputPath(asset.sermonId, asset.id);
  const workingDirectory = path.dirname(outputPath);
  const { stagedOutputPath } = buildGuidePdfWorkingPaths(outputPath);
  await mkdir(workingDirectory, { recursive: true });

  try {
    const pdfBytes = await renderContentGuidePdf({
      churchName: branding.churchName,
      primaryColor: branding.primaryBrandColor,
      secondaryColor: branding.secondaryBrandColor,
      title: asset.title,
      subtitle: asset.contentOpportunity?.shortDescription ?? "A sermon-grounded ministry resource",
      scripture: asset.contentOpportunity?.relatedScripture ?? "",
      bodyContent: asset.bodyContent ?? "",
    });
    await writeFile(stagedOutputPath, pdfBytes);
    // Staging in the destination directory keeps finalization on one
    // filesystem. Readers therefore see either the previous complete PDF or
    // this complete PDF, never a partially rendered file.
    await rename(stagedOutputPath, outputPath);
  } finally {
    await unlink(stagedOutputPath).catch(() => undefined);
  }
  const fileStat = await stat(outputPath);
  const fileName = `${asset.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "ministry-guide"}.pdf`;
  return persistGeneratedGuidePdf({
    assetId: asset.id,
    existingFileId: existingFile?.id,
    fileName,
    path: outputPath,
    sizeBytes: fileStat.size,
  });
}

export function generateContentAssetGuidePdf(
  assetId: string,
  options: { forceRegeneration?: boolean } = {},
): Promise<GeneratedGuidePdf> {
  const generationKey = `${assetId}:${options.forceRegeneration ? "force" : "cached"}`;
  const activeGeneration = guidePdfGenerations.get(generationKey);
  if (activeGeneration) return activeGeneration;

  const generation = generateContentAssetGuidePdfOnce(assetId, options.forceRegeneration).finally(() => {
    if (guidePdfGenerations.get(generationKey) === generation) {
      guidePdfGenerations.delete(generationKey);
    }
  });
  guidePdfGenerations.set(generationKey, generation);
  return generation;
}

export const __guidePdfServiceTestUtils = {
  PDF_ELIGIBLE_TYPES,
  GUIDE_PDF_SORT_ORDER,
  buildGuidePdfWorkingPaths,
  getGuidePdfGenerationOutputPath,
};
