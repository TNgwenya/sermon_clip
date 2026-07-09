import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  buildCoverFrameSource,
  buildNeutralCoverFrameCandidates,
  clampCoverFrameTime,
  isClipCoverFrameSelectionStale,
  parseClipCoverFrameSelection,
  type ClipCoverFrameSelection,
  type ClipCoverFrameSource,
  type ClipCoverFrameSourceVariant,
} from "@/lib/clipCoverFrame";
import {
  resolveBestPreviewCandidate,
  type ClipPreviewPaths,
} from "@/lib/clipPreview";
import {
  getClipThumbnailPath,
  getClipThumbnailWebpPath,
} from "@/server/agents/storage";

export type ClipThumbnailSource = ClipPreviewPaths & {
  id: string;
  sermonId: string;
  title?: string | null;
  thumbnailPath?: string | null;
  thumbnailError?: string | null;
  captionData?: unknown;
  startTimeSeconds?: number | null;
  endTimeSeconds?: number | null;
  durationSeconds?: number | null;
  exportedAt?: Date | string | null;
  captionBurnedAt?: Date | string | null;
  overlayRenderedAt?: Date | string | null;
  exportAssetVersion?: number | null;
  captionBurnAssetVersion?: number | null;
  overlayAssetVersion?: number | null;
  renderAssetVersion?: number | null;
};

export type ResolvedClipThumbnailSource = {
  videoPath: string;
  source: ClipCoverFrameSource;
};

export type ClipThumbnailResult = {
  status: "generated" | "existing" | "fallback";
  thumbnailPath: string | null;
  webpPath: string | null;
  contentType?: "image/jpeg";
  image?: Buffer;
  fallbackTitle?: string;
  error?: string;
  timeSeconds?: number;
  source?: ClipCoverFrameSource;
  savedSelection?: ClipCoverFrameSelection | null;
  selectionStale?: boolean;
};

export type ClipThumbnailPreviewResult = {
  image: Buffer;
  contentType: "image/jpeg";
  timeSeconds: number;
  source: ClipCoverFrameSource;
};

export type ClipThumbnailReadiness = {
  preparedClipCount: number;
  readyPosterCount: number;
  optimizedPosterCount: number;
  missingPosterCount: number;
  failedPosterCount: number;
};

