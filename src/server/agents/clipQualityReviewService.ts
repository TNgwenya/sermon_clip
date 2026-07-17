import { z, ZodError } from "zod";

import type { ClipJsonCandidate } from "@/server/ai/clipJsonSchema";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel, resolveOpenAIReasoningEffort } from "@/server/ai/modelConfig";

export const CLIP_QUALITY_RECOMMENDED_ACTIONS = ["KEEP", "EXTEND", "SHORTEN", "MERGE", "REJECT", "NEEDS_REVIEW"] as const;
export const CLIP_QUALITY_CATEGORIES = [
  "ENCOURAGEMENT",
  "SCRIPTURE_TEACHING",
  "ALTAR_CALL",
  "TESTIMONY_STORY",
  "QUOTE",
  "LEADERSHIP",
  "EVANGELISTIC",
  "PRAYER",
  "GENERAL",
] as const;
export const CLIP_QUALITY_WARNING_CODES = [
  "WEAK_HOOK",
  "INCOMPLETE_THOUGHT",
  "CONTEXT_RISK",
  "AWKWARD_BOUNDARY",
  "WEAK_VISUAL_CONFIDENCE",
  "LOW_POST_WORTHINESS",
  "AI_REVIEW_FAILED",
  "FALLBACK_REVIEW",
] as const;

export type ClipQualityRecommendedAction = typeof CLIP_QUALITY_RECOMMENDED_ACTIONS[number];
export type ClipQualityCategory = typeof CLIP_QUALITY_CATEGORIES[number];
export type ClipQualityWarningCode = typeof CLIP_QUALITY_WARNING_CODES[number];
export type ClipQualityReviewSource = "AI" | "FALLBACK";
export type ClipBoundaryQuality = "GOOD" | "NEEDS_REVIEW" | "BAD";
export type ClipRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type ClipQualityCandidateInput = Pick<
  ClipJsonCandidate,
  | "title"
  | "hook"
  | "caption"
  | "score"
  | "transcriptText"
  | "durationSeconds"
  | "startTimeSeconds"
  | "endTimeSeconds"
  | "riskLevel"
  | "riskReasons"
  | "contextWarning"
  | "clipType"
  | "smartClipCategory"
  | "ministryValue"
  | "socialValue"
  | "intendedAudience"
  | "reasonSelected"
  | "socialPotential"
  | "selectionReasoning"
> & {
  boundaryQuality: ClipBoundaryQuality;
  boundaryAdjustmentReason?: string | null;
  visualReadinessScore?: number | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  completenessWarnings?: string[] | null;
};

export type ClipQualityReview = {
  hookStrengthScore: number;
  standaloneClarityScore: number;
  emotionalImpactScore: number;
  sermonValueScore: number;
  shareabilityScore: number;
  contextSafetyScore: number;
  boundaryQualityScore: number;
  visualReadinessScore: number;
  overallPostScore: number;
  qualitySummary: string;
  pastorFriendlyReason: string;
  recommendedAction: ClipQualityRecommendedAction;
  suggestedStartTimeSeconds: number | null;
  suggestedEndTimeSeconds: number | null;
  qualityClipCategory: ClipQualityCategory;
  qualityWarnings: ClipQualityWarningCode[];
  qualityReviewSource: ClipQualityReviewSource;
  qualityReviewedAt: Date;
};

export type ClipQualityReviewedCandidate<T extends ClipQualityCandidateInput> = T & ClipQualityReview;

