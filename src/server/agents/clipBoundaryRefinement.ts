import { analyzeClipCoherence } from "@/server/agents/clipCoherenceAnalysis";

export type BoundaryQuality = "GOOD" | "NEEDS_REVIEW" | "BAD";

export type TranscriptSegmentBoundary = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type BoundaryCandidateBase = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  reasonSelected: string;
  riskReasons: string[];
  setupStartTime?: number | null;
  mainPointTime?: number | null;
  payoffTime?: number | null;
  applicationTime?: number | null;
};

export type BoundaryRefinedFields = {
  originalStartTimeSeconds: number;
  originalEndTimeSeconds: number;
  adjustedStartTimeSeconds: number;
  adjustedEndTimeSeconds: number;
  boundaryAdjustmentReason: string;
  boundaryQuality: BoundaryQuality;
};

type BoundaryValidationResult = {
  isValid: boolean;
  reasons: string[];
  durationSeconds: number;
};

export type BoundaryRevalidationIssueCode =
  | "INVALID_TIMING"
  | "BELOW_HARD_MIN_DURATION"
  | "ABOVE_HARD_MAX_DURATION"
  | "OUTSIDE_SERMON_BOUNDS"
  | "MISSING_TRANSCRIPT"
  | "MISSING_TRANSCRIPT_SEGMENT"
  | "STARTS_MID_SENTENCE"
  | "DEPENDENT_OPENING"
  | "CONTEXT_DEPENDENT_OPENING"
  | "INCOMPLETE_ENDING";

export type BoundaryRevalidationIssue = {
  code: BoundaryRevalidationIssueCode;
  message: string;
  severity: "BAD" | "NEEDS_REVIEW";
};

export type BoundaryRevalidationResult = {
  quality: BoundaryQuality;
  reasons: BoundaryRevalidationIssue[];
  durationSeconds: number;
  openingSegment: TranscriptSegmentBoundary | null;
  endingSegment: TranscriptSegmentBoundary | null;
};

export type BoundaryRefinementResult<T> =
  | {
      accepted: true;
      adjusted: boolean;
      candidate: T & BoundaryRefinedFields;
    }
  | {
      accepted: false;
      reason: string;
    };

export const TARGET_MIN_DURATION_SECONDS = 30;
export const TARGET_MAX_DURATION_SECONDS = 90;
export const PREFERRED_MIN_DURATION_SECONDS = 45;
export const PREFERRED_MAX_DURATION_SECONDS = 75;
export const HARD_MIN_DURATION_SECONDS = 24;
export const HARD_MAX_DURATION_SECONDS = 150;
const MAX_START_BACKTRACK_SECONDS = 20;
const MAX_END_EXTENSION_SECONDS = 30;
export function startsWithUnclearConnector(text: string): boolean {
  return analyzeClipCoherence(text).openingStatus === "SOFT_CONNECTOR";
}

export function startsWithContextDependentReference(text: string): boolean {
  return analyzeClipCoherence(text).openingStatus === "DEPENDENT";
}

export function endsThought(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return analyzeClipCoherence(trimmed).endingStatus === "CLEAN";
}

function hasSpokenLanding(text: string): boolean {
  return analyzeClipCoherence(text).landingStatus !== "NONE";
}

export function startsMidSentence(text: string): boolean {
  return analyzeClipCoherence(text).openingStatus === "MID_SENTENCE";
}

