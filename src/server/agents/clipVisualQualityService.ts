import { access, stat } from "node:fs/promises";

import type { ClipExportLayoutStrategy, ClipRenderStatus, VideoSubjectTrackKind, VideoSubjectTrackingSource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  calculateOverallPostScore,
  type ClipBoundaryQuality,
  type ClipQualityRecommendedAction,
  type ClipRiskLevel,
} from "@/server/agents/clipQualityReviewService";
import {
  getMediaDimensions,
  getMediaDurationSeconds,
  hasAudioStream,
} from "@/server/media/ffmpeg";
import { reviewPostReady } from "@/server/agents/postReadyReviewService";
import {
  probeAudioQuality,
  type AudioQualityResult,
} from "@/server/agents/audioQualityScoringService";
import {
  parseCaptionDataCues,
  validateCaptionQuality,
} from "@/server/agents/captionQualityValidationService";

export const VISUAL_QUALITY_WARNING_CODES = [
  "LOW_TRACKING_CONFIDENCE",
  "HEURISTIC_TRACKING_USED",
  "MISSING_BODY_TRACK",
  "LOW_SAMPLE_COUNT",
  "RENDER_MISSING",
  "RENDER_FAILED",
  "OUTPUT_DURATION_MISMATCH",
  "OUTPUT_DIMENSION_MISMATCH",
  "AUDIO_MISSING",
  "OUTPUT_FILE_TOO_SMALL",
  "SMART_CROP_UNSTABLE",
  "SMART_CROP_REVIEW_RECOMMENDED",
  "POSSIBLE_WRONG_PERSON",
  "CROP_JUMP_DETECTED",
  "SPEAKER_NOT_VISIBLE_ENOUGH",
  "STATIC_CENTER_CROP_USED",
  "MANUAL_CROP_RECOMMENDED",
] as const;

export type VisualQualityWarningCode = typeof VISUAL_QUALITY_WARNING_CODES[number];

export type VisualSubjectTrackQualityInput = {
  kind: VideoSubjectTrackKind;
  source: VideoSubjectTrackingSource;
  confidenceScore: number;
  sampleCount: number;
  boxesJson?: unknown;
};

export type RenderQcResult = {
  outputExists: boolean;
  renderStatus: ClipRenderStatus;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
};

export type VisualQualityInput = {
  score: number;
  hookStrengthScore: number | null;
  standaloneClarityScore: number | null;
  emotionalImpactScore: number | null;
  sermonValueScore: number | null;
  shareabilityScore: number | null;
  contextSafetyScore: number | null;
  boundaryQualityScore: number | null;
  riskLevel: ClipRiskLevel;
  contextWarning: boolean;
  boundaryQuality: ClipBoundaryQuality;
  recommendedAction: ClipQualityRecommendedAction | null;
  pastorFriendlyReason: string | null;
  qualitySummary: string | null;
  qualityWarnings: string[];
  expectedDurationSeconds: number;
  exportLayoutStrategy: ClipExportLayoutStrategy | null;
  renderStatus: ClipRenderStatus;
  tracking: VisualSubjectTrackQualityInput[];
  renderQc?: RenderQcResult | null;
};

export type VisualQualityRefreshResult = {
  visualReadinessScore: number;
  speakerVisiblePercentage: number;
  averageTrackingConfidence: number;
  cropStabilityScore: number;
  wrongPersonSwitchRisk: number;
  majorCropJumpCount: number;
  faceOrBodyDetectionCoverage: number;
  visualQualityScore: number;
  manualCropRecommended: boolean;
  overallPostScore: number;
  recommendedAction: ClipQualityRecommendedAction;
  pastorFriendlyReason: string;
  qualitySummary: string;
  qualityWarnings: string[];
};

const MIN_RENDER_FILE_SIZE_BYTES = 50_000;
const DURATION_TOLERANCE_SECONDS = 2.5;
const EXPECTED_VERTICAL_WIDTH = 1080;
const EXPECTED_VERTICAL_HEIGHT = 1920;
const MIN_SMART_CROP_SAMPLES = 3;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function withoutPreviousVisualWarnings(warnings: string[]): string[] {
  const visualWarnings = new Set<string>(VISUAL_QUALITY_WARNING_CODES);
  return warnings.filter((warning) => !visualWarnings.has(warning));
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function centersFromBoxes(value: unknown): Array<{ timeSeconds: number; centerX: number; confidence: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const box = item as Record<string, unknown>;
    const x = typeof box.x === "number" ? box.x : 0.5;
    const width = typeof box.width === "number" ? box.width : 0;
    return [{
      timeSeconds: typeof box.timeSeconds === "number" ? box.timeSeconds : 0,
      centerX: clamp01(x + width / 2),
      confidence: typeof box.confidence === "number" ? clamp01(box.confidence) : 0.5,
    }];
  }).sort((left, right) => left.timeSeconds - right.timeSeconds);
}

