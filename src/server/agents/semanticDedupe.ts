export type SemanticDedupeCandidate = {
  title: string;
  hook: string;
  transcriptText: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  score: number;
  finalQualityScore?: number | null;
  hookScore?: number | null;
  boundaryQualityScore?: number | null;
  arcCompletenessScore?: number | null;
  visualConfidenceScore?: number | null;
  smartClipCategory?: string | null;
  clipType?: string | null;
  landingSentence?: string | null;
  ministryValue?: string | null;
  arcType?: string | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
  selectionReasoning?: {
    clipSummary?: string;
  } | null;
};

export type SemanticDedupeResult<T extends SemanticDedupeCandidate> = {
  kept: T[];
  duplicates: Array<{
    duplicate: T;
    representative: T;
    dedupeScore: number;
    dedupeReason: string;
  }>;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "but",
  "that",
  "this",
  "with",
  "you",
  "your",
  "for",
  "are",
  "was",
  "have",
  "has",
  "not",
  "from",
  "they",
  "our",
  "will",
  "what",
  "when",
  "where",
  "there",
]);

const MINISTRY_TOKEN_ALIASES: Record<string, string> = {
  gifts: "gift",
  gifting: "gift",
  calling: "assignment",
  callings: "assignment",
  purpose: "assignment",
  purposes: "assignment",
  assignment: "assignment",
  assignments: "assignment",
  serve: "service",
  serves: "service",
  serving: "service",
  service: "service",
  ministry: "service",
  minister: "service",
  obedience: "obey",
  obedient: "obey",
  obeying: "obey",
  obey: "obey",
  prayed: "prayer",
  praying: "prayer",
  pray: "prayer",
  faith: "faith",
  faithful: "faith",
  faithfully: "faith",
  fear: "fear",
  fearful: "fear",
  anxiety: "fear",
  anxious: "fear",
  courage: "courage",
  courageous: "courage",
  boldness: "courage",
  strength: "strength",
  strengthened: "strength",
  strengthen: "strength",
  grace: "grace",
  mercy: "grace",
  hope: "hope",
  hopeful: "hope",
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeToken(token: string): string {
  const trimmed = token.trim().toLowerCase();
  const singular = trimmed.length > 4 && trimmed.endsWith("s") ? trimmed.slice(0, -1) : trimmed;
  return MINISTRY_TOKEN_ALIASES[singular] ?? singular;
}

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function orderedTokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / (left.size + right.size - intersection);
}

function containment(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / Math.min(left.size, right.size);
}

function bigrams(text: string): Set<string> {
  const words = orderedTokens(text);
  const pairs = new Set<string>();
  for (let index = 0; index < words.length - 1; index += 1) {
    pairs.add(`${words[index]} ${words[index + 1]}`);
  }
  return pairs;
}

function ministryConcepts(text: string): Set<string> {
  const tokenSet = tokens(text);
  const concepts = new Set<string>();

  if (tokenSet.has("gift") || tokenSet.has("assignment")) concepts.add("calling");
  if (tokenSet.has("service")) concepts.add("service");
  if (tokenSet.has("obey")) concepts.add("obedience");
  if (tokenSet.has("faith")) concepts.add("faith");
  if (tokenSet.has("fear") || tokenSet.has("courage")) concepts.add("fear-courage");
  if (tokenSet.has("prayer")) concepts.add("prayer");
  if (tokenSet.has("strength") || tokenSet.has("hope")) concepts.add("encouragement");
  if (tokenSet.has("grace")) concepts.add("grace");

  return concepts;
}

function transcriptIdeaText(candidate: SemanticDedupeCandidate): string {
  const transcript = candidate.transcriptText.trim();
  return [
    candidate.selectionReasoning?.clipSummary ?? "",
    candidate.hook,
    candidate.title,
    candidate.landingSentence ?? "",
    candidate.ministryValue ?? "",
    candidate.arcType ?? "",
    transcript.slice(0, 700),
    transcript.slice(-700),
  ].join(" ");
}

