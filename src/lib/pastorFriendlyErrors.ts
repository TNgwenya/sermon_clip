import { resolveClipReviewAcceptanceFloor } from "@/lib/clipVolumeTargets";

export type TranscriptDiagnosticSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type TranscriptFailureDiagnostics = {
  wordCount: number;
  segmentCount: number;
  timelineDurationSeconds: number;
  coveredSeconds: number;
  coveragePercent: number;
  largeGapCount: number;
  maxGapSeconds: number;
};

export type PastorProcessingFailurePresentation = {
  kind: "CLIP_QUALITY_GATE" | "GENERIC";
  title: string;
  summary: string;
  guidance: string;
  retryAfterTranscriptRefresh: boolean;
  metrics: Array<{
    label: string;
    value: string;
  }>;
};

type PastorProcessingFailureInput = {
  message: string | null | undefined;
  transcriptDiagnostics?: TranscriptFailureDiagnostics | null;
  transcriptRefreshedAfterFailure?: boolean;
};

type ClipQualityGateEvidence = {
  foundCount: number;
  targetRange: string;
  targetMinimum: number;
  acceptanceFloor: number;
};

const LEGACY_CLIP_QUALITY_GATE_PATTERN = /clip generation produced\s+(\d+)\s+pastor-review option(?:\(s\)|s)?\s*,?\s*below the\s+(\d+\s*[-\u2013]\s*\d+)\s+target minimum of\s+(\d+)/i;
const CLIP_QUALITY_GATE_PATTERN = /clip generation produced\s+(\d+)\s+pastor-review option(?:\(s\)|s)?\s*,?\s*below the acceptance floor of\s+(\d+)\s+for the\s+(\d+\s*[-\u2013]\s*\d+)\s+duration target\s*\(target minimum\s+(\d+)\)/i;
const LARGE_TRANSCRIPT_GAP_SECONDS = 45;

function parseClipQualityGate(message: string): ClipQualityGateEvidence | null {
  const currentMatch = message.match(CLIP_QUALITY_GATE_PATTERN);
  if (currentMatch) {
    const foundCount = Number(currentMatch[1]);
    const acceptanceFloor = Number(currentMatch[2]);
    const targetMinimum = Number(currentMatch[4]);
    if (!Number.isFinite(foundCount) || !Number.isFinite(acceptanceFloor) || !Number.isFinite(targetMinimum)) {
      return null;
    }

    return {
      foundCount,
      targetRange: currentMatch[3].replace(/\s+/g, "").replace("-", "\u2013"),
      targetMinimum,
      acceptanceFloor,
    };
  }

  const match = message.match(LEGACY_CLIP_QUALITY_GATE_PATTERN);
  if (!match) return null;

  const foundCount = Number(match[1]);
  const targetMinimum = Number(match[3]);
  if (!Number.isFinite(foundCount) || !Number.isFinite(targetMinimum)) {
    return null;
  }

  return {
    foundCount,
    targetRange: match[2].replace(/\s+/g, "").replace("-", "\u2013"),
    targetMinimum,
    acceptanceFloor: resolveClipReviewAcceptanceFloor(targetMinimum),
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/g).filter(Boolean).length;
}

function formatDiagnosticDuration(durationSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(durationSeconds));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function summarizeTranscriptFailureDiagnostics(
  segments: TranscriptDiagnosticSegment[],
): TranscriptFailureDiagnostics | null {
  const ordered = segments
    .filter((segment) => (
      Number.isFinite(segment.startTimeSeconds) &&
      Number.isFinite(segment.endTimeSeconds) &&
      segment.endTimeSeconds > segment.startTimeSeconds
    ))
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);

  if (ordered.length === 0) {
    return null;
  }

  const timelineStart = ordered[0].startTimeSeconds;
  const timelineEnd = Math.max(...ordered.map((segment) => segment.endTimeSeconds));
  const timelineDurationSeconds = Math.max(0, timelineEnd - timelineStart);
  const coveredSeconds = ordered.reduce(
    (total, segment) => total + Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds),
    0,
  );
  const gaps = ordered.slice(1).map((segment, index) => (
    Math.max(0, segment.startTimeSeconds - ordered[index].endTimeSeconds)
  ));
  const maxGapSeconds = gaps.length > 0 ? Math.max(...gaps) : 0;
  const coverageRatio = timelineDurationSeconds > 0 ? coveredSeconds / timelineDurationSeconds : 0;

  return {
    wordCount: ordered.reduce((total, segment) => total + countWords(segment.text), 0),
    segmentCount: ordered.length,
    timelineDurationSeconds,
    coveredSeconds,
    coveragePercent: Number((Math.min(1, Math.max(0, coverageRatio)) * 100).toFixed(1)),
    largeGapCount: gaps.filter((gap) => gap >= LARGE_TRANSCRIPT_GAP_SECONDS).length,
    maxGapSeconds,
  };
}

