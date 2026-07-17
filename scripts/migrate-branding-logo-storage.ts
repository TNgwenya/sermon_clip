import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/prisma.ts";
import { getConfiguredStorageRoot } from "../src/server/media/portableStoragePath.ts";

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function main(): Promise<void> {
  const stageOnly = process.argv.includes("--stage-only");
  const apply = process.argv.includes("--apply");
  if (stageOnly && apply) {
    throw new Error("Choose either --stage-only or --apply, not both.");
  }

  const settings = await prisma.brandingSettings.findUnique({
    where: { id: "local" },
    select: { churchLogoPath: true },
  });
  const currentPath = settings?.churchLogoPath?.trim();
  if (!currentPath) {
    console.log(JSON.stringify({ status: "no-logo-configured", filesModified: false, databaseModified: false }, null, 2));
    return;
  }

  const storageRoot = getConfiguredStorageRoot();
  const brandingRoot = path.join(storageRoot, "branding");
  if (isInside(brandingRoot, currentPath)) {
    console.log(JSON.stringify({ status: "already-portable", filesModified: false, databaseModified: false }, null, 2));
    return;
  }
  if (!path.isAbsolute(currentPath) || !(await stat(currentPath).catch(() => null))?.isFile()) {
    throw new Error("The configured branding logo is not a readable local file.");
  }

  const extension = path.extname(currentPath).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(extension)) {
    throw new Error("The configured branding logo has an unsupported file type.");
  }
  const bytes = await readFile(currentPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const destination = path.join(brandingRoot, `church-logo-${sha256.slice(0, 16)}${extension}`);
  const mode = apply ? "apply" : stageOnly ? "stage-only" : "dry-run";

  if (stageOnly || apply) {
    await mkdir(brandingRoot, { recursive: true });
    const existing = await access(destination).then(() => true).catch(() => false);
    if (!existing) {
      await copyFile(currentPath, destination, constants.COPYFILE_EXCL);
    }
    const copiedHash = createHash("sha256").update(await readFile(destination)).digest("hex");
    if (copiedHash !== sha256) {
      throw new Error("The staged branding logo failed its SHA-256 verification.");
    }
  }

  if (apply) {
    await prisma.brandingSettings.update({
      where: { id: "local" },
      data: { churchLogoPath: destination },
    });
  }

  console.log(JSON.stringify({
    status: mode,
    sourceFileName: path.basename(currentPath),
    destination,
    sha256,
    filesModified: stageOnly || apply,
    databaseModified: apply,
    originalDeleted: false,
    nextCommand: stageOnly
      ? "Run again with --apply only after the portable-path code is deployed."
      : (!apply ? "Use --stage-only to copy without changing the live database." : null),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
