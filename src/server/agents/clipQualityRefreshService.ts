import type { ClipExportLayoutStrategy } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  reviewClipQualityCandidates,
  type ClipQualityCandidateInput,
  type ClipQualityReviewedCandidate,
} from "@/server/agents/clipQualityReviewService";
import { refreshClipVisualQuality } from "@/server/agents/clipVisualQualityService";
import { refreshVideoSubjectTracking } from "@/server/agents/videoSubjectTrackingService";
import {
  scoreProfessionalClipQuality,
  type ProfessionalQualityFields,
} from "@/server/agents/clipQualityScoringService";

export type ClipQualityRefreshMode = "missing" | "force";

export type ClipQualityRefreshFailure = {
  clipId: string;
  reason: string;
};

export type ClipQualityRefreshSummary = {
  clipsFound: number;
  clipsRefreshed: number;
  clipsSkipped: number;
  clipsFailed: number;
  fallbackReviews: number;
  failures: ClipQualityRefreshFailure[];
};

export type RefreshableClip = {
  id: string;
  sermonId: string;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  title: string;
  hook: string;
  caption: string;
  score: number;
  transcriptText: string;
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
  durationSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReasons: unknown;
  contextWarning: boolean;
  clipType: string;
  smartClipCategory: string | null;
  ministryValue: string | null;
  socialValue: string | null;
  intendedAudience: string | null;
  reasonSelected: string;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
  boundaryAdjustmentReason: string | null;
  visualReadinessScore: number | null;
  renderStatus?: string | null;
  captionData?: unknown;
  audioQualityScore?: number | null;
  averageLoudness?: number | null;
  peakLoudness?: number | null;
  silenceAtBeginningSeconds?: number | null;
  silenceAtEndSeconds?: number | null;
  audioWarnings?: unknown;
  completenessScore?: number | null;
  completenessAction?: string | null;
  completenessWarnings?: unknown;
  qualityReviewedAt: Date | null;
  overallPostScore: number | null;
  recommendedAction: string | null;
  qualitySummary: string | null;
  pastorFriendlyReason: string | null;
  qualityClipCategory: string | null;
  qualityWarnings: unknown;
  exportLayoutStrategy: ClipExportLayoutStrategy | null;
  videoSubjectTracks: Array<{ id: string }>;
};

type ClipQualityRefreshDependencies = {
  reviewCandidates: (
    candidates: ClipQualityCandidateInput[],
    options?: { rawResponseOverride?: string; bypassCache?: boolean; sermonId?: string },
  ) => Promise<Array<ClipQualityReviewedCandidate<ClipQualityCandidateInput>>>;
  refreshVisualQuality: typeof refreshClipVisualQuality;
  refreshTracking: typeof refreshVideoSubjectTracking;
  scoreProfessionalQuality: typeof scoreProfessionalClipQuality;
  updateClipQuality: (clipId: string, reviewed: ClipQualityReviewedCandidate<ClipQualityCandidateInput>, professional: ProfessionalQualityFields) => Promise<void>;
};

