export const TRANSCRIPT_LANGUAGE_PROFILES = [
  "ENGLISH",
  "NGUNI_LOCAL",
  "SOTHO_TSWANA",
  "MIXED",
  "UNKNOWN",
] as const;

export type TranscriptLanguageProfile = typeof TRANSCRIPT_LANGUAGE_PROFILES[number];

export const TRANSCRIPT_CONFIDENCE_BANDS = ["HIGH", "REVIEW", "LOW", "UNKNOWN"] as const;

export type TranscriptConfidenceBand = typeof TRANSCRIPT_CONFIDENCE_BANDS[number];

export type MultilingualTranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  /** Provider confidence on a 0-1 scale. Missing or invalid values remain unknown. */
  confidence?: number | null;
};

export type TranscriptReviewReasonCode =
  | "LOCAL_LANGUAGE_DETECTED"
  | "CODE_SWITCHING_DETECTED"
  | "LOW_CONFIDENCE_TRANSCRIPT"
  | "PARTIAL_CONFIDENCE_COVERAGE"
  | "MISSING_CONFIDENCE"
  | "UNKNOWN_LANGUAGE"
  | "INVALID_SEGMENTS_IGNORED"
  | "NO_USABLE_SEGMENTS";

export type TranscriptReviewReason = {
  code: TranscriptReviewReasonCode;
  message: string;
};

export type UncertainTranscriptRegionReason =
  | "LOW_CONFIDENCE"
  | "MISSING_CONFIDENCE"
  | "CODE_SWITCHING";

export type UncertainTranscriptRegion = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  /** Lowest real provider confidence in the region, or null when none was supplied. */
  confidence: number | null;
  reasons: UncertainTranscriptRegionReason[];
};

export type CodeSwitchAnalysis = {
  detected: boolean;
  withinSegment: boolean;
  betweenSegments: boolean;
  transitionTimesSeconds: number[];
};

export type LanguageMarkerEvidence = {
  englishMarkerCount: number;
  nguniMarkerCount: number;
  sothoTswanaMarkerCount: number;
};

export type MultilingualTranscriptAnalysis = {
  languageProfile: TranscriptLanguageProfile;
  codeSwitching: CodeSwitchAnalysis;
  confidenceBand: TranscriptConfidenceBand;
  /** Duration-weighted average of real provider values only. */
  averageConfidence: number | null;
  minimumConfidence: number | null;
  knownConfidenceCoverageRatio: number;
  lowConfidenceCoverageRatio: number;
  uncertainRegions: UncertainTranscriptRegion[];
  reviewReasons: TranscriptReviewReason[];
  requiresHumanReview: boolean;
  markerEvidence: LanguageMarkerEvidence;
  usableSegmentCount: number;
  invalidSegmentCount: number;
};

export type LocalLanguageFamily = "NGUNI_LOCAL" | "SOTHO_TSWANA";
export type LocalMarkerKind = "SPIRITUAL_ANCHOR" | "ACTION";

export type LocalMarkerMatch = {
  family: LocalLanguageFamily;
  kind: LocalMarkerKind;
  /** Original normalized token. It is never translated or replaced with a gloss. */
  token: string;
};

const ENGLISH_MARKERS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "have",
  "will",
  "your",
  "you",
  "our",
  "because",
  "when",
  "what",
  "today",
  "should",
  "must",
  "god",
  "jesus",
  "lord",
  "faith",
  "faithful",
  "pray",
  "prayer",
  "church",
  "scripture",
]);

const NGUNI_LANGUAGE_MARKERS = new Set([
  "ukuthi",
  "ngoba",
  "kodwa",
  "kwaye",
  "ngoko",
  "ngakho",
  "manje",
  "futhi",
  "abantu",
  "umuntu",
  "sonke",
  "lapho",
  "noma",
  "wethu",
  "yethu",
  "kufanele",
  "sifanele",
]);

