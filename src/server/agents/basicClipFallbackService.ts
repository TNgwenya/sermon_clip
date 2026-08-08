import { Prisma } from "@prisma/client";

import { resolveClipReviewAcceptanceFloor, resolveClipVolumeTarget } from "@/lib/clipVolumeTargets";
import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobSucceeded,
} from "@/server/agents/processing";
import { appendPipelineLog, getSourceVideoPath } from "@/server/agents/storage";
import { getMediaDurationSeconds } from "@/server/media/ffmpeg";
import { updateSermonStatus } from "@/server/status/sermonStatus";

const BASIC_CLIP_TARGET_DURATION_SECONDS = 60;
const BASIC_CLIP_MIN_DURATION_SECONDS = 30;
const BASIC_CLIP_MAX_COUNT = 12;

export const BASIC_CLIP_FALLBACK_WARNING = "BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE";
export const BASIC_CLIP_REASON = [
  "Basic time-based clip created because Sermon Clip could not produce a reliable transcript.",
  "No transcript intelligence, message ranking, title generation, or sentence-boundary check was applied.",
  "Sermon Clip cannot guarantee the spoken words, meaning, context, or boundaries of this cut.",
  "Listen to the full cut and edit its title, timing, captions, and context in Clip Studio before approval.",
].join(" ");

export type BasicClipFallbackPlanItem = {
  title: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
};

export type BasicClipFallbackPlan = {
  windowStartSeconds: number;
  windowEndSeconds: number;
  clipCount: number;
  clips: BasicClipFallbackPlanItem[];
};

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function roundTimelineSeconds(value: number): number {
  return Number(value.toFixed(3));
}

export function buildBasicClipFallbackPlan(input: {
  sourceDurationSeconds: number;
  sermonStartSeconds?: number | null;
  sermonEndSeconds?: number | null;
  analyzeFullRecording?: boolean;
}): BasicClipFallbackPlan {
  const sourceDurationSeconds = finitePositive(input.sourceDurationSeconds);
  if (sourceDurationSeconds === null) {
    throw new Error("Basic clips could not be created because the recording duration is unavailable.");
  }

  const requestedStart = finitePositive(input.sermonStartSeconds) ?? 0;
  const requestedEnd = finitePositive(input.sermonEndSeconds) ?? sourceDurationSeconds;
  const windowStartSeconds = input.analyzeFullRecording
    ? 0
    : Math.min(requestedStart, sourceDurationSeconds);
  const windowEndSeconds = input.analyzeFullRecording
    ? sourceDurationSeconds
    : Math.min(Math.max(requestedEnd, windowStartSeconds), sourceDurationSeconds);
  const windowDurationSeconds = windowEndSeconds - windowStartSeconds;

  if (windowDurationSeconds < BASIC_CLIP_MIN_DURATION_SECONDS) {
    throw new Error("Basic clips could not be created because the selected sermon range is shorter than 30 seconds.");
  }

  const target = resolveClipVolumeTarget(windowDurationSeconds);
  const desiredCount = Math.min(
    BASIC_CLIP_MAX_COUNT,
    resolveClipReviewAcceptanceFloor(target.minReviewSuggestions),
  );
  const clipCount = Math.max(
    1,
    Math.min(desiredCount, Math.floor(windowDurationSeconds / BASIC_CLIP_MIN_DURATION_SECONDS)),
  );
  const slotDurationSeconds = windowDurationSeconds / clipCount;
  const clipDurationSeconds = Math.min(BASIC_CLIP_TARGET_DURATION_SECONDS, slotDurationSeconds);

  const clips = Array.from({ length: clipCount }, (_, index) => {
    const slotStartSeconds = windowStartSeconds + (slotDurationSeconds * index);
    const startTimeSeconds = slotStartSeconds + ((slotDurationSeconds - clipDurationSeconds) / 2);
    const endTimeSeconds = Math.min(windowEndSeconds, startTimeSeconds + clipDurationSeconds);

    return {
      title: `Basic clip ${String(index + 1).padStart(2, "0")}`,
      startTimeSeconds: roundTimelineSeconds(startTimeSeconds),
      endTimeSeconds: roundTimelineSeconds(endTimeSeconds),
      durationSeconds: roundTimelineSeconds(endTimeSeconds - startTimeSeconds),
    };
  });

  return {
    windowStartSeconds: roundTimelineSeconds(windowStartSeconds),
    windowEndSeconds: roundTimelineSeconds(windowEndSeconds),
    clipCount,
    clips,
  };
}

