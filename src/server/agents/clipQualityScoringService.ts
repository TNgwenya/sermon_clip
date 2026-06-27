import { detectClipArc, type ClipArcAnalysis } from "@/server/agents/clipArcDetection";
import type { ClipArcType } from "@/server/agents/clipArcDetection";
import { analyzeClipHook, type ClipHookAnalysis } from "@/server/agents/clipHookAnalysisService";
import { scoreDurationQuality, type ClipDurationQuality } from "@/server/agents/durationQualityScoring";
import { scoreAudioQuality, type AudioQualityResult } from "@/server/agents/audioQualityScoringService";
import {
  parseCaptionDataCues,
  validateCaptionQuality,
  type CaptionQualityResult,
} from "@/server/agents/captionQualityValidationService";
import {
  hasHardQualityWarning,
} from "@/server/agents/clipCandidatePolicy";
import {
  analyzeClipCoherence,
} from "@/server/agents/clipCoherenceAnalysis";
import { reviewPostReady, type PostReadyReviewResult } from "@/server/agents/postReadyReviewService";

export type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";
export type ClipRankingCategory =
  | "BEST_OVERALL"
  | "BEST_TEACHING_CLIP"
  | "BEST_EMOTIONAL_CLIP"
  | "BEST_QUOTE_PUNCHLINE_CLIP"
  | "BEST_APPLICATION_CLIP"
  | "NEEDS_REVIEW"
  | "REJECTED";

export type ProfessionalQualityCandidate = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  title: string;
  hook: string;
  caption: string;
  score: number;
  clipType: string;
  smartClipCategory?: string | null;
  ministryValue?: string | null;
  socialValue?: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  contextWarning: boolean;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
  hookScore?: number | null;
  boundaryQualityScore?: number | null;
  standaloneClarityScore?: number | null;
  emotionalImpactScore?: number | null;
  sermonValueScore?: number | null;
  shareabilityScore?: number | null;
  visualReadinessScore?: number | null;
  visualConfidenceScore?: number | null;
  visualQualityScore?: number | null;
  audioQualityScore?: number | null;
  averageLoudness?: number | null;
  peakLoudness?: number | null;
  silenceAtBeginningSeconds?: number | null;
  silenceAtEndSeconds?: number | null;
  longestInternalSilenceSeconds?: number | null;
  internalSilenceCount?: number | null;
  audioWarnings?: string[] | null;
  captionQualityScore?: number | null;
  captionStatus?: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED" | string | null;
  captionData?: unknown;
  renderStatus?: string | null;
  qualityWarnings?: string[] | null;
  arcType?: ClipArcType | null;
  arcSummary?: string | null;
  setupStartTime?: number | null;
  mainPointTime?: number | null;
  payoffTime?: number | null;
  applicationTime?: number | null;
  whyThisClipFeelsComplete?: string | null;
  whatContextMightBeMissing?: string | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  completenessWarnings?: string[] | null;
};

export type ProfessionalQualityFields = ClipHookAnalysis & ClipArcAnalysis & ClipDurationQuality & AudioQualityResult & {
  standaloneClarityScore: number;
  emotionalWeightScore: number;
  ministryValueScore: number;
  boundaryQualityScore: number;
  visualConfidenceScore: number;
  socialShareabilityScore: number;
  captionQualityScore: number;
  captionQualityWarnings: string[];
  finalQualityScore: number;
  qualityLabel: ClipQualityLabel;
  qualityReasons: string[];
  qualityWarnings: string[];
  rankingCategory: ClipRankingCategory;
  bestPlatform: string;
} & PostReadyReviewResult;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function scoreBoundaryQuality(boundaryQuality: ProfessionalQualityCandidate["boundaryQuality"]): number {
  if (boundaryQuality === "GOOD") return 9;
  if (boundaryQuality === "NEEDS_REVIEW") return 5.8;
  return 2.2;
}