const SOTHO_TSWANA_LANGUAGE_MARKERS = new Set([
  "hobane",
  "empa",
  "joale",
  "hona",
  "leha",
  "batho",
  "motho",
  "rona",
  "lona",
  "gonne",
  "mme",
  "jaanong",
  "fela",
  "tshwanetse",
]);

const NGUNI_SPIRITUAL_ANCHORS = new Set([
  "unkulunkulu",
  "uthixo",
  "ujesu",
  "nojesu",
  "kujesu",
  "ngojesu",
  "ukristu",
  "ibhayibheli",
  "izibhalo",
  "umbhalo",
  "ivangeli",
  "ukholo",
  "umthandazo",
  "ibandla",
  "isiphambano",
  "uvuko",
  "insindiso",
]);

const SOTHO_TSWANA_SPIRITUAL_ANCHORS = new Set([
  "modimo",
  "jesu",
  "kresete",
  "baebele",
  "bibele",
  "lengolo",
  "evangeli",
  "tumelo",
  "thapelo",
  "kereke",
  "sefapano",
  "tsoho",
  "poloko",
]);

const NGUNI_ACTION_MARKERS = new Set([
  "khetha",
  "kholwa",
  "themba",
  "thandaza",
  "phenduka",
  "guquka",
  "thethelela",
  "xolela",
  "khonza",
  "nikela",
  "landela",
  "lalela",
  "mamela",
  "hamba",
  "woza",
  "yiza",
]);

const SOTHO_TSWANA_ACTION_MARKERS = new Set([
  "kgetha",
  "tlhopha",
  "dumella",
  "dumela",
  "tsepa",
  "tshepa",
  "ikanye",
  "rapela",
  "bakela",
  "ikwatlhaya",
  "tshwarela",
  "sebeletsa",
  "direla",
  "inehela",
  "ineela",
  "latela",
  "mamela",
  "utlwa",
  "tsamaya",
]);

const REVIEW_CONFIDENCE_THRESHOLD = 0.78;
const LOW_CONFIDENCE_THRESHOLD = 0.62;
const HIGH_AVERAGE_CONFIDENCE_THRESHOLD = 0.84;
const MIN_HIGH_CONFIDENCE_COVERAGE = 0.85;
const MIN_KNOWN_CONFIDENCE_COVERAGE = 0.5;

/** Unicode-aware tokenization. Letter marks and apostrophes are preserved. */
export function tokenizeUnicode(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)*/gu) ?? [];
}

function markerKey(token: string): string {
  return token
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’']/g, "")
    .toLocaleLowerCase("en");
}

function markerKeys(text: string): string[] {
  return tokenizeUnicode(text).map(markerKey);
}

function countMarkerHits(tokens: string[], markers: Set<string>): number {
  return tokens.reduce((count, token) => count + (markers.has(token) ? 1 : 0), 0);
}

function localMarkerMatches(
  text: string,
  kind: LocalMarkerKind,
): LocalMarkerMatch[] {
  const matches = new Map<string, LocalMarkerMatch>();
  for (const token of tokenizeUnicode(text)) {
    const key = markerKey(token);
    const markerSets = kind === "SPIRITUAL_ANCHOR"
      ? [
          ["NGUNI_LOCAL", NGUNI_SPIRITUAL_ANCHORS],
          ["SOTHO_TSWANA", SOTHO_TSWANA_SPIRITUAL_ANCHORS],
        ] as const
      : [
          ["NGUNI_LOCAL", NGUNI_ACTION_MARKERS],
          ["SOTHO_TSWANA", SOTHO_TSWANA_ACTION_MARKERS],
        ] as const;

    for (const [family, markers] of markerSets) {
      if (!markers.has(key)) continue;
      const match: LocalMarkerMatch = { family, kind, token };
      matches.set(`${family}:${kind}:${key}`, match);
    }
  }
  return [...matches.values()];
}

export function findLocalSpiritualAnchorMarkers(text: string): LocalMarkerMatch[] {
  return localMarkerMatches(text, "SPIRITUAL_ANCHOR");
}

