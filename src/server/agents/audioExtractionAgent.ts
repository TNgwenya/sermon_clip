import { spawn } from "node:child_process";

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
  getAudioPath,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import { fileHasBytes, mediaFileIsUsable } from "@/server/media/fileGuards";
import { updateSermonStatus } from "@/server/status/sermonStatus";

type ExtractOptions = {
  force?: boolean;
  ffmpegPath?: string;
  processingJobId?: string;
};

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

type ExtractionRunResult = {
  stdout: string;
  stderr: string;
};

async function runFfmpegExtraction(
  sermonId: string,
  sourceVideoPath: string,
  audioPath: string,
  binaryPath?: string,
): Promise<ExtractionRunResult> {
  const command = commandFor(binaryPath);
  const args = [
    "-y",
    "-i",
    sourceVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "96k",
    audioPath,
  ];

  await appendPipelineLog(sermonId, `Running FFmpeg extraction from ${sourceVideoPath} to ${audioPath}.`);

  return new Promise<ExtractionRunResult>((resolve, reject) => {
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
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      void appendPipelineLog(sermonId, `[ffmpeg stderr] ${text.trimEnd()}`);
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

export async function extractSermonAudio(
  sermonId: string,
  options?: ExtractOptions,
): Promise<{ audioPath: string; reusedExistingFile: boolean }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      sourceVideoPath: true,
      audioPath: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id, sermon.title);

  const sourceVideoPath = getSourceVideoPath(sermon.id);
  const audioPath = getAudioPath(sermon.id);
  const job = await resolveProcessingJob(sermon.id, "EXTRACT_AUDIO", options?.processingJobId);

  try {
    await ensureProcessingJobRunning(job);
    await appendJobLog(job.id, "Audio extraction job started.");
    await appendPipelineLog(sermon.id, "Audio extraction requested.");

    const sourceHasBytes = await fileHasBytes(sourceVideoPath);
    if (!sourceHasBytes) {
      throw new Error("Cannot extract audio because source video file is missing or empty.");
    }

    await updateSermonStatus(sermon.id, "AUDIO_EXTRACTING");

    const existingAudio = await mediaFileIsUsable(audioPath, options?.ffmpegPath);
    if (existingAudio.usable && !options?.force) {
      await prisma.sermon.update({
        where: { id: sermon.id },
        data: {
          audioPath,
        },
      });
      await updateSermonStatus(sermon.id, "AUDIO_EXTRACTED");
      await markJobSucceeded(job.id, "Existing audio.mp3 reused; skipped extraction.");
      await appendPipelineLog(sermon.id, "Existing audio.mp3 reused; skipped extraction.");

      return { audioPath, reusedExistingFile: true };
    }

    if (!existingAudio.usable && !options?.force) {
      await appendPipelineLog(sermon.id, `Existing audio.mp3 was not reused: ${existingAudio.reason}`);
    }

    const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
    if (!ffmpegInstalled) {
      throw new Error("FFmpeg is not installed or not executable.");
    }

    const runResult = await runFfmpegExtraction(
      sermon.id,
      sourceVideoPath,
      audioPath,
      options?.ffmpegPath,
    );

    const logs = `Audio extraction complete.\nSTDOUT:\n${runResult.stdout}\nSTDERR:\n${runResult.stderr}`.slice(-30000);
    const extractedAudio = await mediaFileIsUsable(audioPath, options?.ffmpegPath);
    if (!extractedAudio.usable) {
      throw new Error(`Extracted audio is not usable: ${extractedAudio.reason}`);
    }

    await prisma.sermon.update({
      where: { id: sermon.id },
      data: {
        audioPath,
      },
    });

    await updateSermonStatus(sermon.id, "AUDIO_EXTRACTED");
    await markJobSucceeded(job.id, logs);
    await appendPipelineLog(sermon.id, "Audio extracted successfully.");

    return { audioPath, reusedExistingFile: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audio extraction error.";
    await markJobFailed(job.id, message, "Audio extraction failed.");

    try {
      await updateSermonStatus(sermon.id, "FAILED");
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : "Unknown status error.";
      await appendPipelineLog(sermon.id, `Status update to FAILED skipped: ${statusMessage}`);
    }

    await appendPipelineLog(sermon.id, `Audio extraction failed: ${message}`);
    throw new Error(message);
  }
}
