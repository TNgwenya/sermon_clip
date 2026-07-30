import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  isPathInsideRoot,
  resolveAvailableBrandingLogoPath,
} from "@/server/branding/logoStorage";
import { loadPublicSermonLogoPath } from "@/server/publicSermon/publicSermonService";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  const storedPath = await loadPublicSermonLogoPath(slug);
  const logoPath = await resolveAvailableBrandingLogoPath(storedPath);
  if (!logoPath || !isPathInsideRoot(path.dirname(logoPath), logoPath)) {
    return NextResponse.json({ error: "Church logo not found." }, { status: 404 });
  }
  const extension = path.extname(logoPath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  const bytes = contentType ? await readFile(logoPath).catch(() => null) : null;
  if (!bytes) {
    return NextResponse.json({ error: "Church logo not found." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Disposition": `inline; filename="church-logo${extension}"`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
