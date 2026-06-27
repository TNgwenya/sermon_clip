"use server";

import { access, rename, rm, stat, unlink, writeFile } from "node:fs/promises";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type ProcessingJobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  HARD_MAX_DURATION_SECONDS,
  HARD_MIN_DURATION_SECONDS,
} from "@/server/agents/clipBoundaryRefinement";
import { SELECTABLE_FRAMING_PRESETS } from "@/lib/clipFraming";
import {
  buildPresetManualCropKeyframes,
  nudgeManualCropKeyframes,
  normalizeManualCropKeyframes,
  type ManualCropPresetDirection,
} from "@/lib/manualCrop";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getAudioPath,
  getClipFolderPath,
  getClipSrtPath,
  getSourceVideoPath,
  getTranscriptJsonPath,
} from "@/server/agents/storage";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import type { ClipQualityRefreshSummary } from "@/server/agents/clipQualityRefreshService";
import type { ClipSuggestionCurationSummary } from "@/server/agents/clipSuggestionCurationService";
import {
  computeRegenerableAssetsForClip,
  detectClipEditImpact,
  invalidateAfterBoundaryOrCropChange,
  invalidateAfterCaptionTextChange,
  invalidateAfterOverlaySettingChange,
  isClipApprovedForPostingAssets,
  listClipFreshnessForSermon,
  summarizeBatchResult,
  toClipAssetFreshnessView,
  toFreshnessLabel,
  type ClipAssetKind,
} from "@/server/regeneration/dependencies";
import {
  buildSrtFromEditableCues,
  type EditableCaptionCue,
  parseHashtagEditorInput,
  validateEditableCaptionCues,
  validateClipStudioTiming,
} from "@/lib/clipStudioEditing";
import {
  buildLocalUploadSourceUrl,
  createSermonSchema,
  isUploadedVideoFile,
} from "@/lib/sermonIntake";
import {
  buildPrepareApprovedSummary,
  buildPrepareClipPlan,
} from "@/lib/prepareWorkflow";
import { isStaleActiveProcessingJob } from "@/lib/pastorWorkflow";
import { prunePostingPackageHistoryByClipIds } from "@/lib/postingPackages";
import {
  deriveBackgroundMode,
  isValidExportFormat,
  isValidFramingPersonality,
  isValidFramingMode,
  isValidPlatformPreset,
  markLatestExports,
  mapPlatformPresetToFormat,
  resolveExportHistory,
  resolveExportSettings,
  type ClipStudioExportRecord,
  type ClipStudioExportStatus,
  type FramingPersonality,
  type PlatformPreset,
} from "@/lib/clipExportSettings";
import {
  isValidBrandingPreset,
  resolveBrandingConfig,
  validateThemeColor,
  type BrandingPreset,
} from "@/lib/clipBranding";
import { getBrandingSettings } from "@/server/branding/settings";
import {
  canRunLocalMediaProcessing,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";
import type { CaptionStylePresetId } from "@/lib/captionStylePresets";

export type CreateSermonFormState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    youtubeUrl?: string;
    title?: string;
    speakerName?: string;
    churchName?: string;
    language?: string;
    sermonDate?: string;
    mediaFile?: string;
    sermonStartTimestamp?: string;
    sermonEndTimestamp?: string;
    rightsConfirmed?: string;
  };
  createdSermonId?: string;
};

function downloadSermonVideo(
  ...args: Parameters<typeof import("@/server/agents/videoDownloadAgent").downloadSermonVideo>
): ReturnType<typeof import("@/server/agents/videoDownloadAgent").downloadSermonVideo> {
  assertLocalMediaProcessing("Video download");
  return import(/* turbopackIgnore: true */ "@/server/agents/videoDownloadAgent").then((module) => module.downloadSermonVideo(...args));
}

function extractSermonAudio(
  ...args: Parameters<typeof import("@/server/agents/audioExtractionAgent").extractSermonAudio>
): ReturnType<typeof import("@/server/agents/audioExtractionAgent").extractSermonAudio> {
  assertLocalMediaProcessing("Audio extraction");
  return import(/* turbopackIgnore: true */ "@/server/agents/audioExtractionAgent").then((module) => module.extractSermonAudio(...args));
}

function transcribeSermonAudio(
  ...args: Parameters<typeof import("@/server/agents/transcriptionAgent").transcribeSermonAudio>
): ReturnType<typeof import("@/server/agents/transcriptionAgent").transcribeSermonAudio> {
  assertLocalMediaProcessing("Transcription");
  return import(/* turbopackIgnore: true */ "@/server/agents/transcriptionAgent").then((module) => module.transcribeSermonAudio(...args));
}

function generateClipSuggestions(
  ...args: Parameters<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions>
): ReturnType<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions> {
  assertLocalMediaProcessing("Clip generation");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipIntelligenceAgent").then((module) => module.generateClipSuggestions(...args));
}

function mediaFileIsUsable(
  ...args: Parameters<typeof import("@/server/media/fileGuards").mediaFileIsUsable>
): ReturnType<typeof import("@/server/media/fileGuards").mediaFileIsUsable> {
  assertLocalMediaProcessing("Media validation");
  return import(/* turbopackIgnore: true */ "@/server/media/fileGuards").then((module) => module.mediaFileIsUsable(...args));
}

function refreshSermonClipQuality(
  ...args: Parameters<typeof import("@/server/agents/clipQualityRefreshService").refreshSermonClipQuality>
): ReturnType<typeof import("@/server/agents/clipQualityRefreshService").refreshSermonClipQuality> {
  assertLocalMediaProcessing("Clip quality refresh");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipQualityRefreshService").then((module) => module.refreshSermonClipQuality(...args));
}

function curateSermonAiSuggestions(
  ...args: Parameters<typeof import("@/server/agents/clipSuggestionCurationService").curateSermonAiSuggestions>
): ReturnType<typeof import("@/server/agents/clipSuggestionCurationService").curateSermonAiSuggestions> {
  assertLocalMediaProcessing("Clip suggestion curation");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipSuggestionCurationService").then((module) => module.curateSermonAiSuggestions(...args));
}

function refreshVideoSubjectTracking(
  ...args: Parameters<typeof import("@/server/agents/videoSubjectTrackingService").refreshVideoSubjectTracking>
): ReturnType<typeof import("@/server/agents/videoSubjectTrackingService").refreshVideoSubjectTracking> {
  assertLocalMediaProcessing("Video tracking");
  return import(/* turbopackIgnore: true */ "@/server/agents/videoSubjectTrackingService").then((module) => module.refreshVideoSubjectTracking(...args));
}

function generateSmartCropDebugSnapshot(
  ...args: Parameters<typeof import("@/server/agents/smartCropDebugService").generateSmartCropDebugSnapshot>
): ReturnType<typeof import("@/server/agents/smartCropDebugService").generateSmartCropDebugSnapshot> {
  assertLocalMediaProcessing("Smart crop debug snapshot");
  return import(/* turbopackIgnore: true */ "@/server/agents/smartCropDebugService").then((module) => module.generateSmartCropDebugSnapshot(...args));
}

function renderApprovedClip(
  ...args: Parameters<typeof import("@/server/agents/clipRenderService").renderApprovedClip>
): ReturnType<typeof import("@/server/agents/clipRenderService").renderApprovedClip> {
  assertLocalMediaProcessing("Clip render");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipRenderService").then((module) => module.renderApprovedClip(...args));
}

function renderApprovedClipsForSermon(
  ...args: Parameters<typeof import("@/server/agents/clipRenderService").renderApprovedClipsForSermon>
): ReturnType<typeof import("@/server/agents/clipRenderService").renderApprovedClipsForSermon> {
  assertLocalMediaProcessing("Clip render");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipRenderService").then((module) => module.renderApprovedClipsForSermon(...args));
}

function exportVerticalClip(
  ...args: Parameters<typeof import("@/server/agents/clipExportService").exportVerticalClip>
): ReturnType<typeof import("@/server/agents/clipExportService").exportVerticalClip> {
  assertLocalMediaProcessing("Clip export");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipExportService").then((module) => module.exportVerticalClip(...args));
}

function exportClipWithPreset(
  ...args: Parameters<typeof import("@/server/agents/clipExportService").exportClipWithPreset>
): ReturnType<typeof import("@/server/agents/clipExportService").exportClipWithPreset> {
  assertLocalMediaProcessing("Clip export");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipExportService").then((module) => module.exportClipWithPreset(...args));
}

function renderClipOverlay(
  ...args: Parameters<typeof import("@/server/agents/clipOverlayService").renderClipOverlay>
): ReturnType<typeof import("@/server/agents/clipOverlayService").renderClipOverlay> {
  assertLocalMediaProcessing("Overlay render");
  return import(/* turbopackIgnore: true */ "@/server/agents/clipOverlayService").then((module) => module.renderClipOverlay(...args));
}

function processSermonPipeline(
  ...args: Parameters<typeof import("@/server/pipeline/processSermonPipeline").processSermonPipeline>
): ReturnType<typeof import("@/server/pipeline/processSermonPipeline").processSermonPipeline> {
  assertLocalMediaProcessing("Sermon processing");
  return import(/* turbopackIgnore: true */ "@/server/pipeline/processSermonPipeline").then((module) => module.processSermonPipeline(...args));
}

function generateCaptionsForApprovedClips(
  ...args: Parameters<typeof import("@/server/agents/captionService").generateCaptionsForApprovedClips>
): ReturnType<typeof import("@/server/agents/captionService").generateCaptionsForApprovedClips> {
  assertLocalMediaProcessing("Caption generation");
  return import(/* turbopackIgnore: true */ "@/server/agents/captionService").then((module) => module.generateCaptionsForApprovedClips(...args));
}

function generateCaptionsForClip(
  ...args: Parameters<typeof import("@/server/agents/captionService").generateCaptionsForClip>
): ReturnType<typeof import("@/server/agents/captionService").generateCaptionsForClip> {
  assertLocalMediaProcessing("Caption generation");
  return import(/* turbopackIgnore: true */ "@/server/agents/captionService").then((module) => module.generateCaptionsForClip(...args));
}

function burnCaptionsIntoRenderedClip(
  ...args: Parameters<typeof import("@/server/agents/captionBurnService").burnCaptionsIntoRenderedClip>
): ReturnType<typeof import("@/server/agents/captionBurnService").burnCaptionsIntoRenderedClip> {
  assertLocalMediaProcessing("Caption burn");
  return import(/* turbopackIgnore: true */ "@/server/agents/captionBurnService").then((module) => module.burnCaptionsIntoRenderedClip(...args));
}

function assertLocalMediaProcessing(action: string): void {
  if (!canRunLocalMediaProcessing()) {
    throw new Error(localMediaProcessingUnavailableMessage(action));
  }
}