function composeTranscriptText(segments: TranscriptSegmentBoundary[], startIndex: number, endIndex: number): string {
  return segments
    .slice(startIndex, endIndex + 1)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function findStartIndexForTime(segments: TranscriptSegmentBoundary[], startTimeSeconds: number): number {
  return segments.findIndex((segment) => segment.endTimeSeconds > startTimeSeconds);
}

function findEndIndexForTime(segments: TranscriptSegmentBoundary[], endTimeSeconds: number, startIndex: number): number {
  let endIndex = startIndex;

  for (let index = startIndex; index < segments.length; index += 1) {
    if (segments[index].startTimeSeconds >= endTimeSeconds) {
      break;
    }

    endIndex = index;
  }

  return endIndex;
}

export function validateFinalClipBoundary(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  transcriptText: string;
  segments: TranscriptSegmentBoundary[];
  sermonStartSeconds?: number | null;
  sermonEndSeconds?: number | null;
  includesLeadInContext?: boolean;
}): BoundaryRevalidationResult {
  const reasons: BoundaryRevalidationIssue[] = [];
  const durationSeconds = Number((input.endTimeSeconds - input.startTimeSeconds).toFixed(2));
  const addReason = (issue: BoundaryRevalidationIssue) => reasons.push(issue);

  if (
    !Number.isFinite(input.startTimeSeconds) ||
    !Number.isFinite(input.endTimeSeconds) ||
    input.startTimeSeconds < 0 ||
    input.endTimeSeconds <= input.startTimeSeconds
  ) {
    addReason({
      code: "INVALID_TIMING",
      message: "Final boundary has invalid start/end timing.",
      severity: "BAD",
    });
  }

  if (durationSeconds < HARD_MIN_DURATION_SECONDS) {
    addReason({
      code: "BELOW_HARD_MIN_DURATION",
      message: `Final clip is shorter than the hard minimum (${durationSeconds}s).`,
      severity: "BAD",
    });
  }

  if (durationSeconds > HARD_MAX_DURATION_SECONDS) {
    addReason({
      code: "ABOVE_HARD_MAX_DURATION",
      message: `Final clip is longer than the hard maximum (${durationSeconds}s).`,
      severity: "BAD",
    });
  }

  if (
    (typeof input.sermonStartSeconds === "number" && input.startTimeSeconds < input.sermonStartSeconds) ||
    (typeof input.sermonEndSeconds === "number" && input.endTimeSeconds > input.sermonEndSeconds)
  ) {
    addReason({
      code: "OUTSIDE_SERMON_BOUNDS",
      message: "Final clip boundary falls outside the configured sermon bounds.",
      severity: "BAD",
    });
  }

  if (!input.transcriptText.trim()) {
    addReason({
      code: "MISSING_TRANSCRIPT",
      message: "Final clip transcript text is missing.",
      severity: "BAD",
    });
  }

  const startIndex = findStartIndexForTime(input.segments, input.startTimeSeconds);
  const endIndex = startIndex === -1 ? -1 : findEndIndexForTime(input.segments, input.endTimeSeconds, startIndex);
  const openingSegment = startIndex === -1 ? null : input.segments[startIndex];
  const endingSegment = endIndex === -1 ? null : input.segments[endIndex];

  if (!openingSegment || !endingSegment) {
    addReason({
      code: "MISSING_TRANSCRIPT_SEGMENT",
      message: "Final clip boundary does not overlap usable transcript segments.",
      severity: "BAD",
    });
  }

  if (openingSegment) {
    if (startsMidSentence(openingSegment.text)) {
      addReason({
        code: "STARTS_MID_SENTENCE",
        message: "Final clip starts mid-sentence.",
        severity: "NEEDS_REVIEW",
      });
    }

    if (startsWithUnclearConnector(openingSegment.text) && !input.includesLeadInContext) {
      addReason({
        code: "DEPENDENT_OPENING",
        message: "Final clip still starts with a connector word.",
        severity: "NEEDS_REVIEW",
      });
    }

    if (startsWithContextDependentReference(openingSegment.text) && !input.includesLeadInContext) {
      addReason({
        code: "CONTEXT_DEPENDENT_OPENING",
        message: "Final clip still starts with a context-dependent reference.",
        severity: "NEEDS_REVIEW",
      });
    }
  }

  if (endingSegment && !endsThought(endingSegment.text)) {
    addReason({
      code: "INCOMPLETE_ENDING",
      message: "Final clip still ends before the sentence or thought is complete.",
      severity: "NEEDS_REVIEW",
    });
  }

  const quality: BoundaryQuality = reasons.some((reason) => reason.severity === "BAD")
    ? "BAD"
    : reasons.length > 0
      ? "NEEDS_REVIEW"
      : "GOOD";

  return {
    quality,
    reasons,
    durationSeconds,
    openingSegment,
    endingSegment,
  };
}