export function hasLocalSpiritualAnchor(text: string): boolean {
  return findLocalSpiritualAnchorMarkers(text).length > 0;
}

export function findLocalActionMarkers(text: string): LocalMarkerMatch[] {
  return localMarkerMatches(text, "ACTION");
}

export function hasLocalActionMarker(text: string): boolean {
  return findLocalActionMarkers(text).length > 0;
}

type InternalLanguageEvidence = LanguageMarkerEvidence & {
  profile: TranscriptLanguageProfile;
};

function languageEvidence(text: string): InternalLanguageEvidence {
  const tokens = markerKeys(text);
  const spiritualMatches = findLocalSpiritualAnchorMarkers(text);
  const actionMatches = findLocalActionMarkers(text);
  const nguniStrongCount = [...spiritualMatches, ...actionMatches]
    .filter((match) => match.family === "NGUNI_LOCAL").length;
  const sothoStrongCount = [...spiritualMatches, ...actionMatches]
    .filter((match) => match.family === "SOTHO_TSWANA").length;
  const englishMarkerCount = countMarkerHits(tokens, ENGLISH_MARKERS);
  const nguniMarkerCount = countMarkerHits(tokens, NGUNI_LANGUAGE_MARKERS) + nguniStrongCount;
  const sothoTswanaMarkerCount = countMarkerHits(tokens, SOTHO_TSWANA_LANGUAGE_MARKERS) + sothoStrongCount;
  const hasEnglishEvidence = englishMarkerCount >= 2;
  const hasNguniEvidence = nguniStrongCount >= 1 || nguniMarkerCount >= 2;
  const hasSothoTswanaEvidence = sothoStrongCount >= 1 || sothoTswanaMarkerCount >= 2;
  const evidenceFamilies = [hasEnglishEvidence, hasNguniEvidence, hasSothoTswanaEvidence]
    .filter(Boolean).length;
  const profile: TranscriptLanguageProfile = evidenceFamilies > 1
    ? "MIXED"
    : hasNguniEvidence
      ? "NGUNI_LOCAL"
      : hasSothoTswanaEvidence
        ? "SOTHO_TSWANA"
        : hasEnglishEvidence
          ? "ENGLISH"
          : "UNKNOWN";

  return {
    profile,
    englishMarkerCount,
    nguniMarkerCount,
    sothoTswanaMarkerCount,
  };
}

function isUsableSegment(segment: MultilingualTranscriptSegment): boolean {
  return (
    Number.isFinite(segment.startTimeSeconds) &&
    Number.isFinite(segment.endTimeSeconds) &&
    segment.startTimeSeconds >= 0 &&
    segment.endTimeSeconds > segment.startTimeSeconds &&
    segment.text.trim().length > 0
  );
}

function realConfidence(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function duration(segment: MultilingualTranscriptSegment): number {
  return Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds);
}

function confidenceBand(input: {
  averageConfidence: number | null;
  minimumConfidence: number | null;
  knownCoverageRatio: number;
  lowCoverageRatio: number;
}): TranscriptConfidenceBand {
  if (input.averageConfidence === null || input.knownCoverageRatio < MIN_KNOWN_CONFIDENCE_COVERAGE) {
    return "UNKNOWN";
  }
  if (
    input.averageConfidence < LOW_CONFIDENCE_THRESHOLD ||
    (input.minimumConfidence ?? 1) < LOW_CONFIDENCE_THRESHOLD ||
    input.lowCoverageRatio >= 0.25
  ) {
    return "LOW";
  }
  if (
    input.averageConfidence < HIGH_AVERAGE_CONFIDENCE_THRESHOLD ||
    input.knownCoverageRatio < MIN_HIGH_CONFIDENCE_COVERAGE ||
    (input.minimumConfidence ?? 1) < REVIEW_CONFIDENCE_THRESHOLD ||
    input.lowCoverageRatio > 0
  ) {
    return "REVIEW";
  }
  return "HIGH";
}

function profileFamily(profile: TranscriptLanguageProfile): TranscriptLanguageProfile | null {
  return profile === "UNKNOWN" ? null : profile;
}

