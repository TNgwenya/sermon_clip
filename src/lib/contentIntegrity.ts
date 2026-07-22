export type QuoteVerificationStatus =
  | "VERIFIED"
  | "QUOTE_MISSING"
  | "EVIDENCE_MISSING"
  | "QUOTE_TOO_SHORT"
  | "TOO_MANY_OMISSIONS"
  | "MISMATCH";

export type QuoteVerificationResult = {
  verified: boolean;
  status: QuoteVerificationStatus;
  normalizedQuote: string;
  omissionCount: number;
  matchedSource: "SOURCE_EXCERPT" | "TRANSCRIPT_SEGMENTS" | null;
  message: string;
};

export type TranscriptSegmentEvidence = string | { text: string | null | undefined };

export type TimedTranscriptSegmentEvidence = {
  id: string;
  transcriptId?: string | null;
  text: string | null | undefined;
  startTimeSeconds: number;
  endTimeSeconds: number;
};

export type QuoteTranscriptSegmentSpan = {
  segmentIds: string[];
  transcriptId: string | null;
  startTimeSeconds: number;
  endTimeSeconds: number;
  excerpt: string;
  verification: QuoteVerificationResult;
};

export type ProductionCopyField = "ARTWORK" | "CAPTION";
export type ProductionCopyIssueKind = "PLACEHOLDER" | "INSTRUCTION";

export type ProductionCopyIssue = {
  field: ProductionCopyField;
  kind: ProductionCopyIssueKind;
  matchedText: string;
};

export type ScriptureVersionStatus = "MISSING" | "RECOGNIZED" | "UNRECOGNIZED";

export type ScriptureReferenceValidation = {
  valid: boolean;
  normalizedReference: string | null;
  version: string | null;
  versionStatus: ScriptureVersionStatus;
  errors: string[];
};

export type TranslationReviewReason =
  | "EXPLICIT_REVIEW_REQUIRED"
  | "HUMAN_TRANSLATION_APPROVAL_REQUIRED"
  | "LOW_TRANSLATION_CONFIDENCE"
  | "TRANSLATION_UNCERTAINTY_RECORDED"
  | "SCRIPTURE_VERSION_MISSING"
  | "SCRIPTURE_VERSION_UNRECOGNIZED"
  | "SCRIPTURE_VERSION_APPROVAL_REQUIRED";

export type TranslationReviewState = {
  status: "CLEAR" | "BLOCKED";
  blocking: boolean;
  reasons: TranslationReviewReason[];
  message: string;
};

export type TranslationReviewInput = {
  translationNeedsReview?: boolean | null;
  translatedFromLanguage?: string | null;
  originalLanguageText?: string | null;
  translatedText?: string | null;
  translationConfidence?: number | null;
  translationUncertaintyNote?: string | null;
  humanTranslationApproved?: boolean | null;
  scriptureVersion?: string | null;
  scriptureVersionRequired?: boolean;
  scriptureVersionApproved?: boolean | null;
};

const MAX_QUOTE_ELLIPSES = 2;
const MAX_OMITTED_WORDS_PER_ELLIPSIS = 80;
const MIN_QUOTE_WORDS = 3;

const PLACEHOLDER_PATTERNS = [
  /\{\{[^{}\n]{1,100}\}\}/giu,
  /\[\s*(?:insert|add|replace|church\s+name|pastor\s+name|date|time|link|url|scripture|verse|caption|headline|cta|photo|image|logo|location|placeholder|tbd|todo)\b[^\]\n]*\]/giu,
  /<\s*(?:insert|add|replace|church\s+name|pastor\s+name|date|time|link|url|scripture|verse|caption|headline|cta|photo|image|logo|location|placeholder|tbd|todo)\b[^>\n]*>/giu,
  /\b(?:lorem\s+ipsum|placeholder\s+text|tbd|todo)\b/giu,
];

