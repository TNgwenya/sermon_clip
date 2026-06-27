import type { VideoSubjectTrackKind, VideoSubjectTrackingSource } from "@prisma/client";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { getMediaDimensions } from "@/server/media/ffmpeg";
import { getSourceVideoPath } from "@/server/agents/storage";

export type VideoSubjectBox = {
  timeSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type VideoSubjectTrackSummary = {
  id: string;
  kind: VideoSubjectTrackKind;
  source: VideoSubjectTrackingSource;
  label: string;
  confidenceScore: number;
  sampleCount: number;
  centerX: number;
  centerY: number;
};

export type VideoTrackingResult = {
  clipId: string;
  trackCount: number;
  source: VideoSubjectTrackingSource;
};

type PersonDetection = {
  timeSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type SmartCropTimelinePoint = {
  timeSeconds: number;
  centerX: number;
  centerY: number;
  confidence?: number;
  stabilized?: boolean;
  rejected?: boolean;
  frozen?: boolean;
};

type CocoSsdModel = {
  detect(input: unknown): Promise<Array<{
    class: string;
    score: number;
    bbox: [number, number, number, number];
  }>>;
};

let cocoModelPromise: Promise<CocoSsdModel> | null = null;

type DynamicImport = <TModule = unknown>(specifier: string) => Promise<TModule>;
type VideoSubjectTrackDelegate = {
  findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  deleteMany(args: Record<string, unknown>): Promise<unknown>;
  createMany(args: Record<string, unknown>): Promise<unknown>;
};

const importOptionalModule = new Function("specifier", "return import(specifier)") as DynamicImport;

function getVideoSubjectTrackDelegate(client: unknown = prisma): VideoSubjectTrackDelegate | null {
  return (client as { videoSubjectTrack?: VideoSubjectTrackDelegate }).videoSubjectTrack ?? null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const INITIAL_MODEL_SAMPLE_INTERVAL_SECONDS = 1.5;

function detectionCenterX(detection: PersonDetection): number {
  return detection.x + detection.width / 2;
}

function detectionArea(detection: PersonDetection): number {
  return detection.width * detection.height;
}

function speakerPresenceBias(detection: PersonDetection): number {
  const centerY = detection.y + detection.height / 2;
  const bottom = detection.y + detection.height;
  const tallEnough = detection.height >= 0.42 ? 1 : 0.72;
  const notAudienceHead = centerY > 0.78 || detection.y > 0.62 ? 0.48 : 1;
  const notCeilingOrSign = bottom < 0.34 ? 0.58 : 1;
  const stageBand = detection.y >= 0.04 && detection.y <= 0.38 ? 1.12 : 0.94;

  return tallEnough * notAudienceHead * notCeilingOrSign * stageBand;
}

function scoreDetection(
  detection: PersonDetection,
  previousDetection?: PersonDetection | null,
  continuityBoost = 1,
): number {
  const area = detectionArea(detection);
  const centerX = detectionCenterX(detection);
  const centerBias = 1 - Math.abs(centerX - 0.5);
  if (!previousDetection) {
    return detection.confidence * area * (0.45 + centerBias * 0.55) * speakerPresenceBias(detection);
  }

  const previousCenterX = detectionCenterX(previousDetection);
  const previousArea = Math.max(0.0001, detectionArea(previousDetection));
  const continuityBias = Math.max(0, 1 - Math.abs(centerX - previousCenterX) * 2.4);
  const areaSimilarity = Math.max(0, 1 - Math.abs(area - previousArea) / previousArea);

  return (
    detection.confidence *
    (0.35 + area * 0.65) *
    (0.35 + centerBias * 0.65) *
    (0.2 + continuityBias * 0.8) *
    (0.4 + areaSimilarity * 0.6) *
    speakerPresenceBias(detection) *
    continuityBoost
  );
}

function freezeDetectionAtTime(previousDetection: PersonDetection, timeSeconds: number): PersonDetection {
  return {
    ...previousDetection,
    timeSeconds,
    confidence: Math.min(previousDetection.confidence, 0.34),
  };
}

function uniqueSortedTimes(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => Number(value.toFixed(2))))).sort((left, right) => left - right);
}

function centerMotionBetween(left: Pick<VideoSubjectBox, "x" | "width">, right: Pick<VideoSubjectBox, "x" | "width">): number {
  return Math.abs((left.x + left.width / 2) - (right.x + right.width / 2));
}

