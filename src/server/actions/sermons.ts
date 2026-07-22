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
  type ManualCropKeyframe,
  type ManualCropPresetDirection,
} from "@/lib/manualCrop";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getAudioPath,
  getLegacySermonStoragePath,
  getClipSrtPath,
  getSermonStoragePath,
  getSourceVideoPath,
  getTranscriptJsonPath,
  unregisterSermonStorageFolder,
} from "@/server/agents/storage";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  queueSermonProcessingJob,
} from "@/server/agents/processing";
import type { ClipQualityRefreshSummary } from "@/server/agents/clipQualityRefreshService";
import type { ClipSuggestionCurationSummary } from "@/server/agents/clipSuggestionCurationService";
import { prepareGeneratedClipReviewAssets } from "@/server/agents/clipReviewAssetService";
import {
  buildRedoClipGenerationSourceWindow,
  redoClipGenerationFromTranscript,
  validateRedoClipGenerationReadiness,
} from "@/server/agents/clipRedoService";
import {
  deleteClipPreviewFromR2,
  deletePostingMediaFromR2,
  isClipPreviewObjectKeyForSermon,
  isPostingMediaObjectKeyForScheduledPost,
  r2MediaStorageConfigured,
} from "@/server/agents/clipRemotePreviewStorage";
import {
  computeRegenerableAssetsForClip,
  detectClipEditImpact,
  invalidateAfterBoundaryOrCropChange,
  invalidateAfterCaptionTextChange,
  invalidateAfterExportSettingChange,
  invalidateAfterOverlaySettingChange,
  isClipApprovedForPostingAssets,
  listClipFreshnessForSermon,
  summarizeBatchResult,
  toClipAssetFreshnessView,
  toFreshnessLabel,
  type ClipAssetKind,
} from "@/server/regeneration/dependencies";
import {
  buildEditableCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptWords,
  buildSrtFromEditableCues,
  mergeCaptionCueTextOverrides,
  type EditableCaptionCue,
  parseCaptionSourceWords,
  parseHashtagEditorInput,
  validateCaptionCuesFromTranscript,
  validateEditableCaptionCues,
  validateClipStudioTiming,
} from "@/lib/clipStudioEditing";
import {
  buildUploadedMediaCheckFailureMessage,
  buildLocalUploadSourceUrl,
  createSermonSchema,
  isUploadedMediaFile,
  uploadedMediaExceedsSizeLimit,
  UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
} from "@/lib/sermonIntake";
import {
  buildPrepareApprovedSummary,
  buildPrepareClipPlan,
} from "@/lib/prepareWorkflow";
import { getQueuedMediaAssetsForRemoteBatchAction } from "@/lib/clipReview";
import { buildClipGenerationRetryPlan } from "@/lib/clipGenerationRetry";
import {
  buildForcedMediaAssetRetrySummary,
  buildForcedProcessingJobSummary,
} from "@/lib/mediaProcessingJobIntent";
import { parseContentOpportunityJobSummary } from "@/lib/contentOpportunityJobs";
import { enqueueContentOpportunityGeneration } from "@/server/agents/contentOpportunityJobService";
import { isStaleActiveProcessingJob } from "@/lib/pastorWorkflow";
import { buildStaleClipOperationRecovery } from "@/lib/staleClipOperations";
import { prunePostingPackageHistoryByClipIds } from "@/lib/postingPackages";
import {
  deriveBackgroundMode,
  isValidExportFormat,
  isValidFramingPersonality,
  isValidFramingMode,
  isValidPlatformPreset,
  markLatestExports,
  mapPlatformPresetToFormat,
  orderExportFormatsForCanonicalPrimary,
  resolveExportHistory,
  resolveExportSettings,
  type ClipStudioExportRecord,
  type ClipStudioExportStatus,
  type FramingPersonality,
  type PlatformPreset,
} from "@/lib/clipExportSettings";
import {
  DEFAULT_INTRO_DURATION_SECONDS,
  DEFAULT_OUTRO_DURATION_SECONDS,
  isValidBrandingPreset,
  normalizeBrandingDurationSeconds,
  resolveBrandingConfig,
  validateThemeColor,
  type BrandingPreset,
} from "@/lib/clipBranding";
import { getBrandingSettings } from "@/server/branding/settings";
import {
  canRunInlineMediaProcessing,
  canRunLocalMediaProcessing,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";
import { assertMediaStorageCapacity } from "@/server/media/storageCapacity";
import {
  formatSecondsForTimestampInput,
  parseSermonTimestampInput,
} from "@/lib/sermonSegment";
import { isCaptionStylePresetId, type CaptionStylePresetId } from "@/lib/captionStylePresets";
import {
  normalizeBrollLayerConfig,
  normalizeHookOverlayForClipDuration,
  normalizeSpeechCleanupIntensity,
  normalizeCaptionAppearanceSettings,
  extractCaptionRevealMode,
  normalizeCaptionRevealMode,
  normalizeCaptionSyncOffsetSeconds,
  type BrollLayerConfig,
  type CaptionAppearanceSettings,
  type CaptionPosition,
  type CaptionRevealMode,
  type SpeechCleanupIntensity,
} from "@/lib/clipStudio";
import { buildClipStudioPrepareAssetPlan } from "@/lib/clipStudioPrepare";
import {
  canChooseClipForProduction,
  resolveClipStudioAssetInvalidation,
  resolveClipStudioBoundaryReviewUpdate,
  resolveClipStudioContentValues,
  shouldRecordExplicitTranscriptReview,
} from "@/lib/clipContentPersistence";
import {
  normalizeSpeechCleanupEdits,
  serializeSpeechCleanupEdits,
  type SpeechCleanupEdits,
} from "@/lib/speechCleanupPlan";
import { upsertActiveClipEditPlanForClip } from "@/server/agents/clipEditPlanService";
import {
  removeTranscriptSafetyBlocker,
  TRANSCRIPT_SAFETY_REVIEW_BLOCKER,
} from "@/server/agents/localLanguageTranscriptSafety";

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
  return import("@/server/agents/videoDownloadAgent").then((module) => module.downloadSermonVideo(...args));
}

function extractSermonAudio(
  ...args: Parameters<typeof import("@/server/agents/audioExtractionAgent").extractSermonAudio>
): ReturnType<typeof import("@/server/agents/audioExtractionAgent").extractSermonAudio> {
  assertLocalMediaProcessing("Audio extraction");
  return import("@/server/agents/audioExtractionAgent").then((module) => module.extractSermonAudio(...args));
}

function transcribeSermonAudio(
  ...args: Parameters<typeof import("@/server/agents/transcriptionAgent").transcribeSermonAudio>
): ReturnType<typeof import("@/server/agents/transcriptionAgent").transcribeSermonAudio> {
  assertLocalMediaProcessing("Transcription");
  return import("@/server/agents/transcriptionAgent").then((module) => module.transcribeSermonAudio(...args));
}

function generateClipSuggestions(
  ...args: Parameters<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions>
): ReturnType<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions> {
  assertLocalMediaProcessing("Clip generation");
  return import("@/server/agents/clipIntelligenceAgent").then((module) => module.generateClipSuggestions(...args));
}

function generateSermonIntelligence(
  ...args: Parameters<typeof import("@/server/agents/sermonIntelligenceService").generateSermonIntelligence>
): ReturnType<typeof import("@/server/agents/sermonIntelligenceService").generateSermonIntelligence> {
  return import("@/server/agents/sermonIntelligenceService").then((module) => module.generateSermonIntelligence(...args));
}

function mediaFileIsUsable(
  ...args: Parameters<typeof import("@/server/media/fileGuards").mediaFileIsUsable>
): ReturnType<typeof import("@/server/media/fileGuards").mediaFileIsUsable> {
  assertLocalMediaProcessing("Media validation");
  return import("@/server/media/fileGuards").then((module) => module.mediaFileIsUsable(...args));
}

function refreshSermonClipQuality(
  ...args: Parameters<typeof import("@/server/agents/clipQualityRefreshService").refreshSermonClipQuality>
): ReturnType<typeof import("@/server/agents/clipQualityRefreshService").refreshSermonClipQuality> {
  assertLocalMediaProcessing("Clip quality refresh");
  return import("@/server/agents/clipQualityRefreshService").then((module) => module.refreshSermonClipQuality(...args));
}

function curateSermonAiSuggestions(
  ...args: Parameters<typeof import("@/server/agents/clipSuggestionCurationService").curateSermonAiSuggestions>
): ReturnType<typeof import("@/server/agents/clipSuggestionCurationService").curateSermonAiSuggestions> {
  assertLocalMediaProcessing("Clip suggestion curation");
  return import("@/server/agents/clipSuggestionCurationService").then((module) => module.curateSermonAiSuggestions(...args));
}

function refreshVideoSubjectTracking(
  ...args: Parameters<typeof import("@/server/agents/videoSubjectTrackingService").refreshVideoSubjectTracking>
): ReturnType<typeof import("@/server/agents/videoSubjectTrackingService").refreshVideoSubjectTracking> {
  assertLocalMediaProcessing("Video tracking");
  return import("@/server/agents/videoSubjectTrackingService").then((module) => module.refreshVideoSubjectTracking(...args));
}

function generateSmartCropDebugSnapshot(
  ...args: Parameters<typeof import("@/server/agents/smartCropDebugService").generateSmartCropDebugSnapshot>
): ReturnType<typeof import("@/server/agents/smartCropDebugService").generateSmartCropDebugSnapshot> {
  assertLocalMediaProcessing("Smart crop debug snapshot");
  return import("@/server/agents/smartCropDebugService").then((module) => module.generateSmartCropDebugSnapshot(...args));
}

function renderApprovedClip(
  ...args: Parameters<typeof import("@/server/agents/clipRenderService").renderApprovedClip>
): ReturnType<typeof import("@/server/agents/clipRenderService").renderApprovedClip> {
  assertLocalMediaProcessing("Clip render");
  return import("@/server/agents/clipRenderService").then((module) => module.renderApprovedClip(...args));
}

function renderApprovedClipsForSermon(
  ...args: Parameters<typeof import("@/server/agents/clipRenderService").renderApprovedClipsForSermon>
): ReturnType<typeof import("@/server/agents/clipRenderService").renderApprovedClipsForSermon> {
  assertLocalMediaProcessing("Clip render");
  return import("@/server/agents/clipRenderService").then((module) => module.renderApprovedClipsForSermon(...args));
}

function exportVerticalClip(
  ...args: Parameters<typeof import("@/server/agents/clipExportService").exportVerticalClip>
): ReturnType<typeof import("@/server/agents/clipExportService").exportVerticalClip> {
  assertLocalMediaProcessing("Clip export");
  return import("@/server/agents/clipExportService").then((module) => module.exportVerticalClip(...args));
}

function exportClipWithPreset(
  ...args: Parameters<typeof import("@/server/agents/clipExportService").exportClipWithPreset>
): ReturnType<typeof import("@/server/agents/clipExportService").exportClipWithPreset> {
  assertLocalMediaProcessing("Clip export");
  return import("@/server/agents/clipExportService").then((module) => module.exportClipWithPreset(...args));
}

function renderClipOverlay(
  ...args: Parameters<typeof import("@/server/agents/clipOverlayService").renderClipOverlay>
): ReturnType<typeof import("@/server/agents/clipOverlayService").renderClipOverlay> {
  assertLocalMediaProcessing("Overlay render");
  return import("@/server/agents/clipOverlayService").then((module) => module.renderClipOverlay(...args));
}

function processSermonPipeline(
  ...args: Parameters<typeof import("@/server/pipeline/processSermonPipeline").processSermonPipeline>
): ReturnType<typeof import("@/server/pipeline/processSermonPipeline").processSermonPipeline> {
  assertLocalMediaProcessing("Sermon processing");
  return import("@/server/pipeline/processSermonPipeline").then((module) => module.processSermonPipeline(...args));
}

function generateCaptionsForApprovedClips(
  ...args: Parameters<typeof import("@/server/agents/captionService").generateCaptionsForApprovedClips>
): ReturnType<typeof import("@/server/agents/captionService").generateCaptionsForApprovedClips> {
  assertLocalMediaProcessing("Caption generation");
  return import("@/server/agents/captionService").then((module) => module.generateCaptionsForApprovedClips(...args));
}

function generateCaptionsForClip(
  ...args: Parameters<typeof import("@/server/agents/captionService").generateCaptionsForClip>
): ReturnType<typeof import("@/server/agents/captionService").generateCaptionsForClip> {
  assertLocalMediaProcessing("Caption generation");
  return import("@/server/agents/captionService").then((module) => module.generateCaptionsForClip(...args));
}

function burnCaptionsIntoRenderedClip(
  ...args: Parameters<typeof import("@/server/agents/captionBurnService").burnCaptionsIntoRenderedClip>
): ReturnType<typeof import("@/server/agents/captionBurnService").burnCaptionsIntoRenderedClip> {
  assertLocalMediaProcessing("Caption burn");
  return import("@/server/agents/captionBurnService").then((module) => module.burnCaptionsIntoRenderedClip(...args));
}

function assertLocalMediaProcessing(action: string): void {
  if (!canRunInlineMediaProcessing()) {
    throw new Error(localMediaProcessingUnavailableMessage(action));
  }
}

