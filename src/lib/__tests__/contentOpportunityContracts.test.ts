import { describe, expect, it } from "vitest";

import {
  CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE,
  ContentContractFamilyMismatchError,
  contentOpportunityContractSchema,
  convertLegacyBodyContent,
  getContentContractFamily,
  parseContentOpportunityContractForType,
  parseContentOpportunityContractJson,
  resolveContentOpportunityContract,
  safeParseContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";
import {
  CONTENT_OPPORTUNITY_TYPES,
  type ContentOpportunityType,
} from "@/server/ai/contentOpportunitySchema";

describe("content opportunity contracts", () => {
  it("maps every opportunity type to exactly one structured contract family", () => {
    expect(Object.keys(CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE).sort()).toEqual(
      [...CONTENT_OPPORTUNITY_TYPES].sort(),
    );
    expect(getContentContractFamily("QUOTE_GRAPHIC")).toBe("QUOTE_GRAPHIC");
    expect(getContentContractFamily("SCRIPTURE_GRAPHIC")).toBe("SCRIPTURE_GRAPHIC");
    expect(getContentContractFamily("SHORT_FORM_CLIP_IDEA")).toBe("VIDEO_CLIP_BRIEF");
    expect(getContentContractFamily("CAROUSEL_IDEA")).toBe("CAROUSEL");
    expect(getContentContractFamily("PLATFORM_CAPTION_PACK")).toBe("PLATFORM_CAPTION_PACK");
    expect(getContentContractFamily("ENGAGEMENT_STORY_SET")).toBe("STORY_SET");
    expect(getContentContractFamily("DEVOTIONAL_GUIDE")).toBe("MULTI_DAY_GUIDE");
    expect(getContentContractFamily("SUNDAY_RECAP")).toBe("TEXT_POST");
  });

  it.each(CONTENT_OPPORTUNITY_TYPES)(
    "converts legacy %s content into its expected valid family",
    (opportunityType) => {
      const conversion = convertLegacyBodyContent({
        opportunityType,
        title: "Faith for today",
        bodyContent: "Faith takes the next step.\n\n#SundaySermon",
        sourceTranscriptExcerpt: "Faith takes the next step.",
        relatedScripture: "Hebrews 11:1 (NIV)",
        suggestedPlatform: "Instagram, Facebook",
      });

      expect(conversion.contract.family).toBe(getContentContractFamily(opportunityType));
      expect(contentOpportunityContractSchema.safeParse(conversion.contract).success).toBe(true);
      expect(conversion.contract.legacyConversion).toMatchObject({
        origin: "LEGACY_BODY_CONTENT",
        requiresReview: true,
      });
      expect(conversion.contract.publishingCopy).toMatchObject({
        hashtags: ["#SundaySermon"],
        callToAction: null,
        platforms: ["INSTAGRAM", "FACEBOOK"],
      });
    },
  );

  it("keeps a pastor quote and its transcript evidence separate and unverified", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "QUOTE_GRAPHIC",
      title: "Keep walking",
      bodyContent: "“Faith keeps walking when pressure comes.”\n\nSave this reminder.",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
    });

    expect(conversion.contract.family).toBe("QUOTE_GRAPHIC");
    if (conversion.contract.family !== "QUOTE_GRAPHIC") throw new Error("Expected quote contract");

    expect(conversion.contract.quote).toEqual({
      text: "Faith keeps walking when pressure comes.",
      kind: "VERBATIM_SERMON",
      attribution: null,
      supportingText: null,
    });
    expect(conversion.contract.sourceEvidence[0]).toMatchObject({
      kind: "TRANSCRIPT_SPAN",
      excerpt: "Faith keeps walking when pressure comes.",
      verification: { status: "UNVERIFIED", method: "NONE" },
    });
    expect(conversion.contract.publishingCopy.caption).toContain("Save this reminder");
  });

  it("classifies Scripture syntax without pretending the verse or translation was verified", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "SCRIPTURE_GRAPHIC",
      title: "The Lord leads",
      bodyContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1 (NIV)",
    });

    expect(conversion.contract.family).toBe("SCRIPTURE_GRAPHIC");
    if (conversion.contract.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture contract");

    expect(conversion.contract.scripture).toEqual({
      reference: "Psalms 23:1",
      verseText: null,
      translation: "NIV",
      verification: {
        referenceStatus: "SYNTAX_VALID",
        verseTextStatus: "MISSING",
        translationStatus: "UNVERIFIED",
        method: "NONE",
        verifiedAt: null,
        verifiedBy: null,
        note: "Converted from legacy metadata; confirm the reference, verse wording, and translation.",
      },
    });
    expect(conversion.warnings).toContain("SCRIPTURE_REVIEW_REQUIRED");
  });

  it("marks malformed references and unknown translation labels for review", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "SCRIPTURE_GRAPHIC",
      bodyContent: "A legacy Scripture draft.",
      relatedScripture: "Psalm ninety-one (XYZ)",
    });

    expect(conversion.contract.family).toBe("SCRIPTURE_GRAPHIC");
    if (conversion.contract.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture contract");
    expect(conversion.contract.scripture.verification).toMatchObject({
      referenceStatus: "INVALID",
      translationStatus: "UNRECOGNIZED",
    });
  });

  it("turns a clip idea into a production brief that cannot imply reviewed media", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "YOUTUBE_SHORTS_IDEA",
      title: "Grace meets us here",
      bodyContent: "Open with the pastor's teaching on grace.",
      relatedClipTitle: "Grace section",
    });

    expect(conversion.contract.family).toBe("VIDEO_CLIP_BRIEF");
    if (conversion.contract.family !== "VIDEO_CLIP_BRIEF") throw new Error("Expected clip brief");
    expect(conversion.contract.productionBrief).toMatchObject({
      mediaStatus: "MISSING",
      sermonMediaId: null,
      clipId: null,
      startMs: null,
      endMs: null,
      aspectRatio: "9:16",
      captionsRequired: true,
    });
    expect(conversion.warnings).toContain("MEDIA_LINK_REQUIRED");
    expect(conversion.contract.sourceEvidence[0]).toMatchObject({
      kind: "CLIP",
      title: "Grace section",
      clipId: null,
    });
  });

  it("does not invent platform adaptations for a legacy caption pack", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "PLATFORM_CAPTION_PACK",
      bodyContent: "One legacy caption shared across every platform.",
      suggestedPlatform: "Instagram, Facebook",
    });

    expect(conversion.contract.family).toBe("PLATFORM_CAPTION_PACK");
    if (conversion.contract.family !== "PLATFORM_CAPTION_PACK") throw new Error("Expected caption pack");
    expect(conversion.contract.captions).toEqual([expect.objectContaining({
      platform: "OTHER",
      otherPlatform: "Legacy draft",
      adaptationNote: "Choose a platform and review this copy before publishing.",
    })]);
    expect(conversion.warnings).toContain("PLATFORM_COPY_REVIEW_REQUIRED");
  });

  it("creates review-required carousel, story, and guide structures without losing the legacy body", () => {
    const carousel = convertLegacyBodyContent({
      opportunityType: "CAROUSEL_IDEA",
      title: "Three reminders",
      bodyContent: "Grace is a gift.",
    });
    const story = convertLegacyBodyContent({
      opportunityType: "ENGAGEMENT_STORY_SET",
      title: "Reflect together",
      bodyContent: "What stood out to you?\n\nShare one next step.",
    });
    const guide = convertLegacyBodyContent({
      opportunityType: "PRAYER_GUIDE",
      title: "Three days of prayer",
      bodyContent: "Begin by thanking God for his faithfulness.",
    });

    expect(carousel.contract.family).toBe("CAROUSEL");
    if (carousel.contract.family !== "CAROUSEL") throw new Error("Expected carousel");
    expect(carousel.contract.slides).toHaveLength(2);
    expect(carousel.contract.slides[1].body).toContain("editorial review");
    expect(carousel.contract.legacyConversion?.rawBodyContent).toBe("Grace is a gift.");

    expect(story.contract.family).toBe("STORY_SET");
    if (story.contract.family !== "STORY_SET") throw new Error("Expected story set");
    expect(story.contract.frames).toHaveLength(2);

    expect(guide.contract.family).toBe("MULTI_DAY_GUIDE");
    if (guide.contract.family !== "MULTI_DAY_GUIDE") throw new Error("Expected guide");
    expect(guide.contract.guideKind).toBe("PRAYER");
    expect(guide.contract.days).toHaveLength(1);
    expect(guide.contract.days[0].teaching).toBe("Begin by thanking God for his faithfulness.");
    expect(guide.warnings).toContain("CONTENT_INCOMPLETE");
  });

  it("safely converts missing and oversized legacy text", () => {
    const empty = convertLegacyBodyContent({
      opportunityType: "FACEBOOK_POST_IDEA",
      bodyContent: "   ",
    });
    const oversized = convertLegacyBodyContent({
      opportunityType: "SERMON_SUMMARY",
      bodyContent: "a".repeat(12_000),
    });

    expect(empty.contract.family).toBe("TEXT_POST");
    if (empty.contract.family !== "TEXT_POST") throw new Error("Expected text post");
    expect(empty.contract.body).toBe("Content needs editorial review.");
    expect(empty.contract.legacyConversion?.rawBodyContent).toBe("");
    expect(empty.warnings).toContain("CONTENT_INCOMPLETE");

    expect(oversized.contract.legacyConversion?.rawBodyContent).toHaveLength(8000);
    expect(oversized.contract.publishingCopy.caption).toHaveLength(5000);
  });

  it("parses structured JSON and enforces the family expected by the opportunity type", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "Grace is enough.",
    });
    const encoded = JSON.stringify(conversion.contract);

    expect(parseContentOpportunityContractJson(encoded).family).toBe("QUOTE_GRAPHIC");
    expect(parseContentOpportunityContractForType("QUOTE_GRAPHIC", encoded).family).toBe("QUOTE_GRAPHIC");
    expect(() => parseContentOpportunityContractForType("SCRIPTURE_GRAPHIC", encoded)).toThrow(
      ContentContractFamilyMismatchError,
    );
  });

  it("rejects incomplete or polluted structured contracts", () => {
    const conversion = convertLegacyBodyContent({
      opportunityType: "CAPTION",
      bodyContent: "A clean caption.",
    });
    const missingCallToAction = structuredClone(conversion.contract) as Record<string, unknown>;
    const publishingCopy = missingCallToAction.publishingCopy as Record<string, unknown>;
    delete publishingCopy.callToAction;

    expect(safeParseContentOpportunityContract(missingCallToAction).success).toBe(false);
    expect(safeParseContentOpportunityContract({
      ...conversion.contract,
      unknownPublishableField: "do not silently accept this",
    }).success).toBe(false);
  });

  it("rejects verification claims that have no method or audit identity", () => {
    const quote = structuredClone(convertLegacyBodyContent({
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "Faith keeps walking.",
      sourceTranscriptExcerpt: "Faith keeps walking.",
    }).contract);
    if (quote.family !== "QUOTE_GRAPHIC") throw new Error("Expected quote contract");
    const transcriptEvidence = quote.sourceEvidence.find((evidence) => evidence.kind === "TRANSCRIPT_SPAN");
    if (!transcriptEvidence || transcriptEvidence.kind !== "TRANSCRIPT_SPAN") {
      throw new Error("Expected transcript evidence");
    }
    transcriptEvidence.verification.status = "VERIFIED";

    const scripture = structuredClone(convertLegacyBodyContent({
      opportunityType: "SCRIPTURE_GRAPHIC",
      bodyContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1 (NIV)",
    }).contract);
    if (scripture.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture contract");
    scripture.scripture.verification.translationStatus = "VERIFIED";

    expect(safeParseContentOpportunityContract(quote).success).toBe(false);
    expect(safeParseContentOpportunityContract(scripture).success).toBe(false);
  });

  it("rejects incomplete, reversed, and falsely reviewed clip ranges", () => {
    const base = convertLegacyBodyContent({
      opportunityType: "SHORT_FORM_CLIP_IDEA",
      bodyContent: "A clip about hope.",
    }).contract;
    if (base.family !== "VIDEO_CLIP_BRIEF") throw new Error("Expected clip brief");

    const incomplete = structuredClone(base);
    incomplete.productionBrief.mediaStatus = "LINKED";
    incomplete.productionBrief.sermonMediaId = "sermon-media-1";
    incomplete.productionBrief.startMs = 1_000;

    const reversed = structuredClone(base);
    reversed.productionBrief.mediaStatus = "LINKED";
    reversed.productionBrief.sermonMediaId = "sermon-media-1";
    reversed.productionBrief.startMs = 9_000;
    reversed.productionBrief.endMs = 4_000;

    const falselyReviewed = structuredClone(base);
    falselyReviewed.productionBrief.mediaStatus = "REVIEWED";
    falselyReviewed.productionBrief.clipId = "clip-1";

    expect(safeParseContentOpportunityContract(incomplete).success).toBe(false);
    expect(safeParseContentOpportunityContract(reversed).success).toBe(false);
    expect(safeParseContentOpportunityContract(falselyReviewed).success).toBe(false);
  });

  it("requires sequential visual content and a URL for visit-link calls to action", () => {
    const carousel = structuredClone(convertLegacyBodyContent({
      opportunityType: "CAROUSEL_IDEA",
      title: "Grace",
      bodyContent: "Grace meets us.\n\nWalk in grace.",
    }).contract);
    if (carousel.family !== "CAROUSEL") throw new Error("Expected carousel");
    carousel.slides[1].position = 1;

    const textPost = structuredClone(convertLegacyBodyContent({
      opportunityType: "CAPTION",
      bodyContent: "Join us this Sunday.",
    }).contract);
    textPost.publishingCopy.callToAction = {
      type: "VISIT_LINK",
      text: "Learn more",
      url: null,
    };

    expect(safeParseContentOpportunityContract(carousel).success).toBe(false);
    expect(safeParseContentOpportunityContract(textPost).success).toBe(false);
  });

  it("uses valid structured content and falls back safely when it is invalid or mismatched", () => {
    const structured = convertLegacyBodyContent({
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "Grace is enough.",
    }).contract;
    const accepted = resolveContentOpportunityContract({
      opportunityType: "QUOTE_GRAPHIC",
      structuredContent: structured,
      bodyContent: "Old body",
    });
    const recovered = resolveContentOpportunityContract({
      opportunityType: "SCRIPTURE_GRAPHIC",
      structuredContent: structured,
      bodyContent: "The Lord is near.",
      relatedScripture: "Psalm 34:18",
    });

    expect(accepted.source).toBe("STRUCTURED");
    expect(accepted.warnings).toEqual([]);
    expect(recovered.source).toBe("LEGACY_CONVERTED");
    expect(recovered.contract.family).toBe("SCRIPTURE_GRAPHIC");
  });

  it("keeps the exhaustive mapping statically compatible with ContentOpportunityType", () => {
    for (const opportunityType of CONTENT_OPPORTUNITY_TYPES as readonly ContentOpportunityType[]) {
      expect(CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE[opportunityType]).toBeTruthy();
    }
  });
});