function toClipCreateInput(
  sermonId: string,
  clip: BasicClipFallbackPlanItem,
  transcriptFailureReason: string,
): Prisma.ClipCandidateCreateManyInput {
  const reviewReasons = [
    "TRANSCRIPT_UNAVAILABLE",
    "NO_CONTENT_INTELLIGENCE",
    "TIME_BASED_BOUNDARIES",
  ];
  const blockers = [
    "No reliable transcript is available.",
    "No content intelligence or message-quality review was applied.",
    "Edit the title, start and end times, captions, and context in Clip Studio before approval.",
  ];

  return {
    sermonId,
    contentKind: "SERMON",
    isAiGenerated: false,
    isManuallyEdited: false,
    startTimeSeconds: clip.startTimeSeconds,
    endTimeSeconds: clip.endTimeSeconds,
    durationSeconds: clip.durationSeconds,
    originalStartTimeSeconds: clip.startTimeSeconds,
    originalEndTimeSeconds: clip.endTimeSeconds,
    boundaryAdjustmentReason: "Time-based fallback only. Start and end times were not aligned to sentences or sermon meaning; adjust both in Clip Studio.",
    boundaryQuality: "NEEDS_REVIEW",
    completenessAction: "NEEDS_REVIEW",
    completenessReason: "Completeness could not be assessed without a reliable transcript.",
    completenessWarnings: ["TRANSCRIPT_UNAVAILABLE", "TIME_BASED_BOUNDARIES"],
    completenessReviewedAt: new Date(),
    completenessReviewSource: "FALLBACK",
    rawAiCandidate: Prisma.JsonNull,
    qualityDebugSnapshot: {
      fallback: {
        kind: "BASIC_TIME_BASED_CLIP",
        transcriptFailureReason,
        intelligenceApplied: false,
      },
    },
    transcriptText: "",
    transcriptSafetyStatus: "REVIEW_REQUIRED",
    transcriptSafetyReasons: reviewReasons,
    title: clip.title,
    hook: "",
    caption: "",
    hashtags: [],
    score: 0,
    reasonSelected: BASIC_CLIP_REASON,
    clipType: "basic",
    riskLevel: "HIGH",
    riskReasons: reviewReasons,
    contextWarning: true,
    qualityLabel: "NEEDS_EDITING",
    postReadyStatus: "NEEDS_EDITING",
    postReadyReasons: ["Basic time-based cut only"],
    postReadyBlockers: blockers,
    recommendedNextAction: "REVIEW_CLIP",
    qualitySummary: "Basic time-based cut only. Content quality and context were not assessed.",
    pastorFriendlyReason: BASIC_CLIP_REASON,
    recommendedAction: "NEEDS_REVIEW",
    qualityClipCategory: "GENERAL",
    qualityWarnings: [
      BASIC_CLIP_FALLBACK_WARNING,
      "FALLBACK_REVIEW",
      "TRANSCRIPT_UNAVAILABLE",
      "TIME_BASED_BOUNDARIES",
      "CONTEXT_RISK",
    ],
    qualityReviewedAt: new Date(),
    qualityReviewSource: "FALLBACK",
    exportLayoutStrategy: "CENTER_CROP",
    status: "SUGGESTED",
  };
}

export async function generateBasicFallbackClips(input: {
  sermonId: string;
  transcriptFailureReason: string;
}): Promise<{ clipCount: number; reusedExistingSuggestions: boolean; plan: BasicClipFallbackPlan }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: input.sermonId },
    select: {
      id: true,
      sourceDurationSeconds: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
    },
  });
  if (!sermon) {
    throw new Error(`Sermon ${input.sermonId} was not found while creating basic clips.`);
  }

  const sourceDurationSeconds = finitePositive(sermon.sourceDurationSeconds)
    ?? await getMediaDurationSeconds(getSourceVideoPath(sermon.id));
  const plan = buildBasicClipFallbackPlan({
    sourceDurationSeconds,
    sermonStartSeconds: sermon.sermonStartSeconds,
    sermonEndSeconds: sermon.sermonEndSeconds,
    analyzeFullRecording: sermon.analyzeFullRecording,
  });
  const job = await createProcessingJob(sermon.id, "GENERATE_CLIPS", {
    generationSummary: {
      mode: "BASIC_TRANSCRIPTION_FALLBACK",
      intelligenceApplied: false,
      transcriptFailureReason: input.transcriptFailureReason,
      requestedClipCount: plan.clipCount,
    },
  });

  try {
    const existingBasicClipCount = await prisma.clipCandidate.count({
      where: {
        sermonId: sermon.id,
        isAiGenerated: false,
        isManuallyEdited: false,
        clipType: "basic",
        title: { startsWith: "Basic clip " },
        status: { not: "REJECTED" },
      },
    });

    await updateSermonStatus(sermon.id, "GENERATING_CLIPS");
    if (existingBasicClipCount > 0) {
      await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
      await markJobSucceeded(job.id, `Reused ${existingBasicClipCount} existing basic time-based clip(s). No content intelligence was applied.`);
      return { clipCount: existingBasicClipCount, reusedExistingSuggestions: true, plan };
    }

    await prisma.clipCandidate.createMany({
      data: plan.clips.map((clip) => toClipCreateInput(sermon.id, clip, input.transcriptFailureReason)),
    });
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        generationSummary: {
          mode: "BASIC_TRANSCRIPTION_FALLBACK",
          intelligenceApplied: false,
          transcriptFailureReason: input.transcriptFailureReason,
          clipCount: plan.clipCount,
          windowStartSeconds: plan.windowStartSeconds,
          windowEndSeconds: plan.windowEndSeconds,
        },
      },
    });
    await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
    const successMessage = `Created ${plan.clipCount} basic time-based clip(s). No transcript intelligence, message ranking, titles, captions, or sentence-boundary checks were applied.`;
    await appendJobLog(job.id, successMessage);
    await markJobSucceeded(job.id);
    await appendPipelineLog(sermon.id, `${successMessage} Every clip requires Clip Studio editing and pastor review.`);

    return { clipCount: plan.clipCount, reusedExistingSuggestions: false, plan };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown basic clip fallback error.";
    await markJobFailed(job.id, message, "Basic time-based clip generation failed.", {
      error,
      code: "BASIC_CLIP_FALLBACK_FAILED",
      stage: "basic_clip_generation",
      retryable: true,
      sermonStatus: "GENERATING_CLIPS",
      details: { transcriptFailureReason: input.transcriptFailureReason },
    });
    try {
      await updateSermonStatus(sermon.id, "FAILED");
    } catch {
      // Preserve the original fallback failure when status reporting also fails.
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
