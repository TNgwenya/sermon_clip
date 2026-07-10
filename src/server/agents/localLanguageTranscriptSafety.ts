import type { ClipCandidate, ClipTranscriptSafetyStatus } from "@prisma/client";
import type { MultilingualTranscriptAnalysis } from "@/server/agents/multilingualTranscriptAnalysis";

export const TRANSCRIPT_SAFETY_REVIEW_BLOCKER =
  "Review the transcript wording before captions, export, or posting.";

export const TRANSCRIPT_SAFETY_REVIEW_MESSAGE =
  "Listen to the clip and confirm the transcript wording before captions or export. It may contain local-language, code-switched, or lower-confidence wording that needs a human check.";

export type TranscriptQualityMode = "READY" | "LOW_RESCUE" | "MANUAL_RESCUE" | "UNUSABLE";

export type ClipTranscriptSafetyReason =
  | "LOCAL_LANGUAGE_TRANSCRIPT_UNCERTAIN"
  | "LOW_TRANSCRIPT_RESCUE"
  | "MANUAL_TRANSCRIPT_RESCUE"
  | "LOW_TRANSCRIPT_TIMED_FALLBACK"
  | "TRANSCRIPT_REVIEW_ONLY"
  | "LOCAL_LANGUAGE_DETECTED"
  | "CODE_SWITCHING_DETECTED"
  | "LOW_CONFIDENCE_TRANSCRIPT_REGION"
  | "MISSING_TRANSCRIPT_CONFIDENCE"
  | "UNKNOWN_TRANSCRIPT_LANGUAGE";

export type ClipTranscriptSafetyDecision = {
  status: ClipTranscriptSafetyStatus;
  reasons: ClipTranscriptSafetyReason[];
  blocker: string | null;
};

type SafetyCandidateInput = {
  contextWarning?: boolean | null;
  reasonSelected?: string | null;
  socialValue?: string | null;
  whatContextMightBeMissing?: string | null;
  canonicalizationWarnings?: string[] | null;
};

type PublishingSafetyInput = Pick<ClipCandidate, "transcriptSafetyStatus">;

const LOCAL_LANGUAGE_ALIASES = [
  "zu",
  "zul",
  "zulu",
  "isizulu",
  "xh",
  "xho",
  "xhosa",
  "isixhosa",
  "st",
  "sot",
  "sotho",
  "sesotho",
  "southern sotho",
  "tn",
  "tsn",
  "tswana",
  "setswana",
  "nso",
  "sepedi",
  "northern sotho",
  "multilingual local",
  "south african local",
];

function normalizeLanguage(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/(),;|+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function usesLocalSouthernAfricanLanguage(language: string | null | undefined): boolean {
  const normalized = normalizeLanguage(language ?? "");
  if (!normalized) {
    return false;
  }

  const tokens = new Set(normalized.split(" "));
  return LOCAL_LANGUAGE_ALIASES.some((alias) => (
    alias.length <= 3 ? tokens.has(alias) : normalized.includes(alias)
  ));
}

function includesLowTranscriptFallback(candidate: SafetyCandidateInput): boolean {
  const warnings = candidate.canonicalizationWarnings ?? [];
  return warnings.includes("LOW_TRANSCRIPT_TIMED_FALLBACK");
}

function mentionsTranscriptReview(candidate: SafetyCandidateInput): boolean {
  const text = [
    candidate.reasonSelected,
    candidate.socialValue,
    candidate.whatContextMightBeMissing,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return text.includes("transcript") && (text.includes("review") || text.includes("low-confidence") || text.includes("rescue"));
}

export function decideClipTranscriptSafety(input: {
  sermonLanguage?: string | null;
  transcriptQualityMode?: TranscriptQualityMode | null;
  candidate?: SafetyCandidateInput | null;
  transcriptEvidence?: Pick<
    MultilingualTranscriptAnalysis,
    "requiresHumanReview" | "reviewReasons" | "languageProfile" | "confidenceBand" | "codeSwitching"
  > | null;
}): ClipTranscriptSafetyDecision {
  const reasons = new Set<ClipTranscriptSafetyReason>();
  const candidate = input.candidate ?? null;
  const localLanguage = usesLocalSouthernAfricanLanguage(input.sermonLanguage);
  const qualityMode = input.transcriptQualityMode ?? "READY";
  const lowTranscriptFallback = candidate ? includesLowTranscriptFallback(candidate) : false;
  const transcriptReviewOnly = candidate ? mentionsTranscriptReview(candidate) : false;
  const transcriptEvidence = input.transcriptEvidence ?? null;

  if (localLanguage && (qualityMode !== "READY" || !transcriptEvidence)) {
    reasons.add("LOCAL_LANGUAGE_TRANSCRIPT_UNCERTAIN");
  }
  if (qualityMode === "LOW_RESCUE") {
    reasons.add("LOW_TRANSCRIPT_RESCUE");
  }
  if (qualityMode === "MANUAL_RESCUE") {
    reasons.add("MANUAL_TRANSCRIPT_RESCUE");
  }
  if (lowTranscriptFallback) {
    reasons.add("LOW_TRANSCRIPT_TIMED_FALLBACK");
  }
  if (transcriptReviewOnly || (candidate?.contextWarning && qualityMode !== "READY")) {
    reasons.add("TRANSCRIPT_REVIEW_ONLY");
  }

  if (transcriptEvidence?.requiresHumanReview) {
    for (const reason of transcriptEvidence.reviewReasons) {
      if (reason.code === "LOCAL_LANGUAGE_DETECTED") reasons.add("LOCAL_LANGUAGE_DETECTED");
      if (reason.code === "CODE_SWITCHING_DETECTED") reasons.add("CODE_SWITCHING_DETECTED");
      if (reason.code === "LOW_CONFIDENCE_TRANSCRIPT") reasons.add("LOW_CONFIDENCE_TRANSCRIPT_REGION");
      if (reason.code === "MISSING_CONFIDENCE" || reason.code === "PARTIAL_CONFIDENCE_COVERAGE") {
        reasons.add("MISSING_TRANSCRIPT_CONFIDENCE");
      }
      if (reason.code === "UNKNOWN_LANGUAGE") reasons.add("UNKNOWN_TRANSCRIPT_LANGUAGE");
    }
  }

  const reasonList = Array.from(reasons);
  return {
    status: reasonList.length > 0 ? "REVIEW_REQUIRED" : "TRUSTED",
    reasons: reasonList,
    blocker: reasonList.length > 0 ? TRANSCRIPT_SAFETY_REVIEW_BLOCKER : null,
  };
}

export function isTranscriptReviewRequired(clip: PublishingSafetyInput): boolean {
  return clip.transcriptSafetyStatus === "REVIEW_REQUIRED";
}

export function validateTranscriptSafetyForPublishing(
  clip: PublishingSafetyInput,
): { ok: true } | { ok: false; reason: string } {
  if (isTranscriptReviewRequired(clip)) {
    return { ok: false, reason: TRANSCRIPT_SAFETY_REVIEW_MESSAGE };
  }

  return { ok: true };
}

export function mergeTranscriptSafetyBlocker(existing: unknown): string[] {
  const blockers = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return Array.from(new Set([...blockers, TRANSCRIPT_SAFETY_REVIEW_BLOCKER]));
}

export function removeTranscriptSafetyBlocker(existing: unknown): string[] {
  if (!Array.isArray(existing)) {
    return [];
  }

  return existing.filter((item): item is string => (
    typeof item === "string" &&
    item.trim().length > 0 &&
    item !== TRANSCRIPT_SAFETY_REVIEW_BLOCKER
  ));
}
