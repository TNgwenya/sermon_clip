import { analyzeClipCoherence } from "@/server/agents/clipCoherenceAnalysis";

export const CLIP_ARC_TYPES = [
  "PROBLEM_TRUTH_APPLICATION",
  "QUESTION_SCRIPTURE_ANSWER",
  "STORY_LESSON_PUNCHLINE",
  "PAIN_HOPE_DECLARATION",
  "CORRECTION_EXPLANATION_CALL",
  "SCRIPTURE_EXPLANATION_APPLICATION",
  "QUOTE_WITH_CONTEXT",
  "TESTIMONY_TO_APPLICATION",
  "ALTAR_CALL_INVITATION",
] as const;

export type ClipArcType = typeof CLIP_ARC_TYPES[number];

export type ClipArcAnalysis = {
  clipArcType: ClipArcType;
  arcSummary: string;
  setupStartTime: number | null;
  mainPointTime: number | null;
  payoffTime: number | null;
  applicationTime: number | null;
  whyThisClipFeelsComplete: string;
  whatContextMightBeMissing: string | null;
  arcCompletenessScore: number;
};

type ArcCandidate = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  title: string;
  hook: string;
  clipType: string;
  smartClipCategory?: string | null;
  contextWarning?: boolean;
  arcType?: ClipArcType | null;
  arcSummary?: string | null;
  setupStartTime?: number | null;
  mainPointTime?: number | null;
  payoffTime?: number | null;
  applicationTime?: number | null;
  whyThisClipFeelsComplete?: string | null;
  whatContextMightBeMissing?: string | null;
};

type TranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

const SCRIPTURE_PATTERN = /\b(scripture|bible|verse|john|romans|psalm|isaiah|matthew|mark|luke|acts|corinthians|genesis|revelation)\b/i;
const QUESTION_PATTERN = /\?/;
const STORY_PATTERN = /\b(story|testimony|i remember|when i|one day|years ago)\b/i;
const PAIN_PATTERN = /\b(pain|hurt|broken|fear|weary|struggle|anxiety|lost)\b/i;
const HOPE_PATTERN = /\b(hope|grace|mercy|faith|healing|restoration|god will|jesus can)\b/i;
const APPLICATION_PATTERN = /\b(apply|today|this week|you need to|we need to|walk in|trust|believe|pray|come|respond|choose)\b/i;
const CORRECTION_PATTERN = /\b(not|stop|repent|correction|instead|but god|the truth is)\b/i;
const QUOTE_PATTERN = /\b(remember this|hear me|the point is|here is the point|i want you to know|never forget)\b/i;
const ALTAR_PATTERN = /\b(altar|salvation|give your life|come to jesus|receive jesus|respond to god|pray this prayer)\b/i;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function midpoint(candidate: ArcCandidate, ratio: number): number {
  return Number((candidate.startTimeSeconds + candidate.durationSeconds * ratio).toFixed(2));
}

function matchingSegmentTime(segments: TranscriptSegment[] | undefined, pattern: RegExp): number | null {
  const segment = segments?.find((item) => pattern.test(item.text));
  return segment?.startTimeSeconds ?? null;
}

function inferArcType(text: string): ClipArcType {
  if (ALTAR_PATTERN.test(text)) {
    return "ALTAR_CALL_INVITATION";
  }
  if (STORY_PATTERN.test(text) && APPLICATION_PATTERN.test(text)) {
    return "TESTIMONY_TO_APPLICATION";
  }
  if (STORY_PATTERN.test(text)) {
    return "STORY_LESSON_PUNCHLINE";
  }
  if (SCRIPTURE_PATTERN.test(text) && APPLICATION_PATTERN.test(text)) {
    return "SCRIPTURE_EXPLANATION_APPLICATION";
  }
  if (QUESTION_PATTERN.test(text) && SCRIPTURE_PATTERN.test(text)) {
    return "QUESTION_SCRIPTURE_ANSWER";
  }
  if (PAIN_PATTERN.test(text) && HOPE_PATTERN.test(text)) {
    return "PAIN_HOPE_DECLARATION";
  }
  if (CORRECTION_PATTERN.test(text) && APPLICATION_PATTERN.test(text)) {
    return "CORRECTION_EXPLANATION_CALL";
  }
  if (QUOTE_PATTERN.test(text)) {
    return "QUOTE_WITH_CONTEXT";
  }

  return "PROBLEM_TRUTH_APPLICATION";
}

export function detectClipArc(candidate: ArcCandidate, segments?: TranscriptSegment[]): ClipArcAnalysis {
  const text = `${candidate.title} ${candidate.hook} ${candidate.smartClipCategory ?? ""} ${candidate.clipType} ${candidate.transcriptText}`;
  const coherence = analyzeClipCoherence(candidate.transcriptText);
  const arcType = candidate.arcType ?? inferArcType(text);
  const hasSetup = candidate.durationSeconds >= 30 && coherence.openingStatus === "CLEAN" && !coherence.setupOnly;
  const hasMainPoint = coherence.hasSpiritualAnchor || /\b(god|jesus|scripture|truth|point|means|faith|grace|pray|trust|believe)\b/i.test(text);
  const hasPayoff = coherence.endingStatus === "CLEAN" && coherence.landingStatus !== "NONE";
  const hasApplication =
    coherence.landingStatus === "APPLICATION" ||
    coherence.landingStatus === "INVITATION" ||
    ALTAR_PATTERN.test(text);
  const missing: string[] = [];

  if (!hasSetup) missing.push("setup");
  if (!hasMainPoint) missing.push("clear main point");
  if (!hasPayoff) missing.push("payoff or clean ending");
  if (!hasApplication && !["QUOTE_WITH_CONTEXT", "STORY_LESSON_PUNCHLINE"].includes(arcType)) missing.push("application");

  let score = 4.2;
  if (hasSetup) score += 1.5;
  if (hasMainPoint) score += 2;
  if (hasPayoff) score += 1.4;
  if (hasApplication) score += 1.2;
  if (candidate.contextWarning) score -= 1.2;

  return {
    clipArcType: arcType,
    arcSummary: candidate.arcSummary ?? `${arcType.toLowerCase().replace(/_/g, " ")} arc based on the clip opening, main point, and landing.`,
    setupStartTime: candidate.setupStartTime ?? matchingSegmentTime(segments, QUESTION_PATTERN) ?? candidate.startTimeSeconds,
    mainPointTime: candidate.mainPointTime ?? matchingSegmentTime(segments, /\b(point|truth|means|god|jesus|scripture)\b/i) ?? midpoint(candidate, 0.35),
    payoffTime: candidate.payoffTime ?? matchingSegmentTime(segments, /\b(therefore|so|remember|amen|that means|the point is)\b/i) ?? midpoint(candidate, 0.78),
    applicationTime: candidate.applicationTime ?? matchingSegmentTime(segments, APPLICATION_PATTERN) ?? (hasApplication ? midpoint(candidate, 0.88) : null),
    whyThisClipFeelsComplete: candidate.whyThisClipFeelsComplete ?? (missing.length === 0
      ? "The clip has enough setup, one clear main point, and a natural landing point."
      : "The clip has useful content but may not fully land without review."),
    whatContextMightBeMissing: candidate.whatContextMightBeMissing ?? (missing.length > 0 ? `May need stronger ${missing.join(", ")}.` : null),
    arcCompletenessScore: clampScore(score),
  };
}

export const __clipArcDetectionTestUtils = {
  inferArcType,
};
