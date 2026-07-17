import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getContentAsset } from "@/lib/contentAssets";
import { slugifyExportName } from "@/lib/exportNaming";
import { createZipArchive } from "@/lib/zipArchive";
import { getSermonStoragePath } from "@/server/agents/storage";
import {
  isTrustedContentAssetPublicUrl,
  readContentAssetPublicFile,
} from "@/server/contentAssets/contentAssetPublicStorage";

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const asset = await getContentAsset(id);

  if (!asset || asset.status === "GENERATED" || asset.status === "ARCHIVED") {
    return NextResponse.json({ error: "This prepared content asset is not available." }, { status: 404 });
  }

  const sermonRoot = getSermonStoragePath(asset.sermonId);
  const entries: Array<{ name: string; data: Buffer | string }> = [];
  const remoteFiles: string[] = [];

  for (const file of asset.files) {
    const remoteData = isTrustedContentAssetPublicUrl(file.publicUrl)
      ? await readContentAssetPublicFile(file.publicUrl!).catch(() => null)
      : null;
    if (remoteData) {
      entries.push({ name: `media/${file.fileName}`, data: remoteData });
    } else if (file.filePath && isPathInside(sermonRoot, file.filePath)) {
      const data = await readFile(file.filePath).catch(() => null);
      if (data) entries.push({ name: `media/${file.fileName}`, data });
      else if (file.publicUrl) remoteFiles.push(`${file.fileName}: ${file.publicUrl}`);
    } else if (file.publicUrl) {
      remoteFiles.push(`${file.fileName}: ${file.publicUrl}`);
    }
  }

  const manifest = [
    `# ${asset.title}`,
    "",
    `Type: ${asset.assetType}`,
    `Status: ${asset.status}`,
    `Platform: ${asset.platform ?? "Manual handoff"}`,
    "",
    asset.bodyContent ?? "",
    "",
    asset.caption ? `Caption:\n${asset.caption}` : "",
    asset.callToAction ? `Call to action:\n${asset.callToAction}` : "",
    remoteFiles.length > 0 ? `Remote files:\n${remoteFiles.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  entries.unshift({ name: "README.md", data: manifest });

  const zip = createZipArchive(entries);
  const fileName = `${slugifyExportName(asset.title, "content-asset")}-publishing-asset.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export const __contentAssetDownloadTestUtils = { isPathInside };
