import { open } from "node:fs/promises";

import type { PostingPlatform } from "@/lib/postingDrafts";
import { selectContentPublishingFiles } from "@/lib/contentPublishingPreflight";
import {
  buildContentAssetPublicUrl,
  isTrustedContentAssetPublicUrl,
  probeContentAssetPublicFile,
} from "@/server/contentAssets/contentAssetPublicStorage";
import { resolvePortableStoragePath } from "@/server/media/portableStoragePath";

export type ContentAssetMediaReadinessStatus = "READY" | "BLOCKED";
export type ContentAssetMediaLocation = "PUBLIC_URL" | "LOCAL_FILE" | "OBJECT_KEY";

export type ContentAssetMediaProbeReason =
  | "READABLE_BYTES"
  | "NOT_HTTPS"
  | "UNTRUSTED_PUBLIC_URL"
  | "INVALID_OBJECT_KEY"
  | "UNRESOLVABLE_OBJECT_KEY"
  | "UNREADABLE_LOCATION"
  | "EMPTY_LOCATION";

export type ContentAssetMediaFileReason =
  | "PUBLIC_URL_READABLE"
  | "LOCAL_FILE_READABLE"
  | "OBJECT_KEY_READABLE"
  | "PUBLIC_URL_NOT_HTTPS"
  | "PUBLIC_URL_UNTRUSTED"
  | "PUBLIC_URL_UNREADABLE"
  | "PUBLIC_URL_EMPTY"
  | "NO_MEDIA_LOCATION"
  | "NO_READABLE_MEDIA_BYTES";

export type ContentAssetMediaReadinessReason =
  | "SELECTED_FILES_READY"
  | "NO_PUBLISHING_FILES"
  | "PUBLISHING_FILE_UNAVAILABLE";

export type ContentAssetMediaReadinessFile = {
  id: string;
  fileName: string;
  mimeType: string;
  filePath?: string | null;
  objectKey?: string | null;
  publicUrl?: string | null;
  sizeBytes?: number | bigint | null;
  sortOrder?: number | null;
};

export type ContentAssetMediaProbeAttempt = {
  location: ContentAssetMediaLocation;
  status: ContentAssetMediaReadinessStatus;
  reason: ContentAssetMediaProbeReason;
};

export type ContentAssetMediaFileReadiness = {
  id: string;
  fileName: string;
  status: ContentAssetMediaReadinessStatus;
  reason: ContentAssetMediaFileReason;
  message: string;
  source: ContentAssetMediaLocation | null;
  byteLength: number | null;
  effectivePublicUrl: string | null;
  attempts: ContentAssetMediaProbeAttempt[];
};

export type ContentAssetMediaReadinessResult = {
  status: ContentAssetMediaReadinessStatus;
  reason: ContentAssetMediaReadinessReason;
  message: string;
  selectedFileIds: string[];
  files: ContentAssetMediaFileReadiness[];
};

export type ContentAssetMediaReadinessDependencies = {
  probeLocalFile(filePath: string): Promise<{ byteLength: number }>;
  probePublicUrl(publicUrl: string): Promise<{ byteLength: number }>;
  publicUrlFromObjectKey(objectKey: string): string;
  isTrustedPublicUrl(publicUrl: string): boolean;
};

const readyAttempt = (location: ContentAssetMediaLocation): ContentAssetMediaProbeAttempt => ({
  location,
  status: "READY",
  reason: "READABLE_BYTES",
});

function blockedAttempt(
  location: ContentAssetMediaLocation,
  reason: Exclude<ContentAssetMediaProbeReason, "READABLE_BYTES">,
): ContentAssetMediaProbeAttempt {
  return { location, status: "BLOCKED", reason };
}

function cleanLocation(value: string | null | undefined): string | null {
  const clean = value?.trim() ?? "";
  return clean || null;
}

function usableByteLength(value: number): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

export function isContentAssetPublishingObjectKey(value: string): boolean {
  const clean = value.trim();
  if (!clean.startsWith("content-assets/") || clean.includes("\\")) return false;
  const segments = clean.split("/");
  return segments.length >= 4
    && segments[2] === "publishing"
    && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

export async function probeReadableLocalContentAssetFile(filePath: string): Promise<{ byteLength: number }> {
  const resolvedPath = resolvePortableStoragePath(filePath);
  const handle = await open(resolvedPath, "r");
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size <= 0) return { byteLength: 0 };

    const firstByte = Buffer.alloc(1);
    const { bytesRead } = await handle.read(firstByte, 0, 1, 0);
    return { byteLength: bytesRead > 0 ? fileStat.size : 0 };
  } finally {
    await handle.close();
  }
}

