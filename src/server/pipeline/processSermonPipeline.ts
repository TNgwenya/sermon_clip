import type { SermonStatus } from "@prisma/client";

import { isLocalUploadSourceUrl } from "@/lib/sermonIntake";
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
  getAudioPath,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { downloadSermonVideo } from "@/server/agents/videoDownloadAgent";
import { extractSermonAudio } from "@/server/agents/audioExtractionAgent";
import { generateClipSuggestions } from "@/server/agents/clipIntelligenceAgent";
import { transcribeSermonAudio } from "@/server/agents/transcriptionAgent";
import { generateSermonIntelligence } from "@/server/agents/sermonIntelligenceService";
import { generateContentOpportunities } from "@/server/agents/contentMultiplicationService";
import { mediaFileIsUsable } from "@/server/media/fileGuards";
import {
  __clipReviewAssetServiceTestUtils,
  prepareGeneratedClipReviewAssets,
} from "@/server/agents/clipReviewAssetService";
import { updateSermonStatus } from "@/server/status/sermonStatus";

export type ProcessSermonPipelineOptions = {
  force?: boolean;
  parentJobId?: string;
};

type PipelineStepStatus = "SUCCEEDED" | "SKIPPED" | "FAILED";

type PipelineStepResult = {
  label: string;
  status: PipelineStepStatus;
  message: string;
};

type PipelineResult = {
  sermonId: string;
  sermonTitle: string;
  parentJobId: string;
  steps: PipelineStepResult[];
  summary: string;
};

class PipelinePartialCompletionError extends Error {
  readonly code = "PIPELINE_PARTIAL_FAILURE";
  readonly summary: string;
  readonly failedSteps: PipelineStepResult[];

  constructor(steps: PipelineStepResult[]) {
    const failedSteps = steps.filter((step) => step.status === "FAILED");
    const failedLabels = failedSteps.map((step) => step.label);
    const summary = [
      "Core sermon processing completed, but premium outputs need attention.",
      `Failed: ${failedLabels.join(", ")}.`,
      "The completed transcript and clips were preserved; retry only the failed steps.",
    ].join(" ");
    super(summary);
    this.name = "PipelinePartialCompletionError";
    this.summary = summary;
    this.failedSteps = failedSteps;
  }
}

const SERMON_STATUS_ORDER: SermonStatus[] = [
  "CREATED",
  "DOWNLOADING",
  "DOWNLOADED",
  "AUDIO_EXTRACTING",
  "AUDIO_EXTRACTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
  "FAILED",
];

function isAtOrAfter(currentStatus: SermonStatus, targetStatus: SermonStatus): boolean {
  if (currentStatus === "FAILED") {
    return false;
  }

  const currentIndex = SERMON_STATUS_ORDER.indexOf(currentStatus);
  const targetIndex = SERMON_STATUS_ORDER.indexOf(targetStatus);

  if (currentIndex === -1 || targetIndex === -1) {
    return false;
  }

  return currentIndex >= targetIndex;
}

async function loadSermon(sermonId: string) {
  return prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      status: true,
      youtubeUrl: true,
      sourceVideoPath: true,
      audioPath: true,
      transcriptJsonPath: true,
      transcript: {
        select: { id: true },
      },
      _count: {
        select: {
          transcriptSegments: true,
          clipCandidates: true,
        },
      },
    },
  });
}

function buildSummary(steps: PipelineStepResult[]): string {
  const ran = steps.filter((step) => step.status === "SUCCEEDED").map((step) => step.label);
  const skipped = steps.filter((step) => step.status === "SKIPPED").map((step) => step.label);

  return [
    "Process Sermon complete.",
    `Ran: ${ran.length > 0 ? ran.join(", ") : "none"}.`,
    `Skipped: ${skipped.length > 0 ? skipped.join(", ") : "none"}.`,
  ].join(" ");
}

function buildFailureSummary(steps: PipelineStepResult[], failedLabel: string, failureMessage: string): string {
  const ran = steps.filter((step) => step.status === "SUCCEEDED").map((step) => step.label);
  const skipped = steps.filter((step) => step.status === "SKIPPED").map((step) => step.label);

  return [
    `Pipeline stopped at ${failedLabel}: ${failureMessage}.`,
    `Ran: ${ran.length > 0 ? ran.join(", ") : "none"}.`,
    `Skipped: ${skipped.length > 0 ? skipped.join(", ") : "none"}.`,
  ].join(" ");
}