export function measureTrackingMotion(boxes: VideoSubjectBox[]): {
  averageMovement: number;
  maxMovement: number;
  lowConfidenceCount: number;
  movementProfile: "STATIC" | "NORMAL" | "HIGH" | "LOW_CONFIDENCE";
} {
  const sorted = [...boxes].sort((left, right) => left.timeSeconds - right.timeSeconds);
  if (sorted.length < 2) {
    return {
      averageMovement: 0,
      maxMovement: 0,
      lowConfidenceCount: sorted.filter((box) => box.confidence < 0.58).length,
      movementProfile: sorted.some((box) => box.confidence < 0.58) ? "LOW_CONFIDENCE" : "NORMAL",
    };
  }

  const movements: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    movements.push(centerMotionBetween(sorted[index - 1], sorted[index]));
  }

  const averageMovement = movements.reduce((sum, value) => sum + value, 0) / movements.length;
  const maxMovement = Math.max(...movements);
  const lowConfidenceCount = sorted.filter((box) => box.confidence < 0.58).length;
  const movementProfile =
    lowConfidenceCount > 0
      ? "LOW_CONFIDENCE"
      : maxMovement >= 0.18 || averageMovement >= 0.08
        ? "HIGH"
        : averageMovement <= 0.025 && maxMovement <= 0.06
          ? "STATIC"
          : "NORMAL";

  return {
    averageMovement: Number(averageMovement.toFixed(4)),
    maxMovement: Number(maxMovement.toFixed(4)),
    lowConfidenceCount,
    movementProfile,
  };
}

export function buildAdaptiveModelSampleTimes(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  boxes?: VideoSubjectBox[];
}): number[] {
  const { startTimeSeconds, endTimeSeconds } = input;
  const duration = Math.max(0, endTimeSeconds - startTimeSeconds);
  if (duration <= 0) {
    return [startTimeSeconds];
  }

  const profile = input.boxes && input.boxes.length > 0 ? measureTrackingMotion(input.boxes).movementProfile : "NORMAL";
  const interval =
    profile === "STATIC"
      ? 2.5
      : profile === "HIGH" || profile === "LOW_CONFIDENCE"
        ? 0.75
        : INITIAL_MODEL_SAMPLE_INTERVAL_SECONDS;
  const samples = [startTimeSeconds];
  for (
    let timeSeconds = startTimeSeconds + interval;
    timeSeconds < endTimeSeconds;
    timeSeconds += interval
  ) {
    samples.push(timeSeconds);
  }
  samples.push(endTimeSeconds);

  if (input.boxes && input.boxes.length > 0) {
    for (const box of input.boxes) {
      if (box.confidence < 0.58) {
        samples.push(Math.max(startTimeSeconds, box.timeSeconds - 0.5));
        samples.push(Math.min(endTimeSeconds, box.timeSeconds + 0.5));
      }
    }
  }

  return uniqueSortedTimes(samples);
}

export function buildModelSampleTimes(startTimeSeconds: number, endTimeSeconds: number): number[] {
  return buildAdaptiveModelSampleTimes({ startTimeSeconds, endTimeSeconds });
}

function ffmpegCommandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

