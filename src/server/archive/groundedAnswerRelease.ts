import { createHash } from "node:crypto";

export type ArchiveTenantScope = {
  organizationId: string;
  campusId: string | null;
};

export type ArchiveSourceKind =
  | "TRANSCRIPT_SPAN"
  | "APPROVED_CLIP"
  | "REVIEWED_SERMON_SUMMARY"
  | "SCRIPTURE_REFERENCE";

export type ArchiveCitationEvidence = ArchiveTenantScope & {
  citationId: string;
  sermonId: string;
  sermonTitle: string;
  sourceKind: ArchiveSourceKind;
  excerpt: string;
  contentIdentity: string;
  reviewStatus: "UNREVIEWED" | "REVIEWED" | "PASTOR_APPROVED";
  privacy: "MINISTRY_PUBLIC" | "CHURCH_INTERNAL" | "PASTORAL_SENSITIVE";
  startTimeSeconds?: number | null;
  endTimeSeconds?: number | null;
  scriptureReference?: string | null;
};

export type ArchiveAnswerBlockKind =
  | "DIRECT_QUOTE"
  | "FACT"
  | "SCRIPTURE"
  | "PASTORAL_SUMMARY"
  | "DOCTRINAL_SYNTHESIS";

export type GroundedArchiveAnswerDraft = ArchiveTenantScope & {
  answerId: string;
  question: string;
  blocks: Array<{
    blockId: string;
    kind: ArchiveAnswerBlockKind;
    text: string;
    citationIds: string[];
  }>;
  theologicalReview: "NOT_REQUIRED" | "PENDING" | "PASTOR_APPROVED";
};

export type ArchiveAnswerBlockReason =
  | "EMPTY_ANSWER"
  | "DUPLICATE_BLOCK_ID"
  | "MISSING_CITATION"
  | "UNKNOWN_OR_AMBIGUOUS_CITATION"
  | "TENANT_SCOPE_MISMATCH"
  | "INVALID_CITATION_IDENTITY"
  | "EMPTY_EVIDENCE"
  | "UNREVIEWED_SOURCE"
  | "SENSITIVE_SOURCE"
  | "PUBLIC_EXPORT_REQUIRES_PUBLIC_SOURCE"
  | "INVALID_TRANSCRIPT_SPAN"
  | "SCRIPTURE_SOURCE_REQUIRED"
  | "QUOTE_NOT_IN_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE_OVERLAP"
  | "THEOLOGICAL_REVIEW_REQUIRED";

export type ArchiveAnswerRelease =
  | {
      status: "RELEASED";
      answerId: string;
      question: string;
      answer: string;
      citations: Array<{
        citationId: string;
        sermonId: string;
        sermonTitle: string;
        sourceKind: ArchiveSourceKind;
        startTimeSeconds: number | null;
        endTimeSeconds: number | null;
        scriptureReference: string | null;
      }>;
      quality: {
        everyBlockCited: true;
        tenantEvidenceOnly: true;
        sensitiveEvidenceExcluded: true;
        theologicalReview:
          GroundedArchiveAnswerDraft["theologicalReview"];
      };
    }
  | {
      status: "BLOCKED";
      answerId: string;
      safeAnswer: string;
      reasons: ArchiveAnswerBlockReason[];
    };

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_BLOCKED_ANSWER =
  "I could not verify this answer from accessible, reviewed sermon evidence.";
const VALID_SOURCE_KINDS = new Set<ArchiveSourceKind>([
  "TRANSCRIPT_SPAN",
  "APPROVED_CLIP",
  "REVIEWED_SERMON_SUMMARY",
  "SCRIPTURE_REFERENCE",
]);
const VALID_REVIEW_STATUSES = new Set<ArchiveCitationEvidence["reviewStatus"]>([
  "UNREVIEWED",
  "REVIEWED",
  "PASTOR_APPROVED",
]);
const VALID_PRIVACY_LEVELS = new Set<ArchiveCitationEvidence["privacy"]>([
  "MINISTRY_PUBLIC",
  "CHURCH_INTERNAL",
  "PASTORAL_SENSITIVE",
]);
const EVIDENCE_WORD_STOPLIST = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "not",
  "our",
  "that",
  "the",
  "their",
  "they",
  "this",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