function scoreTrackingStability(tracks: VisualSubjectTrackQualityInput[]): { unstable: boolean; maxJump: number; unstablePointCount: number } {
  let maxJump = 0;
  let unstablePointCount = 0;

  for (const track of tracks) {
    const centers = centersFromBoxes(track.boxesJson);
    for (let index = 1; index < centers.length; index += 1) {
      const previous = centers[index - 1];
      const current = centers[index];
      const jump = Math.abs(current.centerX - previous.centerX);
      maxJump = Math.max(maxJump, jump);
      if (jump > 0.32 && current.confidence < 0.72) {
        unstablePointCount += 1;
      }
    }
  }

  return {
    unstable: unstablePointCount > 0,
    maxJump,
    unstablePointCount,
  };
}

function scoreTracking(input: {
  tracks: VisualSubjectTrackQualityInput[];
  exportLayoutStrategy: ClipExportLayoutStrategy | null;
}): {
  score: number;
  warnings: VisualQualityWarningCode[];
  pastorNote: string | null;
  speakerVisiblePercentage: number;
  averageTrackingConfidence: number;
  cropStabilityScore: number;
  wrongPersonSwitchRisk: number;
  majorCropJumpCount: number;
  faceOrBodyDetectionCoverage: number;
} {
  const warnings: VisualQualityWarningCode[] = [];
  const tracks = input.tracks;

  if (tracks.length === 0) {
    warnings.push("LOW_TRACKING_CONFIDENCE", "MISSING_BODY_TRACK", "LOW_SAMPLE_COUNT", "SPEAKER_NOT_VISIBLE_ENOUGH");
    if (input.exportLayoutStrategy === "SMART_CROP") {
      warnings.push("SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED");
    }
    return {
      score: 3.2,
      warnings,
      pastorNote: "This clip has a strong message, but the video framing may need review because the system could not confirm the pastor position.",
      speakerVisiblePercentage: 0,
      averageTrackingConfidence: 0,
      cropStabilityScore: 3,
      wrongPersonSwitchRisk: 0.7,
      majorCropJumpCount: 0,
      faceOrBodyDetectionCoverage: 0,
    };
  }

  const sourceSet = new Set(tracks.map((track) => track.source));
  const kindSet = new Set(tracks.map((track) => track.kind));
  const averageConfidence = average(tracks.map((track) => track.confidenceScore));
  const maxSampleCount = Math.max(...tracks.map((track) => track.sampleCount));
  const stability = scoreTrackingStability(tracks);

  let score = 6.2;
  if (sourceSet.has("MODEL")) {
    score += 1.7;
  }
  if (sourceSet.has("HEURISTIC_CENTER") && !sourceSet.has("MODEL")) {
    score -= 1.1;
    warnings.push("HEURISTIC_TRACKING_USED", "STATIC_CENTER_CROP_USED");
  }
  if (averageConfidence >= 0.75) {
    score += 1;
  } else if (averageConfidence < 0.58) {
    score -= 1.4;
    warnings.push("LOW_TRACKING_CONFIDENCE");
  }
  if (!kindSet.has("BODY")) {
    score -= 1.1;
    warnings.push("MISSING_BODY_TRACK", "SPEAKER_NOT_VISIBLE_ENOUGH");
  }
  if (maxSampleCount < MIN_SMART_CROP_SAMPLES) {
    score -= 1;
    warnings.push("LOW_SAMPLE_COUNT");
  }
  if (input.exportLayoutStrategy === "SMART_CROP" && stability.unstable) {
    score -= averageConfidence >= 0.78 ? 0.5 : 1.3;
    if (averageConfidence < 0.78) {
      warnings.push("SMART_CROP_UNSTABLE", "CROP_JUMP_DETECTED");
    }
  }
  if (input.exportLayoutStrategy === "SMART_CROP" && (warnings.includes("HEURISTIC_TRACKING_USED") || warnings.includes("LOW_TRACKING_CONFIDENCE") || warnings.includes("LOW_SAMPLE_COUNT"))) {
    score -= 0.6;
    warnings.push("SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED");
  }
  if (input.exportLayoutStrategy === "SMART_CROP" && warnings.includes("SMART_CROP_UNSTABLE")) {
    warnings.push("SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED");
  }
  if (stability.unstable && averageConfidence < 0.58) {
    warnings.push("POSSIBLE_WRONG_PERSON");
  }

  const pastorNote = warnings.length > 0
    ? "This clip is post-worthy, but the pastor may not stay centered throughout. Please check the framing before posting."
    : "This clip rendered successfully and the pastor framing looks safe to review.";

  return {
    score: clampScore(score),
    warnings,
    pastorNote,
    speakerVisiblePercentage: clampScore(Math.min(10, averageConfidence * 10)) * 10,
    averageTrackingConfidence: Number(averageConfidence.toFixed(3)),
    cropStabilityScore: clampScore(10 - stability.maxJump * 12 - stability.unstablePointCount),
    wrongPersonSwitchRisk: Number((stability.unstable ? Math.max(0.25, 1 - averageConfidence) : Math.max(0, 0.35 - averageConfidence)).toFixed(3)),
    majorCropJumpCount: stability.unstablePointCount,
    faceOrBodyDetectionCoverage: Number((Array.from(kindSet).filter((kind) => kind === "FACE" || kind === "BODY").length / 2).toFixed(2)),
  };
}

