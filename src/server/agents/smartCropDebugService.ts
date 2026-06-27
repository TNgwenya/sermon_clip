import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { normalizeManualCropKeyframes } from "@/lib/manualCrop";
import { getSharp } from "@/server/agents/sharpClient";
import { getSourceVideoPath, getSermonStoragePath } from "@/server/agents/storage";
import { resolveSmartCropCenter, resolveSmartCropTimeline } from "@/server/agents/videoSubjectTrackingService";

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

async function extractDebugFrame(input: {
  sourceVideoPath: string;
  timeSeconds: number;
  outputPath: string;
  ffmpegPath?: string;
}): Promise<void> {
  const args = [
    "-y",
    "-ss",
    input.timeSeconds.toFixed(2),
    "-i",
    input.sourceVideoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-1",
    input.outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandFor(input.ffmpegPath), args, { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => reject(new Error(`FFmpeg debug frame extraction failed: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `FFmpeg debug frame extraction failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function generateSmartCropDebugSnapshot(
  clipId: string,
  options?: { ffmpegPath?: string },
): Promise<{ clipId: string; snapshotPath: string; warning: string | null }> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      manualCropKeyframes: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip ${clipId} was not found.`);
  }

  const sourceVideoPath = getSourceVideoPath(clip.sermonId);
  const startTimeSeconds = clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds;
  const endTimeSeconds = clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds;
  const durationSeconds = Math.max(0, endTimeSeconds - startTimeSeconds);
  const absoluteFrameTime = startTimeSeconds + durationSeconds / 2;
  const relativeFrameTime = durationSeconds / 2;
  const storageDir = path.join(getSermonStoragePath(clip.sermonId), "debug");
  await mkdir(storageDir, { recursive: true });

  const rawFramePath = path.join(storageDir, `${clip.id}.smart-crop-source.jpg`);
  const snapshotPath = path.join(storageDir, `${clip.id}.smart-crop-debug.jpg`);
  await extractDebugFrame({
    sourceVideoPath,
    timeSeconds: absoluteFrameTime,
    outputPath: rawFramePath,
    ffmpegPath: options?.ffmpegPath,
  });

  const sharp = await getSharp();
  const image = sharp(rawFramePath);
  const metadata = await image.metadata();
  const width = metadata.width ?? 640;
  const height = metadata.height ?? 360;
  const manualKeyframes = normalizeManualCropKeyframes(clip.manualCropKeyframes);
  const center = manualKeyframes.length > 0
    ? manualKeyframes.reduce((closest, keyframe) => Math.abs(keyframe.timeSeconds - relativeFrameTime) < Math.abs(closest.timeSeconds - relativeFrameTime) ? keyframe : closest, manualKeyframes[0])
    : await resolveSmartCropCenter(clip.id);
  const timeline = manualKeyframes.length > 0 ? [] : await resolveSmartCropTimeline(clip.id, { startTimeSeconds, endTimeSeconds });
  const nearestPoint = timeline.reduce<typeof timeline[number] | null>((closest, point) => {
    if (!closest) {
      return point;
    }
    return Math.abs(point.timeSeconds - relativeFrameTime) < Math.abs(closest.timeSeconds - relativeFrameTime) ? point : closest;
  }, null);
  const centerX = clamp01(("centerX" in (center ?? {}) ? center?.centerX : nearestPoint?.centerX) ?? 0.5);
  const cropWidth = Math.min(width, Math.round(height * 9 / 16));
  const cropX = Math.max(0, Math.min(width - cropWidth, Math.round(centerX * width - cropWidth / 2)));
  const subjectX = Math.round(centerX * width);
  const confidenceText = manualKeyframes.length > 0
    ? "manual crop"
    : nearestPoint
      ? `confidence ${(nearestPoint.confidence ?? 0).toFixed(2)}${nearestPoint.frozen ? " frozen" : nearestPoint.rejected ? " rejected" : nearestPoint.stabilized ? " stabilized" : ""}`
      : "no tracking point";
  const warning = manualKeyframes.length > 0 ? null : nearestPoint ? null : "No smart crop tracking point was available for this frame.";

  const sourceOverlaySvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${cropX}" y="0" width="${cropWidth}" height="${height}" fill="none" stroke="#00e5ff" stroke-width="6" />
      <line x1="${subjectX}" y1="0" x2="${subjectX}" y2="${height}" stroke="#ffcc00" stroke-width="4" stroke-dasharray="10 8" />
      <circle cx="${subjectX}" cy="${Math.round(height * 0.38)}" r="12" fill="#ffcc00" stroke="#111" stroke-width="3" />
      <rect x="16" y="16" width="${Math.min(width - 32, 430)}" height="54" rx="8" fill="rgba(0,0,0,0.72)" />
      <text x="32" y="50" font-family="Arial" font-size="22" fill="#fff">SMART_CROP debug - ${confidenceText}</text>
    </svg>
  `);
  const labelSvg = Buffer.from(`
    <svg width="${width + cropWidth}" height="${height + 44}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#07080b" />
      <text x="18" y="30" font-family="Arial" font-size="22" font-weight="700" fill="#e5f9ff">Original with smart-crop box</text>
      <text x="${width + 18}" y="30" font-family="Arial" font-size="22" font-weight="700" fill="#e5f9ff">Rendered crop preview</text>
    </svg>
  `);

  const sourcePanel = await image
    .composite([{ input: sourceOverlaySvg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  const cropPanel = await sharp(rawFramePath)
    .extract({ left: cropX, top: 0, width: cropWidth, height })
    .jpeg({ quality: 88 })
    .toBuffer();

  await sharp(labelSvg)
    .composite([
      { input: sourcePanel, left: 0, top: 44 },
      { input: cropPanel, left: width, top: 44 },
    ])
    .jpeg({ quality: 88 })
    .toFile(snapshotPath);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      smartCropDebugSnapshotPath: snapshotPath,
      smartCropDebugGeneratedAt: new Date(),
      smartCropDebugError: warning,
    },
  });

  return { clipId: clip.id, snapshotPath, warning };
}