async function queueSermonProcessingJob(
  sermonId: string,
  type: ProcessingJobType,
): Promise<{ id: string; reusedExisting: boolean }> {
  const existing = await prisma.processingJob.findFirst({
    where: {
      sermonId,
      type,
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, reusedExisting: true };
  }

  const job = await createProcessingJob(sermonId, type);
  return { id: job.id, reusedExisting: false };
}

function unavailableMediaActionState(action: string): { success: false; message: string } {
  return {
    success: false,
    message: localMediaProcessingUnavailableMessage(action),
  };
}

function startOneClickSermonPipeline(sermonId: string): void {
  if (!canRunLocalMediaProcessing()) {
    void queueSermonProcessingJob(sermonId, "PROCESS_SERMON").catch(() => undefined);
    return;
  }

  void processSermonPipeline(sermonId)
    .then((result) => {
      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath("/");
      return appendPipelineLog(sermonId, `One-click pipeline completed from sermon creation. ${result.summary}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown one-click pipeline error.";
      return appendPipelineLog(sermonId, `One-click pipeline failed after sermon creation: ${message}`);
    });
}

function getUploadedSourceTempPath(sourceVideoPath: string): string {
  return sourceVideoPath.replace(/\.mp4$/i, ".upload.partial.mp4");
}

export type DownloadVideoFormState = {
  success: boolean;
  message: string;
};

export type ExtractAudioFormState = {
  success: boolean;
  message: string;
};

export type TranscribeAudioFormState = {
  success: boolean;
  message: string;
};

export type GenerateClipSuggestionsFormState = {
  success: boolean;
  message: string;
};

export type RedoClipGenerationFormState = {
  success: boolean;
  message: string;
  deletedClips?: number;
  generatedClips?: number;
  clearedDrafts?: number;
  clearedScheduledPosts?: number;
  clearedPackages?: number;
  previewPrepared?: number;
  previewFailed?: number;
};

export type ProcessSermonFormState = {
  success: boolean;
  message: string;
};

export type RetryFailedJobFormState = {
  success: boolean;
  message: string;
};

type FailedProcessingJobRetryTarget = {
  id: string;
  type: ProcessingJobType;
};

export type ExportApprovedClipsFormState = {
  success: boolean;
  message: string;
};

export type SubtitleActionState = {
  success: boolean;
  message: string;
};

export type ClipCandidateActionState = {
  success: boolean;
  message: string;
};

export type ClipReviewStatus = "APPROVED" | "REJECTED" | "SUGGESTED";

export type ClipReviewBatchAction = "approve" | "reject" | "pending" | "render" | "export" | "prepare";

export type ClipReviewBatchActionState = {
  success: boolean;
  message: string;
  processed: number;
  failed: number;
  failures: Array<{ clipId: string; reason: string }>;
};

export type RefreshClipQualityActionState = ClipQualityRefreshSummary & {
  success: boolean;
  message: string;
};

export type RefreshClipQualityJobActionState = {
  success: boolean;
  message: string;
  jobId: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";
  summary: ClipQualityRefreshSummary | null;
};

export type CurateClipSuggestionsActionState = ClipSuggestionCurationSummary & {
  success: boolean;
  message: string;
};

export type ManualCropActionState = {
  success: boolean;
  message: string;
};

export type SmartCropDebugActionState = {
  success: boolean;
  message: string;
  snapshotPath: string | null;
};

export type PrepareApprovedClipsState = ClipReviewBatchActionState & {
  prepared: number;
  captionsAdded: number;
  brandingAdded: number;
  readyToPost: number;
};

export type RepairFailedClipOperationsState = {
  success: boolean;
  message: string;
  previewPrepared: number;
  previewFailed: number;
  approvedPrepared: number;
  approvedFailed: number;
};

export type RenderClipActionState = {
  success: boolean;
  message: string;
};

export type ClipExportActionState = {
  success: boolean;
  message: string;
};

export type UpdateClipCandidateInput = {
  clipId: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[] | string;
  startTimeSeconds: number;
  endTimeSeconds: number;
};

export type UpdateClipReviewContentInput = {
  clipId: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[] | string;
  clipNotes: string;
};

export type UpdateClipCandidateState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    title?: string;
    hook?: string;
    caption?: string;
    hashtags?: string;
    startTimeSeconds?: string;
    endTimeSeconds?: string;
  };
};

export type UpdateClipStudioEditsInput = {
  clipId: string;
  startTimestamp: string;
  endTimestamp: string;
  mainCaption: string;
  shortCaption: string;
  platformCaption: string;
  hashtags: string;
  captionCues: EditableCaptionCue[];
  applyCaptionsToClip: boolean;
  captionStylePresetId: string;
  hook: string;
  hookOverlay: {
    enabled: boolean;
    text: string;
    position: string;
    startSeconds: number;
    durationSeconds: number;
    animation: string;
    size: string;
    bold: boolean;
  };
  speechCleanup: {
    removeDeadAir: boolean;
    tightenLongPauses: boolean;
    flagFillerWords: boolean;
  };
};

export type UpdateClipStudioEditsState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    startTimestamp?: string;
    endTimestamp?: string;
    captionCues?: string;
    hook?: string;
    hashtags?: string;
  };
  warnings?: string[];
};

export type UpdateClipExportSettingsInput = {
  clipId: string;
  platformPreset: string;
  primaryFormat: string;
  framingMode: string;
  framingPersonality?: string;
  selectedFormats: string[];
};

export type UpdateClipExportSettingsState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    platformPreset?: string;
    primaryFormat?: string;
    framingMode?: string;
    framingPersonality?: string;
    selectedFormats?: string;
  };
};

const updateClipReviewContentSchema = z.object({
  clipId: z.string().trim().min(1, "Clip id is required."),
  title: z.string().trim().min(1, "Title must not be empty."),
  hook: z.string().trim().min(1, "Hook must not be empty."),
  caption: z.string().trim().min(1, "Caption must not be empty."),
  hashtags: z.union([z.string(), z.array(z.string())]),
  clipNotes: z.string(),
});

const manualCropSchema = z.object({
  clipId: z.string().trim().min(1, "Clip id is required."),
  direction: z.enum(["left", "center", "right"]).optional(),
  nudge: z.enum(["left", "right"]).optional(),
  keyframes: z.array(z.object({
    timeSeconds: z.number().finite().min(0),
    centerX: z.number().finite().min(0).max(1),
    centerY: z.number().finite().min(0).max(1).optional(),
    zoom: z.number().finite().min(1).max(2).optional(),
  })).optional(),
});

const hashtagTokenRegex = /^#?[A-Za-z0-9][A-Za-z0-9_-]*$/;

const updateClipCandidateSchema = z
  .object({
    clipId: z.string().trim().min(1, "Clip id is required."),
    title: z.string().trim().min(1, "Title must not be empty."),
    hook: z.string().trim().min(1, "Hook must not be empty."),
    caption: z.string().trim().min(1, "Caption must not be empty."),
    hashtags: z.union([z.string(), z.array(z.string())]),
    startTimeSeconds: z.number().finite().min(0, "Start time must be 0 or greater."),
    endTimeSeconds: z.number().finite(),
  })
  .superRefine((value, ctx) => {
    if (value.endTimeSeconds <= value.startTimeSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTimeSeconds"],
        message: "End time must be greater than start time.",
      });
      return;
    }

    const durationSeconds = value.endTimeSeconds - value.startTimeSeconds;
    if (durationSeconds < HARD_MIN_DURATION_SECONDS || durationSeconds > HARD_MAX_DURATION_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTimeSeconds"],
        message: `Clip duration must be between ${HARD_MIN_DURATION_SECONDS} and ${HARD_MAX_DURATION_SECONDS} seconds.`,
      });
    }
  });

function normalizeHashtagInput(input: string[] | string): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[\n,\s]+/g);

  return raw
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith("#") ? item : `#${item}`));
}

function validateHashtags(hashtags: string[]): string | undefined {
  const invalid = hashtags.find((item) => !hashtagTokenRegex.test(item));
  if (invalid) {
    return `Invalid hashtag: ${invalid}. Use letters, numbers, underscores, or hyphens.`;
  }

  return undefined;
}

type ClipOperationSnapshot = {
  id: string;
  sermonId: string;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  overlayStatus: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
};

type OperationOutcome = {
  success: boolean;
  message: string;
};

const TRACKING_REFRESH_TIMEOUT_MS = 10_000;

type OperationLogScope = {
  sermonId: string;
  operation: string;
  clipId?: string;
};

async function loadClipOperationSnapshot(clipId: string): Promise<ClipOperationSnapshot | null> {
  return prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      renderStatus: true,
      renderFreshness: true,
      captionStatus: true,
      captionFreshness: true,
      captionBurnStatus: true,
      captionBurnFreshness: true,
      captionData: true,
      overlayStatus: true,
      overlayFreshness: true,
      exportStatus: true,
      exportFreshness: true,
    },
  });
}

function formatRecoveryGuidance(summary: string, nextStep: string): string {
  return `${summary} Next step: ${nextStep}`;
}

async function logOperationStart(scope: OperationLogScope): Promise<number> {
  const startedAt = Date.now();
  const clipToken = scope.clipId ? ` clip=${scope.clipId}` : "";
  await appendPipelineLog(
    scope.sermonId,
    `operation=${scope.operation}${clipToken} phase=start startedAt=${new Date(startedAt).toISOString()}`,
  );
  return startedAt;
}

async function logOperationCompleted(scope: OperationLogScope, startedAt: number): Promise<void> {
  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;
  const clipToken = scope.clipId ? ` clip=${scope.clipId}` : "";
  await appendPipelineLog(
    scope.sermonId,
    `operation=${scope.operation}${clipToken} phase=complete completedAt=${new Date(completedAt).toISOString()} durationMs=${durationMs} success=true`,
  );
}

async function logOperationFailed(scope: OperationLogScope, startedAt: number, reason: string): Promise<void> {
  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;
  const clipToken = scope.clipId ? ` clip=${scope.clipId}` : "";
  await appendPipelineLog(
    scope.sermonId,
    `operation=${scope.operation}${clipToken} phase=complete completedAt=${new Date(completedAt).toISOString()} durationMs=${durationMs} success=false error=${reason}`,
  );
}

async function runOperationWithLogging<T extends OperationOutcome>(
  scope: OperationLogScope,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = await logOperationStart(scope);
  try {
    const result = await run();
    if (result.success) {
      await logOperationCompleted(scope, startedAt);
    } else {
      await logOperationFailed(scope, startedAt, result.message);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown operation error.";
    await logOperationFailed(scope, startedAt, message);
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function refreshVideoSubjectTrackingBestEffort(clipId: string, sermonId: string): Promise<void> {
  try {
    await withTimeout(
      refreshVideoSubjectTracking(clipId),
      TRACKING_REFRESH_TIMEOUT_MS,
      "Smart tracking refresh took too long and was skipped for this retry.",
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown smart tracking refresh error.";
    await appendPipelineLog(sermonId, `Smart tracking refresh skipped for clip ${clipId}: ${reason}`);
  }
}

async function renderApprovedClipWithFallback(input: {
  clipId: string;
  sermonId: string;
  exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
}): Promise<void> {
  try {
    await renderApprovedClip(input.clipId, { force: true, allowRerender: true });
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown render error.";
    const canFallback = input.exportLayoutStrategy === "SMART_CROP";

    if (!canFallback) {
      throw error;
    }

    await appendPipelineLog(
      input.sermonId,
      `Smart crop render failed for clip ${input.clipId}; retrying with full-stage framing. Reason: ${reason}`,
    );
    await prisma.clipCandidate.update({
      where: { id: input.clipId },
      data: {
        exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
        renderStatus: "NOT_RENDERED",
        renderError: null,
      },
    });
    await renderApprovedClip(input.clipId, { force: true, allowRerender: true });
  }
}

async function renderClipOverlayBestEffort(clipId: string, sermonId: string): Promise<boolean> {
  try {
    await renderClipOverlay(clipId, {
      allowRerender: true,
      force: true,
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown overlay render error.";
    await appendPipelineLog(
      sermonId,
      `Branding overlay skipped for clip ${clipId}; exporting prepared captioned video instead. Reason: ${reason}`,
    );
    return false;
  }
}

async function exportVerticalClipWithFallback(input: {
  clipId: string;
  sermonId: string;
  layoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP";
  brandingOverlay: Parameters<typeof exportVerticalClip>[1] extends infer Options
    ? Options extends { brandingOverlay?: infer BrandingOverlay }
      ? BrandingOverlay | null
      : never
    : never;
}): Promise<void> {
  try {
    await exportVerticalClip(input.clipId, {
      allowReexport: true,
      force: true,
      layoutStrategy: input.layoutStrategy,
      brandingOverlay: input.brandingOverlay,
    });
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown export error.";
    if (input.layoutStrategy !== "SMART_CROP") {
      throw error;
    }

    await appendPipelineLog(
      input.sermonId,
      `Smart crop export failed for clip ${input.clipId}; retrying with full-stage framing. Reason: ${reason}`,
    );
    await prisma.clipCandidate.update({
      where: { id: input.clipId },
      data: {
        exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
        exportStatus: "NOT_EXPORTED",
        exportError: null,
      },
    });
    await exportVerticalClip(input.clipId, {
      allowReexport: true,
      force: true,
      layoutStrategy: "FIT_BLURRED_BACKGROUND",
      brandingOverlay: input.brandingOverlay,
    });
  }
}

async function getClipSermonId(clipId: string): Promise<string | null> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: { sermonId: true },
  });

  return clip?.sermonId ?? null;
}

async function revalidateClipPaths(clipId: string, sermonId?: string): Promise<void> {
  const resolvedSermonId = sermonId ?? (await getClipSermonId(clipId));
  if (resolvedSermonId) {
    revalidatePath(`/sermons/${resolvedSermonId}`);
    revalidatePath(`/sermons/${resolvedSermonId}/review`);
  }
  revalidatePath("/");
}

async function logClipFailure(clipId: string, operation: string, message: string, sermonId?: string): Promise<void> {
  const resolvedSermonId = sermonId ?? (await getClipSermonId(clipId));
  if (!resolvedSermonId) {
    return;
  }

  await appendPipelineLog(resolvedSermonId, `${operation} failed for clip ${clipId}: ${message}`);
}

async function preflightRegenerationAsset(
  clipId: string,
  asset: ClipAssetKind,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const clip = await loadClipOperationSnapshot(clipId);
  if (!clip) {
    return { ok: false, reason: "Clip candidate was not found." };
  }

  if (asset === "render") {
    if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Video preparation is blocked because the clip is not approved.",
          "Approve the clip in review, then prepare it again.",
        ),
      };
    }

    if (clip.renderStatus === "RENDERING") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Video preparation is already in progress.",
          "Wait for preparation to finish before trying again.",
        ),
      };
    }

    return { ok: true };
  }

  if (asset === "caption") {
    if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Caption refresh is blocked because the clip is not approved.",
          "Approve the clip in review, then prepare captions again.",
        ),
      };
    }

    if (clip.captionStatus === "GENERATING") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Caption writing is already in progress.",
          "Wait for captions to finish before trying again.",
        ),
      };
    }

    return { ok: true };
  }

  if (asset === "captionBurn") {
    if (clip.renderStatus !== "COMPLETED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Adding captions to the video requires a prepared video.",
          "Prepare the video first, then add captions again.",
        ),
      };
    }

    if (clip.captionStatus !== "GENERATED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Adding captions to the video requires written captions.",
          "Write captions first, then add them to the video.",
        ),
      };
    }

    if (clip.captionBurnStatus === "BURNING") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Captions are already being added to the video.",
          "Wait for that step to finish before trying again.",
        ),
      };
    }

    return { ok: true };
  }

  if (asset === "overlay") {
    if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Church branding is blocked because the clip is not approved.",
          "Approve the clip in review, then add branding again.",
        ),
      };
    }

    if (clip.renderStatus !== "COMPLETED") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Church branding requires a prepared video.",
          "Prepare the video first, then add branding again.",
        ),
      };
    }

    if (clip.overlayStatus === "RENDERING") {
      return {
        ok: false,
        reason: formatRecoveryGuidance(
          "Church branding is already being added.",
          "Wait for branding to finish before trying again.",
        ),
      };
    }

    return { ok: true };
  }

  if (clip.renderStatus !== "COMPLETED") {
    return {
      ok: false,
      reason: formatRecoveryGuidance(
        "Creating a download requires a prepared video.",
        "Prepare the video first, then create the download again.",
      ),
    };
  }

  if (clip.exportStatus === "EXPORTING") {
    return {
      ok: false,
      reason: formatRecoveryGuidance(
        "The download is already being created.",
        "Wait for the download step to finish before trying again.",
      ),
    };
  }

  return { ok: true };
}

function jsonStringArrayIncludesAny(value: unknown, clipIdSet: Set<string>): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && clipIdSet.has(item));
}

async function prepareGeneratedClipPreviews(input: {
  sermonId: string;
  force: boolean;
  onlyFailed?: boolean;
}): Promise<{ prepared: number; failed: number; skipped: number }> {
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: input.sermonId,
      status: "SUGGESTED",
      isAiGenerated: true,
      ...(input.onlyFailed ? { renderStatus: "FAILED" } : {}),
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      renderStatus: true,
    },
  });

  if (clips.length === 0) {
    return { prepared: 0, failed: 0, skipped: 0 };
  }

  let prepared = 0;
  let failed = 0;
  let skipped = 0;

  await appendPipelineLog(input.sermonId, `Preparing preview assets for ${clips.length} generated clip(s).`);

  for (const clip of clips) {
    if (!input.force && clip.renderStatus === "COMPLETED") {
      skipped += 1;
      continue;
    }

    try {
      await renderApprovedClip(clip.id, {
        force: input.force,
        allowRerender: input.force,
      });
      prepared += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : "Unknown preview render error.";
      await appendPipelineLog(input.sermonId, `Preview render failed for clip ${clip.id}: ${reason}`);
    }
  }

  await appendPipelineLog(
    input.sermonId,
    `Preview preparation complete. Prepared: ${prepared}, skipped: ${skipped}, failed: ${failed}.`,
  );

  return { prepared, failed, skipped };
}