async function queueSermonMediaAssetJobs(
  sermonId: string,
  requestedAssets?: ClipAssetKind[],
  intent?: { clipIds?: string[]; force?: boolean },
): Promise<{ queued: number; reused: number; jobTypes: ProcessingJobType[] }> {
  const assetSet = new Set(requestedAssets ?? ["render", "caption", "captionBurn", "overlay", "export"]);
  const jobTypes: ProcessingJobType[] = [];

  if (assetSet.has("render")) {
    jobTypes.push("EXPORT_CLIPS");
  }

  if (assetSet.has("caption")) {
    jobTypes.push("GENERATE_SUBTITLES");
  }

  if (assetSet.has("captionBurn")) {
    jobTypes.push("BURN_SUBTITLES");
  }

  if (assetSet.has("overlay") || assetSet.has("export")) {
    jobTypes.push("RENDER_OVERLAY");
  }

  let queued = 0;
  let reused = 0;
  const clipIds = Array.from(new Set(
    (intent?.clipIds ?? []).map((clipId) => clipId.trim()).filter(Boolean),
  )).sort();
  for (const jobType of Array.from(new Set(jobTypes))) {
    const generationSummary = clipIds.length > 0 || intent?.force
      ? {
          intentKey: `media-assets:${jobType}:${intent?.force === true ? "force" : "normal"}:${clipIds.join(",") || "all"}`,
          ...(clipIds.length > 0 ? { mediaAssetClipIds: clipIds } : {}),
          ...(intent?.force ? { forceMediaAssets: true } : {}),
        }
      : undefined;
    const job = await queueSermonProcessingJob(sermonId, jobType, generationSummary);
    if (job.reusedExisting) {
      reused += 1;
    } else {
      queued += 1;
    }
  }

  return { queued, reused, jobTypes: Array.from(new Set(jobTypes)) };
}

async function queueClipMediaAssetAction(input: {
  clipId: string;
  sermonId: string;
  assets: ClipAssetKind[];
  operation: string;
  invalidate?: Prisma.ClipCandidateUpdateInput;
  force?: boolean;
}): Promise<string> {
  if (input.invalidate) {
    await prisma.clipCandidate.update({
      where: { id: input.clipId },
      data: input.invalidate,
    });
  }

  const queued = await queueSermonMediaAssetJobs(input.sermonId, input.assets, {
    clipIds: [input.clipId],
    force: input.force === true,
  });
  await appendPipelineLog(
    input.sermonId,
    `${input.operation} for clip ${input.clipId} ${queued.queued > 0 ? "queued" : "reused an existing queue item"}. Jobs: ${queued.jobTypes.join(", ")}.`,
  );
  await revalidateClipPaths(input.clipId, input.sermonId);

  return queued.queued > 0
    ? `${input.operation} queued for the media worker.`
    : `${input.operation} is already queued for the media worker.`;
}

function processingJobTypeLabel(type: ProcessingJobType): string {
  switch (type) {
    case "DOWNLOAD_VIDEO":
      return "Video download";
    case "EXTRACT_AUDIO":
      return "Audio extraction";
    case "TRANSCRIBE_AUDIO":
      return "Transcription";
    case "GENERATE_CLIPS":
      return "Clip generation";
    case "EXPORT_CLIPS":
      return "Clip export";
    case "GENERATE_SUBTITLES":
      return "Caption generation";
    case "BURN_SUBTITLES":
      return "Caption burn";
    case "PROCESS_SERMON":
      return "Sermon processing";
    case "GENERATE_INTELLIGENCE":
      return "Sermon intelligence";
    case "GENERATE_CONTENT_OPPORTUNITIES":
      return "Content idea generation";
    case "RENDER_OVERLAY":
      return "Overlay render";
    case "QUALITY_REFRESH":
      return "Quality refresh";
  }

  return String(type).replaceAll("_", " ").toLowerCase();
}

async function startOneClickSermonPipeline(sermonId: string): Promise<void> {
  if (!canRunInlineMediaProcessing()) {
    await queueSermonProcessingJob(sermonId, "PROCESS_SERMON");
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
  fieldErrors?: {
    sermonStartTimestamp?: string;
    sermonEndTimestamp?: string;
  };
  deletedClips?: number;
  generatedClips?: number;
  clearedDrafts?: number;
  clearedScheduledPosts?: number;
  clearedPackages?: number;
  previewPrepared?: number;
  previewFailed?: number;
};

export type DeleteSermonProjectState = {
  success: boolean;
  message: string;
  deletedSermonId?: string;
  deletedClipCount?: number;
  deletedRemotePreviewObjects?: number;
  deletedRemotePostingMediaObjects?: number;
  failedRemotePreviewObjects?: number;
  failedRemotePostingMediaObjects?: number;
  skippedRemotePreviewObjects?: number;
  skippedRemotePostingMediaObjects?: number;
  clearedDrafts?: number;
  clearedScheduledPosts?: number;
  clearedPredictions?: number;
  clearedGrowthRecommendations?: number;
  clearedPackages?: number;
  deletedStorage?: boolean;
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
  title: string;
  mainCaption: string;
  shortCaption: string;
  platformCaption: string;
  hashtags: string;
  captionCues: EditableCaptionCue[];
  applyCaptionsToClip: boolean;
  captionStylePresetId: string;
  captionPosition: string;
  captionAppearance: CaptionAppearanceSettings;
  captionRevealMode?: CaptionRevealMode;
  captionSyncOffsetSeconds?: number;
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
  brollLayer: BrollLayerConfig;
  speechCleanup: {
    removeDeadAir: boolean;
    tightenLongPauses: boolean;
    flagFillerWords: boolean;
    intensity: SpeechCleanupIntensity;
  };
  speechCleanupEdits?: SpeechCleanupEdits | null;
  confirmTranscriptReviewed?: boolean;
};

export type UpdateClipStudioEditsState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    startTimestamp?: string;
    endTimestamp?: string;
    title?: string;
    mainCaption?: string;
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
  manualCropKeyframes?: ManualCropKeyframe[];
};

export type PrepareClipStudioForPostingInput = {
  clipId: string;
  forceRebuild?: boolean;
  editPreview: {
    startSeconds: number | null;
    endSeconds: number | null;
    title: string;
    editorialHook: string;
    mainCaption: string;
    shortCaption: string;
    platformCaption: string;
    onVideoCaptionText: string;
    hashtags: string;
    captionCues: EditableCaptionCue[];
    applyCaptionsToClip: boolean;
    captionStylePresetId: string;
    captionPosition: string;
    captionAppearance: CaptionAppearanceSettings;
    captionRevealMode?: CaptionRevealMode;
    captionSyncOffsetSeconds?: number;
    hookOverlay: UpdateClipStudioEditsInput["hookOverlay"];
    brollLayer: BrollLayerConfig;
    speechCleanup: UpdateClipStudioEditsInput["speechCleanup"];
    speechCleanupEdits?: SpeechCleanupEdits | null;
  };
  exportSettings: {
    platformPreset: string;
    primaryFormat: string;
    selectedFormats: string[];
    framingMode: string;
    framingPersonality: string;
    manualCropKeyframes: ManualCropKeyframe[];
  };
  brandingConfig: {
    enabled: boolean;
    preset: string;
    showChurchName: boolean;
    showSermonTitle: boolean;
    showPreacherName: boolean;
    watermarkEnabled: boolean;
    lowerThirdEnabled: boolean;
    introEnabled: boolean;
    outroEnabled: boolean;
    introDurationSeconds?: number;
    outroDurationSeconds?: number;
    backgroundStyle: string;
    themeColor: string | null;
  };
};

