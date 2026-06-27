import { access, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import sharp from "sharp";

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
  getClipFolderPath,
  getClipOutputPath,
  getClipSrtPath,
} from "@/server/agents/storage";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";

type SubtitleOptions = {
  force?: boolean;
  ffmpegPath?: string;
};

type ExportedClip = {
  id: string;
  sermonId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  exportPath: string | null;
  srtPath: string | null;
  subtitlesGenerated: boolean;
  subtitlesBurned: boolean;
};

type TranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type SubtitleCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

type SubtitleRunResult = {
  stdout: string;
  stderr: string;
};

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateClipTiming(clip: Pick<ExportedClip, "id" | "startTimeSeconds" | "endTimeSeconds" | "durationSeconds">): void {
  if (clip.startTimeSeconds < 0) {
    throw new Error(`Clip ${clip.id} has a negative start time.`);
  }

  if (clip.endTimeSeconds <= clip.startTimeSeconds) {
    throw new Error(`Clip ${clip.id} has an invalid time range.`);
  }

  if (clip.durationSeconds <= 0) {
    throw new Error(`Clip ${clip.id} has a zero-length duration.`);
  }
}

function formatSrtTimestamp(seconds: number): string {
  const clampedMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(clampedMilliseconds / 3600000);
  const minutes = Math.floor((clampedMilliseconds % 3600000) / 60000);
  const remainingSeconds = Math.floor((clampedMilliseconds % 60000) / 1000);
  const milliseconds = clampedMilliseconds % 1000;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(",", String(milliseconds).padStart(3, "0"));
}

function parseSrtTimestamp(value: string): number {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function parseSrtContent(content: string): SubtitleCue[] {
  const blocks = content.trim().split(/\n\s*\n/g).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split(/\r?\n/g).filter(Boolean);
    if (lines.length < 3) {
      throw new Error("Invalid SRT block.");
    }

    const timingLine = lines[1];
    const timingMatch = timingLine.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})$/);
    if (!timingMatch) {
      throw new Error(`Invalid SRT timing line: ${timingLine}`);
    }

    return {
      startSeconds: parseSrtTimestamp(timingMatch[1]),
      endSeconds: parseSrtTimestamp(timingMatch[2]),
      text: lines.slice(2).join("\n").trim(),
    };
  });
}