const aiReviewSchema = z.object({
  reviews: z.array(z.object({
    candidateIndex: z.number().int().min(0),
    hookStrengthScore: z.number().min(0).max(10),
    standaloneClarityScore: z.number().min(0).max(10),
    emotionalImpactScore: z.number().min(0).max(10),
    sermonValueScore: z.number().min(0).max(10),
    shareabilityScore: z.number().min(0).max(10),
    contextSafetyScore: z.number().min(0).max(10),
    qualitySummary: z.string().trim().min(1),
    pastorFriendlyReason: z.string().trim().min(1),
    recommendedAction: z.enum(CLIP_QUALITY_RECOMMENDED_ACTIONS),
    suggestedStartTimeSeconds: z.number().min(0).nullable().optional(),
    suggestedEndTimeSeconds: z.number().min(0).nullable().optional(),
    clipCategory: z.enum(CLIP_QUALITY_CATEGORIES),
    qualityWarnings: z.array(z.enum(CLIP_QUALITY_WARNING_CODES)).default([]),
  })),
});

type AiQualityReview = z.infer<typeof aiReviewSchema>["reviews"][number];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function roundScore(value: number): number {
  return Number(clampScore(value).toFixed(2));
}

function uniqueWarnings(warnings: ClipQualityWarningCode[]): ClipQualityWarningCode[] {
  return Array.from(new Set(warnings));
}

function scoreBoundaryQuality(boundaryQuality: ClipBoundaryQuality): number {
  if (boundaryQuality === "GOOD") {
    return 9;
  }

  if (boundaryQuality === "NEEDS_REVIEW") {
    return 5.5;
  }

  return 2;
}

function scoreContextSafety(candidate: ClipQualityCandidateInput): number {
  if (candidate.riskLevel === "HIGH") {
    return candidate.contextWarning ? 2.5 : 3.5;
  }

  if (candidate.riskLevel === "MEDIUM") {
    return candidate.contextWarning ? 5 : 6.5;
  }

  return candidate.contextWarning ? 6.5 : 8.8;
}

function scoreHook(candidate: ClipQualityCandidateInput): number {
  if (candidate.socialPotential?.hookStrength !== undefined) {
    return candidate.socialPotential.hookStrength;
  }

  const hook = candidate.hook.trim();
  if (!hook) {
    return 3;
  }

  let score = 6.5;
  if (hook.length >= 35 && hook.length <= 110) {
    score += 1;
  }
  if (/[?!]/.test(hook) || /\b(god|jesus|faith|pray|hope|purpose|calling|forgive|grace)\b/i.test(hook)) {
    score += 0.8;
  }
  if (/^(and|but|so|because)\b/i.test(hook)) {
    score -= 1.5;
  }

  return score;
}

