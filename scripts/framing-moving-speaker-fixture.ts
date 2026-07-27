import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import {
  buildResolvedFramingPlanDocument,
  resolveResolvedFramingPlanConsumption,
  type BuildResolvedFramingPlanInput,
  type ResolvedFramingPlanDocument,
  type ResolvedFramingTrackingPointInput,
} from "../src/lib/resolvedFramingPlan.ts";
import { buildVerticalFramingFilter } from "../src/lib/clipFraming.ts";
import type { FramingPersonality } from "../src/lib/clipExportSettings.ts";

export const FIXTURE_DURATION_SECONDS = 12;
export const FIXTURE_SOURCE_WIDTH = 1280;
export const FIXTURE_SOURCE_HEIGHT = 720;
export const FIXTURE_SUBJECT_WIDTH = 120;
export const FIXTURE_SUBJECT_HEIGHT = 220;
export const FIXTURE_OUTPUT_WIDTH = 360;
export const FIXTURE_OUTPUT_HEIGHT = 640;
export const FIXTURE_CONTACT_TIMES_SECONDS = [0.5, 6, 11.5] as const;
export const DEFAULT_FIXTURE_OUTPUT_DIR = "/private/tmp/sermon-clip-framing-visual-fixture";

const MOVING_SPEAKER_TRACKING_ANCHORS: ResolvedFramingTrackingPointInput[] = [
  { timeSeconds: 0, centerX: 0.18, centerY: 0.66, confidence: 0.98, sceneId: "scene-left-to-right" },
  { timeSeconds: 1.3, centerX: 0.31, centerY: 0.58, confidence: 0.97, sceneId: "scene-left-to-right" },
  { timeSeconds: 2.6, centerX: 0.51, centerY: 0.48, confidence: 0.98, sceneId: "scene-left-to-right" },
  { timeSeconds: 3.95, centerX: 0.79, centerY: 0.36, confidence: 0.97, sceneId: "scene-left-to-right" },
  { timeSeconds: 4, centerX: 0.81, centerY: 0.28, confidence: 0.98, sceneId: "scene-right-to-left", sceneCut: true },
  { timeSeconds: 5.3, centerX: 0.66, centerY: 0.38, confidence: 0.97, sceneId: "scene-right-to-left" },
  { timeSeconds: 6.6, centerX: 0.45, centerY: 0.5, confidence: 0.98, sceneId: "scene-right-to-left" },
  { timeSeconds: 7.95, centerX: 0.2, centerY: 0.65, confidence: 0.97, sceneId: "scene-right-to-left" },
  { timeSeconds: 8, centerX: 0.2, centerY: 0.62, confidence: 0.98, sceneId: "scene-rise-and-cross", sceneCut: true },
  { timeSeconds: 9.3, centerX: 0.38, centerY: 0.48, confidence: 0.97, sceneId: "scene-rise-and-cross" },
  { timeSeconds: 10.6, centerX: 0.61, centerY: 0.3, confidence: 0.98, sceneId: "scene-rise-and-cross" },
  { timeSeconds: 11.95, centerX: 0.82, centerY: 0.5, confidence: 0.97, sceneId: "scene-rise-and-cross" },
];

function interpolateTrackingAnchors(
  anchors: ResolvedFramingTrackingPointInput[],
  subdivisionsPerSegment = 4,
): ResolvedFramingTrackingPointInput[] {
  const result: ResolvedFramingTrackingPointInput[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    const sameScene = current.sceneId === next.sceneId;
    if (!sameScene) {
      result.push(current);
      continue;
    }

    for (let subdivision = 0; subdivision < subdivisionsPerSegment; subdivision += 1) {
      const progress = subdivision / subdivisionsPerSegment;
      result.push({
        timeSeconds: Number((
          current.timeSeconds + (next.timeSeconds - current.timeSeconds) * progress
        ).toFixed(3)),
        centerX: Number((
          current.centerX + (next.centerX - current.centerX) * progress
        ).toFixed(5)),
        centerY: Number((
          (current.centerY ?? 0.5) + ((next.centerY ?? 0.5) - (current.centerY ?? 0.5)) * progress
        ).toFixed(5)),
        confidence: Number((
          (current.confidence ?? 0.98)
          + ((next.confidence ?? 0.98) - (current.confidence ?? 0.98)) * progress
        ).toFixed(3)),
        sceneId: current.sceneId,
        sceneCut: subdivision === 0 ? current.sceneCut : false,
      });
    }
  }
  result.push(anchors.at(-1) ?? {
    timeSeconds: 0,
    centerX: 0.5,
    centerY: 0.5,
    confidence: 0.98,
    sceneId: "scene-left-to-right",
  });
  return result;
}

