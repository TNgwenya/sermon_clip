import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getBrandingSettings } from "@/server/branding/settings";
import {
  isPathInsideRoot,
  resolveAvailableBrandingLogoPath,
} from "@/server/branding/logoStorage";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(): Promise<NextResponse> {
  const settings = await getBrandingSettings().catch(() => null);
  const logoPath = await resolveAvailableBrandingLogoPath(settings?.churchLogoPath);
  if (!logoPath) {
    return NextResponse.json({ error: "Branding logo is not available." }, { status: 404 });
  }

  const extension = path.extname(logoPath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  const bytes = contentType ? await readFile(logoPath).catch(() => null) : null;
  if (!bytes) {
    return NextResponse.json({ error: "Branding logo file is missing." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="church-logo${extension}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const __brandingLogoRouteTestUtils = { isInside: isPathInsideRoot };