async function extractFrame(input: {
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
    const child = spawn(ffmpegCommandFor(input.ffmpegPath), args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`FFmpeg frame extraction failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `FFmpeg frame extraction failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

async function loadCocoModel(): Promise<CocoSsdModel> {
  cocoModelPromise ??= Promise.all([
    importOptionalModule("@tensorflow/tfjs"),
    importOptionalModule<{ load(input: { base: string }): Promise<CocoSsdModel> }>("@tensorflow-models/coco-ssd"),
  ]).then(async ([, cocoSsd]) => cocoSsd.load({ base: "lite_mobilenet_v2" }) as Promise<CocoSsdModel>);

  return cocoModelPromise;
}

async function detectPeopleInFrame(framePath: string, timeSeconds: number): Promise<PersonDetection[]> {
  const [tf, model] = await Promise.all([
    importOptionalModule<{ tensor3d(data: Uint8Array, shape: [number, number, number], dtype: "int32"): { dispose(): void } }>("@tensorflow/tfjs"),
    loadCocoModel(),
  ]);
  const { data, info } = await sharp(framePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imageTensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels], "int32");

  try {
    const predictions = await model.detect(imageTensor);

    return predictions
      .filter((prediction) => prediction.class === "person" && prediction.score >= 0.45)
      .map((prediction) => {
        const [x, y, boxWidth, boxHeight] = prediction.bbox;
        return {
          timeSeconds,
          x: clamp01(x / info.width),
          y: clamp01(y / info.height),
          width: clamp01(boxWidth / info.width),
          height: clamp01(boxHeight / info.height),
          confidence: clamp01(prediction.score),
        };
      });
  } finally {
    imageTensor.dispose();
  }
}

export function selectPastorDetection(
  detections: PersonDetection[],
  previousDetection?: PersonDetection | null,
): PersonDetection | null {
  if (detections.length === 0) {
    return null;
  }

  if (!previousDetection) {
    return detections.slice().sort((left, right) => scoreDetection(right) - scoreDetection(left))[0];
  }

  const previousCenterX = detectionCenterX(previousDetection);
  const previousArea = Math.max(0.0001, detectionArea(previousDetection));
  const strictContinuityCandidates = detections.filter(
    (detection) => Math.abs(detectionCenterX(detection) - previousCenterX) <= 0.16,
  );

  if (strictContinuityCandidates.length > 0) {
    return strictContinuityCandidates
      .slice()
      .sort((left, right) => scoreDetection(right, previousDetection, 1.25) - scoreDetection(left, previousDetection, 1.25))[0];
  }

  const recoveryCandidates = detections.filter((detection) => {
    const centerDistance = Math.abs(detectionCenterX(detection) - previousCenterX);
    const area = detectionArea(detection);
    const areaRatio = area / previousArea;
    return centerDistance <= 0.24 && areaRatio >= 0.55 && areaRatio <= 1.8;
  });

  if (recoveryCandidates.length > 0) {
    return recoveryCandidates
      .slice()
      .sort((left, right) => scoreDetection(right, previousDetection, 1.1) - scoreDetection(left, previousDetection, 1.1))[0];
  }

  const bestCandidate = detections
    .slice()
    .sort((left, right) => scoreDetection(right, previousDetection) - scoreDetection(left, previousDetection))[0];
  const currentScore = scoreDetection(previousDetection, previousDetection, 1);
  const candidateScore = scoreDetection(bestCandidate, previousDetection, 1);

  return candidateScore > currentScore * 1.65 ? bestCandidate : null;
}

export function stabilizeSmartCropTimeline(input: {
  boxes: VideoSubjectBox[];
  boundaries: { startTimeSeconds: number; endTimeSeconds: number };
  source: VideoSubjectTrackingSource;
  sampleCount: number;
  hasBody?: boolean;
  hasFace?: boolean;
  hasSpeakerArea?: boolean;
}): SmartCropTimelinePoint[] {
  const sortedBoxes = input.boxes
    .filter((box) => box.timeSeconds >= input.boundaries.startTimeSeconds && box.timeSeconds <= input.boundaries.endTimeSeconds)
    .sort((left, right) => left.timeSeconds - right.timeSeconds);

  const points: SmartCropTimelinePoint[] = [];
  const maxStep = input.source === "HEURISTIC_CENTER" ? 0.06 : 0.12;
  const deadZone = input.source === "HEURISTIC_CENTER" ? 0.03 : 0.045;

  for (const [index, box] of sortedBoxes.entries()) {
    const rawCenterX = clamp01(box.x + box.width / 2);
    const rawCenterY = clamp01(box.y + box.height / 2);
    const previous = points.at(-1);
    const nextBox = sortedBoxes[index + 1];
    const nextCenterX = nextBox ? clamp01(nextBox.x + nextBox.width / 2) : null;
    const timeSeconds = Number((box.timeSeconds - input.boundaries.startTimeSeconds).toFixed(2));

    if (
      previous &&
      nextCenterX !== null &&
      Math.abs(rawCenterX - previous.centerX) > 0.24 &&
      Math.abs(nextCenterX - previous.centerX) < 0.16
    ) {
      points.push({
        timeSeconds,
        centerX: previous.centerX,
        centerY: previous.centerY,
        confidence: box.confidence,
        rejected: true,
        frozen: true,
      });
      continue;
    }

    if (previous && box.confidence < 0.35) {
      points.push({
        timeSeconds,
        centerX: previous.centerX,
        centerY: previous.centerY,
        confidence: box.confidence,
        frozen: true,
      });
      continue;
    }

    if (previous && box.confidence < 0.6 && nextCenterX !== null && Math.abs(nextCenterX - previous.centerX) < 0.12) {
      points.push({
        timeSeconds,
        centerX: Number(((previous.centerX + nextCenterX) / 2).toFixed(4)),
        centerY: rawCenterY,
        confidence: box.confidence,
        rejected: true,
        stabilized: true,
      });
      continue;
    }

    if (previous && Math.abs(rawCenterX - previous.centerX) <= deadZone) {
      points.push({
        timeSeconds,
        centerX: previous.centerX,
        centerY: previous.centerY,
        confidence: box.confidence,
        stabilized: true,
      });
      continue;
    }

    if (previous && Math.abs(rawCenterX - previous.centerX) > maxStep) {
      points.push({
        timeSeconds,
        centerX: Number((previous.centerX + Math.sign(rawCenterX - previous.centerX) * maxStep).toFixed(4)),
        centerY: rawCenterY,
        confidence: box.confidence,
        stabilized: true,
      });
      continue;
    }

    points.push({
      timeSeconds,
      centerX: rawCenterX,
      centerY: rawCenterY,
      confidence: box.confidence,
    });
  }

  return points;
}

export function inferModelTracksFromDetections(input: {
  detections: PersonDetection[];
}): Array<{
  kind: VideoSubjectTrackKind;
  label: string;
  confidenceScore: number;
  boxes: VideoSubjectBox[];
}> {
  const boxes = input.detections.map((detection) => ({
    timeSeconds: detection.timeSeconds,
    x: clamp01(detection.x),
    y: clamp01(detection.y),
    width: clamp01(detection.width),
    height: clamp01(detection.height),
    confidence: clamp01(detection.confidence),
  }));

  if (boxes.length === 0) {
    return [];
  }

  const confidenceScore = boxes.reduce((sum, box) => sum + box.confidence, 0) / boxes.length;
  const speakerBoxes = boxes.map((box) => ({
    ...box,
    x: clamp01(box.x - 0.06),
    y: clamp01(box.y - 0.08),
    width: clamp01(box.width + 0.12),
    height: clamp01(box.height + 0.16),
  }));
  const faceBoxes = boxes.map((box) => ({
    timeSeconds: box.timeSeconds,
    x: clamp01(box.x + box.width * 0.34),
    y: clamp01(box.y + box.height * 0.04),
    width: clamp01(box.width * 0.32),
    height: clamp01(box.height * 0.2),
    confidence: clamp01(box.confidence * 0.82),
  }));

  return [
    {
      kind: "FACE",
      label: "Detected face area",
      confidenceScore: clamp01(confidenceScore * 0.82),
      boxes: faceBoxes,
    },
    {
      kind: "BODY",
      label: "Detected pastor body",
      confidenceScore: clamp01(confidenceScore),
      boxes,
    },
    {
      kind: "SPEAKER_AREA",
      label: "Detected pastor area",
      confidenceScore: clamp01(Math.min(1, confidenceScore + 0.08)),
      boxes: speakerBoxes,
    },
  ];
}

async function inferModelTracks(input: {
  sourceVideoPath: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  ffmpegPath?: string;
}): Promise<Array<{
  kind: VideoSubjectTrackKind;
  label: string;
  confidenceScore: number;
  boxes: VideoSubjectBox[];
}>> {
  const sampleTimes = buildModelSampleTimes(input.startTimeSeconds, input.endTimeSeconds);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sermon-clip-tracking-"));

  try {
    const detections: PersonDetection[] = [];
    let previousDetection: PersonDetection | null = null;

    async function sampleAtTimes(times: number[], frameNamePrefix: string): Promise<void> {
      for (const [index, timeSeconds] of times.entries()) {
        const framePath = path.join(tempDir, `${frameNamePrefix}-${index}.jpg`);
        await extractFrame({
          sourceVideoPath: input.sourceVideoPath,
          timeSeconds,
          outputPath: framePath,
          ffmpegPath: input.ffmpegPath,
        });

        const selected = selectPastorDetection(await detectPeopleInFrame(framePath, timeSeconds), previousDetection);
        if (selected) {
          detections.push(selected);
          previousDetection = selected;
        } else if (previousDetection) {
          detections.push(freezeDetectionAtTime(previousDetection, timeSeconds));
        }
      }
    }

    await sampleAtTimes(sampleTimes, "frame");
    const adaptiveSampleTimes = buildAdaptiveModelSampleTimes({
      startTimeSeconds: input.startTimeSeconds,
      endTimeSeconds: input.endTimeSeconds,
      boxes: detections.map((detection) => ({
        timeSeconds: detection.timeSeconds,
        x: detection.x,
        y: detection.y,
        width: detection.width,
        height: detection.height,
        confidence: detection.confidence,
      })),
    }).filter((timeSeconds) => !sampleTimes.includes(timeSeconds));

    if (adaptiveSampleTimes.length > 0) {
      await sampleAtTimes(adaptiveSampleTimes, "adaptive-frame");
    }

    return inferModelTracksFromDetections({
      detections: detections.sort((left, right) => left.timeSeconds - right.timeSeconds),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function makeBoxes(input: {
  sampleTimes: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}): VideoSubjectBox[] {
  return input.sampleTimes.map((timeSeconds) => ({
    timeSeconds,
    x: clamp01(input.x),
    y: clamp01(input.y),
    width: clamp01(input.width),
    height: clamp01(input.height),
    confidence: clamp01(input.confidence),
  }));
}

function averageCenter(boxes: VideoSubjectBox[]): { centerX: number; centerY: number } {
  if (boxes.length === 0) {
    return { centerX: 0.5, centerY: 0.5 };
  }

  const totals = boxes.reduce(
    (acc, box) => ({
      x: acc.x + box.x + box.width / 2,
      y: acc.y + box.y + box.height / 2,
    }),
    { x: 0, y: 0 },
  );

  return {
    centerX: clamp01(totals.x / boxes.length),
    centerY: clamp01(totals.y / boxes.length),
  };
}

function boxesFromJson(value: unknown): VideoSubjectBox[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const box = item as Record<string, unknown>;
    const parsed: VideoSubjectBox = {
      timeSeconds: typeof box.timeSeconds === "number" ? box.timeSeconds : 0,
      x: typeof box.x === "number" ? clamp01(box.x) : 0.5,
      y: typeof box.y === "number" ? clamp01(box.y) : 0.2,
      width: typeof box.width === "number" ? clamp01(box.width) : 0.2,
      height: typeof box.height === "number" ? clamp01(box.height) : 0.6,
      confidence: typeof box.confidence === "number" ? clamp01(box.confidence) : 0.5,
    };
    return [parsed];
  });
}

export function inferHeuristicTracks(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
}): Array<{
  kind: VideoSubjectTrackKind;
  label: string;
  confidenceScore: number;
  boxes: VideoSubjectBox[];
}> {
  const sampleTimes = buildModelSampleTimes(input.startTimeSeconds, input.endTimeSeconds);
  const isVertical = input.sourceWidth !== null && input.sourceHeight !== null && input.sourceHeight > input.sourceWidth;
  const bodyWidth = isVertical ? 0.46 : 0.24;
  const bodyX = 0.5 - bodyWidth / 2;

  return [
    {
      kind: "FACE",
      label: "Estimated face position",
      confidenceScore: 0.48,
      boxes: makeBoxes({
        sampleTimes,
        x: 0.455,
        y: isVertical ? 0.08 : 0.14,
        width: 0.09,
        height: 0.12,
        confidence: 0.48,
      }),
    },
    {
      kind: "BODY",
      label: "Estimated body position",
      confidenceScore: 0.58,
      boxes: makeBoxes({
        sampleTimes,
        x: bodyX,
        y: isVertical ? 0.16 : 0.18,
        width: bodyWidth,
        height: isVertical ? 0.66 : 0.68,
        confidence: 0.58,
      }),
    },
    {
      kind: "SPEAKER_AREA",
      label: "Estimated pastor area",
      confidenceScore: 0.64,
      boxes: makeBoxes({
        sampleTimes,
        x: Math.max(0, bodyX - 0.06),
        y: isVertical ? 0.06 : 0.1,
        width: Math.min(1, bodyWidth + 0.12),
        height: isVertical ? 0.78 : 0.78,
        confidence: 0.64,
      }),
    },
  ];
}

export async function refreshVideoSubjectTracking(
  clipId: string,
  options?: { ffmpegPath?: string },
): Promise<VideoTrackingResult> {
  const videoSubjectTrack = getVideoSubjectTrackDelegate();
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip ${clipId} was not found.`);
  }

  if (!videoSubjectTrack) {
    return {
      clipId: clip.id,
      trackCount: 0,
      source: "HEURISTIC_CENTER",
    };
  }

  const sourceVideoPath = getSourceVideoPath(clip.sermonId);
  const dimensions = await getMediaDimensions(sourceVideoPath, options?.ffmpegPath).catch(() => null);
  const startTimeSeconds = clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds;
  const endTimeSeconds = clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds;
  const modelTracks = await inferModelTracks({
    sourceVideoPath,
    startTimeSeconds,
    endTimeSeconds,
    ffmpegPath: options?.ffmpegPath,
  }).catch(() => []);
  const source: VideoSubjectTrackingSource = modelTracks.length > 0 ? "MODEL" : "HEURISTIC_CENTER";
  const tracks = modelTracks.length > 0 ? modelTracks : inferHeuristicTracks({
    startTimeSeconds,
    endTimeSeconds,
    sourceWidth: dimensions?.width ?? null,
    sourceHeight: dimensions?.height ?? null,
  });

  await prisma.$transaction(async (tx) => {
    const txVideoSubjectTrack = getVideoSubjectTrackDelegate(tx);
    if (!txVideoSubjectTrack) {
      return;
    }

    await txVideoSubjectTrack.deleteMany({ where: { clipCandidateId: clip.id } });
    await txVideoSubjectTrack.createMany({
      data: tracks.map((track) => ({
        clipCandidateId: clip.id,
        sermonId: clip.sermonId,
        kind: track.kind,
        source,
        label: track.label,
        confidenceScore: track.confidenceScore,
        startTimeSeconds,
        endTimeSeconds,
        frameWidth: dimensions?.width ?? null,
        frameHeight: dimensions?.height ?? null,
        sampleCount: track.boxes.length,
        boxesJson: track.boxes,
      })),
    });
  });

  return {
    clipId: clip.id,
    trackCount: tracks.length,
    source,
  };
}

export async function listVideoSubjectTrackSummaries(clipId: string): Promise<VideoSubjectTrackSummary[]> {
  const videoSubjectTrack = getVideoSubjectTrackDelegate();
  if (!videoSubjectTrack) {
    return [];
  }

  const tracks = await videoSubjectTrack.findMany({
    where: { clipCandidateId: clipId },
    orderBy: [{ kind: "asc" }, { confidenceScore: "desc" }],
  });

  return tracks.map((track) => {
    const boxes = boxesFromJson(track.boxesJson);
    const center = averageCenter(boxes);
    return {
      id: String(track.id),
      kind: track.kind as VideoSubjectTrackKind,
      source: track.source as VideoSubjectTrackingSource,
      label: String(track.label),
      confidenceScore: Number(track.confidenceScore),
      sampleCount: Number(track.sampleCount),
      centerX: center.centerX,
      centerY: center.centerY,
    };
  });
}

export async function resolveSmartCropCenter(clipId: string): Promise<{ centerX: number; centerY: number } | null> {
  const videoSubjectTrack = getVideoSubjectTrackDelegate();
  if (!videoSubjectTrack) {
    return null;
  }

  const track = await videoSubjectTrack.findFirst({
    where: {
      clipCandidateId: clipId,
      kind: { in: ["SPEAKER_AREA", "BODY", "FACE"] },
    },
    orderBy: [{ kind: "desc" }, { confidenceScore: "desc" }],
  });

  if (!track) {
    return null;
  }

  return averageCenter(boxesFromJson(track.boxesJson));
}

export async function resolveSmartCropTimeline(
  clipId: string,
  boundaries: { startTimeSeconds: number; endTimeSeconds: number },
): Promise<SmartCropTimelinePoint[]> {
  const videoSubjectTrack = getVideoSubjectTrackDelegate();
  if (!videoSubjectTrack) {
    return [];
  }

  const track = await videoSubjectTrack.findFirst({
    where: {
      clipCandidateId: clipId,
      kind: { in: ["SPEAKER_AREA", "BODY", "FACE"] },
    },
    orderBy: [{ kind: "desc" }, { confidenceScore: "desc" }],
  });

  if (!track) {
    return [];
  }

  const relatedTracks = await videoSubjectTrack.findMany({
    where: { clipCandidateId: clipId },
  });

  return stabilizeSmartCropTimeline({
    boxes: boxesFromJson(track.boxesJson),
    boundaries,
    source: track.source as VideoSubjectTrackingSource,
    sampleCount: Number(track.sampleCount),
    hasBody: relatedTracks.some((item) => item.kind === "BODY"),
    hasFace: relatedTracks.some((item) => item.kind === "FACE"),
    hasSpeakerArea: relatedTracks.some((item) => item.kind === "SPEAKER_AREA"),
  });
}