export type PrepareClipStudioForPostingState = {
  success: boolean;
  message: string;
  results: ClipStudioRenderResult[];
  /** The submitted Studio composition reached durable storage, even if media preparation failed later. */
  draftSaved?: boolean;
  queued?: boolean;
  fieldErrors?: UpdateClipStudioEditsState["fieldErrors"] & UpdateClipExportSettingsState["fieldErrors"] & ClipBrandingActionState["fieldErrors"];
  warnings?: string[];
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

function isActiveClipOperation(clip: {
  renderStatus: string;
  captionStatus: string;
  captionBurnStatus: string;
  overlayStatus: string;
  exportStatus: string;
  updatedAt: Date;
}): boolean {
  const hasActiveStatus =
    clip.renderStatus === "QUEUED" ||
    clip.renderStatus === "RENDERING" ||
    clip.captionStatus === "GENERATING" ||
    clip.captionBurnStatus === "BURNING" ||
    clip.overlayStatus === "RENDERING" ||
    clip.exportStatus === "QUEUED" ||
    clip.exportStatus === "EXPORTING";

  if (!hasActiveStatus) {
    return false;
  }

  return !isStaleActiveProcessingJob({
    type: "EXPORT_CLIPS",
    status: "RUNNING",
    updatedAt: clip.updatedAt,
  });
}

function isActiveScheduledPostOperation(post: {
  status: string;
  workerStatus: string;
  claimedAt: Date | null;
  updatedAt: Date;
}): boolean {
  const hasActiveStatus =
    post.status === "POSTING" ||
    post.workerStatus === "CLAIMED" ||
    post.workerStatus === "POSTING";

  if (!hasActiveStatus) {
    return false;
  }

  return !isStaleActiveProcessingJob({
    type: "POSTING",
    status: "RUNNING",
    updatedAt: post.claimedAt ?? post.updatedAt,
  }, new Date(), 20 * 60_000);
}

function selectRemotePreviewObjectKeysForDeletion(
  sermonId: string,
  clips: Array<{ remotePreviewObjectKey: string | null }>,
): { objectKeys: string[]; skipped: number } {
  const objectKeys = new Set<string>();
  let skipped = 0;

  for (const clip of clips) {
    const objectKey = clip.remotePreviewObjectKey?.trim();
    if (!objectKey) {
      continue;
    }

    if (!isClipPreviewObjectKeyForSermon({ sermonId, objectKey })) {
      skipped += 1;
      continue;
    }

    objectKeys.add(objectKey);
  }

  return { objectKeys: Array.from(objectKeys), skipped };
}

function selectPostingMediaObjectKeysForDeletion(
  posts: Array<{ id: string; mediaObjectKey: string | null }>,
): { objectKeys: Array<{ scheduledPostId: string; objectKey: string }>; skipped: number } {
  const objectKeys = new Map<string, { scheduledPostId: string; objectKey: string }>();
  let skipped = 0;

  for (const post of posts) {
    const objectKey = post.mediaObjectKey?.trim();
    if (!objectKey) {
      continue;
    }

    if (!isPostingMediaObjectKeyForScheduledPost({ scheduledPostId: post.id, objectKey })) {
      skipped += 1;
      continue;
    }

    objectKeys.set(`${post.id}:${objectKey}`, { scheduledPostId: post.id, objectKey });
  }

  return { objectKeys: Array.from(objectKeys.values()), skipped };
}

async function prepareGeneratedClipPreviews(input: {
  sermonId: string;
  force: boolean;
  onlyFailed?: boolean;
}): Promise<{ prepared: number; failed: number; skipped: number }> {
  return prepareGeneratedClipReviewAssets(input);
}

export async function deleteSermonProjectAction(input: {
  sermonId: string;
  confirmationTitle: string;
}): Promise<DeleteSermonProjectState> {
  const sermonId = input.sermonId.trim();
  const confirmationTitle = input.confirmationTitle.trim();

  if (!sermonId) {
    return { success: false, message: "Missing sermon id for deletion." };
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      clipCandidates: {
        select: {
          id: true,
          renderStatus: true,
          captionStatus: true,
          captionBurnStatus: true,
          overlayStatus: true,
          exportStatus: true,
          remotePreviewObjectKey: true,
          updatedAt: true,
        },
      },
      processingJobs: {
        where: { status: { in: ["PENDING", "RUNNING"] } },
        select: {
          id: true,
          type: true,
          status: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!sermon) {
    return { success: false, message: "This project was not found. It may have already been deleted." };
  }

  if (confirmationTitle !== sermon.title.trim()) {
    return { success: false, message: `Type "${sermon.title}" to confirm deletion.` };
  }

  const activeJob = sermon.processingJobs.find((job) => !isStaleActiveProcessingJob(job));
  if (activeJob) {
    return {
      success: false,
      message: "This project still has an active processing job. Wait for it to finish, then delete the project.",
    };
  }

  const activeClipOperation = sermon.clipCandidates.find(isActiveClipOperation);
  if (activeClipOperation) {
    return {
      success: false,
      message: "This project still has an active clip render/export operation. Wait for it to finish, then delete the project.",
    };
  }

  const clipIds = sermon.clipCandidates.map((clip) => clip.id);
  const clipIdSet = new Set(clipIds);
  const remotePreviewPlan = selectRemotePreviewObjectKeysForDeletion(sermon.id, sermon.clipCandidates);
  let postingMediaPlan: ReturnType<typeof selectPostingMediaObjectKeysForDeletion> = {
    objectKeys: [],
    skipped: 0,
  };
  const storagePaths = Array.from(new Set([
    getSermonStoragePath(sermon.id),
    getLegacySermonStoragePath(sermon.id),
  ]));
  let clearedDrafts = 0;
  let clearedScheduledPosts = 0;
  let clearedPredictions = 0;
  let clearedGrowthRecommendations = 0;
  let clearedPackages = 0;
  let deletedRemotePreviewObjects = 0;
  let deletedRemotePostingMediaObjects = 0;
  let failedRemotePreviewObjects = 0;
  let failedRemotePostingMediaObjects = 0;
  const skippedRemotePreviewObjects = remotePreviewPlan.skipped;
  let skippedRemotePostingMediaObjects = 0;

  try {
    let drafts: Array<{ id: string; clipIdsJson: Prisma.JsonValue }> = [];
    let scheduledPosts: Array<{
      id: string;
      clipIdsJson: Prisma.JsonValue;
      status: string;
      workerStatus: string;
      claimedAt: Date | null;
      updatedAt: Date;
      mediaObjectKey: string | null;
    }> = [];
    let predictions: Array<{ id: string; clipIdsJson: Prisma.JsonValue }> = [];

    if (clipIds.length > 0) {
      [drafts, scheduledPosts, predictions] = await Promise.all([
        prisma.postingDraft.findMany({
          select: { id: true, clipIdsJson: true },
        }),
        prisma.scheduledPost.findMany({
          select: {
            id: true,
            clipIdsJson: true,
            status: true,
            workerStatus: true,
            claimedAt: true,
            updatedAt: true,
            mediaObjectKey: true,
          },
        }),
        prisma.postPerformancePrediction.findMany({
          select: { id: true, clipIdsJson: true },
        }),
      ]);
    }

    const draftIdsToDelete = drafts
      .filter((draft) => jsonStringArrayIncludesAny(draft.clipIdsJson, clipIdSet))
      .map((draft) => draft.id);
    const scheduledPostsToDelete = scheduledPosts
      .filter((post) => jsonStringArrayIncludesAny(post.clipIdsJson, clipIdSet));
    const scheduledPostIdsToDelete = scheduledPostsToDelete.map((post) => post.id);
    const activeScheduledPost = scheduledPostsToDelete.find(isActiveScheduledPostOperation);
    const predictionIdsToDelete = predictions
      .filter((prediction) => jsonStringArrayIncludesAny(prediction.clipIdsJson, clipIdSet))
      .map((prediction) => prediction.id);
    postingMediaPlan = selectPostingMediaObjectKeysForDeletion(scheduledPostsToDelete);
    skippedRemotePostingMediaObjects = postingMediaPlan.skipped;

    if (activeScheduledPost) {
      return {
        success: false,
        message: "This project still has an active posting worker job. Wait for it to finish, then delete the project.",
      };
    }

    await prisma.$transaction(async (tx) => {
      if (predictionIdsToDelete.length > 0) {
        const result = await tx.postPerformancePrediction.deleteMany({
          where: { id: { in: predictionIdsToDelete } },
        });
        clearedPredictions = result.count;
      }

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

      const growthResult = await tx.growthRecommendation.deleteMany({
        where: {
          OR: [
            { sourceSermonId: sermon.id },
            ...(clipIds.length > 0 ? [{ sourceClipId: { in: clipIds } }] : []),
          ],
        },
      });
      clearedGrowthRecommendations = growthResult.count;

      await tx.sermon.delete({
        where: { id: sermon.id },
      });
    });

    clearedPackages = await prunePostingPackageHistoryByClipIds(clipIds).catch(() => 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown deletion error.";
    return {
      success: false,
      message: `Project could not be deleted. ${message}`,
    };
  }

  if (remotePreviewPlan.objectKeys.length > 0) {
    if (!r2MediaStorageConfigured()) {
      failedRemotePreviewObjects = remotePreviewPlan.objectKeys.length;
    } else {
      const remoteResults = await Promise.allSettled(
        remotePreviewPlan.objectKeys.map((objectKey) => deleteClipPreviewFromR2({
          sermonId: sermon.id,
          objectKey,
        })),
      );
      deletedRemotePreviewObjects = remoteResults.filter((result) => result.status === "fulfilled").length;
      failedRemotePreviewObjects = remoteResults.length - deletedRemotePreviewObjects;
    }
  }

  if (postingMediaPlan.objectKeys.length > 0) {
    if (!r2MediaStorageConfigured()) {
      failedRemotePostingMediaObjects = postingMediaPlan.objectKeys.length;
    } else {
      const remoteResults = await Promise.allSettled(
        postingMediaPlan.objectKeys.map((objectKey) => deletePostingMediaFromR2(objectKey)),
      );
      deletedRemotePostingMediaObjects = remoteResults.filter((result) => result.status === "fulfilled").length;
      failedRemotePostingMediaObjects = remoteResults.length - deletedRemotePostingMediaObjects;
    }
  }

  let deletedStorage = false;
  try {
    await Promise.all(storagePaths.map((storagePath) => rm(/* turbopackIgnore: true */ storagePath, { recursive: true, force: true })));
    await unregisterSermonStorageFolder(sermon.id);
    deletedStorage = true;
  } catch {
    deletedStorage = false;
  }

  revalidatePath("/");
  revalidatePath("/sermons");
  revalidatePath(`/sermons/${sermon.id}`);
  revalidatePath("/ready-to-post");
  revalidatePath("/growth");
  revalidatePath("/opportunities");

  const cleanupWarnings = [
    ...(!deletedStorage ? ["Local media cleanup may need a manual check."] : []),
    ...(failedRemotePreviewObjects > 0 ||
      skippedRemotePreviewObjects > 0 ||
      failedRemotePostingMediaObjects > 0 ||
      skippedRemotePostingMediaObjects > 0
      ? ["Remote media cleanup may need a manual check."]
      : []),
  ];

  return {
    success: true,
    message: cleanupWarnings.length > 0
      ? `Deleted "${sermon.title}". ${cleanupWarnings.join(" ")}`
      : `Deleted "${sermon.title}" and its media files.`,
    deletedSermonId: sermon.id,
    deletedClipCount: clipIds.length,
    deletedRemotePreviewObjects,
    deletedRemotePostingMediaObjects,
    failedRemotePreviewObjects,
    failedRemotePostingMediaObjects,
    skippedRemotePreviewObjects,
    skippedRemotePostingMediaObjects,
    clearedDrafts,
    clearedScheduledPosts,
    clearedPredictions,
    clearedGrowthRecommendations,
    clearedPackages,
    deletedStorage,
  };
}

export async function createSermonAction(
  _prevState: CreateSermonFormState,
  formData: FormData,
): Promise<CreateSermonFormState> {
  const uploadedMedia = formData.get("sermonVideoFile");
  const hasUploadedMedia = isUploadedMediaFile(uploadedMedia);
  const uploadedMediaName = hasUploadedMedia ? uploadedMedia.name : "sermon-media";
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
    hasUploadedVideo: hasUploadedMedia,
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

  if (!canRunLocalMediaProcessing() && hasUploadedMedia) {
    return {
      success: false,
      message: "Media file uploads need shared storage before they can run on Vercel. Add this sermon by YouTube URL for now, or upload from the local app.",
      fieldErrors: {
        mediaFile: "File uploads are local-worker only until shared storage is configured.",
      },
    };
  }

  if (hasUploadedMedia && uploadedMediaExceedsSizeLimit(uploadedMedia)) {
    return {
      success: false,
      message: UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
      fieldErrors: {
        mediaFile: UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
      },
    };
  }

  if (hasUploadedMedia && canRunLocalMediaProcessing()) {
    try {
      await assertMediaStorageCapacity({ incomingBytes: uploadedMedia.size });
    } catch (storageError) {
      const reason = storageError instanceof Error ? storageError.message : "Unable to check local media storage capacity.";
      return {
        success: false,
        message: reason,
        fieldErrors: { mediaFile: reason },
      };
    }
  }

  try {
    const sermon = await prisma.sermon.create({
      data: {
        youtubeUrl: result.data.youtubeUrl || buildLocalUploadSourceUrl(uploadedMediaName),
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
        title: true,
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
      await ensureSermonFolders(sermon.id, sermon.title);
      const sourceVideoPath = getSourceVideoPath(sermon.id);
      let uploadedDurationSeconds: number | null = null;
      if (hasUploadedMedia) {
        const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
        await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);

        const arrayBuffer = await uploadedMedia.arrayBuffer();
        try {
          await writeFile(/* turbopackIgnore: true */ tempSourceVideoPath, Buffer.from(arrayBuffer));
          const uploadedMediaCheck = await mediaFileIsUsable(tempSourceVideoPath);
          if (!uploadedMediaCheck.usable) {
            throw new Error(buildUploadedMediaCheckFailureMessage(uploadedMediaCheck.reason));
          }

          await rename(/* turbopackIgnore: true */ tempSourceVideoPath, /* turbopackIgnore: true */ sourceVideoPath);

          const finalizedUpload = await mediaFileIsUsable(sourceVideoPath);
          if (!finalizedUpload.usable) {
            await unlink(/* turbopackIgnore: true */ sourceVideoPath).catch(() => undefined);
            throw new Error(buildUploadedMediaCheckFailureMessage(finalizedUpload.reason));
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
          ...(hasUploadedMedia ? { status: "DOWNLOADED" } : {}),
        },
      });
      await appendPipelineLog(
        sermon.id,
        hasUploadedMedia
          ? "Sermon created from uploaded media file and storage folders initialized."
          : "Sermon created and storage folders initialized.",
      );
    } catch (storageError) {
      const reason = storageError instanceof Error ? storageError.message : "Unknown storage setup error.";
      console.error(`Storage initialization failed for sermon ${sermon.id}: ${reason}`);
      const message = hasUploadedMedia
        ? reason
        : `Sermon was saved, but storage setup failed: ${reason}`;
      return {
        success: false,
        message,
        fieldErrors: hasUploadedMedia ? { mediaFile: reason } : undefined,
        createdSermonId: sermon.id,
      };
    }

    revalidatePath("/");
    await startOneClickSermonPipeline(sermon.id);

    return {
      success: true,
      message: "Sermon saved. The full clip workflow has started automatically.",
      createdSermonId: sermon.id,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown save error.";
    console.error(`Create sermon failed: ${reason}`);
    return {
      success: false,
      message: hasUploadedMedia
        ? `The upload could not be saved. Reason: ${reason}`
        : "Unable to save sermon right now. Please try again.",
      fieldErrors: hasUploadedMedia
        ? { mediaFile: `The upload could not be saved. Reason: ${reason}` }
        : undefined,
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

  if (!canRunInlineMediaProcessing()) {
    const job = await queueSermonProcessingJob(
      sermonId,
      "DOWNLOAD_VIDEO",
      force ? buildForcedProcessingJobSummary("DOWNLOAD_VIDEO") : undefined,
    );
    if (job.intentConflict) {
      return {
        success: false,
        message: "A different video download is already queued. Wait for it to finish, then try again.",
      };
    }
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

  if (!canRunInlineMediaProcessing()) {
    const job = await queueSermonProcessingJob(
      sermonId,
      "EXTRACT_AUDIO",
      force ? buildForcedProcessingJobSummary("EXTRACT_AUDIO") : undefined,
    );
    if (job.intentConflict) {
      return {
        success: false,
        message: "A different audio extraction is already queued. Wait for it to finish, then try again.",
      };
    }
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

  if (!canRunInlineMediaProcessing()) {
    const job = await queueSermonProcessingJob(
      sermonId,
      "TRANSCRIBE_AUDIO",
      force ? buildForcedProcessingJobSummary("TRANSCRIBE_AUDIO") : undefined,
    );
    if (job.intentConflict) {
      return {
        success: false,
        message: "A different transcription is already queued. Wait for it to finish, then try again.",
      };
    }
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
  const append = formData.get("append") === "true";

  if (!sermonId) {
    return {
      success: false,
      message: "Missing sermon id for clip generation.",
    };
  }

  if (!canRunInlineMediaProcessing()) {
    const queuedGenerationSummary = {
      ...(append ? { append: true as const } : {}),
      ...(force ? { forceGeneration: true } : {}),
    };
    const job = await queueSermonProcessingJob(
      sermonId,
      "GENERATE_CLIPS",
      Object.keys(queuedGenerationSummary).length > 0 ? queuedGenerationSummary : undefined,
    );
    if (job.intentConflict) {
      return {
        success: false,
        message: "A different clip-generation request is already running. Wait for it to finish, then try this action again.",
      };
    }
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
    const result = await generateClipSuggestions(sermonId, { force, append });
    const previewSummary = await prepareGeneratedClipPreviews({ sermonId, force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/");

    return {
      success: true,
      message: result.reusedExistingSuggestions
        ? `Clip suggestions already existed. Existing suggestions were reused. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`
        : `Generated ${result.clipCount} ${append ? "new " : ""}clip suggestions. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`,
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
  const sermonStartTimestamp = String(formData.get("sermonStartTimestamp") ?? "").trim();
  const sermonEndTimestamp = String(formData.get("sermonEndTimestamp") ?? "").trim();

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

  const parsedStart = parseSermonTimestampInput(sermonStartTimestamp);
  const parsedEnd = parseSermonTimestampInput(sermonEndTimestamp);
  if (parsedStart.error || parsedEnd.error) {
    return {
      success: false,
      message: "Enter a valid source video range before redoing the clips.",
      fieldErrors: {
        sermonStartTimestamp: parsedStart.error,
        sermonEndTimestamp: parsedEnd.error,
      },
    };
  }

  const sourceWindow = buildRedoClipGenerationSourceWindow(
    parsedStart.seconds,
    parsedEnd.seconds,
  );

  const readiness = await validateRedoClipGenerationReadiness(sermonId, { sourceWindow });
  if (!readiness.ok) {
    return {
      success: false,
      message: readiness.message,
      fieldErrors: {
        ...(readiness.message.toLowerCase().includes("start time")
          ? { sermonStartTimestamp: readiness.message }
          : {}),
        ...(readiness.message.toLowerCase().includes("end time")
          ? { sermonEndTimestamp: readiness.message }
          : {}),
      },
    };
  }

  if (!canRunInlineMediaProcessing()) {
    const job = await queueSermonProcessingJob(
      sermonId,
      "GENERATE_CLIPS",
      {
        mode: "redo",
        sermonStartSeconds: sourceWindow.sermonStartSeconds,
        sermonEndSeconds: sourceWindow.sermonEndSeconds,
        analyzeFullRecording: sourceWindow.analyzeFullRecording,
      },
    );
    if (job.intentConflict) {
      return {
        success: false,
        message: "Another clip-generation request is already running. Wait for it to finish before redoing the clips.",
      };
    }
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");
    return {
      success: true,
      message: job.reusedExisting
        ? "Redo clip generation is already queued for your media worker."
        : "Redo clip generation queued for your media worker. Existing generated clips will be replaced after the worker starts.",
    };
  }

  try {
    const result = await redoClipGenerationFromTranscript(sermonId, { sourceWindow });

    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redo clip generation failed.";
    await appendPipelineLog(sermonId, `Redo clip generation failed: ${message}`);
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");

    return {
      success: false,
      message,
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

  if (!canRunInlineMediaProcessing()) {
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
        errorMessage: true,
        generationSummary: true,
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

    if (job.type === "GENERATE_CLIPS") {
      const existingActiveSuggestionCount = await prisma.clipCandidate.count({
        where: {
          sermonId,
          status: { in: ["SUGGESTED", "APPROVED"] },
          isAiGenerated: true,
        },
      });
      const retryPlan = buildClipGenerationRetryPlan({
        existingActiveSuggestionCount,
        failedJobErrorMessage: job.errorMessage,
        failedJobGenerationSummary: job.generationSummary,
      });
      const { retryMode } = retryPlan;
      const queuedJob = await queueSermonProcessingJob(
        sermonId,
        job.type,
        retryPlan.generationSummary,
      );
      if (queuedJob.intentConflict) {
        return {
          success: false,
          message: "Another clip-generation request started first. Wait for it to finish, refresh this page, and retry only if a failure remains.",
        };
      }
      await appendPipelineLog(
        sermonId,
        retryMode === "repair_previews"
          ? `Manual clip-generation retry kept ${existingActiveSuggestionCount} existing suggestion(s) and queued preview repair without a new AI generation call.`
          : `Manual clip-generation retry queued a fresh generation attempt; ${existingActiveSuggestionCount} existing active suggestion(s) were present.`,
      );

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      return {
        success: true,
        message: retryMode === "repair_previews"
          ? queuedJob.reusedExisting
            ? "Clip preview repair is already queued. Existing suggestions will be kept."
            : "Clip preview repair queued. Existing suggestions will be kept."
          : queuedJob.reusedExisting
            ? "Clip generation retry is already queued for the media worker."
            : "Clip generation retry queued for the media worker.",
      };
    }

    if (job.type === "GENERATE_CONTENT_OPPORTUNITIES") {
      const failedSummary = parseContentOpportunityJobSummary(job.generationSummary);
      if (!failedSummary) {
        return {
          success: false,
          message: "This content idea job has no safe retry instructions. Start a new generation request from Content Ideas.",
        };
      }
      const queuedJob = await enqueueContentOpportunityGeneration({
        sermonId,
        request: failedSummary.request,
      });
      if (queuedJob.intentConflict) {
        return {
          success: false,
          message: "A different content idea request is already running. Wait for it to finish before retrying this one.",
        };
      }
      await appendPipelineLog(
        sermonId,
        `Manual content idea retry ${queuedJob.reusedExisting ? "reused" : "created"} processing job ${queuedJob.jobId}.`,
      );
      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath("/opportunities");
      return {
        success: true,
        message: queuedJob.reusedExisting
          ? "Content idea generation is already queued."
          : "Content idea generation retry queued.",
      };
    }

    if (!canRunInlineMediaProcessing()) {
      const queuedGenerationSummary = job.type === "DOWNLOAD_VIDEO"
        || job.type === "EXTRACT_AUDIO"
        || job.type === "TRANSCRIBE_AUDIO"
        ? buildForcedProcessingJobSummary(job.type)
        : job.type === "EXPORT_CLIPS"
          || job.type === "GENERATE_SUBTITLES"
          || job.type === "BURN_SUBTITLES"
          || job.type === "RENDER_OVERLAY"
          ? buildForcedMediaAssetRetrySummary(job.type, job.generationSummary)
          : undefined;
      const queuedJob = await queueSermonProcessingJob(
        sermonId,
        job.type,
        queuedGenerationSummary,
      );
      if (queuedJob.intentConflict) {
        return {
          success: false,
          message: "A different request for this processing step is already running. Wait for it to finish, then retry the failed step.",
        };
      }
      const label = processingJobTypeLabel(job.type);
      await appendPipelineLog(
        sermonId,
        `Manual retry for failed job ${job.id} (${job.type}) ${queuedJob.reusedExisting ? "reused an existing local-worker queue item" : "queued a new local-worker job"}.`,
      );

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      return {
        success: true,
        message: queuedJob.reusedExisting
          ? `${label} retry is already queued for your local worker.`
          : `${label} retry queued for your local worker.`,
      };
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
  } else if (job.type === "GENERATE_INTELLIGENCE") {
    const result = await generateSermonIntelligence(sermonId, { force: true });
    if (result.status !== "COMPLETED") {
      throw new Error(result.failureReason ?? "Sermon intelligence retry failed.");
    }
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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(sermonId, ["render"], { force });
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: queued.reused > 0 && queued.queued === 0
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

      if (!canRunInlineMediaProcessing()) {
        if (clip.status === "SUGGESTED") {
          const queued = await queueSermonProcessingJob(clip.sermonId, "GENERATE_CLIPS", {
            mode: "repair_previews",
            existingActiveSuggestionCount: 1,
            previewClipIds: [clip.id],
            forcePreviewRender: false,
          });
          if (queued.intentConflict) {
            return {
              success: false,
              message: "A different clip-generation request is already running. Wait for it to finish, then prepare this preview again.",
            };
          }
          return {
            success: true,
            message: queued.reusedExisting
              ? "Clip preview preparation is already queued for the media worker."
              : "Clip preview preparation queued for the media worker.",
          };
        }

        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["render"],
            operation: "Clip render",
          }),
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
      if (clip.status === "REJECTED") {
        return {
          success: false,
          message: formatRecoveryGuidance(
            "Preparing this video is blocked because the clip is not selected.",
            "Move the clip back to review, then prepare the preview again.",
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

      if (!canRunInlineMediaProcessing()) {
        if (clip.status === "SUGGESTED") {
          await prisma.clipCandidate.update({
            where: { id: clip.id },
            data: {
              renderFreshness: "NEEDS_REGENERATION",
              assetInvalidationReason: "Clip preview rerender requested.",
            },
          });
          const queued = await queueSermonProcessingJob(clip.sermonId, "GENERATE_CLIPS", {
            mode: "repair_previews",
            existingActiveSuggestionCount: 1,
            previewClipIds: [clip.id],
            forcePreviewRender: true,
          });
          if (queued.intentConflict) {
            return {
              success: false,
              message: "A different clip-generation request is already running. Wait for it to finish, then rerender this preview.",
            };
          }
          return {
            success: true,
            message: queued.reusedExisting
              ? "Clip preview rerender is already queued for the media worker."
              : "Clip preview rerender queued for the media worker.",
          };
        }

        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["render"],
            operation: "Clip rerender",
            force: true,
            invalidate: {
              renderFreshness: "NEEDS_REGENERATION",
              assetInvalidationReason: "Clip rerender requested.",
            },
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["overlay", "export"],
            operation: "Clip export",
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["overlay", "export"],
            operation: "Clip re-export",
            force: true,
            invalidate: {
              exportFreshness: "NEEDS_REGENERATION",
              assetInvalidationReason: "Clip re-export requested.",
            },
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["caption"],
            operation: "Caption generation",
            force: true,
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["captionBurn"],
            operation: "Caption burn",
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["captionBurn"],
            operation: "Caption re-burn",
            force: true,
            invalidate: {
              captionBurnFreshness: "NEEDS_REGENERATION",
              assetInvalidationReason: "Caption re-burn requested.",
            },
          }),
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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(
      normalizedSermonId,
      ["caption", "captionBurn"],
      { force: true },
    );
    revalidatePath(`/sermons/${normalizedSermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: queued.queued > 0
        ? `Caption generation queued for your local worker (${queued.jobTypes.join(", ")}).`
        : `Caption generation is already queued for your local worker (${queued.jobTypes.join(", ")}).`,
    };
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
      transcriptSafetyStatus: true,
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

  if (!canChooseClipForProduction(clip.transcriptSafetyStatus)) {
    return {
      success: false,
      message: "Listen to the clip and confirm the transcript wording before approval.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      status: "APPROVED",
    },
  });

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath("/");

  return {
    success: true,
    message: "Clip approved.",
  };
}

export async function markClipTranscriptReviewedAction(clipId: string): Promise<ClipCandidateActionState> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    return {
      success: false,
      message: "Missing clip id for transcript review.",
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: normalizedClipId },
    select: {
      id: true,
      sermonId: true,
      transcriptSafetyStatus: true,
      transcriptSafetyReasons: true,
      postReadyBlockers: true,
      qualityWarnings: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
    };
  }

  const qualityWarnings = Array.isArray(clip.qualityWarnings)
    ? clip.qualityWarnings.filter((item): item is string => (
        typeof item === "string" &&
        item !== "LOCAL_LANGUAGE_TRANSCRIPT_REVIEW_REQUIRED" &&
        item !== "TRANSCRIPT_REVIEW_REQUIRED" &&
        item !== "TRANSCRIPT_CHANGED_REVIEW_REQUIRED"
      ))
    : [];

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      transcriptSafetyStatus: "REVIEWED",
      transcriptSafetyReviewedAt: new Date(),
      transcriptSafetyReviewedBy: "pastor_review",
      transcriptSafetyReasons: clip.transcriptSafetyStatus === "REVIEW_REQUIRED"
        ? Array.from(new Set([
            ...(Array.isArray(clip.transcriptSafetyReasons)
              ? clip.transcriptSafetyReasons.filter((reason): reason is string => typeof reason === "string")
              : []),
            "PASTOR_CONFIRMED_TRANSCRIPT_REVIEW",
          ]))
        : undefined,
      postReadyBlockers: removeTranscriptSafetyBlocker(clip.postReadyBlockers),
      qualityWarnings,
    },
  });

  await appendPipelineLog(clip.sermonId, `Transcript safety review completed for clip ${clip.id}; blocker "${TRANSCRIPT_SAFETY_REVIEW_BLOCKER}" cleared.`);

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/ready-to-post");
  revalidatePath("/");

  return {
    success: true,
    message: "Transcript reviewed. Captions and export can now continue.",
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
    select: { id: true, sermonId: true, status: true, transcriptSafetyStatus: true },
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

  if (status === "APPROVED" && !canChooseClipForProduction(clip.transcriptSafetyStatus)) {
    return {
      success: false,
      message: "Review the transcript wording before choosing this moment for production.",
    };
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: { status },
  });

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
      qualityReviewedAt: null,
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

  const runLocally = canRunInlineMediaProcessing();
  const job = await createProcessingJob(sermonId, "QUALITY_REFRESH", {
    execution: runLocally ? "INLINE" : "QUEUED",
  });
  if (!runLocally) {
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
      ...(clip.status === "EXPORTED" ? { status: "APPROVED" as const } : {}),
    },
  });
  await invalidateAfterBoundaryOrCropChange(clip.id, "Manual crop correction updated.");
  await appendPipelineLog(clip.sermonId, `Manual crop correction saved for clip ${clip.id}.`);
  await revalidateClipPaths(clip.id, clip.sermonId);

  return { success: true, message: "Framing updated. Prepare again when ready." };
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

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      manualCropKeyframes: Prisma.JsonNull,
      manualCropUpdatedAt: null,
      smartCropDebugSnapshotPath: null,
      smartCropDebugGeneratedAt: null,
      smartCropDebugError: null,
      ...(clip.status === "EXPORTED" ? { status: "APPROVED" as const } : {}),
    },
  });
  await invalidateAfterBoundaryOrCropChange(clip.id, "Manual crop correction reset.");
  await appendPipelineLog(clip.sermonId, `Manual crop correction reset for clip ${clip.id}.`);
  await revalidateClipPaths(clip.id, clip.sermonId);

  return { success: true, message: "Framing reset. Prepare again when ready." };
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
      transcriptSafetyStatus: true,
    },
  });

  return runOperationWithLogging<ClipReviewBatchActionState>(
    { sermonId, operation: `batch_review_${input.action}` },
    async () => {
      const queuedRemoteAssets = canRunInlineMediaProcessing()
        ? []
        : getQueuedMediaAssetsForRemoteBatchAction(input.action);
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

        if (input.action === "approve" && !canChooseClipForProduction(clip.transcriptSafetyStatus)) {
          failures.push({ clipId, reason: "Review the transcript wording before choosing this moment for production." });
          continue;
        }

        try {
          if (input.action === "approve") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "APPROVED" } });
          } else if (input.action === "reject") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "REJECTED" } });
          } else if (input.action === "pending") {
            await prisma.clipCandidate.update({ where: { id: clipId }, data: { status: "SUGGESTED" } });
          } else if (input.action === "render") {
            if (queuedRemoteAssets.length === 0) {
              await renderApprovedClip(clipId, { force: true, allowRerender: true });
            }
          } else if (input.action === "export") {
            if (queuedRemoteAssets.length === 0) {
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
          }

          processed += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown batch action error.";
          failures.push({ clipId, reason });
        }
      }

      let queuedJobs: Awaited<ReturnType<typeof queueSermonMediaAssetJobs>> | null = null;
      if (processed > 0 && queuedRemoteAssets.length > 0) {
        queuedJobs = await queueSermonMediaAssetJobs(sermonId, queuedRemoteAssets, { clipIds });
      }

      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/");

      const failed = failures.length;
      const outcome: ClipReviewBatchActionState = {
        success: failed === 0,
        message:
          failed === 0
            ? queuedJobs
              ? queuedJobs.queued > 0
                ? `Batch action completed for ${processed} clip(s). Media preparation was queued for your local worker.`
                : `Batch action completed for ${processed} clip(s). Media preparation is already queued for your local worker.`
              : `Batch action completed for ${processed} clip(s).`
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
      transcriptSafetyStatus: true,
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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(sermonId, undefined, {
      clipIds: clips.map((clip) => clip.id),
    });
    await prisma.clipCandidate.updateMany({
      where: { id: { in: clips.map((clip) => clip.id) } },
      data: {
        exportStatus: "QUEUED",
        exportError: null,
      },
    });
    await appendPipelineLog(
      sermonId,
      `Queued preparation for ${clips.length} approved clip(s). Jobs: ${queued.jobTypes.join(", ")}.`,
    );
    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");

    return {
      success: true,
      message: queued.queued > 0
        ? `Preparing ${clips.length} approved clip(s) in the media worker.`
        : `Preparation is already queued for ${clips.length} approved clip(s).`,
      processed: clips.length,
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
      const brandingSettings = await getBrandingSettings();
      let processed = 0;
      let prepared = 0;
      let captionsAdded = 0;
      let brandingAdded = 0;
      let readyToPost = 0;
      const failures: Array<{ clipId: string; reason: string }> = [];

      for (const clip of clips) {
        try {
          if (clip.transcriptSafetyStatus === "REVIEW_REQUIRED") {
            throw new Error("Review the local-language transcript before preparing captions, export, or posting.");
          }

          const plan = buildPrepareClipPlan(clip);
          const captionDataRecord =
            clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
              ? (clip.captionData as Record<string, unknown>)
              : {};
          const captionPreferences = resolveSavedClipCaptionPreferences(
            clip.captionData,
            brandingSettings.defaultCaptionStyleName as CaptionStylePresetId,
          );
          const shouldApplyCaptions = captionPreferences.applyCaptionsToClip;
          const hasManualCaptionCues =
            captionDataRecord["manuallyEdited"] === true &&
            Array.isArray(captionDataRecord["cues"]) &&
            captionDataRecord["cues"].length > 0;
          const resolvedLayoutStrategy = clip.exportLayoutStrategy ?? "SMART_CROP";
          const needsSmartCropRerender = clip.exportLayoutStrategy === null;
          const prepareVideo = plan.prepareVideo || needsSmartCropRerender;
          const writeCaptions = shouldApplyCaptions && !hasManualCaptionCues && plan.writeCaptions;
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
              exportLayoutStrategy: resolvedLayoutStrategy,
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
              captionStylePresetId: captionPreferences.captionStylePresetId,
            });
          } else if (!shouldApplyCaptions) {
            await markCaptionBurnSkippedForDisabledCaptions(clip.id, sermonId);
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
              layoutStrategy: resolvedLayoutStrategy,
              // renderClipOverlay is the canonical visual-composition stage.
              // Passing branding again here would duplicate lower thirds and watermarks.
              brandingOverlay: null,
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

  const failedPreviewClips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "FAILED",
    },
    select: { id: true },
  });
  const failedPreviewCount = failedPreviewClips.length;

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

  if (!canRunInlineMediaProcessing()) {
    const previewJob = failedPreviewCount > 0
      ? await queueSermonProcessingJob(sermonId, "GENERATE_CLIPS", {
          mode: "repair_previews",
          existingActiveSuggestionCount: failedPreviewCount,
          previewClipIds: failedPreviewClips.map((clip) => clip.id),
          forcePreviewRender: true,
          onlyFailedPreviews: true,
        })
      : null;
    if (previewJob?.intentConflict) {
      return {
        success: false,
        message: "A different clip-generation request is already running. Wait for it to finish before repairing previews.",
        previewPrepared: 0,
        previewFailed: failedPreviewCount,
        approvedPrepared: 0,
        approvedFailed: 0,
      };
    }
    const approvedJobs = failedApprovedClips.length > 0
      ? await queueSermonMediaAssetJobs(sermonId, undefined, {
          clipIds: failedApprovedClips.map((clip) => clip.id),
          force: true,
        })
      : null;

    revalidatePath(`/sermons/${sermonId}`);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath(`/ready-to-post?sermonId=${sermonId}`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");
    return {
      success: true,
      message: approvedJobs || previewJob
        ? "Failed clip repairs were queued for the media worker."
        : "No failed clip repairs need queueing.",
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
  return isCaptionStylePresetId(trimmed) ? trimmed : null;
}

function normalizeClipStudioCaptionPosition(value: unknown): CaptionPosition {
  return value === "top" || value === "middle" || value === "lower" ? value : "lower";
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
      title: true,
      hook: true,
      caption: true,
      hashtags: true,
      transcriptText: true,
      captionData: true,
      captionBurnStatus: true,
      exportStatus: true,
      transcriptSafetyStatus: true,
      transcriptSafetyReasons: true,
      postReadyBlockers: true,
    },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
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

  if (!input.title.trim() || !input.mainCaption.trim()) {
    return {
      success: false,
      message: "Could not save clip changes. Add the required title and post caption.",
      fieldErrors: {
        title: input.title.trim() ? undefined : "Clip title is required.",
        mainCaption: input.mainCaption.trim() ? undefined : "Post caption is required.",
      },
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
          intensity: normalizeSpeechCleanupIntensity((captionDataRecord["speechCleanup"] as Record<string, unknown>)["intensity"]),
        }
      : {
          removeDeadAir: false,
          tightenLongPauses: false,
          flagFillerWords: true,
          intensity: "normal" as const,
        };
  const previousSpeechCleanupEdits = normalizeSpeechCleanupEdits(captionDataRecord["speechCleanupEdits"], timing.durationSeconds);
  const previousCaptionAppearance = normalizeCaptionAppearanceSettings(captionDataRecord["captionAppearance"]);
  const previousCaptionRevealMode = extractCaptionRevealMode(captionDataRecord);
  const previousCaptionSyncOffsetSeconds = normalizeCaptionSyncOffsetSeconds(captionDataRecord["captionSyncOffsetSeconds"]);
  const previousBrollLayer = normalizeBrollLayerConfig(captionDataRecord["brollLayer"], timing.durationSeconds);

  const boundariesChanged =
    clip.startTimeSeconds !== timing.startSeconds || clip.endTimeSeconds !== timing.endSeconds;
  let selectedTranscriptSegments = boundariesChanged
    ? await prisma.transcriptSegment.findMany({
        where: {
          sermonId: clip.sermonId,
          startTimeSeconds: { lt: timing.endSeconds },
          endTimeSeconds: { gt: timing.startSeconds },
        },
        orderBy: { startTimeSeconds: "asc" },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
        },
      })
    : [];
  const selectedTimingOverlapsClipTranscript =
    timing.startSeconds < clip.endTimeSeconds && timing.endSeconds > clip.startTimeSeconds;
  if (
    boundariesChanged
    && selectedTranscriptSegments.length === 0
    && selectedTimingOverlapsClipTranscript
    && clip.transcriptText.trim().length > 0
  ) {
    selectedTranscriptSegments = [{
      startTimeSeconds: timing.startSeconds,
      endTimeSeconds: timing.endSeconds,
      text: clip.transcriptText,
    }];
  }
  const selectedTranscriptText = boundariesChanged
    ? selectedTranscriptSegments.map((segment) => segment.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ")
    : clip.transcriptText;
  const selectedTranscriptWords = boundariesChanged
    ? parseCaptionSourceWords((await prisma.transcript.findUnique({
        where: { sermonId: clip.sermonId },
        select: { wordTimings: true },
      }))?.wordTimings)
    : [];

  if (boundariesChanged && !selectedTranscriptText) {
    return {
      success: false,
      message: "Could not save clip changes. The selected timing has no transcript text.",
      fieldErrors: {
        endTimestamp: "Choose a clip range that overlaps the sermon transcription.",
      },
      warnings: timing.warnings,
    };
  }

  const shortCaption = input.shortCaption.trim();
  const platformCaption = input.platformCaption.trim();
  const transcriptCaptionCues =
    boundariesChanged
      ? selectedTranscriptWords.length > 0
        ? buildTimedCaptionCuesFromTranscriptWords({
            startTimeSeconds: timing.startSeconds,
            endTimeSeconds: timing.endSeconds,
            words: selectedTranscriptWords,
            maxWordsPerCue: input.captionRevealMode === "single-word" ? 1 : 5,
            maxCueDurationSeconds: input.captionRevealMode === "single-word" ? 1.4 : 2.4,
          })
        : input.captionRevealMode === "single-word"
          ? buildTimedCaptionCuesFromTranscriptSegments({
              startTimeSeconds: timing.startSeconds,
              endTimeSeconds: timing.endSeconds,
              segments: selectedTranscriptSegments,
            })
          : buildEditableCaptionCuesFromTranscriptSegments({
              startTimeSeconds: timing.startSeconds,
              endTimeSeconds: timing.endSeconds,
              segments: selectedTranscriptSegments,
            })
      : [];
  const draftCaptionCues = boundariesChanged && transcriptCaptionCues.length > 0
    ? mergeCaptionCueTextOverrides({
        baseCues: transcriptCaptionCues,
        textOverrideCues: input.captionCues,
      })
    : input.captionCues.length > 0
      ? input.captionCues
      : transcriptCaptionCues;
  const captionCueValidation = validateEditableCaptionCues(draftCaptionCues, timing.durationSeconds);
  const normalizedCaptionCues = captionCueValidation.cues;
  const transcriptGroundingValidation = validateCaptionCuesFromTranscript(normalizedCaptionCues, selectedTranscriptText);
  const combinedWarnings = [
    ...timing.warnings,
    ...captionCueValidation.warnings,
    ...(input.applyCaptionsToClip && !transcriptGroundingValidation.isValid
      ? ["Caption words were manually edited from the transcript source."]
      : []),
  ];
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

  const contentValues = resolveClipStudioContentValues({
    title: input.title,
    mainCaption: input.mainCaption,
    editorialHook: input.hook,
    existingTitle: clip.title,
    existingEditorialHook: clip.hook,
  });
  const title = contentValues.title;
  const mainCaption = contentValues.socialCaption;

  const normalizedCaptionStylePresetId = normalizeClipStudioCaptionStylePresetId(input.captionStylePresetId);
  const normalizedCaptionPosition = normalizeClipStudioCaptionPosition(input.captionPosition);
  const normalizedCaptionAppearance = normalizeCaptionAppearanceSettings(input.captionAppearance);
  const normalizedCaptionRevealMode = normalizeCaptionRevealMode(input.captionRevealMode);
  const normalizedCaptionSyncOffsetSeconds = normalizeCaptionSyncOffsetSeconds(input.captionSyncOffsetSeconds);
  const validatedClipDurationSeconds = timing.durationSeconds;
  const shiftedCaptionStartsBeforeClip = normalizedCaptionCues.some(
    (cue) => cue.startSeconds + normalizedCaptionSyncOffsetSeconds < -0.001,
  );
  const shiftedCaptionEndsAfterClip = normalizedCaptionCues.some(
    (cue) => cue.endSeconds + normalizedCaptionSyncOffsetSeconds > validatedClipDurationSeconds + 0.001,
  );
  if (input.applyCaptionsToClip && (shiftedCaptionStartsBeforeClip || shiftedCaptionEndsAfterClip)) {
    combinedWarnings.push(
      "The caption sync offset moves a boundary word partly outside the clip. Review the opening and closing captions in the preview.",
    );
  }
  const hookOverlayVisibility = normalizeHookOverlayForClipDuration(input.hookOverlay, timing.durationSeconds);
  const normalizedHookOverlay = hookOverlayVisibility.hookOverlay;
  const normalizedBrollLayer = normalizeBrollLayerConfig(input.brollLayer, timing.durationSeconds);
  const normalizedSpeechCleanup = {
    removeDeadAir: Boolean(input.speechCleanup?.removeDeadAir),
    tightenLongPauses: Boolean(input.speechCleanup?.tightenLongPauses),
    flagFillerWords: Boolean(input.speechCleanup?.flagFillerWords),
    intensity: normalizeSpeechCleanupIntensity(input.speechCleanup?.intensity),
  };
  const normalizedSpeechCleanupEdits = normalizeSpeechCleanupEdits(input.speechCleanupEdits, timing.durationSeconds);
  const serializedSpeechCleanupEdits = serializeSpeechCleanupEdits(normalizedSpeechCleanupEdits) as Prisma.InputJsonValue | null;
  const hookText = contentValues.editorialHook;
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
  if (hookOverlayVisibility.error) {
    return {
      success: false,
      message: "Could not save clip changes. Please check the highlighted fields.",
      fieldErrors: {
        hook: hookOverlayVisibility.error,
      },
      warnings: timing.warnings,
    };
  }
  if (normalizedHookOverlay.enabled && hookOverlayVisibility.wasClamped) {
    combinedWarnings.push("Hook overlay timing was fitted inside the current clip duration.");
  }

  let srtPath = typeof clip.captionData === "object" && clip.captionData && typeof captionDataRecord["srtPath"] === "string"
    ? captionDataRecord["srtPath"]
    : null;
  if (input.applyCaptionsToClip) {
    if (canRunLocalMediaProcessing()) {
      await ensureSermonFolders(clip.sermonId);
      srtPath = getClipSrtPath(clip.sermonId, clip.id);
      await writeFile(/* turbopackIgnore: true */ srtPath, buildSrtFromEditableCues(normalizedCaptionCues), "utf8");
    } else {
      srtPath = null;
    }
  }

  const previousHashtags = Array.isArray(clip.hashtags)
    ? clip.hashtags.filter((item): item is string => typeof item === "string")
    : [];

  const socialCopyChanged =
    clip.title !== title ||
    clip.caption !== mainCaption ||
    captionPackageRecord["shortCaption"] !== shortCaption ||
    captionPackageRecord["platformCaption"] !== platformCaption;
  const captionCuesChanged = JSON.stringify(previousCues) !== JSON.stringify(normalizedCaptionCues);
  const onVideoCaptionChanged =
    captionCuesChanged ||
    captionDataRecord["applyCaptionsToClip"] !== input.applyCaptionsToClip ||
    captionDataRecord["captionStylePresetId"] !== normalizedCaptionStylePresetId ||
    captionDataRecord["captionPosition"] !== normalizedCaptionPosition ||
    JSON.stringify(previousCaptionAppearance) !== JSON.stringify(normalizedCaptionAppearance) ||
    previousCaptionRevealMode !== normalizedCaptionRevealMode ||
    previousCaptionSyncOffsetSeconds !== normalizedCaptionSyncOffsetSeconds;
  const hashtagChanged = previousHashtags.join("|") !== hashtags.join("|");
  const editorialHookChanged = clip.hook !== hookText;
  const visualHookChanged = JSON.stringify(previousHookOverlay) !== JSON.stringify(normalizedHookOverlay);
  const brollLayerChanged = JSON.stringify(previousBrollLayer) !== JSON.stringify(normalizedBrollLayer);
  const speechCleanupChanged =
    JSON.stringify(previousSpeechCleanup) !== JSON.stringify(normalizedSpeechCleanup) ||
    JSON.stringify(previousSpeechCleanupEdits) !== JSON.stringify(normalizedSpeechCleanupEdits);
  const studioEditsChanged =
    boundariesChanged ||
    socialCopyChanged ||
    hashtagChanged ||
    editorialHookChanged ||
    onVideoCaptionChanged ||
    visualHookChanged ||
    brollLayerChanged ||
    speechCleanupChanged;
  const assetInvalidation = resolveClipStudioAssetInvalidation({
    boundariesChanged,
    speechCleanupChanged,
    onVideoCaptionChanged,
    visualOverlayChanged: visualHookChanged || brollLayerChanged,
  });

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      startTimeSeconds: timing.startSeconds,
      endTimeSeconds: timing.endSeconds,
      durationSeconds: timing.durationSeconds,
      adjustedStartTimeSeconds: timing.startSeconds,
      adjustedEndTimeSeconds: timing.endSeconds,
      transcriptText: selectedTranscriptText,
      title,
      ...resolveClipStudioBoundaryReviewUpdate({
        boundariesChanged,
        startSeconds: timing.startSeconds,
        endSeconds: timing.endSeconds,
      }),
      caption: mainCaption,
      hook: hookText,
      hashtags,
      ...(input.applyCaptionsToClip
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
        captionPosition: normalizedCaptionPosition,
        captionAppearance: normalizedCaptionAppearance,
        captionRevealMode: normalizedCaptionRevealMode,
        captionSyncOffsetSeconds: normalizedCaptionSyncOffsetSeconds,
        wordHighlightEnabled: normalizedCaptionRevealMode === "active-word",
        cues: normalizedCaptionCues.map((cue) => ({
          index: cue.index,
          startSeconds: cue.startSeconds,
          endSeconds: cue.endSeconds,
          text: cue.text,
          ...(cue.wordTimings ? { wordTimings: cue.wordTimings } : {}),
        })),
        hookOverlay: normalizedHookOverlay,
        brollLayer: normalizedBrollLayer,
        speechCleanup: {
          ...normalizedSpeechCleanup,
          updatedAt: new Date().toISOString(),
        },
        speechCleanupEdits: serializedSpeechCleanupEdits,
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
      ...((boundariesChanged || socialCopyChanged || hashtagChanged || editorialHookChanged || captionCuesChanged)
        ? { qualityReviewedAt: null }
        : {}),
      ...(shouldRecordExplicitTranscriptReview({
        transcriptSafetyStatus: clip.transcriptSafetyStatus,
        explicitlyConfirmed: input.confirmTranscriptReviewed === true,
      })
        ? {
            transcriptSafetyStatus: "REVIEWED" as const,
            transcriptSafetyReviewedAt: new Date(),
            transcriptSafetyReviewedBy: "clip_studio",
            transcriptSafetyReasons: Array.from(new Set([
              ...(Array.isArray(clip.transcriptSafetyReasons)
                ? clip.transcriptSafetyReasons.filter((reason): reason is string => typeof reason === "string")
                : []),
              "HUMAN_CONFIRMED_TRANSCRIPT_REVIEW",
            ])),
            postReadyBlockers: removeTranscriptSafetyBlocker(clip.postReadyBlockers),
          }
        : {}),
      ...(clip.status === "EXPORTED" && studioEditsChanged ? { status: "APPROVED" as const } : {}),
    },
  });

  if (assetInvalidation === "BOUNDARIES") {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: boundary change from Clip Studio.`);
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      `Boundaries changed to ${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s from Clip Studio.`,
    );
    if (input.applyCaptionsToClip) {
      await prisma.clipCandidate.update({
        where: { id: clip.id },
        data: {
          captionFreshness: "UP_TO_DATE",
          captionAssetVersion: { increment: 1 },
        },
      });
    }
    await appendPipelineLog(
      clip.sermonId,
      input.applyCaptionsToClip
        ? `Regeneration invalidation completed for clip ${clip.id}: render/burn/overlay/export freshness updated; captions rebuilt from selected transcript.`
        : `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  } else if (assetInvalidation === "SPEECH_CLEANUP") {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: speech cleanup setting change from Clip Studio.`);
    await invalidateAfterBoundaryOrCropChange(
      clip.id,
      "Speech cleanup settings changed from Clip Studio. Render and downstream assets require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: render/caption/burn/overlay/export freshness updated.`,
    );
  } else if (assetInvalidation === "ON_VIDEO_CAPTIONS") {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: caption change from Clip Studio.`);
    await markManualCaptionEditPreparedForRebuild({
      clipId: clip.id,
      sermonId: clip.sermonId,
      captionsEnabled: input.applyCaptionsToClip,
      captionBurnStatus: clip.captionBurnStatus,
      exportStatus: clip.exportStatus,
      reason: "On-video caption settings changed from Clip Studio. Burned captions and exports require regeneration.",
    });
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: manual caption settings preserved and downstream assets updated.`,
    );
  } else if (assetInvalidation === "VISUAL_OVERLAYS") {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: visual overlay change from Clip Studio.`);
    await invalidateAfterOverlaySettingChange(
      clip.id,
      "Visual overlay changed from Clip Studio. Overlay and export assets require regeneration.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: overlay/export freshness updated.`,
    );
  } else if (socialCopyChanged || hashtagChanged || editorialHookChanged) {
    await appendPipelineLog(
      clip.sermonId,
      `Post copy updated for clip ${clip.id}; prepared video assets remain current and content guidance should be rechecked.`,
    );
  }

  await upsertActiveClipEditPlanForClip({
    clipCandidateId: clip.id,
    createdBy: "studio",
    createdReason: "clip_studio_edits_saved",
  });

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
      exportFormat: true,
      exportLayoutStrategy: true,
      manualCropKeyframes: true,
    },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
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
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
    manualCropKeyframes: clip.manualCropKeyframes,
  });
  const framingPersonality: FramingPersonality = isValidFramingPersonality(input.framingPersonality)
    ? input.framingPersonality
    : previousExportSettings.framingPersonality;
  const normalizedFormats = Array.from(new Set([primaryFormat, ...selectedFormats]));
  const backgroundMode = deriveBackgroundMode(framingMode);
  const previousManualCropKeyframes = normalizeManualCropKeyframes(clip.manualCropKeyframes);
  const manualCropKeyframes =
    framingMode === "SMART_CROP" && input.manualCropKeyframes !== undefined
      ? normalizeManualCropKeyframes(input.manualCropKeyframes)
      : framingMode === "SMART_CROP"
        ? previousManualCropKeyframes
        : [];
  const manualCropChanged = JSON.stringify(previousManualCropKeyframes) !== JSON.stringify(manualCropKeyframes);
  const framingChanged =
    clip.exportLayoutStrategy !== framingMode ||
    previousExportSettings.framingPersonality !== framingPersonality ||
    manualCropChanged;
  const outputSelectionChanged =
    previousExportSettings.platformPreset !== platformPreset ||
    previousExportSettings.primaryFormat !== primaryFormat ||
    previousExportSettings.selectedFormats.join("|") !== normalizedFormats.join("|");
  const exportSettingsChanged = framingChanged || outputSelectionChanged;

  const captionDataRecord =
    clip.captionData && typeof clip.captionData === "object" ? (clip.captionData as Record<string, unknown>) : {};

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      exportFormat: primaryFormat,
      exportLayoutStrategy: framingMode,
      manualCropKeyframes: manualCropKeyframes.length > 0 ? manualCropKeyframes : Prisma.JsonNull,
      ...(manualCropChanged ? { manualCropUpdatedAt: manualCropKeyframes.length > 0 ? new Date() : null } : {}),
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
          manualCropKeyframes,
          manuallyEdited: true,
          updatedAt: new Date().toISOString(),
        },
      },
      ...(clip.status === "EXPORTED" && exportSettingsChanged ? { status: "APPROVED" as const } : {}),
    },
  });

  if (framingChanged) {
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
  } else if (outputSelectionChanged) {
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation started for clip ${clip.id}: output formats changed from Clip Studio.`,
    );
    await invalidateAfterExportSettingChange(
      clip.id,
      "Output formats changed from Clip Studio. A fresh final export is required.",
    );
    await appendPipelineLog(
      clip.sermonId,
      `Regeneration invalidation completed for clip ${clip.id}: final export freshness updated.`,
    );
  }

  await upsertActiveClipEditPlanForClip({
    clipCandidateId: clip.id,
    createdBy: "studio",
    createdReason: "clip_studio_export_settings_saved",
  });

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
  introEnabled: boolean;
  outroEnabled: boolean;
  introDurationSeconds?: number;
  outroDurationSeconds?: number;
  backgroundStyle: string;
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
    select: { id: true, sermonId: true, status: true, captionData: true },
  });

  if (!clip) {
    return { success: false, message: "Clip candidate was not found." };
  }

  const captionDataRecord = toCaptionDataRecord(clip.captionData);
  const previousConfig = resolveBrandingConfig(clip.captionData);
  const preset = input.preset as BrandingPreset;
  const nextConfig = {
    enabled: input.enabled,
    preset,
    showChurchName: input.showChurchName,
    showSermonTitle: input.showSermonTitle,
    showPreacherName: input.showPreacherName,
    watermarkEnabled: input.watermarkEnabled,
    lowerThirdEnabled: input.lowerThirdEnabled,
    introEnabled: input.introEnabled,
    outroEnabled: input.outroEnabled,
    introDurationSeconds: normalizeBrandingDurationSeconds(
      input.introDurationSeconds,
      DEFAULT_INTRO_DURATION_SECONDS,
    ),
    outroDurationSeconds: normalizeBrandingDurationSeconds(
      input.outroDurationSeconds,
      DEFAULT_OUTRO_DURATION_SECONDS,
    ),
    backgroundStyle: ["NONE", "SOFT_GRADIENT", "SOLID_BRAND", "BLURRED_TINT"].includes(input.backgroundStyle)
      ? input.backgroundStyle
      : previousConfig.backgroundStyle,
    themeColor,
  };
  const brandingChanged = JSON.stringify(previousConfig) !== JSON.stringify(nextConfig);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionData: {
        ...captionDataRecord,
        brandingSettings: {
          ...nextConfig,
          updatedAt: new Date().toISOString(),
        },
      },
      ...(clip.status === "EXPORTED" && brandingChanged ? { status: "APPROVED" as const } : {}),
    },
  });

  if (brandingChanged) {
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation started for clip ${clip.id}: branding changed from Clip Studio.`);
    await invalidateAfterOverlaySettingChange(
      clip.id,
      "Branding changed from Clip Studio. Overlay and export assets require regeneration.",
    );
    await appendPipelineLog(clip.sermonId, `Regeneration invalidation completed for clip ${clip.id}: overlay/export freshness updated.`);
  }

  await upsertActiveClipEditPlanForClip({
    clipCandidateId: clip.id,
    createdBy: "studio",
    createdReason: "clip_studio_branding_saved",
  });

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/ready-to-post");

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

function resolveSavedClipCaptionPreferences(
  captionData: unknown,
  fallbackCaptionStylePresetId: CaptionStylePresetId,
): {
  applyCaptionsToClip: boolean;
  captionStylePresetId: CaptionStylePresetId;
} {
  const captionDataRecord = toCaptionDataRecord(captionData);
  const applyCaptionsToClip =
    typeof captionDataRecord["applyCaptionsToClip"] === "boolean"
      ? captionDataRecord["applyCaptionsToClip"]
      : true;
  const captionStylePresetId =
    typeof captionDataRecord["captionStylePresetId"] === "string"
      ? normalizeClipStudioCaptionStylePresetId(captionDataRecord["captionStylePresetId"])
      : null;

  return {
    applyCaptionsToClip,
    captionStylePresetId: captionStylePresetId ?? fallbackCaptionStylePresetId,
  };
}

async function markCaptionBurnSkippedForDisabledCaptions(clipId: string, sermonId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionBurnStatus: "NOT_BURNED",
      captionedVideoPath: null,
      captionBurnedAt: null,
      captionBurnError: null,
      subtitlesBurned: false,
      captionBurnFreshness: "UP_TO_DATE",
    },
  });
  await appendPipelineLog(sermonId, `Caption burn skipped for clip ${clipId}: on-video captions are disabled.`);
}

async function markManualCaptionEditPreparedForRebuild(input: {
  clipId: string;
  sermonId: string;
  captionsEnabled: boolean;
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED" | null;
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED" | null;
  reason: string;
}): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: input.clipId },
    data: {
      captionFreshness: "UP_TO_DATE",
      captionBurnFreshness: input.captionsEnabled
        ? input.captionBurnStatus === "COMPLETED"
          ? "NEEDS_REGENERATION"
          : "UP_TO_DATE"
        : "UP_TO_DATE",
      overlayFreshness: "NEEDS_REGENERATION",
      exportFreshness: input.exportStatus === "COMPLETED" ? "NEEDS_REGENERATION" : "UP_TO_DATE",
      assetInvalidationReason: input.reason,
      ...(!input.captionsEnabled
        ? {
            captionBurnStatus: "NOT_BURNED" as const,
            captionedVideoPath: null,
            captionBurnedAt: null,
            captionBurnError: null,
            subtitlesBurned: false,
          }
        : {}),
    },
  });

  if (!input.captionsEnabled) {
    await appendPipelineLog(input.sermonId, `Caption burn disabled for clip ${input.clipId}; future exports will use the uncaptioned prepared video.`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileHasBytes(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath?.trim()) {
    return false;
  }

  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.size > 0;
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
  brandingSnapshot?: Record<string, string | number | boolean | null> | null;
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

async function updateClipStudioExportHistory(clipId: string, exportHistory: ClipStudioExportRecord[]): Promise<void> {
  const current = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: { captionData: true },
  });
  const currentCaptionDataRecord = toCaptionDataRecord(current?.captionData);

  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionData: {
        ...currentCaptionDataRecord,
        exportHistory,
      },
    },
  });
}

