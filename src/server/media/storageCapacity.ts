import { lstat, statfs } from "node:fs/promises";
import path from "node:path";

import { getConfiguredStorageRoot } from "@/server/media/portableStoragePath";

export const GIBIBYTE = 1024 ** 3;
const DEFAULT_MINIMUM_FREE_GIB = 8;

export function configuredMinimumFreeBytes(value = process.env.MEDIA_STORAGE_MIN_FREE_GIB): number {
  const parsed = Number(value);
  const gibibytes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINIMUM_FREE_GIB;
  return Math.ceil(gibibytes * GIBIBYTE);
}

export function requiredMediaStorageBytes(incomingBytes: number, reserveBytes = configuredMinimumFreeBytes()): number {
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    throw new Error("Incoming media size must be a non-negative number.");
  }
  return Math.ceil(incomingBytes) + reserveBytes;
}

export function formatGibibytes(bytes: number): string {
  return (bytes / GIBIBYTE).toFixed(1);
}

export function insufficientMediaStorageMessage(input: {
  availableBytes: number;
  incomingBytes: number;
  reserveBytes: number;
}): string {
  const requiredBytes = requiredMediaStorageBytes(input.incomingBytes, input.reserveBytes);
  return [
    "This server does not have enough free media storage for that upload.",
    `It needs ${formatGibibytes(requiredBytes)} GiB free (${formatGibibytes(input.incomingBytes)} GiB for the upload plus a ${formatGibibytes(input.reserveBytes)} GiB safety reserve), but only ${formatGibibytes(input.availableBytes)} GiB is available.`,
    "Run the media retention task or free disk space, then try again.",
  ].join(" ");
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  while (true) {
    if (await lstat(current).catch(() => null)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

export async function getMediaStorageFreeBytes(storageRoot = getConfiguredStorageRoot()): Promise<number> {
  const probe = await nearestExistingPath(storageRoot);
  const filesystem = await statfs(probe);
  return filesystem.bavail * filesystem.bsize;
}

export async function assertMediaStorageCapacity(input: {
  incomingBytes: number;
  storageRoot?: string;
  reserveBytes?: number;
}): Promise<void> {
  const reserveBytes = input.reserveBytes ?? configuredMinimumFreeBytes();
  const availableBytes = await getMediaStorageFreeBytes(input.storageRoot);
  if (availableBytes < requiredMediaStorageBytes(input.incomingBytes, reserveBytes)) {
    throw new Error(insufficientMediaStorageMessage({
      availableBytes,
      incomingBytes: input.incomingBytes,
      reserveBytes,
    }));
  }
}