const PRODUCTION_INSTRUCTION_PATTERNS = [
  /\b(?:design|designer|production|visual|layout|artwork|art|media)\s+(?:note|direction|instruction)s?\s*:/giu,
  /\b(?:for\s+the\s+designer|designer\s+should|production\s+team\s+should|media\s+team\s+should)\b/giu,
  /\b(?:add|insert|place|use|include|remove|replace|choose|make)\s+(?:(?:a|an|the|small|large|church|brand)\s+){0,3}(?:logo|footer|background|photo|image|texture|font|colour|color|watermark)\b/giu,
];

const RECOGNIZED_SCRIPTURE_VERSIONS = new Set([
  "AMP",
  "AMPC",
  "ASV",
  "CEV",
  "CSB",
  "ESV",
  "GNT",
  "HCSB",
  "KJV",
  "MSG",
  "NASB",
  "NASB1995",
  "NET",
  "NIV",
  "NKJV",
  "NLT",
  "NRSV",
  "NRSVUE",
  "RSV",
  "WEB",
  "YLT",
]);

type ScriptureBook = {
  canonical: string;
  maxChapter: number;
  aliases?: string[];
};

const SCRIPTURE_BOOKS: ScriptureBook[] = [
  { canonical: "Genesis", maxChapter: 50, aliases: ["Gen"] },
  { canonical: "Exodus", maxChapter: 40, aliases: ["Exod", "Ex"] },
  { canonical: "Leviticus", maxChapter: 27, aliases: ["Lev"] },
  { canonical: "Numbers", maxChapter: 36, aliases: ["Num"] },
  { canonical: "Deuteronomy", maxChapter: 34, aliases: ["Deut"] },
  { canonical: "Joshua", maxChapter: 24, aliases: ["Josh"] },
  { canonical: "Judges", maxChapter: 21, aliases: ["Judg"] },
  { canonical: "Ruth", maxChapter: 4 },
  { canonical: "1 Samuel", maxChapter: 31, aliases: ["1 Sam"] },
  { canonical: "2 Samuel", maxChapter: 24, aliases: ["2 Sam"] },
  { canonical: "1 Kings", maxChapter: 22, aliases: ["1 Kgs"] },
  { canonical: "2 Kings", maxChapter: 25, aliases: ["2 Kgs"] },
  { canonical: "1 Chronicles", maxChapter: 29, aliases: ["1 Chron", "1 Chr"] },
  { canonical: "2 Chronicles", maxChapter: 36, aliases: ["2 Chron", "2 Chr"] },
  { canonical: "Ezra", maxChapter: 10 },
  { canonical: "Nehemiah", maxChapter: 13, aliases: ["Neh"] },
  { canonical: "Esther", maxChapter: 10, aliases: ["Esth"] },
  { canonical: "Job", maxChapter: 42 },
  { canonical: "Psalms", maxChapter: 150, aliases: ["Psalm", "Ps"] },
  { canonical: "Proverbs", maxChapter: 31, aliases: ["Prov"] },
  { canonical: "Ecclesiastes", maxChapter: 12, aliases: ["Eccl"] },
  { canonical: "Song of Solomon", maxChapter: 8, aliases: ["Song of Songs", "Song"] },
  { canonical: "Isaiah", maxChapter: 66, aliases: ["Isa"] },
  { canonical: "Jeremiah", maxChapter: 52, aliases: ["Jer"] },
  { canonical: "Lamentations", maxChapter: 5, aliases: ["Lam"] },
  { canonical: "Ezekiel", maxChapter: 48, aliases: ["Ezek"] },
  { canonical: "Daniel", maxChapter: 12, aliases: ["Dan"] },
  { canonical: "Hosea", maxChapter: 14, aliases: ["Hos"] },
  { canonical: "Joel", maxChapter: 3 },
  { canonical: "Amos", maxChapter: 9 },
  { canonical: "Obadiah", maxChapter: 1, aliases: ["Obad"] },
  { canonical: "Jonah", maxChapter: 4 },
  { canonical: "Micah", maxChapter: 7, aliases: ["Mic"] },
  { canonical: "Nahum", maxChapter: 3, aliases: ["Nah"] },
  { canonical: "Habakkuk", maxChapter: 3, aliases: ["Hab"] },
  { canonical: "Zephaniah", maxChapter: 3, aliases: ["Zeph"] },
  { canonical: "Haggai", maxChapter: 2, aliases: ["Hag"] },
  { canonical: "Zechariah", maxChapter: 14, aliases: ["Zech"] },
  { canonical: "Malachi", maxChapter: 4, aliases: ["Mal"] },
  { canonical: "Matthew", maxChapter: 28, aliases: ["Matt"] },
  { canonical: "Mark", maxChapter: 16 },
  { canonical: "Luke", maxChapter: 24 },
  { canonical: "John", maxChapter: 21, aliases: ["Jn"] },
  { canonical: "Acts", maxChapter: 28 },
  { canonical: "Romans", maxChapter: 16, aliases: ["Rom"] },
  { canonical: "1 Corinthians", maxChapter: 16, aliases: ["1 Cor"] },
  { canonical: "2 Corinthians", maxChapter: 13, aliases: ["2 Cor"] },
  { canonical: "Galatians", maxChapter: 6, aliases: ["Gal"] },
  { canonical: "Ephesians", maxChapter: 6, aliases: ["Eph"] },
  { canonical: "Philippians", maxChapter: 4, aliases: ["Phil"] },
  { canonical: "Colossians", maxChapter: 4, aliases: ["Col"] },
  { canonical: "1 Thessalonians", maxChapter: 5, aliases: ["1 Thess"] },
  { canonical: "2 Thessalonians", maxChapter: 3, aliases: ["2 Thess"] },
  { canonical: "1 Timothy", maxChapter: 6, aliases: ["1 Tim"] },
  { canonical: "2 Timothy", maxChapter: 4, aliases: ["2 Tim"] },
  { canonical: "Titus", maxChapter: 3 },
  { canonical: "Philemon", maxChapter: 1, aliases: ["Philem"] },
  { canonical: "Hebrews", maxChapter: 13, aliases: ["Heb"] },
  { canonical: "James", maxChapter: 5, aliases: ["Jas"] },
  { canonical: "1 Peter", maxChapter: 5, aliases: ["1 Pet"] },
  { canonical: "2 Peter", maxChapter: 3, aliases: ["2 Pet"] },
  { canonical: "1 John", maxChapter: 5, aliases: ["1 Jn"] },
  { canonical: "2 John", maxChapter: 1, aliases: ["2 Jn"] },
  { canonical: "3 John", maxChapter: 1, aliases: ["3 Jn"] },
  { canonical: "Jude", maxChapter: 1 },
  { canonical: "Revelation", maxChapter: 22, aliases: ["Rev"] },
];