const defaultDependencies: ClipQualityRefreshDependencies = {
  reviewCandidates: reviewClipQualityCandidates,
  refreshVisualQuality: refreshClipVisualQuality,
  refreshTracking: refreshVideoSubjectTracking,
  scoreProfessionalQuality: scoreProfessionalClipQuality,
  updateClipQuality: async (clipId, reviewed, professional) => {
    await prisma.clipCandidate.update({
      where: { id: clipId },
      data: {
        hookStrengthScore: reviewed.hookStrengthScore,
        standaloneClarityScore: reviewed.standaloneClarityScore,
        emotionalImpactScore: reviewed.emotionalImpactScore,
        sermonValueScore: reviewed.sermonValueScore,
        shareabilityScore: reviewed.shareabilityScore,
        contextSafetyScore: reviewed.contextSafetyScore,
        boundaryQualityScore: reviewed.boundaryQualityScore,
        visualReadinessScore: reviewed.visualReadinessScore,
        overallPostScore: reviewed.overallPostScore,
        qualitySummary: reviewed.qualitySummary,
        pastorFriendlyReason: reviewed.pastorFriendlyReason,
        recommendedAction: reviewed.recommendedAction,
        suggestedStartTimeSeconds: reviewed.suggestedStartTimeSeconds,
        suggestedEndTimeSeconds: reviewed.suggestedEndTimeSeconds,
        qualityClipCategory: reviewed.qualityClipCategory,
        qualityWarnings: reviewed.qualityWarnings,
        qualityReviewedAt: reviewed.qualityReviewedAt,
        qualityReviewSource: reviewed.qualityReviewSource,
        hookScore: professional.hookScore,
        hookType: professional.hookType,
        hookProblem: professional.hookProblem,
        suggestedStartAdjustment: professional.suggestedStartAdjustment,
        hookReason: professional.hookReason,
        arcCompletenessScore: professional.arcCompletenessScore,
        clipArcType: professional.clipArcType,
        arcSummary: professional.arcSummary,
        setupStartTime: professional.setupStartTime,
        mainPointTime: professional.mainPointTime,
        payoffTime: professional.payoffTime,
        applicationTime: professional.applicationTime,
        whyThisClipFeelsComplete: professional.whyThisClipFeelsComplete,
        whatContextMightBeMissing: professional.whatContextMightBeMissing,
        emotionalWeightScore: professional.emotionalWeightScore,
        ministryValueScore: professional.ministryValueScore,
        visualConfidenceScore: professional.visualConfidenceScore,
        socialShareabilityScore: professional.socialShareabilityScore,
        audioQualityScore: professional.audioQualityScore,
        averageLoudness: professional.averageLoudness,
        peakLoudness: professional.peakLoudness,
        silenceAtBeginningSeconds: professional.silenceAtBeginningSeconds,
        silenceAtEndSeconds: professional.silenceAtEndSeconds,
        audioWarnings: professional.audioWarnings,
        captionQualityScore: professional.captionQualityScore,
        captionQualityWarnings: professional.captionQualityWarnings,
        durationQualityScore: professional.durationQualityScore,
        durationQualityLabel: professional.durationQualityLabel,
        finalQualityScore: professional.finalQualityScore,
        qualityLabel: professional.qualityLabel,
        qualityReasons: professional.qualityReasons,
        rankingCategory: professional.rankingCategory,
        bestPlatform: professional.bestPlatform,
        postReadyStatus: professional.postReadyStatus,
        postReadyReasons: professional.postReadyReasons,
        postReadyBlockers: professional.postReadyBlockers,
        recommendedNextAction: professional.recommendedNextAction,
      },
    });
  },
};

function hasQualityData(clip: Pick<RefreshableClip, "overallPostScore" | "qualityReviewedAt" | "recommendedAction" | "qualitySummary" | "pastorFriendlyReason" | "qualityClipCategory">): boolean {
  return Boolean(
    clip.overallPostScore !== null &&
    clip.qualityReviewedAt &&
    clip.recommendedAction &&
    clip.qualitySummary &&
    clip.pastorFriendlyReason &&
    clip.qualityClipCategory,
  );
}

export function shouldRefreshClipQuality(clip: Pick<RefreshableClip, "overallPostScore" | "qualityReviewedAt" | "recommendedAction" | "qualitySummary" | "pastorFriendlyReason" | "qualityClipCategory">, mode: ClipQualityRefreshMode = "missing"): boolean {
  if (mode === "force") {
    return true;
  }

  return !hasQualityData(clip);
}