function canonicalCitation(citation: ArchiveCitationEvidence) {
  return {
    identityVersion: 1,
    organizationId: citation.organizationId.trim(),
    campusId: citation.campusId?.trim() || null,
    citationId: citation.citationId.trim(),
    sermonId: citation.sermonId.trim(),
    sermonTitle: citation.sermonTitle.normalize("NFKC").trim(),
    sourceKind: citation.sourceKind,
    excerpt: citation.excerpt
      .normalize("NFKC")
      .replace(/\r\n?/gu, "\n")
      .trim(),
    startTimeSeconds: citation.startTimeSeconds ?? null,
    endTimeSeconds: citation.endTimeSeconds ?? null,
    scriptureReference: citation.scriptureReference?.trim() || null,
    reviewStatus: citation.reviewStatus,
    privacy: citation.privacy,
  };
}

function normalizeWords(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(/\s+/gu)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !EVIDENCE_WORD_STOPLIST.has(word));
}

function tenantContains(
  requestScope: ArchiveTenantScope,
  evidenceScope: ArchiveTenantScope,
): boolean {
  return requestScope.organizationId === evidenceScope.organizationId
    && (
      requestScope.campusId === null
      || evidenceScope.campusId === null
      || requestScope.campusId === evidenceScope.campusId
    );
}

function requestCanOperateDraft(
  requestScope: ArchiveTenantScope,
  draftScope: ArchiveTenantScope,
): boolean {
  return requestScope.organizationId === draftScope.organizationId
    && (
      requestScope.campusId === null
      || requestScope.campusId === draftScope.campusId
    );
}

function hasEvidenceOverlap(
  blockText: string,
  citations: readonly ArchiveCitationEvidence[],
): boolean {
  const blockWords = new Set(normalizeWords(blockText));
  if (blockWords.size === 0) return false;
  const evidenceWords = new Set(
    citations.flatMap((citation) => normalizeWords(citation.excerpt)),
  );
  const overlap = [...blockWords].filter((word) => evidenceWords.has(word)).length;
  return overlap >= 2 && overlap / blockWords.size >= 0.18;
}

function normalizedQuoteIsInEvidence(
  blockText: string,
  citations: readonly ArchiveCitationEvidence[],
): boolean {
  const quote = normalizeWords(blockText).join(" ");
  return quote.length > 0 && citations.some((citation) => (
    normalizeWords(citation.excerpt).join(" ").includes(quote)
  ));
}

export function createArchiveCitationIdentity(
  citation: ArchiveCitationEvidence,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalCitation(citation)))
    .digest("hex");
}

