import { createHash } from "node:crypto";

export const TRANSCRIPT_QUALITY_POLICY_VERSION = "transcript-quality-escalation-v1";

export type TranscriptEscalationReasonCode =
  | "NO_USABLE_TRANSCRIPT"
  | "BASE_QUALITY_GATE_FAILED"
  | "LOW_EXPECTED_COVERAGE"
  | "LARGE_TIMELINE_GAPS"
  | "LOW_PROVIDER_CONFIDENCE"
  | "MISSING_PROVIDER_CONFIDENCE"
  | "TIMING_OR_REPETITION_WARNING"
  | "LOCAL_OR_MIXED_LANGUAGE"
  | "LANGUAGE_UNCERTAIN"
  | "UNCERTAIN_NAME_OR_SCRIPTURE"
  | "CONTEXT_BOUNDARY_UNCERTAIN";

export type TranscriptEscalationReason = {
  code: TranscriptEscalationReasonCode;
  explanation: string;
};

export type TranscriptEscalationSignals = {
  qualityReady: boolean;
  usableSegmentCount: number;
  wordCount: number;
  coverageRatio: number;
  expectedDurationCoverageRatio?: number | null;
  maxGapSeconds: number;
  largeGapCount: number;
  languageProfile?: "ENGLISH" | "NGUNI_LOCAL" | "SOTHO_TSWANA" | "MIXED" | "UNKNOWN" | null;
  confidenceBand?: "HIGH" | "REVIEW" | "LOW" | "UNKNOWN" | null;
  knownConfidenceCoverageRatio?: number | null;
  lowConfidenceCoverageRatio?: number | null;
  uncertainNameCount?: number;
  uncertainScriptureCount?: number;
  contextBoundaryRisk?: boolean;
  warningCodes?: string[];
  enhancementAttemptsUsed?: number;
  enhancementAvailable?: boolean;
};

export type TranscriptEscalationDecision = {
  policyVersion: typeof TRANSCRIPT_QUALITY_POLICY_VERSION;
  disposition: "ACCEPT" | "RETRY_ONCE" | "MANUAL_REVIEW_ONLY" | "BLOCKED";
  automationMode: "FULL" | "MANUAL_REVIEW_ONLY" | "NONE";
  retry: "NONE" | "SPEECH_ENHANCED_AUDIO_ONCE";
  retryBudgetRemaining: 0 | 1;
  allowBasicRecovery: boolean;
  canonicalTranscriptMayBeRewritten: false;
  reasons: TranscriptEscalationReason[];
  evaluationTags: string[];
};