export const MOVING_SPEAKER_TRACKING_POINTS: ResolvedFramingTrackingPointInput[] =
  interpolateTrackingAnchors(MOVING_SPEAKER_TRACKING_ANCHORS);

export type FramingFixtureCase = {
  id: string;
  label: string;
  requestedLayout: BuildResolvedFramingPlanInput["requestedLayout"];
  requestedPersonality: FramingPersonality;
};

/**
 * These pairings mirror the six Studio choices. The canonical plan resolver,
 * rather than this fixture, decides each effective layout and fallback.
 */
export const FRAMING_FIXTURE_CASES: FramingFixtureCase[] = [
  {
    id: "auto-intelligent",
    label: "Auto",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "AUTO_INTELLIGENT",
  },
  {
    id: "speaker-focus",
    label: "Speaker Focus",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "SPEAKER_FOCUS",
  },
  {
    id: "worship-wide",
    label: "Worship Wide",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "WORSHIP_WIDE",
  },
  {
    id: "full-stage",
    label: "Full Stage",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "SAFE_FULL_STAGE",
  },
  {
    id: "centre-crop",
    label: "Centre Crop",
    requestedLayout: "CENTER_CROP",
    requestedPersonality: "AUTO_INTELLIGENT",
  },
  {
    id: "blurred-background",
    label: "Blurred Background",
    requestedLayout: "FIT_BLURRED_BACKGROUND",
    requestedPersonality: "AUTO_INTELLIGENT",
  },
];

type FfprobeVideo = {
  width: number;
  height: number;
  durationSeconds: number;
};

type RenderedFixtureCase = {
  fixtureCase: FramingFixtureCase;
  plan: ResolvedFramingPlanDocument;
  filterComplex: string;
  outputPath: string;
  video: FfprobeVideo;
  sha256: string;
  sizeBytes: number;
};

export function buildFixturePlans(): Array<{
  fixtureCase: FramingFixtureCase;
  plan: ResolvedFramingPlanDocument;
}> {
  return FRAMING_FIXTURE_CASES.map((fixtureCase) => ({
    fixtureCase,
    plan: buildResolvedFramingPlanDocument({
      clipCandidateId: `fixture-${fixtureCase.id}`,
      editPlanId: `fixture-plan-${fixtureCase.id}`,
      editPlanHash: `fixture-plan-hash-${fixtureCase.id}`,
      requestedLayout: fixtureCase.requestedLayout,
      requestedPersonality: fixtureCase.requestedPersonality,
      sourceGeometry: {
        width: FIXTURE_SOURCE_WIDTH,
        height: FIXTURE_SOURCE_HEIGHT,
        role: "ORIGINAL_SOURCE",
      },
      applicationMode: "APPLY_AT_BASE_RENDER",
      trackingSource: "MODEL",
      trackingPoints: MOVING_SPEAKER_TRACKING_POINTS,
      moment: {
        title: "A deterministic teaching moment",
        hook: "Keep moving with purpose",
        category: "Teaching",
        durationSeconds: FIXTURE_DURATION_SECONDS,
        emotionalImpactScore: 6,
        hookStrengthScore: 6,
        shareabilityScore: 6,
      },
    }),
  }));
}

