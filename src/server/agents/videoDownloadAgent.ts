import { spawn } from "node:child_process";
import { rename, unlink } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  ensureProcessingJobRunning,
  markJobFailed,
  markJobSucceeded,
  resolveProcessingJob,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { mediaFileIsUsable } from "@/server/media/fileGuards";
import { updateSermonStatus } from "@/server/status/sermonStatus";

type DownloadOptions = {
  force?: boolean;
  ytDlpPath?: string;
  processingJobId?: string;
};

type SourceDownloadQualityMode = "FAST" | "BALANCED" | "BEST";

const SOURCE_DOWNLOAD_FORMATS: Record<SourceDownloadQualityMode, string> = {
  FAST: "best[ext=mp4][height<=720]/bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[height<=720]/best",
  BALANCED: "best[ext=mp4][height<=1080]/bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
  BEST: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
};
const DEFAULT_SOURCE_DOWNLOAD_QUALITY_MODE: SourceDownloadQualityMode = "BEST";
const DEFAULT_YT_DLP_CONCURRENT_FRAGMENTS = 8;
const MAX_YT_DLP_CONCURRENT_FRAGMENTS = 16;

type DownloadAttemptProfile = {
  label: string;
  extraArgs: string[];
};

const DOWNLOAD_ATTEMPT_PROFILES: DownloadAttemptProfile[] = [
  {
    label: "default",
    extraArgs: [],
  },
  {
    label: "youtube-android-client",
    extraArgs: ["--extractor-args", "youtube:player_client=android"],
  },
  {
    label: "youtube-ios-client",
    extraArgs: ["--extractor-args", "youtube:player_client=ios"],
  },
];

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "yt-dlp";
}

function normalizeSourceDownloadQualityMode(value: string | null | undefined): SourceDownloadQualityMode {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "FAST" || normalized === "BALANCED" || normalized === "BEST") {
    return normalized;
  }

  return DEFAULT_SOURCE_DOWNLOAD_QUALITY_MODE;
}

function resolveConcurrentFragments(value: string | null | undefined): string {
  const parsed = Number.parseInt(value ?? "", 10);
  const fallback = DEFAULT_YT_DLP_CONCURRENT_FRAGMENTS;
  const fragments = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return String(Math.min(MAX_YT_DLP_CONCURRENT_FRAGMENTS, Math.max(1, fragments)));
}

function buildDownloaderArgs(): string[] {
  const downloader = process.env.YT_DLP_EXTERNAL_DOWNLOADER?.trim();
  const cookieFile = process.env.YOUTUBE_COOKIE_FILE_PATH?.trim();
  if (!downloader) {
    return cookieFile ? ["--cookies", cookieFile] : [];
  }

  const args = process.env.YT_DLP_EXTERNAL_DOWNLOADER_ARGS?.trim();
  return [
    ...(cookieFile ? ["--cookies", cookieFile] : []),
    "--downloader",
    downloader,
    ...(args ? ["--downloader-args", args] : []),
  ];
}

function getDownloadAttemptProfiles(): DownloadAttemptProfile[] {
  const preferAndroid = ["1", "true", "yes"].includes((process.env.YT_DLP_PREFER_ANDROID_CLIENT ?? "").trim().toLowerCase());
  if (!preferAndroid) {
    return DOWNLOAD_ATTEMPT_PROFILES;
  }

  const androidProfile = DOWNLOAD_ATTEMPT_PROFILES.find((profile) => profile.label === "youtube-android-client");
  const rest = DOWNLOAD_ATTEMPT_PROFILES.filter((profile) => profile.label !== "youtube-android-client");
  return androidProfile ? [androidProfile, ...rest] : DOWNLOAD_ATTEMPT_PROFILES;
}

function isYouTubeUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    return host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

