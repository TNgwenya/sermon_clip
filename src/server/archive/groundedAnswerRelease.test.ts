import { describe, expect, it } from "vitest";

import {
  createArchiveCitationIdentity,
  releaseGroundedArchiveAnswer,
  type ArchiveCitationEvidence,
  type GroundedArchiveAnswerDraft,
} from "./groundedAnswerRelease";

const scope = {
  organizationId: "org-grace",
  campusId: "campus-central",
};

function citation(
  overrides: Partial<ArchiveCitationEvidence> = {},
): ArchiveCitationEvidence {
  const value: ArchiveCitationEvidence = {
    ...scope,
    citationId: "transcript-sermon-1-120-135",
    sermonId: "sermon-1",
    sermonTitle: "Peace in the storm",
    sourceKind: "TRANSCRIPT_SPAN",
    excerpt: "The presence of God does not always remove the storm, but God remains with us in it.",
    contentIdentity: "",
    reviewStatus: "PASTOR_APPROVED",
    privacy: "MINISTRY_PUBLIC",
    startTimeSeconds: 120,
    endTimeSeconds: 135,
    scriptureReference: null,
    ...overrides,
  };
  value.contentIdentity = overrides.contentIdentity
    ?? createArchiveCitationIdentity(value);
  return value;
}

function draft(
  overrides: Partial<GroundedArchiveAnswerDraft> = {},
): GroundedArchiveAnswerDraft {
  return {
    ...scope,
    answerId: "answer-1",
    question: "What did the pastor teach about storms?",
    blocks: [{
      blockId: "block-1",
      kind: "PASTORAL_SUMMARY",
      text: "The pastor taught that God remains with us in the storm.",
      citationIds: ["transcript-sermon-1-120-135"],
    }],
    theologicalReview: "NOT_REQUIRED",
    ...overrides,
  };
}

