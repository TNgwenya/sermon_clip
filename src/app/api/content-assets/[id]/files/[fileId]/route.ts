import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSermonStoragePath } from "@/server/agents/storage";

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> },
): Promise<NextResponse> {
  const { id, fileId } = await context.params;
  const file = await prisma.contentAssetFile.findFirst({
    where: { id: fileId, contentAssetId: id },
    select: {
      filePath: true,
      publicUrl: true,
      mimeType: true,
      contentAsset: { select: { sermonId: true, status: true } },
    },
  });

  if (!file || ["GENERATED", "ARCHIVED"].includes(file.contentAsset.status)) {
    return NextResponse.json({ error: "This production file is not available." }, { status: 404 });
  }
  if (/^https:\/\//i.test(file.publicUrl?.trim() ?? "")) {
    return NextResponse.redirect(file.publicUrl!.trim());
  }

  const sermonRoot = getSermonStoragePath(file.contentAsset.sermonId);
  if (!file.filePath || !isPathInside(sermonRoot, file.filePath)) {
    return NextResponse.json({ error: "This production file is not available." }, { status: 404 });
  }

  const bytes = await readFile(file.filePath).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: "The production file needs to be rendered again." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const __contentAssetFileRouteTestUtils = { isPathInside };
