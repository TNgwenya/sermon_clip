import { describe, expect, it } from "vitest";

import {
  applyGuidedRewriteToContract,
  buildGuidedRewritePrompt,
  findUnsupportedGuidedRewriteClaims,
  GuidedRewriteValidationError,
  parseGuidedRewriteModelResponse,
  supportsGuidedRewrite,
  validateAndBuildGuidedRewriteSuggestion,
} from "@/lib/contentGuidedRewrite";
import {
  parseContentOpportunityContractForType,
  type ContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";
import type { MinistryVoiceProfile } from "@/lib/contentEditorialQuality";

const verifiedAt = "2026-07-20T08:00:00.000Z";

function textContract(): ContentOpportunityContract {
  return parseContentOpportunityContractForType("FACEBOOK_POST_IDEA", {
    schemaVersion: 1,
    family: "TEXT_POST",
    sourceEvidence: [{
      kind: "TRANSCRIPT_SPAN",
      transcriptId: "transcript-1",
      segmentIds: ["segment-1"],
      startMs: 12_000,
      endMs: 20_000,
      excerpt: "Pressure can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
      speaker: "Pastor Ndlovu",
      verification: {
        status: "VERIFIED",
        method: "TRANSCRIPT_MATCH",
        verifiedAt,
        verifiedBy: "reviewer-1",
        note: "Matched to the stored transcript.",
      },
    }],
    publishingCopy: {
      caption: "Pressure can reveal what faith has formed. Choose one faithful next step today.",
      hashtags: ["#FaithfulSteps"],
      callToAction: {
        type: "VISIT_LINK",
        text: "Visit the sermon page.",
        url: "https://example.church/sermon",
      },
      platforms: ["FACEBOOK"],
    },
    postKind: "SOCIAL_POST",
    headline: "Choose the faithful next step",
    body: "Pressure can feel heavy, but it can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
    sections: [],
  });
}

const voiceProfile: MinistryVoiceProfile = {
  profileVersion: 1,
  provenance: "MINISTRY_METADATA_ONLY",
  identity: {
    churchName: "Example Church",
    speakerName: "Pastor Ndlovu",
    sermonTitle: "Faithful Under Pressure",
    sermonDate: "2026-07-19",
    language: "English",
  },
  presentation: {
    primaryBrandColor: null,
    secondaryBrandColor: null,
    defaultFontFamily: null,
    defaultCaptionStyleName: null,
  },
  anchors: [{
    kind: "REVIEWED_THEME",
    value: "Faithful steps under pressure",
    evidence: "Pressure can reveal what faith has formed.",
    source: "MANUAL_REVIEW",
  }, {
    kind: "SCRIPTURE",
    value: "James 1:2",
    evidence: "Mentioned in the sermon.",
    source: "GROUNDED_METADATA",
  }],
  safePersonalizationTerms: ["Example Church", "Pastor Ndlovu", "Faithful steps under pressure", "James 1:2"],
  generationGuardrails: ["Do not infer missing facts."],
  omittedUnreviewedMetadata: [],
};

const currentDraft = {
  title: "Choose the faithful next step",
  shortDescription: "A grounded encouragement for a pressured week.",
  content: "Pressure can feel heavy, but it can reveal what faith has formed. You do not have to solve the whole journey today. Choose the next faithful step and keep walking with integrity.",
};

describe("guided content rewrite safety", () => {
  it("disables generated rewrites for exact quote and Scripture artwork", () => {
    expect(supportsGuidedRewrite("QUOTE_GRAPHIC")).toBe(false);
    expect(supportsGuidedRewrite("SCRIPTURE_GRAPHIC")).toBe(false);
    expect(supportsGuidedRewrite("FACEBOOK_POST_IDEA")).toBe(true);
  });

  it("requires strict JSON without extra keys", () => {
    expect(() => parseGuidedRewriteModelResponse(JSON.stringify({
      title: "A title",
      shortDescription: "A description",
      units: [{ heading: "A heading", body: "A grounded body." }],
      autoApprove: true,
    }))).toThrow(GuidedRewriteValidationError);
  });

  it("omits unrelated Scripture anchors and states the non-invention rules in the prompt", () => {
    const prompt = buildGuidedRewritePrompt({
      opportunityType: "FACEBOOK_POST_IDEA",
      contract: textContract(),
      variant: "WARMER",
      draft: currentDraft,
      evidence: [{ label: "Transcript", text: "Pressure can reveal what faith has formed." }],
      voiceProfile,
    });

    expect(prompt.system).toContain("Do not add facts, doctrine");
    expect(prompt.system).toContain("service times");
    expect(prompt.system).toContain("strict JSON object only");
    expect(prompt.user).toContain("GUIDED VARIANT: WARMER");
    expect(prompt.user).not.toContain("James 1:2");
  });

  it("rebuilds a typed candidate while preserving evidence, URLs and publishing metadata", () => {
    const original = textContract();
    const candidate = applyGuidedRewriteToContract({
      opportunityType: "FACEBOOK_POST_IDEA",
      contract: original,
      response: {
        title: "Keep taking faithful steps",
        shortDescription: "A warm encouragement grounded in the sermon.",
        units: [{
          heading: "Keep taking faithful steps",
          body: "Pressure can feel heavy. Choose the next faithful step and keep walking with integrity.",
        }],
      },
    });

    expect(candidate.family).toBe("TEXT_POST");
    expect(candidate.sourceEvidence).toEqual(original.sourceEvidence);
    expect(candidate.publishingCopy).toEqual(original.publishingCopy);
    expect(candidate.publishingCopy.callToAction?.url).toBe("https://example.church/sermon");
    expect(candidate).not.toHaveProperty("legacyConversion");
  });

  it("blocks new URLs, Scripture references and unsupported ministry claims", () => {
    const issues = findUnsupportedGuidedRewriteClaims({
      candidateText: "Join us this Sunday at 9am. Read John 3:16 at https://new.example. God guarantees success.",
      allowedText: currentDraft.content,
    });

    expect(issues).toEqual(expect.arrayContaining([
      "url",
      "serviceTime",
      "event",
      "doctrine",
      "scripture",
      "numberOrDate",
    ]));
  });

  it("runs deterministic editorial review and returns a review-only draft", () => {
    const suggestion = validateAndBuildGuidedRewriteSuggestion({
      opportunityType: "FACEBOOK_POST_IDEA",
      contract: textContract(),
      response: {
        title: "Keep taking faithful steps",
        shortDescription: "A warm, grounded encouragement for pressure.",
        units: [{
          heading: "Keep taking faithful steps",
          body: "Pressure can feel heavy. Choose the next faithful step and keep walking with integrity.",
        }],
      },
      variant: "SHORTER",
      currentDraft,
      allowedEvidenceText: "Pressure can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
      voiceProfile,
    });

    expect(suggestion).toMatchObject({
      title: "Keep taking faithful steps",
      reviewRequired: true,
    });
    expect(suggestion.editorialScore).toBeGreaterThan(0);
    expect(suggestion.content).toContain("Pressure can feel heavy");
  });

  it("rejects placeholders before they can reach the editor", () => {
    expect(() => validateAndBuildGuidedRewriteSuggestion({
      opportunityType: "FACEBOOK_POST_IDEA",
      contract: textContract(),
      response: {
        title: "Keep taking faithful steps",
        shortDescription: "A grounded encouragement.",
        units: [{ heading: "Keep taking faithful steps", body: "[Add the pastor's story here]" }],
      },
      variant: "WARMER",
      currentDraft,
      allowedEvidenceText: currentDraft.content,
      voiceProfile,
    })).toThrow(/placeholder or internal production instruction/i);
  });
});
