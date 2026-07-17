import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  buildHtmlEmailHandoff,
  buildStoryHandoffInstructions,
  buildWhatsAppHandoff,
  selectStoryMediaFiles,
  type HandoffContentAsset,
} from "@/lib/contentHandoffs";
import { normalizeContentHashtags } from "@/lib/contentPublishing";
import { slugifyExportName } from "@/lib/exportNaming";
import { prisma } from "@/lib/prisma";
import { createZipArchive } from "@/lib/zipArchive";
import { getSermonStoragePath } from "@/server/agents/storage";
import {
  isTrustedContentAssetPublicUrl,
  readContentAssetPublicFile,
} from "@/server/contentAssets/contentAssetPublicStorage";

const HANDOFF_FORMATS = ["whatsapp", "story", "email"] as const;
type HandoffFormat = (typeof HANDOFF_FORMATS)[number];

function normalizeFormat(value: string): HandoffFormat | null {
  return HANDOFF_FORMATS.includes(value as HandoffFormat) ? value as HandoffFormat : null;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function loadHandoffAsset(id: string): Promise<HandoffContentAsset | null> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id },
    select: {
      id: true,
      sermonId: true,
      title: true,
      assetType: true,
      status: true,
      bodyContent: true,
      caption: true,
      hashtagsJson: true,
      callToAction: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          churchName: true,
          sermonDate: true,
        },
      },
      files: {
        orderBy: { sortOrder: "asc" },
        select: {
          fileName: true,
          mimeType: true,
          filePath: true,
          publicUrl: true,
          width: true,
          height: true,
        },
      },
    },
  });
  if (!asset || asset.status === "GENERATED" || asset.status === "ARCHIVED") return null;

  return {
    id: asset.id,
    sermonId: asset.sermonId,
    title: asset.title,
    assetType: asset.assetType,
    bodyContent: asset.bodyContent,
    caption: asset.caption,
    hashtags: normalizeContentHashtags(
      Array.isArray(asset.hashtagsJson)
        ? asset.hashtagsJson.filter((item): item is string => typeof item === "string")
        : [],
    ),
    callToAction: asset.callToAction,
    sermon: {
      ...asset.sermon,
      sermonDate: asset.sermon.sermonDate?.toISOString() ?? null,
    },
    files: asset.files,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; format: string }> },
): Promise<NextResponse> {
  const { id, format: rawFormat } = await context.params;
  const format = normalizeFormat(rawFormat);
  if (!format) {
    return NextResponse.json({ error: "Choose a supported handoff format." }, { status: 404 });
  }

  const asset = await loadHandoffAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "This approved content asset is not available for handoff." }, { status: 404 });
  }

  const baseName = slugifyExportName(asset.title, "sermon-content");
  if (format === "whatsapp") {
    return new NextResponse(buildWhatsAppHandoff(asset), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}-whatsapp-pack.txt"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "email") {
    return new NextResponse(buildHtmlEmailHandoff(asset), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}-email.html"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const sermonRoot = getSermonStoragePath(asset.sermonId);
  const entries: Array<{ name: string; data: Buffer | string }> = [
    { name: "README.md", data: buildStoryHandoffInstructions(asset) },
  ];
  const remoteFiles: string[] = [];
  for (const file of selectStoryMediaFiles(asset.files)) {
    const remoteData = isTrustedContentAssetPublicUrl(file.publicUrl)
      ? await readContentAssetPublicFile(file.publicUrl!).catch(() => null)
      : null;
    if (remoteData) {
      entries.push({ name: `story-media/${file.fileName}`, data: remoteData });
    } else if (file.filePath && isPathInside(sermonRoot, file.filePath)) {
      const data = await readFile(file.filePath).catch(() => null);
      if (data) entries.push({ name: `story-media/${file.fileName}`, data });
      else if (file.publicUrl) remoteFiles.push(`${file.fileName}: ${file.publicUrl}`);
    } else if (file.publicUrl) {
      remoteFiles.push(`${file.fileName}: ${file.publicUrl}`);
    }
  }
  if (remoteFiles.length > 0) {
    entries.push({ name: "REMOTE-MEDIA.txt", data: remoteFiles.join("\n") });
  }
  const zip = createZipArchive(entries);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${baseName}-story-pack.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

export const __contentAssetHandoffTestUtils = { isPathInside, normalizeFormat };