export function buildMissingTrackingFallbackPlan(): ResolvedFramingPlanDocument {
  return buildResolvedFramingPlanDocument({
    clipCandidateId: "fixture-speaker-focus-no-tracking",
    editPlanId: "fixture-plan-speaker-focus-no-tracking",
    editPlanHash: "fixture-plan-hash-speaker-focus-no-tracking",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "SPEAKER_FOCUS",
    sourceGeometry: {
      width: FIXTURE_SOURCE_WIDTH,
      height: FIXTURE_SOURCE_HEIGHT,
      role: "ORIGINAL_SOURCE",
    },
    applicationMode: "APPLY_AT_BASE_RENDER",
    trackingSource: null,
    trackingPoints: [],
    moment: {
      title: "A deterministic teaching moment",
      category: "Teaching",
      durationSeconds: FIXTURE_DURATION_SECONDS,
    },
  });
}

export function buildFixtureFramingFilter(plan: ResolvedFramingPlanDocument): string {
  const consumption = resolveResolvedFramingPlanConsumption({
    plan,
    sourceRole: "ORIGINAL_SOURCE",
    outputWidth: plan.geometry.master.width,
    outputHeight: plan.geometry.master.height,
  });
  const framingFilter = buildVerticalFramingFilter(
    consumption.layout,
    {
      ...(consumption.smartCrop ?? {}),
      treatment: consumption.treatment,
    },
  );
  return `${framingFilter};[v]scale=${FIXTURE_OUTPUT_WIDTH}:${FIXTURE_OUTPUT_HEIGHT}[fixture_v]`;
}

export function buildTrackingBoxManifest() {
  return MOVING_SPEAKER_TRACKING_POINTS.map((point) => ({
    ...point,
    width: Number((FIXTURE_SUBJECT_WIDTH / FIXTURE_SOURCE_WIDTH).toFixed(6)),
    height: Number((FIXTURE_SUBJECT_HEIGHT / FIXTURE_SOURCE_HEIGHT).toFixed(6)),
    left: Number((point.centerX - (FIXTURE_SUBJECT_WIDTH / FIXTURE_SOURCE_WIDTH) / 2).toFixed(6)),
    top: Number(((point.centerY ?? 0.5) - (FIXTURE_SUBJECT_HEIGHT / FIXTURE_SOURCE_HEIGHT) / 2).toFixed(6)),
  }));
}

function buildPiecewiseLinearExpression(
  points: ResolvedFramingTrackingPointInput[],
  valueForPoint: (point: ResolvedFramingTrackingPointInput) => number,
): string {
  const ordered = [...points].sort((left, right) => left.timeSeconds - right.timeSeconds);
  let expression = valueForPoint(ordered.at(-1) ?? { timeSeconds: 0, centerX: 0.5 }).toFixed(3);

  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const currentValue = valueForPoint(current);
    const nextValue = valueForPoint(next);
    const duration = Math.max(0.001, next.timeSeconds - current.timeSeconds);
    const interpolation =
      `${currentValue.toFixed(3)}+(${(nextValue - currentValue).toFixed(3)})` +
      `*min(max((t-${current.timeSeconds.toFixed(3)})/${duration.toFixed(3)}\\,0)\\,1)`;
    expression = `if(lte(t\\,${next.timeSeconds.toFixed(3)})\\,${interpolation}\\,${expression})`;
  }

  return expression;
}