export async function createSermonAction(
  _prevState: CreateSermonFormState,
  formData: FormData,
): Promise<CreateSermonFormState> {
  const uploadedVideo = formData.get("sermonVideoFile");
  const hasUploadedVideo = isUploadedVideoFile(uploadedVideo);
  const uploadedVideoName = hasUploadedVideo ? uploadedVideo.name : "sermon-video";
  const values = {
    youtubeUrl: String(formData.get("youtubeUrl") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    speakerName: String(formData.get("speakerName") ?? "").trim(),
    churchName: String(formData.get("churchName") ?? "").trim(),
    language: String(formData.get("language") ?? "").trim(),
    sermonStartTimestamp: String(formData.get("sermonStartTimestamp") ?? "").trim(),
    sermonEndTimestamp: String(formData.get("sermonEndTimestamp") ?? "").trim(),
    sermonDate: String(formData.get("sermonDate") ?? "").trim(),
    rightsConfirmed: formData.get("rightsConfirmed") === "on",
    hasUploadedVideo,
  };

  const result = createSermonSchema.safeParse(values);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: {
        youtubeUrl: fieldErrors.youtubeUrl?.[0],
        title: fieldErrors.title?.[0],
        speakerName: fieldErrors.speakerName?.[0],
        churchName: fieldErrors.churchName?.[0],
        language: fieldErrors.language?.[0],
        sermonStartTimestamp: fieldErrors.sermonStartTimestamp?.[0],
        sermonEndTimestamp: fieldErrors.sermonEndTimestamp?.[0],
        sermonDate: fieldErrors.sermonDate?.[0],
        mediaFile: fieldErrors.youtubeUrl?.[0],
        rightsConfirmed: fieldErrors.rightsConfirmed?.[0],
      },
    };
  }

  if (!canRunLocalMediaProcessing() && hasUploadedVideo) {
    return {
      success: false,
      message: "Video file uploads need shared storage before they can run on Vercel. Add this sermon by YouTube URL for now, or upload from the local app.",
      fieldErrors: {
        mediaFile: "File uploads are local-worker only until shared storage is configured.",
      },
    };
  }

  try {
    const sermon = await prisma.sermon.create({
      data: {
        youtubeUrl: result.data.youtubeUrl || buildLocalUploadSourceUrl(uploadedVideoName),
        title: result.data.title,
        speakerName: result.data.speakerName,
        churchName: result.data.churchName,
        language: result.data.language,
        sermonStartSeconds: result.data.sermonStartSeconds,
        sermonEndSeconds: result.data.sermonEndSeconds,
        analyzeFullRecording: false,
        sermonDate: result.data.sermonDate,
        rightsConfirmed: result.data.rightsConfirmed,
        status: "CREATED",
      },
      select: {
        id: true,
      },
    });

    if (!canRunLocalMediaProcessing()) {
      await prisma.sermon.update({
        where: { id: sermon.id },
        data: {
          sourceVideoPath: getSourceVideoPath(sermon.id),
          audioPath: getAudioPath(sermon.id),
          transcriptJsonPath: getTranscriptJsonPath(sermon.id),
        },
      });
      const job = await queueSermonProcessingJob(sermon.id, "PROCESS_SERMON");
      revalidatePath("/");

      return {
        success: true,
        message: job.reusedExisting
          ? "Sermon saved. A local-worker processing job is already queued."
          : "Sermon saved. Processing is queued for your local worker.",
        createdSermonId: sermon.id,
      };
    }

    try {
      await ensureSermonFolders(sermon.id);
      const sourceVideoPath = getSourceVideoPath(sermon.id);
      let uploadedDurationSeconds: number | null = null;
      if (hasUploadedVideo) {
        const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
        await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);

        const arrayBuffer = await uploadedVideo.arrayBuffer();
        try {
          await writeFile(/* turbopackIgnore: true */ tempSourceVideoPath, Buffer.from(arrayBuffer));
          const uploadedMedia = await mediaFileIsUsable(tempSourceVideoPath);
          if (!uploadedMedia.usable) {
            throw new Error(`Uploaded sermon video is not usable: ${uploadedMedia.reason}`);
          }

          await rename(/* turbopackIgnore: true */ tempSourceVideoPath, /* turbopackIgnore: true */ sourceVideoPath);

          const finalizedUpload = await mediaFileIsUsable(sourceVideoPath);
          if (!finalizedUpload.usable) {
            await unlink(/* turbopackIgnore: true */ sourceVideoPath).catch(() => undefined);
            throw new Error(`Finalized uploaded sermon video is not usable: ${finalizedUpload.reason}`);
          }

          uploadedDurationSeconds = finalizedUpload.durationSeconds;
        } catch (uploadError) {
          await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);
          throw uploadError;
        }
      }

      await prisma.sermon.update({
        where: { id: sermon.id },
        data: {
          sourceVideoPath,
          audioPath: getAudioPath(sermon.id),
          transcriptJsonPath: getTranscriptJsonPath(sermon.id),
          ...(uploadedDurationSeconds !== null ? { sourceDurationSeconds: uploadedDurationSeconds } : {}),
          ...(hasUploadedVideo ? { status: "DOWNLOADED" } : {}),
        },
      });
      await appendPipelineLog(
        sermon.id,
        hasUploadedVideo
          ? "Sermon created from uploaded video file and storage folders initialized."
          : "Sermon created and storage folders initialized.",
      );
    } catch (storageError) {
      const reason = storageError instanceof Error ? storageError.message : "Unknown storage setup error.";
      console.error(`Storage initialization failed for sermon ${sermon.id}: ${reason}`);
      return {
        success: false,
        message: `Sermon was saved, but storage setup failed: ${reason}`,
        createdSermonId: sermon.id,
      };
    }

    revalidatePath("/");
    startOneClickSermonPipeline(sermon.id);

    return {
      success: true,
      message: "Sermon saved. The full clip workflow has started automatically.",
      createdSermonId: sermon.id,
    };
  } catch {
    return {
      success: false,
      message: "Unable to save sermon right now. Please try again.",
    };
  }
}

export async function downloadVideoAction(
  _prevState: DownloadVideoFormState,
  formData: FormData,
): Promise<DownloadVideoFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const force = formData.get("force") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for download.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "DOWNLOAD_VIDEO");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Video download is already queued for your local worker."
        : "Video download queued for your local worker.",
    };
  }

  try {
    const result = await downloadSermonVideo(sermonId, { force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: result.reusedExistingFile
        ? "Video already existed. Existing file was reused."
        : "Video download completed.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video download failed.";
    return {
      success: false,
      message,
    };
  }
}

export async function extractAudioAction(
  _prevState: ExtractAudioFormState,
  formData: FormData,
): Promise<ExtractAudioFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const force = formData.get("force") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for audio extraction.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "EXTRACT_AUDIO");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Audio extraction is already queued for your local worker."
        : "Audio extraction queued for your local worker.",
    };
  }

  try {
    const result = await extractSermonAudio(sermonId, { force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: result.reusedExistingFile
        ? "Audio already existed. Existing file was reused."
        : "Audio extraction completed.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio extraction failed.";
    return {
      success: false,
      message,
    };
  }
}

export async function transcribeAudioAction(
  _prevState: TranscribeAudioFormState,
  formData: FormData,
): Promise<TranscribeAudioFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const force = formData.get("force") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for transcription.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "TRANSCRIBE_AUDIO");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Transcription is already queued for your local worker."
        : "Transcription queued for your local worker.",
    };
  }

  try {
    const result = await transcribeSermonAudio(sermonId, { force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: result.reusedExistingTranscript
        ? "Transcript already existed. Existing transcript was reused."
        : "Transcription completed.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return {
      success: false,
      message,
    };
  }
}

export async function generateClipSuggestionsAction(
  _prevState: GenerateClipSuggestionsFormState,
  formData: FormData,
): Promise<GenerateClipSuggestionsFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const force = formData.get("force") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for clip generation.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "GENERATE_CLIPS");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Clip generation is already queued for your local worker."
        : "Clip generation queued for your local worker.",
    };
  }

  try {
    const result = await generateClipSuggestions(sermonId, { force });
    const previewSummary = await prepareGeneratedClipPreviews({ sermonId, force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/");

    return {
      success: true,
      message: result.reusedExistingSuggestions
        ? `Clip suggestions already existed. Existing suggestions were reused. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`
        : `Generated ${result.clipCount} clip suggestions. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clip generation failed.";
    return {
      success: false,
      message,
    };
  }
}

export async function redoClipGenerationFromTranscriptAction(
  _prevState: RedoClipGenerationFormState,
  formData: FormData,
): Promise<RedoClipGenerationFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const confirmation = String(formData.get("confirmation") ?? "").trim();

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for redo.",
    };
  }

  if (confirmation !== "redo-clips") {
    return {
      success: false,
      message: "Please confirm the redo before deleting generated clips.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    return {
      success: false,
      message: "Redo clip generation is local-worker only for now. Run it from the local app so deleted clips can be regenerated immediately.",
    };
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      transcriptJsonPath: true,
      _count: {
        select: {
          transcriptSegments: true,
        },
      },
      clipCandidates: {
        select: {
          id: true,
        },
      },
      processingJobs: {
        where: {
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: {
          id: true,
          type: true,
          status: true,
        },
        take: 5,
      },
    },
  });

  if (!sermon) {
    return {
      success: false,
      message: "Sermon was not found.",
    };
  }

  if (!sermon.transcriptJsonPath || sermon._count.transcriptSegments === 0) {
    return {
      success: false,
      message: "A completed transcript is required before redoing clip generation.",
    };
  }

  if (sermon.processingJobs.length > 0) {
    return {
      success: false,
      message: "A processing job is already running for this sermon. Wait for it to finish before redoing clip generation.",
    };
  }

  const runningClipOperationCount = await prisma.clipCandidate.count({
    where: {
      sermonId,
      OR: [
        { renderStatus: "RENDERING" },
        { exportStatus: "EXPORTING" },
        { captionStatus: "GENERATING" },
        { captionBurnStatus: "BURNING" },
        { overlayStatus: "RENDERING" },
      ],
    },
  });

  if (runningClipOperationCount > 0) {
    return {
      success: false,
      message: "One or more clip operations are still running. Wait for them to finish before redoing clip generation.",
    };
  }

  const oldClipIds = sermon.clipCandidates.map((clip) => clip.id);
  const oldClipIdSet = new Set(oldClipIds);
  let clearedDrafts = 0;
  let clearedScheduledPosts = 0;
  let clearedPackages = 0;

  try {
    await appendPipelineLog(sermonId, `Redo clip generation requested. Removing ${oldClipIds.length} existing clip candidate(s).`);

    if (oldClipIds.length > 0) {
      const [drafts, scheduledPosts] = await Promise.all([
        prisma.postingDraft.findMany({
          select: {
            id: true,
            clipIdsJson: true,
          },
        }),
        prisma.scheduledPost.findMany({
          select: {
            id: true,
            clipIdsJson: true,
          },
        }),
      ]);
      const draftIdsToDelete = drafts
        .filter((draft) => jsonStringArrayIncludesAny(draft.clipIdsJson, oldClipIdSet))
        .map((draft) => draft.id);
      const scheduledPostIdsToDelete = scheduledPosts
        .filter((post) => jsonStringArrayIncludesAny(post.clipIdsJson, oldClipIdSet))
        .map((post) => post.id);

      await prisma.$transaction(async (tx) => {
        if (scheduledPostIdsToDelete.length > 0) {
          const result = await tx.scheduledPost.deleteMany({
            where: { id: { in: scheduledPostIdsToDelete } },
          });
          clearedScheduledPosts = result.count;
        }

        if (draftIdsToDelete.length > 0) {
          const result = await tx.postingDraft.deleteMany({
            where: { id: { in: draftIdsToDelete } },
          });
          clearedDrafts = result.count;
        }

        await tx.contentOpportunity.updateMany({
          where: { relatedClipId: { in: oldClipIds } },
          data: { relatedClipId: null },
        });

        await tx.clipCandidate.deleteMany({
          where: { sermonId },
        });

        await tx.sermon.update({
          where: { id: sermonId },
          data: { status: "TRANSCRIBED" },
        });
      });

      clearedPackages = await prunePostingPackageHistoryByClipIds(oldClipIds);
    } else {
      await prisma.sermon.update({
        where: { id: sermonId },
        data: { status: "TRANSCRIBED" },
      });
    }

    await rm(getClipFolderPath(sermonId), { recursive: true, force: true });
    await ensureSermonFolders(sermonId);
    await appendPipelineLog(
      sermonId,
      `Generated clip cache cleared. Drafts removed: ${clearedDrafts}; scheduled posts removed: ${clearedScheduledPosts}; packages pruned: ${clearedPackages}.`,
    );

    const generationResult = await generateClipSuggestions(sermonId, { force: true });
    const previewSummary = await prepareGeneratedClipPreviews({ sermonId, force: true });

    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");

    return {
      success: previewSummary.failed === 0,
      message: previewSummary.failed === 0
        ? `Redo complete. Deleted ${oldClipIds.length} old clip(s), generated ${generationResult.clipCount} new suggestion(s), and prepared ${previewSummary.prepared} preview(s).`
        : `Redo completed with preview issues. Deleted ${oldClipIds.length} old clip(s), generated ${generationResult.clipCount} new suggestion(s), prepared ${previewSummary.prepared} preview(s), and ${previewSummary.failed} preview(s) need attention.`,
      deletedClips: oldClipIds.length,
      generatedClips: generationResult.clipCount,
      clearedDrafts,
      clearedScheduledPosts,
      clearedPackages,
      previewPrepared: previewSummary.prepared,
      previewFailed: previewSummary.failed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redo clip generation failed.";
    await appendPipelineLog(sermonId, `Redo clip generation failed: ${message}`);
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: false,
      message,
      deletedClips: oldClipIds.length,
      clearedDrafts,
      clearedScheduledPosts,
      clearedPackages,
    };
  }
}

export async function processSermonAction(
  _prevState: ProcessSermonFormState,
  formData: FormData,
): Promise<ProcessSermonFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for processing.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "PROCESS_SERMON");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Sermon processing is already queued for your local worker."
        : "Sermon processing queued for your local worker.",
    };
  }

  try {
    const result = await processSermonPipeline(sermonId);
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    const stepSummary = result.steps.map((step) => `${step.label}: ${step.status}`).join("; ");
    return {
      success: true,
      message: `Processing complete. ${stepSummary}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: false,
      message: `Pipeline stopped: ${message}`,
    };
  }
}

export async function retryFailedProcessingJobAction(
  _prevState: RetryFailedJobFormState,
  formData: FormData,
): Promise<RetryFailedJobFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const jobId = String(formData.get("jobId") ?? "").trim();

  if (!sermonId || !jobId) {
    return {
      success: false,
      message: "Missing sermon or failed job id for retry.",
    };
  }

  return retryFailedProcessingJobById({ sermonId, jobId });
}