export async function renderClipStudioExportsAction(input: {
  clipId: string;
  selectedFormats?: string[];
  forceRebuild?: boolean;
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
      renderFreshness: true,
      renderedFilePath: true,
      caption: true,
      captionStatus: true,
      captionBurnStatus: true,
      captionBurnFreshness: true,
      captionedVideoPath: true,
      captionData: true,
      exportStatus: true,
      exportFreshness: true,
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
  if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
    return {
      success: false,
      message: "This clip must be approved before rendering. Approve it from Suggested Clips, then return to Clip Studio.",
      results: [],
    };
  }

  const exportSettings = resolveExportSettings({
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
  });

  const requestedFormats =
    Array.isArray(input.selectedFormats) && input.selectedFormats.length > 0
      ? Array.from(new Set(input.selectedFormats.filter((format): format is "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1" => isValidExportFormat(format))))
      : exportSettings.selectedFormats;

  const selectedFormats = orderExportFormatsForCanonicalPrimary(
    requestedFormats.length > 0 ? requestedFormats : [exportSettings.primaryFormat],
    exportSettings.primaryFormat,
  );

  const previousHistory = resolveExportHistory(clip.captionData);
  const renderVersion = nextRenderVersion(previousHistory);

  const churchNameUsed = brandingConfig.showChurchName ? (sermon?.churchName ?? "") : "";
  const sermonTitleUsed = brandingConfig.showSermonTitle ? (sermon?.title ?? "") : "";
  const preacherNameUsed = brandingConfig.showPreacherName ? (sermon?.speakerName ?? "") : "";
  const logoPath = globalBranding?.churchLogoPath ?? null;
  const logoAvailable = typeof logoPath === "string" && logoPath.trim().length > 0;
  const captionPreferences = resolveSavedClipCaptionPreferences(
    clip.captionData,
    (globalBranding?.defaultCaptionStyleName as CaptionStylePresetId | undefined) ?? "clean-lower",
  );
  const [renderedFileReady, captionedFileReady] = await Promise.all([
    fileHasBytes(clip.renderedFilePath),
    fileHasBytes(clip.captionedVideoPath),
  ]);
  const preparePlan = buildClipStudioPrepareAssetPlan(
    {
      renderStatus: clip.renderStatus,
      renderFreshness: clip.renderFreshness,
      renderedFileReady,
      captionsEnabled: captionPreferences.applyCaptionsToClip,
      captionStatus: clip.captionStatus,
      captionBurnStatus: clip.captionBurnStatus,
      captionBurnFreshness: clip.captionBurnFreshness,
      captionedFileReady,
      exportStatus: clip.exportStatus,
      exportFreshness: clip.exportFreshness,
    },
    { forceRebuild: input.forceRebuild === true },
  );
  const results: ClipStudioRenderResult[] = [];
  const formatsToExport: typeof selectedFormats = [];

  for (const format of selectedFormats) {
    if (preparePlan.exportPreparedVideo) {
      formatsToExport.push(format);
      continue;
    }

    const reusableRecord = previousHistory.find((record) =>
      record.isLatest &&
      record.format === format &&
      record.status === "COMPLETED" &&
      typeof record.outputPath === "string",
    );

    if (reusableRecord?.outputPath && await fileHasBytes(reusableRecord.outputPath)) {
      results.push({
        recordId: reusableRecord.id,
        format,
        status: "COMPLETED",
        outputPath: reusableRecord.outputPath,
        errorMessage: null,
      });
      continue;
    }

    formatsToExport.push(format);
  }

  const queuedRecords = formatsToExport.map((format) =>
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
        introEnabled: brandingConfig.introEnabled,
        outroEnabled: brandingConfig.outroEnabled,
        introDurationSeconds: brandingConfig.introDurationSeconds ?? DEFAULT_INTRO_DURATION_SECONDS,
        outroDurationSeconds: brandingConfig.outroDurationSeconds ?? DEFAULT_OUTRO_DURATION_SECONDS,
        backgroundStyle: brandingConfig.backgroundStyle,
        themeColor: brandingConfig.themeColor,
        logoAvailable,
      },
    }),
  );

  let workingHistory = markLatestExports([...previousHistory, ...queuedRecords]);
  if (queuedRecords.length > 0) {
    await updateClipStudioExportHistory(clip.id, workingHistory);
  }

  if (preparePlan.prepareVideo || preparePlan.burnCaptions || preparePlan.skipCaptionBurn || queuedRecords.length > 0) {
    try {
      if (preparePlan.prepareVideo) {
        await renderApprovedClip(clip.id, {
          allowRerender: true,
          force: true,
        });
      }
      if (preparePlan.burnCaptions) {
        await burnCaptionsIntoRenderedClip(clip.id, {
          allowReburn: true,
          force: true,
        });
      } else if (preparePlan.skipCaptionBurn) {
        await markCaptionBurnSkippedForDisabledCaptions(clip.id, clip.sermonId);
      }
      if (queuedRecords.length > 0) {
        await renderClipOverlay(clip.id, {
          allowRerender: true,
          force: true,
        });
      }
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

      if (queuedRecords.length > 0) {
        await updateClipStudioExportHistory(clip.id, workingHistory);
      }

      revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
      revalidatePath(`/sermons/${clip.sermonId}/review`);

      return {
        success: false,
        message: "The clip could not be rendered. Please try again. If it keeps failing, check that the source video is still available.",
        results: [
          ...results,
          ...queuedRecords.map((record) => ({
            recordId: record.id,
            format: record.format,
            status: "FAILED" as const,
            outputPath: null,
            errorMessage: reason,
          })),
        ],
      };
    }
  }

  if (queuedRecords.length === 0) {
    const completed = results.filter((result) => result.status === "COMPLETED").length;
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: { status: "EXPORTED" },
    });

    revalidatePath(`/sermons/${clip.sermonId}`);
    revalidatePath(`/sermons/${clip.sermonId}/review`);
    revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");

    return {
      success: true,
      message: `Final video already prepared for ${completed} format(s).`,
      results,
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

    await updateClipStudioExportHistory(clip.id, workingHistory);

    try {
      const versionTag = `${queued.renderVersion}-${Date.now()}`;
      const exported = await exportClipWithPreset(clip.id, {
        format: queued.format,
        layoutStrategy: queued.framingMode,
        allowReexport: true,
        force: true,
        versionTag,
        // The prepared overlay is the single source of truth for branding,
        // timed cards, hook, and B-roll. Do not compose branding twice.
        brandingOverlay: null,
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

    await updateClipStudioExportHistory(clip.id, workingHistory);
  }

  const completed = results.filter((result) => result.status === "COMPLETED").length;
  const failed = results.length - completed;

  if (failed === 0) {
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: { status: "EXPORTED" },
    });
  }

  revalidatePath(`/sermons/${clip.sermonId}`);
  revalidatePath(`/sermons/${clip.sermonId}/review`);
  revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
  revalidatePath("/ready-to-post");
  revalidatePath("/");

  return {
    success: failed === 0,
    message:
      failed === 0
        ? `Final video prepared for ${completed} format(s).`
        : `Render completed with ${failed} failure(s). Completed ${completed} format(s).`,
    results,
  };
}