const BOOK_LOOKUP = SCRIPTURE_BOOKS.flatMap((book) => (
  [book.canonical, ...(book.aliases ?? [])].map((alias) => ({
    alias,
    normalizedAlias: normalizeBookName(alias),
    book,
  }))
)).sort((left, right) => right.normalizedAlias.length - left.normalizedAlias.length);

export function normalizeIntegrityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[‘’]/gu, "'")
    .replace(/[‐‑‒–—-]/gu, " ")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/(?:^|\s)'|'(?:\s|$)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeBookName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\./gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function toWords(value: string): string[] {
  const normalized = normalizeIntegrityText(value);
  return normalized ? normalized.split(" ") : [];
}

function normalizedTranscriptSegments(segments: TranscriptSegmentEvidence[] | undefined): string[] {
  return (segments ?? [])
    .map((segment) => typeof segment === "string" ? segment : segment.text ?? "")
    .map((text) => text.trim())
    .filter(Boolean);
}

type OrderedWordSpan = {
  start: number;
  end: number;
};

function findOrderedQuoteWordSpan(
  quoteParts: string[][],
  evidenceWords: string[],
): OrderedWordSpan | null {
  const search = (
    partIndex: number,
    nextStart: number,
    previousEnd: number | null,
    firstStart: number | null,
  ): OrderedWordSpan | null => {
    const part = quoteParts[partIndex];
    if (!part) return null;

    const latestStart = evidenceWords.length - part.length;
    for (let matchStart = Math.max(0, nextStart); matchStart <= latestStart; matchStart += 1) {
      if (
        previousEnd !== null
        && matchStart - previousEnd > MAX_OMITTED_WORDS_PER_ELLIPSIS
      ) {
        break;
      }
      if (!part.every((word, offset) => evidenceWords[matchStart + offset] === word)) {
        continue;
      }

      const matchEnd = matchStart + part.length;
      if (partIndex === quoteParts.length - 1) {
        return { start: firstStart ?? matchStart, end: matchEnd };
      }

      const remaining = search(
        partIndex + 1,
        matchEnd,
        matchEnd,
        firstStart ?? matchStart,
      );
      if (remaining) return remaining;
    }

    return null;
  };

  return quoteParts.length > 0 ? search(0, 0, null, null) : null;
}