function normalizeRiskReasons(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function hasEnoughClipData(clip: RefreshableClip): boolean {
  return Boolean(
    clip.transcriptText.trim() &&
    clip.hook.trim() &&
    clip.caption.trim() &&
    clip.reasonSelected.trim(),
  );
}

function toQualityInput(clip: RefreshableClip): ClipQualityCandidateInput {
  return {
    title: clip.title,
    hook: clip.hook,
    caption: clip.caption,
    score: clip.score,
    transcriptText: clip.transcriptText,
    durationSeconds: clip.durationSeconds,
    startTimeSeconds: clip.startTimeSeconds,
    endTimeSeconds: clip.endTimeSeconds,
    riskLevel: clip.riskLevel,
    riskReasons: normalizeRiskReasons(clip.riskReasons),
    contextWarning: clip.contextWarning,
    clipType: (clip.clipType || "pastoral") as ClipQualityCandidateInput["clipType"],
    smartClipCategory: (clip.smartClipCategory ?? "Best Encouragement Clip") as ClipQualityCandidateInput["smartClipCategory"],
    ministryValue: clip.ministryValue ?? "Useful sermon moment for the church audience.",
    socialValue: clip.socialValue ?? "Potential short-form sermon clip.",
    intendedAudience: clip.intendedAudience ?? "Church members and online viewers",
    reasonSelected: clip.reasonSelected,
    boundaryQuality: clip.boundaryQuality,
    boundaryAdjustmentReason: clip.boundaryAdjustmentReason,
    visualReadinessScore: clip.visualReadinessScore,
    completenessScore: clip.completenessScore,
    completenessAction: clip.completenessAction,
    completenessWarnings: normalizeStringArray(clip.completenessWarnings),
  };
}

async function maybeRefreshTracking(clip: RefreshableClip, dependencies: ClipQualityRefreshDependencies): Promise<void> {
  if (clip.exportLayoutStrategy !== "SMART_CROP" || clip.videoSubjectTracks.length > 0) {
    return;
  }

  await dependencies.refreshTracking(clip.id);
}

export async function refreshClipQualityRecords(input: {
  clips: RefreshableClip[];
  mode?: ClipQualityRefreshMode;
  dependencies?: Partial<ClipQualityRefreshDependencies>;
}): Promise<ClipQualityRefreshSummary> {
  const mode = input.mode ?? "missing";
  const dependencies: ClipQualityRefreshDependencies = {
    ...defaultDependencies,
    ...input.dependencies,
  };

  const failures: ClipQualityRefreshFailure[] = [];
  let clipsRefreshed = 0;
  let clipsSkipped = 0;
  let fallbackReviews = 0;
  const prepared: Array<{
    clip: RefreshableClip;
    qualityInput: ClipQualityCandidateInput;
    visualRefresh: Awaited<ReturnType<typeof refreshClipVisualQuality>>;
  }> = [];

  for (const clip of input.clips) {
    if (!shouldRefreshClipQuality(clip, mode)) {
      clipsSkipped += 1;
      continue;
    }

    if (!hasEnoughClipData(clip)) {
      clipsSkipped += 1;
      failures.push({ clipId: clip.id, reason: "Clip is missing transcript, hook, caption, or selection reason." });
      continue;
    }

    try {
      await maybeRefreshTracking(clip, dependencies);
      const visualRefresh = await dependencies.refreshVisualQuality(clip.id);
      prepared.push({
        clip,
        visualRefresh,
        qualityInput: {
          ...toQualityInput(clip),
          visualReadinessScore: visualRefresh?.visualReadinessScore ?? clip.visualReadinessScore,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown quality refresh error.";
      failures.push({ clipId: clip.id, reason });
    }
  }

  const reviewBatchSize = 8;
  for (let batchStart = 0; batchStart < prepared.length; batchStart += reviewBatchSize) {
    const batch = prepared.slice(batchStart, batchStart + reviewBatchSize);
    let reviewedBatch: Array<ClipQualityReviewedCandidate<ClipQualityCandidateInput> | undefined>;
    const individuallyFailedIndexes = new Set<number>();
    try {
      reviewedBatch = await dependencies.reviewCandidates(
        batch.map((entry) => entry.qualityInput),
        { bypassCache: mode === "force", sermonId: batch[0]?.clip.sermonId },
      );
    } catch (error) {
      // A malformed candidate should not block the rest of a batch. Retry only
      // this failed batch one-by-one to isolate the bad item.
      reviewedBatch = [];
      for (const [index, entry] of batch.entries()) {
        try {
          const [reviewed] = await dependencies.reviewCandidates(
            [entry.qualityInput],
            { bypassCache: mode === "force", sermonId: entry.clip.sermonId },
          );
          reviewedBatch.push(reviewed);
        } catch (individualError) {
          individuallyFailedIndexes.add(index);
          const reason = individualError instanceof Error
            ? individualError.message
            : error instanceof Error ? error.message : "Unknown quality review error.";
          failures.push({ clipId: entry.clip.id, reason });
          reviewedBatch.push(undefined);
        }
      }
    }

    for (const [index, entry] of batch.entries()) {
      const reviewed = reviewedBatch[index];
      if (!reviewed) {
        if (!individuallyFailedIndexes.has(index)) {
          failures.push({ clipId: entry.clip.id, reason: "Quality review did not return a result for this clip." });
        }
        continue;
      }

      try {
        const { clip, visualRefresh } = entry;
        const professional = dependencies.scoreProfessionalQuality({
          ...reviewed,
          transcriptSafetyStatus: clip.transcriptSafetyStatus,
          visualReadinessScore: visualRefresh?.visualReadinessScore ?? reviewed.visualReadinessScore,
          visualConfidenceScore: visualRefresh?.visualReadinessScore ?? undefined,
          visualQualityScore: visualRefresh?.visualQualityScore ?? undefined,
          qualityWarnings: visualRefresh?.qualityWarnings ?? normalizeStringArray(clip.qualityWarnings),
          renderStatus: clip.renderStatus,
          captionData: clip.captionData,
          audioQualityScore: clip.audioQualityScore,
          averageLoudness: clip.averageLoudness,
          peakLoudness: clip.peakLoudness,
          silenceAtBeginningSeconds: clip.silenceAtBeginningSeconds,
          silenceAtEndSeconds: clip.silenceAtEndSeconds,
          audioWarnings: normalizeStringArray(clip.audioWarnings),
          completenessScore: clip.completenessScore,
          completenessAction: clip.completenessAction,
          completenessWarnings: normalizeStringArray(clip.completenessWarnings),
        });

        await dependencies.updateClipQuality(clip.id, reviewed, professional);
        if (reviewed.qualityReviewSource === "FALLBACK") {
          fallbackReviews += 1;
        }
        clipsRefreshed += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown quality persistence error.";
        failures.push({ clipId: entry.clip.id, reason });
      }
    }
  }

  return {
    clipsFound: input.clips.length,
    clipsRefreshed,
    clipsSkipped,
    clipsFailed: failures.length,
    fallbackReviews,
    failures,
  };
}

export async function refreshSermonClipQuality(input: {
  sermonId: string;
  mode?: ClipQualityRefreshMode;
  dependencies?: Partial<ClipQualityRefreshDependencies>;
}): Promise<ClipQualityRefreshSummary> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      clipsFound: 0,
      clipsRefreshed: 0,
      clipsSkipped: 0,
      clipsFailed: 1,
      fallbackReviews: 0,
      failures: [{ clipId: "sermon", reason: "Missing sermon id." }],
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: { sermonId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sermonId: true,
      status: true,
      title: true,
      hook: true,
      caption: true,
      score: true,
      transcriptText: true,
      transcriptSafetyStatus: true,
      durationSeconds: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      riskLevel: true,
      riskReasons: true,
      contextWarning: true,
      clipType: true,
      smartClipCategory: true,
      ministryValue: true,
      socialValue: true,
      intendedAudience: true,
      reasonSelected: true,
      boundaryQuality: true,
      boundaryAdjustmentReason: true,
      visualReadinessScore: true,
      renderStatus: true,
      captionData: true,
      audioQualityScore: true,
      averageLoudness: true,
      peakLoudness: true,
      silenceAtBeginningSeconds: true,
      silenceAtEndSeconds: true,
      audioWarnings: true,
      completenessScore: true,
      completenessAction: true,
      completenessWarnings: true,
      overallPostScore: true,
      qualityReviewedAt: true,
      recommendedAction: true,
      qualitySummary: true,
      pastorFriendlyReason: true,
      qualityClipCategory: true,
      qualityWarnings: true,
      exportLayoutStrategy: true,
      videoSubjectTracks: {
        select: { id: true },
      },
    },
  });

  return refreshClipQualityRecords({
    clips,
    mode: input.mode,
    dependencies: input.dependencies,
  });
}

export const __clipQualityRefreshTestUtils = {
  hasEnoughClipData,
  hasQualityData,
  shouldRefreshClipQuality,
  toQualityInput,
};
