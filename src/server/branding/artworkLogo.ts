import { stat } from "node:fs/promises";

import sharp from "sharp";

import { resolveAvailableBrandingLogoPath } from "@/server/branding/logoStorage";

const MAX_SOURCE_LOGO_BYTES = 8 * 1024 * 1024;

/**
 * Converts the managed church logo to a small, rasterized data URL that can be
 * embedded identically in the browser preview and Sharp's final SVG render.
 */
export async function readBrandingArtworkLogoDataUrl(
  configuredPath: string | null | undefined,
): Promise<string | null> {
  const availablePath = await resolveAvailableBrandingLogoPath(configuredPath);
  if (!availablePath) return null;

  try {
    const sourceStat = await stat(availablePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > MAX_SOURCE_LOGO_BYTES) {
      return null;
    }
    const rasterized = await sharp(availablePath, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize({
        width: 420,
        height: 160,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, quality: 92 })
      .toBuffer();
    return rasterized.length > 0
      ? `data:image/png;base64,${rasterized.toString("base64")}`
      : null;
  } catch {
    return null;
  }
}