const defaultDependencies: ContentAssetMediaReadinessDependencies = {
  probeLocalFile: probeReadableLocalContentAssetFile,
  probePublicUrl: probeContentAssetPublicFile,
  publicUrlFromObjectKey: buildContentAssetPublicUrl,
  isTrustedPublicUrl: isTrustedContentAssetPublicUrl,
};

export function selectContentAssetMediaForReadiness<T extends ContentAssetMediaReadinessFile>(input: {
  assetType: string;
  platform: PostingPlatform | null;
  files: T[];
}): T[] {
  const orderedFiles = [...input.files].sort((left, right) => {
    const orderDifference = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
    return orderDifference || left.id.localeCompare(right.id);
  });

  const selectionCandidates = orderedFiles.map((record) => ({
    record,
    fileName: record.fileName,
    mimeType: record.mimeType,
    publicUrl: record.publicUrl,
    sizeBytes: typeof record.sizeBytes === "bigint" ? Number(record.sizeBytes) : record.sizeBytes,
  }));

  return selectContentPublishingFiles({
    assetType: input.assetType,
    platform: input.platform,
    files: selectionCandidates,
  }).map((candidate) => candidate.record);
}

function readyFile(input: {
  file: ContentAssetMediaReadinessFile;
  reason: Extract<ContentAssetMediaFileReason, `${string}_READABLE`>;
  source: ContentAssetMediaLocation;
  byteLength: number;
  effectivePublicUrl?: string | null;
  attempts: ContentAssetMediaProbeAttempt[];
}): ContentAssetMediaFileReadiness {
  return {
    id: input.file.id,
    fileName: input.file.fileName,
    status: "READY",
    reason: input.reason,
    message: `${input.file.fileName} has readable publishing bytes.`,
    source: input.source,
    byteLength: input.byteLength,
    effectivePublicUrl: input.effectivePublicUrl ?? null,
    attempts: input.attempts,
  };
}

function blockedFile(input: {
  file: ContentAssetMediaReadinessFile;
  reason: Exclude<ContentAssetMediaFileReason, `${string}_READABLE`>;
  message: string;
  attempts: ContentAssetMediaProbeAttempt[];
}): ContentAssetMediaFileReadiness {
  return {
    id: input.file.id,
    fileName: input.file.fileName,
    status: "BLOCKED",
    reason: input.reason,
    message: input.message,
    source: null,
    byteLength: null,
    effectivePublicUrl: null,
    attempts: input.attempts,
  };
}