export function releaseGroundedArchiveAnswer(input: {
  requestScope: ArchiveTenantScope;
  audience: "CHURCH_TEAM" | "PUBLIC_EXPORT";
  draft: GroundedArchiveAnswerDraft;
  evidence: readonly ArchiveCitationEvidence[];
}): ArchiveAnswerRelease {
  const reasons = new Set<ArchiveAnswerBlockReason>();
  if (input.draft.blocks.length === 0) {
    reasons.add("EMPTY_ANSWER");
  }
  if (
    !input.draft.answerId.trim()
    || !input.draft.question.trim()
    || !input.draft.organizationId.trim()
  ) {
    reasons.add("EMPTY_ANSWER");
  }
  if (!requestCanOperateDraft(input.requestScope, input.draft)) {
    reasons.add("TENANT_SCOPE_MISMATCH");
  }

  const evidenceById = new Map<string, ArchiveCitationEvidence>();
  const ambiguousCitationIds = new Set<string>();
  for (const citation of input.evidence) {
    if (evidenceById.has(citation.citationId)) {
      ambiguousCitationIds.add(citation.citationId);
    } else {
      evidenceById.set(citation.citationId, citation);
    }
  }
  const seenBlockIds = new Set<string>();
  const usedEvidence = new Map<string, ArchiveCitationEvidence>();

  for (const block of input.draft.blocks) {
    if (seenBlockIds.has(block.blockId)) {
      reasons.add("DUPLICATE_BLOCK_ID");
    }
    seenBlockIds.add(block.blockId);
    if (!block.text.trim() || block.citationIds.length === 0) {
      reasons.add("MISSING_CITATION");
      continue;
    }

    const blockEvidence: ArchiveCitationEvidence[] = [];
    for (const citationId of new Set(block.citationIds)) {
      const citation = evidenceById.get(citationId);
      if (!citation || ambiguousCitationIds.has(citationId)) {
        reasons.add("UNKNOWN_OR_AMBIGUOUS_CITATION");
        continue;
      }
      blockEvidence.push(citation);
      usedEvidence.set(citationId, citation);

      if (
        !tenantContains(input.requestScope, citation)
        || !tenantContains(input.draft, citation)
      ) {
        reasons.add("TENANT_SCOPE_MISMATCH");
      }
      if (
        !SHA256_PATTERN.test(citation.contentIdentity)
        || citation.contentIdentity !== createArchiveCitationIdentity(citation)
        || !VALID_SOURCE_KINDS.has(citation.sourceKind)
        || !VALID_REVIEW_STATUSES.has(citation.reviewStatus)
        || !VALID_PRIVACY_LEVELS.has(citation.privacy)
      ) {
        reasons.add("INVALID_CITATION_IDENTITY");
      }
      if (
        !citation.citationId.trim()
        || !citation.sermonId.trim()
        || !citation.organizationId.trim()
        || !citation.excerpt.trim()
      ) {
        reasons.add("EMPTY_EVIDENCE");
      }
      if (citation.reviewStatus === "UNREVIEWED") {
        reasons.add("UNREVIEWED_SOURCE");
      }
      if (citation.privacy === "PASTORAL_SENSITIVE") {
        reasons.add("SENSITIVE_SOURCE");
      }
      if (
        input.audience === "PUBLIC_EXPORT"
        && citation.privacy !== "MINISTRY_PUBLIC"
      ) {
        reasons.add("PUBLIC_EXPORT_REQUIRES_PUBLIC_SOURCE");
      }
      if (
        citation.sourceKind === "TRANSCRIPT_SPAN"
        && (
          !Number.isFinite(citation.startTimeSeconds)
          || !Number.isFinite(citation.endTimeSeconds)
          || (citation.startTimeSeconds ?? -1) < 0
          || (citation.endTimeSeconds ?? 0)
            <= (citation.startTimeSeconds ?? 0)
        )
      ) {
        reasons.add("INVALID_TRANSCRIPT_SPAN");
      }
    }

    if (
      block.kind === "SCRIPTURE"
      && !blockEvidence.some((citation) => (
        citation.sourceKind === "SCRIPTURE_REFERENCE"
        && Boolean(citation.scriptureReference?.trim())
      ))
    ) {
      reasons.add("SCRIPTURE_SOURCE_REQUIRED");
    }
    if (
      block.kind === "DIRECT_QUOTE"
      && !normalizedQuoteIsInEvidence(block.text, blockEvidence)
    ) {
      reasons.add("QUOTE_NOT_IN_EVIDENCE");
    }
    if (
      block.kind !== "DIRECT_QUOTE"
      && !hasEvidenceOverlap(block.text, blockEvidence)
    ) {
      reasons.add("INSUFFICIENT_EVIDENCE_OVERLAP");
    }
    if (
      block.kind === "DOCTRINAL_SYNTHESIS"
      && (
        input.draft.theologicalReview !== "PASTOR_APPROVED"
        || blockEvidence.some((citation) => (
          citation.reviewStatus !== "PASTOR_APPROVED"
        ))
      )
    ) {
      reasons.add("THEOLOGICAL_REVIEW_REQUIRED");
    }
  }

  if (reasons.size > 0) {
    return {
      status: "BLOCKED",
      answerId: input.draft.answerId,
      safeAnswer: SAFE_BLOCKED_ANSWER,
      reasons: [...reasons].sort(),
    };
  }

  return {
    status: "RELEASED",
    answerId: input.draft.answerId,
    question: input.draft.question.trim(),
    answer: input.draft.blocks.map((block) => block.text.trim()).join("\n\n"),
    citations: [...usedEvidence.values()]
      .sort((left, right) => left.citationId.localeCompare(right.citationId))
      .map((citation) => ({
        citationId: citation.citationId,
        sermonId: citation.sermonId,
        sermonTitle: citation.sermonTitle,
        sourceKind: citation.sourceKind,
        startTimeSeconds: citation.startTimeSeconds ?? null,
        endTimeSeconds: citation.endTimeSeconds ?? null,
        scriptureReference: citation.scriptureReference ?? null,
      })),
    quality: {
      everyBlockCited: true,
      tenantEvidenceOnly: true,
      sensitiveEvidenceExcluded: true,
      theologicalReview: input.draft.theologicalReview,
    },
  };
}