export async function checkYtDlpInstalled(binaryPath?: string): Promise<void> {
  const command = commandFor(binaryPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`yt-dlp is not available: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`yt-dlp is not installed or not executable (${details}).`));
    });
  });
}

type DownloadRunResult = {
  stdout: string;
  stderr: string;
};

function buildBaseDownloadArgs(youtubeUrl: string, sourceVideoPath: string): string[] {
  const qualityMode = normalizeSourceDownloadQualityMode(
    process.env.SOURCE_VIDEO_DOWNLOAD_MODE ?? process.env.SOURCE_DOWNLOAD_QUALITY_MODE,
  );
  const concurrentFragments = resolveConcurrentFragments(process.env.YT_DLP_CONCURRENT_FRAGMENTS);
  return [
    youtubeUrl,
    "-o",
    sourceVideoPath,
    "-f",
    SOURCE_DOWNLOAD_FORMATS[qualityMode],
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--newline",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--concurrent-fragments",
    concurrentFragments,
    "--force-ipv4",
    ...buildDownloaderArgs(),
  ];
}

function getTempDownloadPath(sourceVideoPath: string): string {
  return sourceVideoPath.replace(/\.mp4$/i, ".download.partial.mp4");
}

async function removeTempDownloadFile(sourceVideoPath: string): Promise<void> {
  await unlink(/* turbopackIgnore: true */ getTempDownloadPath(sourceVideoPath)).catch(() => undefined);
}

function looksLikeHttp403(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return normalized.includes("http error 403") || normalized.includes("forbidden");
}

function toDownloadFailureMessage(stderr: string, code: number | null): string {
  const tail = stderr.trim().slice(-1500);
  if (looksLikeHttp403(stderr)) {
    return [
      `yt-dlp failed with code ${code ?? "unknown"}.`,
      "YouTube blocked the request (HTTP 403).",
      "Try updating yt-dlp and retrying, or provide browser cookies if the video is age-restricted/private.",
      tail,
    ]
      .filter((line) => line.length > 0)
      .join(" ");
  }

  return `yt-dlp failed with code ${code ?? "unknown"}. ${tail}`.trim();
}

async function runYtDlpDownload(
  sermonId: string,
  youtubeUrl: string,
  sourceVideoPath: string,
  binaryPath?: string,
): Promise<DownloadRunResult> {
  const command = commandFor(binaryPath);
  const baseArgs = buildBaseDownloadArgs(youtubeUrl, sourceVideoPath);

  await appendPipelineLog(sermonId, `Running yt-dlp download to ${sourceVideoPath}.`);

  let lastErrorMessage = "yt-dlp download failed.";

  for (const profile of getDownloadAttemptProfiles()) {
    await appendPipelineLog(sermonId, `yt-dlp attempt profile: ${profile.label}`);

    const attempt = await new Promise<
      | { ok: true; result: DownloadRunResult }
      | { ok: false; code: number | null; stderr: string; message: string }
    >((resolve) => {
      const args = [...baseArgs, ...profile.extraArgs];
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        void appendPipelineLog(sermonId, `[yt-dlp stdout] ${text.trimEnd()}`);
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        void appendPipelineLog(sermonId, `[yt-dlp stderr] ${text.trimEnd()}`);
      });

      child.on("error", (error) => {
        resolve({
          ok: false,
          code: null,
          stderr,
          message: `Failed to start yt-dlp: ${error.message}`,
        });
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ ok: true, result: { stdout, stderr } });
          return;
        }

        resolve({
          ok: false,
          code,
          stderr,
          message: toDownloadFailureMessage(stderr, code),
        });
      });
    });

    if (attempt.ok) {
      return attempt.result;
    }

    lastErrorMessage = attempt.message;

    // Retry only for 403-type failures. Other failures should fail fast.
    if (!looksLikeHttp403(attempt.stderr)) {
      break;
    }
  }

  throw new Error(lastErrorMessage);
}

export async function downloadSermonVideo(
  sermonId: string,
  options?: DownloadOptions,
): Promise<{ sourceVideoPath: string; reusedExistingFile: boolean }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      youtubeUrl: true,
      rightsConfirmed: true,
      sourceVideoPath: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }
  await ensureSermonFolders(sermon.id, sermon.title);
  const sourceVideoPath = getSourceVideoPath(sermon.id);
  const job = await resolveProcessingJob(sermon.id, "DOWNLOAD_VIDEO", options?.processingJobId);

  try {
    await ensureProcessingJobRunning(job);
    await appendJobLog(job.id, "Download job started.");
    await appendPipelineLog(sermon.id, "Download video requested.");
    await updateSermonStatus(sermon.id, "DOWNLOADING");

    if (!sermon.rightsConfirmed) {
      throw new Error("Cannot download video because rights are not confirmed.");
    }

    if (!sermon.youtubeUrl?.trim()) {
      throw new Error("Cannot download video because YouTube URL is missing.");
    }

    if (!isYouTubeUrl(sermon.youtubeUrl)) {
      throw new Error("Cannot download video because URL is not a valid YouTube link.");
    }

    const existingSource = await mediaFileIsUsable(sourceVideoPath);
    if (existingSource.usable && !options?.force) {
      await prisma.sermon.update({
        where: { id: sermon.id },
        data: {
          sourceVideoPath,
          sourceDurationSeconds: existingSource.durationSeconds,
        },
      });
      await updateSermonStatus(sermon.id, "DOWNLOADED");
      await markJobSucceeded(job.id, "Existing source.mp4 reused; skipped download.");
      await appendPipelineLog(sermon.id, "Existing source.mp4 reused; skipped download.");

      return { sourceVideoPath, reusedExistingFile: true };
    }

    if (!existingSource.usable && !options?.force) {
      await appendPipelineLog(sermon.id, `Existing source.mp4 was not reused: ${existingSource.reason}`);
    }

    await checkYtDlpInstalled(options?.ytDlpPath);

    const tempSourceVideoPath = getTempDownloadPath(sourceVideoPath);
    await removeTempDownloadFile(sourceVideoPath);

    const runResult = await runYtDlpDownload(
      sermon.id,
      sermon.youtubeUrl,
      tempSourceVideoPath,
      options?.ytDlpPath,
    );

    const logs = `Download complete.\nSTDOUT:\n${runResult.stdout}\nSTDERR:\n${runResult.stderr}`.slice(-30000);

    const downloadedSource = await mediaFileIsUsable(tempSourceVideoPath);
    if (!downloadedSource.usable) {
      throw new Error(`Downloaded video is not usable: ${downloadedSource.reason}`);
    }

    await rename(/* turbopackIgnore: true */ tempSourceVideoPath, /* turbopackIgnore: true */ sourceVideoPath);

    const finalizedSource = await mediaFileIsUsable(sourceVideoPath);
    if (!finalizedSource.usable) {
      throw new Error(`Finalized downloaded video is not usable: ${finalizedSource.reason}`);
    }

    await appendPipelineLog(sermon.id, `Detected source video duration: ${downloadedSource.durationSeconds.toFixed(2)} seconds.`);

    await prisma.sermon.update({
      where: { id: sermon.id },
      data: {
        sourceVideoPath,
        sourceDurationSeconds: finalizedSource.durationSeconds,
      },
    });

    await updateSermonStatus(sermon.id, "DOWNLOADED");
    await markJobSucceeded(job.id, logs);
    await appendPipelineLog(sermon.id, "Video downloaded successfully.");

    return { sourceVideoPath, reusedExistingFile: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown download error.";
    await removeTempDownloadFile(sourceVideoPath);
    await markJobFailed(job.id, message, "Download failed.");

    try {
      await updateSermonStatus(sermon.id, "FAILED");
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : "Unknown status error.";
      await appendPipelineLog(sermon.id, `Status update to FAILED skipped: ${statusMessage}`);
    }

    await appendPipelineLog(sermon.id, `Video download failed: ${message}`);
    throw new Error(message);
  }
}

export const __videoDownloadTestUtils = {
  buildBaseDownloadArgs,
  getTempDownloadPath,
  normalizeSourceDownloadQualityMode,
  resolveConcurrentFragments,
  looksLikeHttp403,
  toDownloadFailureMessage,
};