function resolveClipStudioFormats(input: PrepareClipStudioForPostingInput): {
  primaryFormat: "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
  formats: Array<"VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1">;
} {
  const selectedFormats = Array.from(
    new Set(input.exportSettings.selectedFormats.filter((format) => isValidExportFormat(format))),
  );
  const primaryFormat = isValidExportFormat(input.exportSettings.primaryFormat)
    ? input.exportSettings.primaryFormat
    : selectedFormats[0] ?? "VERTICAL_9_16";

  return {
    primaryFormat,
    formats: Array.from(new Set([primaryFormat, ...selectedFormats])),
  };
}

function isPrismaTransactionTimeout(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2028",
  );
}

async function runClipStudioDraftSaveStep<T>(input: {
  clipId: string;
  step: "clip edits" | "format and framing" | "branding";
  operation: () => Promise<T>;
}): Promise<{ completed: true; value: T } | { completed: false; state: PrepareClipStudioForPostingState }> {
  try {
    return { completed: true, value: await input.operation() };
  } catch (error) {
    console.error(`Clip Studio draft save failed for ${input.clipId} during ${input.step}.`, error);

    return {
      completed: false,
      state: {
        success: false,
        message: isPrismaTransactionTimeout(error)
          ? "The database took too long while saving this Studio draft. Your browser draft is still available. Please try Save draft again."
          : "Studio could not finish saving this draft. Your browser draft is still available. Please try Save draft again.",
        results: [],
      },
    };
  }
}