export function buildSyntheticSpeakerOverlayExpressions(): { x: string; y: string } {
  return {
    x: buildPiecewiseLinearExpression(
      MOVING_SPEAKER_TRACKING_POINTS,
      (point) => point.centerX * FIXTURE_SOURCE_WIDTH - FIXTURE_SUBJECT_WIDTH / 2,
    ),
    y: buildPiecewiseLinearExpression(
      MOVING_SPEAKER_TRACKING_POINTS,
      (point) => (point.centerY ?? 0.5) * FIXTURE_SOURCE_HEIGHT - FIXTURE_SUBJECT_HEIGHT / 2,
    ),
  };
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${command} exited with code ${code ?? "unknown"}: ${stderr.trim().slice(-2_000)}`,
      ));
    });
  });
}

async function probeVideo(filePath: string, ffprobePath: string): Promise<FfprobeVideo> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      filePath,
    ], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffprobe failed with code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });

  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.[0];
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function generateSyntheticSource(input: {
  outputPath: string;
  ffmpegPath: string;
}): Promise<void> {
  const overlay = buildSyntheticSpeakerOverlayExpressions();
  const stageFilter = [
    "[0:v]drawgrid=width=128:height=72:thickness=2:color=white@0.14",
    "drawbox=x=0:y=0:w=iw:h=22:color=0x2dd4bf:t=fill:enable='lt(t,4)'",
    "drawbox=x=0:y=0:w=iw:h=22:color=0xf97316:t=fill:enable='between(t,4,8)'",
    "drawbox=x=0:y=0:w=iw:h=22:color=0xa78bfa:t=fill:enable='gte(t,8)'[stage]",
  ].join(",");
  const subjectFilter = [
    "[1:v]drawbox=x=0:y=0:w=iw:h=ih:color=0x111827:t=8",
    "drawbox=x=42:y=18:w=36:h=36:color=white:t=fill",
    "drawbox=x=56:y=18:w=8:h=36:color=black:t=fill",
    "drawbox=x=20:y=85:w=80:h=8:color=0x111827:t=fill,format=yuva420p[subject]",
  ].join(",");
  const filter = [
    stageFilter,
    subjectFilter,
    `[stage][subject]overlay=x='${overlay.x}':y='${overlay.y}':eval=frame:shortest=1,format=yuv420p[v]`,
  ].join(";");

  await runCommand(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x10233e:s=${FIXTURE_SOURCE_WIDTH}x${FIXTURE_SOURCE_HEIGHT}:r=30:d=${FIXTURE_DURATION_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `color=c=0xfacc15:s=${FIXTURE_SUBJECT_WIDTH}x${FIXTURE_SUBJECT_HEIGHT}:r=30:d=${FIXTURE_DURATION_SECONDS}`,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}

async function renderFixtureCase(input: {
  sourcePath: string;
  outputPath: string;
  plan: ResolvedFramingPlanDocument;
  ffmpegPath: string;
}): Promise<{ filterComplex: string; video: FfprobeVideo }> {
  const filterComplex = buildFixtureFramingFilter(input.plan);
  await runCommand(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.sourcePath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[fixture_v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);

  return {
    filterComplex,
    video: {
      width: 0,
      height: 0,
      durationSeconds: 0,
    },
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textSvg(input: {
  width: number;
  height: number;
  lines: string[];
  fontSize?: number;
  x?: number;
  y?: number;
}): Buffer {
  const fontSize = input.fontSize ?? 20;
  const x = input.x ?? 12;
  const y = input.y ?? fontSize + 8;
  const lines = input.lines
    .map((line, index) => (
      `<text x="${x}" y="${y + index * (fontSize + 7)}" ` +
      `font-family="Arial, sans-serif" font-size="${fontSize}" fill="#f8fafc">${escapeXml(line)}</text>`
    ))
    .join("");
  return Buffer.from(
    `<svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`,
  );
}

async function extractFrame(input: {
  videoPath: string;
  outputPath: string;
  timeSeconds: number;
  width: number;
  height: number;
  ffmpegPath: string;
}): Promise<void> {
  await runCommand(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(input.timeSeconds),
    "-i",
    input.videoPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${input.width}:${input.height}`,
    input.outputPath,
  ]);
}

async function countVisibleSubjectPixels(framePath: string): Promise<number> {
  const { data, info } = await sharp(framePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (red >= 175 && green >= 120 && blue <= 95 && red - blue >= 90) {
      visiblePixels += 1;
    }
  }
  return visiblePixels;
}

