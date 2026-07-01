import { readFile, stat } from "node:fs/promises";

import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { DownloadVideoButton } from "@/app/sermons/[id]/download-video-button";
import { ExtractAudioButton } from "@/app/sermons/[id]/extract-audio-button";
import { ProcessSermonButton } from "@/app/sermons/[id]/process-sermon-button";
import { TranscribeSermonButton } from "@/app/sermons/[id]/transcribe-sermon-button";
import { GenerateClipsButton } from "@/app/sermons/[id]/generate-clips-button";
import { ExportClipsButton } from "@/app/sermons/[id]/export-clips-button";
import { SubtitlesButton } from "@/app/sermons/[id]/subtitles-button";
import { RegenerationControls } from "@/app/sermons/[id]/regeneration-controls";
import { RedoClipGenerationButton } from "@/app/sermons/[id]/redo-clip-generation-button";
import { RetryFailedJobButton } from "@/app/sermons/[id]/retry-failed-job-button";
import { RepairFailedClipOperationsButton } from "@/app/sermons/[id]/repair-failed-clip-operations-button";
import { SermonLiveRefresh } from "@/app/sermons/[id]/sermon-live-refresh";
import { SermonDetailPreviewCard } from "@/app/sermons/[id]/sermon-detail-preview-card";
import { listBestPreviewCandidates } from "@/lib/clipPreview";
import { getAudioPath, getLogPath, getSourceVideoPath } from "@/server/agents/storage";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { pastorFriendlyError } from "@/lib/pastorFriendlyErrors";
import {
  derivePastorSermonWorkflow,
  isStaleActiveProcessingJob,
  pastorJobStepLabel,
  selectUnresolvedPastorFailedJobs,
} from "@/lib/pastorWorkflow";

type ClipStatus = "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
type BoundaryQuality = "GOOD" | "NEEDS_REVIEW" | "BAD";
type ClipRenderStatus = "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
type ClipExportStatus = "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
type ClipExportFormat = "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
type ClipExportLayoutStrategy = "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP";
type AssetFreshness = "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";

type RawClipCandidate = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  originalStartTimeSeconds: number | null;
  originalEndTimeSeconds: number | null;
  adjustedStartTimeSeconds: number | null;
  adjustedEndTimeSeconds: number | null;
  boundaryAdjustmentReason: string | null;
  boundaryQuality: BoundaryQuality;
  renderStatus: ClipRenderStatus;
  renderedAt: Date | null;
  renderError: string | null;
  renderedFilePath: string | null;
  renderedDurationSeconds: number | null;
  renderedSizeBytes: number | null;
  exportFormat: ClipExportFormat | null;
  exportStatus: ClipExportStatus;
  exportLayoutStrategy: ClipExportLayoutStrategy | null;
  exportedAt: Date | null;
  exportError: string | null;
  exportedFilePath: string | null;
  transcriptText: string;
  title: string;
  hook: string;
  caption: string;
  suggestedHook?: string | null;
  suggestedCaption?: string | null;
  hashtags: unknown;
  score: number;
  finalQualityScore?: number | null;
  qualityLabel?: ClipQualityLabel | null;
  qualityReasons?: unknown;
  qualityWarnings?: unknown;
  rawAiCandidate?: unknown;
  qualityDebugSnapshot?: unknown;
  rankingCategory?: string | null;
  hookScore?: number | null;
  arcCompletenessScore?: number | null;
  visualConfidenceScore?: number | null;
  audioQualityScore?: number | null;
  captionQualityScore?: number | null;
  bestPlatform?: string | null;
  postReadyStatus?: ClipQualityLabel | null;
  postReadyReasons?: unknown;
  postReadyBlockers?: unknown;
  recommendedNextAction?: string | null;
  videoSubjectTracks?: Array<{
    kind: string;
    confidenceScore: number;
    sampleCount: number;
    boxesJson: unknown;
  }>;
  reasonSelected: string;
  clipType: string;
  smartClipCategory?: string | null;
  recommendationReason?: string | null;
  intendedAudience?: string | null;
  ministryValue?: string | null;
  socialValue?: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReasons: unknown;
  contextWarning: boolean;
  status: ClipStatus;
  exportPath?: string | null;
  srtPath?: string | null;
  subtitlesGenerated?: boolean;
  subtitlesBurned?: boolean;
  captionStatus?: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  subtitleFilePath?: string | null;
  captionGeneratedAt?: Date | null;
  captionGenerationError?: string | null;
  captionBurnStatus?: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  captionedVideoPath?: string | null;
  captionBurnedAt?: Date | null;
  captionBurnError?: string | null;
  overlayStatus?: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
  overlayVideoPath?: string | null;
  overlayRenderedAt?: Date | null;
  overlayRenderError?: string | null;
  renderFreshness: AssetFreshness;
  captionFreshness: AssetFreshness;
  captionBurnFreshness: AssetFreshness;
  overlayFreshness: AssetFreshness;
  exportFreshness: AssetFreshness;
  renderAssetVersion: number;
  captionAssetVersion: number;
  captionBurnAssetVersion: number;
  overlayAssetVersion: number;
  exportAssetVersion: number;
  assetInvalidationReason?: string | null;
};

type SermonStatus =
  | "CREATED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "AUDIO_EXTRACTING"
  | "AUDIO_EXTRACTED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "GENERATING_CLIPS"
  | "CLIPS_GENERATED"
  | "REVIEWING"
  | "EXPORTING"
  | "EXPORTED"
  | "FAILED";

type ProcessingJobListItem = {
  id: string;
  type: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  errorMessage: string | null;
  logs: string | null;
};

type SermonDetailItem = {
  id: string;
  title: string;
  youtubeUrl: string;
  speakerName: string;
  churchName: string;
  language: string;
  rightsConfirmed: boolean;
  sourceVideoPath: string | null;
  audioPath: string | null;
  transcriptJsonPath: string | null;
  status: SermonStatus;
  transcript: {
    fullText: string;
  } | null;
  sourceDurationSeconds: number | null;
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
  transcriptSegments: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>;
  clipCandidates: RawClipCandidate[];
  _count: {
    transcriptSegments: number;
  };
  processingJobs: ProcessingJobListItem[];
};