export async function saveClipStudioDraftAction(
  input: PrepareClipStudioForPostingInput,
): Promise<PrepareClipStudioForPostingState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return {
      success: false,
      message: "Missing clip id for this Studio draft.",
      results: [],
    };
  }

  const { startSeconds, endSeconds } = input.editPreview;
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
    return {
      success: false,
      message: "Choose a valid start and end before preparing the final video.",
      results: [],
      fieldErrors: {
        startTimestamp: startSeconds === null ? "Start time is required." : undefined,
        endTimestamp: endSeconds === null || endSeconds <= (startSeconds ?? 0) ? "End time must come after start." : undefined,
      },
    };
  }

  const preflightFieldErrors: NonNullable<PrepareClipStudioForPostingState["fieldErrors"]> = {};
  if (!isValidPlatformPreset(input.exportSettings.platformPreset)) {
    preflightFieldErrors.platformPreset = "Choose a supported publishing platform.";
  }
  if (!isValidExportFormat(input.exportSettings.primaryFormat)) {
    preflightFieldErrors.primaryFormat = "Choose a supported primary video format.";
  }
  if (!isValidFramingMode(input.exportSettings.framingMode)) {
    preflightFieldErrors.framingMode = "Choose a supported framing mode.";
  }
  if (!isValidFramingPersonality(input.exportSettings.framingPersonality)) {
    preflightFieldErrors.framingPersonality = "Choose a supported framing style.";
  }
  if (input.exportSettings.selectedFormats.some((format) => !isValidExportFormat(format))) {
    preflightFieldErrors.selectedFormats = "One or more selected video formats are unsupported.";
  }
  if (!isValidBrandingPreset(input.brandingConfig.preset)) {
    preflightFieldErrors.preset = "Choose a supported church branding preset.";
  }
  if (
    input.brandingConfig.themeColor !== null &&
    input.brandingConfig.themeColor.trim() !== "" &&
    validateThemeColor(input.brandingConfig.themeColor) === null
  ) {
    preflightFieldErrors.themeColor = "Theme color must be a hex value such as #0F766E.";
  }
  if (Object.keys(preflightFieldErrors).length > 0) {
    return {
      success: false,
      message: "Check the highlighted Studio settings before saving this draft.",
      results: [],
      fieldErrors: preflightFieldErrors,
    };
  }

  const { primaryFormat, formats: selectedFormats } = resolveClipStudioFormats(input);

  const editStep = await runClipStudioDraftSaveStep({
    clipId,
    step: "clip edits",
    operation: () => updateClipStudioEditsAction({
      clipId,
      startTimestamp: formatSecondsForTimestampInput(startSeconds),
      endTimestamp: formatSecondsForTimestampInput(endSeconds),
      title: input.editPreview.title,
      mainCaption: input.editPreview.mainCaption,
      shortCaption: input.editPreview.shortCaption,
      platformCaption: input.editPreview.platformCaption,
      hashtags: input.editPreview.hashtags,
      captionCues: input.editPreview.captionCues,
      applyCaptionsToClip: input.editPreview.applyCaptionsToClip,
      captionStylePresetId: input.editPreview.captionStylePresetId,
      captionPosition: input.editPreview.captionPosition,
      captionAppearance: input.editPreview.captionAppearance,
      captionRevealMode: input.editPreview.captionRevealMode,
      captionSyncOffsetSeconds: input.editPreview.captionSyncOffsetSeconds,
      hook: input.editPreview.editorialHook,
      hookOverlay: input.editPreview.hookOverlay,
      brollLayer: input.editPreview.brollLayer,
      speechCleanup: input.editPreview.speechCleanup,
      speechCleanupEdits: input.editPreview.speechCleanupEdits,
      confirmTranscriptReviewed: false,
    }),
  });
  if (!editStep.completed) return editStep.state;
  const editResult = editStep.value;

  if (!editResult.success) {
    return {
      success: false,
      message: editResult.message,
      results: [],
      fieldErrors: editResult.fieldErrors,
      warnings: editResult.warnings,
    };
  }

  const exportStep = await runClipStudioDraftSaveStep({
    clipId,
    step: "format and framing",
    operation: () => updateClipExportSettingsAction({
      clipId,
      platformPreset: input.exportSettings.platformPreset,
      primaryFormat,
      framingMode: input.exportSettings.framingMode,
      framingPersonality: input.exportSettings.framingPersonality,
      selectedFormats,
      manualCropKeyframes: input.exportSettings.manualCropKeyframes,
    }),
  });
  if (!exportStep.completed) return exportStep.state;
  const exportResult = exportStep.value;

  if (!exportResult.success) {
    return {
      success: false,
      message: exportResult.message,
      results: [],
      fieldErrors: exportResult.fieldErrors,
      warnings: editResult.warnings,
    };
  }

  const brandingStep = await runClipStudioDraftSaveStep({
    clipId,
    step: "branding",
    operation: () => updateClipBrandingAction({
      clipId,
      enabled: input.brandingConfig.enabled,
      preset: input.brandingConfig.preset,
      showChurchName: input.brandingConfig.showChurchName,
      showSermonTitle: input.brandingConfig.showSermonTitle,
      showPreacherName: input.brandingConfig.showPreacherName,
      watermarkEnabled: input.brandingConfig.watermarkEnabled,
      lowerThirdEnabled: input.brandingConfig.lowerThirdEnabled,
      introEnabled: input.brandingConfig.introEnabled,
      outroEnabled: input.brandingConfig.outroEnabled,
      introDurationSeconds: input.brandingConfig.introDurationSeconds,
      outroDurationSeconds: input.brandingConfig.outroDurationSeconds,
      backgroundStyle: input.brandingConfig.backgroundStyle,
      themeColor: input.brandingConfig.themeColor,
    }),
  });
  if (!brandingStep.completed) return brandingStep.state;
  const brandingResult = brandingStep.value;

  if (!brandingResult.success) {
    return {
      success: false,
      message: brandingResult.message,
      results: [],
      fieldErrors: brandingResult.fieldErrors,
      warnings: editResult.warnings,
    };
  }

  return {
    success: true,
    draftSaved: true,
    message: "Studio draft saved.",
    results: [],
    warnings: editResult.warnings,
  };
}