function shouldMarkParentJobRunning(input: {
  status: string;
  attemptCount: number;
}): boolean {
  return input.status !== "RUNNING" || input.attemptCount < 1;
}

export function shouldReuseExistingTranscript(input: {
  force?: boolean;
  transcriptId?: string | null;
  transcriptSegmentCount: number;
  clipCandidateCount: number;
  sermonStatus: SermonStatus;
}): boolean {
  return input.force !== true
    && Boolean(input.transcriptId)
    && input.transcriptSegmentCount > 0
    && (
      input.clipCandidateCount > 0
      || isAtOrAfter(input.sermonStatus, "TRANSCRIBED")
    );
}

export function isAdvancedSermonPipelineState(input: {
  sermonStatus: SermonStatus;
  clipCandidateCount: number;
}): boolean {
  return input.clipCandidateCount > 0
    || isAtOrAfter(input.sermonStatus, "CLIPS_GENERATED");
}

export function advancedSermonPipelineGuardMessage(input: {
  force?: boolean;
  sermonStatus: SermonStatus;
  clipCandidateCount: number;
}): string | null {
  const advanced = isAdvancedSermonPipelineState(input);
  if (input.force === true && advanced) {
    return "A forced full-pipeline rerun is not safe after clips or later pastor work exist. Use the dedicated repair or redo tools instead; a deliberate full-workflow rewind is not available yet.";
  }

  if (
    isAtOrAfter(input.sermonStatus, "CLIPS_GENERATED")
    && input.clipCandidateCount === 0
  ) {
    return "This sermon is marked as clips generated or later, but its clip records are missing. Repair the sermon data before retrying the full workflow; automatic clip generation was stopped to protect the advanced workflow state.";
  }

  return null;
}

export function advancedSermonMissingMediaMessage(input: {
  advanced: boolean;
  artifact: "source" | "audio";
  usable: boolean;
}): string | null {
  if (!input.advanced || input.usable) {
    return null;
  }

  return input.artifact === "source"
    ? "The saved source video is missing or unusable for this advanced sermon. Repair or re-upload the original media before retrying; the sermon workflow state was preserved."
    : "The saved sermon audio is missing or unusable for this advanced sermon. Repair the media assets before retrying; the sermon workflow state was preserved.";
}

export function shouldReuseDurableClipCandidates(input: {
  force?: boolean;
  sermonStatus: SermonStatus;
  clipCandidateCount: number;
}): boolean {
  return input.force !== true
    && input.clipCandidateCount > 0
    && (
      input.sermonStatus === "FAILED"
      || isAtOrAfter(input.sermonStatus, "CLIPS_GENERATED")
    );
}

export function incompleteLocalUploadMessage(): string {
  return "Upload incomplete. The recording was not fully saved on the server. Re-upload the video and keep this page open until Sermon Clip confirms that the upload has finished.";
}

