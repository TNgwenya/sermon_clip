import type {
  BrollCardPosition,
  BrollCardTone,
} from "@/lib/clipStudio";

export type ClipBrollSuggestionType = "quote" | "scripture" | "takeaway";

export type ClipBrollSuggestion = {
  id: string;
  revisionKey: string;
  type: ClipBrollSuggestionType;
  text: string;
  label: string;
  startSeconds: number;
  durationSeconds: number;
  tone: BrollCardTone;
  position: BrollCardPosition;
  sourceLabel: string;
  sourceExcerpt: string;
};

export type ClipBrollSuggestionInput = {
  clipId: string;
  clipStartSeconds: number;
  clipEndSeconds: number;
  clipTranscriptText: string;
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
  transcriptSegments: Array<{
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    confidence?: number | null;
  }>;
  intelligence?: {
    centralTheme?: string | null;
    keyTakeaways?: string[];
    ministryMomentTranscriptExcerpt?: string | null;
    reasonSelected?: string | null;
  };
  scriptureReferences?: Array<{
    reference: string;
    transcriptEvidence?: string | null;
    confidenceScore?: number | null;
    isManuallyAdded?: boolean;
  }>;
};

type PhraseCandidate = {
  segmentId: string;
  text: string;
  segmentText: string;
  startSeconds: number;
  durationSeconds: number;
  confidence: number;
};