function finiteRatio(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Makes escalation explainable and deterministic. It does not edit transcript
 * text or timestamps; retries create a separate candidate transcript and the
 * existing selection/persistence path remains the only canonical write path.
 */
export function decideTranscriptQualityEscalation(
  input: TranscriptEscalationSignals,
): TranscriptEscalationDecision {
  const reasons: TranscriptEscalationReason[] = [];
  const tags = new Set<string>();
  const expectedCoverage = finiteRatio(input.expectedDurationCoverageRatio);
  const knownConfidenceCoverage = finiteRatio(input.knownConfidenceCoverageRatio);
  const lowConfidenceCoverage = finiteRatio(input.lowConfidenceCoverageRatio);
  const attemptsUsed = Math.floor(nonNegative(input.enhancementAttemptsUsed));
  const usableTranscript = input.usableSegmentCount > 0 && input.wordCount >= 20;

  const add = (code: TranscriptEscalationReasonCode, explanation: string, tag: string) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, explanation });
    tags.add(tag);
  };

  if (!usableTranscript) {
    add("NO_USABLE_TRANSCRIPT", "Too little timestamped speech exists for a faithful pastor review.", "transcript_unusable");
  }
  if (!input.qualityReady) {
    add("BASE_QUALITY_GATE_FAILED", "The canonical transcript did not pass the existing clipping-readiness gate.", "base_quality_failed");
  }
  if (expectedCoverage !== null && expectedCoverage < 0.62) {
    add("LOW_EXPECTED_COVERAGE", `The transcript covers about ${Math.round(expectedCoverage * 100)}% of the expected sermon window.`, "coverage_risk");
  }
  if (input.largeGapCount > 1 || input.maxGapSeconds >= 90) {
    add("LARGE_TIMELINE_GAPS", "Large unexplained gaps could remove the context needed for faithful clips.", "timeline_gap_risk");
  }
  const repairableWarnings = new Set([
    "LOW_TRANSCRIPT_COVERAGE",
    "LARGE_TRANSCRIPT_GAPS",
    "REPEATED_TRANSCRIPT_SEGMENTS",
    "REPEATED_TRANSCRIPT_PHRASES",
    "COARSE_TRANSCRIPT_TIMING",
    "LOW_TIMESTAMP_DENSITY",
    "LOW_WORD_DENSITY",
  ]);
  if (input.warningCodes?.some((warning) => repairableWarnings.has(warning))) {
    add("TIMING_OR_REPETITION_WARNING", "Transcript timing, density, or repetition evidence may improve after one audio-enhanced attempt.", "transcript_warning");
  }
  if (input.confidenceBand === "LOW" || (lowConfidenceCoverage !== null && lowConfidenceCoverage >= 0.18)) {
    add("LOW_PROVIDER_CONFIDENCE", "A material part of the wording has low provider confidence.", "confidence_low");
  } else if (
    input.confidenceBand === "UNKNOWN"
    || (knownConfidenceCoverage !== null && knownConfidenceCoverage < 0.7)
  ) {
    add("MISSING_PROVIDER_CONFIDENCE", "Provider confidence is missing for enough of the sermon that exact wording needs review.", "confidence_unknown");
  }
  if (input.languageProfile === "NGUNI_LOCAL" || input.languageProfile === "SOTHO_TSWANA" || input.languageProfile === "MIXED") {
    add("LOCAL_OR_MIXED_LANGUAGE", "Local-language or code-switched wording requires a fluent human check before publishing.", "multilingual_review");
  } else if (input.languageProfile === "UNKNOWN") {
    add("LANGUAGE_UNCERTAIN", "The transcript language could not be established confidently.", "language_unknown");
  }
  const uncertainSensitiveCount = nonNegative(input.uncertainNameCount) + nonNegative(input.uncertainScriptureCount);
  if (uncertainSensitiveCount > 0) {
    add("UNCERTAIN_NAME_OR_SCRIPTURE", "At least one name or Scripture reference overlaps uncertain wording and must be checked against the recording.", "sensitive_term_review");
  }
  if (input.contextBoundaryRisk) {
    add("CONTEXT_BOUNDARY_UNCERTAIN", "The available words may begin or end without enough surrounding context.", "context_boundary_review");
  }

  if (!usableTranscript) {
    return {
      policyVersion: TRANSCRIPT_QUALITY_POLICY_VERSION,
      disposition: "BLOCKED",
      automationMode: "NONE",
      retry: "NONE",
      retryBudgetRemaining: 0,
      allowBasicRecovery: false,
      canonicalTranscriptMayBeRewritten: false,
      reasons,
      evaluationTags: [...tags].sort(),
    };
  }

  const retryCouldImproveAudioEvidence = reasons.some((reason) => (
    reason.code === "BASE_QUALITY_GATE_FAILED"
    || reason.code === "LOW_EXPECTED_COVERAGE"
    || reason.code === "LARGE_TIMELINE_GAPS"
    || reason.code === "LOW_PROVIDER_CONFIDENCE"
    || reason.code === "TIMING_OR_REPETITION_WARNING"
  ));
  if (retryCouldImproveAudioEvidence && attemptsUsed < 1 && input.enhancementAvailable !== false) {
    return {
      policyVersion: TRANSCRIPT_QUALITY_POLICY_VERSION,
      disposition: "RETRY_ONCE",
      automationMode: "NONE",
      retry: "SPEECH_ENHANCED_AUDIO_ONCE",
      retryBudgetRemaining: 1,
      allowBasicRecovery: false,
      canonicalTranscriptMayBeRewritten: false,
      reasons,
      evaluationTags: [...tags].sort(),
    };
  }

  if (reasons.length > 0) {
    return {
      policyVersion: TRANSCRIPT_QUALITY_POLICY_VERSION,
      disposition: "MANUAL_REVIEW_ONLY",
      automationMode: "MANUAL_REVIEW_ONLY",
      retry: "NONE",
      retryBudgetRemaining: 0,
      allowBasicRecovery: true,
      canonicalTranscriptMayBeRewritten: false,
      reasons,
      evaluationTags: [...tags].sort(),
    };
  }

  return {
    policyVersion: TRANSCRIPT_QUALITY_POLICY_VERSION,
    disposition: "ACCEPT",
    automationMode: "FULL",
    retry: "NONE",
    retryBudgetRemaining: 0,
    allowBasicRecovery: false,
    canonicalTranscriptMayBeRewritten: false,
    reasons: [],
    evaluationTags: ["automatic_quality_pass"],
  };
}

export type UncertainTranscriptRegionInput = {
  text: string;
};

function normalizedTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Counts known names plus reference-shaped Scripture wording only inside uncertain regions. */
export function detectUncertainSensitiveTerms(input: {
  uncertainRegions: UncertainTranscriptRegionInput[];
  knownNames?: string[];
}): { uncertainNameCount: number; uncertainScriptureCount: number } {
  const regions = input.uncertainRegions.map((region) => normalizedTerm(region.text)).filter(Boolean);
  const names = [...new Set((input.knownNames ?? []).map(normalizedTerm).filter((name) => name.length >= 3))];
  const uncertainNameCount = names.filter((name) => regions.some((region) => region.includes(name))).length;
  const scripturePattern = /\b(?:genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)\s+\d{1,3}(?:\s*(?::|verse)\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?/gi;
  const uncertainScriptureCount = regions.reduce((count, region) => count + (region.match(scripturePattern)?.length ?? 0), 0);
  return { uncertainNameCount, uncertainScriptureCount };
}

export function fingerprintCanonicalTimestampTranscript(segments: Array<{
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  confidence?: number | null;
}>): string {
  const canonical = segments.map((segment) => {
    if (
      !Number.isFinite(segment.startTimeSeconds)
      || !Number.isFinite(segment.endTimeSeconds)
      || segment.endTimeSeconds <= segment.startTimeSeconds
      || !segment.text.trim()
    ) {
      throw new Error("Canonical transcript fingerprint requires valid, non-empty timestamp segments.");
    }
    return {
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds,
      text: segment.text,
      confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    };
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
