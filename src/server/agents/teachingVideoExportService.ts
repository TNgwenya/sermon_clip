import { createReadStream } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

import { prisma } from "@/lib/prisma";
import { appendJobLog } from "@/server/agents/processing";
import {
  ensureSermonFolders,
  getSourceVideoPath,
  getTeachingVideoExportFolderPath,
  getTeachingVideoExportPath,
} from "@/server/agents/storage";
import { materializeS3SermonSource } from "@/server/agents/sourceMaterializationAgent";
import {
  checkFfmpegInstalled,
  hasAudioStream,
  probeMediaFile,
} from "@/server/media/ffmpeg";
import {
  buildVideoEncoderArgs,
  resolveAudioBitrate,
  resolvePreferredVideoEncoder,
} from "@/server/media/videoEncoding";

type TeachingExportOptions = {
  teachingVideoIds?: string[];
  processingJobId?: string;
  ffmpegPath?: string;
};

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function resolveSourceVideoPath(input: {
  sermonId: string;
  storedSourcePath: string | null;
  sourceAssetReady: boolean;
}): Promise<string> {
  const candidates = [
    getSourceVideoPath(input.sermonId),
    input.storedSourcePath?.trim() || null,
  ];
  for (const candidate of candidates) {
    if (candidate && await fileHasBytes(candidate)) return candidate;
  }

  if (input.sourceAssetReady) {
    const restored = await materializeS3SermonSource(input.sermonId);
    return restored.sourceVideoPath;
  }
  throw new Error("The original sermon video is not available to the media worker.");
}

function temporaryExportPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, `.partial-${process.pid}.mp4`);
}