function buildSrtContent(
  clip: Pick<ExportedClip, "id" | "startTimeSeconds" | "endTimeSeconds" | "durationSeconds">,
  segments: TranscriptSegment[],
): string {
  const entries: string[] = [];
  let index = 1;

  for (const segment of segments) {
    const overlapStart = Math.max(clip.startTimeSeconds, segment.startTimeSeconds);
    const overlapEnd = Math.min(clip.endTimeSeconds, segment.endTimeSeconds);
    const relativeStart = Math.max(0, overlapStart - clip.startTimeSeconds);
    const relativeEnd = Math.min(clip.durationSeconds, overlapEnd - clip.startTimeSeconds);

    if (relativeEnd <= relativeStart) {
      continue;
    }

    const text = wrapSubtitleLines(segment.text).join("\n");
    if (!text) {
      continue;
    }

    entries.push([
      String(index),
      `${formatSrtTimestamp(relativeStart)} --> ${formatSrtTimestamp(relativeEnd)}`,
      text,
    ].join("\n"));

    index += 1;
  }

  if (entries.length === 0) {
    throw new Error(`No transcript segments overlap clip ${clip.id}.`);
  }

  return `${entries.join("\n\n")}\n`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapSubtitleLines(text: string, maxLineLength = 28): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
    if (candidate.length > maxLineLength && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    if (word.length > maxLineLength) {
      return [normalized];
    }

    currentLine = candidate;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [normalized];
}

function buildCueSvg(cue: SubtitleCue): string {
  const width = 1080;
  const height = 1920;
  const boxWidth = 900;
  const boxHeight = 240;
  const boxX = (width - boxWidth) / 2;
  const boxY = height - 420;
  const lines = wrapSubtitleLines(cue.text);
  const lineHeight = 62;
  const startY = boxY + 92;

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${width / 2}" dy="${dy}">${escapeSvgText(line)}</tspan>`;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="transparent" />
      <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="28" ry="28" fill="rgba(0,0,0,0.68)" />
      <text x="${width / 2}" y="${startY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700" fill="#ffffff">
        ${tspans}
      </text>
    </svg>
  `;
}

async function renderSubtitleCueImage(cue: SubtitleCue, outputPath: string): Promise<void> {
  const svg = buildCueSvg(cue);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function buildBurnOverlayChain(cues: SubtitleCue[], cueImagePaths: string[]): { filterComplex: string; inputs: string[] } {
  const inputs = cueImagePaths.flatMap((cueImagePath) => ["-loop", "1", "-i", cueImagePath]);

  if (cues.length === 0) {
    throw new Error("At least one subtitle cue is required for burn-in.");
  }

  const filterPieces: string[] = [];
  let currentLabel = "[0:v]";

  cues.forEach((cue, index) => {
    const nextLabel = `[sub${index + 1}]`;
    filterPieces.push(
      `${currentLabel}[${index + 1}:v]overlay=0:0:shortest=1:enable='between(t,${cue.startSeconds.toFixed(3)},${cue.endSeconds.toFixed(3)})'${nextLabel}`,
    );
    currentLabel = nextLabel;
  });

  return {
    filterComplex: filterPieces.join(";"),
    inputs,
  };
}

async function runFfmpegCommand(
  sermonId: string,
  args: string[],
  label: string,
  jobId: string,
  binaryPath?: string,
): Promise<SubtitleRunResult> {
  const command = commandFor(binaryPath);
  await appendPipelineLog(sermonId, `Running FFmpeg for ${label}.`);
  await appendJobLog(jobId, `Running FFmpeg for ${label}.`);

  return new Promise<SubtitleRunResult>((resolve, reject) => {
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

function getTempBurnPath(exportPath: string): string {
  return exportPath.replace(/\.mp4$/i, ".subtitled.tmp.mp4");
}

async function loadExportedClip(clipId: string): Promise<ExportedClip & { sermonTitle: string }> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId.trim() },
    select: {
      id: true,
      sermonId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      status: true,
      exportPath: true,
      srtPath: true,
      subtitlesGenerated: true,
      subtitlesBurned: true,
      sermon: {
        select: {
          title: true,
        },
      },
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return {
    ...clip,
    sermonTitle: clip.sermon.title,
  };
}

async function loadOverlappingSegments(sermonId: string, clip: ExportedClip): Promise<TranscriptSegment[]> {
  return prisma.transcriptSegment.findMany({
    where: {
      sermonId,
      startTimeSeconds: {
        lt: clip.endTimeSeconds,
      },
      endTimeSeconds: {
        gt: clip.startTimeSeconds,
      },
    },
    orderBy: {
      startTimeSeconds: "asc",
    },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      text: true,
    },
  });
}

async function generateSrtForClipCore(
  clip: ExportedClip,
  options: SubtitleOptions | undefined,
  jobId: string,
): Promise<{ clipId: string; srtPath: string; reusedExistingFile: boolean }> {
  validateClipTiming(clip);

  if (clip.status !== "EXPORTED") {
    throw new Error(`Clip ${clip.id} must be exported before subtitles can be generated.`);
  }

  await ensureSermonFolders(clip.sermonId);
  const srtPath = getClipSrtPath(clip.sermonId, clip.id);
  const existingSrt = await fileExists(srtPath);

  if (existingSrt && !options?.force) {
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        srtPath,
        subtitlesGenerated: true,
      },
    });

    await appendJobLog(jobId, `Reused existing SRT for ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Reused existing SRT for ${clip.id}.`);

    return {
      clipId: clip.id,
      srtPath,
      reusedExistingFile: true,
    };
  }

  const segments = await loadOverlappingSegments(clip.sermonId, clip);
  if (segments.length === 0) {
    throw new Error(`No transcript segments overlap clip ${clip.id}.`);
  }

  const srtContent = buildSrtContent(clip, segments);
  await writeFile(srtPath, srtContent, "utf8");

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      srtPath,
      subtitlesGenerated: true,
    },
  });

  await appendJobLog(jobId, `Generated SRT for ${clip.id} at ${srtPath}.`);
  await appendPipelineLog(clip.sermonId, `Generated SRT for clip ${clip.id}.`);

  return {
    clipId: clip.id,
    srtPath,
    reusedExistingFile: false,
  };
}

async function burnSubtitlesIntoClipCore(
  clip: ExportedClip,
  options: SubtitleOptions | undefined,
  jobId: string,
): Promise<{ clipId: string; exportPath: string; reusedExistingFile: boolean }> {
  validateClipTiming(clip);

  if (clip.status !== "EXPORTED") {
    throw new Error(`Clip ${clip.id} must be exported before subtitles can be burned in.`);
  }

  await ensureSermonFolders(clip.sermonId);

  const exportPath = clip.exportPath?.trim() || getClipOutputPath(clip.sermonId, clip.id);
  const exportExists = await fileExists(exportPath);
  if (!exportExists) {
    throw new Error(`Exported MP4 was not found for clip ${clip.id}.`);
  }

  const srtPath = clip.srtPath?.trim() || getClipSrtPath(clip.sermonId, clip.id);
  const srtExists = await fileExists(srtPath);
  if (!srtExists) {
    throw new Error(`SRT file was not found for clip ${clip.id}. Generate subtitles first.`);
  }

  if (clip.subtitlesBurned && !options?.force) {
    if (!clip.exportPath) {
      await prisma.clipCandidate.update({
        where: { id: clip.id },
        data: {
          exportPath,
        },
      });
    }

    await appendJobLog(jobId, `Reused existing burned subtitles for ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Reused existing burned subtitles for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      exportPath,
      reusedExistingFile: true,
    };
  }

  const tempOutputPath = getTempBurnPath(exportPath);
  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    throw new Error("FFmpeg is not installed or not executable.");
  }

  const srtContent = await readFile(srtPath, "utf8");
  const cues = parseSrtContent(srtContent);
  const subtitleAssetFolder = path.join(getClipFolderPath(clip.sermonId), ".subtitle-assets", clip.id);
  await mkdir(subtitleAssetFolder, { recursive: true });

  const cueImagePaths: string[] = [];
  try {
    for (const [index, cue] of cues.entries()) {
      const cueImagePath = path.join(subtitleAssetFolder, `${String(index + 1).padStart(4, "0")}.png`);
      await renderSubtitleCueImage(cue, cueImagePath);
      cueImagePaths.push(cueImagePath);
    }

    const burnChain = buildBurnOverlayChain(cues, cueImagePaths);
    const runResult = await runFfmpegCommand(
      clip.sermonId,
      [
        "-y",
        "-i",
        exportPath,
        ...burnChain.inputs,
        "-filter_complex",
        burnChain.filterComplex,
        "-map",
        `[sub${cues.length}]`,
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        tempOutputPath,
      ],
      `subtitle burn for clip ${clip.id}`,
      jobId,
      options?.ffmpegPath,
    );

    try {
      await rename(tempOutputPath, exportPath);
    } catch (renameError) {
      await unlink(tempOutputPath).catch(() => undefined);
      throw renameError;
    }

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        exportPath,
        srtPath,
        subtitlesGenerated: true,
        subtitlesBurned: true,
      },
    });

    const logs = `Subtitle burn complete for ${clip.id}.\nSTDOUT:\n${runResult.stdout}\nSTDERR:\n${runResult.stderr}`.slice(-30000);
    await appendJobLog(jobId, `Burned subtitles into ${clip.id}.`);
    await appendJobLog(jobId, logs);
    await appendPipelineLog(clip.sermonId, `Burned subtitles into clip ${clip.id}.`);

    return {
      clipId: clip.id,
      exportPath,
      reusedExistingFile: false,
    };
  } finally {
    for (const cueImagePath of cueImagePaths) {
      await unlink(cueImagePath).catch(() => undefined);
    }
    await rm(subtitleAssetFolder, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function generateSrtForClip(
  clipId: string,
  options?: SubtitleOptions,
): Promise<{ clipId: string; srtPath: string; reusedExistingFile: boolean }> {
  const clip = await loadExportedClip(clipId);
  const job = await createProcessingJob(clip.sermonId, "GENERATE_SUBTITLES");

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, "Subtitle generation job started.");
    await appendPipelineLog(clip.sermonId, `Subtitle generation requested for clip ${clip.id}.`);

    const result = await generateSrtForClipCore(clip, options, job.id);

    await markJobSucceeded(
      job.id,
      result.reusedExistingFile ? `Reused existing SRT for ${clip.id}.` : `Generated SRT for ${clip.id}.`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown subtitle generation error.";
    await markJobFailed(job.id, message, "Subtitle generation failed.");
    await appendPipelineLog(clip.sermonId, `Subtitle generation failed for clip ${clip.id}: ${message}`);
    throw new Error(message);
  }
}

export async function burnSubtitlesIntoClip(
  clipId: string,
  options?: SubtitleOptions,
): Promise<{ clipId: string; exportPath: string; reusedExistingFile: boolean }> {
  const clip = await loadExportedClip(clipId);
  const job = await createProcessingJob(clip.sermonId, "BURN_SUBTITLES");

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, "Subtitle burn job started.");
    await appendPipelineLog(clip.sermonId, `Subtitle burn requested for clip ${clip.id}.`);

    const result = await burnSubtitlesIntoClipCore(clip, options, job.id);

    await markJobSucceeded(
      job.id,
      result.reusedExistingFile ? `Reused existing burned subtitles for ${clip.id}.` : `Burned subtitles for ${clip.id}.`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown subtitle burn error.";
    await markJobFailed(job.id, message, "Subtitle burn failed.");
    await appendPipelineLog(clip.sermonId, `Subtitle burn failed for clip ${clip.id}: ${message}`);
    throw new Error(message);
  }
}