async function probeSelectedFile(
  file: ContentAssetMediaReadinessFile,
  dependencies: ContentAssetMediaReadinessDependencies,
): Promise<ContentAssetMediaFileReadiness> {
  const attempts: ContentAssetMediaProbeAttempt[] = [];
  const publicUrl = cleanLocation(file.publicUrl);

  // The posting worker treats any stored public URL as authoritative and skips
  // local staging. Do the same here so a stale URL cannot pass on local bytes
  // that the worker will never use.
  if (publicUrl) {
    if (!/^https:\/\//i.test(publicUrl)) {
      attempts.push(blockedAttempt("PUBLIC_URL", "NOT_HTTPS"));
      return blockedFile({
        file,
        reason: "PUBLIC_URL_NOT_HTTPS",
        message: `${file.fileName} has a public URL that is not HTTPS.`,
        attempts,
      });
    }
    if (!dependencies.isTrustedPublicUrl(publicUrl)) {
      attempts.push(blockedAttempt("PUBLIC_URL", "UNTRUSTED_PUBLIC_URL"));
      return blockedFile({
        file,
        reason: "PUBLIC_URL_UNTRUSTED",
        message: `${file.fileName} is not stored on the configured public media origin.`,
        attempts,
      });
    }

    try {
      const probe = await dependencies.probePublicUrl(publicUrl);
      if (usableByteLength(probe.byteLength)) {
        attempts.push(readyAttempt("PUBLIC_URL"));
        return readyFile({
          file,
          reason: "PUBLIC_URL_READABLE",
          source: "PUBLIC_URL",
          byteLength: probe.byteLength,
          effectivePublicUrl: publicUrl,
          attempts,
        });
      }
      attempts.push(blockedAttempt("PUBLIC_URL", "EMPTY_LOCATION"));
      return blockedFile({
        file,
        reason: "PUBLIC_URL_EMPTY",
        message: `${file.fileName} has a public URL, but it serves no bytes.`,
        attempts,
      });
    } catch {
      attempts.push(blockedAttempt("PUBLIC_URL", "UNREADABLE_LOCATION"));
      return blockedFile({
        file,
        reason: "PUBLIC_URL_UNREADABLE",
        message: `${file.fileName} cannot be read from its public media URL.`,
        attempts,
      });
    }
  }

  const localPath = cleanLocation(file.filePath);
  if (localPath) {
    try {
      const probe = await dependencies.probeLocalFile(localPath);
      if (usableByteLength(probe.byteLength)) {
        attempts.push(readyAttempt("LOCAL_FILE"));
        return readyFile({
          file,
          reason: "LOCAL_FILE_READABLE",
          source: "LOCAL_FILE",
          byteLength: probe.byteLength,
          attempts,
        });
      }
      attempts.push(blockedAttempt("LOCAL_FILE", "EMPTY_LOCATION"));
    } catch {
      attempts.push(blockedAttempt("LOCAL_FILE", "UNREADABLE_LOCATION"));
    }
  }

  const objectKey = cleanLocation(file.objectKey);
  if (objectKey) {
    if (!isContentAssetPublishingObjectKey(objectKey)) {
      attempts.push(blockedAttempt("OBJECT_KEY", "INVALID_OBJECT_KEY"));
    } else {
      let resolvedPublicUrl: string | null = null;
      try {
        resolvedPublicUrl = dependencies.publicUrlFromObjectKey(objectKey);
      } catch {
        attempts.push(blockedAttempt("OBJECT_KEY", "UNRESOLVABLE_OBJECT_KEY"));
      }

      if (resolvedPublicUrl) {
        if (!/^https:\/\//i.test(resolvedPublicUrl) || !dependencies.isTrustedPublicUrl(resolvedPublicUrl)) {
          attempts.push(blockedAttempt("OBJECT_KEY", "UNTRUSTED_PUBLIC_URL"));
        } else {
          try {
            const probe = await dependencies.probePublicUrl(resolvedPublicUrl);
            if (usableByteLength(probe.byteLength)) {
              attempts.push(readyAttempt("OBJECT_KEY"));
              return readyFile({
                file,
                reason: "OBJECT_KEY_READABLE",
                source: "OBJECT_KEY",
                byteLength: probe.byteLength,
                effectivePublicUrl: resolvedPublicUrl,
                attempts,
              });
            }
            attempts.push(blockedAttempt("OBJECT_KEY", "EMPTY_LOCATION"));
          } catch {
            attempts.push(blockedAttempt("OBJECT_KEY", "UNREADABLE_LOCATION"));
          }
        }
      }
    }
  }

  if (!localPath && !objectKey) {
    return blockedFile({
      file,
      reason: "NO_MEDIA_LOCATION",
      message: `${file.fileName} has no local file, storage object key, or public media URL.`,
      attempts,
    });
  }

  return blockedFile({
    file,
    reason: "NO_READABLE_MEDIA_BYTES",
    message: `${file.fileName} has no readable, non-empty publishing bytes. Render or upload it again.`,
    attempts,
  });
}

export async function checkContentAssetMediaReadiness(input: {
  assetType: string;
  platform: PostingPlatform | null;
  files: ContentAssetMediaReadinessFile[];
  dependencies?: ContentAssetMediaReadinessDependencies;
}): Promise<ContentAssetMediaReadinessResult> {
  const selectedFiles = selectContentAssetMediaForReadiness(input);
  if (selectedFiles.length === 0) {
    return {
      status: "BLOCKED",
      reason: "NO_PUBLISHING_FILES",
      message: "No platform publishing images were selected.",
      selectedFileIds: [],
      files: [],
    };
  }

  const dependencies = input.dependencies ?? defaultDependencies;
  const files = await Promise.all(selectedFiles.map((file) => probeSelectedFile(file, dependencies)));
  const firstBlockedFile = files.find((file) => file.status === "BLOCKED");

  if (firstBlockedFile) {
    return {
      status: "BLOCKED",
      reason: "PUBLISHING_FILE_UNAVAILABLE",
      message: firstBlockedFile.message,
      selectedFileIds: selectedFiles.map((file) => file.id),
      files,
    };
  }

  return {
    status: "READY",
    reason: "SELECTED_FILES_READY",
    message: `${files.length} selected publishing file${files.length === 1 ? " has" : "s have"} verified readable bytes.`,
    selectedFileIds: selectedFiles.map((file) => file.id),
    files,
  };
}