export async function processSermonPipeline(
  sermonId: string,
  options?: ProcessSermonPipelineOptions,
): Promise<PipelineResult> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    throw new Error("Missing sermon id for processing.");
  }

  const sermon = await loadSermon(normalizedSermonId);
  if (!sermon) {
    throw new Error(`Sermon ${normalizedSermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id, sermon.title);

  const parentJob = options?.parentJobId
    ? await prisma.processingJob.findUnique({
        where: { id: options.parentJobId },
        select: {
          id: true,
          sermonId: true,
          type: true,
          status: true,
          attemptCount: true,
        },
      })
    : await createProcessingJob(sermon.id, "PROCESS_SERMON");
  if (!parentJob || parentJob.sermonId !== sermon.id || parentJob.type !== "PROCESS_SERMON") {
    throw new Error("The claimed processing job does not match this sermon pipeline.");
  }
  const steps: PipelineStepResult[] = [];
  let activeStepLabel = "Download video";

  // The media worker atomically claims PROCESS_SERMON jobs and increments their
  // attempt count before entering this pipeline. Do not count the same attempt
  // twice. Directly created or unclaimed parent jobs still transition here.
  if (shouldMarkParentJobRunning({
    status: parentJob.status,
    attemptCount: parentJob.attemptCount,
  })) {
    await markJobRunning(parentJob.id);
  }
  await appendJobLog(parentJob.id, `One-click sermon processing started for ${sermon.title}.`);
  await appendPipelineLog(sermon.id, "One-click sermon processing started.");

  try {
    const advancedAtStart = isAdvancedSermonPipelineState({
      sermonStatus: sermon.status,
      clipCandidateCount: sermon._count.clipCandidates,
    });
    const pipelineGuardMessage = advancedSermonPipelineGuardMessage({
      force: options?.force,
      sermonStatus: sermon.status,
      clipCandidateCount: sermon._count.clipCandidates,
    });
    if (pipelineGuardMessage) {
      activeStepLabel = "Protect existing sermon work";
      await appendJobLog(parentJob.id, pipelineGuardMessage);
      throw new Error(pipelineGuardMessage);
    }

    activeStepLabel = "Download video";
    const sourceVideoPath = getSourceVideoPath(sermon.id);
    const existingSource = await mediaFileIsUsable(sourceVideoPath);

    const sourceProtectionMessage = advancedSermonMissingMediaMessage({
      advanced: advancedAtStart,
      artifact: "source",
      usable: existingSource.usable,
    });
    if (sourceProtectionMessage) {
      activeStepLabel = "Repair source video";
      await appendJobLog(parentJob.id, sourceProtectionMessage);
      throw new Error(sourceProtectionMessage);
    }

    if (!existingSource.usable && isLocalUploadSourceUrl(sermon.youtubeUrl)) {
      activeStepLabel = "Upload media";
      const message = incompleteLocalUploadMessage();
      steps.push({ label: activeStepLabel, status: "FAILED", message });
      await appendJobLog(parentJob.id, message);
      await appendPipelineLog(sermon.id, message);
      throw new Error(message);
    }
    const downloadSkipped = !options?.force && existingSource.usable;

    if (!existingSource.usable && !options?.force && isAtOrAfter(sermon.status, "DOWNLOADED") && Boolean(sermon.sourceVideoPath)) {
      await appendJobLog(parentJob.id, `Download video will run again because source.mp4 is not usable: ${existingSource.reason}`);
    }

    if (downloadSkipped) {
      steps.push({ label: "Download video", status: "SKIPPED", message: "source.mp4 already exists." });
      await appendJobLog(parentJob.id, "Download video skipped.");
    } else {
      const downloadResult = await downloadSermonVideo(sermon.id, { force: options?.force });
      steps.push({
        label: "Download video",
        status: "SUCCEEDED",
        message: downloadResult.reusedExistingFile ? "Existing source.mp4 reused." : "Video downloaded.",
      });
      await appendJobLog(parentJob.id, "Download video completed.");
    }

    const afterDownload = await loadSermon(sermon.id);
    if (!afterDownload) {
      throw new Error(`Sermon ${sermon.id} disappeared during processing.`);
    }

    activeStepLabel = "Extract audio";
    const audioPath = getAudioPath(sermon.id);
    const existingAudio = await mediaFileIsUsable(audioPath);

    const audioProtectionMessage = advancedSermonMissingMediaMessage({
      advanced: advancedAtStart,
      artifact: "audio",
      usable: existingAudio.usable,
    });
    if (audioProtectionMessage) {
      activeStepLabel = "Repair sermon audio";
      await appendJobLog(parentJob.id, audioProtectionMessage);
      throw new Error(audioProtectionMessage);
    }
    const audioSkipped = !options?.force && existingAudio.usable;

    if (!existingAudio.usable && !options?.force && isAtOrAfter(afterDownload.status, "AUDIO_EXTRACTED") && Boolean(afterDownload.audioPath)) {
      await appendJobLog(parentJob.id, `Extract audio will run again because audio.mp3 is not usable: ${existingAudio.reason}`);
    }

    if (audioSkipped) {
      steps.push({ label: "Extract audio", status: "SKIPPED", message: "audio.mp3 already exists." });
      await appendJobLog(parentJob.id, "Extract audio skipped.");
    } else {
      const extractResult = await extractSermonAudio(sermon.id, { force: options?.force });
      steps.push({
        label: "Extract audio",
        status: "SUCCEEDED",
        message: extractResult.reusedExistingFile ? "Existing audio.mp3 reused." : "Audio extracted.",
      });
      await appendJobLog(parentJob.id, "Extract audio completed.");
    }

    const afterAudio = await loadSermon(sermon.id);
    if (!afterAudio) {
      throw new Error(`Sermon ${sermon.id} disappeared during processing.`);
    }

    activeStepLabel = "Transcribe audio";
    const transcriptSkipped = shouldReuseExistingTranscript({
      force: options?.force,
      transcriptId: afterAudio.transcript?.id,
      transcriptSegmentCount: afterAudio._count.transcriptSegments,
      clipCandidateCount: afterAudio._count.clipCandidates,
      sermonStatus: afterAudio.status,
    });
    if (transcriptSkipped) {
      steps.push({
        label: "Transcribe audio",
        status: "SKIPPED",
        message: "Existing transcript and timed segments reused.",
      });
      await appendJobLog(parentJob.id, "Transcribe audio skipped because a usable transcript already exists.");
    } else {
      const transcribeResult = await transcribeSermonAudio(sermon.id, { force: options?.force });
      steps.push({
        label: "Transcribe audio",
        status: "SUCCEEDED",
        message: transcribeResult.reusedExistingTranscript ? "Existing transcript reused." : "Audio transcribed.",
      });
      await appendJobLog(parentJob.id, "Transcribe audio completed.");
    }

    const afterTranscript = await loadSermon(sermon.id);
    if (!afterTranscript) {
      throw new Error(`Sermon ${sermon.id} disappeared during processing.`);
    }

    // Generate sermon intelligence immediately after transcription so clip selection can reuse it.
    if (afterTranscript.transcript?.id) {
      activeStepLabel = "Generate sermon intelligence";
      const intelligenceResult = await generateSermonIntelligence(sermon.id, {
        force: options?.force,
        parentJobId: parentJob.id,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return { intelligenceId: sermon.id, status: "FAILED" as const, failureReason: msg };
      });

      steps.push({
        label: "Generate sermon intelligence",
        status: intelligenceResult.status === "COMPLETED" ? "SUCCEEDED" : "FAILED",
        message: intelligenceResult.status === "COMPLETED"
          ? "Sermon intelligence generated."
          : `Intelligence generation skipped or failed: ${intelligenceResult.failureReason ?? "unknown"}.`,
      });
      await appendJobLog(parentJob.id, `Sermon intelligence: ${intelligenceResult.status}.`);
    }

    const afterIntelligence = await loadSermon(sermon.id);
    if (!afterIntelligence) {
      throw new Error(`Sermon ${sermon.id} disappeared during processing.`);
    }

    activeStepLabel = "Generate clip suggestions";
    const clipGuardMessage = advancedAtStart && afterIntelligence._count.clipCandidates === 0
      ? "This advanced sermon no longer has durable clip records. Repair the sermon data before retrying; automatic clip generation was stopped to preserve the workflow state."
      : advancedSermonPipelineGuardMessage({
          force: options?.force,
          sermonStatus: afterIntelligence.status,
          clipCandidateCount: afterIntelligence._count.clipCandidates,
        });
    if (clipGuardMessage) {
      await appendJobLog(parentJob.id, clipGuardMessage);
      throw new Error(clipGuardMessage);
    }

    const clipsReused = shouldReuseDurableClipCandidates({
      force: options?.force,
      sermonStatus: afterIntelligence.status,
      clipCandidateCount: afterIntelligence._count.clipCandidates,
    });
    if (clipsReused) {
      if (afterIntelligence.status === "FAILED") {
        await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
      }
      steps.push({
        label: "Generate clip suggestions",
        status: "SKIPPED",
        message: `Existing durable clip suggestions reused (${afterIntelligence._count.clipCandidates} available).`,
      });
      await appendJobLog(parentJob.id, "Generate clip suggestions skipped because durable clips already exist.");
    } else {
      const clipResult = await generateClipSuggestions(sermon.id, { force: options?.force });
      steps.push({
        label: "Generate clip suggestions",
        status: "SUCCEEDED",
        message: clipResult.reusedExistingSuggestions ? "Existing clip suggestions reused." : `Generated ${clipResult.clipCount} clip suggestions.`,
      });
      await appendJobLog(parentJob.id, "Generate clip suggestions completed.");
    }

    activeStepLabel = "Prepare generated clip review assets";
    const previewResult = await prepareGeneratedClipReviewAssets({ sermonId: sermon.id, force: options?.force });
    steps.push({
      label: "Prepare generated clip review assets",
      status: previewResult.failed === 0 ? "SUCCEEDED" : "FAILED",
      message: `Prepared ${previewResult.prepared} preview video asset(s); ${previewResult.skipped} already ready or in progress; ${previewResult.failed} failed. Caption files are created after approval.`,
    });
    await appendJobLog(
      parentJob.id,
      `Generated clip review asset preparation complete: ${previewResult.prepared} prepared, ${previewResult.skipped} skipped, ${previewResult.failed} failed.`,
    );

    try {
      activeStepLabel = "Generate content opportunities";
      const contentResult = await generateContentOpportunities(sermon.id, { force: options?.force });
      steps.push({
        label: "Generate content opportunities",
        status: contentResult.reusedExistingOpportunities ? "SKIPPED" : "SUCCEEDED",
        message: contentResult.reusedExistingOpportunities
          ? "Existing content opportunities reused."
          : `Generated ${contentResult.opportunityCount} content opportunities.`,
      });
      await appendJobLog(parentJob.id, "Generate content opportunities completed.");
    } catch (contentError) {
      const message = contentError instanceof Error ? contentError.message : "Unknown content opportunity generation error.";
      steps.push({
        label: "Generate content opportunities",
        status: "FAILED",
        message: `Failed: ${message}`,
      });
      await appendJobLog(parentJob.id, `Generate content opportunities skipped: ${message}`);
      await appendPipelineLog(sermon.id, `Content opportunities generation skipped: ${message}`);
    }

    if (steps.some((step) => step.status === "FAILED")) {
      throw new PipelinePartialCompletionError(steps);
    }

    const summary = buildSummary(steps);
    await markJobSucceeded(parentJob.id, summary);
    await appendPipelineLog(sermon.id, summary);

    return {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      parentJobId: parentJob.id,
      steps,
      summary,
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : "Unknown sermon processing error.";
    const failedLabel = activeStepLabel;
    const partialFailure = error instanceof PipelinePartialCompletionError ? error : null;
    const summary = partialFailure?.summary ?? buildFailureSummary(steps, failedLabel, failureMessage);
    const statusAtFailure = partialFailure
      ? "CLIPS_GENERATED"
      : (await loadSermon(sermon.id))?.status;

    await markJobFailed(parentJob.id, failureMessage, summary, {
      error,
      code: partialFailure?.code ?? "PROCESS_SERMON_PIPELINE_FAILED",
      stage: partialFailure ? "premium_output_completion" : failedLabel,
      retryable: true,
      sermonStatus: statusAtFailure,
      details: partialFailure
        ? {
            completedCoreProcessing: true,
            failedSteps: partialFailure.failedSteps.map((step) => ({
              label: step.label,
              message: step.message,
            })),
          }
        : undefined,
    });
    await appendPipelineLog(sermon.id, summary);

    throw partialFailure ?? new Error(`Pipeline stopped at ${failedLabel}: ${failureMessage}`);
  }
}

export const __processSermonPipelineTestUtils = {
  shouldMarkParentJobRunning,
  shouldReuseExistingTranscript,
  isAdvancedSermonPipelineState,
  advancedSermonPipelineGuardMessage,
  advancedSermonMissingMediaMessage,
  shouldReuseDurableClipCandidates,
  incompleteLocalUploadMessage,
  PipelinePartialCompletionError,
  buildGeneratedClipReviewAssetPlan: (
    clip: Parameters<typeof __clipReviewAssetServiceTestUtils.shouldPreparePreview>[0],
    force?: boolean,
  ) => ({
    preparePreviewVideo: __clipReviewAssetServiceTestUtils.shouldPreparePreview(clip, force),
    prepareCaptionFile: false as const,
  }),
};