export async function generateAndBurnSubtitlesForExportedClips(
  sermonId: string,
  options?: SubtitleOptions,
): Promise<{ exportedClipCount: number; generatedCount: number; burnedCount: number }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId.trim() },
    select: {
      id: true,
      title: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id);

  const exportedClips = (await prisma.clipCandidate.findMany({
    where: {
      sermonId: sermon.id,
      status: "EXPORTED",
    },
    orderBy: [{ startTimeSeconds: "asc" }],
    select: {
      id: true,
      sermonId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      status: true,
      exportPath: true,
      srtPath: true,
      subtitlesGenerated: true,
      subtitlesBurned: true,
    },
  })) as ExportedClip[];

  const generateJob = await createProcessingJob(sermon.id, "GENERATE_SUBTITLES");
  const burnJob = await createProcessingJob(sermon.id, "BURN_SUBTITLES");

  await markJobRunning(generateJob.id);
  await appendJobLog(generateJob.id, "Bulk subtitle generation job started.");
  await appendPipelineLog(sermon.id, "Bulk subtitle generation requested.");

  if (exportedClips.length === 0) {
    const message = "No exported clips are available for subtitle generation.";
    await markJobFailed(generateJob.id, message, "No exported clips found.");
    await appendPipelineLog(sermon.id, message);
    await appendJobLog(burnJob.id, "Burn job skipped because no exported clips were available.");
    await markJobFailed(burnJob.id, message, "Subtitle burn skipped.");
    throw new Error(message);
  }

  let generatedCount = 0;
  let burnedCount = 0;

  try {
    for (const clip of exportedClips) {
      await generateSrtForClipCore(clip, options, generateJob.id);
      generatedCount += 1;
    }

    await markJobSucceeded(generateJob.id, `Generated subtitles for ${generatedCount} exported clip(s).`);
    await appendPipelineLog(sermon.id, `Generated subtitles for ${generatedCount} exported clip(s).`);

    await markJobRunning(burnJob.id);
    await appendJobLog(burnJob.id, "Bulk subtitle burn job started.");
    await appendPipelineLog(sermon.id, "Bulk subtitle burn requested.");

    for (const clip of exportedClips) {
      await burnSubtitlesIntoClipCore(clip, options, burnJob.id);
      burnedCount += 1;
    }

    await markJobSucceeded(burnJob.id, `Burned subtitles into ${burnedCount} exported clip(s).`);
    await appendPipelineLog(sermon.id, `Burned subtitles into ${burnedCount} exported clip(s).`);

    return {
      exportedClipCount: exportedClips.length,
      generatedCount,
      burnedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bulk subtitle error.";

    if ((await prisma.processingJob.findUnique({ where: { id: burnJob.id }, select: { status: true } }))?.status !== "SUCCEEDED") {
      await markJobFailed(burnJob.id, message, "Subtitle burn failed.");
    }

    if ((await prisma.processingJob.findUnique({ where: { id: generateJob.id }, select: { status: true } }))?.status !== "SUCCEEDED") {
      await markJobFailed(generateJob.id, message, "Subtitle generation failed.");
    }

    await appendPipelineLog(sermon.id, `Subtitle processing failed: ${message}`);
    throw new Error(message);
  }
}