async function doesFileExist(filePath: string): Promise<boolean> {
  if (!canRunLocalMediaProcessing()) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function hasClipPreviewMedia(clip: Pick<
  RawClipCandidate,
  "exportedFilePath" | "captionedVideoPath" | "overlayVideoPath" | "renderedFilePath"
>): Promise<boolean> {
  const candidates = listBestPreviewCandidates(clip);
  if (candidates.length === 0) {
    return false;
  }

  const candidateReadiness = await Promise.all(candidates.map((candidate) => doesFileExist(candidate)));
  return candidateReadiness.some(Boolean);
}

type DownloadProgressSnapshot = {
  percent: number;
  totalLabel: string;
  downloadedLabel: string;
  currentPartLabel: string;
  speedLabel: string;
  etaLabel: string;
  etaSource: "steady" | "smoothed" | "instant";
  rawLine: string;
};

type DownloadLogSample = {
  capturedAtMs: number;
  percent: number;
  totalLabel: string;
  totalBytes: number | null;
  speedLabel: string;
  etaLabel: string;
  rawLine: string;
};

type AudioExtractionProgressSnapshot = {
  percent: number;
  processedLabel: string;
  speedLabel: string;
  etaLabel: string;
  rawLine: string;
};

type TranscriptionProgressSnapshot = {
  percent: number | null;
  chunkLabel: string;
  stageLabel: string;
  etaLabel: string;
  detail: string;
};

type OperationProgressView = {
  progressPercent: number | null;
  progressLabel: string;
  metricTwoLabel: string;
  metricTwoValue: string;
  metricTwoDetail?: string;
  metricThreeLabel: string;
  metricThreeValue: string;
  metricFourLabel: string;
  metricFourValue: string;
  metricFourDetail?: string;
  detail: string;
};

type DownloadPartGroup = {
  totalLabel: string;
  totalBytes: number;
  samples: DownloadLogSample[];
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function parseSizeLabel(value: string): number | null {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?i?B)$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplierByUnit: Record<string, number> = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
    tb: 1000 ** 4,
    tib: 1024 ** 4,
  };

  const multiplier = multiplierByUnit[unit];
  return multiplier ? amount * multiplier : null;
}

function parseSpeedLabel(value: string): number | null {
  const normalized = value.trim();
  if (/unknown/i.test(normalized)) {
    return null;
  }

  const bytesPerSecond = parseSizeLabel(normalized.replace(/\/s$/i, ""));
  return bytesPerSecond && bytesPerSecond > 0 ? bytesPerSecond : null;
}

