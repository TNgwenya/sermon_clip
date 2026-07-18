import { stat } from "node:fs/promises";
import path from "node:path";

import { getConfiguredStorageRoot } from "@/server/media/portableStoragePath";

const SUPPORTED_LOGO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".svg", ".webp"]);

export function isPathInsideRoot(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function isManagedBrandingLogoPath(filePath: string): boolean {
  if (!path.isAbsolute(filePath) || !SUPPORTED_LOGO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return false;
  }

  const legacyBrandingRoot = path.join(process.cwd(), "public", "uploads", "branding");
  const durableBrandingRoot = path.join(getConfiguredStorageRoot(), "branding");
  return isPathInsideRoot(legacyBrandingRoot, filePath) || isPathInsideRoot(durableBrandingRoot, filePath);
}

export async function resolveAvailableBrandingLogoPath(value: string | null | undefined): Promise<string | null> {
  const filePath = value?.trim() ?? "";
  if (!filePath || !isManagedBrandingLogoPath(filePath)) {
    return null;
  }

  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0 ? filePath : null;
  } catch {
    return null;
  }
}
