import { resolveSpeechCleanupProfile, type SpeechCleanupSettings } from "@/lib/clipStudio";
import type { CaptionCueWordTiming } from "@/lib/clipStudioEditing";

export type SpeechCleanupCaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  wordTimings?: CaptionCueWordTiming[];
};

export type SpeechCleanupCut = {
  startSeconds: number;
  endSeconds: number;
  removedSeconds: number;
};

export type SpeechCleanupMarkerSource = "audio" | "transcript";
export type SpeechCleanupMarkerConfidence = "confirmed" | "candidate";

export type SpeechCleanupRemovedRange = SpeechCleanupCut & {
  kind: "edge" | "internal";
  source: SpeechCleanupMarkerSource;
  confidence: SpeechCleanupMarkerConfidence;
  rawGapSeconds: number;
  beforeText: string | null;
  afterText: string | null;
};

export type SpeechCleanupEditableCut = SpeechCleanupRemovedRange & {
  id: string;
  enabled: boolean;
};

export type SpeechCleanupEdits = {
  version: 1;
  cuts: SpeechCleanupEditableCut[];
  updatedAt?: string;
};

export type SpeechCleanupAudioSilenceEvent = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export type SpeechCleanupReviewItem = SpeechCleanupRemovedRange & {
  id: string;
  index: number;
  label: string;
  confidenceLabel: string;
};

export type SpeechCleanupCutPlan = {
  enabled: boolean;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  cleanedDurationSeconds: number;
  cuts: SpeechCleanupCut[];
  removedRanges: SpeechCleanupRemovedRange[];
  candidateRanges: SpeechCleanupRemovedRange[];
  reviewItems: SpeechCleanupReviewItem[];
  hasAudioAnalysis: boolean;
};

export type RemappedTimelineRange = {
  startSeconds: number;
  endSeconds: number;
};

function roundPlanSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function clampPlanSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeAudioSilenceEvents({
  audioSilenceEvents,
  duration,
}: {
  audioSilenceEvents: SpeechCleanupAudioSilenceEvent[];
  duration: number;
}): SpeechCleanupAudioSilenceEvent[] {
  return audioSilenceEvents
    .flatMap((event) => {
      const startSeconds = Number(event.startSeconds);
      const endSeconds = Number(event.endSeconds);
      const durationSeconds = Number(event.durationSeconds);

      if (
        !Number.isFinite(startSeconds) ||
        !Number.isFinite(endSeconds) ||
        !Number.isFinite(durationSeconds) ||
        endSeconds <= startSeconds ||
        durationSeconds <= 0
      ) {
        return [];
      }

      const start = roundPlanSeconds(clampPlanSeconds(startSeconds, 0, duration));
      const end = roundPlanSeconds(clampPlanSeconds(endSeconds, 0, duration));
      if (end <= start) {
        return [];
      }

      return [{
        startSeconds: start,
        endSeconds: end,
        durationSeconds: roundPlanSeconds(Math.min(durationSeconds, end - start)),
      }];
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function findCaptionCueBefore(cues: SpeechCleanupCaptionCue[], seconds: number): SpeechCleanupCaptionCue | null {
  return [...cues].reverse().find((cue) => cue.endSeconds <= seconds + 0.05) ?? null;
}

function findCaptionCueAfter(cues: SpeechCleanupCaptionCue[], seconds: number): SpeechCleanupCaptionCue | null {
  return cues.find((cue) => cue.startSeconds >= seconds - 0.05) ?? null;
}

function rangeOverlapSeconds(
  left: Pick<SpeechCleanupRemovedRange, "startSeconds" | "endSeconds">,
  right: Pick<SpeechCleanupRemovedRange, "startSeconds" | "endSeconds">,
): number {
  return Math.max(0, Math.min(left.endSeconds, right.endSeconds) - Math.max(left.startSeconds, right.startSeconds));
}

function buildReviewItems(ranges: SpeechCleanupRemovedRange[]): SpeechCleanupReviewItem[] {
  return ranges
    .slice()
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((range, index) => ({
      ...range,
      id: `${range.source}-${range.kind}-${range.startSeconds}-${range.endSeconds}-${index}`,
      index: index + 1,
      label: `${range.source === "audio" ? "Cut" : "Review"} ${index + 1}`,
      confidenceLabel: range.source === "audio" ? "Confirmed silence" : "Transcript gap",
    }));
}

export function buildSpeechCleanupCutPlan({
  captionCues,
  durationSeconds,
  speechCleanup,
  audioSilenceEvents = [],
  audioSilenceAnalysisAvailable = false,
  speechCleanupEdits = null,
}: {
  captionCues: SpeechCleanupCaptionCue[];
  durationSeconds: number | null;
  speechCleanup: SpeechCleanupSettings;
  audioSilenceEvents?: SpeechCleanupAudioSilenceEvent[];
  audioSilenceAnalysisAvailable?: boolean;
  speechCleanupEdits?: SpeechCleanupEdits | null;
}): SpeechCleanupCutPlan {
  const duration = Number.isFinite(durationSeconds) && durationSeconds !== null ? Math.max(0, durationSeconds) : 0;
  const profile = resolveSpeechCleanupProfile(speechCleanup.intensity);
  const sortedCues = [...captionCues]
    .filter((cue) => cue.text.trim().length > 0 && cue.endSeconds > cue.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const sortedAudioEvents = sanitizeAudioSilenceEvents({ audioSilenceEvents, duration });
  const hasAudioAnalysis = audioSilenceAnalysisAvailable || sortedAudioEvents.length > 0;
  const canPlanCleanup = duration > 0 && (sortedCues.length > 0 || hasAudioAnalysis);
  const cleanupEnabled = canPlanCleanup && (speechCleanup.removeDeadAir || speechCleanup.tightenLongPauses);

  let sourceStartSeconds = 0;
  let sourceEndSeconds = duration;

  if (canPlanCleanup && speechCleanup.removeDeadAir && hasAudioAnalysis) {
    const beginning = sortedAudioEvents.find((event) => event.startSeconds <= 0.15);
    const ending = [...sortedAudioEvents].reverse().find((event) => event.endSeconds >= duration - 0.15);

    if (beginning && beginning.durationSeconds >= profile.minEdgeSilenceSeconds) {
      sourceStartSeconds = roundPlanSeconds(Math.max(0, beginning.endSeconds - profile.edgeSpeechPadSeconds));
    }
    if (ending && ending.durationSeconds >= profile.minEdgeSilenceSeconds) {
      sourceEndSeconds = roundPlanSeconds(Math.min(duration, ending.startSeconds + profile.edgeSpeechPadSeconds));
    }
  } else if (canPlanCleanup && speechCleanup.removeDeadAir && sortedCues.length > 0) {
    const firstCue = sortedCues[0];
    const lastCue = sortedCues[sortedCues.length - 1];
    if (firstCue.startSeconds >= profile.minEdgeSilenceSeconds) {
      sourceStartSeconds = roundPlanSeconds(Math.max(0, firstCue.startSeconds - profile.edgeSpeechPadSeconds));
    }
    if (duration - lastCue.endSeconds >= profile.minEdgeSilenceSeconds) {
      sourceEndSeconds = roundPlanSeconds(Math.min(duration, lastCue.endSeconds + profile.edgeSpeechPadSeconds));
    }
  }

  const audioCuts = canPlanCleanup && speechCleanup.tightenLongPauses && hasAudioAnalysis
    ? sortedAudioEvents.flatMap((event) => {
        if (
          event.durationSeconds < profile.minInternalSilenceSeconds ||
          event.startSeconds <= sourceStartSeconds + 0.05 ||
          event.endSeconds >= sourceEndSeconds - 0.05
        ) {
          return [];
        }

        const startSeconds = roundPlanSeconds(clampPlanSeconds(event.startSeconds + profile.internalSpeechPadSeconds, sourceStartSeconds, sourceEndSeconds));
        const endSeconds = roundPlanSeconds(clampPlanSeconds(event.endSeconds - profile.internalSpeechPadSeconds, sourceStartSeconds, sourceEndSeconds));
        if (endSeconds <= startSeconds) {
          return [];
        }

        return [{
          startSeconds,
          endSeconds,
          removedSeconds: roundPlanSeconds(endSeconds - startSeconds),
          rawGapSeconds: event.durationSeconds,
        }];
      })
    : [];

  const transcriptCuts = canPlanCleanup && speechCleanup.tightenLongPauses && sortedCues.length > 0
    ? sortedCues.flatMap((cue, index) => {
        const nextCue = sortedCues[index + 1];
        if (!nextCue) {
          return [];
        }

        const gapSeconds = nextCue.startSeconds - cue.endSeconds;
        if (gapSeconds < profile.minInternalSilenceSeconds) {
          return [];
        }

        const startSeconds = roundPlanSeconds(clampPlanSeconds(cue.endSeconds + profile.internalSpeechPadSeconds, sourceStartSeconds, sourceEndSeconds));
        const endSeconds = roundPlanSeconds(clampPlanSeconds(nextCue.startSeconds - profile.internalSpeechPadSeconds, sourceStartSeconds, sourceEndSeconds));
        if (endSeconds <= startSeconds) {
          return [];
        }

        return [{
          startSeconds,
          endSeconds,
          removedSeconds: roundPlanSeconds(endSeconds - startSeconds),
          rawGapSeconds: roundPlanSeconds(gapSeconds),
        }];
      })
    : [];
  const plannedCuts = hasAudioAnalysis ? audioCuts : transcriptCuts;
  const cuts: SpeechCleanupCut[] = plannedCuts.map((cut) => ({
    startSeconds: cut.startSeconds,
    endSeconds: cut.endSeconds,
    removedSeconds: cut.removedSeconds,
  }));

  const removedRanges: SpeechCleanupRemovedRange[] = [
    ...(sourceStartSeconds > 0
      ? [{
          kind: "edge" as const,
          source: hasAudioAnalysis ? "audio" as const : "transcript" as const,
          confidence: hasAudioAnalysis ? "confirmed" as const : "candidate" as const,
          startSeconds: 0,
          endSeconds: sourceStartSeconds,
          removedSeconds: sourceStartSeconds,
          rawGapSeconds: sourceStartSeconds,
          beforeText: null,
          afterText: sortedCues[0]?.text.trim() ?? null,
        }]
      : []),
    ...plannedCuts.map((cut) => ({
      ...cut,
      kind: "internal" as const,
      source: hasAudioAnalysis ? "audio" as const : "transcript" as const,
      confidence: hasAudioAnalysis ? "confirmed" as const : "candidate" as const,
      rawGapSeconds: cut.rawGapSeconds,
      beforeText: findCaptionCueBefore(sortedCues, cut.startSeconds)?.text.trim() ?? null,
      afterText: findCaptionCueAfter(sortedCues, cut.endSeconds)?.text.trim() ?? null,
    })),
    ...(sourceEndSeconds < duration
      ? [{
          kind: "edge" as const,
          source: hasAudioAnalysis ? "audio" as const : "transcript" as const,
          confidence: hasAudioAnalysis ? "confirmed" as const : "candidate" as const,
          startSeconds: sourceEndSeconds,
          endSeconds: duration,
          removedSeconds: roundPlanSeconds(duration - sourceEndSeconds),
          rawGapSeconds: roundPlanSeconds(duration - sourceEndSeconds),
          beforeText: sortedCues[sortedCues.length - 1]?.text.trim() ?? null,
          afterText: null,
        }]
      : []),
  ];
  const candidateRanges: SpeechCleanupRemovedRange[] = hasAudioAnalysis
    ? transcriptCuts
        .filter((candidate) => {
          const candidateDuration = candidate.endSeconds - candidate.startSeconds;
          const bestOverlap = Math.max(0, ...removedRanges.map((range) => rangeOverlapSeconds(candidate, range)));
          return candidateDuration > 0 && bestOverlap / candidateDuration < 0.4;
        })
        .map((candidate) => ({
          ...candidate,
          kind: "internal" as const,
          source: "transcript" as const,
          confidence: "candidate" as const,
          rawGapSeconds: candidate.rawGapSeconds,
          beforeText: findCaptionCueBefore(sortedCues, candidate.startSeconds)?.text.trim() ?? null,
          afterText: findCaptionCueAfter(sortedCues, candidate.endSeconds)?.text.trim() ?? null,
        }))
    : [];

  const edgeRemovedSeconds = Math.max(0, sourceStartSeconds) + Math.max(0, duration - sourceEndSeconds);
  const cutRemovedSeconds = cuts.reduce((total, cut) => total + cut.removedSeconds, 0);
  const cleanedDurationSeconds = roundPlanSeconds(Math.max(0, duration - edgeRemovedSeconds - cutRemovedSeconds));

  const generatedPlan = {
    enabled: cleanupEnabled,
    sourceStartSeconds,
    sourceEndSeconds,
    cleanedDurationSeconds,
    cuts,
    removedRanges,
    candidateRanges,
    reviewItems: buildReviewItems([...removedRanges, ...candidateRanges]),
    hasAudioAnalysis,
  };

  return applySpeechCleanupEditsToPlan(generatedPlan, speechCleanupEdits ?? null);
}

function buildEditableCutId(range: Pick<SpeechCleanupRemovedRange, "source" | "kind" | "startSeconds" | "endSeconds">, index: number): string {
  return `${range.source}-${range.kind}-${range.startSeconds}-${range.endSeconds}-${index}`;
}

function normalizeEditableCut(
  item: unknown,
  index: number,
  durationSeconds: number,
): SpeechCleanupEditableCut | null {
  const record = asObject(item);
  if (!record) {
    return null;
  }

  const startSeconds = asFiniteNumber(record["startSeconds"]);
  const endSeconds = asFiniteNumber(record["endSeconds"]);
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
    return null;
  }

  const start = roundPlanSeconds(clampPlanSeconds(startSeconds, 0, durationSeconds));
  const end = roundPlanSeconds(clampPlanSeconds(endSeconds, 0, durationSeconds));
  if (end - start < 0.2) {
    return null;
  }

  const source: SpeechCleanupMarkerSource = record["source"] === "transcript" ? "transcript" : "audio";
  const confidence: SpeechCleanupMarkerConfidence = record["confidence"] === "candidate" ? "candidate" : "confirmed";
  const kind: SpeechCleanupRemovedRange["kind"] = record["kind"] === "edge" ? "edge" : "internal";
  const beforeText = typeof record["beforeText"] === "string" ? record["beforeText"] : null;
  const afterText = typeof record["afterText"] === "string" ? record["afterText"] : null;
  const removedSeconds = roundPlanSeconds(end - start);
  const storedRawGapSeconds = asFiniteNumber(record["rawGapSeconds"]);
  const cut: SpeechCleanupRemovedRange = {
    kind,
    source,
    confidence,
    startSeconds: start,
    endSeconds: end,
    removedSeconds,
    rawGapSeconds: roundPlanSeconds(Math.max(
      removedSeconds,
      Math.min(durationSeconds, storedRawGapSeconds ?? removedSeconds),
    )),
    beforeText,
    afterText,
  };

  return {
    ...cut,
    id: typeof record["id"] === "string" && record["id"].trim()
      ? record["id"].trim()
      : buildEditableCutId(cut, index),
    enabled: record["enabled"] !== false,
  };
}

export function normalizeSpeechCleanupEdits(
  value: unknown,
  durationSeconds: number,
): SpeechCleanupEdits | null {
  const record = asObject(value);
  if (!record) {
    return null;
  }

  const rawCuts = Array.isArray(record["cuts"]) ? record["cuts"] : [];
  const cuts = rawCuts
    .flatMap((item, index) => normalizeEditableCut(item, index, durationSeconds) ?? [])
    .filter((cut) => cut.kind === "internal")
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((cut, index) => ({
      ...cut,
      id: cut.id || buildEditableCutId(cut, index),
    }));

  return {
    version: 1,
    cuts,
    updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : undefined,
  };
}

export function createSpeechCleanupEditsFromPlan(plan: SpeechCleanupCutPlan): SpeechCleanupEdits {
  return {
    version: 1,
    cuts: plan.removedRanges
      .filter((range) => range.kind === "internal")
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .map((range, index) => ({
        ...range,
        id: buildEditableCutId(range, index),
        enabled: true,
      })),
  };
}

export function resolveSpeechCleanupEditableCuts(
  plan: SpeechCleanupCutPlan,
  edits: SpeechCleanupEdits | null | undefined,
): SpeechCleanupEditableCut[] {
  if (edits) {
    return edits.cuts.map((cut) => {
      const appliedRange = plan.removedRanges.find((range) =>
        range.kind === "internal"
        && Math.abs(range.startSeconds - cut.startSeconds) < 0.002
        && Math.abs(range.endSeconds - cut.endSeconds) < 0.002,
      );

      return appliedRange
        ? { ...cut, rawGapSeconds: Math.max(cut.rawGapSeconds, appliedRange.rawGapSeconds) }
        : cut;
    });
  }

  return createSpeechCleanupEditsFromPlan(plan).cuts;
}

export function resizeSpeechCleanupEditableCut({
  cut,
  removedSeconds,
  minStartSeconds,
  maxEndSeconds,
  minRemovedSeconds = 0.2,
}: {
  cut: SpeechCleanupEditableCut;
  removedSeconds: number;
  minStartSeconds: number;
  maxEndSeconds: number;
  minRemovedSeconds?: number;
}): SpeechCleanupEditableCut {
  const currentRemovedSeconds = Math.max(0, cut.endSeconds - cut.startSeconds);
  const rawGapSeconds = Math.max(currentRemovedSeconds, cut.rawGapSeconds);
  const safeMinStartSeconds = Number.isFinite(minStartSeconds) ? Math.max(0, minStartSeconds) : 0;
  const safeMaxEndSeconds = Number.isFinite(maxEndSeconds)
    ? Math.max(safeMinStartSeconds, maxEndSeconds)
    : Math.max(cut.endSeconds, safeMinStartSeconds + rawGapSeconds);
  const availableSeconds = Math.max(0, safeMaxEndSeconds - safeMinStartSeconds);
  const maximumRemovedSeconds = Math.min(rawGapSeconds, availableSeconds);

  if (maximumRemovedSeconds <= 0) {
    return cut;
  }

  const minimumRemovedSeconds = Math.min(
    maximumRemovedSeconds,
    Math.max(0, minRemovedSeconds),
  );
  const requestedRemovedSeconds = Number.isFinite(removedSeconds)
    ? removedSeconds
    : currentRemovedSeconds;
  const nextRemovedSeconds = clampPlanSeconds(
    requestedRemovedSeconds,
    minimumRemovedSeconds,
    maximumRemovedSeconds,
  );
  const currentCenterSeconds = (cut.startSeconds + cut.endSeconds) / 2;
  const startSeconds = clampPlanSeconds(
    currentCenterSeconds - nextRemovedSeconds / 2,
    safeMinStartSeconds,
    safeMaxEndSeconds - nextRemovedSeconds,
  );
  const roundedStartSeconds = roundPlanSeconds(startSeconds);
  const roundedEndSeconds = roundPlanSeconds(startSeconds + nextRemovedSeconds);

  return {
    ...cut,
    startSeconds: roundedStartSeconds,
    endSeconds: roundedEndSeconds,
    removedSeconds: roundPlanSeconds(roundedEndSeconds - roundedStartSeconds),
    rawGapSeconds: roundPlanSeconds(rawGapSeconds),
  };
}

export function applySpeechCleanupEditsToPlan(
  plan: SpeechCleanupCutPlan,
  edits: SpeechCleanupEdits | null | undefined,
): SpeechCleanupCutPlan {
  if (!edits) {
    return plan;
  }

  const durationSeconds = Math.max(0, plan.sourceEndSeconds, ...edits.cuts.map((cut) => cut.endSeconds));
  const generatedCutsById = new Map(
    createSpeechCleanupEditsFromPlan(plan).cuts.map((cut) => [cut.id, cut] as const),
  );
  const editableCuts = (normalizeSpeechCleanupEdits(edits, durationSeconds)?.cuts ?? []).map((cut) => ({
    ...cut,
    rawGapSeconds: Math.max(cut.rawGapSeconds, generatedCutsById.get(cut.id)?.rawGapSeconds ?? 0),
  }));
  const activeCuts = editableCuts
    .filter((cut) => cut.enabled)
    .map((cut) => {
      const startSeconds = roundPlanSeconds(clampPlanSeconds(cut.startSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds));
      const endSeconds = roundPlanSeconds(clampPlanSeconds(cut.endSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds));
      return {
        ...cut,
        startSeconds,
        endSeconds,
        removedSeconds: roundPlanSeconds(Math.max(0, endSeconds - startSeconds)),
        rawGapSeconds: roundPlanSeconds(Math.max(cut.rawGapSeconds, endSeconds - startSeconds)),
      };
    })
    .filter((cut) => cut.endSeconds - cut.startSeconds >= 0.2)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const edgeRanges = plan.removedRanges.filter((range) => range.kind === "edge");
  const internalRanges: SpeechCleanupRemovedRange[] = activeCuts.map((cut) => ({
    kind: "internal",
    source: cut.source,
    confidence: cut.confidence,
    startSeconds: cut.startSeconds,
    endSeconds: cut.endSeconds,
    removedSeconds: roundPlanSeconds(cut.endSeconds - cut.startSeconds),
    rawGapSeconds: roundPlanSeconds(Math.max(cut.rawGapSeconds, cut.endSeconds - cut.startSeconds)),
    beforeText: cut.beforeText,
    afterText: cut.afterText,
  }));
  const nextCuts = internalRanges.map((range) => ({
    startSeconds: range.startSeconds,
    endSeconds: range.endSeconds,
    removedSeconds: range.removedSeconds,
  }));
  const internalRemovedSeconds = nextCuts.reduce((total, cut) => total + cut.removedSeconds, 0);
  const sourceDurationSeconds = Math.max(0, plan.sourceEndSeconds - plan.sourceStartSeconds);

  return {
    ...plan,
    enabled: plan.enabled,
    cleanedDurationSeconds: roundPlanSeconds(Math.max(0, sourceDurationSeconds - internalRemovedSeconds)),
    cuts: nextCuts,
    removedRanges: [...edgeRanges, ...internalRanges].sort((left, right) => left.startSeconds - right.startSeconds),
    candidateRanges: [],
    reviewItems: buildReviewItems([...edgeRanges, ...internalRanges]),
  };
}

export function mapSourceSecondsToCleanedSeconds(sourceSeconds: number, plan: SpeechCleanupCutPlan): number {
  const clampedSourceSeconds = clampPlanSeconds(sourceSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds);
  const removedBefore = plan.cuts.reduce((total, cut) => {
    if (clampedSourceSeconds <= cut.startSeconds) {
      return total;
    }

    return total + Math.min(cut.removedSeconds, clampedSourceSeconds - cut.startSeconds);
  }, plan.sourceStartSeconds);

  return roundPlanSeconds(Math.max(0, clampedSourceSeconds - removedBefore));
}

export function mapCleanedSecondsToSourceSeconds(cleanedSeconds: number, plan: SpeechCleanupCutPlan): number {
  let sourceSeconds = plan.sourceStartSeconds + Math.max(0, cleanedSeconds);
  for (const cut of plan.cuts) {
    const cleanedCutStart = mapSourceSecondsToCleanedSeconds(cut.startSeconds, plan);
    if (cleanedSeconds >= cleanedCutStart) {
      sourceSeconds += cut.removedSeconds;
    }
  }

  return roundPlanSeconds(clampPlanSeconds(sourceSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds));
}

export function resolveSpeechCleanupJumpTarget(sourceSeconds: number, plan: SpeechCleanupCutPlan): number | null {
  if (sourceSeconds < plan.sourceStartSeconds) {
    return plan.sourceStartSeconds;
  }

  if (sourceSeconds > plan.sourceEndSeconds) {
    return plan.sourceEndSeconds;
  }

  const activeCut = plan.cuts.find((cut) => sourceSeconds >= cut.startSeconds && sourceSeconds < cut.endSeconds);
  return activeCut ? activeCut.endSeconds : null;
}

export function remapTimelineRangeToCleanedTime({
  startSeconds,
  endSeconds,
  plan,
}: {
  startSeconds: number;
  endSeconds: number;
  plan: SpeechCleanupCutPlan | null | undefined;
}): RemappedTimelineRange | null {
  if (!plan?.enabled) {
    return {
      startSeconds: roundPlanSeconds(Math.max(0, startSeconds)),
      endSeconds: roundPlanSeconds(Math.max(0, endSeconds)),
    };
  }

  if (endSeconds <= plan.sourceStartSeconds || startSeconds >= plan.sourceEndSeconds) {
    return null;
  }

  const clampedStart = clampPlanSeconds(startSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds);
  const clampedEnd = clampPlanSeconds(endSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds);
  if (clampedEnd <= clampedStart) {
    return null;
  }

  const mappedStart = mapSourceSecondsToCleanedSeconds(clampedStart, plan);
  const mappedEnd = mapSourceSecondsToCleanedSeconds(clampedEnd, plan);
  if (mappedEnd <= mappedStart) {
    return null;
  }

  return {
    startSeconds: mappedStart,
    endSeconds: mappedEnd,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function serializeSpeechCleanupCutPlan(plan: SpeechCleanupCutPlan): Record<string, unknown> {
  return {
    version: 1,
    enabled: plan.enabled,
    sourceStartSeconds: plan.sourceStartSeconds,
    sourceEndSeconds: plan.sourceEndSeconds,
    cleanedDurationSeconds: plan.cleanedDurationSeconds,
    cuts: plan.cuts.map((cut) => ({
      startSeconds: cut.startSeconds,
      endSeconds: cut.endSeconds,
      removedSeconds: cut.removedSeconds,
    })),
    hasAudioAnalysis: plan.hasAudioAnalysis,
    generatedAt: new Date().toISOString(),
  };
}

export function serializeSpeechCleanupEdits(edits: SpeechCleanupEdits | null | undefined): Record<string, unknown> | null {
  if (!edits) {
    return null;
  }

  return {
    version: 1,
    cuts: edits.cuts.map((cut) => ({
      id: cut.id,
      enabled: cut.enabled,
      kind: cut.kind,
      source: cut.source,
      confidence: cut.confidence,
      startSeconds: cut.startSeconds,
      endSeconds: cut.endSeconds,
      removedSeconds: cut.removedSeconds,
      rawGapSeconds: cut.rawGapSeconds,
      beforeText: cut.beforeText,
      afterText: cut.afterText,
    })),
    updatedAt: edits.updatedAt ?? new Date().toISOString(),
  };
}

export function extractSpeechCleanupEdits(value: unknown, durationSeconds = Number.POSITIVE_INFINITY): SpeechCleanupEdits | null {
  const root = asObject(value);
  const record = asObject(root?.["speechCleanupEdits"] ?? value);
  return normalizeSpeechCleanupEdits(record, durationSeconds);
}

export function extractSpeechCleanupCutPlan(value: unknown): SpeechCleanupCutPlan | null {
  const root = asObject(value);
  const record = asObject(root?.["speechCleanupPlan"] ?? value);
  if (!record || record["enabled"] !== true) {
    return null;
  }

  const sourceStartSeconds = asFiniteNumber(record["sourceStartSeconds"]);
  const sourceEndSeconds = asFiniteNumber(record["sourceEndSeconds"]);
  const cleanedDurationSeconds = asFiniteNumber(record["cleanedDurationSeconds"]);
  const rawCuts = Array.isArray(record["cuts"]) ? record["cuts"] : [];
  const cuts = rawCuts.flatMap((item): SpeechCleanupCut[] => {
    const cut = asObject(item);
    if (!cut) {
      return [];
    }

    const startSeconds = asFiniteNumber(cut["startSeconds"]);
    const endSeconds = asFiniteNumber(cut["endSeconds"]);
    const removedSeconds = asFiniteNumber(cut["removedSeconds"]);
    if (
      startSeconds === null ||
      endSeconds === null ||
      removedSeconds === null ||
      endSeconds <= startSeconds ||
      removedSeconds <= 0
    ) {
      return [];
    }

    return [{ startSeconds, endSeconds, removedSeconds }];
  });

  if (
    sourceStartSeconds === null ||
    sourceEndSeconds === null ||
    cleanedDurationSeconds === null ||
    sourceEndSeconds <= sourceStartSeconds
  ) {
    return null;
  }

  return {
    enabled: true,
    sourceStartSeconds,
    sourceEndSeconds,
    cleanedDurationSeconds,
    cuts,
    removedRanges: [],
    candidateRanges: [],
    reviewItems: [],
    hasAudioAnalysis: record["hasAudioAnalysis"] === true,
  };
}
