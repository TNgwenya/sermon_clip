import { stat, unlink } from "node:fs/promises";

export type PromotedMediaIdentity = {
  device: number;
  inode: number;
  sizeBytes: number;
  modifiedAtMs: number;
};

export async function capturePromotedMediaIdentity(
  filePath: string,
): Promise<PromotedMediaIdentity> {
  const fileStat = await stat(/* turbopackIgnore: true */ filePath);
  return {
    device: fileStat.dev,
    inode: fileStat.ino,
    sizeBytes: fileStat.size,
    modifiedAtMs: fileStat.mtimeMs,
  };
}

function isSamePromotedFile(
  current: PromotedMediaIdentity,
  expected: PromotedMediaIdentity,
): boolean {
  return current.device === expected.device
    && current.inode === expected.inode
    && current.sizeBytes === expected.sizeBytes
    && current.modifiedAtMs === expected.modifiedAtMs;
}

/**
 * Removes a stale promoted file only when the canonical path still points to
 * that exact filesystem object. A newer job can safely replace the path before
 * an older job reaches cleanup without having its output deleted.
 */
export async function discardPromotedMediaIfUnchanged(
  filePath: string,
  expected: PromotedMediaIdentity,
): Promise<boolean> {
  const current = await capturePromotedMediaIdentity(filePath).catch(() => null);
  if (!current || !isSamePromotedFile(current, expected)) {
    return false;
  }

  try {
    await unlink(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

export const __mediaPromotionGuardTestUtils = {
  isSamePromotedFile,
};
