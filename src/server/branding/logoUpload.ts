import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const logoUploadMimeTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
]);

export const maxLogoUploadBytes = 5 * 1024 * 1024;

type SaveLogoUploadOptions = {
  now?: () => number;
  uploadDirectory?: string;
};

export function getLogoUpload(formData: FormData): File | null {
  const upload = formData.get("churchLogoFile");
  if (!(upload instanceof File) || upload.size === 0) {
    return null;
  }

  return upload;
}

export async function saveLogoUpload(
  upload: File,
  options: SaveLogoUploadOptions = {},
): Promise<{ path?: string; error?: string }> {
  if (upload.size > maxLogoUploadBytes) {
    return { error: "Logo must be 5MB or smaller." };
  }

  const extension = logoUploadMimeTypes.get(upload.type);
  if (!extension) {
    return { error: "Upload a PNG, JPG, WebP, or SVG logo." };
  }

  const uploadDirectory = options.uploadDirectory ?? join(process.cwd(), "public", "uploads", "branding");
  const fileName = `church-logo-${options.now?.() ?? Date.now()}${extension}`;
  const filePath = join(uploadDirectory, fileName);
  const bytes = Buffer.from(await upload.arrayBuffer());

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(filePath, bytes);

  return { path: filePath };
}
