import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";

export const COMPACT_CLIP_PREVIEW_VERSION = "compact-v1";

const COMPACT_PREVIEW_MAX_WIDTH = 540;
const COMPACT_PREVIEW_MAX_HEIGHT = 960;
const COMPACT_PREVIEW_FRAMES_PER_SECOND = 30;
const COMPACT_PREVIEW_VIDEO_MAX_RATE = "1800k";
const COMPACT_PREVIEW_VIDEO_BUFFER_SIZE = "3600k";
const COMPACT_PREVIEW_AUDIO_BITRATE = "96k";
const COMPACT_PREVIEW_GOP_FRAMES = 60;
const MAX_FFMPEG_ERROR_LENGTH = 12_000;

export type CompactClipPreview = {
  filePath: string;
  fileSizeBytes: number;
  version: typeof COMPACT_CLIP_PREVIEW_VERSION;
};

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

export function compactClipPreviewUrlIsCurrent(value: string | null | undefined): boolean {
  const candidate = value?.trim();
  if (!candidate) {
    return false;
  }

  try {
    const version = new URL(candidate).searchParams.get("v");
    return version === COMPACT_CLIP_PREVIEW_VERSION
      || Boolean(version?.startsWith(`${COMPACT_CLIP_PREVIEW_VERSION}-`));
  } catch {
    return false;
  }
}

export function buildCompactClipPreviewArgs(input: {
  sourcePath: string;
  outputPath: string;
}): string[] {
  return [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    [
      [
        `scale=w='min(${COMPACT_PREVIEW_MAX_WIDTH},iw)'`,
        `h='min(${COMPACT_PREVIEW_MAX_HEIGHT},ih)'`,
        "force_original_aspect_ratio=decrease",
        "force_divisible_by=2",
      ].join(":"),
      `fps=${COMPACT_PREVIEW_FRAMES_PER_SECOND}`,
      "format=yuv420p",
    ].join(","),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-maxrate",
    COMPACT_PREVIEW_VIDEO_MAX_RATE,
    "-bufsize",
    COMPACT_PREVIEW_VIDEO_BUFFER_SIZE,
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(COMPACT_PREVIEW_GOP_FRAMES),
    "-keyint_min",
    String(COMPACT_PREVIEW_GOP_FRAMES),
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    COMPACT_PREVIEW_AUDIO_BITRATE,
    "-ac",
    "2",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

function buildCompactClipPreviewOutputPath(sourcePath: string): string {
  const suffix = `${COMPACT_CLIP_PREVIEW_VERSION}-${process.pid}-${randomUUID()}`;
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.${suffix}.partial.mp4`);
}

export async function removeCompactClipPreview(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

export async function createCompactClipPreview(input: {
  sourcePath: string;
  ffmpegPath?: string;
}): Promise<CompactClipPreview> {
  const outputPath = buildCompactClipPreviewOutputPath(input.sourcePath);
  const args = buildCompactClipPreviewArgs({
    sourcePath: input.sourcePath,
    outputPath,
  });

  await removeCompactClipPreview(outputPath);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(commandFor(input.ffmpegPath), args, {
        stdio: ["ignore", "ignore", "pipe"],
        shell: false,
      });
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-MAX_FFMPEG_ERROR_LENGTH);
      });
      child.once("error", (error) => {
        reject(new Error(`Failed to start compact preview encoding: ${error.message}`));
      });
      child.once("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(
          `Compact preview encoding failed with code ${code ?? "unknown"}. ${stderr.trim()}`.trim(),
        ));
      });
    });

    const outputStats = await stat(outputPath);
    if (!outputStats.isFile() || outputStats.size <= 0) {
      throw new Error("Compact preview encoding produced an empty output file.");
    }

    return {
      filePath: outputPath,
      fileSizeBytes: outputStats.size,
      version: COMPACT_CLIP_PREVIEW_VERSION,
    };
  } catch (error) {
    await removeCompactClipPreview(outputPath);
    throw error;
  }
}

export const __clipPreviewProxyServiceTestUtils = {
  buildCompactClipPreviewArgs,
  buildCompactClipPreviewOutputPath,
};