function scoreStandaloneClarity(candidate: ClipQualityCandidateInput): number {
  const socialScore = candidate.socialPotential?.standaloneUsefulnessScore ?? candidate.socialPotential?.clarityScore;
  if (socialScore !== undefined) {
    return socialScore;
  }

  let score = candidate.boundaryQuality === "GOOD" ? 7.6 : 5.7;
  const transcript = candidate.transcriptText.trim();
  if (/^(and|but|so|because|therefore|then)\b/i.test(transcript)) {
    score -= 1.4;
  }
  if (/[.!?]["')\]]*$/u.test(transcript)) {
    score += 0.8;
  }
  if (candidate.contextWarning) {
    score -= 1.2;
  }

  return score;
}

function scoreSermonValue(candidate: ClipQualityCandidateInput): number {
  if (candidate.socialPotential?.ministryValueScore !== undefined) {
    return candidate.socialPotential.ministryValueScore;
  }

  let score = 6.8;
  if (candidate.ministryValue.trim().length > 35) {
    score += 1;
  }
  if (/prayer|scripture|salvation|faith|encourage|discipleship|testimony|worship|grace|hope/i.test(candidate.ministryValue)) {
    score += 0.8;
  }

  return score;
}

function inferCategory(candidate: ClipQualityCandidateInput): ClipQualityCategory {
  const text = `${candidate.smartClipCategory} ${candidate.clipType} ${candidate.title} ${candidate.ministryValue} ${candidate.transcriptText}`.toLowerCase();

  if (/altar|salvation|give your life|accept jesus|come to jesus/.test(text)) {
    return "ALTAR_CALL";
  }
  if (/scripture|bible|verse|romans|john|psalm|isaiah|matthew|mark|luke/.test(text)) {
    return "SCRIPTURE_TEACHING";
  }
  if (/testimony|story|when i|i remember/.test(text)) {
    return "TESTIMONY_STORY";
  }
  if (/pray|prayer/.test(text)) {
    return "PRAYER";
  }
  if (/leader|leadership|vision|team|serve/.test(text)) {
    return "LEADERSHIP";
  }
  if (/evangel|invite|lost|unbeliev|witness/.test(text)) {
    return "EVANGELISTIC";
  }
  if (/quote|declaration|remember this|hear me/.test(text)) {
    return "QUOTE";
  }
  if (/encourag|hope|weary|tired|strength|faith/.test(text)) {
    return "ENCOURAGEMENT";
  }

  return "GENERAL";
}

function baseWarnings(input: {
  candidate: ClipQualityCandidateInput;
  hookStrengthScore: number;
  standaloneClarityScore: number;
  contextSafetyScore: number;
  boundaryQualityScore: number;
  visualReadinessScore: number;
  overallPostScore?: number;
}): ClipQualityWarningCode[] {
  const warnings: ClipQualityWarningCode[] = [];

  if (input.hookStrengthScore < 5.5) {
    warnings.push("WEAK_HOOK");
  }
  if (input.standaloneClarityScore < 6) {
    warnings.push("INCOMPLETE_THOUGHT");
  }
  if (input.candidate.contextWarning || input.candidate.riskLevel === "HIGH" || input.contextSafetyScore < 6) {
    warnings.push("CONTEXT_RISK");
  }
  if (input.candidate.boundaryQuality !== "GOOD" || input.boundaryQualityScore < 6.5) {
    warnings.push("AWKWARD_BOUNDARY");
  }
  if (
    input.candidate.completenessAction === "NEEDS_REVIEW" ||
    input.candidate.completenessAction === "REJECT_INCOMPLETE" ||
    (input.candidate.completenessScore !== undefined && input.candidate.completenessScore !== null && input.candidate.completenessScore < 6)
  ) {
    warnings.push("INCOMPLETE_THOUGHT");
  }
  if (input.candidate.completenessWarnings?.some((warning) => warning === "CONTEXT_RISK" || warning === "MISSING_SETUP" || warning === "MISSING_LANDING" || warning === "LOW_STANDALONE_CLARITY")) {
    warnings.push("CONTEXT_RISK");
  }
  if (input.candidate.completenessWarnings?.some((warning) => warning === "CONNECTOR_START" || warning === "INCOMPLETE_ENDING" || warning === "MISSING_LANDING")) {
    warnings.push("AWKWARD_BOUNDARY");
  }
  if (input.visualReadinessScore < 5) {
    warnings.push("WEAK_VISUAL_CONFIDENCE");
  }
  if (input.overallPostScore !== undefined && input.overallPostScore < 5.5) {
    warnings.push("LOW_POST_WORTHINESS");
  }

  return warnings;
}

export function calculateOverallPostScore(input: {
  existingAiScore: number;
  hookStrengthScore: number;
  standaloneClarityScore: number;
  emotionalImpactScore: number;
  sermonValueScore: number;
  shareabilityScore: number;
  contextSafetyScore: number;
  boundaryQualityScore: number;
  visualReadinessScore: number;
  riskLevel: ClipRiskLevel;
  contextWarning: boolean;
  boundaryQuality: ClipBoundaryQuality;
}): number {
  const weighted =
    input.existingAiScore * 0.1 +
    input.hookStrengthScore * 0.12 +
    input.standaloneClarityScore * 0.18 +
    input.emotionalImpactScore * 0.1 +
    input.sermonValueScore * 0.18 +
    input.shareabilityScore * 0.08 +
    input.contextSafetyScore * 0.14 +
    input.boundaryQualityScore * 0.07 +
    input.visualReadinessScore * 0.03;

  const riskPenalty = input.riskLevel === "HIGH" ? 1.6 : input.riskLevel === "MEDIUM" ? 0.7 : 0;
  const contextPenalty = input.contextWarning ? 1.1 : 0;
  const boundaryPenalty = input.boundaryQuality === "BAD" ? 2.2 : input.boundaryQuality === "NEEDS_REVIEW" ? 1 : 0;

  return roundScore(weighted - riskPenalty - contextPenalty - boundaryPenalty);
}

export function determineRecommendedAction(input: {
  overallPostScore: number;
  standaloneClarityScore: number;
  contextSafetyScore: number;
  boundaryQuality: ClipBoundaryQuality;
  riskLevel: ClipRiskLevel;
  contextWarning: boolean;
  aiRecommendedAction?: ClipQualityRecommendedAction;
  completenessAction?: string | null;
  completenessScore?: number | null;
}): ClipQualityRecommendedAction {
  if (input.completenessAction === "REJECT_INCOMPLETE") {
    return "REJECT";
  }

  if (input.completenessScore !== undefined && input.completenessScore !== null && input.completenessScore < 4) {
    return "REJECT";
  }

  if (input.riskLevel === "HIGH" || input.contextSafetyScore < 4 || input.overallPostScore < 4) {
    return "REJECT";
  }

  if (input.completenessAction === "NEEDS_REVIEW" || (input.completenessScore !== undefined && input.completenessScore !== null && input.completenessScore < 6)) {
    return "NEEDS_REVIEW";
  }

  if (input.contextWarning || input.standaloneClarityScore < 6 || input.boundaryQuality === "NEEDS_REVIEW") {
    return "NEEDS_REVIEW";
  }

  if (input.boundaryQuality === "BAD") {
    return input.overallPostScore >= 5.5 ? "NEEDS_REVIEW" : "REJECT";
  }

  if (input.aiRecommendedAction && input.aiRecommendedAction !== "KEEP") {
    return input.aiRecommendedAction;
  }

  return input.overallPostScore >= 7 ? "KEEP" : "NEEDS_REVIEW";
}

function buildQualitySummary(action: ClipQualityRecommendedAction, overallPostScore: number): string {
  if (action === "KEEP") {
    return `Strong church-ready clip with an overall post score of ${overallPostScore.toFixed(1)}.`;
  }

  if (action === "REJECT") {
    return `Not recommended for posting without a different clip choice; overall post score is ${overallPostScore.toFixed(1)}.`;
  }

  return `Useful sermon moment, but it needs review before posting; overall post score is ${overallPostScore.toFixed(1)}.`;
}

function buildPastorReason(action: ClipQualityRecommendedAction, candidate: ClipQualityCandidateInput): string {
  if (action === "KEEP") {
    return "This clip is clear on its own, pastorally useful, and safe to share as a short sermon highlight.";
  }

  if (action === "REJECT") {
    return "This moment may confuse viewers or lack enough context, so it should not be treated as a ready-to-post clip yet.";
  }

  if (candidate.boundaryQuality !== "GOOD") {
    return "This clip has ministry value, but the start or ending may need a pastor or editor to check the thought flow.";
  }

  return "This clip may still be useful, but it needs a quick pastor review for clarity and context before posting.";
}

function buildFallbackReview(candidate: ClipQualityCandidateInput, reason?: string): ClipQualityReview {
  const hookStrengthScore = roundScore(scoreHook(candidate));
  const standaloneClarityScore = roundScore(scoreStandaloneClarity(candidate));
  const emotionalImpactScore = roundScore(candidate.socialPotential?.emotionalImpactScore ?? 6.7);
  const sermonValueScore = roundScore(scoreSermonValue(candidate));
  const shareabilityScore = roundScore(candidate.socialPotential?.shareabilityScore ?? candidate.socialPotential?.socialMediaPotentialScore ?? 6.4);
  const contextSafetyScore = roundScore(scoreContextSafety(candidate));
  const boundaryQualityScore = roundScore(scoreBoundaryQuality(candidate.boundaryQuality));
  const visualReadinessScore = roundScore(candidate.visualReadinessScore ?? 6);
  const overallPostScore = calculateOverallPostScore({
    existingAiScore: candidate.score,
    hookStrengthScore,
    standaloneClarityScore,
    emotionalImpactScore,
    sermonValueScore,
    shareabilityScore,
    contextSafetyScore,
    boundaryQualityScore,
    visualReadinessScore,
    riskLevel: candidate.riskLevel,
    contextWarning: candidate.contextWarning,
    boundaryQuality: candidate.boundaryQuality,
  });
  const recommendedAction = determineRecommendedAction({
    overallPostScore,
    standaloneClarityScore,
    contextSafetyScore,
    boundaryQuality: candidate.boundaryQuality,
    riskLevel: candidate.riskLevel,
    contextWarning: candidate.contextWarning,
    completenessAction: candidate.completenessAction,
    completenessScore: candidate.completenessScore,
  });
  const qualityWarnings = uniqueWarnings([
    ...baseWarnings({
      candidate,
      hookStrengthScore,
      standaloneClarityScore,
      contextSafetyScore,
      boundaryQualityScore,
      visualReadinessScore,
      overallPostScore,
    }),
    "FALLBACK_REVIEW",
    ...(reason ? ["AI_REVIEW_FAILED" as const] : []),
  ]);

  return {
    hookStrengthScore,
    standaloneClarityScore,
    emotionalImpactScore,
    sermonValueScore,
    shareabilityScore,
    contextSafetyScore,
    boundaryQualityScore,
    visualReadinessScore,
    overallPostScore,
    qualitySummary: reason
      ? `${buildQualitySummary(recommendedAction, overallPostScore)} Deterministic quality review was used because the AI review could not be trusted.`
      : buildQualitySummary(recommendedAction, overallPostScore),
    pastorFriendlyReason: buildPastorReason(recommendedAction, candidate),
    recommendedAction,
    suggestedStartTimeSeconds: recommendedAction === "EXTEND" || recommendedAction === "SHORTEN" ? candidate.startTimeSeconds : null,
    suggestedEndTimeSeconds: recommendedAction === "EXTEND" || recommendedAction === "SHORTEN" ? candidate.endTimeSeconds : null,
    qualityClipCategory: inferCategory(candidate),
    qualityWarnings,
    qualityReviewSource: "FALLBACK",
    qualityReviewedAt: new Date(),
  };
}

function mergeAiReview(candidate: ClipQualityCandidateInput, aiReview: AiQualityReview): ClipQualityReview {
  const hookStrengthScore = roundScore(aiReview.hookStrengthScore);
  const standaloneClarityScore = roundScore(aiReview.standaloneClarityScore);
  const emotionalImpactScore = roundScore(aiReview.emotionalImpactScore);
  const sermonValueScore = roundScore(aiReview.sermonValueScore);
  const shareabilityScore = roundScore(aiReview.shareabilityScore);
  const contextSafetyScore = roundScore(aiReview.contextSafetyScore);
  const boundaryQualityScore = roundScore(scoreBoundaryQuality(candidate.boundaryQuality));
  const visualReadinessScore = roundScore(candidate.visualReadinessScore ?? 6);
  const overallPostScore = calculateOverallPostScore({
    existingAiScore: candidate.score,
    hookStrengthScore,
    standaloneClarityScore,
    emotionalImpactScore,
    sermonValueScore,
    shareabilityScore,
    contextSafetyScore,
    boundaryQualityScore,
    visualReadinessScore,
    riskLevel: candidate.riskLevel,
    contextWarning: candidate.contextWarning,
    boundaryQuality: candidate.boundaryQuality,
  });
  const recommendedAction = determineRecommendedAction({
    overallPostScore,
    standaloneClarityScore,
    contextSafetyScore,
    boundaryQuality: candidate.boundaryQuality,
    riskLevel: candidate.riskLevel,
    contextWarning: candidate.contextWarning,
    aiRecommendedAction: aiReview.recommendedAction,
    completenessAction: candidate.completenessAction,
    completenessScore: candidate.completenessScore,
  });
  const qualityWarnings = uniqueWarnings([
    ...aiReview.qualityWarnings,
    ...baseWarnings({
      candidate,
      hookStrengthScore,
      standaloneClarityScore,
      contextSafetyScore,
      boundaryQualityScore,
      visualReadinessScore,
      overallPostScore,
    }),
  ]);

  return {
    hookStrengthScore,
    standaloneClarityScore,
    emotionalImpactScore,
    sermonValueScore,
    shareabilityScore,
    contextSafetyScore,
    boundaryQualityScore,
    visualReadinessScore,
    overallPostScore,
    qualitySummary: aiReview.qualitySummary,
    pastorFriendlyReason: aiReview.pastorFriendlyReason,
    recommendedAction,
    suggestedStartTimeSeconds: aiReview.suggestedStartTimeSeconds ?? null,
    suggestedEndTimeSeconds: aiReview.suggestedEndTimeSeconds ?? null,
    qualityClipCategory: aiReview.clipCategory,
    qualityWarnings,
    qualityReviewSource: "AI",
    qualityReviewedAt: new Date(),
  };
}

function formatValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown quality review error.";
}