function scoreRenderQc(input: {
  renderQc: RenderQcResult | null | undefined;
  expectedDurationSeconds: number;
}): { score: number; warnings: VisualQualityWarningCode[]; pastorNote: string | null } {
  const warnings: VisualQualityWarningCode[] = [];
  const renderQc = input.renderQc;

  if (!renderQc) {
    return { score: 6, warnings, pastorNote: null };
  }

  if (renderQc.renderStatus === "FAILED") {
    warnings.push("RENDER_FAILED");
    return {
      score: 1.8,
      warnings,
      pastorNote: "This clip should be checked before posting because the video render did not finish successfully.",
    };
  }

  if (!renderQc.outputExists) {
    warnings.push("RENDER_MISSING");
    return {
      score: 2.2,
      warnings,
      pastorNote: "This clip should be checked before posting because the rendered video file is missing.",
    };
  }

  let score = 8.4;
  if ((renderQc.fileSizeBytes ?? 0) < MIN_RENDER_FILE_SIZE_BYTES) {
    score -= 2.4;
    warnings.push("OUTPUT_FILE_TOO_SMALL");
  }
  if (renderQc.durationSeconds === null || Math.abs(renderQc.durationSeconds - input.expectedDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    score -= 1.7;
    warnings.push("OUTPUT_DURATION_MISMATCH");
  }
  if (renderQc.width !== EXPECTED_VERTICAL_WIDTH || renderQc.height !== EXPECTED_VERTICAL_HEIGHT) {
    score -= 2;
    warnings.push("OUTPUT_DIMENSION_MISMATCH");
  }
  if (renderQc.hasAudio !== true) {
    score -= 2.2;
    warnings.push("AUDIO_MISSING");
  }

  return {
    score: clampScore(score),
    warnings,
    pastorNote: warnings.length > 0
      ? "This clip has a useful message, but the rendered video needs review before posting."
      : "This clip rendered successfully and looks safe to review.",
  };
}

function downgradeActionForVisuals(input: {
  currentAction: ClipQualityRecommendedAction | null;
  currentOverallPostScore: number;
  visualReadinessScore: number;
  warnings: string[];
}): ClipQualityRecommendedAction {
  const severeWarnings = new Set(["RENDER_FAILED", "RENDER_MISSING", "AUDIO_MISSING", "OUTPUT_FILE_TOO_SMALL"]);
  if (input.warnings.some((warning) => severeWarnings.has(warning))) {
    return input.currentOverallPostScore < 4 ? "REJECT" : "NEEDS_REVIEW";
  }

  if (
    input.visualReadinessScore < 6 ||
    input.warnings.includes("SMART_CROP_REVIEW_RECOMMENDED") ||
    input.warnings.includes("OUTPUT_DIMENSION_MISMATCH") ||
    input.warnings.includes("OUTPUT_DURATION_MISMATCH")
  ) {
    return "NEEDS_REVIEW";
  }

  if (input.currentAction && input.currentAction !== "REJECT") {
    return input.currentAction;
  }

  return input.currentOverallPostScore >= 7 ? "KEEP" : "NEEDS_REVIEW";
}

function appendVisualPastorNote(existingReason: string | null, visualNote: string | null): string {
  if (!visualNote) {
    return existingReason ?? "This clip has been refreshed with the latest visual quality checks.";
  }

  if (!existingReason?.trim()) {
    return visualNote;
  }

  if (existingReason.includes(visualNote)) {
    return existingReason;
  }

  return `${existingReason} ${visualNote}`;
}

function appendVisualSummary(existingSummary: string | null, visualReadinessScore: number): string {
  const visualSummary = `Visual quality refreshed; visual readiness score is ${visualReadinessScore.toFixed(1)}.`;
  if (!existingSummary?.trim()) {
    return visualSummary;
  }

  const withoutPrevious = existingSummary.replace(/\s*Visual quality refreshed; visual readiness score is \d+(?:\.\d+)?\./g, "").trim();
  return `${withoutPrevious} ${visualSummary}`.trim();
}

export function adjustFinalQualityScoreAfterPostQc(input: {
  refreshedOverallPostScore: number;
  postReadyStatus: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";
}): number {
  const statusCap = input.postReadyStatus === "POST_READY"
    ? 10
    : input.postReadyStatus === "GOOD_NEEDS_REVIEW"
      ? 7.9
      : input.postReadyStatus === "NEEDS_EDITING"
        ? 6.9
        : 4.7;

  return clampScore(Math.min(input.refreshedOverallPostScore, statusCap));
}

export function resolveQualityLabelAfterPostQc(input: {
  postReadyStatus: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";
}): "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" {
  return input.postReadyStatus;
}

export function computeVisualQualityRefresh(input: VisualQualityInput): VisualQualityRefreshResult {
  const tracking = scoreTracking({
    tracks: input.tracking,
    exportLayoutStrategy: input.exportLayoutStrategy,
  });
  const render = scoreRenderQc({
    renderQc: input.renderQc,
    expectedDurationSeconds: input.expectedDurationSeconds,
  });
  const hasRenderQc = input.renderQc !== null && input.renderQc !== undefined;
  const visualReadinessScore = clampScore(hasRenderQc ? tracking.score * 0.55 + render.score * 0.45 : tracking.score);
  const visualQualityScore = visualReadinessScore;
  const overallPostScore = calculateOverallPostScore({
    existingAiScore: input.score,
    hookStrengthScore: input.hookStrengthScore ?? input.score,
    standaloneClarityScore: input.standaloneClarityScore ?? input.score,
    emotionalImpactScore: input.emotionalImpactScore ?? input.score,
    sermonValueScore: input.sermonValueScore ?? input.score,
    shareabilityScore: input.shareabilityScore ?? input.score,
    contextSafetyScore: input.contextSafetyScore ?? input.score,
    boundaryQualityScore: input.boundaryQualityScore ?? 6,
    visualReadinessScore,
    riskLevel: input.riskLevel,
    contextWarning: input.contextWarning,
    boundaryQuality: input.boundaryQuality,
  });
  const newWarnings = uniqueWarnings([
    ...withoutPreviousVisualWarnings(input.qualityWarnings),
    ...tracking.warnings,
    ...render.warnings,
  ]);
  const recommendedAction = downgradeActionForVisuals({
    currentAction: input.recommendedAction,
    currentOverallPostScore: overallPostScore,
    visualReadinessScore,
    warnings: newWarnings,
  });

  return {
    visualReadinessScore,
    speakerVisiblePercentage: tracking.speakerVisiblePercentage,
    averageTrackingConfidence: tracking.averageTrackingConfidence,
    cropStabilityScore: tracking.cropStabilityScore,
    wrongPersonSwitchRisk: tracking.wrongPersonSwitchRisk,
    majorCropJumpCount: tracking.majorCropJumpCount,
    faceOrBodyDetectionCoverage: tracking.faceOrBodyDetectionCoverage,
    visualQualityScore,
    manualCropRecommended: newWarnings.includes("MANUAL_CROP_RECOMMENDED") || newWarnings.includes("SMART_CROP_REVIEW_RECOMMENDED"),
    overallPostScore,
    recommendedAction,
    pastorFriendlyReason: appendVisualPastorNote(input.pastorFriendlyReason, render.pastorNote ?? tracking.pastorNote),
    qualitySummary: appendVisualSummary(input.qualitySummary, visualReadinessScore),
    qualityWarnings: newWarnings,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runRenderQc(input: {
  outputPath: string | null;
  renderStatus: ClipRenderStatus;
  expectedDurationSeconds: number;
  ffmpegPath?: string;
}): Promise<RenderQcResult> {
  if (!input.outputPath || !(await fileExists(input.outputPath))) {
    return {
      outputExists: false,
      renderStatus: input.renderStatus,
      fileSizeBytes: null,
      durationSeconds: null,
      width: null,
      height: null,
      hasAudio: null,
    };
  }

  const [outputStats, durationSeconds, dimensions, audioPresent] = await Promise.all([
    stat(input.outputPath),
    getMediaDurationSeconds(input.outputPath, input.ffmpegPath).catch(() => null),
    getMediaDimensions(input.outputPath, input.ffmpegPath).catch(() => null),
    hasAudioStream(input.outputPath, input.ffmpegPath).catch(() => null),
  ]);

  return {
    outputExists: true,
    renderStatus: input.renderStatus,
    fileSizeBytes: outputStats.size,
    durationSeconds,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    hasAudio: audioPresent,
  };
}

export async function refreshClipVisualQuality(
  clipId: string,
  options?: { renderQc?: RenderQcResult | null; audioQuality?: AudioQualityResult | null; ffmpegPath?: string },
): Promise<VisualQualityRefreshResult | null> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      score: true,
      hookScore: true,
      hookStrengthScore: true,
      standaloneClarityScore: true,
      emotionalImpactScore: true,
      sermonValueScore: true,
      shareabilityScore: true,
      contextSafetyScore: true,
      boundaryQualityScore: true,
      arcCompletenessScore: true,
      finalQualityScore: true,
      audioQualityScore: true,
      averageLoudness: true,
      peakLoudness: true,
      silenceAtBeginningSeconds: true,
      silenceAtEndSeconds: true,
      audioWarnings: true,
      captionQualityScore: true,
      captionQualityWarnings: true,
      qualityLabel: true,
      riskLevel: true,
      contextWarning: true,
      boundaryQuality: true,
      recommendedAction: true,
      recommendedNextAction: true,
      pastorFriendlyReason: true,
      qualitySummary: true,
      qualityWarnings: true,
      durationSeconds: true,
      transcriptText: true,
      caption: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      exportLayoutStrategy: true,
      renderStatus: true,
      renderedFilePath: true,
      captionStatus: true,
      captionData: true,
      videoSubjectTracks: {
        select: {
          kind: true,
          source: true,
          confidenceScore: true,
          sampleCount: true,
          boxesJson: true,
        },
      },
    },
  });

  if (!clip) {
    return null;
  }

  const expectedDurationSeconds = Number(((clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds) - (clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds)).toFixed(2));
  const renderQc = options?.renderQc !== undefined
    ? options.renderQc
    : clip.renderStatus === "COMPLETED" || clip.renderStatus === "FAILED"
      ? await runRenderQc({
          outputPath: clip.renderedFilePath,
          renderStatus: clip.renderStatus,
          expectedDurationSeconds,
          ffmpegPath: options?.ffmpegPath,
        })
      : null;
  const audioQuality = options?.audioQuality !== undefined
    ? options.audioQuality
    : clip.renderStatus === "COMPLETED" && clip.renderedFilePath
      ? await probeAudioQuality({ filePath: clip.renderedFilePath, ffmpegPath: options?.ffmpegPath }).catch(() => null)
      : null;
  const captionQuality = validateCaptionQuality({
    clipStartTimeSeconds: clip.startTimeSeconds,
    clipEndTimeSeconds: clip.endTimeSeconds,
    transcriptText: clip.transcriptText,
    captionText: clip.caption,
    cues: parseCaptionDataCues({
      captionData: clip.captionData,
      clipStartTimeSeconds: clip.startTimeSeconds,
    }),
  });

  const refreshed = computeVisualQualityRefresh({
    score: clip.score,
    hookStrengthScore: clip.hookStrengthScore,
    standaloneClarityScore: clip.standaloneClarityScore,
    emotionalImpactScore: clip.emotionalImpactScore,
    sermonValueScore: clip.sermonValueScore,
    shareabilityScore: clip.shareabilityScore,
    contextSafetyScore: clip.contextSafetyScore,
    boundaryQualityScore: clip.boundaryQualityScore,
    riskLevel: clip.riskLevel,
    contextWarning: clip.contextWarning,
    boundaryQuality: clip.boundaryQuality,
    recommendedAction: clip.recommendedAction,
    pastorFriendlyReason: clip.pastorFriendlyReason,
    qualitySummary: clip.qualitySummary,
    qualityWarnings: normalizeWarnings(clip.qualityWarnings),
    expectedDurationSeconds: expectedDurationSeconds || clip.durationSeconds,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    renderStatus: clip.renderStatus,
    tracking: clip.videoSubjectTracks,
    renderQc,
  });
  const postReady = reviewPostReady({
    finalQualityScore: refreshed.overallPostScore,
    hookScore: clip.hookScore ?? clip.hookStrengthScore ?? clip.score,
    arcCompletenessScore: clip.arcCompletenessScore ?? clip.standaloneClarityScore ?? clip.score,
    boundaryQualityScore: clip.boundaryQualityScore ?? 6,
    visualQualityScore: refreshed.visualQualityScore,
    audioQualityScore: audioQuality?.audioQualityScore ?? clip.audioQualityScore ?? (renderQc?.hasAudio === false ? 0 : 5),
    captionQualityScore: captionQuality.captionQualityScore,
    boundaryQuality: clip.boundaryQuality,
    renderStatus: clip.renderStatus,
    riskLevel: clip.riskLevel,
    contextWarning: clip.contextWarning,
    qualityWarnings: refreshed.qualityWarnings,
    audioWarnings: audioQuality?.audioWarnings ?? normalizeWarnings(clip.audioWarnings),
    captionWarnings: captionQuality.captionWarnings,
  });
  const nextQualityLabel = resolveQualityLabelAfterPostQc({
    postReadyStatus: postReady.postReadyStatus,
  });
  const nextFinalQualityScore = adjustFinalQualityScoreAfterPostQc({
    refreshedOverallPostScore: refreshed.overallPostScore,
    postReadyStatus: postReady.postReadyStatus,
  });

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      speakerVisiblePercentage: refreshed.speakerVisiblePercentage,
      averageTrackingConfidence: refreshed.averageTrackingConfidence,
      cropStabilityScore: refreshed.cropStabilityScore,
      wrongPersonSwitchRisk: refreshed.wrongPersonSwitchRisk,
      majorCropJumpCount: refreshed.majorCropJumpCount,
      faceOrBodyDetectionCoverage: refreshed.faceOrBodyDetectionCoverage,
      visualQualityScore: refreshed.visualQualityScore,
      visualConfidenceScore: refreshed.visualReadinessScore,
      manualCropRecommended: refreshed.manualCropRecommended,
      audioQualityScore: audioQuality?.audioQualityScore ?? clip.audioQualityScore,
      averageLoudness: audioQuality?.averageLoudness ?? clip.averageLoudness,
      peakLoudness: audioQuality?.peakLoudness ?? clip.peakLoudness,
      silenceAtBeginningSeconds: audioQuality?.silenceAtBeginningSeconds ?? clip.silenceAtBeginningSeconds,
      silenceAtEndSeconds: audioQuality?.silenceAtEndSeconds ?? clip.silenceAtEndSeconds,
      audioWarnings: audioQuality?.audioWarnings ?? normalizeWarnings(clip.audioWarnings),
      captionQualityScore: captionQuality.captionQualityScore,
      captionQualityWarnings: captionQuality.captionWarnings,
      visualReadinessScore: refreshed.visualReadinessScore,
      overallPostScore: refreshed.overallPostScore,
      recommendedAction: refreshed.recommendedAction,
      finalQualityScore: nextFinalQualityScore,
      qualityLabel: nextQualityLabel,
      postReadyStatus: postReady.postReadyStatus,
      postReadyReasons: postReady.postReadyReasons,
      postReadyBlockers: postReady.postReadyBlockers,
      recommendedNextAction: postReady.recommendedNextAction,
      pastorFriendlyReason: refreshed.pastorFriendlyReason,
      qualitySummary: refreshed.qualitySummary,
      qualityWarnings: refreshed.qualityWarnings,
      qualityReviewedAt: new Date(),
    },
  });

  return refreshed;
}

export const __clipVisualQualityTestUtils = {
  computeVisualQualityRefresh,
  runRenderQc,
};