export async function prepareClipStudioForPostingAction(
  input: PrepareClipStudioForPostingInput,
): Promise<PrepareClipStudioForPostingState> {
  const clipId = input.clipId.trim();
  if (!clipId) {
    return {
      success: false,
      message: "Missing clip id for preparation.",
      results: [],
    };
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: { id: true, sermonId: true, transcriptSafetyStatus: true },
  });

  if (!clip) {
    return {
      success: false,
      message: "Clip candidate was not found.",
      results: [],
    };
  }

  // A preparation attempt must never mutate a review-blocked clip first and
  // only report the safety failure afterwards. Draft saving remains available
  // through saveClipStudioDraftAction without approving or rendering media.
  if (clip.transcriptSafetyStatus === "REVIEW_REQUIRED") {
    return {
      success: false,
      message: "Review and confirm the local-language transcript before preparing this clip for posting.",
      results: [],
    };
  }

  const { formats: formatsToPrepare } = resolveClipStudioFormats(input);
  if (
    !canRunInlineMediaProcessing()
    && formatsToPrepare.some((format) => format !== "VERTICAL_9_16")
  ) {
    return {
      success: false,
      message: "Multi-format Studio exports are not queued yet. Choose Vertical 9:16 before preparing this clip.",
      results: [],
    };
  }

  const draftResult = await saveClipStudioDraftAction(input);
  if (!draftResult.success) {
    return draftResult;
  }

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: { status: "APPROVED" },
  });

  if (!canRunInlineMediaProcessing()) {
    try {
      const queued = await queueSermonMediaAssetJobs(clip.sermonId, undefined, { clipIds: [clip.id] });
      // The control panel cannot observe a Mac worker's in-memory queue. Keep
      // the durable clip state honest so a refresh shows "Preparing" and the
      // prepare button cannot enqueue the same composition repeatedly.
      await prisma.clipCandidate.update({
        where: { id: clip.id },
        data: {
          exportStatus: "QUEUED",
          exportError: null,
        },
      });
      revalidatePath(`/sermons/${clip.sermonId}`);
      revalidatePath(`/sermons/${clip.sermonId}/review`);
      revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
      revalidatePath("/ready-to-post");
      revalidatePath("/");

      return {
        success: true,
        draftSaved: true,
        queued: true,
        message: queued.queued > 0
          ? "Draft saved. Final video preparation was queued for your local worker."
          : "Draft saved. Final video preparation is already queued for your local worker.",
        results: [],
        warnings: draftResult.warnings,
      };
    } catch (error) {
      return {
        success: false,
        draftSaved: true,
        message: error instanceof Error
          ? `Draft saved, but the final video could not be queued: ${error.message}`
          : "Draft saved, but the final video could not be queued.",
        results: [],
        warnings: draftResult.warnings,
      };
    }
  }

  const renderResult = await renderClipStudioExportsAction({
    clipId: clip.id,
    selectedFormats: formatsToPrepare,
    forceRebuild: input.forceRebuild === true,
  });

  return {
    success: renderResult.success,
    draftSaved: true,
    message: renderResult.success
      ? "Prepared for posting using the current Studio draft."
      : `Draft saved. ${renderResult.message}`,
    results: renderResult.results,
    warnings: draftResult.warnings,
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
      sermonId: true,
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

  if (!canRunInlineMediaProcessing()) {
    if (record.format !== "VERTICAL_9_16") {
      return {
        success: false,
        message: "This multi-format export retry cannot be queued yet. Save the draft and prepare Vertical 9:16, or run the retry from the local development app.",
        results: [],
      };
    }
    const queued = await queueSermonMediaAssetJobs(clip.sermonId, undefined, {
      clipIds: [clip.id],
      force: true,
    });
    const retriedAt = new Date().toISOString();
    await updateClipStudioExportHistory(
      clip.id,
      markLatestExports(history.map((item) => item.id === record.id
        ? {
            ...item,
            status: "WAITING",
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            createdAt: retriedAt,
          }
        : item)),
    );

    revalidatePath(`/sermons/${clip.sermonId}`);
    revalidatePath(`/sermons/${clip.sermonId}/review`);
    revalidatePath(`/sermons/${clip.sermonId}/clips/${clip.id}/studio`);
    revalidatePath("/ready-to-post");
    revalidatePath("/");

    return {
      success: true,
      message: queued.queued > 0
        ? "Render retry was queued for your local worker."
        : "Render retry is already queued for your local worker.",
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["overlay"],
            operation: "Overlay render",
          }),
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

      if (!canRunInlineMediaProcessing()) {
        return {
          success: true,
          message: await queueClipMediaAssetAction({
            clipId: clip.id,
            sermonId: clip.sermonId,
            assets: ["overlay"],
            operation: "Overlay rerender",
            force: true,
            invalidate: {
              overlayFreshness: "NEEDS_REGENERATION",
              exportFreshness: "NEEDS_REGENERATION",
              assetInvalidationReason: "Overlay rerender requested.",
            },
          }),
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

export async function refreshBlockedClipProcessesAction(sermonIdInput: string): Promise<RegenerationBatchActionState> {
  const sermonId = sermonIdInput.trim();
  const emptyState = (success: boolean, message: string): RegenerationBatchActionState => ({
    success,
    message,
    attempted: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  });

  if (!sermonId) {
    return emptyState(false, "Missing sermon id for blocked-process refresh.");
  }

  const [sermon, jobs, clips] = await Promise.all([
    prisma.sermon.findUnique({ where: { id: sermonId }, select: { id: true } }),
    prisma.processingJob.findMany({
      where: { sermonId, status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true, type: true, status: true, updatedAt: true, heartbeatAt: true },
    }),
    prisma.clipCandidate.findMany({
      where: {
        sermonId,
        OR: [
          { renderStatus: { in: ["QUEUED", "RENDERING"] } },
          { captionStatus: "GENERATING" },
          { captionBurnStatus: "BURNING" },
          { overlayStatus: "RENDERING" },
          { exportStatus: { in: ["QUEUED", "EXPORTING"] } },
        ],
      },
      select: {
        id: true,
        updatedAt: true,
        renderStatus: true,
        captionStatus: true,
        captionBurnStatus: true,
        overlayStatus: true,
        exportStatus: true,
      },
    }),
  ]);

  if (!sermon) {
    return emptyState(false, "This sermon was not found. Refresh the page and try again.");
  }

  const activeJob = jobs.find((job) => !isStaleActiveProcessingJob(job));
  if (activeJob) {
    return emptyState(false, "A sermon job is still active, so no process was released. Wait for it to finish, then refresh this page.");
  }

  const staleJobs = jobs.filter((job) => isStaleActiveProcessingJob(job));
  const staleClips = clips
    .map((clip) => ({ clip, recovery: buildStaleClipOperationRecovery(clip) }))
    .filter((entry) => entry.recovery.operations.length > 0);

  if (staleJobs.length === 0 && staleClips.length === 0) {
    return emptyState(true, "No stale blocked processes were found. Any visible preparation is still within the safe processing window.");
  }

  return runOperationWithLogging<RegenerationBatchActionState>(
    { sermonId, operation: "refresh_blocked_processes" },
    async () => {
      const releasedJobIds: string[] = [];
      const releasedClipIds: string[] = [];

      for (const job of staleJobs) {
        await markJobFailed(
          job.id,
          "Marked as stale by Refresh blocked processes after more than two hours without a worker heartbeat.",
          "Released stale blocked process without retrying it.",
        );
        releasedJobIds.push(job.id);
      }

      for (const { clip, recovery } of staleClips) {
        const update = await prisma.clipCandidate.updateMany({
          where: {
            id: clip.id,
            updatedAt: { lte: clip.updatedAt },
            OR: [
              { renderStatus: { in: ["QUEUED", "RENDERING"] } },
              { captionStatus: "GENERATING" },
              { captionBurnStatus: "BURNING" },
              { overlayStatus: "RENDERING" },
              { exportStatus: { in: ["QUEUED", "EXPORTING"] } },
            ],
          },
          data: recovery.data,
        });
        if (update.count > 0) {
          releasedClipIds.push(clip.id);
        }
      }

      await appendPipelineLog(
        sermonId,
        `Refresh blocked processes released ${releasedJobIds.length} stale job(s) and ${releasedClipIds.length} stale clip operation(s). No retry was started.`,
      );
      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath(`/sermons/${sermonId}/review`);
      revalidatePath("/ready-to-post");
      revalidatePath("/");

      const attempted = staleJobs.length + staleClips.length;
      const completed = releasedJobIds.length + releasedClipIds.length;
      const skipped = attempted - completed;
      return {
        success: true,
        message: completed === 0
          ? "The blocked-process check found only work that had changed since the page loaded, so nothing was released. Refresh the page to see its current state."
          : `Released ${completed} stale blocked process${completed === 1 ? "" : "es"}. Nothing was retried automatically; you can now redo clips or use the normal retry action.`,
        attempted,
        completed,
        skipped,
        failed: 0,
        failures: [],
      };
    },
  );
}

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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(clip.sermonId, assets, {
      clipIds: [clip.id],
      force: true,
    });
    await appendPipelineLog(
      clip.sermonId,
      `Queued local-worker regeneration for clip ${clip.id}. Assets: ${assets.join(", ")}. Jobs: ${queued.jobTypes.join(", ")}.`,
    );
    await revalidateClipPaths(clip.id, clip.sermonId);

    return {
      success: true,
      message: queued.queued > 0
        ? `Media rebuild queued for your local worker (${queued.jobTypes.join(", ")}). Keep the Mac media worker running.`
        : `Media rebuild is already queued for your local worker (${queued.jobTypes.join(", ")}).`,
    };
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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(normalizedSermonId);
    await appendPipelineLog(
      normalizedSermonId,
      `Queued local-worker batch regeneration. Jobs: ${queued.jobTypes.join(", ")}.`,
    );
    revalidatePath(`/sermons/${normalizedSermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: queued.queued > 0
        ? `Media rebuild queued for your local worker (${queued.jobTypes.join(", ")}). Keep the Mac media worker running.`
        : `Media rebuild is already queued for your local worker (${queued.jobTypes.join(", ")}).`,
      attempted: queued.jobTypes.length,
      completed: 0,
      skipped: queued.reused,
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

  if (!canRunInlineMediaProcessing()) {
    const queued = await queueSermonMediaAssetJobs(normalizedSermonId, ["caption", "captionBurn"]);
    await appendPipelineLog(
      normalizedSermonId,
      `Queued local-worker caption regeneration. Jobs: ${queued.jobTypes.join(", ")}.`,
    );
    revalidatePath(`/sermons/${normalizedSermonId}`);
    revalidatePath("/");

    return {
      success: true,
      message: queued.queued > 0
        ? `Caption rebuild queued for your local worker (${queued.jobTypes.join(", ")}). Keep the Mac media worker running.`
        : `Caption rebuild is already queued for your local worker (${queued.jobTypes.join(", ")}).`,
      attempted: queued.jobTypes.length,
      completed: 0,
      skipped: queued.reused,
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

  if (!canRunInlineMediaProcessing()) {
    const staleClips = clips.filter((clip) => clip.exportFreshness !== "UP_TO_DATE");
    if (staleClips.length === 0) {
      return {
        success: true,
        message: "All downloads are already up to date.",
        attempted: clips.length,
        completed: 0,
        skipped: clips.length,
        failed: 0,
        failures: [],
      };
    }

    const queued = await queueSermonMediaAssetJobs(normalizedSermonId, ["export"], {
      clipIds: staleClips.map((clip) => clip.id),
      force: true,
    });
    await appendPipelineLog(
      normalizedSermonId,
      `Queued export regeneration for ${staleClips.length} clip(s). Jobs: ${queued.jobTypes.join(", ")}.`,
    );
    revalidatePath(`/sermons/${normalizedSermonId}`);
    revalidatePath("/");
    return {
      success: true,
      message: queued.queued > 0
        ? `Recreating ${staleClips.length} download(s) in the media worker.`
        : "Download recreation is already queued in the media worker.",
      attempted: staleClips.length,
      completed: 0,
      skipped: clips.length - staleClips.length,
      failed: 0,
      failures: [],
    };
  }

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