function qualityGateGuidance(
  diagnostics: TranscriptFailureDiagnostics | null | undefined,
  transcriptRefreshedAfterFailure: boolean,
): string {
  if (transcriptRefreshedAfterFailure) {
    return "The transcript has been refreshed since this check stopped. Retry clip discovery now so Sermon Clip can assess the new transcript.";
  }

  if (diagnostics && (diagnostics.coveragePercent < 60 || diagnostics.maxGapSeconds > 60)) {
    return [
      `The transcript covers about ${Math.round(diagnostics.coveragePercent)}% of its spoken timeline`,
      diagnostics.largeGapCount > 0
        ? `and has ${diagnostics.largeGapCount} gap${diagnostics.largeGapCount === 1 ? "" : "s"} of at least 45 seconds (longest ${formatDiagnosticDuration(diagnostics.maxGapSeconds)}).`
        : ".",
      "Check the audio and sermon start/end window, then transcribe the sermon again before retrying clip discovery.",
    ].join(" ");
  }

  return "Review the transcript for missing or repeated sections, check the sermon start/end window, then transcribe the sermon again before retrying clip discovery.";
}

export function buildPastorProcessingFailurePresentation({
  message,
  transcriptDiagnostics,
  transcriptRefreshedAfterFailure = false,
}: PastorProcessingFailureInput): PastorProcessingFailurePresentation {
  const normalizedMessage = message?.trim() ?? "";
  const qualityGate = parseClipQualityGate(normalizedMessage);

  if (qualityGate) {
    const metrics = [
      { label: "Distinct moments found", value: String(qualityGate.foundCount) },
      { label: "Safety floor", value: String(qualityGate.acceptanceFloor) },
      { label: "Normal target", value: qualityGate.targetRange },
    ];
    if (transcriptDiagnostics) {
      metrics.push(
        { label: "Transcript coverage", value: `${Math.round(transcriptDiagnostics.coveragePercent)}%` },
        { label: "Large transcript gaps", value: String(transcriptDiagnostics.largeGapCount) },
      );
    }

    return {
      kind: "CLIP_QUALITY_GATE",
      title: transcriptRefreshedAfterFailure
        ? "The transcript is ready for another clip check"
        : "Improve the transcript before finding clips again",
      summary: `Sermon Clip found ${qualityGate.foundCount} distinct review moment${qualityGate.foundCount === 1 ? "" : "s"}. It needs at least ${qualityGate.acceptanceFloor} to save a trustworthy review board; the normal target for this sermon is ${qualityGate.targetRange}. It stopped before replacing or saving a weak set.`,
      guidance: qualityGateGuidance(transcriptDiagnostics, transcriptRefreshedAfterFailure),
      retryAfterTranscriptRefresh: true,
      metrics,
    };
  }

  return {
    kind: "GENERIC",
    title: "This processing step needs attention",
    summary: pastorFriendlyError(normalizedMessage),
    guidance: "Retry the failed step. If it fails again, open the technical details below and share the job reference with support.",
    retryAfterTranscriptRefresh: false,
    metrics: [],
  };
}

export function pastorFriendlyError(message: string | null | undefined): string {
  if (!message?.trim()) {
    return "Something went wrong while preparing this clip. Please retry the step.";
  }

  const lower = message.toLowerCase();

  if (lower.includes("drawtext") || lower.includes("filter not found")) {
    return "Text or branding overlay rendering failed because this FFmpeg install is missing the text overlay filter. The clip may still be downloadable without that overlay.";
  }

  if (lower.includes("source video") || lower.includes("source clip") || lower.includes("does not exist")) {
    return "The app could not find the video file it needs. Check that the sermon media still exists, then retry.";
  }

  if (lower.includes("already in progress")) {
    return "This clip is already being processed. Wait for the current step to finish, then refresh.";
  }

  if (lower.includes("must be rendered")) {
    return "Render the clip first, then try this step again.";
  }

  if (lower.includes("must be approved")) {
    return "Approve this clip before running this step.";
  }

  return "This step failed. Please retry it, and check the technical details if it fails again.";
}