export async function retryFailedProcessingJobById(input: {
  sermonId: string;
  jobId: string;
}): Promise<RetryFailedJobFormState> {
  const sermonId = input.sermonId.trim();
  const jobId = input.jobId.trim();

  if (!sermonId || !jobId) {
    return {
      success: false,
      message: "Missing sermon or failed job id for retry.",
    };
  }

  const [job, activeJobs] = await Promise.all([
    prisma.processingJob.findFirst({
      where: {
        id: jobId,
        sermonId,
        status: { in: ["FAILED", "PENDING", "RUNNING"] },
      },
      select: {
        id: true,
        sermonId: true,
        type: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.processingJob.findMany({
      where: {
        sermonId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!job) {
    return {
      success: false,
      message: "That failed or stuck processing job could not be found. Refresh the page and try the latest recovery step.",
    };
  }

  const staleTarget = isStaleActiveProcessingJob(job);
  if (job.status !== "FAILED" && !staleTarget) {
    return {
      success: false,
      message: "That step still appears to be running. Wait for it to finish, or retry only if it has been stuck for more than two hours.",
    };
  }

  const blockingActiveJob = activeJobs.find((activeJob) => (
    activeJob.id !== job.id &&
    !isStaleActiveProcessingJob(activeJob)
  ));
  if (blockingActiveJob) {
    return {
      success: false,
      message: "A processing job is already running for this sermon. Wait for it to finish before retrying.",
    };
  }

  const latestStepJob = await prisma.processingJob.findFirst({
    where: {
      sermonId,
      type: job.type,
    },
    select: {
      id: true,
      sermonId: true,
      type: true,
      status: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (
    !latestStepJob ||
    latestStepJob.id !== job.id ||
    (latestStepJob.status !== "FAILED" && !isStaleActiveProcessingJob(latestStepJob))
  ) {
    return {
      success: false,
      message: "That recovery step is no longer the latest unresolved failure. Refresh the page and use the current recovery action.",
    };
  }

  try {
    if (staleTarget) {
      await markJobFailed(
        job.id,
        "This job looked stuck on a local machine and was marked failed so it could be retried.",
        "Recovered stale running or pending job before manual retry.",
      );
      await appendPipelineLog(sermonId, `Marked stale ${job.status.toLowerCase()} job ${job.id} (${job.type}) as failed before retry.`);
    }

    await retryFailedProcessingJobTarget(sermonId, job);

    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/");

    return {
      success: true,
      message: "Retry completed successfully.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    await appendPipelineLog(sermonId, `Manual retry failed for job ${job.id} (${job.type}): ${message}`);
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: false,
      message,
    };
  }
}

async function retryFailedProcessingJobTarget(
  sermonId: string,
  job: FailedProcessingJobRetryTarget,
): Promise<void> {
  await appendPipelineLog(sermonId, `Manual retry requested for failed job ${job.id} (${job.type}).`);

  if (job.type === "DOWNLOAD_VIDEO") {
    await downloadSermonVideo(sermonId, { force: true });
  } else if (job.type === "EXTRACT_AUDIO") {
    await extractSermonAudio(sermonId, { force: true });
  } else if (job.type === "TRANSCRIBE_AUDIO") {
    await transcribeSermonAudio(sermonId, { force: true });
  } else if (job.type === "GENERATE_CLIPS") {
    await generateClipSuggestions(sermonId, { force: true });
    await prepareGeneratedClipPreviews({ sermonId, force: true });
  } else if (job.type === "PROCESS_SERMON") {
    await processSermonPipeline(sermonId);
  } else if (job.type === "EXPORT_CLIPS") {
    const summary = await renderApprovedClipsForSermon(sermonId, { force: true });
    if (summary.attempted === 0 && summary.failed === 0) {
      await markJobSucceeded(job.id, "Retry found no approved clips needing render/export work.");
      await appendPipelineLog(sermonId, "Render/export retry found no approved clips needing work.");
      return;
    }
    if (summary.failed > 0) {
      throw new Error(`Retry still has ${summary.failed} clip render/export failure(s). ${summary.errors.slice(0, 2).map((error) => `${error.clipId}: ${error.reason}`).join(" | ")}`);
    }
  } else if (job.type === "GENERATE_SUBTITLES") {
    const summary = await generateCaptionsForApprovedClips(sermonId, { force: true });
    if (summary.attempted === 0 && summary.failed === 0) {
      await markJobSucceeded(job.id, "Retry found no approved clips needing captions.");
      await appendPipelineLog(sermonId, "Caption retry found no approved clips needing captions.");
      return;
    }
    if (summary.failed > 0) {
      throw new Error(`Retry still has ${summary.failed} caption failure(s). ${summary.errors.slice(0, 2).map((error) => `${error.clipId}: ${error.reason}`).join(" | ")}`);
    }
  } else if (job.type === "BURN_SUBTITLES") {
    const summary = await regenerateAllOutdatedCaptionsAction(sermonId);
    if (summary.attempted === 0 && summary.failed === 0) {
      await markJobSucceeded(job.id, "Retry found no caption burn work needing regeneration.");
      await appendPipelineLog(sermonId, "Caption burn retry found no caption assets needing work.");
      return;
    }
    if (summary.failed > 0) {
      await markJobFailed(job.id, `Retry still has ${summary.failed} caption burn failure(s).`, summary.failures.slice(0, 3).map((failure) => `${failure.clipId}: ${failure.reason}`).join(" | "));
      throw new Error(`Retry still has ${summary.failed} caption burn failure(s). ${summary.failures.slice(0, 2).map((failure) => `${failure.clipId}: ${failure.reason}`).join(" | ")}`);
    }
    await markJobSucceeded(job.id, `Retry rebuilt ${summary.completed} caption asset(s); ${summary.skipped} already ready.`);
  } else if (job.type === "RENDER_OVERLAY") {
    const summary = await regenerateAllOutdatedAssetsAction(sermonId);
    if (summary.attempted === 0 && summary.failed === 0) {
      await markJobSucceeded(job.id, "Retry found no overlay assets needing regeneration.");
      await appendPipelineLog(sermonId, "Overlay retry found no approved clips needing overlay work.");
      return;
    }
    if (summary.failed > 0) {
      await markJobFailed(job.id, `Retry still has ${summary.failed} overlay or dependent asset failure(s).`, summary.failures.slice(0, 3).map((failure) => `${failure.clipId}: ${failure.reason}`).join(" | "));
      throw new Error(`Retry still has ${summary.failed} overlay or dependent asset failure(s). ${summary.failures.slice(0, 2).map((failure) => `${failure.clipId}: ${failure.reason}`).join(" | ")}`);
    }
    await markJobSucceeded(job.id, `Retry rebuilt ${summary.completed} overlay/dependent asset(s); ${summary.skipped} already ready.`);
  } else if (job.type === "QUALITY_REFRESH") {
    const result = await processClipQualityRefreshJob({ jobId: job.id, sermonId, force: true });
    if (!result.success) {
      throw new Error(result.message);
    }
  } else {
    throw new Error("This failed step is clip-specific. Open the clip card and use the retry or regenerate control for that failed asset.");
  }
}

export async function exportApprovedClipsAction(
  _prevState: ExportApprovedClipsFormState,
  formData: FormData,
): Promise<ExportApprovedClipsFormState> {
  const sermonId = String(formData.get("sermonId") ?? "").trim();
  const force = formData.get("force") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for clip export.",
    };
  }

  if (!canRunLocalMediaProcessing()) {
    const job = await queueSermonProcessingJob(sermonId, "EXPORT_CLIPS");
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Clip export is already queued for your local worker."
        : "Clip export queued for your local worker.",
    };
  }

  try {
    const summary = await renderApprovedClipsForSermon(sermonId, { force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: `Rendered ${summary.completed} clip(s). Skipped ${summary.skipped}. Failed ${summary.failed}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clip export failed.";
    return {
      success: false,
      message,
    };
  }
}

export async function renderClipCandidateAction(clipId: string): Promise<RenderClipActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for rendering.",
    };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "render_clip", clipId: clip.id },
    async () => {
      if (clip.status !== "APPROVED" && clip.status !== "SUGGESTED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Render is blocked because this clip cannot be prepared in its current state.",
            "Set the clip back to suggested or approved, then click Render.",
          ),
        };
      }

      if (clip.renderStatus === "RENDERING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Render is already in progress for this clip.",
            "Wait for the current render to complete before retrying.",
          ),
        };
      }

      if (clip.renderStatus === "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Clip is already rendered.",
            "Use Rerender if you need to regenerate this output.",
          ),
        };
      }

      try {
        const result = await renderApprovedClip(clip.id);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return {
          success: true,
          message: `Clip rendered to ${result.renderedFilePath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clip render failed due to an unknown error.";
        await logClipFailure(clip.id, "render", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return {
          success: false,
          message,
        };
      }
    },
  );
}

export async function rerenderClipCandidateAction(clipId: string): Promise<RenderClipActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for rerender.",
    };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "rerender_clip", clipId: clip.id },
    async () => {
      if (clip.status === "REJECTED" || clip.status === "SUGGESTED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Preparing this video is blocked because the clip is not approved.",
            "Approve the clip, then prepare the video again.",
          ),
        };
      }

      if (clip.renderStatus === "RENDERING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "This video is already being prepared.",
            "Wait for preparation to finish before trying again.",
          ),
        };
      }

      try {
        const result = await renderApprovedClip(clip.id, {
          allowRerender: true,
          force: true,
        });
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: `Clip video prepared: ${result.renderedFilePath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clip rerender failed due to an unknown error.";
        await logClipFailure(clip.id, "rerender", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return {
          success: false,
          message,
        };
      }
    },
  );
}

export async function exportVerticalClipAction(clipId: string): Promise<ClipExportActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for vertical export.",
    };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "export_vertical_clip", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Creating this download is blocked because the video is not prepared.",
            "Prepare the clip first, then create the download.",
          ),
        };
      }

      if (clip.exportStatus === "EXPORTING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "This download is already being created.",
            "Wait for the download to finish before trying again.",
          ),
        };
      }

      if (clip.exportStatus === "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "This clip already has a download.",
            "Use Prepare Approved Clips if you need to recreate it.",
          ),
        };
      }

      try {
        const result = await exportVerticalClip(clip.id);
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: `Download created: ${result.exportPath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Vertical export failed due to an unknown error.";
        await logClipFailure(clip.id, "vertical export", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return {
          success: false,
          message,
        };
      }
    },
  );
}

export async function reexportVerticalClipAction(clipId: string): Promise<ClipExportActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for vertical re-export.",
    };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "reexport_vertical_clip", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Recreating this download is blocked because the video is not prepared.",
            "Prepare the clip first, then recreate the download.",
          ),
        };
      }

      if (clip.exportStatus === "EXPORTING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "This download is already being recreated.",
            "Wait for the download step to finish before trying again.",
          ),
        };
      }

      try {
        const result = await exportVerticalClip(clip.id, {
          allowReexport: true,
          force: true,
        });
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: `Vertical export re-run completed: ${result.exportPath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Vertical re-export failed due to an unknown error.";
        await logClipFailure(clip.id, "vertical re-export", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return {
          success: false,
          message,
        };
      }
    },
  );
}

export async function generateSubtitlesForClipAction(clipId: string): Promise<SubtitleActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for subtitle generation." };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "generate_captions", clipId: clip.id },
    async () => {
      if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption generation is blocked because this clip is not approved.",
            "Approve the clip first, then generate captions.",
          ),
        };
      }

      if (clip.captionStatus === "GENERATING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption generation is already in progress.",
            "Wait for generation to finish before retrying.",
          ),
        };
      }

      try {
        const result = await generateCaptionsForClip(clip.id, { force: true });
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: result.reusedExistingFile
            ? "Existing subtitle file reused."
            : `Generated ${result.cueCount} caption cue(s).`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Caption generation failed due to an unknown error.";
        await logClipFailure(clip.id, "caption generation", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return { success: false, message };
      }
    },
  );
}

export async function burnSubtitlesForClipAction(clipId: string): Promise<SubtitleActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for caption burn." };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "burn_captions", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption burn is blocked because render is incomplete.",
            "Render the clip first, then burn captions.",
          ),
        };
      }

      if (clip.captionStatus !== "GENERATED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption burn is blocked because captions are not generated.",
            "Generate captions first, then burn them into the video.",
          ),
        };
      }

      if (clip.captionBurnStatus === "BURNING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption burn is already running.",
            "Wait for caption burn to complete before retrying.",
          ),
        };
      }

      if (clip.captionBurnStatus === "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Caption burn already completed.",
            "Use Re-burn Captions if you need to regenerate output.",
          ),
        };
      }

      try {
        const result = await burnCaptionsIntoRenderedClip(clip.id);
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: result.reusedExistingFile ? "Existing captioned video reused." : "Captioned video generated.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Caption burn failed due to an unknown error.";
        await logClipFailure(clip.id, "caption burn", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return { success: false, message };
      }
    },
  );
}

export async function reburnSubtitlesForClipAction(clipId: string): Promise<SubtitleActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for adding captions to the video." };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "reburn_captions", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Adding captions to the video is blocked because the video is not prepared.",
            "Prepare the clip first, then add captions to the video.",
          ),
        };
      }

      if (clip.captionStatus !== "GENERATED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Adding captions to the video is blocked because captions are missing.",
            "Write captions first, then add them to the video.",
          ),
        };
      }

      try {
        await burnCaptionsIntoRenderedClip(clip.id, {
          allowReburn: true,
          force: true,
        });
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: "Captioned video re-burn completed.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Adding captions to the video failed due to an unknown error.";
        await logClipFailure(clip.id, "caption re-burn", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return { success: false, message };
      }
    },
  );
}

export async function generateAndBurnSubtitlesForExportedClipsAction(
  _prevState: SubtitleActionState,
  formData: FormData,
): Promise<SubtitleActionState> {
  const normalizedSermonId = String(formData.get("sermonId") ?? "").trim();
  if (!normalizedSermonId) {
    return { success: false, message: "Missing sermon id for caption generation." };
  }

  try {
    const result = await generateCaptionsForApprovedClips(normalizedSermonId, { force: true });
    revalidatePath(`/sermons/${normalizedSermonId}`);
    revalidatePath("/");

    if (result.failed > 0) {
      return {
        success: false,
        message: `Generated captions for ${result.generated} clip(s), reused ${result.reused}, skipped ${result.skipped}, failed ${result.failed}.`,
      };
    }

    if (result.attempted === 0) {
      return {
        success: false,
        message: "No approved clips are available for caption generation. Approve at least one clip first.",
      };
    }

    return {
      success: true,
      message: `Generated captions for ${result.generated} approved clip(s), reused ${result.reused}, skipped ${result.skipped}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caption generation failed.";
    return { success: false, message };
  }
}

export async function generateCaptionsForApprovedClipsAction(
  prevState: SubtitleActionState,
  formData: FormData,
): Promise<SubtitleActionState> {
  return generateAndBurnSubtitlesForExportedClipsAction(prevState, formData);
}

export async function approveClipCandidateAction(clipId: string): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for approval.",
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
    };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      status: "APPROVED",
    },
  });

  try {
    await generateCaptionsForClip(clip.id, { force: true });
  } catch (error) {
    const captionError = error instanceof Error ? error.message : "Unknown caption generation error.";
    revalidatePath(`/sermons/${clip.sermonId}`);
    revalidatePath("/");

    return {
      success: false,
      message: `Clip approved, but caption generation failed: ${captionError}`,
    };
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath("/");

  return {
    success: true,
    message: "Clip approved and captions generated.",
  };
}

export async function rejectClipCandidateAction(clipId: string): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for rejection.",
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
    };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      status: "REJECTED",
    },
  });

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath("/");

  return {
    success: true,
    message: "Clip rejected.",
  };
}

async function prepareApprovedClipAfterReview(clipId: string, captionStylePresetId: CaptionStylePresetId): Promise<void> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      exportLayoutStrategy: true,
      renderStatus: true,
    },
  });

  if (!clip) {
    throw new Error("Clip candidate was not found.");
  }

  if (clip.exportLayoutStrategy !== "SMART_CROP") {
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: { exportLayoutStrategy: "SMART_CROP" },
    });
  }

  await refreshVideoSubjectTrackingBestEffort(clip.id, clip.sermonId);

  if (clip.renderStatus !== "COMPLETED" || clip.exportLayoutStrategy !== "SMART_CROP") {
    await renderApprovedClipWithFallback({
      clipId: clip.id,
      sermonId: clip.sermonId,
      exportLayoutStrategy: "SMART_CROP",
    });
  }

  await generateCaptionsForClip(clip.id, { force: true });
  await burnCaptionsIntoRenderedClip(clip.id, {
    allowReburn: true,
    force: true,
    captionStylePresetId,
  });
  await renderClipOverlayBestEffort(clip.id, clip.sermonId);
}

export async function setClipReviewStatusAction(
  clipId: string,
  status: ClipReviewStatus,
): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for status update." };
  }

  if (!["APPROVED", "REJECTED", "SUGGESTED"].includes(status)) {
    return { success: false, message: "Invalid review status." };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: { id: true, sermonId: true, status: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: { status },
  });

  if (status === "APPROVED") {
    try {
      const brandingSettings = await getBrandingSettings();
      await prepareApprovedClipAfterReview(
        clip.id,
        brandingSettings.defaultCaptionStyleName as CaptionStylePresetId,
      );
    } catch (error) {
      const preparationError = error instanceof Error ? error.message : "Unknown approved clip preparation error.";
      revalidatePath(`/sermons/${clip.sermonId}`);
      revalidatePath(`/sermons/${clip.sermonId}/review`);
      revalidatePath("/");
      return {
        success: false,
        message: `Clip approved, but caption burn/overlay preparation failed: ${preparationError}`,
      };
    }
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath("/");

  const labelByStatus: Record<ClipReviewStatus, string> = {
    APPROVED: "approved",
    REJECTED: "rejected",
    SUGGESTED: "moved to pending review",
  };

  return {
    success: true,
    message: `Clip ${labelByStatus[status]}.`,
  };
}

export async function updateClipReviewContentAction(
  input: UpdateClipReviewContentInput,
): Promise<UpdateClipCandidateState> {
  const parsed = updateClipReviewContentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: {
        title: fieldErrors.title?.[0],
        hook: fieldErrors.hook?.[0],
        caption: fieldErrors.caption?.[0],
        hashtags: fieldErrors.hashtags?.[0],
      },
    };
  }

  const hashtags = normalizeHashtagInput(parsed.data.hashtags);
  const hashtagsError = validateHashtags(hashtags);
  if (hashtagsError) {
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: { hashtags: hashtagsError },
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: parsed.data.clipId },
    select: { id: true, sermonId: true, status: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      title: parsed.data.title,
      hook: parsed.data.hook,
      caption: parsed.data.caption,
      hashtags,
      clipNotes: parsed.data.clipNotes.trim() || null,
      isManuallyEdited: true,
    },
  });

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath("/");

  return {
    success: true,
    message: "Clip details saved.",
  };
}

