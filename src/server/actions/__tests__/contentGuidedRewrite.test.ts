import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  opportunityFindFirst: vi.fn(),
  brandingFindUnique: vi.fn(),
  createLoggedChatCompletion: vi.fn(),
  resolveOpenAIChatModel: vi.fn(() => "gpt-test"),
  resolveOpenAIReasoningEffort: vi.fn(() => undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentOpportunity: { findFirst: mocks.opportunityFindFirst },
    brandingSettings: { findUnique: mocks.brandingFindUnique },
  },
}));

vi.mock("@/server/ai/aiGateway", () => ({
  createLoggedChatCompletion: mocks.createLoggedChatCompletion,
}));

vi.mock("@/server/ai/modelConfig", () => ({
  resolveOpenAIChatModel: mocks.resolveOpenAIChatModel,
  resolveOpenAIReasoningEffort: mocks.resolveOpenAIReasoningEffort,
}));

import { requestGuidedContentRewriteAction } from "@/server/actions/contentGuidedRewrite";

const verifiedAt = "2026-07-20T08:00:00.000Z";

function structuredTextContract() {
  return {
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
      callToAction: { type: "SAVE", text: "Save this for a pressured week.", url: null },
      platforms: ["FACEBOOK"],
    },
    postKind: "SOCIAL_POST",
    headline: "Choose the faithful next step",
    body: "Pressure can feel heavy, but it can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
    sections: [],
  };
}

function opportunity(opportunityType = "FACEBOOK_POST_IDEA") {
  return {
    id: "opportunity-1",
    opportunityType,
    structuredContentJson: opportunityType === "FACEBOOK_POST_IDEA" ? structuredTextContract() : null,
    sourceTranscriptExcerpt: "Pressure can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
    relatedScripture: null,
    suggestedPlatform: "Facebook",
    relatedClip: null,
    ministryMoment: null,
    sermon: {
      title: "Faithful Under Pressure",
      speakerName: "Pastor Ndlovu",
      churchName: "Example Church",
      language: "English",
      sermonDate: new Date("2026-07-19T08:00:00.000Z"),
      intelligence: {
        isManuallyReviewed: true,
        manualTitle: "Faithful Under Pressure",
        manualSummary: "Pressure reveals formation and calls for the next faithful step.",
        manualCentralTheme: "Faithful steps under pressure",
      },
      topicTags: [{
        topic: "Faithfulness",
        evidence: "Choose the next faithful step.",
        isManuallyAdded: false,
      }],
      ministryMoments: [],
    },
  };
}

function completionWith(value: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(value) } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.opportunityFindFirst.mockResolvedValue(opportunity());
  mocks.brandingFindUnique.mockResolvedValue({
    churchName: "Example Church",
    primaryBrandColor: "#112233",
    secondaryBrandColor: "#445566",
    defaultFontFamily: "Inter",
    defaultCaptionStyleName: "Editorial",
  });
  mocks.createLoggedChatCompletion.mockImplementation(async (input: {
    validateResponse: (completion: ReturnType<typeof completionWith>) => unknown;
  }) => input.validateResponse(completionWith({
    title: "Keep taking faithful steps",
    shortDescription: "A warmer encouragement grounded in the sermon.",
    units: [{
      heading: "Keep taking faithful steps",
      body: "Pressure can feel heavy. Choose the next faithful step and keep walking with integrity.",
    }],
  })));
});
describe("guided content rewrite action", () => {
  it("returns a validated review-only suggestion without writing or approving content", async () => {
    const result = await requestGuidedContentRewriteAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      variant: "WARMER",
      currentDraft: {
        title: "Choose the faithful next step",
        shortDescription: "A grounded encouragement for a pressured week.",
        content: "Pressure can feel heavy, but it can reveal what faith has formed. Choose the next faithful step and keep walking with integrity.",
      },
    });

    expect(result).toMatchObject({
      success: true,
      suggestion: {
        title: "Keep taking faithful steps",
        reviewRequired: true,
      },
    });
    expect(result.message).toMatch(/not approved or published/i);
    expect(mocks.createLoggedChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      operation: "content_guided_rewrite",
      model: "gpt-test",
      response_format: { type: "json_object" },
      metadata: expect.objectContaining({ reviewOnly: true }),
    }));
  });

  it.each(["QUOTE_GRAPHIC", "SCRIPTURE_GRAPHIC"])(
    "does not call the model for protected %s wording",
    async (opportunityType) => {
      mocks.opportunityFindFirst.mockResolvedValue(opportunity(opportunityType));

      const result = await requestGuidedContentRewriteAction({
        sermonId: "sermon-1",
        opportunityId: "opportunity-1",
        variant: "SHORTER",
        currentDraft: {
          title: "Protected content",
          shortDescription: "Exact wording",
          content: "Exact wording must be checked.",
        },
      });

      expect(result).toMatchObject({ success: false });
      expect(result.message).toMatch(/edit and verify.*manually/i);
      expect(mocks.createLoggedChatCompletion).not.toHaveBeenCalled();
    },
  );

  it("blocks a leadership adaptation when the evidence has no leadership angle", async () => {
    mocks.opportunityFindFirst.mockResolvedValue({
      ...opportunity(),
      sourceTranscriptExcerpt: "Grace gives rest to weary hearts.",
      structuredContentJson: {
        ...structuredTextContract(),
        sourceEvidence: [],
      },
      sermon: {
        ...opportunity().sermon,
        intelligence: null,
        topicTags: [],
      },
    });

    const result = await requestGuidedContentRewriteAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      variant: "LEADERSHIP",
      currentDraft: {
        title: "Rest for weary hearts",
        shortDescription: "A gentle reminder about grace.",
        content: "Grace gives rest to weary hearts.",
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/leadership angle is not present/i);
    expect(mocks.createLoggedChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects an unsafe model response and leaves persistence untouched", async () => {
    mocks.createLoggedChatCompletion.mockImplementation(async (input: {
      validateResponse: (completion: ReturnType<typeof completionWith>) => unknown;
    }) => input.validateResponse(completionWith({
      title: "Join us this Sunday",
      shortDescription: "A new event invitation.",
      units: [{
        heading: "Join us this Sunday at 9am",
        body: "Register at https://invented.example and hear a new promise.",
      }],
    })));

    const result = await requestGuidedContentRewriteAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      variant: "WARMER",
      currentDraft: {
        title: "Choose the faithful next step",
        shortDescription: "A grounded encouragement.",
        content: "Pressure can reveal what faith has formed.",
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/detail that was not present/i);
  });
});