function protectedArcTimes(candidate: BoundaryCandidateBase): number[] {
  return [
    candidate.setupStartTime,
    candidate.mainPointTime,
    candidate.payoffTime,
    candidate.applicationTime,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function protectedLeadInTimes(candidate: BoundaryCandidateBase): number[] {
  return [
    candidate.setupStartTime,
    candidate.mainPointTime,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function segmentIndexContainingTime(segments: TranscriptSegmentBoundary[], timeSeconds: number): number | null {
  const index = segments.findIndex((segment) => segment.startTimeSeconds <= timeSeconds && segment.endTimeSeconds >= timeSeconds);
  return index === -1 ? null : index;
}

export function validateBoundaryTimes(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  sermonDurationSeconds: number;
  transcriptText: string;
}): BoundaryValidationResult {
  const reasons: string[] = [];
  const { startTimeSeconds, endTimeSeconds, sermonDurationSeconds, transcriptText } = input;
  const durationSeconds = Number((endTimeSeconds - startTimeSeconds).toFixed(2));

  if (!Number.isFinite(startTimeSeconds) || startTimeSeconds < 0) {
    reasons.push("Start time is invalid.");
  }

  if (!Number.isFinite(endTimeSeconds) || endTimeSeconds < 0) {
    reasons.push("End time is invalid.");
  }

  if (endTimeSeconds <= startTimeSeconds) {
    reasons.push("End time must be greater than start time.");
  }

  if (durationSeconds < HARD_MIN_DURATION_SECONDS) {
    reasons.push(`Clip is too short (${durationSeconds}s).`);
  }

  if (durationSeconds > HARD_MAX_DURATION_SECONDS) {
    reasons.push(`Clip is too long (${durationSeconds}s).`);
  }

  if (startTimeSeconds > sermonDurationSeconds) {
    reasons.push("Start time is outside sermon duration.");
  }

  if (endTimeSeconds > sermonDurationSeconds) {
    reasons.push("End time is outside sermon duration.");
  }

  if (!transcriptText.trim()) {
    reasons.push("Transcript text is missing for selected range.");
  }

  return {
    isValid: reasons.length === 0,
    reasons,
    durationSeconds,
  };
}

function calculateBoundaryQuality(input: {
  startText: string;
  endText: string;
  durationSeconds: number;
  transcriptText: string;
  includesLeadInContext: boolean;
}): { quality: BoundaryQuality; reasons: string[] } {
  const reasons: string[] = [];
  const { startText, endText, durationSeconds, transcriptText, includesLeadInContext } = input;

  if (!transcriptText.trim()) {
    reasons.push("Transcript text is missing.");
  }

  if (startsMidSentence(startText)) {
    reasons.push("Clip starts mid-sentence.");
  }

  if (!endsThought(endText)) {
    reasons.push("Clip ends before the sentence or thought is complete.");
  }

  if (startsWithUnclearConnector(startText) && !includesLeadInContext) {
    reasons.push("Clip starts with a connector word and may lack context.");
  }

  if (startsWithContextDependentReference(startText) && !includesLeadInContext) {
    reasons.push("Clip starts with a context-dependent reference and may lack setup.");
  }

  if (durationSeconds < TARGET_MIN_DURATION_SECONDS) {
    reasons.push("Clip is shorter than the target duration range.");
  }

  if (durationSeconds < HARD_MIN_DURATION_SECONDS || durationSeconds > HARD_MAX_DURATION_SECONDS || !transcriptText.trim()) {
    return { quality: "BAD", reasons };
  }

  if (reasons.length > 0) {
    return { quality: "NEEDS_REVIEW", reasons };
  }

  return { quality: "GOOD", reasons };
}

export function refineClipBoundaries<T extends BoundaryCandidateBase>(
  candidate: T,
  segments: TranscriptSegmentBoundary[],
): BoundaryRefinementResult<T> {
  const originalStart = candidate.startTimeSeconds;
  const originalEnd = candidate.endTimeSeconds;

  let startIndex = findStartIndexForTime(segments, candidate.startTimeSeconds);
  if (startIndex === -1) {
    return { accepted: false, reason: "No transcript segment matched the candidate start time." };
  }

  let endIndex = findEndIndexForTime(segments, candidate.endTimeSeconds, startIndex);
  if (endIndex < startIndex) {
    endIndex = startIndex;
  }

  const adjustmentNotes: string[] = [];
  let includesLeadInContext = false;
  const protectedIndexes = protectedArcTimes(candidate)
    .map((timeSeconds) => segmentIndexContainingTime(segments, timeSeconds))
    .filter((index): index is number => index !== null);
  const leadInProtectedIndexes = protectedLeadInTimes(candidate)
    .map((timeSeconds) => segmentIndexContainingTime(segments, timeSeconds))
    .filter((index): index is number => index !== null);
  const earliestProtectedIndex = protectedIndexes.length > 0 ? Math.min(...protectedIndexes) : null;
  const earliestLeadInProtectedIndex = leadInProtectedIndexes.length > 0 ? Math.min(...leadInProtectedIndexes) : null;
  const latestProtectedIndex = protectedIndexes.length > 0 ? Math.max(...protectedIndexes) : null;
  let protectedEndExtensionSkipped = false;

  while (startIndex > 0) {
    const previous = segments[startIndex - 1];
    const current = segments[startIndex];
    const projectedDuration = segments[endIndex].endTimeSeconds - previous.startTimeSeconds;
    const expandedStartDelta = originalStart - previous.startTimeSeconds;

    if (projectedDuration > HARD_MAX_DURATION_SECONDS || expandedStartDelta > MAX_START_BACKTRACK_SECONDS) {
      break;
    }

    const shouldIncludePrevious =
      startsWithUnclearConnector(current.text) ||
      startsWithContextDependentReference(current.text) ||
      startsMidSentence(current.text) ||
      !endsThought(previous.text);

    if (!shouldIncludePrevious) {
      break;
    }

    startIndex -= 1;
    includesLeadInContext = true;
    adjustmentNotes.push("Start moved earlier to include the beginning of the sentence.");
  }

  if (earliestLeadInProtectedIndex !== null && earliestLeadInProtectedIndex < startIndex) {
    const protectedStart = segments[earliestLeadInProtectedIndex]?.startTimeSeconds;
    const projectedDurationToProtected = segments[endIndex].endTimeSeconds - protectedStart;
    const backtrackToProtected = originalStart - protectedStart;
    const canSafelyReachProtectedLeadIn =
      Number.isFinite(protectedStart) &&
      projectedDurationToProtected <= HARD_MAX_DURATION_SECONDS &&
      backtrackToProtected <= MAX_START_BACKTRACK_SECONDS;

    if (canSafelyReachProtectedLeadIn) {
      startIndex = earliestLeadInProtectedIndex;
      includesLeadInContext = true;
      adjustmentNotes.push("Start moved earlier to include the claimed setup or main sermon point.");
    } else {
      adjustmentNotes.push("Start extension skipped because the claimed setup or main sermon point is outside safe duration limits.");
    }
  }

  if (latestProtectedIndex !== null && latestProtectedIndex > endIndex) {
    const protectedEnd = segments[latestProtectedIndex]?.endTimeSeconds;
    const projectedDurationToProtected = protectedEnd - segments[startIndex].startTimeSeconds;
    const extensionToProtected = protectedEnd - originalEnd;
    const canSafelyReachProtectedArcPoint =
      Number.isFinite(protectedEnd) &&
      projectedDurationToProtected <= HARD_MAX_DURATION_SECONDS &&
      extensionToProtected <= MAX_END_EXTENSION_SECONDS;

    if (canSafelyReachProtectedArcPoint) {
      while (endIndex < latestProtectedIndex && endIndex < segments.length - 1) {
        endIndex += 1;
      }

      adjustmentNotes.push("End extended to include the claimed payoff or application.");
    } else {
      protectedEndExtensionSkipped = true;
      adjustmentNotes.push("End extension skipped because the claimed sermon arc point is outside safe duration limits.");
    }
  }

  while (endIndex < segments.length - 1) {
    if (protectedEndExtensionSkipped) {
      break;
    }

    const currentTranscript = composeTranscriptText(segments, startIndex, endIndex);
    const next = segments[endIndex + 1];
    const projectedDuration = next.endTimeSeconds - segments[startIndex].startTimeSeconds;
    const extensionFromOriginalEnd = next.endTimeSeconds - originalEnd;
    const nextLooksLikeLanding = hasSpokenLanding(next.text);
    const currentAlreadyHasLanding = hasSpokenLanding(currentTranscript);

    if (
      currentAlreadyHasLanding ||
      !nextLooksLikeLanding ||
      projectedDuration > TARGET_MAX_DURATION_SECONDS ||
      extensionFromOriginalEnd > MAX_END_EXTENSION_SECONDS
    ) {
      break;
    }

    endIndex += 1;
    adjustmentNotes.push("End extended to include the spoken landing or application.");
  }

  while (endIndex < segments.length - 1) {
    const current = segments[endIndex];
    const next = segments[endIndex + 1];
    const projectedDuration = next.endTimeSeconds - segments[startIndex].startTimeSeconds;
    const extensionFromOriginalEnd = next.endTimeSeconds - originalEnd;
    const shouldExtend = !endsThought(current.text) || current.text.trim().endsWith(",") || current.text.trim().endsWith(":");

    if (!shouldExtend) {
      break;
    }

    if (projectedDuration > HARD_MAX_DURATION_SECONDS || extensionFromOriginalEnd > MAX_END_EXTENSION_SECONDS) {
      break;
    }

    endIndex += 1;
    adjustmentNotes.push("End extended to complete the teaching point.");
  }

  while (endIndex < segments.length - 1) {
    const currentDuration = segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds;
    if (currentDuration >= TARGET_MIN_DURATION_SECONDS) {
      break;
    }

    const next = segments[endIndex + 1];
    const projectedDuration = next.endTimeSeconds - segments[startIndex].startTimeSeconds;
    if (projectedDuration > HARD_MAX_DURATION_SECONDS) {
      break;
    }

    endIndex += 1;
    adjustmentNotes.push("End extended to avoid cutting the message too short.");
  }

  while (startIndex < endIndex) {
    const nextStart = segments[startIndex + 1].startTimeSeconds;
    const projectedDuration = segments[endIndex].endTimeSeconds - nextStart;
    if (projectedDuration <= HARD_MAX_DURATION_SECONDS) {
      break;
    }

    if (earliestProtectedIndex !== null && startIndex + 1 > earliestProtectedIndex) {
      adjustmentNotes.push("Start trim stopped to preserve the clip setup or main sermon point.");
      break;
    }

    startIndex += 1;
    adjustmentNotes.push("Start trimmed to avoid an unnecessarily long introduction.");
  }

  while (startIndex < endIndex) {
    const duration = segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds;
    if (duration <= HARD_MAX_DURATION_SECONDS) {
      break;
    }

    if (latestProtectedIndex !== null && endIndex - 1 < latestProtectedIndex) {
      adjustmentNotes.push("End trim stopped to preserve the payoff or application.");
      break;
    }

    endIndex -= 1;
    adjustmentNotes.push("Clip shortened to stay under the hard duration limit.");
  }

  const adjustedStart = segments[startIndex].startTimeSeconds;
  const adjustedEnd = segments[endIndex].endTimeSeconds;
  const transcriptText = composeTranscriptText(segments, startIndex, endIndex);

  const sermonDurationSeconds = segments[segments.length - 1]?.endTimeSeconds ?? adjustedEnd;
  const validation = validateBoundaryTimes({
    startTimeSeconds: adjustedStart,
    endTimeSeconds: adjustedEnd,
    sermonDurationSeconds,
    transcriptText,
  });

  if (!validation.isValid) {
    return {
      accepted: false,
      reason: validation.reasons.join(" "),
    };
  }

  const quality = calculateBoundaryQuality({
    startText: segments[startIndex].text,
    endText: segments[endIndex].text,
    durationSeconds: validation.durationSeconds,
    transcriptText,
    includesLeadInContext,
  });

  if (
    validation.durationSeconds >= PREFERRED_MIN_DURATION_SECONDS &&
    validation.durationSeconds <= PREFERRED_MAX_DURATION_SECONDS &&
    quality.quality === "GOOD"
  ) {
    adjustmentNotes.push("Duration falls in the preferred 45-75 second range.");
  }

  const adjusted = adjustedStart !== originalStart || adjustedEnd !== originalEnd;
  const adjustmentPrefix = adjusted
    ? `Boundary adjusted from ${originalStart.toFixed(2)}-${originalEnd.toFixed(2)}s to ${adjustedStart.toFixed(2)}-${adjustedEnd.toFixed(2)}s.`
    : `Boundary kept at AI timing ${originalStart.toFixed(2)}-${originalEnd.toFixed(2)}s.`;

  const qualitySummary =
    quality.reasons.length > 0
      ? `Boundary quality ${quality.quality}: ${quality.reasons.join(" ")}`
      : `Boundary quality ${quality.quality}.`;

  const boundaryAdjustmentReason = `${adjustmentPrefix} ${adjustmentNotes.join(" ")} ${qualitySummary}`.replace(/\s+/g, " ").trim();

  const mergedRiskReasons = [...candidate.riskReasons, ...quality.reasons].filter(Boolean);

  return {
    accepted: true,
    adjusted,
    candidate: {
      ...candidate,
      startTimeSeconds: adjustedStart,
      endTimeSeconds: adjustedEnd,
      durationSeconds: validation.durationSeconds,
      transcriptText,
      reasonSelected: `${candidate.reasonSelected} ${adjustmentPrefix}`.trim(),
      riskReasons: Array.from(new Set(mergedRiskReasons)),
      originalStartTimeSeconds: originalStart,
      originalEndTimeSeconds: originalEnd,
      adjustedStartTimeSeconds: adjustedStart,
      adjustedEndTimeSeconds: adjustedEnd,
      boundaryAdjustmentReason,
      boundaryQuality: quality.quality,
    },
  };
}