export async function refreshSermonClipQualityAction(input: {
  sermonId: string;
  force?: boolean;
}): Promise<RefreshClipQualityActionState> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for quality refresh.",
      clipsFound: 0,
      clipsRefreshed: 0,
      clipsSkipped: 0,
      clipsFailed: 1,
      fallbackReviews: 0,
      failures: [{ clipId: "sermon", reason: "Missing sermon id." }],
    };
  }

  return runOperationWithLogging<RefreshClipQualityActionState>(
    { sermonId, operation: input.force ? "force_refresh_clip_quality" : "refresh_clip_quality" },
    async () => {
      const summary = await refreshSermonClipQuality({
        sermonId,
        mode: input.force ? "force" : "missing",
      });

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      const success = summary.clipsFailed === 0;
      const message = summary.clipsRefreshed > 0
        ? success
          ? `Quality refreshed for ${summary.clipsRefreshed} clip(s). ${summary.clipsSkipped} already up to date.`
          : `Quality refresh finished with ${summary.clipsFailed} clip(s) needing attention. ${summary.clipsRefreshed} refreshed.`
        : summary.clipsFound === 0
          ? "No clips were found for this sermon yet."
          : success
            ? "Quality intelligence is already up to date."
            : `Quality refresh could not update any clips. ${summary.clipsFailed} clip(s) need attention.`;

      return {
        success,
        message,
        ...summary,
      };
    },
  );
}

function refreshJobMessage(summary: ClipQualityRefreshSummary): string {
  if (summary.clipsFound === 0) {
    return "No clips were found for this sermon yet.";
  }

  if (summary.clipsFailed > 0) {
    return `Quality refresh finished with ${summary.clipsFailed} clip(s) needing attention. ${summary.clipsRefreshed} refreshed, ${summary.clipsSkipped} skipped.`;
  }

  if (summary.clipsRefreshed > 0) {
    return `Quality refreshed for ${summary.clipsRefreshed} clip(s). ${summary.clipsSkipped} already up to date.`;
  }

  return "Quality intelligence is already up to date.";
}

async function processClipQualityRefreshJob(input: {
  jobId: string;
  sermonId: string;
  force?: boolean;
}): Promise<RefreshClipQualityJobActionState> {
  await markJobRunning(input.jobId);
  await appendJobLog(input.jobId, `Quality refresh started. mode=${input.force ? "force" : "missing"}`);

  try {
    const summary = await refreshSermonClipQuality({
      sermonId: input.sermonId,
      mode: input.force ? "force" : "missing",
    });
    const summaryLog = `Quality refresh counts: found=${summary.clipsFound} refreshed=${summary.clipsRefreshed} skipped=${summary.clipsSkipped} failed=${summary.clipsFailed} fallback=${summary.fallbackReviews}`;
    const failureLog = summary.failures.length > 0
      ? ` Failures: ${summary.failures.map((failure) => `${failure.clipId}: ${failure.reason}`).join(" | ")}`
      : "";

    if (summary.clipsFailed > 0) {
      await markJobFailed(input.jobId, `${summary.clipsFailed} clip(s) could not be refreshed.`, `${summaryLog}${failureLog}`);
    } else {
      await markJobSucceeded(input.jobId, summaryLog);
    }

    revalidatePath(`/sermons/${input.sermonId}`);
    revalidatePath(`/sermons/${input.sermonId}/review`);
    revalidatePath("/");

    return {
      success: summary.clipsFailed === 0,
      message: refreshJobMessage(summary),
      jobId: input.jobId,
      status: summary.clipsFailed > 0 ? "PARTIAL" : "COMPLETED",
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown quality refresh job error.";
    await markJobFailed(input.jobId, message, "Quality refresh crashed before counts were available.");
    revalidatePath(`/sermons/${input.sermonId}`);
    revalidatePath(`/sermons/${input.sermonId}/review`);
    return {
      success: false,
      message,
      jobId: input.jobId,
      status: "FAILED",
      summary: null,
    };
  }
}

export async function startSermonClipQualityRefreshJobAction(input: {
  sermonId: string;
  force?: boolean;
}): Promise<RefreshClipQualityJobActionState> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for quality refresh.",
      jobId: null,
      status: "FAILED",
      summary: null,
    };
  }

  const existingJob = await prisma.processingJob.findFirst({
    where: {
      sermonId,
      type: "QUALITY_REFRESH",
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingJob) {
    return {
      success: true,
      message: "Quality refresh is already running for this sermon.",
      jobId: existingJob.id,
      status: existingJob.status === "RUNNING" ? "RUNNING" : "QUEUED",
      summary: null,
    };
  }

  const job = await createProcessingJob(sermonId, "QUALITY_REFRESH");
  if (!canRunLocalMediaProcessing()) {
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);

    return {
      success: true,
      message: "Quality refresh queued for your local worker.",
      jobId: job.id,
      status: "QUEUED",
      summary: null,
    };
  }

  void processClipQualityRefreshJob({ jobId: job.id, sermonId, force: input.force });

  revalidatePath(`/sermons/${sermonId}`);
  revalidatePath(`/sermons/${sermonId}/review`);

  return {
    success: true,
    message: "Quality refresh started in the background.",
    jobId: job.id,
    status: "QUEUED",
    summary: null,
  };
}

export async function curateSermonAiSuggestionsAction(input: {
  sermonId: string;
  maxReviewSuggestions?: number;
}): Promise<CurateClipSuggestionsActionState> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for curation.",
      clipsFound: 0,
      clipsKept: 0,
      clipsRejected: 0,
      rejectedWeak: 0,
      rejectedOverflow: 0,
      decisions: [],
    };
  }

  return runOperationWithLogging<CurateClipSuggestionsActionState>(
    { sermonId, operation: "curate_ai_suggestions" },
    async () => {
      const refreshSummary = await refreshSermonClipQuality({
        sermonId,
        mode: "force",
      });
      if (refreshSummary.clipsFailed > 0) {
        return {
          success: false,
          message: `Curation paused because ${refreshSummary.clipsFailed} clip quality review${refreshSummary.clipsFailed === 1 ? "" : "s"} failed. Recheck readiness, then curate again.`,
          clipsFound: refreshSummary.clipsFound,
          clipsKept: 0,
          clipsRejected: 0,
          rejectedWeak: 0,
          rejectedOverflow: 0,
          decisions: [],
        };
      }

      const summary = await curateSermonAiSuggestions({
        sermonId,
        maxReviewSuggestions: input.maxReviewSuggestions,
      });

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      return {
        success: true,
        message: summary.clipsFound === 0
          ? "No AI suggestions needed curation."
          : `Curated pastor review feed after fresh quality scoring: kept ${summary.clipsKept}, rejected ${summary.clipsRejected}.`,
        ...summary,
      };
    },
  );
}

export async function saveManualCropCorrectionAction(input: {
  clipId: string;
  direction?: ManualCropPresetDirection;
  nudge?: "left" | "right";
  keyframes?: Array<{ timeSeconds: number; centerX: number; centerY?: number; zoom?: number }>;
}): Promise<ManualCropActionState> {
  const parsed = manualCropSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Please choose a valid crop correction." };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: parsed.data.clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      durationSeconds: true,
      manualCropKeyframes: true,
    },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  const keyframes = parsed.data.keyframes
    ? normalizeManualCropKeyframes(parsed.data.keyframes)
    : parsed.data.nudge
      ? nudgeManualCropKeyframes({ keyframes: clip.manualCropKeyframes, direction: parsed.data.nudge, durationSeconds: clip.durationSeconds })
      : buildPresetManualCropKeyframes({ direction: parsed.data.direction ?? "center", durationSeconds: clip.durationSeconds });

  if (keyframes.length === 0) {
    return { success: false, message: "Manual crop correction did not include any usable keyframes." };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      manualCropKeyframes: keyframes,
      manualCropUpdatedAt: new Date(),
      exportLayoutStrategy: "SMART_CROP",
      smartCropDebugSnapshotPath: null,
      smartCropDebugGeneratedAt: null,
      smartCropDebugError: null,
    },
  });
  await invalidateAfterBoundaryOrCropChange(clip.id, "Manual crop correction updated.");
  await appendPipelineLog(clip.sermonId, `Manual crop correction saved for clip ${clip.id}.`);
  await revalidateClipPaths(clip.id, clip.sermonId);

  return { success: true, message: "Manual framing saved. Re-render the preview to apply it." };
}

export async function resetManualCropCorrectionAction(clipId: string): Promise<ManualCropActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for crop reset." };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: { id: true, sermonId: true, status: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      manualCropKeyframes: Prisma.JsonNull,
      manualCropUpdatedAt: null,
      smartCropDebugSnapshotPath: null,
      smartCropDebugGeneratedAt: null,
      smartCropDebugError: null,
    },
  });
  await invalidateAfterBoundaryOrCropChange(clip.id, "Manual crop correction reset.");
  await appendPipelineLog(clip.sermonId, `Manual crop correction reset for clip ${clip.id}.`);
  await revalidateClipPaths(clip.id, clip.sermonId);

  return { success: true, message: "Manual framing reset. Re-render the preview to return to automatic smart crop." };
}

export async function generateSmartCropDebugSnapshotAction(clipId: string): Promise<SmartCropDebugActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for smart crop debug snapshot.", snapshotPath: null };
  }

  const sermonId = await getClipSermonId(normalizedClipId);
  if (!sermonId) {
    return { success: false, message: "Clip candidate was not found.", snapshotPath: null };
  }

  return runOperationWithLogging<SmartCropDebugActionState>(
    { sermonId, clipId: normalizedClipId, operation: "generate_smart_crop_debug_snapshot" },
    async () => {
      const result = await generateSmartCropDebugSnapshot(normalizedClipId);
      await revalidateClipPaths(normalizedClipId, sermonId);
      return {
        success: true,
        message: result.warning ?? "Smart crop debug snapshot generated.",
        snapshotPath: result.snapshotPath,
      };
    },
  );
}

export async function runClipBatchReviewAction(input: {
  sermonId: string;
  clipIds: string[];
  action: ClipReviewBatchAction;
}): Promise<ClipReviewBatchActionState> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for batch action.",
      processed: 0,
      failed: 0,
      failures: [],
    };
  }

  if (input.action === "prepare") {
    return prepareApprovedClipsAction({
      sermonId,
      clipIds: input.clipIds,
    });
  }

  const clipIds = Array.from(new Set(input.clipIds.map((id) => id.trim()).filter((id) => id.length > 0)));
  if (clipIds.length === 0) {
    return {
      success: false,
      message: "Select at least one clip.",
      processed: 0,
      failed: 0,
      failures: [],
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      id: { in: clipIds },
    },
    select: {
      id: true,
      sermonId: true,
      status: true,
    },
  });

  return runOperationWithLogging<ClipReviewBatchActionState>(
    { sermonId, operation: `batch_review_${input.action}` },
    async () => {
      const brandingSettings = input.action === "approve" ? await getBrandingSettings() : null;
      const clipById = new Map(clips.map((clip) => [clip.id, clip]));
      let processed = 0;
      const failures: Array<{ clipId: string; reason: string }> = [];

      for (const clipId of clipIds) {
        const clip = clipById.get(clipId);
        if (!clip) {
          failures.push({ clipId, reason: "Clip not found for this sermon." });
          continue;
        }

        if (clip.status === "EXPORTED" && ["approve", "reject", "pending"].includes(input.action)) {
          failures.push({ clipId, reason: "Ready-to-post clips are locked. Open Clip Studio to prepare a new version." });
          continue;
        }

        try {
          if (input.action === "approve") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "APPROVED" } });
            await prepareApprovedClipAfterReview(
              clipId,
              (brandingSettings?.defaultCaptionStyleName ?? "clean-lower") as CaptionStylePresetId,
            );
          } else if (input.action === "reject") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "REJECTED" } });
          } else if (input.action === "pending") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "SUGGESTED" } });
          } else if (input.action === "render") {
            await renderApprovedClip(clipId, { force: true, allowRerender: true });
          } else if (input.action === "export") {
            await prisma.clipCandidate.update({
              where: { id: clipId },
              data: { exportLayoutStrategy: "SMART_CROP" },
            });
            await refreshVideoSubjectTrackingBestEffort(clipId, sermonId);
            await renderApprovedClipWithFallback({
              clipId,
              sermonId,
              exportLayoutStrategy: "SMART_CROP",
            });
            await exportVerticalClipWithFallback({
              clipId,
              sermonId,
              layoutStrategy: "SMART_CROP",
              brandingOverlay: null,
            });
          }

          processed += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown batch action error.";
          failures.push({ clipId, reason });
        }
      }

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      const failed = failures.length;
      const outcome: ClipReviewBatchActionState = {
        success: failed === 0,
        message:
          failed === 0
            ? `Batch action completed for ${processed} clip(s).`
            : `Batch action completed with ${failed} failure(s). Processed ${processed}.`,
        processed,
        failed,
        failures,
      };

      return outcome;
    },
  );
}

export async function prepareApprovedClipsAction(input: {
  sermonId: string;
  clipIds?: string[];
}): Promise<PrepareApprovedClipsState> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for clip preparation.",
      processed: 0,
      prepared: 0,
      captionsAdded: 0,
      brandingAdded: 0,
      readyToPost: 0,
      failed: 0,
      failures: [],
    };
  }

  const requestedClipIds = Array.from(
    new Set((input.clipIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0)),
  );

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
      ...(requestedClipIds.length > 0 ? { id: { in: requestedClipIds } } : {}),
    },
    orderBy: { score: "desc" },
    select: {
      id: true,
      exportLayoutStrategy: true,
      renderStatus: true,
      captionStatus: true,
      captionBurnStatus: true,
      captionData: true,
      overlayStatus: true,
      exportStatus: true,
    },
  });

  if (clips.length === 0) {
    return {
      success: false,
      message:
        requestedClipIds.length > 0
          ? "None of the selected clips are approved yet. Approve the clips you like, then prepare them."
          : "No approved clips yet. Approve the clips you like, then prepare them.",
      processed: 0,
      prepared: 0,
      captionsAdded: 0,
      brandingAdded: 0,
      readyToPost: 0,
      failed: 0,
      failures: [],
    };
  }

  return runOperationWithLogging<PrepareApprovedClipsState>(
    { sermonId, operation: "prepare_approved_clips" },
    async () => {
      const [sermon, brandingSettings] = await Promise.all([
        prisma.sermon.findUnique({
          where: { id: sermonId },
          select: {
            title: true,
            speakerName: true,
            churchName: true,
          },
        }),
        getBrandingSettings(),
      ]);
      let processed = 0;
      let prepared = 0;
      let captionsAdded = 0;
      let brandingAdded = 0;
      let readyToPost = 0;
      const failures: Array<{ clipId: string; reason: string }> = [];

      for (const clip of clips) {
        try {
          const plan = buildPrepareClipPlan(clip);
          const captionDataRecord =
            clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
              ? (clip.captionData as Record<string, unknown>)
              : {};
          const shouldApplyCaptions = typeof captionDataRecord["applyCaptionsToClip"] === "boolean"
            ? captionDataRecord["applyCaptionsToClip"]
            : true;
          const needsSmartCropRerender = clip.exportLayoutStrategy !== "SMART_CROP";
          const prepareVideo = plan.prepareVideo || needsSmartCropRerender;
          const writeCaptions = shouldApplyCaptions && plan.writeCaptions;
          const addCaptionsToVideo = shouldApplyCaptions && (plan.addCaptionsToVideo || prepareVideo || writeCaptions);
          const addChurchBranding = plan.addChurchBranding || prepareVideo || addCaptionsToVideo;
          const createDownload = plan.createDownload || prepareVideo || addCaptionsToVideo || addChurchBranding;

          if (needsSmartCropRerender) {
            await prisma.clipCandidate.update({
              where: { id: clip.id },
              data: { exportLayoutStrategy: "SMART_CROP" },
            });
          }

          await refreshVideoSubjectTrackingBestEffort(clip.id, sermonId);

          if (prepareVideo) {
            await renderApprovedClipWithFallback({
              clipId: clip.id,
              sermonId,
              exportLayoutStrategy: needsSmartCropRerender ? "SMART_CROP" : clip.exportLayoutStrategy,
            });
          }

          if (writeCaptions) {
            await generateCaptionsForClip(clip.id, { force: true });
            captionsAdded += 1;
          }

          if (addCaptionsToVideo) {
            await burnCaptionsIntoRenderedClip(clip.id, {
              allowReburn: true,
              force: true,
              captionStylePresetId: brandingSettings.defaultCaptionStyleName as CaptionStylePresetId,
            });
          }

          if (addChurchBranding) {
            const overlayRendered = await renderClipOverlayBestEffort(clip.id, sermonId);
            if (overlayRendered) {
              brandingAdded += 1;
            }
          }

          if (createDownload) {
            await exportVerticalClipWithFallback({
              clipId: clip.id,
              sermonId,
              layoutStrategy: clip.exportLayoutStrategy ?? "SMART_CROP",
              brandingOverlay: sermon
                ? {
                    config: {
                      enabled: true,
                      preset: "CLEAN_LOWER_THIRD",
                      showChurchName: true,
                      showSermonTitle: true,
                      showPreacherName: true,
                      watermarkEnabled: true,
                      lowerThirdEnabled: true,
                      themeColor: brandingSettings.primaryBrandColor,
                    },
                    sermonTitle: sermon.title,
                    preacherName: sermon.speakerName,
                    churchName: sermon.churchName,
                    watermarkPosition: brandingSettings.watermarkPosition,
                  }
                : null,
            });
          }

          await prisma.clipCandidate.update({
            where: { id: clip.id },
            data: { status: "EXPORTED" },
          });

          processed += 1;
          prepared += 1;
          readyToPost += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown preparation error.";
          failures.push({ clipId: clip.id, reason });
          await appendPipelineLog(sermonId, `prepare approved clip failed for ${clip.id}: ${reason}`);
        }
      }

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/ready-to-post");
      revalidatePath("/");

      const failed = failures.length;
      const summary = buildPrepareApprovedSummary({ prepared, failed });
      return {
        success: summary.success,
        message: summary.message,
        processed,
        prepared,
        captionsAdded,
        brandingAdded,
        readyToPost,
        failed,
        failures,
      };
    },
  );
}