function formatEta(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatSteadyEta(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds >= 600) {
    const roundedMinutes = Math.max(5, Math.ceil(safeSeconds / 300) * 5);
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${roundedMinutes} min`;
  }

  if (safeSeconds >= 60) {
    return `${Math.ceil(safeSeconds / 60)} min`;
  }

  return "under 1 min";
}

function parseClockSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

async function readPipelineLogTail(sermonId: string, maxCharacters = 2_000_000): Promise<string> {
  try {
    const logText = await readFile(/* turbopackIgnore: true */ getLogPath(sermonId), "utf8");
    return logText.slice(-maxCharacters);
  } catch {
    return "";
  }
}

function parseDownloadSamples(logText: string): DownloadLogSample[] {
  const normalized = logText.replace(/\r/g, "\n");
  const samples: DownloadLogSample[] = [];
  let currentCapturedAtMs: number | null = null;

  for (const line of normalized.split("\n")) {
    const timestampMatch = line.match(/^\[([^\]]+)\]/);
    if (timestampMatch) {
      const parsedTimestamp = Date.parse(timestampMatch[1]);
      if (Number.isFinite(parsedTimestamp)) {
        currentCapturedAtMs = parsedTimestamp;
      }
    }

    if (currentCapturedAtMs === null) {
      continue;
    }

    const downloadMatches = line.matchAll(/\[download\]\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+(.+?)\s+at\s+(.+?)\s+ETA\s+([^\n[]+)/g);
    for (const match of downloadMatches) {
      samples.push({
        capturedAtMs: currentCapturedAtMs,
        percent: Math.min(100, Math.max(0, Number(match[1]))),
        totalLabel: match[2].trim().replace(/\s+/g, " "),
        totalBytes: parseSizeLabel(match[2].trim().replace(/\s+/g, " ")),
        speedLabel: match[3].trim().replace(/\s+/g, " "),
        etaLabel: match[4].trim().replace(/\s+/g, " "),
        rawLine: match[0].replace(/\s+/g, " ").trim(),
      });
    }
  }

  return samples;
}

function groupDownloadParts(samples: DownloadLogSample[]): DownloadPartGroup[] {
  const groups = new Map<string, DownloadPartGroup>();

  for (const sample of samples) {
    if (!sample.totalBytes) {
      continue;
    }

    const existing = groups.get(sample.totalLabel);
    if (existing) {
      existing.samples.push(sample);
    } else {
      groups.set(sample.totalLabel, {
        totalLabel: sample.totalLabel,
        totalBytes: sample.totalBytes,
        samples: [sample],
      });
    }
  }

  return [...groups.values()];
}

function calculateCombinedDownloadProgress(groups: DownloadPartGroup[], currentGroup: DownloadPartGroup, latestPercent: number): {
  percent: number;
  downloadedLabel: string;
  totalLabel: string;
} | null {
  if (groups.length === 0) {
    return null;
  }

  const totalBytes = groups.reduce((sum, group) => sum + group.totalBytes, 0);
  if (totalBytes <= 0) {
    return null;
  }

  let downloadedBytes = 0;
  for (const group of groups) {
    if (group === currentGroup) {
      downloadedBytes += group.totalBytes * (latestPercent / 100);
      continue;
    }

    const groupLastSample = group.samples.at(-1);
    const currentFirstSample = currentGroup.samples[0];
    const isEarlierCompletedPart = groupLastSample && currentFirstSample && groupLastSample.capturedAtMs <= currentFirstSample.capturedAtMs;
    downloadedBytes += group.totalBytes * (isEarlierCompletedPart ? 1 : ((groupLastSample?.percent ?? 0) / 100));
  }

  return {
    percent: Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100)),
    downloadedLabel: formatBytes(downloadedBytes),
    totalLabel: formatBytes(totalBytes),
  };
}

function calculateSteadyEta(samples: DownloadLogSample[], totalBytes: number, latestPercent: number): string | null {
  const latestSample = samples.at(-1);
  if (!latestSample) {
    return null;
  }

  const candidates = samples
    .filter((sample) => {
      const elapsedSeconds = (latestSample.capturedAtMs - sample.capturedAtMs) / 1000;
      const percentDelta = latestPercent - sample.percent;
      return elapsedSeconds >= 300 && percentDelta >= 0.25;
    })
    .sort((a, b) => a.capturedAtMs - b.capturedAtMs);

  const referenceSample = candidates[0] ?? samples.find((sample) => {
    const elapsedSeconds = (latestSample.capturedAtMs - sample.capturedAtMs) / 1000;
    const percentDelta = latestPercent - sample.percent;
    return elapsedSeconds >= 60 && percentDelta >= 0.1;
  });

  if (!referenceSample) {
    return null;
  }

  const elapsedSeconds = (latestSample.capturedAtMs - referenceSample.capturedAtMs) / 1000;
  const downloadedBytes = totalBytes * ((latestPercent - referenceSample.percent) / 100);
  const effectiveBytesPerSecond = downloadedBytes / elapsedSeconds;
  if (!Number.isFinite(effectiveBytesPerSecond) || effectiveBytesPerSecond <= 0) {
    return null;
  }

  const remainingBytes = totalBytes * ((100 - latestPercent) / 100);
  return formatSteadyEta(remainingBytes / effectiveBytesPerSecond);
}

function parseLatestDownloadProgress(logText: string): DownloadProgressSnapshot | null {
  const samples = parseDownloadSamples(logText);
  const latest = samples.at(-1);
  if (!latest) {
    return null;
  }

  const latestPercent = latest.percent;
  const totalBytes = latest.totalBytes;
  const groups = groupDownloadParts(samples);
  const currentGroup = groups.find((group) => group.totalLabel === latest.totalLabel);
  const combinedProgress = currentGroup
    ? calculateCombinedDownloadProgress(groups, currentGroup, latestPercent)
    : null;
  const currentGroupSamples = currentGroup?.samples ?? samples;
  const recentSpeeds = currentGroupSamples
    .slice(-60)
    .map((sample) => parseSpeedLabel(sample.speedLabel))
    .filter((value): value is number => Boolean(value))
    .sort((a, b) => a - b);
  const trimmedSpeeds = recentSpeeds.length >= 8
    ? recentSpeeds.slice(
      Math.floor(recentSpeeds.length * 0.15),
      Math.ceil(recentSpeeds.length * 0.85),
    )
    : recentSpeeds;
  const smoothedSpeed = median(trimmedSpeeds);
  const smoothedEta =
    totalBytes && smoothedSpeed
      ? formatEta((totalBytes * (1 - latestPercent / 100)) / smoothedSpeed)
      : null;
  const steadyEta = totalBytes ? calculateSteadyEta(currentGroupSamples, totalBytes, latestPercent) : null;

  return {
    percent: combinedProgress?.percent ?? latestPercent,
    totalLabel: combinedProgress?.totalLabel ?? latest.totalLabel,
    downloadedLabel: combinedProgress?.downloadedLabel ?? formatBytes(totalBytes ? totalBytes * (latestPercent / 100) : 0),
    currentPartLabel: `Current part: ${latestPercent.toFixed(1)}% of ${latest.totalLabel}`,
    speedLabel: latest.speedLabel,
    etaLabel: steadyEta ?? smoothedEta ?? latest.etaLabel,
    etaSource: steadyEta ? "steady" : smoothedEta ? "smoothed" : "instant",
    rawLine: latest.rawLine,
  };
}

function parseAudioExtractionProgress(
  logText: string,
  sourceDurationSeconds: number | null,
): AudioExtractionProgressSnapshot | null {
  if (!sourceDurationSeconds || sourceDurationSeconds <= 0) {
    return null;
  }

  const normalized = logText.replace(/\r/g, "\n");
  const matches = [...normalized.matchAll(/\[ffmpeg stderr\].*?time=(\d+:\d{2}:\d{2}(?:\.\d+)?).*?speed=\s*([0-9.]+)x[^\n]*/g)];
  const latest = matches.at(-1);
  if (!latest) {
    return null;
  }

  const processedSeconds = parseClockSeconds(latest[1]);
  const speed = Number(latest[2]);
  if (processedSeconds === null || !Number.isFinite(speed) || speed <= 0) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, (processedSeconds / sourceDurationSeconds) * 100));
  const remainingSeconds = Math.max(0, sourceDurationSeconds - processedSeconds) / speed;

  return {
    percent,
    processedLabel: `${formatSecondsForProgress(processedSeconds)} / ${formatSecondsForProgress(sourceDurationSeconds)}`,
    speedLabel: `${Math.round(speed)}x realtime`,
    etaLabel: formatSteadyEta(remainingSeconds),
    rawLine: latest[0].replace(/\s+/g, " ").trim(),
  };
}

function formatSecondsForProgress(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function parseTranscriptionProgress(logText: string): TranscriptionProgressSnapshot | null {
  const normalized = logText.replace(/\r/g, "\n");
  const chunkMatches = [...normalized.matchAll(/Transcribing chunk\s+(\d+)\/(\d+)\s+\((\d+) bytes\)/g)];
  const latestChunk = chunkMatches.at(-1);
  if (latestChunk) {
    const current = Number(latestChunk[1]);
    const total = Number(latestChunk[2]);
    const completed = Math.max(0, current - 1);
    const percent = total > 0 ? Math.min(99, (completed / total) * 100) : null;
    return {
      percent,
      chunkLabel: `${current} of ${total}`,
      stageLabel: "Transcribing audio",
      etaLabel: "N/A",
      detail: `Currently sending chunk ${current} of ${total} for transcription.`,
    };
  }

  const chunkingMatches = [...normalized.matchAll(/\[ffmpeg chunking\].*?time=(\d+:\d{2}:\d{2}(?:\.\d+)?).*?speed=\s*([0-9.]+)x[^\n]*/g)];
  const latestChunking = chunkingMatches.at(-1);
  if (latestChunking) {
    const processedSeconds = parseClockSeconds(latestChunking[1]);
    const speed = Number(latestChunking[2]);
    return {
      percent: null,
      chunkLabel: processedSeconds !== null ? formatSecondsForProgress(processedSeconds) : "Preparing chunks",
      stageLabel: "Preparing audio chunks",
      etaLabel: Number.isFinite(speed) ? `${Math.round(speed)}x realtime` : "Working",
      detail: "Preparing the long audio file into smaller transcription chunks.",
    };
  }

  if (/Transcription requested/i.test(normalized)) {
    return {
      percent: null,
      chunkLabel: "Starting",
      stageLabel: "Preparing transcription",
      etaLabel: "Waiting",
      detail: "The app is preparing the audio for transcription.",
    };
  }

  return null;
}

function formatDateTime(value: Date | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatCompactCount(value: number): string {
  if (value > 99) {
    return "99+";
  }

  return String(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

const clipStatusOrder: Record<ClipStatus, number> = {
  APPROVED: 0,
  SUGGESTED: 1,
  EXPORTED: 2,
  REJECTED: 3,
};

const qualityLabelOrder: Record<ClipQualityLabel, number> = {
  POST_READY: 0,
  GOOD_NEEDS_REVIEW: 1,
  NEEDS_EDITING: 2,
  REJECT: 3,
};

const statusDescriptions: Record<SermonStatus, string> = {
  CREATED: "Record created and ready for processing.",
  DOWNLOADING: "Downloading source video.",
  DOWNLOADED: "Source video is available locally.",
  AUDIO_EXTRACTING: "Extracting audio from source video.",
  AUDIO_EXTRACTED: "Audio file is available locally.",
  TRANSCRIBING: "Generating transcript and timestamped segments.",
  TRANSCRIBED: "Transcript and segments are ready.",
  GENERATING_CLIPS: "Generating clip suggestions from transcript windows.",
  CLIPS_GENERATED: "Clip suggestions are ready for review.",
  REVIEWING: "Clip candidates are under human review.",
  EXPORTING: "Exporting approved clips.",
  EXPORTED: "At least one clip has been exported.",
  FAILED: "The latest processing attempt failed and needs attention.",
};

export default async function SermonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const localMediaAvailable = canRunLocalMediaProcessing();

  const sermon: SermonDetailItem | null = await prisma.sermon.findUnique({
    where: { id },
    include: {
      transcript: {
        select: {
          fullText: true,
        },
      },
      transcriptSegments: {
        orderBy: {
          startTimeSeconds: "asc",
        },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
        },
      },
      _count: {
        select: {
          transcriptSegments: true,
        },
      },
      clipCandidates: {
        orderBy: {
          score: "desc",
        },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          durationSeconds: true,
          originalStartTimeSeconds: true,
          originalEndTimeSeconds: true,
          adjustedStartTimeSeconds: true,
          adjustedEndTimeSeconds: true,
          boundaryAdjustmentReason: true,
          boundaryQuality: true,
          renderStatus: true,
          renderedAt: true,
          renderError: true,
          renderedFilePath: true,
          renderedDurationSeconds: true,
          renderedSizeBytes: true,
          exportFormat: true,
          exportStatus: true,
          exportLayoutStrategy: true,
          exportedAt: true,
          exportError: true,
          exportedFilePath: true,
          transcriptText: true,
          title: true,
          hook: true,
          caption: true,
          suggestedHook: true,
          suggestedCaption: true,
          hashtags: true,
          score: true,
          finalQualityScore: true,
          qualityLabel: true,
          qualityReasons: true,
          qualityWarnings: true,
          rawAiCandidate: true,
          qualityDebugSnapshot: true,
          rankingCategory: true,
          hookScore: true,
          arcCompletenessScore: true,
          visualConfidenceScore: true,
          audioQualityScore: true,
          captionQualityScore: true,
          bestPlatform: true,
          postReadyStatus: true,
          postReadyReasons: true,
          postReadyBlockers: true,
          recommendedNextAction: true,
          videoSubjectTracks: {
            select: {
              kind: true,
              confidenceScore: true,
              sampleCount: true,
              boxesJson: true,
            },
          },
          reasonSelected: true,
          clipType: true,
          smartClipCategory: true,
          recommendationReason: true,
          intendedAudience: true,
          ministryValue: true,
          socialValue: true,
          riskLevel: true,
          riskReasons: true,
          contextWarning: true,
          status: true,
          exportPath: true,
          srtPath: true,
          subtitlesGenerated: true,
          subtitlesBurned: true,
          captionStatus: true,
          subtitleFilePath: true,
          captionGeneratedAt: true,
          captionGenerationError: true,
          captionBurnStatus: true,
          captionedVideoPath: true,
          captionBurnedAt: true,
          captionBurnError: true,
          overlayStatus: true,
          overlayVideoPath: true,
          overlayRenderedAt: true,
          overlayRenderError: true,
          renderFreshness: true,
          captionFreshness: true,
          captionBurnFreshness: true,
          overlayFreshness: true,
          exportFreshness: true,
          renderAssetVersion: true,
          captionAssetVersion: true,
          captionBurnAssetVersion: true,
          overlayAssetVersion: true,
          exportAssetVersion: true,
          assetInvalidationReason: true,
        },
      },
      processingJobs: {
        orderBy: {
          createdAt: "desc",
        },
        take: 10,
      },
    },
  });

  if (!sermon) {
    notFound();
  }

  const processingJobs = sermon.processingJobs;
  const normalizedClipCandidates = sermon.clipCandidates.map((clip: RawClipCandidate) => ({
    ...clip,
    hashtags: normalizeStringArray(clip.hashtags),
    riskReasons: normalizeStringArray(clip.riskReasons),
    qualityReasons: normalizeStringArray(clip.qualityReasons),
    qualityWarnings: normalizeStringArray(clip.qualityWarnings),
    postReadyReasons: normalizeStringArray(clip.postReadyReasons),
    postReadyBlockers: normalizeStringArray(clip.postReadyBlockers),
  }));

  const orderedClipCandidates = [...normalizedClipCandidates].sort((a, b) => {
    const qualityDiff = qualityLabelOrder[a.qualityLabel ?? "NEEDS_EDITING"] - qualityLabelOrder[b.qualityLabel ?? "NEEDS_EDITING"];
    if (qualityDiff !== 0) {
      return qualityDiff;
    }

    const qualityScoreDiff = (b.finalQualityScore ?? b.score) - (a.finalQualityScore ?? a.score);
    if (qualityScoreDiff !== 0) {
      return qualityScoreDiff;
    }

    const statusDiff = clipStatusOrder[a.status] - clipStatusOrder[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    return b.score - a.score;
  });

  const clipCounts = orderedClipCandidates.reduce(
    (acc, clip) => {
      acc.total += 1;
      if (clip.status === "REJECTED") {
        acc.rejected += 1;
      } else if (clip.status === "EXPORTED" || clip.exportStatus === "COMPLETED") {
        acc.exported += 1;
      } else if (clip.status === "APPROVED") {
        acc.approved += 1;
      } else if (clip.status === "SUGGESTED") {
        acc.suggested += 1;
      }

      return acc;
    },
    { total: 0, approved: 0, suggested: 0, rejected: 0, exported: 0 },
  );

  const operationSummary = orderedClipCandidates.reduce(
    (acc, clip) => {
      if (clip.renderStatus === "RENDERING") {
        acc.running += 1;
      }
      if (clip.exportStatus === "EXPORTING") {
        acc.running += 1;
      }
      if (clip.captionStatus === "GENERATING") {
        acc.running += 1;
      }
      if (clip.captionBurnStatus === "BURNING") {
        acc.running += 1;
      }
      if (clip.overlayStatus === "RENDERING") {
        acc.running += 1;
      }

      if (clip.renderStatus === "FAILED") {
        acc.failed += 1;
      }
      if (clip.exportStatus === "FAILED") {
        acc.failed += 1;
      }
      if (clip.captionStatus === "FAILED") {
        acc.failed += 1;
      }
      if (clip.captionBurnStatus === "FAILED") {
        acc.failed += 1;
      }
      if (clip.overlayStatus === "FAILED") {
        acc.failed += 1;
      }

      const freshnessValues = [
        clip.renderFreshness,
        clip.captionFreshness,
        clip.captionBurnFreshness,
        clip.overlayFreshness,
        clip.exportFreshness,
      ];
      for (const freshness of freshnessValues) {
        if (freshness === "OUTDATED" || freshness === "NEEDS_REGENERATION") {
          acc.outdated += 1;
        }
      }

      return acc;
    },
    { running: 0, failed: 0, outdated: 0 },
  );

  const latestJob = processingJobs[0] ?? null;
  const hasSourceVideo = await doesFileExist(getSourceVideoPath(sermon.id));
  const pipelineLogTail = await readPipelineLogTail(sermon.id);
  const downloadProgress = parseLatestDownloadProgress(pipelineLogTail);
  const audioExtractionProgress = parseAudioExtractionProgress(pipelineLogTail, sermon.sourceDurationSeconds);
  const transcriptionProgress = parseTranscriptionProgress(pipelineLogTail);
  const hasAudioFile = await doesFileExist(getAudioPath(sermon.id));
  const readyClipCount = clipCounts.approved + clipCounts.exported;
  const hasReadyClips = readyClipCount > 0;
  const hasApprovedClips = clipCounts.approved > 0;
  const hasExportedClips = clipCounts.exported > 0;
  const hasTranscriptRecord = Boolean(sermon.transcript);
  const hasTranscriptSegments = sermon._count.transcriptSegments > 0;
  const clipGenerationComplete = sermon.clipCandidates.length > 0;
  const hasGeneratedCaptions = orderedClipCandidates.some((clip) => clip.captionStatus === "GENERATED");
  const hasRenderedApprovedClips = orderedClipCandidates.some(
    (clip) =>
      (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
      clip.renderStatus === "COMPLETED",
  );
  const hasCaptionBurnedClips = orderedClipCandidates.some(
    (clip) =>
      (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
      clip.captionBurnStatus === "COMPLETED",
  );
  const hasOverlayedClips = orderedClipCandidates.some(
    (clip) =>
      (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
      clip.overlayStatus === "COMPLETED",
  );
  const hasOutdatedAssets = operationSummary.outdated > 0;
  const unresolvedFailedJobs = selectUnresolvedPastorFailedJobs(processingJobs);
  const latestFailedJob = unresolvedFailedJobs[0] ?? null;
  const failedRecoveryCount = operationSummary.failed + unresolvedFailedJobs.length;
  const needsAttention = failedRecoveryCount > 0 || hasOutdatedAssets;
  const jobStatusByType = processingJobs.reduce<Record<string, string>>((acc, job) => {
    if (!(job.type in acc)) {
      acc[job.type] = job.status;
    }
    return acc;
  }, {});

  const processSteps = [
    {
      label: "Download video",
      complete: hasSourceVideo,
      jobType: "DOWNLOAD_VIDEO",
    },
    {
      label: "Extract audio",
      complete: hasAudioFile,
      jobType: "EXTRACT_AUDIO",
    },
    {
      label: "Transcribe sermon",
      complete: hasTranscriptRecord && hasTranscriptSegments && Boolean(sermon.transcriptJsonPath),
      jobType: "TRANSCRIBE_AUDIO",
    },
    {
      label: "Generate clip suggestions",
      complete: clipGenerationComplete,
      jobType: "GENERATE_CLIPS",
    },
    {
      label: "Review and approve clips",
      complete: hasReadyClips,
      jobType: null,
    },
    {
      label: "Export approved clips",
      complete: hasExportedClips,
      jobType: "EXPORT_CLIPS",
    },
    {
      label: "Generate clip captions",
      complete: hasGeneratedCaptions,
      jobType: "GENERATE_SUBTITLES",
    },
  ] as const;

  function getChecklistStatus(label: (typeof processSteps)[number]): string {
    if (!label.jobType) {
      return label.complete ? "Complete" : "Pending";
    }

    const jobStatus = jobStatusByType[label.jobType];
    if (jobStatus === "FAILED") {
      return "Failed";
    }

    const latestStepJob = processingJobs.find((job) => job.type === label.jobType);
    if (latestStepJob && isStaleActiveProcessingJob(latestStepJob)) {
      return "Stuck / retry";
    }

    if (jobStatus === "RUNNING") {
      return "Current / Running";
    }

    if (label.complete) {
      return jobStatus === "SUCCEEDED" ? "Complete" : "Complete";
    }

    if (jobStatus === "SUCCEEDED") {
      return "Complete";
    }

    if (jobStatus === "PENDING") {
      return "Pending";
    }

    return "Pending";
  }

  const processingTheaterSteps = processSteps.map((step) => {
    const status = getChecklistStatus(step);
    const stepJob = step.jobType ? processingJobs.find((job) => job.type === step.jobType) ?? null : null;
    return {
      ...step,
      status,
      latestJob: stepJob,
      detail: stepJob
        ? `${stepJob.status.toLowerCase()} · updated ${formatDateTime(stepJob.updatedAt)}`
        : step.complete
          ? "Complete"
          : "Waiting to start",
      state: status === "Failed" || status === "Stuck / retry"
        ? "failed"
        : status === "Current / Running"
          ? "active"
          : status === "Complete"
            ? "done"
            : "pending",
    };
  });
  const completedProcessingSteps = processingTheaterSteps.filter((step) => step.state === "done").length;
  const activeSermonStatuses = new Set<SermonStatus>([
    "DOWNLOADING",
    "AUDIO_EXTRACTING",
    "TRANSCRIBING",
    "GENERATING_CLIPS",
    "EXPORTING",
  ]);
  const hasLiveProcessingWork =
    operationSummary.running > 0 ||
    processingJobs.some((job) => (
      (job.status === "RUNNING" || job.status === "PENDING") &&
      !isStaleActiveProcessingJob(job)
    )) ||
    activeSermonStatuses.has(sermon.status);
  const activeProcessingStep = hasLiveProcessingWork
    ? processingTheaterSteps.find((step) => step.state === "active")
      ?? processingTheaterSteps.find((step) => step.state === "pending")
      ?? processingTheaterSteps[processingTheaterSteps.length - 1]
    : null;
  const activeJobProgressPercent =
    activeProcessingStep?.jobType === "DOWNLOAD_VIDEO" && downloadProgress
      ? Math.round(downloadProgress.percent)
      : activeProcessingStep?.state === "done"
        ? 100
        : activeProcessingStep?.state === "active"
          ? null
          : 0;
  const operationProgressView: OperationProgressView | null = activeProcessingStep
    ? activeProcessingStep.jobType === "DOWNLOAD_VIDEO" && downloadProgress
      ? {
        progressPercent: downloadProgress.percent,
        progressLabel: `${downloadProgress.percent.toFixed(1)}% of ${downloadProgress.totalLabel}`,
        metricTwoLabel: "Downloaded",
        metricTwoValue: downloadProgress.downloadedLabel,
        metricTwoDetail: "combined source",
        metricThreeLabel: "Speed",
        metricThreeValue: downloadProgress.speedLabel,
        metricFourLabel: "ETA",
        metricFourValue: downloadProgress.etaLabel,
        metricFourDetail: downloadProgress.etaSource === "steady" ? "steady estimate" : downloadProgress.etaSource === "smoothed" ? "stabilized" : undefined,
        detail: `${downloadProgress.currentPartLabel}. Latest signal: ${downloadProgress.rawLine.replace(/\s+ETA\s+.+$/, "")}`,
      }
      : activeProcessingStep.jobType === "EXTRACT_AUDIO" && audioExtractionProgress
        ? {
          progressPercent: audioExtractionProgress.percent,
          progressLabel: `${audioExtractionProgress.percent.toFixed(1)}%`,
          metricTwoLabel: "Audio position",
          metricTwoValue: audioExtractionProgress.processedLabel,
          metricTwoDetail: "of source video",
          metricThreeLabel: "Speed",
          metricThreeValue: audioExtractionProgress.speedLabel,
          metricFourLabel: "ETA",
          metricFourValue: audioExtractionProgress.etaLabel,
          metricFourDetail: "FFmpeg estimate",
          detail: `Audio extraction signal: ${audioExtractionProgress.rawLine}`,
        }
        : activeProcessingStep.jobType === "TRANSCRIBE_AUDIO" && transcriptionProgress
          ? {
            progressPercent: transcriptionProgress.percent,
            progressLabel: transcriptionProgress.percent === null ? "Working now" : `${Math.round(transcriptionProgress.percent)}%`,
            metricTwoLabel: "Chunk",
            metricTwoValue: transcriptionProgress.chunkLabel,
            metricTwoDetail: "transcription queue",
            metricThreeLabel: "Stage",
            metricThreeValue: transcriptionProgress.stageLabel,
            metricFourLabel: "ETA",
            metricFourValue: transcriptionProgress.etaLabel,
            detail: transcriptionProgress.detail,
          }
          : {
            progressPercent: activeJobProgressPercent,
            progressLabel: activeJobProgressPercent === null ? "Working now" : `${activeJobProgressPercent}%`,
            metricTwoLabel: "Status",
            metricTwoValue: activeProcessingStep.status,
            metricThreeLabel: "Stage",
            metricThreeValue: activeProcessingStep.label,
            metricFourLabel: "ETA",
            metricFourValue: "Unknown",
            detail: activeProcessingStep.latestJob?.logs
              ? `Latest note: ${activeProcessingStep.latestJob.logs.split("\n").at(-1)}`
              : "When this step reports measurable progress, it will appear here automatically.",
          }
    : null;
  const activeStepProgressFraction =
    activeProcessingStep?.state === "active" && operationProgressView
      ? (operationProgressView.progressPercent ?? activeJobProgressPercent ?? 25) / 100
      : 0;
  const processingProgressPercent = Math.min(
    100,
    Math.round(((completedProcessingSteps + activeStepProgressFraction) / processingTheaterSteps.length) * 100),
  );
  const pastorProcessingMessage = activeProcessingStep?.state === "done"
    ? "The sermon is ready for the next pastor action."
    : activeProcessingStep?.state === "failed"
      ? "One processing step needs attention before this sermon can keep moving."
      : activeProcessingStep?.state === "active"
        ? "Sermon Clip is working on this sermon now."
        : "This sermon is waiting for the next processing step.";
  const latestTheaterJob =
    activeProcessingStep && latestJob?.status === "FAILED" && activeProcessingStep.state !== "failed"
      ? processingJobs.find((job) => job.status !== "FAILED") ?? null
      : activeProcessingStep
        ? latestJob
        : null;

  const pastorWorkflow = derivePastorSermonWorkflow({
    sourceVideoReady: hasSourceVideo,
    transcriptReady: hasTranscriptRecord && hasTranscriptSegments,
    clipGenerationComplete,
    suggestedClipCount: orderedClipCandidates.length,
    approvedOrReadyClipCount: readyClipCount,
    preparedClipCount: clipCounts.exported,
    failedStepCount: failedRecoveryCount,
    staleClipCount: operationSummary.outdated,
    latestFailedStepType: latestFailedJob?.type ?? null,
  });
  const commandCenterTitle = failedRecoveryCount > 0
    ? "Resolve failed item"
    : hasLiveProcessingWork && activeProcessingStep
    ? activeProcessingStep.label
    : hasExportedClips
      ? "Ready to post"
      : clipCounts.suggested > 0 && !hasReadyClips
        ? "Review suggested clips"
    : pastorWorkflow.nextAction;
  const commandCenterDescription = failedRecoveryCount > 0
    ? `${failedRecoveryCount} failed ${failedRecoveryCount === 1 ? "item needs" : "items need"} attention before this sermon keeps moving. Open the hidden troubleshooting section when you are ready to retry.`
    : hasLiveProcessingWork && activeProcessingStep
      ? `${activeProcessingStep.label} is running now. Watch the live progress here until the next pastor step is ready.`
      : hasOutdatedAssets
        ? `${operationSummary.outdated} prepared ${operationSummary.outdated === 1 ? "asset needs" : "assets need"} a refresh before posting.`
        : hasExportedClips
          ? `${clipCounts.exported} ${clipCounts.exported === 1 ? "clip is" : "clips are"} ready to post. Open the queue to download or schedule.`
          : clipCounts.suggested > 0 && !hasReadyClips
            ? `${clipCounts.suggested} suggested ${clipCounts.suggested === 1 ? "clip is" : "clips are"} ready. Review the strongest moments next.`
            : hasApprovedClips
              ? `${clipCounts.approved} approved ${clipCounts.approved === 1 ? "clip is" : "clips are"} waiting to be prepared for posting.`
              : hasTranscriptRecord
                ? "The transcript is ready. Find clip moments next."
                : hasSourceVideo
                  ? "The sermon video is ready. Continue processing to create the transcript and clip suggestions."
                  : "Start processing this sermon to find clip moments.";
  const previewClips = orderedClipCandidates
    .filter((clip) => clip.status !== "REJECTED")
    .slice(0, 4);
  const previewableClipIds = new Set(
    (await Promise.all(
      previewClips.map(async (clip) => (await hasClipPreviewMedia(clip) ? clip.id : null)),
    )).filter((clipId): clipId is string => Boolean(clipId)),
  );
  const refreshItemCount = operationSummary.failed + operationSummary.outdated;

  const publishingChecklist = [
    {
      label: "Sermon video ready",
      ready: hasSourceVideo,
      detail: hasSourceVideo ? "The sermon video is available." : "Add or restore the sermon video.",
    },
    {
      label: "Sermon audio ready",
      ready: hasAudioFile,
      detail: hasAudioFile ? "The sermon audio is ready for transcription." : "Continue sermon processing.",
    },
    {
      label: "Transcript generated",
      ready: hasTranscriptRecord && hasTranscriptSegments,
      detail:
        hasTranscriptRecord && hasTranscriptSegments
          ? `Transcript exists with ${sermon._count.transcriptSegments} segments.`
          : "Create the sermon transcript.",
    },
    {
      label: "Clips discovered",
      ready: clipGenerationComplete,
      detail: clipGenerationComplete ? `${orderedClipCandidates.length} suggested clips are available.` : "Choose Find More Clip Moments.",
    },
    {
      label: "Clips approved",
      ready: hasReadyClips,
      detail: hasReadyClips ? `${readyClipCount} clip(s) are approved or exported.` : "Approve at least one clip.",
    },
    {
      label: "Video previews ready",
      ready: hasRenderedApprovedClips,
      detail: hasRenderedApprovedClips ? "At least one approved clip has a video preview." : "Prepare at least one approved clip.",
    },
    {
      label: "Captions complete",
      ready: hasGeneratedCaptions,
      detail: hasGeneratedCaptions ? "Captions exist for approved clips." : "Write captions for approved clips.",
    },
    {
      label: "Captions added to video",
      ready: hasCaptionBurnedClips,
      detail: hasCaptionBurnedClips ? "At least one clip has captions on the video." : "Prepare approved clips to add captions.",
    },
    {
      label: "Church branding added",
      ready: hasOverlayedClips,
      detail: hasOverlayedClips ? "At least one clip includes church branding." : "Prepare approved clips to add church branding.",
    },
    {
      label: "Downloads ready",
      ready: hasExportedClips,
      detail: hasExportedClips ? "Ready-to-post files are available for download." : "Prepare at least one approved clip.",
    },
    {
      label: "No unresolved failures",
      ready: !needsAttention,
      detail: needsAttention
        ? `There are ${operationSummary.failed} item(s) that need attention and ${operationSummary.outdated} clip(s) needing a refresh.`
        : "No clips currently need attention.",
    },
  ];

  return (
    <main className="container sermon-detail-shell stack-lg">
      <header className="sermon-detail-hero stack-sm">
        <p className="kicker">Sermon Detail</p>
        <h1>{sermon.title}</h1>
        <p className="muted">
          {sermon.speakerName} at {sermon.churchName}. {statusDescriptions[sermon.status]}
        </p>
      </header>

      <section className="sermon-command-center">
        <div className="sermon-command-copy stack-sm">
          <p className="kicker">Next best step</p>
          <h2>{commandCenterTitle}</h2>
          <p className="muted">{commandCenterDescription}</p>
          {needsAttention ? (
            <div className={`sermon-command-note${failedRecoveryCount > 0 ? " urgent" : ""}`}>
              <strong>
                {failedRecoveryCount > 0
                  ? `${failedRecoveryCount} failed ${failedRecoveryCount === 1 ? "item needs" : "items need"} attention`
                  : `${operationSummary.outdated} ${operationSummary.outdated === 1 ? "asset" : "assets"} need refresh`}
              </strong>
              <span>
                {failedRecoveryCount > 0
                  ? "Retry and repair controls stay tucked inside Troubleshoot this sermon."
                  : "Refresh prepared media before posting stale downloads."}
              </span>
            </div>
          ) : null}
          <div className="review-priority-actions">
            {failedRecoveryCount > 0 ? (
              <a href="#troubleshoot-this-sermon" className="button primary">
                Review failed item
              </a>
            ) : null}
            {failedRecoveryCount === 0 && hasLiveProcessingWork ? (
              <a href="#processing-progress" className="button primary">
                View live progress
              </a>
            ) : null}
            {failedRecoveryCount === 0 && !hasLiveProcessingWork && pastorWorkflow.primaryAction === "process" ? (
              <ProcessSermonButton sermonId={sermon.id} />
            ) : null}
            {failedRecoveryCount === 0 && !hasLiveProcessingWork && pastorWorkflow.primaryAction === "review" ? (
              <Link href={`/sermons/${sermon.id}/review`} className="button primary">
                Review suggested clips
              </Link>
            ) : null}
            {failedRecoveryCount === 0 && !hasLiveProcessingWork && pastorWorkflow.primaryAction === "prepare" ? (
              <Link href={`/sermons/${sermon.id}/review`} className="button primary">
                Prepare approved clips
              </Link>
            ) : null}
            {failedRecoveryCount === 0 && !hasLiveProcessingWork && pastorWorkflow.primaryAction === "post" ? (
              <Link href={`/ready-to-post?sermonId=${sermon.id}`} className="button primary">
                Open ready-to-post queue
              </Link>
            ) : null}
            {pastorWorkflow.primaryAction !== "review" && pastorWorkflow.primaryAction !== "prepare" ? (
              <Link href={`/sermons/${sermon.id}/review`} className="button secondary">
                Pastor Review Feed
              </Link>
            ) : null}
            <Link href={`/sermons/${sermon.id}/intelligence`} className="button tertiary">
              Ministry insights
            </Link>
          </div>
        </div>

        <div className="sermon-command-stats">
          <article>
            <span className="muted small">Suggested</span>
            <strong>{clipCounts.total}</strong>
          </article>
          <article>
            <span className="muted small">Approved</span>
            <strong>{clipCounts.approved}</strong>
          </article>
          <article>
            <span className="muted small">Ready</span>
            <strong>{clipCounts.exported}</strong>
          </article>
          <article>
            <span className="muted small">Refresh</span>
            <strong>{formatCompactCount(refreshItemCount)}</strong>
          </article>
        </div>
      </section>

      {previewClips.length > 0 ? (
        <section className="sermon-preview-strip" aria-label="Sermon clip previews">
          <div className="sermon-preview-strip-heading">
            <div>
              <p className="kicker">Clip previews</p>
              <h2>Review these before posting</h2>
            </div>
          </div>
          <div className="sermon-preview-grid">
            {previewClips.map((clip) => (
              <SermonDetailPreviewCard
                key={clip.id}
                sermonId={sermon.id}
                clip={clip}
                localMediaAvailable={localMediaAvailable}
                canPreviewVideo={previewableClipIds.has(clip.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {hasLiveProcessingWork && activeProcessingStep && operationProgressView ? (
      <section id="processing-progress" className="processing-theater" aria-label="Sermon processing progress">
        <div className="processing-theater-copy stack-sm">
          <p className="kicker">Processing progress</p>
          <h2>{activeProcessingStep.label}</h2>
          <p className="muted">{pastorProcessingMessage}</p>
          <div className="processing-progress-bar" aria-label={`${processingProgressPercent}% complete`}>
            <span style={{ width: `${processingProgressPercent}%` }} />
          </div>
          <p className="muted small">
            {processingProgressPercent}% complete · Current sermon status: {statusDescriptions[sermon.status]}
          </p>
          <div className="current-operation-card">
            <div className="current-operation-heading">
              <div>
                <p className="muted small">Current operation</p>
                <strong>{activeProcessingStep.label}</strong>
              </div>
              <span className={`operation-state-pill ${activeProcessingStep.state}`}>
                {activeProcessingStep.status}
              </span>
            </div>
            <div
              className={`processing-progress-bar ${operationProgressView.progressPercent === null ? "indeterminate" : ""}`}
              aria-label={`Current operation progress: ${operationProgressView.progressLabel}`}
            >
              <span style={{ width: `${operationProgressView.progressPercent ?? 55}%` }} />
            </div>
            <div className="operation-metrics-grid">
              <article>
                <span className="muted small">Progress</span>
                <strong>{operationProgressView.progressLabel}</strong>
              </article>
              <article>
                <span className="muted small">{operationProgressView.metricTwoLabel}</span>
                <strong>{operationProgressView.metricTwoValue}</strong>
                {operationProgressView.metricTwoDetail ? <span className="muted small">{operationProgressView.metricTwoDetail}</span> : null}
              </article>
              <article>
                <span className="muted small">{operationProgressView.metricThreeLabel}</span>
                <strong>{operationProgressView.metricThreeValue}</strong>
              </article>
              <article>
                <span className="muted small">{operationProgressView.metricFourLabel}</span>
                <strong>{operationProgressView.metricFourValue}</strong>
                {operationProgressView.metricFourDetail ? <span className="muted small">{operationProgressView.metricFourDetail}</span> : null}
              </article>
            </div>
            <p className="muted small">{operationProgressView.detail}</p>
          </div>
          {latestTheaterJob ? (
            <p className="muted small">
              Latest work: {pastorJobStepLabel(latestTheaterJob.type)} · {latestTheaterJob.status.toLowerCase()}
            </p>
          ) : (
            <p className="muted small">No background work has started yet.</p>
          )}
          <SermonLiveRefresh
            enabled={hasLiveProcessingWork}
            progressPercent={processingProgressPercent}
            activeStepLabel={activeProcessingStep.label}
          />
        </div>

        <div className="processing-step-grid">
          {processingTheaterSteps.map((step) => (
            <article key={step.label} className={`processing-step-card ${step.state}`}>
              <span className={`status-dot ${step.state === "done" ? "done" : "pending"} ${step.state === "failed" ? "failed" : ""} ${step.state === "active" ? "running" : ""}`} />
              <strong>{step.label}</strong>
              <span className="muted small">{step.status}</span>
              <span className="muted small">{step.detail}</span>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      <details id="troubleshoot-this-sermon" className="advanced-details troubleshoot-details">
        <summary>Troubleshoot this sermon</summary>
        <div className="stack-lg advanced-details-body">
          <section className="card stack-md">
            <div className="stack-sm">
              <p className="kicker">Recovery actions</p>
              <h2>Use only when a step fails or needs to be rerun</h2>
              <p className="muted">
                Most sermons should move from the live progress panel to Pastor Review without touching these controls. This area is for retrying a failed step, repairing prepared clip assets, or intentionally redoing clip discovery.
              </p>
            </div>
            <div className="troubleshoot-action-grid">
              <article className="troubleshoot-action-item">
                <h3>Video download</h3>
                <p className="muted small">
                  {hasSourceVideo ? "The sermon video is already available." : "Retry this if the source video never finishes downloading."}
                </p>
                <DownloadVideoButton sermonId={sermon.id} status={sermon.status} />
              </article>
              <article className="troubleshoot-action-item">
                <h3>Audio and transcript</h3>
                <p className="muted small">
                  Use these if the video downloaded but the app did not create audio or captions for clip discovery.
                </p>
                <ExtractAudioButton sermonId={sermon.id} status={sermon.status} hasSourceVideo={hasSourceVideo} />
                <TranscribeSermonButton sermonId={sermon.id} status={sermon.status} hasAudioFile={hasAudioFile} />
              </article>
              <article className="troubleshoot-action-item">
                <h3>Clip discovery</h3>
                <p className="muted small">
                  Use this when the transcript is ready but no useful suggested clips were created.
                </p>
                <GenerateClipsButton
                  sermonId={sermon.id}
                  status={sermon.status}
                  hasTranscriptSegments={sermon._count.transcriptSegments > 0}
                />
                <RedoClipGenerationButton
                  sermonId={sermon.id}
                  hasTranscriptSegments={hasTranscriptSegments}
                  clipCount={clipCounts.total}
                />
              </article>
              <article className="troubleshoot-action-item">
                <h3>Prepared clips</h3>
                <p className="muted small">
                  Use this after approving clips if previews, captions, branding, or downloads fail.
                </p>
                <ExportClipsButton
                  sermonId={sermon.id}
                  status={sermon.status}
                  hasSourceVideo={hasSourceVideo}
                  hasApprovedClips={hasApprovedClips}
                />
                <SubtitlesButton sermonId={sermon.id} hasApprovedClips={hasApprovedClips || hasExportedClips} />
              </article>
            </div>
          </section>

          <section className="card stack-sm">
            <h2>Failed or stuck work</h2>
            {latestFailedJob ? (
              <div className="stack-sm">
                <p>
                  <strong>{pastorJobStepLabel(latestFailedJob.type)}</strong>{" "}
                  {isStaleActiveProcessingJob(latestFailedJob) ? "appears stuck." : "failed."}
                </p>
                <div className="error-banner stack-sm">
                  <p>
                    {isStaleActiveProcessingJob(latestFailedJob)
                      ? "This step appears to be stuck from an earlier local run. Retry it to continue."
                      : pastorFriendlyError(latestFailedJob.errorMessage)}
                  </p>
                </div>
                {unresolvedFailedJobs.length > 1 ? (
                  <p className="muted small">
                    {unresolvedFailedJobs.length - 1} other failed or stuck processing step{unresolvedFailedJobs.length === 2 ? "" : "s"} can be retried after this one.
                  </p>
                ) : null}
                <RetryFailedJobButton sermonId={sermon.id} jobId={latestFailedJob.id} />
              </div>
            ) : (
              <p className="muted">No failed or stuck sermon steps are currently waiting for a retry.</p>
            )}
          </section>

          <section className="card stack-sm">
            <h2>Clip asset repair</h2>
            <div className="troubleshoot-metric-row">
              <span>Running clip operations: <strong>{operationSummary.running}</strong></span>
              <span>Failed clip operations: <strong>{operationSummary.failed}</strong></span>
              <span>Clips needing refresh: <strong>{operationSummary.outdated}</strong></span>
            </div>
            {operationSummary.failed > 0 ? (
              <div className="error-banner stack-sm">
                <p>Retry failed preview, caption, branding, render, or export work for this sermon.</p>
                <RepairFailedClipOperationsButton sermonId={sermon.id} disabled={hasLiveProcessingWork} />
              </div>
            ) : (
              <p className="muted">No clip-level failures are currently flagged.</p>
            )}
          </section>

          <section className="card stack-sm">
            <h2>Publishing readiness</h2>
            <ul className="status-list">
              {publishingChecklist.map((item) => (
                <li key={item.label} className="status-item">
                  <span className={`status-dot ${item.ready ? "done" : "pending"}`} />
                  <span>{item.label}</span>
                  <span className="muted">{item.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card stack-sm">
            <h2>Rerun a specific generation stage</h2>
            <p className="muted">
              Use this only when a particular generated asset is stale or wrong and the normal retry buttons are not enough.
            </p>
            <RegenerationControls sermonId={sermon.id} />
          </section>
        </div>
      </details>

      <Link href="/" className="text-link">
        Back to dashboard
      </Link>
    </main>
  );
}
