import {
  assessTranscriptGap,
  classifySermonSegment,
  hasTerminalThoughtPunctuation,
  isLikelyContinuationChunk,
} from "@/server/agents/sermonThoughtSegmentation";

export const TEACHING_VIDEO_TARGET_MIN_SECONDS = 5 * 60;
export const TEACHING_VIDEO_TARGET_MAX_SECONDS = 12 * 60;
export const TEACHING_VIDEO_WINDOW_SECONDS = 18 * 60;
export const TEACHING_VIDEO_WINDOW_OVERLAP_SECONDS = 3 * 60;
export const TEACHING_VIDEO_MAX_SUGGESTIONS = 8;

export type TeachingTranscriptSegment = {
  id?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  speakerLabel?: string | null;
  confidence?: number | null;
};

export type TeachingTranscriptAnchor = TeachingTranscriptSegment & {
  segmentIndex: number;
  startAnchorId: string;
  endAnchorId: string;
};

export type TeachingTranscriptWindow = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: TeachingTranscriptAnchor[];
};

export type TeachingBoundaryResult = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  startAnchorId: string;
  endAnchorId: string;
  quality: "GOOD" | "NEEDS_REVIEW" | "BLOCKED";
  reasons: string[];
  riskFlags: string[];
};

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function anchorBase(index: number): string {
  return `segment-${String(index).padStart(6, "0")}`;
}

export function buildTeachingTranscriptAnchors(
  segments: TeachingTranscriptSegment[],
): TeachingTranscriptAnchor[] {
  return segments
    .filter((segment) => (
      Number.isFinite(segment.startTimeSeconds)
      && Number.isFinite(segment.endTimeSeconds)
      && segment.endTimeSeconds > segment.startTimeSeconds
      && segment.text.trim().length > 0
    ))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .map((segment, segmentIndex) => {
      const base = anchorBase(segmentIndex);
      return {
        ...segment,
        text: segment.text.replace(/\s+/g, " ").trim(),
        segmentIndex,
        startAnchorId: `${base}:start`,
        endAnchorId: `${base}:end`,
      };
    });
}

export function buildTeachingTranscriptWindows(
  anchors: TeachingTranscriptAnchor[],
  options?: {
    startTimeSeconds?: number;
    endTimeSeconds?: number;
    windowSeconds?: number;
    overlapSeconds?: number;
  },
): TeachingTranscriptWindow[] {
  if (anchors.length === 0) return [];

  const configuredStart = options?.startTimeSeconds ?? anchors[0].startTimeSeconds;
  const configuredEnd = options?.endTimeSeconds ?? anchors.at(-1)!.endTimeSeconds;
  const sermonStart = Math.max(anchors[0].startTimeSeconds, configuredStart);
  const sermonEnd = Math.min(anchors.at(-1)!.endTimeSeconds, configuredEnd);
  if (sermonEnd <= sermonStart) return [];

  const windowSeconds = Math.max(60, options?.windowSeconds ?? TEACHING_VIDEO_WINDOW_SECONDS);
  const overlapSeconds = Math.min(
    windowSeconds - 1,
    Math.max(0, options?.overlapSeconds ?? TEACHING_VIDEO_WINDOW_OVERLAP_SECONDS),
  );
  const stepSeconds = windowSeconds - overlapSeconds;
  const windows: TeachingTranscriptWindow[] = [];

  for (let windowStart = sermonStart, index = 0; windowStart < sermonEnd; windowStart += stepSeconds, index += 1) {
    const windowEnd = Math.min(sermonEnd, windowStart + windowSeconds);
    const segments = anchors.filter((segment) => (
      segment.endTimeSeconds >= windowStart
      && segment.startTimeSeconds <= windowEnd
    ));
    if (segments.length > 0) {
      windows.push({
        id: `teaching-window-${String(index + 1).padStart(3, "0")}`,
        startTimeSeconds: roundSeconds(windowStart),
        endTimeSeconds: roundSeconds(windowEnd),
        segments,
      });
    }
    if (windowEnd >= sermonEnd) break;
  }

  return windows;
}

function nearestStartIndex(anchors: TeachingTranscriptAnchor[], seconds: number): number {
  const nearBoundary = anchors.findIndex(
    (segment) => Math.abs(segment.startTimeSeconds - seconds) <= 0.5,
  );
  if (nearBoundary >= 0) return nearBoundary;
  const containing = anchors.findIndex((segment) => (
    seconds >= segment.startTimeSeconds && seconds < segment.endTimeSeconds
  ));
  if (containing >= 0) return containing;
  return anchors.reduce((best, segment, index) => (
    Math.abs(segment.startTimeSeconds - seconds)
      < Math.abs(anchors[best].startTimeSeconds - seconds)
      ? index
      : best
  ), 0);
}

function nearestEndIndex(anchors: TeachingTranscriptAnchor[], seconds: number): number {
  const nearBoundary = anchors.findIndex(
    (segment) => Math.abs(segment.endTimeSeconds - seconds) <= 0.5,
  );
  if (nearBoundary >= 0) return nearBoundary;
  const containing = anchors.findIndex((segment) => (
    seconds > segment.startTimeSeconds && seconds <= segment.endTimeSeconds
  ));
  if (containing >= 0) return containing;
  return anchors.reduce((best, segment, index) => (
    Math.abs(segment.endTimeSeconds - seconds)
      < Math.abs(anchors[best].endTimeSeconds - seconds)
      ? index
      : best
  ), 0);
}