function quoteMatchesEvidence(quoteParts: string[][], evidence: string): boolean {
  const evidenceWords = toWords(evidence);
  if (evidenceWords.length === 0) return false;
  return findOrderedQuoteWordSpan(quoteParts, evidenceWords) !== null;
}

export function extractQuoteTextFromContent(content: string | null | undefined): string | null {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  const pairedQuote = trimmed.match(/[“"]([^”"\n]{3,1200})[”"]/u)?.[1]?.trim();
  if (pairedQuote) return pairedQuote;

  const labelledQuote = trimmed.match(/^(?:pastor\s+)?quote(?:\s+text)?\s*:\s*(.+)$/imu)?.[1]?.trim();
  if (labelledQuote) return labelledQuote;

  const blockQuote = trimmed
    .split(/\r?\n/u)
    .filter((line) => /^\s*>\s*/u.test(line))
    .map((line) => line.replace(/^\s*>\s*/u, "").trim())
    .filter(Boolean)
    .join(" ");
  if (blockQuote) return blockQuote;

  return toWords(trimmed).length <= 80 ? trimmed : null;
}

export function verifyQuoteTextAgainstTranscript(input: {
  quoteText: string | null | undefined;
  sourceTranscriptExcerpt?: string | null;
  transcriptSegments?: TranscriptSegmentEvidence[];
}): QuoteVerificationResult {
  const quoteText = input.quoteText?.trim() ?? "";
  if (!quoteText) {
    return {
      verified: false,
      status: "QUOTE_MISSING",
      normalizedQuote: "",
      omissionCount: 0,
      matchedSource: null,
      message: "Identify the exact pastor quote before approval.",
    };
  }

  const omissionCount = (quoteText.match(/(?:…|\.{3,})/gu) ?? []).length;
  if (omissionCount > MAX_QUOTE_ELLIPSES) {
    return {
      verified: false,
      status: "TOO_MANY_OMISSIONS",
      normalizedQuote: normalizeIntegrityText(quoteText),
      omissionCount,
      matchedSource: null,
      message: "Use no more than two ellipses in a pastor quote.",
    };
  }

  const quoteParts = quoteText
    .split(/(?:…|\.{3,})/gu)
    .map(toWords)
    .filter((part) => part.length > 0);
  const totalWords = quoteParts.reduce((sum, part) => sum + part.length, 0);
  if (totalWords < MIN_QUOTE_WORDS || quoteParts.some((part) => omissionCount > 0 && part.length < 2)) {
    return {
      verified: false,
      status: "QUOTE_TOO_SHORT",
      normalizedQuote: normalizeIntegrityText(quoteText),
      omissionCount,
      matchedSource: null,
      message: "Use at least three transcript words, with two or more words around each ellipsis.",
    };
  }

  const sourceExcerpt = input.sourceTranscriptExcerpt?.trim() ?? "";
  const segments = normalizedTranscriptSegments(input.transcriptSegments);
  if (!sourceExcerpt && segments.length === 0) {
    return {
      verified: false,
      status: "EVIDENCE_MISSING",
      normalizedQuote: normalizeIntegrityText(quoteText),
      omissionCount,
      matchedSource: null,
      message: "Transcript evidence is required before approving a pastor quote.",
    };
  }

  if (sourceExcerpt && quoteMatchesEvidence(quoteParts, sourceExcerpt)) {
    return {
      verified: true,
      status: "VERIFIED",
      normalizedQuote: normalizeIntegrityText(quoteText),
      omissionCount,
      matchedSource: "SOURCE_EXCERPT",
      message: "The quote wording matches its transcript evidence.",
    };
  }

  if (segments.length > 0 && quoteMatchesEvidence(quoteParts, segments.join(" "))) {
    return {
      verified: true,
      status: "VERIFIED",
      normalizedQuote: normalizeIntegrityText(quoteText),
      omissionCount,
      matchedSource: "TRANSCRIPT_SEGMENTS",
      message: "The quote wording matches the transcript segments.",
    };
  }

  return {
    verified: false,
    status: "MISMATCH",
    normalizedQuote: normalizeIntegrityText(quoteText),
    omissionCount,
    matchedSource: null,
    message: "The pastor quote does not match the stored transcript wording. Restore the exact words or use ellipses only for omissions.",
  };
}

export function findQuoteTranscriptSegmentSpan(input: {
  quoteText: string | null | undefined;
  transcriptSegments: TimedTranscriptSegmentEvidence[];
}): QuoteTranscriptSegmentSpan | null {
  const orderedSegments = input.transcriptSegments
    .filter((segment) => (
      Boolean(segment.id.trim())
      && Boolean(segment.text?.trim())
      && Number.isFinite(segment.startTimeSeconds)
      && Number.isFinite(segment.endTimeSeconds)
      && segment.endTimeSeconds >= segment.startTimeSeconds
    ))
    .sort((left, right) => (
      left.startTimeSeconds - right.startTimeSeconds
      || left.endTimeSeconds - right.endTimeSeconds
      || left.id.localeCompare(right.id)
    ));
  const verification = verifyQuoteTextAgainstTranscript({
    quoteText: input.quoteText,
    transcriptSegments: orderedSegments,
  });
  if (!verification.verified || orderedSegments.length === 0) return null;

  const quoteParts = (input.quoteText?.trim() ?? "")
    .split(/(?:…|\.{3,})/gu)
    .map(toWords)
    .filter((part) => part.length > 0);
  const evidenceWords: string[] = [];
  const wordSegmentIndexes: number[] = [];
  orderedSegments.forEach((segment, segmentIndex) => {
    for (const word of toWords(segment.text ?? "")) {
      evidenceWords.push(word);
      wordSegmentIndexes.push(segmentIndex);
    }
  });

  const wordSpan = findOrderedQuoteWordSpan(quoteParts, evidenceWords);
  if (!wordSpan || wordSpan.end <= wordSpan.start) return null;
  const firstSegmentIndex = wordSegmentIndexes[wordSpan.start];
  const lastSegmentIndex = wordSegmentIndexes[wordSpan.end - 1];
  if (firstSegmentIndex === undefined || lastSegmentIndex === undefined) return null;

  const matchedSegments = orderedSegments.slice(firstSegmentIndex, lastSegmentIndex + 1);
  const transcriptIds = new Set(
    matchedSegments
      .map((segment) => segment.transcriptId?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  return {
    segmentIds: matchedSegments.map((segment) => segment.id),
    transcriptId: transcriptIds.size === 1 ? [...transcriptIds][0] ?? null : null,
    startTimeSeconds: matchedSegments[0]!.startTimeSeconds,
    endTimeSeconds: matchedSegments.at(-1)!.endTimeSeconds,
    excerpt: matchedSegments.map((segment) => segment.text?.trim()).filter(Boolean).join(" "),
    verification,
  };
}

function issueSnippet(value: string, index: number, matchedText: string): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(value.length, index + matchedText.length + 30);
  return value.slice(start, end).replace(/\s+/gu, " ").trim();
}

function collectPatternIssues(
  field: ProductionCopyField,
  value: string,
  kind: ProductionCopyIssueKind,
  patterns: RegExp[],
): ProductionCopyIssue[] {
  const issues: ProductionCopyIssue[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      issues.push({
        field,
        kind,
        matchedText: issueSnippet(value, match.index ?? 0, match[0]),
      });
    }
  }
  return issues;
}

export function detectProductionCopyIssues(input: {
  artworkText?: string | null;
  caption?: string | null;
}): ProductionCopyIssue[] {
  const fields: Array<[ProductionCopyField, string]> = [
    ["ARTWORK", input.artworkText?.trim() ?? ""],
    ["CAPTION", input.caption?.trim() ?? ""],
  ];
  const issues = fields.flatMap(([field, value]) => value
    ? [
        ...collectPatternIssues(field, value, "PLACEHOLDER", PLACEHOLDER_PATTERNS),
        ...collectPatternIssues(field, value, "INSTRUCTION", PRODUCTION_INSTRUCTION_PATTERNS),
      ]
    : []);

  return issues.filter((issue, index) => issues.findIndex((candidate) => (
    candidate.field === issue.field
    && candidate.kind === issue.kind
    && candidate.matchedText === issue.matchedText
  )) === index);
}

function extractScriptureVersion(value: string): {
  reference: string;
  version: string | null;
  versionStatus: ScriptureVersionStatus;
} {
  const parenthetical = value.match(/\s*\(([A-Za-z][A-Za-z0-9-]{1,14})\)\s*$/u);
  const bare = value.match(/\s+([A-Z][A-Z0-9-]{1,14})\s*$/u);
  const matched = parenthetical ?? bare;
  if (!matched?.[1]) {
    return { reference: value.trim(), version: null, versionStatus: "MISSING" };
  }

  const version = matched[1].toUpperCase();
  return {
    reference: value.slice(0, matched.index).trim(),
    version,
    versionStatus: RECOGNIZED_SCRIPTURE_VERSIONS.has(version) ? "RECOGNIZED" : "UNRECOGNIZED",
  };
}

function validatePassage(value: string): { normalized: string | null; error: string | null } {
  const normalizedInput = value
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\./gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const lowered = normalizedInput.toLocaleLowerCase("en");
  const bookMatch = BOOK_LOOKUP.find(({ normalizedAlias }) => (
    lowered === normalizedAlias || lowered.startsWith(`${normalizedAlias} `)
  ));
  if (!bookMatch) return { normalized: null, error: `Unknown or abbreviated Bible book in “${value}”.` };

  const coordinateText = normalizedInput.slice(bookMatch.alias.length).trim();
  const coordinate = coordinateText.match(/^([1-9]\d{0,2})(?::(.+))?$/u);
  if (!coordinate) return { normalized: null, error: `Use Book chapter:verse syntax for “${value}”.` };

  let chapter = Number(coordinate[1]);
  let verseText = coordinate[2]?.trim() ?? null;
  if (bookMatch.book.maxChapter === 1 && !verseText && chapter > 1) {
    verseText = String(chapter);
    chapter = 1;
  }
  if (chapter > bookMatch.book.maxChapter) {
    return { normalized: null, error: `${bookMatch.book.canonical} does not have chapter ${chapter}.` };
  }

  if (verseText) {
    const ranges = verseText.split(",").map((range) => range.trim());
    if (ranges.some((range) => !/^([1-9]\d{0,2})(?:\s*-\s*([1-9]\d{0,2}))?$/u.test(range))) {
      return { normalized: null, error: `Use verse numbers or verse ranges for “${value}”.` };
    }
    for (const range of ranges) {
      const match = range.match(/^([1-9]\d{0,2})(?:\s*-\s*([1-9]\d{0,2}))?$/u);
      const first = Number(match?.[1]);
      const last = Number(match?.[2] ?? match?.[1]);
      if (first > 176 || last > 176 || last < first) {
        return { normalized: null, error: `Check the verse range in “${value}”.` };
      }
    }
  }

  const normalizedVerses = verseText?.replace(/\s+/gu, "") ?? null;
  return {
    normalized: `${bookMatch.book.canonical} ${chapter}${normalizedVerses ? `:${normalizedVerses}` : ""}`,
    error: null,
  };
}

export function validateScriptureReference(value: string | null | undefined): ScriptureReferenceValidation {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedReference: null,
      version: null,
      versionStatus: "MISSING",
      errors: ["A Scripture graphic needs a Bible reference."],
    };
  }

  const version = extractScriptureVersion(trimmed);
  const passages = version.reference.split(";").map((passage) => passage.trim()).filter(Boolean);
  if (passages.length === 0) {
    return {
      valid: false,
      normalizedReference: null,
      version: version.version,
      versionStatus: version.versionStatus,
      errors: ["A Scripture graphic needs a Bible reference."],
    };
  }

  const validated = passages.map(validatePassage);
  const errors = validated.flatMap((result) => result.error ? [result.error] : []);
  return {
    valid: errors.length === 0,
    normalizedReference: errors.length === 0
      ? validated.map((result) => result.normalized).join("; ")
      : null,
    version: version.version,
    versionStatus: version.versionStatus,
    errors,
  };
}