function analyzeCodeSwitching(
  segmentEvidence: Array<{ segment: MultilingualTranscriptSegment; evidence: InternalLanguageEvidence }>,
): CodeSwitchAnalysis {
  const withinSegment = segmentEvidence.some(({ evidence }) => evidence.profile === "MIXED");
  const transitionTimesSeconds: number[] = [];
  let previousFamily: TranscriptLanguageProfile | null = null;

  for (const { segment, evidence } of segmentEvidence) {
    const family = profileFamily(evidence.profile);
    if (!family || family === "MIXED") continue;
    if (previousFamily && previousFamily !== family) {
      transitionTimesSeconds.push(segment.startTimeSeconds);
    }
    previousFamily = family;
  }

  return {
    detected: withinSegment || transitionTimesSeconds.length > 0,
    withinSegment,
    betweenSegments: transitionTimesSeconds.length > 0,
    transitionTimesSeconds: [...new Set(transitionTimesSeconds)],
  };
}

function sameReasons(left: UncertainTranscriptRegionReason[], right: UncertainTranscriptRegionReason[]): boolean {
  return left.length === right.length && left.every((reason) => right.includes(reason));
}

function buildUncertainRegions(
  segmentEvidence: Array<{ segment: MultilingualTranscriptSegment; evidence: InternalLanguageEvidence }>,
  codeSwitching: CodeSwitchAnalysis,
): UncertainTranscriptRegion[] {
  const regions: UncertainTranscriptRegion[] = [];
  const transitionTimes = new Set(codeSwitching.transitionTimesSeconds);

  for (const { segment, evidence } of segmentEvidence) {
    const confidence = realConfidence(segment.confidence);
    const reasons: UncertainTranscriptRegionReason[] = [];
    if (confidence === null) reasons.push("MISSING_CONFIDENCE");
    else if (confidence < REVIEW_CONFIDENCE_THRESHOLD) reasons.push("LOW_CONFIDENCE");
    if (evidence.profile === "MIXED" || transitionTimes.has(segment.startTimeSeconds)) {
      reasons.push("CODE_SWITCHING");
    }
    if (reasons.length === 0) continue;

    const previous = regions.at(-1);
    if (
      previous &&
      segment.startTimeSeconds - previous.endTimeSeconds <= 0.35 &&
      sameReasons(previous.reasons, reasons)
    ) {
      previous.endTimeSeconds = segment.endTimeSeconds;
      previous.text = `${previous.text} ${segment.text.trim()}`.trim();
      previous.confidence = previous.confidence === null || confidence === null
        ? previous.confidence ?? confidence
        : Math.min(previous.confidence, confidence);
      continue;
    }

    regions.push({
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds,
      text: segment.text.trim(),
      confidence,
      reasons,
    });
  }

  return regions;
}

function pushReason(
  reasons: TranscriptReviewReason[],
  code: TranscriptReviewReasonCode,
  message: string,
): void {
  if (!reasons.some((reason) => reason.code === code)) {
    reasons.push({ code, message });
  }
}