function parseQualityResponse(rawResponse: string): AiQualityReview[] {
  const parsed = JSON.parse(rawResponse) as unknown;
  return aiReviewSchema.parse(parsed).reviews;
}

function buildSystemPrompt(): string {
  return [
    "You are a senior church video editor reviewing sermon clips before a pastor posts them.",
    "Score for church usefulness, standalone clarity, pastoral safety, emotional or spiritual value, and short-form readiness.",
    "Do not score only for virality. A strong sermon clip should be spiritually useful, understandable without the full sermon, safe out of context, and clear enough for a pastor to confidently post.",
    "Be conservative with clips that may confuse viewers, start mid-thought, end awkwardly, or need surrounding context.",
    "Return structured JSON only. Do not include markdown or commentary.",
  ].join("\n");
}

function buildUserPrompt(candidates: ClipQualityCandidateInput[]): string {
  const candidateText = candidates.map((candidate, index) => [
    `Candidate ${index}`,
    `Title: ${candidate.title}`,
    `Hook: ${candidate.hook}`,
    `Caption: ${candidate.caption}`,
    `Transcript: ${candidate.transcriptText}`,
    `Start: ${candidate.startTimeSeconds}`,
    `End: ${candidate.endTimeSeconds}`,
    `Duration: ${candidate.durationSeconds}`,
    `Existing AI score: ${candidate.score}`,
    `Risk level: ${candidate.riskLevel}`,
    `Risk reasons: ${candidate.riskReasons.join(" | ")}`,
    `Context warning: ${candidate.contextWarning}`,
    `Boundary quality: ${candidate.boundaryQuality}`,
    `Boundary reason: ${candidate.boundaryAdjustmentReason ?? ""}`,
    `Completeness action: ${candidate.completenessAction ?? "not reviewed"}`,
    `Completeness score: ${candidate.completenessScore ?? "not reviewed"}`,
    `Completeness warnings: ${(candidate.completenessWarnings ?? []).join(" | ")}`,
    `Ministry value: ${candidate.ministryValue}`,
    `Social value: ${candidate.socialValue}`,
    `Intended audience: ${candidate.intendedAudience}`,
    `Selection reason: ${candidate.reasonSelected}`,
    candidate.socialPotential
      ? `Existing social potential: ${JSON.stringify(candidate.socialPotential)}`
      : "Existing social potential: none",
  ].join("\n")).join("\n\n");

  return [
    "Review each candidate and return one review per candidateIndex.",
    "Use 0-10 scores for hookStrengthScore, standaloneClarityScore, emotionalImpactScore, sermonValueScore, shareabilityScore, and contextSafetyScore.",
    "recommendedAction must be KEEP, EXTEND, SHORTEN, MERGE, REJECT, or NEEDS_REVIEW.",
    "clipCategory must be ENCOURAGEMENT, SCRIPTURE_TEACHING, ALTAR_CALL, TESTIMONY_STORY, QUOTE, LEADERSHIP, EVANGELISTIC, PRAYER, or GENERAL.",
    "qualityWarnings may include WEAK_HOOK, INCOMPLETE_THOUGHT, CONTEXT_RISK, AWKWARD_BOUNDARY, WEAK_VISUAL_CONFIDENCE, or LOW_POST_WORTHINESS.",
    "Use pastor-friendly language. Avoid technical video jargon in pastorFriendlyReason.",
    "Return this JSON shape exactly:",
    '{"reviews":[{"candidateIndex":0,"hookStrengthScore":8,"standaloneClarityScore":8,"emotionalImpactScore":8,"sermonValueScore":9,"shareabilityScore":7,"contextSafetyScore":9,"qualitySummary":"Clear and useful sermon moment.","pastorFriendlyReason":"This clip is clear on its own and encourages people to trust God.","recommendedAction":"KEEP","suggestedStartTimeSeconds":null,"suggestedEndTimeSeconds":null,"clipCategory":"ENCOURAGEMENT","qualityWarnings":[]}] }',
    "Candidates:",
    candidateText,
  ].join("\n\n");
}