function scoreStandalone(candidate: ProfessionalQualityCandidate): number {
  if (candidate.standaloneClarityScore !== undefined && candidate.standaloneClarityScore !== null) {
    return candidate.standaloneClarityScore;
  }

  let score = candidate.boundaryQuality === "GOOD" ? 7.4 : 5.8;
  if (/^(and|so|but|because)\b/i.test(candidate.transcriptText.trim())) score -= 1.3;
  if (candidate.contextWarning) score -= 1;
  if (/[.!?]["')\]]*$/u.test(candidate.transcriptText.trim())) score += 0.7;
  return clampScore(score);
}

function scoreMinistryValue(candidate: ProfessionalQualityCandidate): number {
  if (candidate.sermonValueScore !== undefined && candidate.sermonValueScore !== null) {
    return candidate.sermonValueScore;
  }

  let score = candidate.score;
  const text = `${candidate.ministryValue ?? ""} ${candidate.transcriptText}`;
  if (/\b(scripture|prayer|salvation|faith|grace|hope|discipleship|encourage|forgive|worship)\b/i.test(text)) score += 1;
  return clampScore(score);
}

function inferRankingCategory(candidate: ProfessionalQualityCandidate, finalQualityScore: number, label: ClipQualityLabel): ClipRankingCategory {
  if (label === "REJECT") return "REJECTED";
  if (label !== "POST_READY" && label !== "GOOD_NEEDS_REVIEW") return "NEEDS_REVIEW";

  const text = `${candidate.clipType} ${candidate.smartClipCategory ?? ""} ${candidate.title} ${candidate.transcriptText}`.toLowerCase();
  if (/quote|punchline|remember this|hear me/.test(text)) return "BEST_QUOTE_PUNCHLINE_CLIP";
  if (/emotion|encourag|hope|pain|healing|prayer|ministry/.test(text)) return "BEST_EMOTIONAL_CLIP";
  if (/apply|application|today|walk in|trust|choose/.test(text)) return "BEST_APPLICATION_CLIP";
  if (/teach|scripture|bible|verse|explanation/.test(text)) return "BEST_TEACHING_CLIP";
  return finalQualityScore >= 8 ? "BEST_OVERALL" : "NEEDS_REVIEW";
}

function bestPlatform(candidate: ProfessionalQualityCandidate, durationSeconds: number): string {
  const text = `${candidate.clipType} ${candidate.smartClipCategory ?? ""}`.toLowerCase();
  if (durationSeconds <= 60 && /quote|inspirational|funny/.test(text)) return "Instagram Reels";
  if (durationSeconds <= 90) return "YouTube Shorts";
  return "Facebook";
}

function normalizeCaption(captionResult: CaptionQualityResult): Pick<ProfessionalQualityFields, "captionQualityScore" | "captionQualityWarnings"> {
  return {
    captionQualityScore: captionResult.captionQualityScore,
    captionQualityWarnings: captionResult.captionWarnings,
  };
}

function hasCaptionCues(captionData: unknown): boolean {
  return Boolean(
    captionData &&
      typeof captionData === "object" &&
      !Array.isArray(captionData) &&
      Array.isArray((captionData as Record<string, unknown>).cues),
  );
}

function scoreCaptionLifecycle(candidate: ProfessionalQualityCandidate): Pick<ProfessionalQualityFields, "captionQualityScore" | "captionQualityWarnings"> {
  if (typeof candidate.captionQualityScore === "number") {
    return {
      captionQualityScore: candidate.captionQualityScore,
      captionQualityWarnings: [],
    };
  }

  if (candidate.captionStatus === "FAILED") {
    return {
      captionQualityScore: 3.5,
      captionQualityWarnings: ["MISSING_CAPTION_SEGMENTS"],
    };
  }

  if (!hasCaptionCues(candidate.captionData)) {
    return {
      captionQualityScore: 7,
      captionQualityWarnings: [],
    };
  }

  return normalizeCaption(validateCaptionQuality({
    clipStartTimeSeconds: candidate.startTimeSeconds,
    clipEndTimeSeconds: candidate.endTimeSeconds,
    transcriptText: candidate.transcriptText,
    captionText: candidate.caption,
    cues: parseCaptionDataCues({
      captionData: candidate.captionData,
      clipStartTimeSeconds: candidate.startTimeSeconds,
    }),
  }));
}

const MIN_PASTOR_GRADE_TRANSCRIPT_WORDS = 18;
const MIN_PASTOR_GRADE_QUOTE_WORDS = 12;
const MIN_PASTOR_GRADE_WORDS_PER_MINUTE = 18;

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .length;
}

const FILLER_TOKEN_PATTERN = /\b(?:u+h+|u+m+|u+h*m+|e+r+|a+h+|h+m+|mmm+)\b/gi;
const FILLER_PHRASE_PATTERN = /\b(?:you know|i mean|sort of|kind of)\b/gi;

function analyzeSpeechPolish(text: string): {
  wordCount: number;
  fillerCount: number;
  fillerDensity: number;
  warnings: string[];
} {
  const wordCount = countWords(text);
  const fillerTokenCount = (text.match(FILLER_TOKEN_PATTERN) ?? []).length;
  const fillerPhraseCount = (text.match(FILLER_PHRASE_PATTERN) ?? []).length;
  const fillerCount = fillerTokenCount + fillerPhraseCount;
  const fillerDensity = wordCount > 0 ? Number((fillerCount / wordCount).toFixed(3)) : 0;
  const warnings: string[] = [];

  if (fillerCount >= 5 || (fillerCount >= 3 && fillerDensity >= 0.055)) {
    warnings.push("FILLER_WORD_DENSITY");
    warnings.push("SPEECH_POLISH_NEEDED");
  }

  return {
    wordCount,
    fillerCount,
    fillerDensity,
    warnings,
  };
}

function isQuoteLikeClip(candidate: ProfessionalQualityCandidate): boolean {
  const text = `${candidate.clipType} ${candidate.smartClipCategory ?? ""} ${candidate.title}`.toLowerCase();
  return /\b(quote|punchline|remember this|hear me)\b/.test(text);
}

function startsWithDependentOpening(text: string): boolean {
  return analyzeClipCoherence(text).openingStatus === "DEPENDENT";
}

function startsWithSoftConnector(text: string): boolean {
  return analyzeClipCoherence(text).openingStatus === "SOFT_CONNECTOR";
}

function endsWithDanglingThought(text: string): boolean {
  return analyzeClipCoherence(text).endingStatus !== "CLEAN";
}

function hasNonSermonLogistics(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (/\b(parking|lobby|registration|register at|sign up|qr code|scan the code|welcome desk|info desk|tea and coffee|service time|service times)\b/.test(normalized)) {
    return true;
  }
  if (/\b(bank details|banking details|giving link|offering envelope|building fund|card machine|pos machine)\b/.test(normalized)) {
    return true;
  }
  if (/\b(like and subscribe|subscribe|follow us|turn on notifications)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function hasWarmupWithoutPayoff(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const warmup = /\b(good morning|can you hear me|are you ready|turn to your neighbor|tell somebody|look at somebody|welcome to church)\b/.test(normalized);
  const payoff = /\b(scripture|jesus|christ|god|holy spirit|faith|grace|prayer|salvation|repent|disciple|forgive|hope|obedience|purpose|calling|worship|kingdom|gospel)\b/.test(normalized);
  return warmup && !payoff;
}

function hasSpiritualAnchor(text: string): boolean {
  return analyzeClipCoherence(text).hasSpiritualAnchor;
}

function hasClearSermonTakeaway(text: string): boolean {
  const analysis = analyzeClipCoherence(text);
  if (analysis.hasClearTakeaway) {
    return true;
  }

  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const nonSubstantiveReference = /\b(on the screen|notes are|notes available|available for everyone|following along|in the room)\b/.test(normalized);
  const substantiveSermonTruth =
    /\b(god is faithful|god is good|god gives|god strengthens|scripture is true|scripture teaches|the scripture teaches|faith matters|grace is|grace matters|christ is|jesus is|the gospel)\b/.test(normalized);

  return analysis.hasSpiritualAnchor && substantiveSermonTruth && !nonSubstantiveReference;
}

function looksLikeSermonSetupWithoutLanding(text: string): boolean {
  return analyzeClipCoherence(text).setupOnly;
}

function hasSpokenPayoffOrApplication(text: string): boolean {
  return analyzeClipCoherence(text).landingStatus !== "NONE";
}

function buildPayoffApplicationBlockers(candidate: ProfessionalQualityCandidate): string[] {
  const blockers: string[] = [];
  const spokenText = candidate.transcriptText;

  if (!hasSpokenPayoffOrApplication(spokenText)) {
    blockers.push("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
  }

  if (looksLikeSermonSetupWithoutLanding(spokenText) && !hasSpokenPayoffOrApplication(spokenText)) {
    blockers.push("PASTOR_GRADE_SETUP_WITHOUT_LANDING");
  }

  return blockers;
}

const UNSUPPORTED_METADATA_CLAIM_PATTERNS = [
  /\b(financial breakthrough|breakthrough in your finances|money miracle|debt cancellation|wealth transfer)\b/i,
  /\b(generational curse|bloodline curse|ancestral curse|family curse)\b/i,
  /\b(instant healing|healed from cancer|healing miracle|miracle healing|supernatural healing)\b/i,
  /\b(prophetic word|prophecy over your life|thus says the lord|god told me to tell you)\b/i,
  /\b(demon|deliverance from demons|demonic attack|witchcraft|spiritual attack)\b/i,
  /\b(marriage restored|restored your marriage|save your marriage)\b/i,
  /\b(this will change your life|life changing revelation|secret key|hidden key)\b/i,
] as const;

function hasUnsupportedMetadataClaim(candidate: ProfessionalQualityCandidate): boolean {
  const metadataText = `${candidate.title} ${candidate.hook} ${candidate.caption}`;
  const sourceText = candidate.transcriptText;

  return UNSUPPORTED_METADATA_CLAIM_PATTERNS.some((pattern) => {
    return pattern.test(metadataText) && !pattern.test(sourceText);
  });
}

function buildSermonTakeawayBlockers(candidate: ProfessionalQualityCandidate): string[] {
  const text = `${candidate.title} ${candidate.hook} ${candidate.caption} ${candidate.smartClipCategory ?? ""} ${candidate.ministryValue ?? ""} ${candidate.socialValue ?? ""} ${candidate.transcriptText}`;
  const blockers: string[] = [];

  if (!hasSpiritualAnchor(text)) {
    blockers.push("PASTOR_GRADE_NO_SPIRITUAL_ANCHOR");
  }
  if (!hasSpiritualAnchor(candidate.transcriptText)) {
    blockers.push("PASTOR_GRADE_TRANSCRIPT_NO_SPIRITUAL_ANCHOR");
  }
  if (!hasClearSermonTakeaway(text)) {
    blockers.push("PASTOR_GRADE_NO_CLEAR_TAKEAWAY");
  }
  if (!hasClearSermonTakeaway(candidate.transcriptText)) {
    blockers.push("PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY");
  }
  if (hasUnsupportedMetadataClaim(candidate)) {
    blockers.push("PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM");
  }

  return blockers;
}

function buildNonSermonContentBlockers(candidate: ProfessionalQualityCandidate): string[] {
  const text = `${candidate.title} ${candidate.hook} ${candidate.caption} ${candidate.ministryValue ?? ""} ${candidate.transcriptText}`;
  const blockers: string[] = [];

  if (hasNonSermonLogistics(text)) {
    blockers.push("PASTOR_GRADE_NON_SERMON_LOGISTICS");
  }
  if (hasWarmupWithoutPayoff(candidate.transcriptText)) {
    blockers.push("PASTOR_GRADE_WARMUP_FILLER");
  }

  return blockers;
}

function buildSpokenSubstanceBlockers(candidate: ProfessionalQualityCandidate): string[] {
  const blockers: string[] = [];
  const wordCount = countWords(candidate.transcriptText);
  const wordsPerMinute = candidate.durationSeconds > 0 ? (wordCount / candidate.durationSeconds) * 60 : 0;
  const minimumWords = isQuoteLikeClip(candidate) ? MIN_PASTOR_GRADE_QUOTE_WORDS : MIN_PASTOR_GRADE_TRANSCRIPT_WORDS;

  if (wordCount < minimumWords) {
    blockers.push("PASTOR_GRADE_LOW_SPOKEN_SUBSTANCE");
  }

  if (
    candidate.durationSeconds >= 45 &&
    wordsPerMinute < MIN_PASTOR_GRADE_WORDS_PER_MINUTE
  ) {
    blockers.push("PASTOR_GRADE_LOW_SPOKEN_DENSITY");
  }

  return blockers;
}

function buildBoundaryCoherenceIssues(input: {
  candidate: ProfessionalQualityCandidate;
  hookScore: number;
  standaloneClarityScore: number;
}): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const text = input.candidate.transcriptText;

  if (startsWithDependentOpening(text)) {
    blockers.push("PASTOR_GRADE_DEPENDENT_OPENING");
  } else if (
    startsWithSoftConnector(text) &&
    (input.candidate.contextWarning || input.standaloneClarityScore < 7 || input.hookScore < 7)
  ) {
    blockers.push("PASTOR_GRADE_DEPENDENT_OPENING");
  } else if (startsWithSoftConnector(text)) {
    warnings.push("PASTOR_REVIEW_OPENING_CONNECTOR");
  }

  if (endsWithDanglingThought(text)) {
    blockers.push("PASTOR_GRADE_DANGLING_ENDING");
  }

  return { blockers, warnings };
}

function buildPastorGradeBlockers(input: {
  candidate: ProfessionalQualityCandidate;
  hookScore: number;
  arcCompletenessScore: number;
  standaloneClarityScore: number;
  boundaryQualityScore: number;
  durationQualityLabel: ClipDurationQuality["durationQualityLabel"];
}): string[] {
  const blockers: string[] = [];

  if (input.candidate.riskLevel === "HIGH") {
    blockers.push("PASTOR_GRADE_HIGH_CONTEXT_RISK");
  }
  if (input.candidate.boundaryQuality === "BAD" || input.boundaryQualityScore < 4.5) {
    blockers.push("PASTOR_GRADE_BAD_BOUNDARY");
  }
  if (input.hookScore < 5.2) {
    blockers.push("PASTOR_GRADE_WEAK_OPENING");
  }
  if (input.standaloneClarityScore < 5.5) {
    blockers.push("PASTOR_GRADE_LOW_STANDALONE_CLARITY");
  }
  if (
    input.arcCompletenessScore < 5.8 ||
    input.candidate.completenessAction === "REJECT_INCOMPLETE" ||
    (typeof input.candidate.completenessScore === "number" && input.candidate.completenessScore < 5.2)
  ) {
    blockers.push("PASTOR_GRADE_INCOMPLETE_THOUGHT");
  }
  if (
    input.candidate.contextWarning &&
    (input.candidate.riskLevel === "MEDIUM" ||
      input.arcCompletenessScore < 6.5 ||
      input.standaloneClarityScore < 6.5)
  ) {
    blockers.push("PASTOR_GRADE_CONTEXT_DEPENDENT");
  }
  blockers.push(...buildSermonTakeawayBlockers(input.candidate));
  blockers.push(...buildPayoffApplicationBlockers(input.candidate));
  if (input.durationQualityLabel === "TOO_SHORT") {
    blockers.push("PASTOR_GRADE_TOO_SHORT");
  }
  if (input.durationQualityLabel === "TOO_LONG") {
    blockers.push("PASTOR_GRADE_TOO_LONG");
  }
  blockers.push(...buildSpokenSubstanceBlockers(input.candidate));
  blockers.push(...buildNonSermonContentBlockers(input.candidate));
  blockers.push(...buildBoundaryCoherenceIssues(input).blockers);

  return blockers;
}

function buildPastorGradeReviewWarnings(input: {
  candidate: ProfessionalQualityCandidate;
  hookScore: number;
  arcCompletenessScore: number;
  standaloneClarityScore: number;
  boundaryQualityScore: number;
  durationQualityLabel: ClipDurationQuality["durationQualityLabel"];
}): string[] {
  const warnings: string[] = [];

  if (input.hookScore < 5.8) {
    warnings.push("PASTOR_REVIEW_OPENING");
  }
  if (input.arcCompletenessScore < 6.2) {
    warnings.push("PASTOR_REVIEW_SERMON_ARC");
  }
  if (input.standaloneClarityScore < 6.2) {
    warnings.push("PASTOR_REVIEW_STANDALONE_CLARITY");
  }
  if (input.candidate.boundaryQuality !== "GOOD" || input.boundaryQualityScore < 6.2) {
    warnings.push("PASTOR_REVIEW_BOUNDARY");
  }
  if (
    input.candidate.completenessAction === "NEEDS_REVIEW" ||
    (typeof input.candidate.completenessScore === "number" && input.candidate.completenessScore < 6.2)
  ) {
    warnings.push("PASTOR_REVIEW_COMPLETENESS");
  }
  if (looksLikeSermonSetupWithoutLanding(input.candidate.transcriptText) && !hasSpokenPayoffOrApplication(input.candidate.transcriptText)) {
    warnings.push("PASTOR_REVIEW_NEEDS_STRONGER_LANDING");
  }
  if (input.durationQualityLabel === "TIGHT" || input.durationQualityLabel === "SLIGHTLY_LONG") {
    warnings.push("PASTOR_REVIEW_DURATION");
  }
  warnings.push(...buildBoundaryCoherenceIssues(input).warnings);

  return warnings;
}

function hasCorePastorGradeBlocker(warnings: string[]): boolean {
  return hasHardQualityWarning(warnings);
}

export function scoreProfessionalClipQuality(candidate: ProfessionalQualityCandidate): ProfessionalQualityFields {
  const hook: ClipHookAnalysis = typeof candidate.hookScore === "number"
    ? {
        hookScore: candidate.hookScore,
        hookType: "BOLD_STATEMENT" as const,
        hookProblem: null,
        suggestedStartAdjustment: null,
        hookReason: "Existing hook score was reused.",
      }
    : analyzeClipHook(candidate);
  const arc = detectClipArc(candidate);
  const duration = scoreDurationQuality({ ...candidate, clipArcType: arc.clipArcType });
  const audio = scoreAudioQuality({
    hasAudio: candidate.audioWarnings?.includes("NO_AUDIO_DETECTED") ? false : null,
    averageLoudness: candidate.averageLoudness,
    peakLoudness: candidate.peakLoudness,
    silenceAtBeginningSeconds: candidate.silenceAtBeginningSeconds,
    silenceAtEndSeconds: candidate.silenceAtEndSeconds,
    longestInternalSilenceSeconds: candidate.longestInternalSilenceSeconds,
    internalSilenceCount: candidate.internalSilenceCount,
  });
  const captionFields = scoreCaptionLifecycle(candidate);
  const speechPolish = analyzeSpeechPolish(candidate.transcriptText);
  const standaloneClarityScore = scoreStandalone(candidate);
  const emotionalWeightScore = clampScore(candidate.emotionalImpactScore ?? (/\b(hope|pain|grace|tears|joy|fear|healing)\b/i.test(candidate.transcriptText) ? 7.8 : 6.5));
  const ministryValueScore = scoreMinistryValue(candidate);
  const boundaryQualityScore = clampScore(candidate.boundaryQualityScore ?? scoreBoundaryQuality(candidate.boundaryQuality));
  const visualConfidenceScore = clampScore(candidate.visualConfidenceScore ?? candidate.visualQualityScore ?? candidate.visualReadinessScore ?? 6);
  const visualQualityScore = clampScore(candidate.visualQualityScore ?? candidate.visualReadinessScore ?? visualConfidenceScore);
  const socialShareabilityScore = clampScore(candidate.shareabilityScore ?? candidate.score);
  const speechPolishPenalty = speechPolish.warnings.includes("FILLER_WORD_DENSITY") ? 0.35 : 0;
  const finalQualityScore = clampScore(
    hook.hookScore * 0.19 +
    standaloneClarityScore * 0.18 +
    emotionalWeightScore * 0.14 +
    ministryValueScore * 0.14 +
    arc.arcCompletenessScore * 0.12 +
    boundaryQualityScore * 0.09 +
    visualConfidenceScore * 0.07 +
    socialShareabilityScore * 0.07 +
    (duration.durationQualityScore < 6 ? -0.6 : 0) -
    speechPolishPenalty,
  );
  const inheritedWarnings = candidate.qualityWarnings ?? [];
  const qualityWarnings = Array.from(new Set([
    ...inheritedWarnings,
    ...(hook.hookProblem ? ["WEAK_HOOK"] : []),
    ...(arc.whatContextMightBeMissing ? ["INCOMPLETE_ARC"] : []),
    ...(duration.durationQualityLabel === "TOO_SHORT" || duration.durationQualityLabel === "TOO_LONG" ? ["DURATION_NEEDS_EDIT"] : []),
    ...(candidate.audioWarnings ?? audio.audioWarnings),
    ...captionFields.captionQualityWarnings,
    ...speechPolish.warnings,
  ]));
  const pastorGradeBlockers = buildPastorGradeBlockers({
    candidate,
    hookScore: hook.hookScore,
    arcCompletenessScore: arc.arcCompletenessScore,
    standaloneClarityScore,
    boundaryQualityScore,
    durationQualityLabel: duration.durationQualityLabel,
  });
  const pastorGradeReviewWarnings = buildPastorGradeReviewWarnings({
    candidate,
    hookScore: hook.hookScore,
    arcCompletenessScore: arc.arcCompletenessScore,
    standaloneClarityScore,
    boundaryQualityScore,
    durationQualityLabel: duration.durationQualityLabel,
  });
  const allQualityWarnings = Array.from(new Set([
    ...qualityWarnings,
    ...pastorGradeBlockers,
    ...pastorGradeReviewWarnings,
  ]));
  const resolvedAudioWarnings = candidate.audioWarnings ?? audio.audioWarnings;
  const postReady = reviewPostReady({
    finalQualityScore,
    hookScore: hook.hookScore,
    arcCompletenessScore: arc.arcCompletenessScore,
    boundaryQualityScore,
    visualQualityScore,
    audioQualityScore: candidate.audioQualityScore ?? audio.audioQualityScore,
    captionQualityScore: candidate.captionQualityScore ?? captionFields.captionQualityScore,
    boundaryQuality: candidate.boundaryQuality,
    standaloneClarityScore,
    renderStatus: candidate.renderStatus,
    riskLevel: candidate.riskLevel,
    contextWarning: candidate.contextWarning,
    qualityWarnings: allQualityWarnings,
    audioWarnings: resolvedAudioWarnings,
    captionWarnings: captionFields.captionQualityWarnings,
  });
  const corePastorGradeBlocked = hasCorePastorGradeBlocker(pastorGradeBlockers);
  const qualityLabel: ClipQualityLabel = corePastorGradeBlocked
    ? "REJECT"
    : postReady.postReadyStatus;
  const qualityReasons = [
    hook.hookReason,
    arc.whyThisClipFeelsComplete,
    `Sermon arc completeness scored ${arc.arcCompletenessScore}/10.`,
    duration.durationReason,
    ...pastorGradeBlockers.map((blocker) => `Pastor-grade blocker: ${blocker.replace(/_/g, " ").toLowerCase()}.`),
    ...postReady.postReadyReasons,
  ];

  return {
    ...hook,
    ...arc,
    ...duration,
    ...audio,
    audioWarnings: resolvedAudioWarnings,
    standaloneClarityScore,
    emotionalWeightScore,
    ministryValueScore,
    boundaryQualityScore,
    visualConfidenceScore,
    socialShareabilityScore,
    ...captionFields,
    finalQualityScore,
    qualityLabel,
    qualityReasons,
    qualityWarnings: allQualityWarnings,
    rankingCategory: inferRankingCategory(candidate, finalQualityScore, qualityLabel),
    bestPlatform: bestPlatform(candidate, candidate.durationSeconds),
    ...postReady,
  };
}

export function sortByProfessionalQuality<T extends {
  qualityLabel?: ClipQualityLabel | null;
  finalQualityScore?: number | null;
  score: number;
  startTimeSeconds: number;
}>(clips: T[]): T[] {
  const labelOrder: Record<ClipQualityLabel, number> = {
    POST_READY: 0,
    GOOD_NEEDS_REVIEW: 1,
    NEEDS_EDITING: 2,
    REJECT: 3,
  };

  return [...clips].sort((left, right) => {
    const labelDiff = labelOrder[left.qualityLabel ?? "NEEDS_EDITING"] - labelOrder[right.qualityLabel ?? "NEEDS_EDITING"];
    if (labelDiff !== 0) return labelDiff;

    const scoreDiff = (right.finalQualityScore ?? right.score) - (left.finalQualityScore ?? left.score);
    if (scoreDiff !== 0) return scoreDiff;

    return left.startTimeSeconds - right.startTimeSeconds;
  });
}