describe("citation-grounded archive answer release", () => {
  it("releases an answer assembled only from evidence-cited blocks", () => {
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft(),
      evidence: [citation()],
    });

    expect(result).toMatchObject({
      status: "RELEASED",
      answer: "The pastor taught that God remains with us in the storm.",
      citations: [{
        citationId: "transcript-sermon-1-120-135",
        sermonId: "sermon-1",
        startTimeSeconds: 120,
        endTimeSeconds: 135,
      }],
      quality: {
        everyBlockCited: true,
        tenantEvidenceOnly: true,
        sensitiveEvidenceExcluded: true,
      },
    });
    expect(result).not.toHaveProperty("citations.0.excerpt");
  });

  it("blocks another church's citation without returning draft text or evidence", () => {
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft(),
      evidence: [citation({ organizationId: "org-other" })],
    });

    expect(result).toEqual({
      status: "BLOCKED",
      answerId: "answer-1",
      safeAnswer: "I could not verify this answer from accessible, reviewed sermon evidence.",
      reasons: ["TENANT_SCOPE_MISMATCH"],
    });
  });

  it("blocks uncited and unknown-citation answer blocks", () => {
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        blocks: [
          {
            blockId: "uncited",
            kind: "FACT",
            text: "An unsupported assertion.",
            citationIds: [],
          },
          {
            blockId: "missing",
            kind: "FACT",
            text: "Another unsupported assertion.",
            citationIds: ["citation-missing"],
          },
        ],
      }),
      evidence: [citation()],
    });

    expect(result).toMatchObject({ status: "BLOCKED" });
    if (result.status === "BLOCKED") {
      expect(result.reasons).toEqual(expect.arrayContaining([
        "MISSING_CITATION",
        "UNKNOWN_OR_AMBIGUOUS_CITATION",
        "INSUFFICIENT_EVIDENCE_OVERLAP",
      ]));
    }
  });

  it("verifies direct quotes against the cited sermon excerpt", () => {
    const valid = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        blocks: [{
          blockId: "quote",
          kind: "DIRECT_QUOTE",
          text: "God remains with us in it.",
          citationIds: ["transcript-sermon-1-120-135"],
        }],
      }),
      evidence: [citation()],
    });
    const invented = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        answerId: "answer-invented",
        blocks: [{
          blockId: "quote",
          kind: "DIRECT_QUOTE",
          text: "Every storm will end immediately.",
          citationIds: ["transcript-sermon-1-120-135"],
        }],
      }),
      evidence: [citation()],
    });

    expect(valid.status).toBe("RELEASED");
    expect(invented).toMatchObject({
      status: "BLOCKED",
      reasons: ["QUOTE_NOT_IN_EVIDENCE"],
    });
  });

  it("requires pastor approval before releasing doctrinal synthesis", () => {
    const evidence = citation();
    const pending = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        theologicalReview: "PENDING",
        blocks: [{
          blockId: "doctrine",
          kind: "DOCTRINAL_SYNTHESIS",
          text: "God remains present with believers in suffering and storms.",
          citationIds: [evidence.citationId],
        }],
      }),
      evidence: [evidence],
    });
    const approved = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        answerId: "answer-approved",
        theologicalReview: "PASTOR_APPROVED",
        blocks: [{
          blockId: "doctrine",
          kind: "DOCTRINAL_SYNTHESIS",
          text: "God remains present with believers in suffering and storms.",
          citationIds: [evidence.citationId],
        }],
      }),
      evidence: [evidence],
    });

    expect(pending).toMatchObject({
      status: "BLOCKED",
      reasons: ["THEOLOGICAL_REVIEW_REQUIRED"],
    });
    expect(approved.status).toBe("RELEASED");
  });

  it("requires Scripture claims to cite a verified Scripture source", () => {
    const transcript = citation();
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        blocks: [{
          blockId: "scripture",
          kind: "SCRIPTURE",
          text: "Scripture teaches that God remains with us.",
          citationIds: [transcript.citationId],
        }],
      }),
      evidence: [transcript],
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: ["SCRIPTURE_SOURCE_REQUIRED"],
    });
  });

  it("never releases pastoral-sensitive evidence and protects public exports", () => {
    const internal = citation({
      privacy: "CHURCH_INTERNAL",
    });
    const sensitive = citation({
      citationId: "sensitive",
      privacy: "PASTORAL_SENSITIVE",
    });
    const publicResult = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "PUBLIC_EXPORT",
      draft: draft(),
      evidence: [internal],
    });
    const sensitiveResult = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({
        blocks: [{
          blockId: "sensitive",
          kind: "FACT",
          text: "God remains with us in the storm.",
          citationIds: ["sensitive"],
        }],
      }),
      evidence: [sensitive],
    });

    expect(publicResult).toMatchObject({
      status: "BLOCKED",
      reasons: ["PUBLIC_EXPORT_REQUIRES_PUBLIC_SOURCE"],
    });
    expect(sensitiveResult).toMatchObject({
      status: "BLOCKED",
      reasons: ["SENSITIVE_SOURCE"],
    });
  });

  it("blocks altered evidence and invalid transcript spans", () => {
    const original = citation();
    const altered = {
      ...original,
      excerpt: "The evidence was changed after its identity was issued.",
      startTimeSeconds: 200,
      endTimeSeconds: 100,
    };
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft(),
      evidence: [altered],
    });

    expect(result).toMatchObject({ status: "BLOCKED" });
    if (result.status === "BLOCKED") {
      expect(result.reasons).toEqual(expect.arrayContaining([
        "INVALID_CITATION_IDENTITY",
        "INVALID_TRANSCRIPT_SPAN",
      ]));
    }
  });

  it("does not let a campus-scoped request release an organization-wide draft", () => {
    const result = releaseGroundedArchiveAnswer({
      requestScope: scope,
      audience: "CHURCH_TEAM",
      draft: draft({ campusId: null }),
      evidence: [citation()],
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: ["TENANT_SCOPE_MISMATCH"],
    });
  });
});