export function refineTeachingVideoBoundaries(
  anchors: TeachingTranscriptAnchor[],
  requestedStartSeconds: number,
  requestedEndSeconds: number,
  sourceDurationSeconds?: number | null,
): TeachingBoundaryResult {
  if (
    anchors.length === 0
    || !Number.isFinite(requestedStartSeconds)
    || !Number.isFinite(requestedEndSeconds)
    || requestedStartSeconds < 0
    || requestedEndSeconds <= requestedStartSeconds
  ) {
    return {
      startTimeSeconds: Math.max(0, requestedStartSeconds || 0),
      endTimeSeconds: Math.max(0, requestedEndSeconds || 0),
      startAnchorId: "",
      endAnchorId: "",
      quality: "BLOCKED",
      reasons: ["The requested range is invalid or has no transcript anchors."],
      riskFlags: ["INVALID_RANGE"],
    };
  }

  let startIndex = nearestStartIndex(anchors, requestedStartSeconds);
  let endIndex = nearestEndIndex(anchors, requestedEndSeconds);
  const reasons: string[] = [];
  const risks = new Set<string>();

  while (
    startIndex > 0
    && isLikelyContinuationChunk(anchors[startIndex], anchors[startIndex - 1])
  ) {
    startIndex -= 1;
    reasons.push("Start expanded to avoid beginning mid-sentence.");
  }

  let endExpansion = 0;
  while (
    endIndex < anchors.length - 1
    && !hasTerminalThoughtPunctuation(anchors[endIndex].text)
    && endExpansion < 8
  ) {
    endIndex += 1;
    endExpansion += 1;
  }
  if (endExpansion > 0) {
    reasons.push("End expanded to reach a complete sentence.");
  }

  if (endIndex < startIndex) {
    return {
      startTimeSeconds: requestedStartSeconds,
      endTimeSeconds: requestedEndSeconds,
      startAnchorId: anchors[startIndex].startAnchorId,
      endAnchorId: anchors[endIndex].endAnchorId,
      quality: "BLOCKED",
      reasons: ["The refined end precedes the refined start."],
      riskFlags: ["INVALID_RANGE"],
    };
  }

  const selected = anchors.slice(startIndex, endIndex + 1);
  for (let index = 1; index < selected.length; index += 1) {
    const gap = assessTranscriptGap(selected[index - 1], selected[index], index - 1);
    if (gap.severity === "LONG") risks.add("LONG_TRANSCRIPT_GAP");
  }
  if (selected.some((segment) => (segment.confidence ?? 1) < 0.65)) {
    risks.add("LOW_TRANSCRIPT_CONFIDENCE");
  }

  const startClassification = classifySermonSegment(selected[0].text);
  const endClassification = classifySermonSegment(selected.at(-1)!.text);
  if (startClassification.beginsWithContinuationMarker) {
    risks.add("POSSIBLE_CONTEXT_DEPENDENCY");
  }
  if (!endClassification.hasTerminalPunctuation) {
    risks.add("POSSIBLE_INCOMPLETE_ENDING");
  }
  if (
    startClassification.signals.includes("PRAYER")
    || endClassification.signals.includes("PRAYER")
  ) {
    risks.add("PRAYER_BOUNDARY_REVIEW");
  }

  const startTimeSeconds = roundSeconds(Math.max(0, selected[0].startTimeSeconds - 0.2));
  const upperBound = sourceDurationSeconds && sourceDurationSeconds > 0
    ? sourceDurationSeconds
    : selected.at(-1)!.endTimeSeconds + 0.35;
  const endTimeSeconds = roundSeconds(Math.min(upperBound, selected.at(-1)!.endTimeSeconds + 0.25));
  const quality = risks.has("POSSIBLE_INCOMPLETE_ENDING")
    ? "NEEDS_REVIEW"
    : risks.size > 0
      ? "NEEDS_REVIEW"
      : "GOOD";

  return {
    startTimeSeconds,
    endTimeSeconds,
    startAnchorId: selected[0].startAnchorId,
    endAnchorId: selected.at(-1)!.endAnchorId,
    quality,
    reasons: reasons.length > 0 ? reasons : ["Range aligns with complete transcript boundaries."],
    riskFlags: [...risks],
  };
}

export function rangesSubstantiallyOverlap(
  first: { startTimeSeconds: number; endTimeSeconds: number },
  second: { startTimeSeconds: number; endTimeSeconds: number },
  threshold = 0.65,
): boolean {
  const overlap = Math.max(
    0,
    Math.min(first.endTimeSeconds, second.endTimeSeconds)
      - Math.max(first.startTimeSeconds, second.startTimeSeconds),
  );
  const shorter = Math.min(
    first.endTimeSeconds - first.startTimeSeconds,
    second.endTimeSeconds - second.startTimeSeconds,
  );
  return shorter > 0 && overlap / shorter >= threshold;
}

export function formatTeachingVideoTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}