export function analyzeMultilingualTranscript(
  inputSegments: MultilingualTranscriptSegment[],
): MultilingualTranscriptAnalysis {
  const usableSegments = inputSegments
    .filter(isUsableSegment)
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  const invalidSegmentCount = inputSegments.length - usableSegments.length;
  const transcriptText = usableSegments.map((segment) => segment.text.trim()).join(" ");
  const overallEvidence = languageEvidence(transcriptText);
  const segmentEvidence = usableSegments.map((segment) => ({
    segment,
    evidence: languageEvidence(segment.text),
  }));
  const codeSwitching = analyzeCodeSwitching(segmentEvidence);
  const totalDuration = usableSegments.reduce((sum, segment) => sum + duration(segment), 0);
  const knownSegments = usableSegments
    .map((segment) => ({ segment, confidence: realConfidence(segment.confidence) }))
    .filter((item): item is { segment: MultilingualTranscriptSegment; confidence: number } => item.confidence !== null);
  const knownDuration = knownSegments.reduce((sum, item) => sum + duration(item.segment), 0);
  const weightedConfidence = knownSegments.reduce(
    (sum, item) => sum + item.confidence * duration(item.segment),
    0,
  );
  const averageConfidence = knownDuration > 0
    ? Number((weightedConfidence / knownDuration).toFixed(4))
    : null;
  const minimumConfidence = knownSegments.length > 0
    ? Math.min(...knownSegments.map((item) => item.confidence))
    : null;
  const knownConfidenceCoverageRatio = totalDuration > 0
    ? Number((knownDuration / totalDuration).toFixed(4))
    : 0;
  const lowConfidenceDuration = knownSegments
    .filter((item) => item.confidence < REVIEW_CONFIDENCE_THRESHOLD)
    .reduce((sum, item) => sum + duration(item.segment), 0);
  const lowConfidenceCoverageRatio = totalDuration > 0
    ? Number((lowConfidenceDuration / totalDuration).toFixed(4))
    : 0;
  const resolvedConfidenceBand = confidenceBand({
    averageConfidence,
    minimumConfidence,
    knownCoverageRatio: knownConfidenceCoverageRatio,
    lowCoverageRatio: lowConfidenceCoverageRatio,
  });
  const uncertainRegions = buildUncertainRegions(segmentEvidence, codeSwitching);
  const reviewReasons: TranscriptReviewReason[] = [];

  if (usableSegments.length === 0) {
    pushReason(reviewReasons, "NO_USABLE_SEGMENTS", "No usable timed transcript segments were available for this clip.");
  }
  if (invalidSegmentCount > 0) {
    pushReason(reviewReasons, "INVALID_SEGMENTS_IGNORED", "Some transcript segments had invalid timing or no wording and were ignored.");
  }
  if (["NGUNI_LOCAL", "SOTHO_TSWANA", "MIXED"].includes(overallEvidence.profile)) {
    pushReason(reviewReasons, "LOCAL_LANGUAGE_DETECTED", "Local-language wording should be confirmed by a fluent reviewer before approval.");
  }
  if (codeSwitching.detected || overallEvidence.profile === "MIXED") {
    pushReason(reviewReasons, "CODE_SWITCHING_DETECTED", "The clip appears to switch languages, so wording around the language change should be checked.");
  }
  if (resolvedConfidenceBand === "LOW" || resolvedConfidenceBand === "REVIEW") {
    pushReason(reviewReasons, "LOW_CONFIDENCE_TRANSCRIPT", "Part of the transcript has lower provider confidence and should be checked against the audio.");
  }
  if (knownConfidenceCoverageRatio === 0 && usableSegments.length > 0) {
    pushReason(reviewReasons, "MISSING_CONFIDENCE", "The transcription provider did not supply confidence for this clip.");
  } else if (knownConfidenceCoverageRatio < 1) {
    pushReason(reviewReasons, "PARTIAL_CONFIDENCE_COVERAGE", "Provider confidence is available for only part of this clip.");
  }
  if (overallEvidence.profile === "UNKNOWN" && usableSegments.length > 0) {
    pushReason(reviewReasons, "UNKNOWN_LANGUAGE", "The transcript language could not be identified safely from the available wording.");
  }

  return {
    languageProfile: overallEvidence.profile,
    codeSwitching,
    confidenceBand: resolvedConfidenceBand,
    averageConfidence,
    minimumConfidence,
    knownConfidenceCoverageRatio,
    lowConfidenceCoverageRatio,
    uncertainRegions,
    reviewReasons,
    requiresHumanReview: reviewReasons.length > 0,
    markerEvidence: {
      englishMarkerCount: overallEvidence.englishMarkerCount,
      nguniMarkerCount: overallEvidence.nguniMarkerCount,
      sothoTswanaMarkerCount: overallEvidence.sothoTswanaMarkerCount,
    },
    usableSegmentCount: usableSegments.length,
    invalidSegmentCount,
  };
}