async function createContactSheets(input: {
  outputDir: string;
  sourcePath: string;
  renderedCases: RenderedFixtureCase[];
  ffmpegPath: string;
}): Promise<{
  sourceContactSheetPath: string;
  framingContactSheetPath: string;
  subjectVisibilityPixels: Record<string, number[]>;
}> {
  const framesDir = path.join(input.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const sourceFrameWidth = 320;
  const sourceFrameHeight = 180;
  const sourceFramePaths: string[] = [];
  for (const timeSeconds of FIXTURE_CONTACT_TIMES_SECONDS) {
    const framePath = path.join(framesDir, `source-${timeSeconds.toFixed(1)}.png`);
    await extractFrame({
      videoPath: input.sourcePath,
      outputPath: framePath,
      timeSeconds,
      width: sourceFrameWidth,
      height: sourceFrameHeight,
      ffmpegPath: input.ffmpegPath,
    });
    sourceFramePaths.push(framePath);
  }

  const sourceHeaderHeight = 44;
  const sourceContactSheetPath = path.join(input.outputDir, "source-contact-sheet.png");
  await sharp({
    create: {
      width: sourceFrameWidth * sourceFramePaths.length,
      height: sourceHeaderHeight + sourceFrameHeight,
      channels: 4,
      background: "#08111f",
    },
  }).composite([
    ...FIXTURE_CONTACT_TIMES_SECONDS.map((time, index) => ({
      input: textSvg({
        width: sourceFrameWidth,
        height: sourceHeaderHeight,
        lines: [`t=${time.toFixed(1)}s`],
        fontSize: 20,
        x: 16,
        y: 28,
      }),
      left: index * sourceFrameWidth,
      top: 0,
    })),
    ...sourceFramePaths.map((framePath, index) => ({
      input: framePath,
      left: index * sourceFrameWidth,
      top: sourceHeaderHeight,
    })),
  ]).png().toFile(sourceContactSheetPath);

  const frameWidth = 180;
  const frameHeight = 320;
  const labelWidth = 220;
  const headerHeight = 48;
  const outputWidth = labelWidth + frameWidth * FIXTURE_CONTACT_TIMES_SECONDS.length;
  const outputHeight = headerHeight + frameHeight * input.renderedCases.length;
  const composites: sharp.OverlayOptions[] = [
    {
      input: textSvg({
        width: outputWidth,
        height: headerHeight,
        lines: [`Visual checks: start ${FIXTURE_CONTACT_TIMES_SECONDS[0]}s · mid ${FIXTURE_CONTACT_TIMES_SECONDS[1]}s · end ${FIXTURE_CONTACT_TIMES_SECONDS[2]}s`],
        fontSize: 19,
        x: 16,
        y: 31,
      }),
      left: 0,
      top: 0,
    },
  ];
  const subjectVisibilityPixels: Record<string, number[]> = {};

  for (let row = 0; row < input.renderedCases.length; row += 1) {
    const rendered = input.renderedCases[row];
    subjectVisibilityPixels[rendered.fixtureCase.id] = [];
    composites.push({
      input: textSvg({
        width: labelWidth,
        height: frameHeight,
        lines: [
          rendered.fixtureCase.label,
          rendered.plan.effective.treatment,
          rendered.plan.effective.shotStyle.replace("MOVING_SPEAKER_MEDIUM", "MOVING SPEAKER"),
          `${rendered.plan.effective.zoom.toFixed(2)}x · ${rendered.plan.effective.motionSmoothing}`,
        ],
        fontSize: 17,
        x: 12,
        y: 78,
      }),
      left: 0,
      top: headerHeight + row * frameHeight,
    });

    for (let column = 0; column < FIXTURE_CONTACT_TIMES_SECONDS.length; column += 1) {
      const timeSeconds = FIXTURE_CONTACT_TIMES_SECONDS[column];
      const framePath = path.join(framesDir, `${rendered.fixtureCase.id}-${timeSeconds.toFixed(1)}.png`);
      await extractFrame({
        videoPath: rendered.outputPath,
        outputPath: framePath,
        timeSeconds,
        width: frameWidth,
        height: frameHeight,
        ffmpegPath: input.ffmpegPath,
      });
      subjectVisibilityPixels[rendered.fixtureCase.id].push(
        await countVisibleSubjectPixels(framePath),
      );
      composites.push({
        input: framePath,
        left: labelWidth + column * frameWidth,
        top: headerHeight + row * frameHeight,
      });
    }
  }

  const framingContactSheetPath = path.join(input.outputDir, "framing-contact-sheet.png");
  await sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 4,
      background: "#08111f",
    },
  }).composite(composites).png().toFile(framingContactSheetPath);

  return { sourceContactSheetPath, framingContactSheetPath, subjectVisibilityPixels };
}