async function runContinuousTeachingExport(input: {
  sourcePath: string;
  outputPath: string;
  startTimeSeconds: number;
  durationSeconds: number;
  jobId?: string;
  ffmpegPath?: string;
}): Promise<void> {
  const command = input.ffmpegPath?.trim() || "ffmpeg";
  const args = buildContinuousTeachingExportArgs(input);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let stderrTail = "";

    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-12_000);
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Teaching video FFmpeg export failed with code ${code ?? "unknown"}. ${stderrTail.trim().slice(-3000)}`,
      ));
    });
  });

  if (input.jobId) {
    await appendJobLog(
      input.jobId,
      `FFmpeg created one continuous ${input.durationSeconds.toFixed(2)}s teaching cut.`,
    );
  }
}

function buildContinuousTeachingExportArgs(input: {
  sourcePath: string;
  outputPath: string;
  startTimeSeconds: number;
  durationSeconds: number;
}): string[] {
  const encoder = resolvePreferredVideoEncoder("export");
  return [
    "-y",
    "-i",
    input.sourcePath,
    "-ss",
    input.startTimeSeconds.toFixed(3),
    "-t",
    input.durationSeconds.toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...buildVideoEncoderArgs(encoder, "export"),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    resolveAudioBitrate("export"),
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function teachingVideoIdsFromSummary(summary: unknown): string[] | undefined {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return undefined;
  const raw = (summary as { teachingVideoIds?: unknown }).teachingVideoIds;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

export async function exportApprovedTeachingVideos(
  sermonId: string,
  options?: TeachingExportOptions,
): Promise<{ exported: number; reused: number; failed: number }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      sourceVideoPath: true,
      sourceAsset: { select: { status: true } },
    },
  });
  if (!sermon) throw new Error(`Sermon ${sermonId} was not found.`);

  const videos = await prisma.teachingVideo.findMany({
    where: {
      sermonId,
      status: "APPROVED",
      ...(options?.teachingVideoIds ? { id: { in: options.teachingVideoIds } } : {}),
    },
    orderBy: { startTimeSeconds: "asc" },
    include: {
      revisions: { orderBy: { version: "desc" } },
    },
  });
  const exportable = videos.flatMap((video) => {
    if (
      video.approvedRevisionVersion === null
      || video.approvedRevisionVersion !== video.revisionVersion
    ) {
      return [];
    }
    const revision = video.revisions.find((item) => item.version === video.revisionVersion);
    return revision ? [{ video, revision }] : [];
  });
  if (exportable.length === 0) {
    throw new Error("No approved, current teaching-video revisions are ready to export.");
  }

  await ensureSermonFolders(sermon.id, sermon.title);
  await mkdir(getTeachingVideoExportFolderPath(sermon.id), { recursive: true });
  const sourcePath = await resolveSourceVideoPath({
    sermonId,
    storedSourcePath: sermon.sourceVideoPath,
    sourceAssetReady: sermon.sourceAsset?.status === "READY",
  });
  if (!await checkFfmpegInstalled(options?.ffmpegPath)) {
    throw new Error("FFmpeg is not installed or executable on the media worker.");
  }

  let exported = 0;
  let reused = 0;
  let failed = 0;

  for (const { video, revision } of exportable) {
    const outputPath = getTeachingVideoExportPath(
      sermonId,
      video.id,
      revision.version,
    );
    const existingExport = await prisma.teachingVideoExport.findUnique({
      where: { revisionId: revision.id },
    });
    if (
      existingExport?.status === "COMPLETED"
      && existingExport.filePath
      && await fileHasBytes(existingExport.filePath)
    ) {
      reused += 1;
      continue;
    }

    const exportRecord = await prisma.teachingVideoExport.upsert({
      where: { revisionId: revision.id },
      create: {
        teachingVideoId: video.id,
        revisionId: revision.id,
        sermonId,
        organizationId: video.organizationId,
        campusId: video.campusId,
        status: "EXPORTING",
      },
      update: {
        status: "EXPORTING",
        filePath: null,
        errorMessage: null,
        generatedAt: null,
      },
    });
    const tempPath = temporaryExportPath(outputPath);
    await unlink(tempPath).catch(() => undefined);

    try {
      if (options?.processingJobId) {
        await appendJobLog(
          options.processingJobId,
          `Exporting teaching video "${video.title}" from ${revision.startTimeSeconds.toFixed(2)}s to ${revision.endTimeSeconds.toFixed(2)}s.`,
        );
      }
      await runContinuousTeachingExport({
        sourcePath,
        outputPath: tempPath,
        startTimeSeconds: revision.startTimeSeconds,
        durationSeconds: revision.durationSeconds,
        jobId: options?.processingJobId,
        ffmpegPath: options?.ffmpegPath,
      });

      const [probe, audioPresent, outputStat, checksum] = await Promise.all([
        probeMediaFile(tempPath, options?.ffmpegPath),
        hasAudioStream(tempPath, options?.ffmpegPath),
        stat(tempPath),
        sha256File(tempPath),
      ]);
      const videoStream = probe.streams.find((stream) => stream.codecType === "video");
      if (!videoStream || !probe.durationSeconds) {
        throw new Error("The exported teaching video does not contain a valid video stream.");
      }
      if (!audioPresent) {
        throw new Error("The exported teaching video does not contain an audio stream.");
      }
      if (Math.abs(probe.durationSeconds - revision.durationSeconds) > 0.75) {
        throw new Error(
          `Export duration ${probe.durationSeconds.toFixed(3)}s differs from the approved ${revision.durationSeconds.toFixed(3)}s range.`,
        );
      }

      const current = await prisma.teachingVideo.findUnique({
        where: { id: video.id },
        select: {
          status: true,
          revisionVersion: true,
          approvedRevisionVersion: true,
        },
      });
      if (
        !current
        || current.status !== "APPROVED"
        || current.revisionVersion !== revision.version
        || current.approvedRevisionVersion !== revision.version
      ) {
        await unlink(tempPath).catch(() => undefined);
        await prisma.teachingVideoExport.update({
          where: { id: exportRecord.id },
          data: {
            status: "STALE",
            errorMessage: "The approved teaching-video revision changed while this export was running.",
          },
        });
        continue;
      }

      await unlink(outputPath).catch(() => undefined);
      await rename(tempPath, outputPath);
      await prisma.teachingVideoExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "COMPLETED",
          filePath: outputPath,
          sizeBytes: BigInt(outputStat.size),
          checksumSha256: checksum,
          durationSeconds: probe.durationSeconds,
          metadataJson: {
            continuousSourceRange: true,
            sourceStartSeconds: revision.startTimeSeconds,
            sourceEndSeconds: revision.endTimeSeconds,
            width: videoStream.width,
            height: videoStream.height,
            audioPresent,
          },
          errorMessage: null,
          generatedAt: new Date(),
        },
      });
      exported += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Teaching video export failed.";
      await unlink(tempPath).catch(() => undefined);
      await prisma.teachingVideoExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "FAILED",
          errorMessage: message,
        },
      });
      if (options?.processingJobId) {
        await appendJobLog(options.processingJobId, `Teaching video ${video.id} failed: ${message}`);
      }
    }
  }

  if (exported === 0 && reused === 0 && failed > 0) {
    throw new Error(`All ${failed} teaching-video export attempts failed.`);
  }
  return { exported, reused, failed };
}

export const __teachingVideoExportTestUtils = {
  temporaryExportPath,
  teachingVideoIdsFromSummary,
  buildContinuousTeachingExportArgs,
};