export function deriveTranslationReviewState(input: TranslationReviewInput): TranslationReviewState {
  const reasons: TranslationReviewReason[] = [];
  const humanTranslationApproved = input.humanTranslationApproved === true;
  const hasTranslation = Boolean(
    input.translatedFromLanguage?.trim()
    || (input.originalLanguageText?.trim() && input.translatedText?.trim()),
  );

  if (input.translationNeedsReview === true) reasons.push("EXPLICIT_REVIEW_REQUIRED");
  if (hasTranslation && !humanTranslationApproved) reasons.push("HUMAN_TRANSLATION_APPROVAL_REQUIRED");
  if (
    !humanTranslationApproved
    && typeof input.translationConfidence === "number"
    && (input.translationConfidence < 0 || input.translationConfidence > 1 || input.translationConfidence < 0.9)
  ) {
    reasons.push("LOW_TRANSLATION_CONFIDENCE");
  }
  if (!humanTranslationApproved && input.translationUncertaintyNote?.trim()) {
    reasons.push("TRANSLATION_UNCERTAINTY_RECORDED");
  }

  if (input.scriptureVersionRequired) {
    const version = input.scriptureVersion?.trim().toUpperCase() ?? "";
    if (!version) {
      reasons.push("SCRIPTURE_VERSION_MISSING");
    } else if (!RECOGNIZED_SCRIPTURE_VERSIONS.has(version)) {
      reasons.push("SCRIPTURE_VERSION_UNRECOGNIZED");
    } else if (input.scriptureVersionApproved !== true) {
      reasons.push("SCRIPTURE_VERSION_APPROVAL_REQUIRED");
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));
  if (uniqueReasons.length === 0) {
    return {
      status: "CLEAR",
      blocking: false,
      reasons: [],
      message: "No unresolved translation or Scripture-version review is recorded.",
    };
  }

  return {
    status: "BLOCKED",
    blocking: true,
    reasons: uniqueReasons,
    message: uniqueReasons.some((reason) => reason.startsWith("SCRIPTURE_VERSION"))
      ? "Confirm an approved Scripture translation/version before publishing."
      : "Review and approve the translated wording before publishing.",
  };
}