export async function generateMovingSpeakerFramingFixture(input?: {
  outputDir?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}): Promise<{
  outputDir: string;
  sourcePath: string;
  sourceContactSheetPath: string;
  framingContactSheetPath: string;
  manifestPath: string;
  renderedCases: RenderedFixtureCase[];
  fallbackCase: RenderedFixtureCase;
}> {
  const outputDir = path.resolve(input?.outputDir ?? DEFAULT_FIXTURE_OUTPUT_DIR);
  const ffmpegPath = input?.ffmpegPath ?? (process.env["FFMPEG_PATH"]?.trim() || "ffmpeg");
  const ffprobePath = input?.ffprobePath ?? (process.env["FFPROBE_PATH"]?.trim() || "ffprobe");
  await mkdir(outputDir, { recursive: true });

  const sourcePath = path.join(outputDir, "source-moving-speaker-16x9.mp4");
  await generateSyntheticSource({ outputPath: sourcePath, ffmpegPath });
  const sourceVideo = await probeVideo(sourcePath, ffprobePath);
  if (
    sourceVideo.width !== FIXTURE_SOURCE_WIDTH
    || sourceVideo.height !== FIXTURE_SOURCE_HEIGHT
    || sourceVideo.durationSeconds < FIXTURE_DURATION_SECONDS - 0.1
  ) {
    throw new Error(`Synthetic source probe failed: ${JSON.stringify(sourceVideo)}`);
  }

  const renderedCases: RenderedFixtureCase[] = [];
  for (const { fixtureCase, plan } of buildFixturePlans()) {
    const outputPath = path.join(outputDir, `${fixtureCase.id}.mp4`);
    const render = await renderFixtureCase({
      sourcePath,
      outputPath,
      plan,
      ffmpegPath,
    });
    const video = await probeVideo(outputPath, ffprobePath);
    if (
      video.width !== FIXTURE_OUTPUT_WIDTH
      || video.height !== FIXTURE_OUTPUT_HEIGHT
      || video.durationSeconds < FIXTURE_DURATION_SECONDS - 0.1
    ) {
      throw new Error(`${fixtureCase.label} probe failed: ${JSON.stringify(video)}`);
    }
    const fileStat = await stat(outputPath);
    renderedCases.push({
      fixtureCase,
      plan,
      filterComplex: render.filterComplex,
      outputPath,
      video,
      sha256: await hashFile(outputPath),
      sizeBytes: fileStat.size,
    });
  }

  const fallbackFixtureCase: FramingFixtureCase = {
    id: "speaker-focus-no-tracking-fallback",
    label: "Fallback: no track",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "SPEAKER_FOCUS",
  };
  const fallbackPlan = buildMissingTrackingFallbackPlan();
  const fallbackOutputPath = path.join(outputDir, `${fallbackFixtureCase.id}.mp4`);
  const fallbackRender = await renderFixtureCase({
    sourcePath,
    outputPath: fallbackOutputPath,
    plan: fallbackPlan,
    ffmpegPath,
  });
  const fallbackVideo = await probeVideo(fallbackOutputPath, ffprobePath);
  if (
    fallbackVideo.width !== FIXTURE_OUTPUT_WIDTH
    || fallbackVideo.height !== FIXTURE_OUTPUT_HEIGHT
    || fallbackVideo.durationSeconds < FIXTURE_DURATION_SECONDS - 0.1
  ) {
    throw new Error(`Fallback probe failed: ${JSON.stringify(fallbackVideo)}`);
  }
  const fallbackStat = await stat(fallbackOutputPath);
  const fallbackCase: RenderedFixtureCase = {
    fixtureCase: fallbackFixtureCase,
    plan: fallbackPlan,
    filterComplex: fallbackRender.filterComplex,
    outputPath: fallbackOutputPath,
    video: fallbackVideo,
    sha256: await hashFile(fallbackOutputPath),
    sizeBytes: fallbackStat.size,
  };

  const {
    sourceContactSheetPath,
    framingContactSheetPath,
    subjectVisibilityPixels,
  } = await createContactSheets({
    outputDir,
    sourcePath,
    renderedCases: [...renderedCases, fallbackCase],
    ffmpegPath,
  });
  for (const id of ["auto-intelligent", "speaker-focus"]) {
    const counts = subjectVisibilityPixels[id] ?? [];
    if (
      counts.length !== FIXTURE_CONTACT_TIMES_SECONDS.length
      || counts.some((count) => count < 100)
    ) {
      throw new Error(
        `${id} lost the tracked subject at a visual checkpoint: ${JSON.stringify(counts)}`,
      );
    }
  }
  const manifestPath = path.join(outputDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    deterministicInputs: {
      durationSeconds: FIXTURE_DURATION_SECONDS,
      sourceWidth: FIXTURE_SOURCE_WIDTH,
      sourceHeight: FIXTURE_SOURCE_HEIGHT,
      subjectWidth: FIXTURE_SUBJECT_WIDTH,
      subjectHeight: FIXTURE_SUBJECT_HEIGHT,
      contactTimesSeconds: FIXTURE_CONTACT_TIMES_SECONDS,
      trackingBoxes: buildTrackingBoxManifest(),
    },
    source: {
      filePath: sourcePath,
      video: sourceVideo,
      sha256: await hashFile(sourcePath),
      sizeBytes: (await stat(sourcePath)).size,
    },
    outputs: renderedCases.map((rendered) => ({
      id: rendered.fixtureCase.id,
      label: rendered.fixtureCase.label,
      filePath: rendered.outputPath,
      requested: rendered.plan.requested,
      effective: rendered.plan.effective,
      application: rendered.plan.application,
      resolution: rendered.plan.resolution,
      tracking: rendered.plan.tracking,
      safeBounds: rendered.plan.geometry.safeBounds,
      filterComplex: rendered.filterComplex,
      video: rendered.video,
      sha256: rendered.sha256,
      sizeBytes: rendered.sizeBytes,
    })),
    fallbackEvidence: {
      id: fallbackCase.fixtureCase.id,
      label: fallbackCase.fixtureCase.label,
      filePath: fallbackCase.outputPath,
      requested: fallbackCase.plan.requested,
      effective: fallbackCase.plan.effective,
      resolution: fallbackCase.plan.resolution,
      filterComplex: fallbackCase.filterComplex,
      video: fallbackCase.video,
      sha256: fallbackCase.sha256,
      sizeBytes: fallbackCase.sizeBytes,
    },
    evidence: {
      sourceContactSheetPath,
      framingContactSheetPath,
      subjectVisibilityPixels,
    },
  }, null, 2)}\n`, "utf8");

  return {
    outputDir,
    sourcePath,
    sourceContactSheetPath,
    framingContactSheetPath,
    manifestPath,
    renderedCases,
    fallbackCase,
  };
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  generateMovingSpeakerFramingFixture()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        outputDir: result.outputDir,
        sourcePath: result.sourcePath,
        sourceContactSheetPath: result.sourceContactSheetPath,
        framingContactSheetPath: result.framingContactSheetPath,
        manifestPath: result.manifestPath,
        outputs: result.renderedCases.map((rendered) => ({
          id: rendered.fixtureCase.id,
          filePath: rendered.outputPath,
          requested: rendered.plan.requested,
          effective: rendered.plan.effective,
          sha256: rendered.sha256,
        })),
        fallback: {
          filePath: result.fallbackCase.outputPath,
          resolution: result.fallbackCase.plan.resolution,
          sha256: result.fallbackCase.sha256,
        },
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