function sentenceCandidates(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function landingIdeaText(candidate: SemanticDedupeCandidate): string {
  const explicitLanding = candidate.landingSentence?.trim();
  if (explicitLanding) {
    return explicitLanding;
  }

  const sentences = sentenceCandidates(candidate.transcriptText);
  return sentences.findLast((sentence) => orderedTokens(sentence).length >= 5)
    ?? candidate.transcriptText.slice(-260);
}

function candidateIdeaText(candidate: SemanticDedupeCandidate): string {
  return [
    candidate.title,
    candidate.hook,
    candidate.landingSentence ?? "",
    candidate.ministryValue ?? "",
    candidate.selectionReasoning?.clipSummary ?? "",
    candidate.smartClipCategory ?? "",
    candidate.clipType ?? "",
    candidate.arcType ?? "",
    transcriptIdeaText(candidate),
  ].join(" ");
}

function landingSimilarity(left: SemanticDedupeCandidate, right: SemanticDedupeCandidate): number {
  const leftLanding = landingIdeaText(left);
  const rightLanding = landingIdeaText(right);
  return Math.max(
    containment(tokens(leftLanding), tokens(rightLanding)),
    jaccard(bigrams(leftLanding), bigrams(rightLanding)),
  );
}

function sameMainIdea(left: SemanticDedupeCandidate, right: SemanticDedupeCandidate): boolean {
  const leftText = candidateIdeaText(left);
  const rightText = candidateIdeaText(right);
  const titleHookScore = containment(tokens(`${left.title} ${left.hook}`), tokens(`${right.title} ${right.hook}`));
  const landingScore = landingSimilarity(left, right);
  const tokenScore = containment(tokens(leftText), tokens(rightText));
  const bigramScore = jaccard(bigrams(leftText), bigrams(rightText));
  const conceptScore = containment(ministryConcepts(leftText), ministryConcepts(rightText));

  return (
    landingScore >= 0.68 ||
    titleHookScore >= 0.58 ||
    (conceptScore >= 0.66 && tokenScore >= 0.5 && bigramScore >= 0.18)
  );
}

function isAlmostContainedWithSamePayoff(left: SemanticDedupeCandidate, right: SemanticDedupeCandidate, overlap: number): boolean {
  return overlap >= 0.86 && landingSimilarity(left, right) >= 0.58;
}

function boundaryQualityFallback(candidate: SemanticDedupeCandidate): number | null {
  if (candidate.boundaryQuality === "GOOD") return 9;
  if (candidate.boundaryQuality === "NEEDS_REVIEW") return 6;
  if (candidate.boundaryQuality === "BAD") return 1;
  return null;
}

function overlapRatio(left: SemanticDedupeCandidate, right: SemanticDedupeCandidate): number {
  const overlapStart = Math.max(left.startTimeSeconds, right.startTimeSeconds);
  const overlapEnd = Math.min(left.endTimeSeconds, right.endTimeSeconds);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const shorter = Math.min(left.durationSeconds, right.durationSeconds);
  return shorter > 0 ? overlap / shorter : 0;
}

export function semanticSimilarity(left: SemanticDedupeCandidate, right: SemanticDedupeCandidate): number {
  const leftText = [
    left.title,
    left.hook,
    left.selectionReasoning?.clipSummary ?? "",
    left.smartClipCategory ?? "",
    left.clipType ?? "",
    left.transcriptText.slice(0, 350),
    left.transcriptText.slice(-350),
  ].join(" ");
  const rightText = [
    right.title,
    right.hook,
    right.selectionReasoning?.clipSummary ?? "",
    right.smartClipCategory ?? "",
    right.clipType ?? "",
    right.transcriptText.slice(0, 350),
    right.transcriptText.slice(-350),
  ].join(" ");

  const textScore = jaccard(tokens(leftText), tokens(rightText));
  const hookScore = jaccard(tokens(left.hook), tokens(right.hook));
  const titleScore = jaccard(tokens(left.title), tokens(right.title));
  const categoryScore = normalize(left.smartClipCategory ?? "") === normalize(right.smartClipCategory ?? "") ? 0.12 : 0;
  const leftIdeaTokens = tokens(transcriptIdeaText(left));
  const rightIdeaTokens = tokens(transcriptIdeaText(right));
  const ideaContainmentScore = containment(leftIdeaTokens, rightIdeaTokens);
  const ideaBigramScore = jaccard(bigrams(transcriptIdeaText(left)), bigrams(transcriptIdeaText(right)));
  const sameContentLane =
    normalize(left.smartClipCategory ?? "") === normalize(right.smartClipCategory ?? "") ||
    normalize(left.clipType ?? "") === normalize(right.clipType ?? "");
  const conceptScore = containment(ministryConcepts(transcriptIdeaText(left)), ministryConcepts(transcriptIdeaText(right)));
  const ideaScore = sameContentLane
    ? Math.max(ideaContainmentScore * 0.82, ideaBigramScore * 0.9, conceptScore * 0.94)
    : Math.max(ideaContainmentScore * 0.62, ideaBigramScore * 0.72, conceptScore * 0.58);

  return Math.min(1, Math.max(
    textScore * 0.55 + hookScore * 0.2 + titleScore * 0.13 + categoryScore,
    ideaScore,
  ));
}

function representativeScore(candidate: SemanticDedupeCandidate): number {
  return (
    (candidate.finalQualityScore ?? candidate.score) * 0.45 +
    (candidate.hookScore ?? candidate.score) * 0.2 +
    (candidate.boundaryQualityScore ?? boundaryQualityFallback(candidate) ?? candidate.score) * 0.13 +
    (candidate.arcCompletenessScore ?? candidate.score) * 0.13 +
    (candidate.visualConfidenceScore ?? 6) * 0.06 -
    Math.max(0, candidate.durationSeconds - 90) * 0.01
  );
}

function duplicateEvidence(
  candidate: SemanticDedupeCandidate,
  representative: SemanticDedupeCandidate,
  thresholds: { similarityThreshold: number; overlapThreshold: number; overlapSemanticFloor: number },
): { duplicate: boolean; score: number; reason: string } {
  const semantic = semanticSimilarity(candidate, representative);
  const overlap = overlapRatio(candidate, representative);
  const landing = landingSimilarity(candidate, representative);
  const sameIdea = sameMainIdea(candidate, representative);

  if (semantic >= thresholds.similarityThreshold) {
    return {
      duplicate: true,
      score: semantic,
      reason: "Similar hook, title, topic, or main idea",
    };
  }

  if (landing >= 0.72 || sameIdea) {
    return {
      duplicate: true,
      score: Math.max(semantic, landing),
      reason: "Same landing sentence or main idea",
    };
  }

  if (isAlmostContainedWithSamePayoff(candidate, representative, overlap)) {
    return {
      duplicate: true,
      score: Math.max(overlap, landing),
      reason: "Contained timestamp range with the same payoff",
    };
  }

  if (overlap >= thresholds.overlapThreshold && semantic >= thresholds.overlapSemanticFloor) {
    return {
      duplicate: true,
      score: Math.max(semantic, overlap),
      reason: "Overlapping timestamp range with matching sermon idea",
    };
  }

  return {
    duplicate: false,
    score: Math.max(semantic, overlap),
    reason: "Distinct overlapping sermon ideas",
  };
}

export function semanticDedupeCandidates<T extends SemanticDedupeCandidate>(
  candidates: T[],
  options?: { similarityThreshold?: number; overlapThreshold?: number; overlapSemanticFloor?: number },
): SemanticDedupeResult<T> {
  const similarityThreshold = options?.similarityThreshold ?? 0.62;
  const overlapThreshold = options?.overlapThreshold ?? 0.5;
  const overlapSemanticFloor = options?.overlapSemanticFloor ?? 0.42;
  const sorted = [...candidates].sort((left, right) => representativeScore(right) - representativeScore(left));
  const kept: T[] = [];
  const duplicates: SemanticDedupeResult<T>["duplicates"] = [];

  for (const candidate of sorted) {
    const match = kept
      .map((representative) => {
        const evidence = duplicateEvidence(candidate, representative, {
          similarityThreshold,
          overlapThreshold,
          overlapSemanticFloor,
        });
        return {
          representative,
          score: evidence.score,
          reason: evidence.reason,
          duplicate: evidence.duplicate,
        };
      })
      .find((result) => result.duplicate);

    if (match) {
      duplicates.push({
        duplicate: {
          ...candidate,
          duplicateOfClipId: "pending",
          dedupeReason: match.reason,
          dedupeScore: Number(match.score.toFixed(2)),
        } as T,
        representative: match.representative,
        dedupeScore: Number(match.score.toFixed(2)),
        dedupeReason: match.reason,
      });
      continue;
    }

    kept.push(candidate);
  }

  return { kept, duplicates };
}