export async function repairFailedClipOperationsAction(
  sermonIdInput: string,
): Promise<RepairFailedClipOperationsState> {
  const sermonId = sermonIdInput.trim();
  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for clip repair.",
      previewPrepared: 0,
      previewFailed: 0,
      approvedPrepared: 0,
      approvedFailed: 0,
    };
  }

  const failedApprovedClips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
      OR: [
        { renderStatus: "FAILED" },
        { captionStatus: "FAILED" },
        { captionBurnStatus: "FAILED" },
        { overlayStatus: "FAILED" },
        { exportStatus: "FAILED" },
        { renderFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } },
        { captionFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } },
        { captionBurnFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } },
        { overlayFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } },
        { exportFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } },
      ],
    },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });

  const failedPreviewCount = await prisma.clipCandidate.count({
    where: {
      sermonId,
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "FAILED",
    },
  });

  if (failedApprovedClips.length === 0 && failedPreviewCount === 0) {
    return {
      success: true,
      message: "No failed clip operations need repair right now.",
      previewPrepared: 0,
      previewFailed: 0,
      approvedPrepared: 0,
      approvedFailed: 0,
    };
  }

  return runOperationWithLogging<RepairFailedClipOperationsState>(
    { sermonId, operation: "repair_failed_clip_operations" },
    async () => {
      const previewSummary = failedPreviewCount > 0
        ? await prepareGeneratedClipPreviews({ sermonId, force: true, onlyFailed: true })
        : { prepared: 0, failed: 0, skipped: 0 };
      const approvedSummary = failedApprovedClips.length > 0
        ? await prepareApprovedClipsAction({
            sermonId,
            clipIds: failedApprovedClips.map((clip) => clip.id),
          })
        : {
            success: true,
            message: "",
            processed: 0,
            prepared: 0,
            captionsAdded: 0,
            brandingAdded: 0,
            readyToPost: 0,
            failed: 0,
            failures: [],
          };

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath(`/ready-to-post?sermonId=${sermonId}`);
      revalidatePath("/ready-to-post");
      revalidatePath("/");

      const totalFailed = previewSummary.failed + approvedSummary.failed;
      const totalPrepared = previewSummary.prepared + approvedSummary.prepared;

      return {
        success: totalFailed === 0,
        message: totalFailed === 0
          ? `Repair completed. Refreshed ${totalPrepared} clip operation${totalPrepared === 1 ? "" : "s"}.`
          : `Repair finished with ${totalFailed} item${totalFailed === 1 ? "" : "s"} still needing attention.`,
        previewPrepared: previewSummary.prepared,
        previewFailed: previewSummary.failed,
        approvedPrepared: approvedSummary.prepared,
        approvedFailed: approvedSummary.failed,
      };
    },
  );
}

export type UpdateClipFramingState = {
  success: boolean;
  message: string;
};

export async function updateClipFramingAction(
  clipId: string,
  framingPreset: string,
): Promise<UpdateClipFramingState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for framing update." };
  }

  if (!(SELECTABLE_FRAMING_PRESETS as string[]).includes(framingPreset)) {
    return {
      success: false,
      message: `Invalid framing preset: "${framingPreset}". Must be one of: ${SELECTABLE_FRAMING_PRESETS.join(", ")}.`,
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: { id: true, sermonId: true, status: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      // Store framing choice via the exportLayoutStrategy field.
      exportLayoutStrategy: framingPreset as (typeof SELECTABLE_FRAMING_PRESETS)[number],
    },
  });

  await invalidateAfterBoundaryOrCropChange(
    clip.id,
    `Framing changed to ${framingPreset}. Render and downstream assets marked outdated.`,
  );
  await appendPipelineLog(
    clip.sermonId,
    `Regeneration invalidation started: framing changed for clip ${clip.id}.`,
  );
  await appendPipelineLog(
    clip.sermonId,
    `Regeneration invalidation completed: render/caption/burn/overlay/export freshness updated for clip ${clip.id}.`,
  );

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath("/");

  return { success: true, message: `Framing set to ${framingPreset.replace(/_/g, " ").toLowerCase()}.` };
}

export async function updateClipCandidateAction(
  input: UpdateClipCandidateInput,
): Promise<UpdateClipCandidateState> {
  const parsed = updateClipCandidateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: {
        title: fieldErrors.title?.[0],
        hook: fieldErrors.hook?.[0],
        caption: fieldErrors.caption?.[0],
        hashtags: fieldErrors.hashtags?.[0],
        startTimeSeconds: fieldErrors.startTimeSeconds?.[0],
        endTimeSeconds: fieldErrors.endTimeSeconds?.[0],
      },
    };
  }

  const hashtags = normalizeHashtagInput(parsed.data.hashtags);
  const hashtagsError = validateHashtags(hashtags);
  if (hashtagsError) {
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: {
        hashtags: hashtagsError,
      },
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: parsed.data.clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      title: true,
      hook: true,
      caption: true,
      hashtags: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      exportLayoutStrategy: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
    };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  const durationSeconds = parsed.data.endTimeSeconds - parsed.data.startTimeSeconds;
  const previousHashtags = Array.isArray(clip.hashtags)
    ? clip.hashtags.filter((item): item is string => typeof item === "string")
    : [];

  const impact = detectClipEditImpact(
    {
      title: clip.title,
      hook: clip.hook,
      caption: clip.caption,
      hashtags: previousHashtags,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      exportLayoutStrategy: clip.exportLayoutStrategy,
    },
    {
      title: parsed.data.title,
      hook: parsed.data.hook,
      caption: parsed.data.caption,
      hashtags,
      startTimeSeconds: parsed.data.startTimeSeconds,
      endTimeSeconds: parsed.data.endTimeSeconds,
      exportLayoutStrategy: clip.exportLayoutStrategy,
    },
  );

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      title: parsed.data.title,
      hook: parsed.data.hook,
      caption: parsed.data.caption,
      hashtags,
      startTimeSeconds: parsed.data.startTimeSeconds,
      endTimeSeconds: parsed.data.endTimeSeconds,
      durationSeconds,
      adjustedStartTimeSeconds: parsed.data.startTimeSeconds,
      adjustedEndTimeSeconds: parsed.data.endTimeSeconds,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryAdjustmentReason: `Clip boundaries were manually edited to ${parsed.data.startTimeSeconds.toFixed(2)}-${parsed.data.endTimeSeconds.toFixed(2)}s. Re-review recommended.`,
      isManuallyEdited: true,
    },
  });

  if (impact.boundariesChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: boundary change.`);
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      `Boundaries changed to ${parsed.data.startTimeSeconds.toFixed(2)}-${parsed.data.endTimeSeconds.toFixed(2)}s.`,
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  } else if (impact.captionTextChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: caption text change.`);
    await invalidateAfterCaptionTextChange(
      clip.id,
      "Caption text changed. Caption, burned captions, and exports require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: caption/burn/export freshness updated.`,
    );
  } else if (impact.metadataOnlyChanged) {
    await appendPipelineLog(
      clip.sermonId,
      `Clip ${clip.id} content edited (${impact.changedFields.join(", ") || "metadata"}) with no media regeneration required.`,
    );
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath("/");

  return {
    success: true,
    message: impact.boundariesChanged
      ? "Clip details updated. Render and downstream assets were marked outdated."
      : impact.captionTextChanged
        ? "Clip details updated. Caption, burned captions, and exports were marked outdated."
        : "Clip details updated. No video rerender required.",
  };
}

function normalizeClipStudioCaptionStylePresetId(value: string): CaptionStylePresetId | null {
  const trimmed = value.trim();
  if (
    trimmed === "bold-sermon" ||
    trimmed === "clean-lower" ||
    trimmed === "high-contrast" ||
    trimmed === "youth-social" ||
    trimmed === "minimal-church" ||
    trimmed === "scripture-focus" ||
    trimmed === "cinematic-testimony"
  ) {
    return trimmed;
  }

  return null;
}

function normalizeHookOverlay(input: UpdateClipStudioEditsInput["hookOverlay"]) {
  const position =
    input.position === "top" || input.position === "center" || input.position === "lower"
      ? input.position
      : "top";
  const animation =
    input.animation === "fade" || input.animation === "pan-in" || input.animation === "pop" || input.animation === "none"
      ? input.animation
      : "fade";
  const size = input.size === "small" || input.size === "medium" || input.size === "large" ? input.size : "medium";

  return {
    enabled: Boolean(input.enabled),
    text: String(input.text ?? "").trim(),
    position,
    startSeconds: Number.isFinite(input.startSeconds) ? Math.max(0, input.startSeconds) : 0,
    durationSeconds: Number.isFinite(input.durationSeconds)
      ? Math.min(20, Math.max(1, input.durationSeconds))
      : 6,
    animation,
    size,
    bold: Boolean(input.bold),
  };
}

export async function updateClipStudioEditsAction(
  input: UpdateClipStudioEditsInput,
): Promise<UpdateClipStudioEditsState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return {
      success: false,
      message: "Missing clip id for editing.",
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      hook: true,
      caption: true,
      hashtags: true,
      captionData: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
    };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  const durationSegment = await prisma.transcriptSegment.findFirst({
    where: { sermonId: clip.sermonId },
    orderBy: { endTimeSeconds: "desc" },
    select: { endTimeSeconds: true },
  });

  const knownDurationSeconds = durationSegment?.endTimeSeconds ?? null;
  const timing = validateClipStudioTiming({
    startTimestamp: input.startTimestamp,
    endTimestamp: input.endTimestamp,
    knownDurationSeconds,
  });

  if (!timing.isValid || timing.startSeconds === null || timing.endSeconds === null || timing.durationSeconds === null) {
    return {
      success: false,
      message: "Could not save clip changes. Please check the highlighted fields.",
      fieldErrors: timing.fieldErrors,
      warnings: timing.warnings,
    };
  }

  const hashtags = parseHashtagEditorInput(input.hashtags);
  const hashtagsError = validateHashtags(hashtags);
  if (hashtagsError) {
    return {
      success: false,
      message: "Could not save clip changes. Please check the highlighted fields.",
      fieldErrors: {
        hashtags: hashtagsError,
      },
      warnings: timing.warnings,
    };
  }

  const captionDataRecord =
    clip.captionData && typeof clip.captionData === "object" ? (clip.captionData as Record<string, unknown>) : {};
  const captionPackageRecord =
    captionDataRecord["captionPackage"] && typeof captionDataRecord["captionPackage"] === "object"
      ? (captionDataRecord["captionPackage"] as Record<string, unknown>)
      : {};
  const previousCues = Array.isArray(captionDataRecord["cues"]) ? captionDataRecord["cues"] : [];
  const previousHookOverlay =
    captionDataRecord["hookOverlay"] && typeof captionDataRecord["hookOverlay"] === "object"
      ? captionDataRecord["hookOverlay"]
      : null;
  const previousSpeechCleanup =
    captionDataRecord["speechCleanup"] && typeof captionDataRecord["speechCleanup"] === "object"
      ? {
          removeDeadAir: Boolean((captionDataRecord["speechCleanup"] as Record<string, unknown>)["removeDeadAir"]),
          tightenLongPauses: Boolean((captionDataRecord["speechCleanup"] as Record<string, unknown>)["tightenLongPauses"]),
          flagFillerWords: typeof (captionDataRecord["speechCleanup"] as Record<string, unknown>)["flagFillerWords"] === "boolean"
            ? Boolean((captionDataRecord["speechCleanup"] as Record<string, unknown>)["flagFillerWords"])
            : true,
        }
      : {
          removeDeadAir: false,
          tightenLongPauses: false,
          flagFillerWords: true,
        };

  const mainCaption = input.mainCaption.trim();
  const shortCaption = input.shortCaption.trim();
  const platformCaption = input.platformCaption.trim();
  const captionCueValidation = validateEditableCaptionCues(input.captionCues, timing.durationSeconds);
  const combinedWarnings = [...timing.warnings, ...captionCueValidation.warnings];
  if (input.applyCaptionsToClip && !captionCueValidation.isValid) {
    return {
      success: false,
      message: "Could not save clip changes. Please check the highlighted fields.",
      fieldErrors: {
        captionCues: captionCueValidation.errors[0],
      },
      warnings: combinedWarnings,
    };
  }

  const normalizedCaptionCues = captionCueValidation.cues;
  const normalizedCaptionStylePresetId = normalizeClipStudioCaptionStylePresetId(input.captionStylePresetId);
  const normalizedHookOverlay = normalizeHookOverlay(input.hookOverlay);
  const normalizedSpeechCleanup = {
    removeDeadAir: Boolean(input.speechCleanup?.removeDeadAir),
    tightenLongPauses: Boolean(input.speechCleanup?.tightenLongPauses),
    flagFillerWords: Boolean(input.speechCleanup?.flagFillerWords),
  };
  const hookText = input.hook.trim() || normalizedHookOverlay.text;
  if (normalizedHookOverlay.enabled && !normalizedHookOverlay.text) {
    return {
      success: false,
      message: "Could not save clip changes. Please check the highlighted fields.",
      fieldErrors: {
        hook: "Hook text is required when the hook overlay is enabled.",
      },
      warnings: timing.warnings,
    };
  }

  let srtPath = typeof clip.captionData === "object" && clip.captionData && typeof captionDataRecord["srtPath"] === "string"
    ? captionDataRecord["srtPath"]
    : null;
  if (input.applyCaptionsToClip) {
    await ensureSermonFolders(clip.sermonId);
    srtPath = getClipSrtPath(clip.sermonId, clip.id);
    await writeFile(/* turbopackIgnore: true */ srtPath, buildSrtFromEditableCues(normalizedCaptionCues), "utf8");
  }

  const previousHashtags = Array.isArray(clip.hashtags)
    ? clip.hashtags.filter((item): item is string => typeof item === "string")
    : [];

  const boundariesChanged =
    clip.startTimeSeconds !== timing.startSeconds || clip.endTimeSeconds !== timing.endSeconds;
  const captionChanged =
    clip.caption !== mainCaption ||
    JSON.stringify(previousCues) !== JSON.stringify(normalizedCaptionCues) ||
    captionPackageRecord["shortCaption"] !== shortCaption ||
    captionPackageRecord["platformCaption"] !== platformCaption ||
    captionDataRecord["applyCaptionsToClip"] !== input.applyCaptionsToClip ||
    captionDataRecord["captionStylePresetId"] !== normalizedCaptionStylePresetId;
  const hashtagChanged = previousHashtags.join("|") !== hashtags.join("|");
  const hookChanged = clip.hook !== hookText || JSON.stringify(previousHookOverlay) !== JSON.stringify(normalizedHookOverlay);
  const speechCleanupChanged = JSON.stringify(previousSpeechCleanup) !== JSON.stringify(normalizedSpeechCleanup);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      startTimeSeconds: timing.startSeconds,
      endTimeSeconds: timing.endSeconds,
      durationSeconds: timing.durationSeconds,
      adjustedStartTimeSeconds: timing.startSeconds,
      adjustedEndTimeSeconds: timing.endSeconds,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryAdjustmentReason: `Clip boundaries were manually edited to ${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s. Re-review recommended.`,
      caption: mainCaption,
      hook: hookText,
      hashtags,
      ...(input.applyCaptionsToClip && srtPath
        ? {
            captionStatus: "GENERATED" as const,
            subtitleFilePath: srtPath,
            srtPath,
            subtitlesGenerated: true,
            captionGenerationError: null,
          }
        : {}),
      captionData: {
        ...captionDataRecord,
        primaryCaption: mainCaption || null,
        shortCaption: shortCaption || null,
        platformCaption: platformCaption || null,
        applyCaptionsToClip: input.applyCaptionsToClip,
        captionStylePresetId: normalizedCaptionStylePresetId,
        cues: normalizedCaptionCues.map((cue) => ({
          index: cue.index,
          startSeconds: cue.startSeconds,
          endSeconds: cue.endSeconds,
          text: cue.text,
        })),
        hookOverlay: normalizedHookOverlay,
        speechCleanup: {
          ...normalizedSpeechCleanup,
          updatedAt: new Date().toISOString(),
        },
        srtPath,
        hashtags,
        manuallyEdited: true,
        manuallyEditedAt: new Date().toISOString(),
        captionPackage: {
          ...captionPackageRecord,
          primaryCaption: mainCaption || null,
          shortCaption: shortCaption || null,
          platformCaption: platformCaption || null,
          optionalHashtags: hashtags,
        },
      },
      isManuallyEdited: true,
    },
  });

  if (boundariesChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: boundary change from Clip Studio.`);
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      `Boundaries changed to ${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s from Clip Studio.`,
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  } else if (speechCleanupChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: speech cleanup setting change from Clip Studio.`);
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      "Speech cleanup settings changed from Clip Studio. Render and downstream assets require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  } else if (captionChanged || hashtagChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: caption change from Clip Studio.`);
    await invalidateAfterCaptionTextChange(
      clip.id,
      "Caption or hashtags changed from Clip Studio. Caption, burned captions, and exports require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: caption/burn/export freshness updated.`,
    );
  } else if (hookChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: hook overlay change from Clip Studio.`);
    await invalidateAfterOverlaySettingChange(
      clip.id,
      "Hook overlay changed from Clip Studio. Overlay and export assets require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: overlay/export freshness updated.`,
    );
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/");

  return {
    success: true,
    message: "Clip changes saved.",
    warnings: combinedWarnings,
  };
}