const MAX_SUGGESTION_CACHE_ENTRIES = 128;
const suggestionCache = new Map<string, readonly ClipBrollSuggestion[]>();
const APPLICATION_LANGUAGE =
  /\b(?:remember|choose|pray|share|invite|trust|believe|follow|forgive|serve|stand|keep|let us|we (?:must|should|need|can)|you (?:must|should|need|can)|do not|don't|never|always)\b/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForEvidence(value: string): string {
  return normalizeWhitespace(value)
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function activeTranscriptSegments(
  input: ClipBrollSuggestionInput,
): ClipBrollSuggestionInput["transcriptSegments"] {
  return input.transcriptSegments.filter(
    (segment) =>
      segment.endTimeSeconds > input.clipStartSeconds
      && segment.startTimeSeconds < input.clipEndSeconds,
  );
}

function relevantRevisionSource(input: ClipBrollSuggestionInput): string {
  return JSON.stringify({
    clipId: input.clipId,
    clipStartSeconds: input.clipStartSeconds,
    clipEndSeconds: input.clipEndSeconds,
    clipTranscriptText: normalizeWhitespace(input.clipTranscriptText),
    transcriptSafetyStatus: input.transcriptSafetyStatus,
    transcriptSegments: activeTranscriptSegments(input).map((segment) => ({
      id: segment.id,
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds,
      text: normalizeWhitespace(segment.text),
      confidence: segment.confidence ?? null,
    })),
    intelligence: {
      centralTheme: normalizeWhitespace(input.intelligence?.centralTheme ?? ""),
      keyTakeaways: (input.intelligence?.keyTakeaways ?? []).map(normalizeWhitespace),
      ministryMomentTranscriptExcerpt: normalizeWhitespace(
        input.intelligence?.ministryMomentTranscriptExcerpt ?? "",
      ),
      reasonSelected: normalizeWhitespace(input.intelligence?.reasonSelected ?? ""),
    },
    scriptureReferences: (input.scriptureReferences ?? []).map((reference) => ({
      reference: normalizeWhitespace(reference.reference),
      transcriptEvidence: normalizeWhitespace(reference.transcriptEvidence ?? ""),
      confidenceScore: reference.confidenceScore ?? null,
      isManuallyAdded: Boolean(reference.isManuallyAdded),
    })),
  });
}

export function buildClipBrollSuggestionRevision(
  input: ClipBrollSuggestionInput,
): string {
  return `broll-suggestions-v1-${hashText(relevantRevisionSource(input))}`;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeForEvidence(value)
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function evidenceOverlap(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function isGroundedExcerpt(excerpt: string, transcriptText: string): boolean {
  const excerptNormalized = normalizeForEvidence(excerpt);
  const transcriptNormalized = normalizeForEvidence(transcriptText);
  if (excerptNormalized.length < 16 || transcriptNormalized.length < 16) {
    return false;
  }

  if (
    transcriptNormalized.includes(excerptNormalized)
    || excerptNormalized.includes(transcriptNormalized)
  ) {
    return true;
  }

  return excerptNormalized.split(" ").length >= 6
    && evidenceOverlap(excerptNormalized, transcriptNormalized) >= 0.9;
}

function phraseCandidates(input: ClipBrollSuggestionInput): PhraseCandidate[] {
  return activeTranscriptSegments(input).flatMap((segment): PhraseCandidate[] => {
    const segmentText = normalizeWhitespace(segment.text);
    const sentencePieces = segmentText
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map(normalizeWhitespace)
      .filter(Boolean) ?? [];
    const pieces = segmentText.length <= 140 ? [segmentText] : sentencePieces;
    const segmentDuration = Math.max(0.5, segment.endTimeSeconds - segment.startTimeSeconds);

    return pieces.flatMap((text): PhraseCandidate[] => {
      const wordCount = text.split(/\s+/).length;
      if (
        text.length < 28
        || text.length > 140
        || wordCount < 5
        || !isGroundedExcerpt(text, input.clipTranscriptText)
      ) {
        return [];
      }

      const characterIndex = Math.max(0, segmentText.indexOf(text));
      const proportionalOffset = segmentText.length > 0
        ? (characterIndex / segmentText.length) * segmentDuration
        : 0;
      const absoluteStart = Math.max(
        input.clipStartSeconds,
        segment.startTimeSeconds + proportionalOffset,
      );
      const clipRelativeStart = Math.max(0, absoluteStart - input.clipStartSeconds);
      const clipDuration = Math.max(1, input.clipEndSeconds - input.clipStartSeconds);
      const startSeconds = Math.min(Math.max(0, clipDuration - 1), clipRelativeStart);
      const durationSeconds = Math.min(6, Math.max(2.5, clipDuration - startSeconds));

      return [{
        segmentId: segment.id,
        text,
        segmentText,
        startSeconds: Number(startSeconds.toFixed(1)),
        durationSeconds: Number(durationSeconds.toFixed(1)),
        confidence: segment.confidence ?? 0.75,
      }];
    });
  });
}

function intelligenceAnchors(input: ClipBrollSuggestionInput): string[] {
  return [
    input.intelligence?.centralTheme ?? "",
    ...(input.intelligence?.keyTakeaways ?? []),
    input.intelligence?.ministryMomentTranscriptExcerpt ?? "",
    input.intelligence?.reasonSelected ?? "",
  ].map(normalizeWhitespace).filter(Boolean);
}

function quoteScore(candidate: PhraseCandidate, anchors: string[]): number {
  let score = candidate.text.length >= 42 && candidate.text.length <= 118 ? 4 : 2;
  score += /[.!?]$/.test(candidate.text) ? 1 : 0;
  score += APPLICATION_LANGUAGE.test(candidate.text) ? 2 : 0;
  score += /\b(?:God|Jesus|Christ|faith|grace|hope|love|truth|purpose|calling|kingdom)\b/i.test(candidate.text) ? 1 : 0;
  score += Math.min(2, Math.max(0, candidate.confidence - 0.7) * 5);

  const anchorOverlap = anchors.reduce(
    (best, anchor) => Math.max(best, evidenceOverlap(candidate.text, anchor)),
    0,
  );
  score += anchorOverlap * 3;

  if (/^(?:and|but|so|because|then|it|this|that|they|he|she)\b/i.test(candidate.text)) {
    score -= 1.5;
  }

  return score;
}

function spokenReferenceVariants(reference: string): string[] {
  const normalized = normalizeForEvidence(reference);
  const parsed = normalized.match(/^(.+?)\s+(\d{1,3})\s+(\d{1,3})(?:\s+(\d{1,3}))?$/);
  if (!parsed) {
    return [normalized];
  }

  const [, book, chapter, verseStart, verseEnd] = parsed;
  const verseRange = verseEnd ? `${verseStart} ${verseEnd}` : verseStart;
  return [
    normalized,
    `${book} chapter ${chapter} verse ${verseRange}`,
    `${book} ${chapter} verse ${verseRange}`,
  ];
}

function findScriptureGrounding(
  input: ClipBrollSuggestionInput,
  reference: NonNullable<ClipBrollSuggestionInput["scriptureReferences"]>[number],
  candidates: PhraseCandidate[],
): PhraseCandidate | null {
  const variants = spokenReferenceVariants(reference.reference);
  const evidence = normalizeWhitespace(reference.transcriptEvidence ?? "");

  return candidates.find((candidate) => {
    const normalizedCandidate = normalizeForEvidence(candidate.segmentText);
    const spokenInSegment = variants.some(
      (variant) => variant.length >= 4 && normalizedCandidate.includes(variant),
    );
    if (spokenInSegment) {
      return true;
    }

    return evidence.length >= 16
      && isGroundedExcerpt(evidence, candidate.segmentText)
      && isGroundedExcerpt(evidence, input.clipTranscriptText);
  }) ?? null;
}

function createSuggestion(
  revisionKey: string,
  type: ClipBrollSuggestionType,
  candidate: PhraseCandidate,
  text: string,
  sourceLabel: string,
  sourceExcerpt: string,
): ClipBrollSuggestion {
  const tone: BrollCardTone = type === "scripture"
    ? "scripture"
    : type === "takeaway"
      ? "application"
      : "quote";

  return {
    id: `suggestion-${type}-${hashText(`${candidate.segmentId}:${text}`)}`,
    revisionKey,
    type,
    text,
    label: type === "scripture"
      ? "Scripture reference"
      : type === "takeaway"
        ? "Takeaway"
        : "Key quote",
    startSeconds: candidate.startSeconds,
    durationSeconds: candidate.durationSeconds,
    tone,
    position: "full",
    sourceLabel,
    sourceExcerpt: normalizeWhitespace(sourceExcerpt).slice(0, 180),
  };
}

export function buildClipBrollSuggestions(
  input: ClipBrollSuggestionInput,
): ClipBrollSuggestion[] {
  if (
    input.transcriptSafetyStatus === "REVIEW_REQUIRED"
    || input.clipEndSeconds <= input.clipStartSeconds
    || normalizeWhitespace(input.clipTranscriptText).length < 28
  ) {
    return [];
  }

  const revisionKey = buildClipBrollSuggestionRevision(input);
  const candidates = phraseCandidates(input);
  if (candidates.length === 0) {
    return [];
  }

  const anchors = intelligenceAnchors(input);
  const rankedQuotes = [...candidates].sort((left, right) => {
    const scoreDifference = quoteScore(right, anchors) - quoteScore(left, anchors);
    return scoreDifference !== 0
      ? scoreDifference
      : left.startSeconds - right.startSeconds;
  });
  const quote = rankedQuotes[0];
  const suggestions: ClipBrollSuggestion[] = [
    createSuggestion(
      revisionKey,
      "quote",
      quote,
      quote.text,
      "Spoken transcript · exact wording",
      quote.text,
    ),
  ];

  const groundedScripture = (input.scriptureReferences ?? [])
    .filter((reference) => normalizeWhitespace(reference.reference).length > 0)
    .map((reference) => ({
      reference,
      grounding: findScriptureGrounding(input, reference, candidates),
    }))
    .filter((item): item is typeof item & { grounding: PhraseCandidate } => item.grounding !== null)
    .sort((left, right) => {
      const leftScore = left.reference.confidenceScore ?? (left.reference.isManuallyAdded ? 1 : 0);
      const rightScore = right.reference.confidenceScore ?? (right.reference.isManuallyAdded ? 1 : 0);
      return rightScore - leftScore;
    })[0];

  if (groundedScripture) {
    suggestions.push(
      createSuggestion(
        revisionKey,
        "scripture",
        groundedScripture.grounding,
        normalizeWhitespace(groundedScripture.reference.reference).slice(0, 140),
        "Sermon intelligence · spoken transcript evidence",
        groundedScripture.reference.transcriptEvidence || groundedScripture.grounding.segmentText,
      ),
    );
    return suggestions.slice(0, 2);
  }

  let takeaway = rankedQuotes.find(
    (candidate) =>
      candidate.segmentId !== quote.segmentId
      && candidate.text !== quote.text
      && APPLICATION_LANGUAGE.test(candidate.text),
  );
  if (!takeaway && APPLICATION_LANGUAGE.test(quote.text)) {
    const alternateQuote = rankedQuotes.find(
      (candidate) =>
        candidate.segmentId !== quote.segmentId
        && candidate.text !== quote.text
        && !APPLICATION_LANGUAGE.test(candidate.text),
    );
    if (alternateQuote) {
      suggestions[0] = createSuggestion(
        revisionKey,
        "quote",
        alternateQuote,
        alternateQuote.text,
        "Spoken transcript · exact wording",
        alternateQuote.text,
      );
      takeaway = quote;
    }
  }

  if (takeaway) {
    suggestions.push(
      createSuggestion(
        revisionKey,
        "takeaway",
        takeaway,
        takeaway.text,
        "Spoken transcript · concise exact excerpt",
        takeaway.text,
      ),
    );
  }

  return suggestions.slice(0, 2);
}

export function getCachedClipBrollSuggestions(
  input: ClipBrollSuggestionInput,
): readonly ClipBrollSuggestion[] {
  const revisionKey = buildClipBrollSuggestionRevision(input);
  const cached = suggestionCache.get(revisionKey);
  if (cached) {
    suggestionCache.delete(revisionKey);
    suggestionCache.set(revisionKey, cached);
    return cached;
  }

  const suggestions = Object.freeze(
    buildClipBrollSuggestions(input).map((suggestion) => Object.freeze(suggestion)),
  );
  suggestionCache.set(revisionKey, suggestions);

  if (suggestionCache.size > MAX_SUGGESTION_CACHE_ENTRIES) {
    const oldestKey = suggestionCache.keys().next().value;
    if (typeof oldestKey === "string") {
      suggestionCache.delete(oldestKey);
    }
  }

  return suggestions;
}

export function clearClipBrollSuggestionCacheForTests(): void {
  suggestionCache.clear();
}