async function callQualityModel(candidates: ClipQualityCandidateInput[], rawResponseOverride?: string): Promise<AiQualityReview[]> {
  if (rawResponseOverride !== undefined) {
    return parseQualityResponse(rawResponseOverride);
  }

  const model = resolveOpenAIChatModel("clipQuality");
  const reasoningEffort = resolveOpenAIReasoningEffort("clipQuality", model);
  const completion = await createLoggedChatCompletion({
    operation: "clip_quality_review",
    model,
    reasoningEffort,
    response_format: { type: "json_object" },
    temperature: 0.1,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(candidates) },
    ],
    promptVersion: "clip-quality-v1",
    metadata: {
      candidateCount: candidates.length,
      transcriptCharacters: candidates.reduce((total, candidate) => total + candidate.transcriptText.length, 0),
    },
    missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before reviewing clip quality.",
  });

  return parseQualityResponse(completion.choices[0]?.message?.content ?? "");
}

export async function reviewClipQualityCandidates<T extends ClipQualityCandidateInput>(
  candidates: T[],
  options?: { rawResponseOverride?: string },
): Promise<Array<ClipQualityReviewedCandidate<T>>> {
  if (candidates.length === 0) {
    return [];
  }

  let aiReviewsByIndex = new Map<number, AiQualityReview>();
  let fallbackReason: string | undefined;

  try {
    const aiReviews = await callQualityModel(candidates, options?.rawResponseOverride);
    aiReviewsByIndex = new Map(aiReviews.map((review) => [review.candidateIndex, review]));
  } catch (error) {
    fallbackReason = formatValidationError(error);
  }

  return candidates.map((candidate, index) => {
    const aiReview = aiReviewsByIndex.get(index);
    const quality = aiReview
      ? mergeAiReview(candidate, aiReview)
      : buildFallbackReview(candidate, fallbackReason ?? "AI review did not return this candidate.");

    return {
      ...candidate,
      ...quality,
    };
  });
}

export function getClipRankingScore(clip: { overallPostScore?: number | null; score: number }): number {
  return clip.overallPostScore ?? clip.score;
}

export function sortByClipQuality<T extends { overallPostScore?: number | null; score: number; startTimeSeconds: number }>(clips: T[]): T[] {
  return [...clips].sort((left, right) => {
    const scoreDifference = getClipRankingScore(right) - getClipRankingScore(left);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return left.startTimeSeconds - right.startTimeSeconds;
  });
}

export const __clipQualityReviewTestUtils = {
  buildFallbackReview,
  calculateOverallPostScore,
  determineRecommendedAction,
  inferCategory,
  scoreBoundaryQuality,
};