export async function updateClipExportSettingsAction(
  input: UpdateClipExportSettingsInput,
): Promise<UpdateClipExportSettingsState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return {
      success: false,
      message: "Missing clip id for export settings.",
    };
  }

  const fieldErrors: UpdateClipExportSettingsState["fieldErrors"] = {};

  if (!isValidPlatformPreset(input.platformPreset)) {
    fieldErrors.platformPreset = "This export setting is no longer supported. Please choose a new format.";
  }

  if (!isValidExportFormat(input.primaryFormat)) {
    fieldErrors.primaryFormat = "This export format is not supported. Please choose vertical or horizontal.";
  }

  if (!isValidFramingMode(input.framingMode)) {
    fieldErrors.framingMode = "This framing mode is not supported. Please choose center, left, right, or blurred background.";
  }

  if (input.framingPersonality !== undefined && !isValidFramingPersonality(input.framingPersonality)) {
    fieldErrors.framingPersonality = "This framing personality is not supported. Please choose a valid style.";
  }

  const selectedFormats = Array.isArray(input.selectedFormats)
    ? Array.from(new Set(input.selectedFormats.filter((value) => isValidExportFormat(value))))
    : [];

  if (Array.isArray(input.selectedFormats) && selectedFormats.length !== input.selectedFormats.length) {
    fieldErrors.selectedFormats = "One or more selected formats are no longer supported.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: "Could not save export settings. Please check the highlighted fields.",
      fieldErrors,
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      captionData: true,
      exportLayoutStrategy: true,
    },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  if (clip.status === "EXPORTED") {
    return {
      success: false,
      message: "Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.",
    };
  }

  const platformPreset = input.platformPreset as PlatformPreset;
  const mappedFormatFromPreset = mapPlatformPresetToFormat(platformPreset);
  const primaryFormat = isValidExportFormat(input.primaryFormat)
    ? input.primaryFormat
    : mappedFormatFromPreset;
  const framingMode = isValidFramingMode(input.framingMode)
    ? input.framingMode
    : "CENTER_CROP";
  const previousExportSettings = resolveExportSettings({
    exportFormat: primaryFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
  });
  const framingPersonality: FramingPersonality = isValidFramingPersonality(input.framingPersonality)
    ? input.framingPersonality
    : previousExportSettings.framingPersonality;
  const normalizedFormats = Array.from(new Set([primaryFormat, ...selectedFormats]));
  const backgroundMode = deriveBackgroundMode(framingMode);

  const captionDataRecord =
    clip.captionData && typeof clip.captionData === "object" ? (clip.captionData as Record<string, unknown>) : {};

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      exportFormat: primaryFormat,
      exportLayoutStrategy: framingMode,
      isManuallyEdited: true,
      captionData: {
        ...captionDataRecord,
        exportSettings: {
          platformPreset,
          primaryFormat,
          selectedFormats: normalizedFormats,
          framingMode,
          framingPersonality,
          backgroundMode,
          manuallyEdited: true,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });

  if (clip.exportLayoutStrategy !== framingMode || previousExportSettings.framingPersonality !== framingPersonality) {
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation started for clip ${clip.id}: framing settings changed from Clip Studio format settings.`,
    );
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      `Framing changed to ${framingMode} / ${framingPersonality} from Clip Studio format settings.`,
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/");

  return {
    success: true,
    message: "Format and framing settings saved.",
  };
}

export type ClipStudioRenderResult = {
  recordId: string;
  format: "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
  status: ClipStudioExportStatus;
  outputPath: string | null;
  errorMessage: string | null;
};

export type ClipBrandingActionState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    themeColor?: string;
    preset?: string;
  };
};

export async function updateClipBrandingAction(input: {
  clipId: string;
  enabled: boolean;
  preset: string;
  showChurchName: boolean;
  showSermonTitle: boolean;
  showPreacherName: boolean;
  watermarkEnabled: boolean;
  lowerThirdEnabled: boolean;
  themeColor: string | null;
}): Promise<ClipBrandingActionState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return { success: false, message: "Missing clip id for branding settings." };
  }

  const fieldErrors: ClipBrandingActionState["fieldErrors"] = {};

  if (!isValidBrandingPreset(input.preset)) {
    fieldErrors.preset = "This branding preset is not supported. Please choose a valid option.";
  }

  const themeColor = validateThemeColor(input.themeColor);
  if (input.themeColor !== null && input.themeColor !== "" && themeColor === null) {
    fieldErrors.themeColor = "Theme color must be a valid hex value like #0F766E or #123.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: "Could not save branding settings. Please check the highlighted fields.",
      fieldErrors,
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: { id: true, sermonId: true, captionData: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  const captionDataRecord = toCaptionDataRecord(clip.captionData);
  const preset = input.preset as BrandingPreset;

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionData: {
        ...captionDataRecord,
        brandingSettings: {
          enabled: input.enabled,
          preset,
          showChurchName: input.showChurchName,
          showSermonTitle: input.showSermonTitle,
          showPreacherName: input.showPreacherName,
          watermarkEnabled: input.watermarkEnabled,
          lowerThirdEnabled: input.lowerThirdEnabled,
          themeColor: themeColor,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });

  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);

  return { success: true, message: "Church branding settings saved." };
}

export type ClipStudioRenderActionState = {
  success: boolean;
  message: string;
  results: ClipStudioRenderResult[];
};

export type ClipVideoTrackingActionState = {
  success: boolean;
  message: string;
};

export async function refreshClipVideoTrackingAction(clipId: string): Promise<ClipVideoTrackingActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for video tracking." };
  }

  try {
    const result = await refreshVideoSubjectTracking(normalizedClipId);
    const clip = await prisma.clipCandidate.findUnique({
      where: { id: normalizedClipId },
      select: { sermonId: true },
    });

    if (clip) {
      revalidatePath(`/sermons/${clip.sermonId}/clips/${normalizedClipId}/studio`);
      revalidatePath(`/sermons/${clip.sermonId}/review`);
    }

    return {
      success: true,
      message: `Video tracking refreshed (${result.trackCount} face/body tracks prepared).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video tracking failed.";
    return { success: false, message };
  }
}

function toCaptionDataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

function nextRenderVersion(history: ClipStudioExportRecord[]): string {
  return `v${history.length + 1}`;
}

function createQueuedRecord(input: {
  clipId: string;
  sermonId: string;
  format: "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
  platformPreset: PlatformPreset;
  framingMode: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP";
  captionText: string | null;
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED" | null;
  renderVersion: string;
  brandingSnapshot?: Record<string, string | boolean | null> | null;
}): ClipStudioExportRecord {
  const now = new Date().toISOString();
  const id = `${input.clipId}-${input.format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    clipId: input.clipId,
    sermonId: input.sermonId,
    format: input.format,
    platformPreset: input.platformPreset,
    framingMode: input.framingMode,
    status: "WAITING",
    outputPath: null,
    outputFilename: null,
    fileSizeBytes: null,
    errorMessage: null,
    renderVersion: input.renderVersion,
    captionText: input.captionText,
    captionBurnStatus: input.captionBurnStatus,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    isLatest: true,
    brandingSnapshot: input.brandingSnapshot ?? null,
  };
}

export async function renderClipStudioExportsAction(input: {
  clipId: string;
  selectedFormats?: string[];
}): Promise<ClipStudioRenderActionState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return {
      success: false,
      message: "Missing clip id for rendering.",
      results: [],
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      renderStatus: true,
      caption: true,
      captionBurnStatus: true,
      captionData: true,
      exportFormat: true,
      exportLayoutStrategy: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
      results: [],
    };
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: clip.sermonId },
    select: { title: true, speakerName: true, churchName: true },
  });

  const globalBranding = await getBrandingSettings().catch(() => null);
  const brandingConfig = resolveBrandingConfig(clip.captionData);
  const watermarkPosition = (globalBranding?.watermarkPosition ?? "BOTTOM_RIGHT") as
    | "TOP_LEFT"
    | "TOP_RIGHT"
    | "BOTTOM_LEFT"
    | "BOTTOM_RIGHT"
    | "CENTER";

  if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
    return {
      success: false,
      message: "This clip must be approved before rendering. Approve it from Suggested Clips, then return to Clip Studio.",
      results: [],
    };
  }

  const captionDataRecord = toCaptionDataRecord(clip.captionData);
  const exportSettings = resolveExportSettings({
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
  });

  const requestedFormats =
    Array.isArray(input.selectedFormats) && input.selectedFormats.length > 0
      ? Array.from(new Set(input.selectedFormats.filter((format): format is "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1" => isValidExportFormat(format))))
      : exportSettings.selectedFormats;

  const selectedFormats = requestedFormats.length > 0 ? requestedFormats : [exportSettings.primaryFormat];

  const previousHistory = resolveExportHistory(clip.captionData);
  const renderVersion = nextRenderVersion(previousHistory);

  const churchNameUsed = brandingConfig.showChurchName ? (sermon?.churchName ?? "") : "";
  const sermonTitleUsed = brandingConfig.showSermonTitle ? (sermon?.title ?? "") : "";
  const preacherNameUsed = brandingConfig.showPreacherName ? (sermon?.speakerName ?? "") : "";
  const logoPath = globalBranding?.churchLogoPath ?? null;
  const logoAvailable = typeof logoPath === "string" && logoPath.trim().length > 0;

  const queuedRecords = selectedFormats.map((format) =>
    createQueuedRecord({
      clipId: clip.id,
      sermonId: clip.sermonId,
      format,
      platformPreset: exportSettings.platformPreset,
      framingMode: exportSettings.framingMode,
      captionText: clip.caption,
      captionBurnStatus: clip.captionBurnStatus,
      renderVersion,
      brandingSnapshot: {
        enabled: brandingConfig.enabled,
        preset: brandingConfig.preset,
        churchNameUsed: churchNameUsed || null,
        sermonTitleUsed: sermonTitleUsed || null,
        preacherNameUsed: preacherNameUsed || null,
        watermarkEnabled: brandingConfig.watermarkEnabled,
        lowerThirdEnabled: brandingConfig.lowerThirdEnabled,
        themeColor: brandingConfig.themeColor,
        logoAvailable,
      },
    }),
  );

  let workingHistory = markLatestExports([...previousHistory, ...queuedRecords]);
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionData: {
        ...captionDataRecord,
        exportHistory: workingHistory,
      },
    },
  });

  const results: ClipStudioRenderResult[] = [];

  try {
    await renderApprovedClip(clip.id, {
      allowRerender: true,
      force: true,
    });
    await burnCaptionsIntoRenderedClip(clip.id, {
      allowReburn: true,
      force: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown render error.";
    const failedAt = new Date().toISOString();

    workingHistory = markLatestExports(
      workingHistory.map((record) =>
        queuedRecords.some((queued) => queued.id === record.id)
          ? {
              ...record,
              status: "FAILED",
              errorMessage: reason,
              startedAt: failedAt,
              completedAt: failedAt,
            }
          : record,
      ),
    );

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        captionData: {
          ...captionDataRecord,
          exportHistory: workingHistory,
        },
      },
    });

    revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
    revalidatePath(`/sermons/${clip.sermonId}/review`);

    return {
      success: false,
      message: "The clip could not be rendered. Please try again. If it keeps failing, check that the source video is still available.",
      results: queuedRecords.map((record) => ({
        recordId: record.id,
        format: record.format,
        status: "FAILED",
        outputPath: null,
        errorMessage: reason,
      })),
    };
  }

  for (const queued of queuedRecords) {
    const startedAt = new Date().toISOString();
    workingHistory = markLatestExports(
      workingHistory.map((record) =>
        record.id === queued.id
          ? {
              ...record,
              status: "RENDERING",
              startedAt,
            }
          : record,
      ),
    );

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        captionData: {
          ...captionDataRecord,
          exportHistory: workingHistory,
        },
      },
    });

    try {
      const versionTag = `${queued.renderVersion}-${Date.now()}`;
      const exported = await exportClipWithPreset(clip.id, {
        format: queued.format,
        layoutStrategy: queued.framingMode,
        allowReexport: true,
        force: true,
        versionTag,
        brandingOverlay: {
          config: brandingConfig,
          sermonTitle: sermonTitleUsed,
          preacherName: preacherNameUsed,
          churchName: churchNameUsed,
          watermarkPosition,
        },
      });

      const exists = await fileExists(exported.exportPath);
      const fileSizeBytes = exists ? (await stat(/* turbopackIgnore: true */ exported.exportPath)).size : null;
      const completedAt = new Date().toISOString();
      const outputFilename = exported.exportPath.split("/").pop() ?? null;

      workingHistory = markLatestExports(
        workingHistory.map((record) =>
          record.id === queued.id
            ? {
                ...record,
                status: exists ? "COMPLETED" : "FAILED",
                outputPath: exists ? exported.exportPath : null,
                outputFilename,
                fileSizeBytes,
                errorMessage: exists ? null : "This export record exists, but the video file could not be found.",
                completedAt,
              }
            : record,
        ),
      );

      results.push({
        recordId: queued.id,
        format: queued.format,
        status: exists ? "COMPLETED" : "FAILED",
        outputPath: exists ? exported.exportPath : null,
        errorMessage: exists ? null : "This export record exists, but the video file could not be found.",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown export error.";
      const completedAt = new Date().toISOString();

      workingHistory = markLatestExports(
        workingHistory.map((record) =>
          record.id === queued.id
            ? {
                ...record,
                status: "FAILED",
                errorMessage: reason,
                completedAt,
              }
            : record,
        ),
      );

      results.push({
        recordId: queued.id,
        format: queued.format,
        status: "FAILED",
        outputPath: null,
        errorMessage: reason,
      });
    }

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        captionData: {
          ...captionDataRecord,
          exportHistory: workingHistory,
        },
      },
    });
  }

  const completed = results.filter((result) => result.status === "COMPLETED").length;
  const failed = results.length - completed;

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/");

  return {
    success: failed === 0,
    message:
      failed === 0
        ? `Render completed for ${completed} format(s).`
        : `Render completed with ${failed} failure(s). Completed ${completed} format(s).`,
    results,
  };
}

export async function retryClipStudioExportAction(input: {
  clipId: string;
  exportRecordId: string;
}): Promise<ClipStudioRenderActionState> {
  const clipId = input.clipId.trim();
  const exportRecordId = input.exportRecordId.trim();

  if (!clipId || !exportRecordId) {
    return {
      success: false,
      message: "Missing clip or export record id for retry.",
      results: [],
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      captionData: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
      results: [],
    };
  }

  const history = resolveExportHistory(clip.captionData);
  const record = history.find((item) => item.id === exportRecordId);

  if (!record) {
    return {
      success: false,
      message: "Render retry is not available for this record.",
      results: [],
    };
  }

  return renderClipStudioExportsAction({
    clipId,
    selectedFormats: [record.format],
  });
}

export type OverlayActionState = {
  success: boolean;
  message: string;
};

export async function renderClipOverlayAction(clipId: string): Promise<OverlayActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for overlay render." };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "render_overlay", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Overlay generation is blocked because render is incomplete.",
            "Render the clip first, then generate overlay.",
          ),
        };
      }

      if (clip.overlayStatus === "RENDERING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Overlay generation is already running.",
            "Wait for overlay generation to finish before retrying.",
          ),
        };
      }

      if (clip.overlayStatus === "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Overlay is already generated.",
            "Use Regenerate Overlay to rerun this step.",
          ),
        };
      }

      try {
        const result = await renderClipOverlay(clip.id);
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: result.reusedExistingFile
            ? "Overlay file already existed and was reused."
            : `Overlay rendered to ${result.overlayVideoPath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Overlay render failed due to an unknown error.";
        await logClipFailure(clip.id, "overlay render", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return { success: false, message };
      }
    },
  );
}

