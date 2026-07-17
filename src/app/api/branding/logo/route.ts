import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getBrandingSettings } from "@/server/branding/settings";
import { getConfiguredStorageRoot } from "@/server/media/portableStoragePath";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function GET(): Promise<NextResponse> {
  const settings = await getBrandingSettings().catch(() => null);
  const logoPath = settings?.churchLogoPath?.trim();
  if (!logoPath || !path.isAbsolute(logoPath)) {
    return NextResponse.json({ error: "Branding logo is not available." }, { status: 404 });
  }

  const legacyBrandingRoot = path.join(process.cwd(), "public", "uploads", "branding");
  const durableBrandingRoot = path.join(getConfiguredStorageRoot(), "branding");
  if (!isInside(legacyBrandingRoot, logoPath) && !isInside(durableBrandingRoot, logoPath)) {
    return NextResponse.json({ error: "Branding logo path is outside managed storage." }, { status: 404 });
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

export const __brandingLogoRouteTestUtils = { isInside };