export type ClipThumbnailBackfillResult = ClipThumbnailReadiness & {
  attemptedCount: number;
  generatedCount: number;
  existingCount: number;
  fallbackCount: number;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

export function getStoredOrDefaultThumbnailPath(clip: Pick<ClipThumbnailSource, "id" | "sermonId" | "thumbnailPath">): string {
  return clip.thumbnailPath?.trim() || getClipThumbnailPath(clip.sermonId, clip.id);
}

export function getDefaultThumbnailWebpPath(clip: Pick<ClipThumbnailSource, "id" | "sermonId">): string {
  return getClipThumbnailWebpPath(clip.sermonId, clip.id);
}

function assetVersionForVariant(clip: ClipThumbnailSource, variant: ClipCoverFrameSourceVariant): number {
  if (variant === "exported") return clip.exportAssetVersion ?? 0;
  if (variant === "overlay") return clip.overlayAssetVersion ?? 0;
  if (variant === "captioned") return clip.captionBurnAssetVersion ?? 0;
  return clip.renderAssetVersion ?? 0;
}

function sourceUpdatedAtForVariant(
  clip: ClipThumbnailSource,
  variant: ClipCoverFrameSourceVariant,
): Date | string | null | undefined {
  if (variant === "exported") return clip.exportedAt;
  if (variant === "overlay") return clip.overlayRenderedAt;
  if (variant === "captioned") return clip.captionBurnedAt;
  return clip.renderedAt;
}

export async function resolveClipThumbnailSource(
  clip: ClipThumbnailSource,
): Promise<ResolvedClipThumbnailSource | null> {
  const remaining: ClipPreviewPaths = { ...clip };

  while (true) {
    const candidate = resolveBestPreviewCandidate(remaining);
    if (!candidate) {
      return null;
    }

    if (await fileExists(candidate.path)) {
      return {
        videoPath: candidate.path,
        source: buildCoverFrameSource({
          variant: candidate.variant,
          assetVersion: assetVersionForVariant(clip, candidate.variant),
          sourceUpdatedAt: sourceUpdatedAtForVariant(clip, candidate.variant),
        }),
      };
    }

    if (candidate.variant === "exported") remaining.exportedFilePath = null;
    if (candidate.variant === "overlay") remaining.overlayVideoPath = null;
    if (candidate.variant === "captioned") remaining.captionedVideoPath = null;
    if (candidate.variant === "rendered") remaining.renderedFilePath = null;
  }
}

function shortFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getVersionedClipThumbnailPaths(input: {
  clip: Pick<ClipThumbnailSource, "id" | "sermonId">;
  source: ClipCoverFrameSource;
  timeSeconds: number;
}): { thumbnailPath: string; webpPath: string } {
  const defaultPath = getClipThumbnailPath(input.clip.sermonId, input.clip.id);
  const parsedPath = path.parse(defaultPath);
  const timeMilliseconds = Math.max(0, Math.round(input.timeSeconds * 1000));
  const sourceKey = `${input.source.variant}-v${input.source.assetVersion}-${shortFingerprint(input.source.fingerprint)}`;
  const fileStem = `${parsedPath.name}.cover-${sourceKey}-${timeMilliseconds}`;

  return {
    thumbnailPath: path.join(parsedPath.dir, `${fileStem}.jpg`),
    webpPath: path.join(parsedPath.dir, `${fileStem}.webp`),
  };
}

async function generateThumbnailFile(input: {
  videoPath: string;
  outputPath: string;
  ffmpegPath?: string;
  format: "jpg" | "webp";
  timeSeconds: number;
}): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ path.dirname(input.outputPath), { recursive: true });
  const codecArgs = input.format === "webp"
    ? ["-c:v", "libwebp", "-quality", "80"]
    : ["-q:v", "4"];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      input.ffmpegPath?.trim() || process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      [
        "-y",
        "-ss",
        input.timeSeconds.toFixed(3),
        "-i",
        input.videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-1:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black",
        ...codecArgs,
        input.outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        shell: false,
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with ${code ?? "unknown"}`));
    });
  });
}

async function generateThumbnailImage(input: {
  videoPath: string;
  ffmpegPath?: string;
  timeSeconds: number;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      input.ffmpegPath?.trim() || process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      [
        "-ss",
        input.timeSeconds.toFixed(3),
        "-i",
        input.videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-1:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );

    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const image = Buffer.concat(stdoutChunks);
      if (code === 0 && image.length > 0) {
        resolve(image);
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with ${code ?? "unknown"}`));
    });
  });
}

function resolveClipDuration(clip: ClipThumbnailSource): number {
  if (typeof clip.durationSeconds === "number" && Number.isFinite(clip.durationSeconds)) {
    return Math.max(0, clip.durationSeconds);
  }

  if (
    typeof clip.startTimeSeconds === "number"
    && typeof clip.endTimeSeconds === "number"
    && Number.isFinite(clip.startTimeSeconds)
    && Number.isFinite(clip.endTimeSeconds)
  ) {
    return Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds);
  }

  return 0;
}

export async function generateClipThumbnailPreview(
  clip: ClipThumbnailSource,
  options: { timeSeconds: number; ffmpegPath?: string },
): Promise<ClipThumbnailPreviewResult | null> {
  const resolvedSource = await resolveClipThumbnailSource(clip);
  if (!resolvedSource) {
    return null;
  }

  const timeSeconds = clampCoverFrameTime(options.timeSeconds, resolveClipDuration(clip));
  const image = await generateThumbnailImage({
    videoPath: resolvedSource.videoPath,
    ffmpegPath: options.ffmpegPath,
    timeSeconds,
  });

  return {
    image,
    contentType: "image/jpeg",
    timeSeconds,
    source: resolvedSource.source,
  };
}

