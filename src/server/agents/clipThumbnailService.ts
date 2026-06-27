import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { listBestPreviewCandidates, type ClipPreviewPaths } from "@/lib/clipPreview";
import {
  getClipThumbnailPath,
  getClipThumbnailWebpPath,
} from "@/server/agents/storage";

export type ClipThumbnailSource = ClipPreviewPaths & {
  id: string;
  sermonId: string;
  title?: string | null;
  thumbnailPath?: string | null;
};

export type ClipThumbnailResult = {
  status: "generated" | "existing" | "fallback";
  thumbnailPath: string | null;
  webpPath: string | null;
  contentType?: "image/jpeg";
  image?: Buffer;
  fallbackTitle?: string;
  error?: string;
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

async function findBestVideoPath(clip: ClipPreviewPaths): Promise<string | null> {
  const candidates = await Promise.all(
    listBestPreviewCandidates(clip).map(async (candidate) => {
      if (!candidate) {
        return null;
      }

      return (await fileExists(candidate)) ? candidate : null;
    }),
  );

  return candidates.find((candidate): candidate is string => Boolean(candidate)) ?? null;
}

async function generateThumbnailFile(input: {
  videoPath: string;
  outputPath: string;
  ffmpegPath?: string;
  format: "jpg" | "webp";
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
        "00:00:01",
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
  },
): Promise<ClipThumbnailResult> {
  const thumbnailPath = getStoredOrDefaultThumbnailPath(clip);
  const webpPath = getDefaultThumbnailWebpPath(clip);

  if (await fileExists(thumbnailPath)) {
    if (!(await fileExists(webpPath))) {
      const bestVideoPath = await findBestVideoPath(clip);
      if (bestVideoPath) {
        await generateThumbnailFile({
          videoPath: bestVideoPath,
          outputPath: webpPath,
          ffmpegPath: options?.ffmpegPath,
          format: "webp",
        }).catch(() => undefined);
      }
    }

    await writeThumbnailMetadata({
      clipId: clip.id,
      thumbnailPath,
      error: null,
    });

    return {
      status: "existing",
      thumbnailPath,
      webpPath: (await fileExists(webpPath)) ? webpPath : null,
      contentType: "image/jpeg",
      image: options?.includeImage ? await readFile(/* turbopackIgnore: true */ thumbnailPath) : undefined,
    };
  }

  const bestVideoPath = await findBestVideoPath(clip);
  if (!bestVideoPath) {
    return {
      status: "fallback",
      thumbnailPath: null,
      webpPath: null,
      fallbackTitle: clip.title ?? "Sermon Clip",
      error: "No prepared video file is available for a poster yet.",
    };
  }

  try {
    await generateThumbnailFile({
      videoPath: bestVideoPath,
      outputPath: thumbnailPath,
      ffmpegPath: options?.ffmpegPath,
      format: "jpg",
    });
    await generateThumbnailFile({
      videoPath: bestVideoPath,
      outputPath: webpPath,
      ffmpegPath: options?.ffmpegPath,
      format: "webp",
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
      },
      take: 500,
    }),
  ]);
  const optimizedPosterChecks = await Promise.all(
    clipsWithPosters.map((clip) => fileExists(getDefaultThumbnailWebpPath(clip))),
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
      thumbnailPath: true,
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
