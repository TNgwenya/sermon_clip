import { describe, expect, it } from "vitest";

import {
  contentOpportunityResponseSchema,
  contentOpportunitySchema,
} from "@/server/ai/contentOpportunitySchema";
import { __contentMultiplicationTestUtils } from "@/server/agents/contentMultiplicationService";
import { filterContentOpportunities, groupOpportunitiesByCategory } from "@/lib/contentOpportunity";

const sampleOpportunity = {
  category: "SOCIAL",
  opportunityType: "QUOTE_GRAPHIC",
  title: "Faith over fear quote",
  shortDescription: "A social quote card from the sermon.",
  bodyContent: "\"Faith over fear\" with supporting caption copy.",
  sourceTranscriptExcerpt: "Faith over fear",
  relatedScripture: "2 Timothy 1:7",
  relatedMinistryMomentTitle: "Faith declaration",
  relatedClipTitle: "Faith declaration clip",
  suggestedPlatform: "Instagram",
  detectedLanguage: "English + Zulu",
  translatedFromLanguage: "Zulu",
  originalPhrase: "Nkulunkulu unathi",
  englishMeaning: "God is with us",
  translationConfidence: 0.8,
  translationUncertaintyNote: null,
  confidenceScore: 0.91,
  aiReason: "Strong direct quote with scripture support.",
} as const;

describe("content opportunity schema", () => {
  it("accepts a valid content opportunity record", () => {
    const parsed = contentOpportunitySchema.safeParse(sampleOpportunity);
    expect(parsed.success).toBe(true);
  });

  it("rejects missing body content", () => {
    const parsed = contentOpportunitySchema.safeParse({
      ...sampleOpportunity,
      bodyContent: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts response payload", () => {
    const parsed = contentOpportunityResponseSchema.safeParse({
      opportunities: [sampleOpportunity],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts payload when translation fields are not provided", () => {
    const base = {
      ...sampleOpportunity,
      detectedLanguage: undefined,
      translatedFromLanguage: undefined,
      originalPhrase: undefined,
      englishMeaning: undefined,
      translationConfidence: undefined,
      translationUncertaintyNote: undefined,
    };
    const parsed = contentOpportunitySchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid translation confidence", () => {
    const parsed = contentOpportunitySchema.safeParse({
      ...sampleOpportunity,
      translationConfidence: 1.2,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("content multiplication service utils", () => {
  it("builds requested quantities with targeted type", () => {
    const requested = __contentMultiplicationTestUtils.buildRequestedQuantities({
      targetType: "SERMON_SUMMARY",
      quantities: { SERMON_SUMMARY: 2 },
    });

    expect(requested.SERMON_SUMMARY).toBe(2);
    expect(requested.QUOTE_GRAPHIC).toBe(0);
  });

  it("curates generated output by requested quantity and dedupes", () => {
    const generated = [
      sampleOpportunity,
      { ...sampleOpportunity },
      {
        ...sampleOpportunity,
        title: "Second quote card",
      },
    ];

    const curated = __contentMultiplicationTestUtils.curateGeneratedOpportunities(generated, {
      SHORT_FORM_CLIP_IDEA: 0,
      QUOTE_GRAPHIC: 2,
      SCRIPTURE_GRAPHIC: 0,
      CAROUSEL_IDEA: 0,
      CAPTION: 0,
      REEL_HOOK: 0,
      YOUTUBE_SHORTS_IDEA: 0,
      TIKTOK_IDEA: 0,
      FACEBOOK_POST_IDEA: 0,
      INSTAGRAM_POST_IDEA: 0,
      SERMON_SUMMARY: 0,
      DEVOTIONAL_SUMMARY: 0,
      NEWSLETTER_SUMMARY: 0,
      BLOG_DRAFT_OUTLINE: 0,
      ARTICLE_OUTLINE: 0,
      EMAIL_RECAP: 0,
      DISCUSSION_QUESTIONS: 0,
      SMALL_GROUP_QUESTIONS: 0,
      REFLECTION_QUESTIONS: 0,
      FAMILY_DISCUSSION_QUESTIONS: 0,
      YOUTH_DISCUSSION_QUESTIONS: 0,
      SUNDAY_RECAP: 0,
      NEXT_SERVICE_PROMOTION: 0,
      INVITATION_CONTENT: 0,
      ALTAR_CALL_FOLLOW_UP_CONTENT: 0,
      EVENT_FOLLOW_UP_CONTENT: 0,
    });

    expect(curated).toHaveLength(2);
    expect(curated[0]?.category).toBe("SOCIAL");
  });

  it("preserves approved or edited opportunities during regeneration", () => {
    expect(
      __contentMultiplicationTestUtils.shouldPreserveOpportunityDuringRegeneration({
        status: "APPROVED",
        isManuallyEdited: false,
        isManuallyCreated: false,
        editedContent: null,
        approvedContent: "Approved copy",
      }),
    ).toBe(true);

    expect(
      __contentMultiplicationTestUtils.shouldPreserveOpportunityDuringRegeneration({
        status: "NEEDS_REVIEW",
        isManuallyEdited: true,
        isManuallyCreated: false,
        editedContent: "Edited copy",
        approvedContent: null,
      }),
    ).toBe(true);

    expect(
      __contentMultiplicationTestUtils.shouldPreserveOpportunityDuringRegeneration({
        status: "NEEDS_REVIEW",
        isManuallyEdited: false,
        isManuallyCreated: false,
        editedContent: null,
        approvedContent: null,
      }),
    ).toBe(false);
  });

  it("reuses existing opportunities only when force is false", () => {
    expect(__contentMultiplicationTestUtils.shouldReuseExistingOpportunities(3, false)).toBe(true);
    expect(__contentMultiplicationTestUtils.shouldReuseExistingOpportunities(3, true)).toBe(false);
    expect(__contentMultiplicationTestUtils.shouldReuseExistingOpportunities(0, false)).toBe(false);
  });
});

describe("opportunity filtering utilities", () => {
  const items = [
    {
      id: "1",
      sermonId: "sermon-1",
      category: "SOCIAL",
      opportunityType: "QUOTE_GRAPHIC",
      status: "NEEDS_REVIEW",
      relatedScripture: "John 3:16",
      topicTags: ["faith", "evangelism"],
      ministryMomentType: "FAITH_DECLARATION",
    },
    {
      id: "2",
      sermonId: "sermon-2",
      category: "PROMOTION",
      opportunityType: "NEXT_SERVICE_PROMOTION",
      status: "APPROVED",
      relatedScripture: null,
      topicTags: ["service"],
      ministryMomentType: null,
    },
  ] as const;

  it("filters by sermon/category/status/topic/scripture/moment", () => {
    const filtered = filterContentOpportunities(items as unknown as Parameters<typeof filterContentOpportunities>[0], {
      sermonId: "sermon-1",
      category: "SOCIAL",
      status: "NEEDS_REVIEW",
      topic: "faith",
      scripture: "John",
      ministryMomentType: "FAITH_DECLARATION",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("1");
  });

  it("groups by category", () => {
    const grouped = groupOpportunitiesByCategory(items as unknown as Parameters<typeof groupOpportunitiesByCategory>[0]);
    expect(grouped.SOCIAL).toHaveLength(1);
    expect(grouped.PROMOTION).toHaveLength(1);
    expect(grouped.WRITTEN).toHaveLength(0);
  });
});