export async function rerenderClipOverlayAction(clipId: string): Promise<OverlayActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for overlay rerender." };
  }

  const clip = await loadClipOperationSnapshot(normalizedClipId);
  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "rerender_overlay", clipId: clip.id },
    async () => {
      if (clip.renderStatus !== "COMPLETED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Adding church branding is blocked because the video is not prepared.",
            "Prepare the clip first, then add church branding.",
          ),
        };
      }

      if (clip.overlayStatus === "RENDERING") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Church branding is already being added.",
            "Wait for branding to finish before trying again.",
          ),
        };
      }

      try {
        const result = await renderClipOverlay(clip.id, {
          allowRerender: true,
          force: true,
        });
        await revalidateClipPaths(clip.id, clip.sermonId);

        return {
          success: true,
          message: `Overlay rerendered to ${result.overlayVideoPath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Overlay rerender failed due to an unknown error.";
        await logClipFailure(clip.id, "overlay rerender", message, clip.sermonId);
        await revalidateClipPaths(clip.id, clip.sermonId);
        return { success: false, message };
      }
    },
  );
}

export type RegenerationBatchActionState = {
  success: boolean;
  message: string;
  attempted: number;
  completed: number;
  skipped: number;
  failed: number;
  failures: Array<{ clipId: string; asset: ClipAssetKind; reason: string }>;
};

async function regenerateSingleAsset(clipId: string, asset: ClipAssetKind): Promise<{ ok: boolean; reason?: string }> {
  const preflight = await preflightRegenerationAsset(clipId, asset);
  if (!preflight.ok) {
    return { ok: false, reason: preflight.reason };
  }

  try {
    if (asset === "render") {
      await renderApprovedClip(clipId, { allowRerender: true, force: true });
      return { ok: true };
    }

    if (asset === "caption") {
      await generateCaptionsForClip(clipId, { force: true });
      return { ok: true };
    }

    if (asset === "captionBurn") {
      await burnCaptionsIntoRenderedClip(clipId, { allowReburn: true, force: true });
      return { ok: true };
    }

    if (asset === "overlay") {
      await renderClipOverlay(clipId, { allowRerender: true, force: true });
      return { ok: true };
    }

    await exportVerticalClip(clipId, { allowReexport: true, force: true });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown regeneration error.";
    return { ok: false, reason: message };
  }
}

export async function regenerateClipOutdatedAssetsAction(clipId: string): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for asset regeneration." };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: {
      id: true,
      sermonId: true,
      renderStatus: true,
      captionStatus: true,
      captionBurnStatus: true,
      overlayStatus: true,
      exportStatus: true,
      renderFreshness: true,
      captionFreshness: true,
      captionBurnFreshness: true,
      overlayFreshness: true,
      exportFreshness: true,
    },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  const assets = computeRegenerableAssetsForClip({
    ...toClipAssetFreshnessView({
      renderFreshness: clip.renderFreshness,
      captionFreshness: clip.captionFreshness,
      captionBurnFreshness: clip.captionBurnFreshness,
      overlayFreshness: clip.overlayFreshness,
      exportFreshness: clip.exportFreshness,
    }),
    renderStatus: clip.renderStatus,
    captionStatus: clip.captionStatus,
    captionBurnStatus: clip.captionBurnStatus,
    overlayStatus: clip.overlayStatus,
    exportStatus: clip.exportStatus,
  });

  if (assets.length === 0) {
    return { success: true, message: "All assets are already up to date." };
  }

  let failed = 0;
  const errors: string[] = [];

  return runOperationWithLogging(
    { sermonId: clip.sermonId, operation: "regenerate_outdated_assets_for_clip", clipId: clip.id },
    async () => {
      await appendPipelineLog(clip.sermonId, `Regeneration started for clip ${clip.id}. Assets: ${assets.join(", ")}.`);

      for (const asset of assets) {
        const result = await regenerateSingleAsset(clip.id, asset);
        if (!result.ok) {
          failed += 1;
          errors.push(`${asset}: ${result.reason ?? "unknown"}`);
          await appendPipelineLog(clip.sermonId, `Regeneration failed for clip ${clip.id}, asset=${asset}: ${result.reason ?? "unknown"}`);
        } else {
          await appendPipelineLog(clip.sermonId, `Regeneration completed for clip ${clip.id}, asset=${asset}.`);
        }
      }

      await revalidateClipPaths(clip.id, clip.sermonId);

      if (failed > 0) {
        return {
          success: false,
          message: `Regeneration completed with ${failed} failure(s): ${errors.join("; ")}`,
        };
      }

      return {
        success: true,
        message: `Regenerated ${assets.length} outdated asset(s).`,
      };
    },
  );
}

export async function regenerateAllOutdatedAssetsAction(sermonId: string): Promise<RegenerationBatchActionState> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    return {
      success: false,
      message: "Missing sermon id for regeneration.",
      attempted: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
  }

  const clips = (await listClipFreshnessForSermon(normalizedSermonId)).filter((clip) => isClipApprovedForPostingAssets(clip.status));
  const items: Array<{ ok: boolean; skipped?: boolean; clipId: string; asset: ClipAssetKind; reason?: string }> = [];

  await appendPipelineLog(normalizedSermonId, `Batch regeneration started: all outdated assets.`);

  for (const clip of clips) {
    const assets = computeRegenerableAssetsForClip({
      ...toClipAssetFreshnessView({
        renderFreshness: clip.renderFreshness,
        captionFreshness: clip.captionFreshness,
        captionBurnFreshness: clip.captionBurnFreshness,
        overlayFreshness: clip.overlayFreshness,
        exportFreshness: clip.exportFreshness,
      }),
      renderStatus: clip.renderStatus,
      captionStatus: clip.captionStatus,
      captionBurnStatus: clip.captionBurnStatus,
      overlayStatus: clip.overlayStatus,
      exportStatus: clip.exportStatus,
    });

    if (assets.length === 0) {
      items.push({ ok: true, skipped: true, clipId: clip.id, asset: "render" });
      continue;
    }

    for (const asset of assets) {
      const result = await regenerateSingleAsset(clip.id, asset);
      items.push({
        ok: result.ok,
        clipId: clip.id,
        asset,
        reason: result.reason,
      });
      await appendPipelineLog(
        normalizedSermonId,
        `Batch regeneration ${result.ok ? "completed" : "failed"}: clip=${clip.id}, asset=${asset}${result.reason ? ` (${result.reason})` : ""}.`,
      );
    }
  }

  const summary = summarizeBatchResult(items);
  await appendPipelineLog(
    normalizedSermonId,
    `Batch regeneration summary: attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}.`,
  );

  revalidatePath(`/sermons/${normalizedSermonId}`);
  revalidatePath("/");

  return {
    success: summary.failed === 0,
    message:
      summary.failed === 0
        ? `Regeneration completed. ${summary.completed} rebuilt, ${summary.skipped} skipped.`
        : `Regeneration completed with failures. ${summary.completed} rebuilt, ${summary.skipped} skipped, ${summary.failed} failed.`,
    attempted: summary.attempted,
    completed: summary.completed,
    skipped: summary.skipped,
    failed: summary.failed,
    failures: summary.failures,
  };
}

export async function regenerateAllOutdatedCaptionsAction(sermonId: string): Promise<RegenerationBatchActionState> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    return {
      success: false,
      message: "Missing sermon id for caption regeneration.",
      attempted: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: normalizedSermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
    },
    select: {
      id: true,
      captionFreshness: true,
      captionBurnFreshness: true,
    },
  });

  const items: Array<{ ok: boolean; skipped?: boolean; clipId: string; asset: ClipAssetKind; reason?: string }> = [];
  await appendPipelineLog(normalizedSermonId, `Batch regeneration started: caption assets.`);

  for (const clip of clips) {
    const needsCaption = clip.captionFreshness !== "UP_TO_DATE";
    const needsBurn = clip.captionBurnFreshness !== "UP_TO_DATE";

    if (!needsCaption && !needsBurn) {
      items.push({ ok: true, skipped: true, clipId: clip.id, asset: "caption" });
      continue;
    }

    if (needsCaption) {
      const captionResult = await regenerateSingleAsset(clip.id, "caption");
      items.push({ ok: captionResult.ok, clipId: clip.id, asset: "caption", reason: captionResult.reason });
    }

    if (needsBurn) {
      const burnResult = await regenerateSingleAsset(clip.id, "captionBurn");
      items.push({ ok: burnResult.ok, clipId: clip.id, asset: "captionBurn", reason: burnResult.reason });
    }
  }

  const summary = summarizeBatchResult(items);
  await appendPipelineLog(
    normalizedSermonId,
    `Batch caption regeneration summary: attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}.`,
  );

  revalidatePath(`/sermons/${normalizedSermonId}`);
  revalidatePath("/");

  return {
    success: summary.failed === 0,
    message:
      summary.failed === 0
        ? `Captions refreshed. ${summary.completed} updated, ${summary.skipped} already ready.`
        : `Caption refresh finished with clips needing attention. ${summary.completed} updated, ${summary.skipped} already ready, ${summary.failed} need attention.`,
    attempted: summary.attempted,
    completed: summary.completed,
    skipped: summary.skipped,
    failed: summary.failed,
    failures: summary.failures,
  };
}

export async function regenerateAllExportsAction(sermonId: string): Promise<RegenerationBatchActionState> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    return {
      success: false,
      message: "Missing sermon id for recreating downloads.",
      attempted: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: normalizedSermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
    },
    select: {
      id: true,
      exportFreshness: true,
    },
  });

  const items: Array<{ ok: boolean; skipped?: boolean; clipId: string; asset: ClipAssetKind; reason?: string }> = [];
  await appendPipelineLog(normalizedSermonId, `Batch regeneration started: export assets.`);

  for (const clip of clips) {
    if (clip.exportFreshness === "UP_TO_DATE") {
      items.push({ ok: true, skipped: true, clipId: clip.id, asset: "export" });
      continue;
    }

    const result = await regenerateSingleAsset(clip.id, "export");
    items.push({ ok: result.ok, clipId: clip.id, asset: "export", reason: result.reason });
  }

  const summary = summarizeBatchResult(items);
  await appendPipelineLog(
    normalizedSermonId,
    `Batch export regeneration summary: attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}.`,
  );

  revalidatePath(`/sermons/${normalizedSermonId}`);
  revalidatePath("/");

  return {
    success: summary.failed === 0,
    message:
      summary.failed === 0
        ? `Downloads recreated. ${summary.completed} updated, ${summary.skipped} already ready.`
        : `Download refresh finished with clips needing attention. ${summary.completed} updated, ${summary.skipped} already ready, ${summary.failed} need attention.`,
    attempted: summary.attempted,
    completed: summary.completed,
    skipped: summary.skipped,
    failed: summary.failed,
    failures: summary.failures,
  };
}

export async function getClipAssetFreshnessSummaryAction(clipId: string): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return { success: false, message: "Missing clip id for freshness summary." };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: {
      renderFreshness: true,
      captionFreshness: true,
      captionBurnFreshness: true,
      overlayFreshness: true,
      exportFreshness: true,
    },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  const summary = [
    `Render=${toFreshnessLabel(clip.renderFreshness)}`,
    `Caption=${toFreshnessLabel(clip.captionFreshness)}`,
    `Burn=${toFreshnessLabel(clip.captionBurnFreshness)}`,
    `Overlay=${toFreshnessLabel(clip.overlayFreshness)}`,
    `Export=${toFreshnessLabel(clip.exportFreshness)}`,
  ].join(" | ");

  return {
    success: true,
    message: summary,
  };
}