async function writeThumbnailMetadata(input: {
  clipId: string;
  thumbnailPath: string | null;
  error: string | null;
}): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: input.clipId },
    data: {
      thumbnailPath: input.thumbnailPath,
      thumbnailGeneratedAt: input.thumbnailPath ? new Date() : null,
      thumbnailError: input.error,
    },
  });
}

export async function ensureClipThumbnail(
  clip: ClipThumbnailSource,
  options?: {
    includeImage?: boolean;
    ffmpegPath?: string;
    force?: boolean;
  },
): Promise<ClipThumbnailResult> {
  const resolvedSource = await resolveClipThumbnailSource(clip);
  const savedSelection = parseClipCoverFrameSelection(clip.captionData);

  if (!resolvedSource) {
    return {
      status: "fallback",
      thumbnailPath: null,
      webpPath: null,
      fallbackTitle: clip.title ?? "Sermon Clip",
      error: "No prepared video file is available for a poster yet.",
      savedSelection,
    };
  }

  const durationSeconds = resolveClipDuration(clip);
  const defaultTime = buildNeutralCoverFrameCandidates(durationSeconds)[0]?.timeSeconds ?? 0;
  const timeSeconds = clampCoverFrameTime(savedSelection?.timeSeconds ?? defaultTime, durationSeconds);
  const selectionStale = isClipCoverFrameSelectionStale(
    savedSelection,
    resolvedSource.source,
    durationSeconds,
  );
  const { thumbnailPath, webpPath } = getVersionedClipThumbnailPaths({
    clip,
    source: resolvedSource.source,
    timeSeconds,
  });

  if (!options?.force && await fileExists(thumbnailPath)) {
    if (!(await fileExists(webpPath))) {
      await generateThumbnailFile({
        videoPath: resolvedSource.videoPath,
        outputPath: webpPath,
        ffmpegPath: options?.ffmpegPath,
        format: "webp",
        timeSeconds,
      }).catch(() => undefined);
    }

    if (clip.thumbnailPath !== thumbnailPath || clip.thumbnailError) {
      await writeThumbnailMetadata({
        clipId: clip.id,
        thumbnailPath,
        error: null,
      });
    }

    return {
      status: "existing",
      thumbnailPath,
      webpPath: (await fileExists(webpPath)) ? webpPath : null,
      contentType: "image/jpeg",
      image: options?.includeImage ? await readFile(/* turbopackIgnore: true */ thumbnailPath) : undefined,
      timeSeconds,
      source: resolvedSource.source,
      savedSelection,
      selectionStale,
    };
  }

  try {
    await generateThumbnailFile({
      videoPath: resolvedSource.videoPath,
      outputPath: thumbnailPath,
      ffmpegPath: options?.ffmpegPath,
      format: "jpg",
      timeSeconds,
    });
    await generateThumbnailFile({
      videoPath: resolvedSource.videoPath,
      outputPath: webpPath,
      ffmpegPath: options?.ffmpegPath,
      format: "webp",
      timeSeconds,
    }).catch(() => undefined);
    await writeThumbnailMetadata({
      clipId: clip.id,
      thumbnailPath,
      error: null,
    });

    return {
      status: "generated",
      thumbnailPath,
      webpPath: (await fileExists(webpPath)) ? webpPath : null,
      contentType: "image/jpeg",
      image: options?.includeImage ? await readFile(/* turbopackIgnore: true */ thumbnailPath) : undefined,
      timeSeconds,
      source: resolvedSource.source,
      savedSelection,
      selectionStale,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare clip poster.";
    await writeThumbnailMetadata({
      clipId: clip.id,
      thumbnailPath: null,
      error: message,
    }).catch(() => undefined);

    return {
      status: "fallback",
      thumbnailPath: null,
      webpPath: null,
      fallbackTitle: clip.title ?? "Sermon Clip",
      error: message,
      timeSeconds,
      source: resolvedSource.source,
      savedSelection,
      selectionStale,
    };
  }
}

function preparedClipWhere(): Prisma.ClipCandidateWhereInput {
  return {
    OR: [
      { exportedFilePath: { not: null } },
      { captionedVideoPath: { not: null } },
      { overlayVideoPath: { not: null } },
      { renderedFilePath: { not: null } },
    ],
  };
}

export async function getClipThumbnailReadiness(): Promise<ClipThumbnailReadiness> {
  const [preparedClipCount, readyPosterCount, failedPosterCount, clipsWithPosters] = await Promise.all([
    prisma.clipCandidate.count({ where: preparedClipWhere() }),
    prisma.clipCandidate.count({
      where: {
        ...preparedClipWhere(),
        thumbnailPath: { not: null },
        thumbnailGeneratedAt: { not: null },
      },
    }),
    prisma.clipCandidate.count({
      where: {
        ...preparedClipWhere(),
        thumbnailError: { not: null },
        thumbnailPath: null,
      },
    }),
    prisma.clipCandidate.findMany({
      where: {
        ...preparedClipWhere(),
        thumbnailPath: { not: null },
      },
      select: {
        id: true,
        sermonId: true,
        thumbnailPath: true,
      },
      take: 500,
    }),
  ]);
  const optimizedPosterChecks = await Promise.all(
    clipsWithPosters.map((clip) => {
      const thumbnailPath = clip.thumbnailPath?.trim();
      if (!thumbnailPath) return false;
      const parsed = path.parse(thumbnailPath);
      return fileExists(path.join(parsed.dir, `${parsed.name}.webp`));
    }),
  );
  const optimizedPosterCount = optimizedPosterChecks.filter(Boolean).length;

  return {
    preparedClipCount,
    readyPosterCount,
    optimizedPosterCount,
    missingPosterCount: Math.max(0, preparedClipCount - readyPosterCount),
    failedPosterCount,
  };
}

export async function backfillClipThumbnails(options?: {
  limit?: number;
  ffmpegPath?: string;
}): Promise<ClipThumbnailBackfillResult> {
  const limit = Math.max(1, Math.min(options?.limit ?? 25, 100));
  const clips = await prisma.clipCandidate.findMany({
    where: {
      AND: [
        preparedClipWhere(),
        {
          OR: [
            { thumbnailPath: null },
            { thumbnailGeneratedAt: null },
            { thumbnailError: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true,
      sermonId: true,
      title: true,
      renderedFilePath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      exportedFilePath: true,
      renderFreshness: true,
      overlayFreshness: true,
      captionBurnFreshness: true,
      exportFreshness: true,
      renderedAt: true,
      overlayRenderedAt: true,
      captionBurnedAt: true,
      exportedAt: true,
      renderAssetVersion: true,
      overlayAssetVersion: true,
      captionBurnAssetVersion: true,
      exportAssetVersion: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      captionData: true,
      thumbnailPath: true,
      thumbnailError: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  let generatedCount = 0;
  let existingCount = 0;
  let fallbackCount = 0;

  for (const clip of clips) {
    const result = await ensureClipThumbnail(clip, { ffmpegPath: options?.ffmpegPath });
    if (result.status === "generated") {
      generatedCount += 1;
    } else if (result.status === "existing") {
      existingCount += 1;
    } else {
      fallbackCount += 1;
    }
  }

  const readiness = await getClipThumbnailReadiness();

  return {
    ...readiness,
    attemptedCount: clips.length,
    generatedCount,
    existingCount,
    fallbackCount,
  };
}
