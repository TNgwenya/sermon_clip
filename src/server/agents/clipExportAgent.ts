import { access, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getClipOutputPath,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import { updateSermonStatus } from "@/server/status/sermonStatus";

type ExportOptions = {
  force?: boolean;
  ffmpegPath?: string;
};

type ClipToExport = {
  id: string;
  sermonId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  exportPath: string | null;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateClipTiming(clip: ClipToExport): void {
  if (clip.startTimeSeconds < 0) {
    throw new Error(`Clip ${clip.id} has a negative start time.`);
  }

  if (clip.endTimeSeconds <= clip.startTimeSeconds) {
    throw new Error(`Clip ${clip.id} has an invalid time range.`);
  }

  if (clip.durationSeconds < 30 || clip.durationSeconds > 90) {
    throw new Error(`Clip ${clip.id} must remain between 30 and 90 seconds for export.`);
  }
}

async function runFfmpegExport(
  sermonId: string,
  sourceVideoPath: string,
  outputPath: string,
  startTimeSeconds: number,
  endTimeSeconds: number,
  jobId: string,
  binaryPath?: string,
): Promise<{ stdout: string; stderr: string }> {
  const command = binaryPath?.trim() || "ffmpeg";
  const args = [
    "-y",
    "-ss",
    String(startTimeSeconds),
    "-to",
    String(endTimeSeconds),
    "-i",
    sourceVideoPath,
    "-filter_complex",
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:1[bg];[0:v]scale=1080:-2:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await appendPipelineLog(sermonId, `Running FFmpeg export to ${outputPath}.`);

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      void appendPipelineLog(sermonId, `[ffmpeg stdout] ${text.trimEnd()}`);
      void appendJobLog(jobId, `[ffmpeg stdout] ${text.trimEnd()}`);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      void appendPipelineLog(sermonId, `[ffmpeg stderr] ${text.trimEnd()}`);
      void appendJobLog(jobId, `[ffmpeg stderr] ${text.trimEnd()}`);
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const tail = stderr.trim().slice(-1500);
      reject(new Error(`FFmpeg failed with code ${code ?? "unknown"}. ${tail}`.trim()));
    });
  });
}

function getTempExportPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".partial.mp4");
}

export async function exportApprovedClips(
  sermonId: string,
  options?: ExportOptions,
): Promise<{ exportedCount: number; reusedExistingFiles: boolean; message: string }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id);

  const job = await createProcessingJob(sermon.id, "EXPORT_CLIPS");
  const sourceVideoPath = getSourceVideoPath(sermon.id);
  const sourceExists = await fileExists(sourceVideoPath);

  let exportedCount = 0;
  let reusedExistingFiles = false;
  let noApprovedClips = false;

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, "Clip export job started.");
    await appendPipelineLog(sermon.id, "Clip export requested.");

    if (!sourceExists) {
      throw new Error("Cannot export clips because source video file does not exist.");
    }

    const approvedClips = (await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "APPROVED",
      },
      orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
      select: {
        id: true,
        sermonId: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        durationSeconds: true,
        status: true,
        exportPath: true,
      },
    })) as ClipToExport[];

    if (approvedClips.length === 0) {
      noApprovedClips = true;
      throw new Error("No approved clips were available to export.");
    }

    await updateSermonStatus(sermon.id, "EXPORTING");
    const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
    if (!ffmpegInstalled) {
      throw new Error("FFmpeg is not installed or not executable.");
    }

    for (const clip of approvedClips) {
      validateClipTiming(clip);

      const outputPath = getClipOutputPath(sermon.id, clip.id);
      const outputExists = await fileExists(outputPath);

      if (outputExists && !options?.force) {
        await prisma.clipCandidate.update({
          where: { id: clip.id },
          data: {
            status: "EXPORTED",
            exportPath: outputPath,
          },
        });
        await appendJobLog(job.id, `Reused existing exported clip for ${clip.id}.`);
        await appendPipelineLog(sermon.id, `Reused existing exported clip for ${clip.id}.`);
        reusedExistingFiles = true;
        exportedCount += 1;
        continue;
      }

      const tempOutputPath = getTempExportPath(outputPath);
      const runResult = await runFfmpegExport(
        sermon.id,
        sourceVideoPath,
        tempOutputPath,
        clip.startTimeSeconds,
        clip.endTimeSeconds,
        job.id,
        options?.ffmpegPath,
      );

      await rename(tempOutputPath, outputPath);

      const logs = `Clip export complete for ${clip.id}.\nSTDOUT:\n${runResult.stdout}\nSTDERR:\n${runResult.stderr}`.slice(-30000);

      await prisma.clipCandidate.update({
        where: { id: clip.id },
        data: {
          status: "EXPORTED",
          exportPath: outputPath,
        },
      });

      await appendJobLog(job.id, `Exported clip ${clip.id} to ${outputPath}.`);
      await appendJobLog(job.id, logs);
      await appendPipelineLog(sermon.id, `Exported clip ${clip.id} to ${outputPath}.`);
      exportedCount += 1;
    }

    await updateSermonStatus(sermon.id, "EXPORTED");
    await markJobSucceeded(
      job.id,
      `Exported ${exportedCount} approved clip(s). ${reusedExistingFiles ? "Some existing files were reused." : "No existing files were reused."}`,
    );
    await appendPipelineLog(sermon.id, `Exported ${exportedCount} approved clip(s) successfully.`);

    return {
      exportedCount,
      reusedExistingFiles,
      message: `Exported ${exportedCount} approved clip(s).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown clip export error.";

    for (const clip of await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "APPROVED",
      },
      select: {
        id: true,
      },
    })) {
      const tempOutputPath = getTempExportPath(getClipOutputPath(sermon.id, clip.id));
      try {
        await unlink(tempOutputPath);
      } catch {
        // Ignore cleanup failures for partial export files.
      }
    }

    await markJobFailed(job.id, message, "Clip export failed.");

    try {
      if (!noApprovedClips) {
        await updateSermonStatus(sermon.id, exportedCount > 0 ? "EXPORTED" : "FAILED");
      }
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : "Unknown status error.";
      await appendPipelineLog(sermon.id, `Status update skipped: ${statusMessage}`);
    }

    await appendPipelineLog(sermon.id, `Clip export failed: ${message}`);
    throw new Error(message);
  }
}