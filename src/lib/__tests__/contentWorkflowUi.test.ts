import { describe, expect, it } from "vitest";

import {
  buildOpportunityApprovalSignal,
  buildContentContractPresentation,
  buildOpportunityEvidenceSignal,
  buildOpportunityHref,
  buildReadyAssetHref,
  buildScheduledPostHref,
  hasApprovedAssetPublishingRevision,
} from "@/lib/contentWorkflowUi";
import { convertLegacyBodyContent } from "@/lib/contentOpportunityContracts";

describe("content workflow UI signals", () => {
  it("makes changed approved content visibly require reapproval", () => {
    expect(buildOpportunityApprovalSignal({
      status: "NEEDS_REVIEW",
      approvedRevisionNumber: 2,
    })).toEqual({
      label: "Reapproval required",
      detail: "This content changed after v2 was approved. Review the current words before preparing it.",
      tone: "attention",
    });
  });

  it("describes the immutable approved revision", () => {
    const signal = buildOpportunityApprovalSignal({
      status: "APPROVED",
      approvedRevisionNumber: 3,
      approvedAt: "2026-07-22T10:00:00.000Z",
    });

    expect(signal.label).toBe("Approved v3");
    expect(signal.detail).toContain("exact version 3");
    expect(signal.tone).toBe("ready");
  });

  it("only calls a quote match approved after approval", () => {
    const draft = buildOpportunityEvidenceSignal({
      status: "NEEDS_REVIEW",
      opportunityType: "QUOTE_GRAPHIC",
      sourceTranscriptExcerpt: "Grace meets us here.",
      sourceSegmentCount: 1,
      sourceStartTimeSeconds: 65,
      sourceEndTimeSeconds: 72,
    });
    const approved = buildOpportunityEvidenceSignal({
      status: "APPROVED",
      opportunityType: "QUOTE_GRAPHIC",
      sourceTranscriptExcerpt: "Grace meets us here.",
      sourceSegmentCount: 1,
      sourceStartTimeSeconds: 65,
      sourceEndTimeSeconds: 72,
    });

    expect(draft.label).toBe("Transcript source attached");
    expect(draft.detail).toContain("1:05–1:12");
    expect(approved.label).toBe("Transcript match approved");
  });

  it("keeps missing quote evidence and unchecked Scripture explicit", () => {
    expect(buildOpportunityEvidenceSignal({
      status: "NEEDS_REVIEW",
      opportunityType: "QUOTE_GRAPHIC",
    }).tone).toBe("blocked");
    expect(buildOpportunityEvidenceSignal({
      status: "NEEDS_REVIEW",
      opportunityType: "SCRIPTURE_GRAPHIC",
      relatedScripture: "John 3:16",
      scriptureTranslation: "NIV",
      translationReviewState: "REVIEW_REQUIRED",
    }).label).toBe("Scripture check required");
  });

  it("builds durable context-preserving workflow links", () => {
    expect(buildOpportunityHref("sermon 1", "idea/2")).toBe(
      "/opportunities?sermonId=sermon+1&opportunityId=idea%2F2#opportunity-idea%2F2",
    );
    expect(buildReadyAssetHref("asset/1")).toBe(
      "/ready-to-post?contentAssetId=asset%2F1#generated-content-assets",
    );
    expect(buildScheduledPostHref("post/1")).toBe(
      "/ready-to-post?scheduledPostId=post%2F1#posting-calendar",
    );
  });

  it("only treats the exact immutable approved asset revision as publishable", () => {
    expect(hasApprovedAssetPublishingRevision({
      currentRevisionId: "revision-2",
      approvedRevisionId: "revision-2",
      currentRevisionApprovalState: "APPROVED",
    })).toBe(true);

    expect(hasApprovedAssetPublishingRevision({
      currentRevisionId: "revision-3",
      approvedRevisionId: "revision-2",
      currentRevisionApprovalState: "APPROVED",
    })).toBe(false);
    expect(hasApprovedAssetPublishingRevision({
      currentRevisionId: "revision-2",
      approvedRevisionId: "revision-2",
      currentRevisionApprovalState: "REAPPROVAL_REQUIRED",
    })).toBe(false);
    expect(hasApprovedAssetPublishingRevision({
      currentRevisionId: null,
      approvedRevisionId: null,
      currentRevisionApprovalState: null,
    })).toBe(false);
  });

  it("keeps publishable artwork and captions separate from production directions", () => {
    const resolved = convertLegacyBodyContent({
      opportunityType: "SHORT_FORM_CLIP_IDEA",
      title: "Hope rises",
      bodyContent: "Open with hope for people under pressure.",
    }).contract;
    if (resolved.family !== "VIDEO_CLIP_BRIEF") throw new Error("Expected a video brief");
    resolved.productionBrief.editNotes = ["Internal edit direction that must not publish"];
    resolved.productionBrief.bRollDirections = ["Internal B-roll direction"];

    const presentation = buildContentContractPresentation(resolved);

    expect(presentation.artworkText).toContain("Open with hope");
    expect(presentation.artworkText).not.toContain("Internal edit direction");
    expect(presentation.publishingCaption).not.toContain("Internal B-roll direction");
  });
});
