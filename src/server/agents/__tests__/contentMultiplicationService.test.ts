import { beforeEach, describe, expect, it, vi } from "vitest";

const generationMocks = vi.hoisted(() => ({
  findSermon: vi.fn(),
  findBranding: vi.fn(),
  findOpportunities: vi.fn(),
  updateMany: vi.fn(),
  createMany: vi.fn(),
  processingJobUpdateMany: vi.fn(),
  transaction: vi.fn(),
  chatCompletion: vi.fn(),
  appendPipelineLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: { findUnique: generationMocks.findSermon },
    brandingSettings: { findUnique: generationMocks.findBranding },
    contentOpportunity: { findMany: generationMocks.findOpportunities },
    $transaction: generationMocks.transaction,
  },
}));

vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: generationMocks.appendPipelineLog,
}));

vi.mock("@/server/ai/aiGateway", () => ({
  createLoggedChatCompletion: generationMocks.chatCompletion,
}));

vi.mock("@/server/ai/modelConfig", () => ({
  resolveOpenAIChatModel: () => "test-model",
  resolveOpenAIReasoningEffort: () => "medium",
}));

import {
  contentOpportunityResponseSchema,
  contentOpportunitySchema,
  type ContentOpportunityRecord,
} from "@/server/ai/contentOpportunitySchema";
import {
  __contentMultiplicationTestUtils,
  generateContentOpportunities,
} from "@/server/agents/contentMultiplicationService";
import { filterContentOpportunities, groupOpportunitiesByCategory } from "@/lib/contentOpportunity";
import { buildQueuedContentOpportunityJobSummary } from "@/lib/contentOpportunityJobs";

const sampleOpportunity = {
  category: "SOCIAL",
  opportunityType: "QUOTE_GRAPHIC",
  title: "Faith over fear quote",
  shortDescription: "A social quote card from the sermon.",
  bodyContent: "\"Faith over fear\" with supporting caption copy.",
  sourceTranscriptExcerpt: "Faith over fear",
  relatedScripture: null,
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

function sermonSummaryOpportunity(
  overrides: Partial<ContentOpportunityRecord> = {},
): ContentOpportunityRecord {
  return {
    ...sampleOpportunity,
    category: "WRITTEN",
    opportunityType: "SERMON_SUMMARY",
    title: "Faithful through every storm",
    shortDescription: "A grounded recap of the sermon’s encouragement.",
    bodyContent: "God is faithful in every storm. The sermon calls us to trust him when the wind is strong.",
    sourceTranscriptExcerpt: "God is faithful in every storm.",
    relatedScripture: null,
    relatedMinistryMomentTitle: null,
    relatedClipTitle: null,
    suggestedPlatform: "Facebook",
    confidenceScore: 0.2,
    aiReason: "Grounded in an exact sermon phrase.",
    ...overrides,
  };
}

function generationSermonFixture() {
  return {
    id: "sermon-1",
    title: "Faith in the Storm",
    speakerName: "Pastor Test",
    churchName: "Test Church",
    language: "English",
    sermonDate: null,
    transcript: {
      id: "transcript-1",
      fullText: "Faith over fear. God is faithful in every storm. We can trust him when the wind is strong.",
    },
    transcriptSegments: [
      {
        id: "segment-1",
        startTimeSeconds: 10,
        endTimeSeconds: 14,
        text: "Faith over fear. God is faithful in every storm.",
      },
      {
        id: "segment-2",
        startTimeSeconds: 14,
        endTimeSeconds: 19,
        text: "We can trust him when the wind is strong.",
      },
    ],
    intelligence: null,
    scriptureRefs: [{
      reference: "2 Timothy 1:7",
      usageType: "QUOTED",
      isPrimary: true,
      transcriptEvidence: "Faith over fear.",
      isManuallyAdded: false,
    }],
    topicTags: [],
    structureSections: [],
    ministryMoments: [],
    clipCandidates: [],
  };
}

function qualityContextFixture() {
  const sermon = generationSermonFixture();
  return {
    id: sermon.id,
    title: sermon.title,
    speakerName: sermon.speakerName,
    churchName: sermon.churchName,
    language: sermon.language,
    sermonDate: sermon.sermonDate,
    transcriptId: sermon.transcript.id,
    transcriptFullText: sermon.transcript.fullText,
    transcriptSegments: sermon.transcriptSegments,
    intelligence: sermon.intelligence,
    scriptures: sermon.scriptureRefs,
    topics: sermon.topicTags,
    structureSections: sermon.structureSections,
    ministryMoments: sermon.ministryMoments,
    smartClips: sermon.clipCandidates,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  generationMocks.findSermon.mockResolvedValue(generationSermonFixture());
  generationMocks.findBranding.mockResolvedValue({
    churchName: "Test Church",
    primaryBrandColor: "#123456",
    secondaryBrandColor: "#abcdef",
    defaultFontFamily: "Avenir Next",
    defaultCaptionStyleName: "clean-lower",
  });
  generationMocks.findOpportunities.mockResolvedValue([]);
  generationMocks.updateMany.mockResolvedValue({ count: 0 });
  generationMocks.createMany.mockResolvedValue({ count: 0 });
  generationMocks.processingJobUpdateMany.mockResolvedValue({ count: 1 });
  generationMocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    contentOpportunity: {
      updateMany: generationMocks.updateMany,
      createMany: generationMocks.createMany,
    },
    processingJob: {
      updateMany: generationMocks.processingJobUpdateMany,
    },
  }));
});

describe("content opportunity schema", () => {
  it("accepts a valid content opportunity record", () => {
    const parsed = contentOpportunitySchema.safeParse(sampleOpportunity);
    expect(parsed.success).toBe(true);
  });

  it("normalizes human-friendly category and type formatting from the model", () => {
    const parsed = contentOpportunitySchema.parse({
      ...sampleOpportunity,
      category: "social",
      opportunityType: "quote graphic",
    });

    expect(parsed.category).toBe("SOCIAL");
    expect(parsed.opportunityType).toBe("QUOTE_GRAPHIC");
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
  it("canonicalizes only allowlisted opportunity type tokens", () => {
    expect(__contentMultiplicationTestUtils.canonicalizeOpportunityType('"SHORT_FORM_CLIP_IDEA"'))
      .toBe("SHORT_FORM_CLIP_IDEA");
    expect(__contentMultiplicationTestUtils.canonicalizeOpportunityType("ContentOpportunityType.QUOTE_GRAPHIC"))
      .toBe("QUOTE_GRAPHIC");
    expect(__contentMultiplicationTestUtils.canonicalizeOpportunityType("Content opportunity type: Quote Graphic"))
      .toBe("QUOTE_GRAPHIC");
    expect(__contentMultiplicationTestUtils.canonicalizeOpportunityType("short-form clip idea"))
      .toBe("SHORT_FORM_CLIP_IDEA");
    expect(__contentMultiplicationTestUtils.canonicalizeOpportunityType("NOT_SHORT_FORM_CLIP_IDEA"))
      .toBeNull();
  });

  it("derives category from a recognized type", () => {
    const batch = __contentMultiplicationTestUtils.parseGeneratedOpportunityPayload({
      opportunities: [
        {
          ...sampleOpportunity,
          category: "UNTRUSTED_CATEGORY",
          opportunityType: "ContentOpportunityType.SHORT_FORM_CLIP_IDEA",
        },
      ],
    });

    expect(batch.rejectedCount).toBe(0);
    expect(batch.opportunities).toHaveLength(1);
    expect(batch.opportunities[0]?.category).toBe("SOCIAL");
    expect(batch.opportunities[0]?.opportunityType).toBe("SHORT_FORM_CLIP_IDEA");
  });

  it("rejects the whole batch with bounded diagnostics when any generated record is invalid", () => {
    let message = "";
    try {
      __contentMultiplicationTestUtils.parseGeneratedOpportunityPayload({
        opportunities: Array.from({ length: 25 }, (_, index) => ({
          ...sampleOpportunity,
          category: index === 0 ? "UNKNOWN_CATEGORY" : "SOCIAL",
          opportunityType: index === 0 ? "UNKNOWN_TYPE" : "QUOTE_GRAPHIC",
        })),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("1 invalid content opportunity record(s) (25 received)");
    expect(message).toContain("no partial batch was saved");
    expect(message).toContain('Received opportunityType samples: "UNKNOWN_TYPE", "QUOTE_GRAPHIC"');
    expect(message).toContain("opportunityType:invalid_value");
    expect(message.length).toBeLessThan(700);
  });

  it("lists exact opportunity type tokens in the model prompt", () => {
    const context = {
      id: "sermon-1",
      title: "Faith in the Storm",
      speakerName: "Pastor Test",
      churchName: "Test Church",
      language: "English",
      sermonDate: null,
      transcriptFullText: "God is faithful in every storm.",
      intelligence: null,
      scriptures: [],
      topics: [],
      structureSections: [],
      ministryMoments: [],
      smartClips: [],
    };
    const quantities = __contentMultiplicationTestUtils.buildRequestedQuantities({
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 1 },
    });

    expect(__contentMultiplicationTestUtils.buildUserPrompt(context, quantities))
      .toContain("QUOTE_GRAPHIC (Quote graphic): 1");
  });

  it("uses bounded clip and ministry evidence instead of the full transcript", () => {
    const fullTranscript = `opening ${"full-transcript-only ".repeat(2_000)} closing`;
    const context = {
      id: "sermon-1",
      title: "Faith in the Storm",
      speakerName: "Pastor Test",
      churchName: "Test Church",
      language: "English",
      sermonDate: null,
      transcriptFullText: fullTranscript,
      intelligence: null,
      scriptures: [],
      topics: [],
      structureSections: [],
      ministryMoments: [{
        id: "moment-1",
        momentType: "FAITH_DECLARATION",
        title: "Stand in faith",
        description: "A declaration of trust.",
        transcriptExcerpt: "God is faithful in every storm.",
        suggestedAudience: null,
        suggestedUsage: null,
        reviewStatus: "APPROVED",
      }],
      smartClips: [{
        id: "clip-1",
        title: "Faith in the storm",
        smartClipCategory: "FAITH_DECLARATION",
        transcriptText: "We can trust God even when the wind is strong.",
      }],
    };

    const evidence = __contentMultiplicationTestUtils.buildGroundingEvidence(context);
    const prompt = __contentMultiplicationTestUtils.buildUserPrompt(
      context,
      __contentMultiplicationTestUtils.buildRequestedQuantities({ targetType: "QUOTE_GRAPHIC" }),
    );

    expect(evidence).toContain("God is faithful in every storm.");
    expect(evidence).toContain("We can trust God even when the wind is strong.");
    expect(prompt).not.toContain("full-transcript-only");
    expect(prompt.length).toBeLessThan(fullTranscript.length / 10);
  });

  it("adds only stored, grounded, reviewed ministry voice facts to the prompt", () => {
    const context = {
      ...qualityContextFixture(),
      branding: {
        churchName: "Grace House Church",
        primaryBrandColor: "#112233",
        secondaryBrandColor: "#445566",
        defaultFontFamily: "Avenir Next",
        defaultCaptionStyleName: "clean-lower",
      },
      intelligence: {
        generatedTitle: "Unreviewed generated title",
        summary: "Unreviewed generated summary",
        centralTheme: "Invented prosperity promise",
        shortOverview: "Unreviewed overview",
        keyTakeaways: ["Unreviewed takeaway"],
        isManuallyReviewed: false,
        manualTitle: "Unreviewed manual title",
        manualSummary: "Unreviewed manual summary",
        manualCentralTheme: "Unreviewed manual theology",
      },
      topics: [
        { topic: "Enduring hope", confidenceScore: 0.8, evidence: "God is faithful in every storm.", isManuallyAdded: false },
        { topic: "Invented wealth", confidenceScore: 0.99, evidence: null, isManuallyAdded: false },
      ],
      scriptures: [
        ...qualityContextFixture().scriptures,
        { reference: "Malachi 3:10", usageType: "MENTIONED", isPrimary: false, transcriptEvidence: null, isManuallyAdded: false },
      ],
      ministryMoments: [
        {
          id: "moment-approved",
          momentType: "FAITH_DECLARATION",
          title: "Reviewed declaration",
          description: "A reviewed moment.",
          transcriptExcerpt: "God is faithful in every storm.",
          suggestedAudience: "People facing pressure",
          suggestedUsage: null,
          reviewStatus: "APPROVED",
        },
        {
          id: "moment-pending",
          momentType: "TEACHING_POINT",
          title: "Unreviewed invented audience claim",
          description: "Unreviewed moment.",
          transcriptExcerpt: "Faith over fear.",
          suggestedAudience: "Executives",
          suggestedUsage: null,
          reviewStatus: "PENDING",
        },
      ],
    };
    const voiceProfile = __contentMultiplicationTestUtils.deriveGenerationVoiceProfile(context);
    const prompt = __contentMultiplicationTestUtils.buildUserPrompt(
      context,
      __contentMultiplicationTestUtils.buildRequestedQuantities({
        replaceDefaultQuantities: true,
        quantities: { SERMON_SUMMARY: 1 },
      }),
      { voiceProfile },
    );

    expect(prompt).toContain("Church: Grace House Church");
    expect(prompt).toContain("TOPIC: Enduring hope");
    expect(prompt).toContain("MINISTRY_MOMENT: Reviewed declaration");
    expect(prompt).toContain("Do not infer a denomination");
    expect(prompt).not.toContain("Invented prosperity promise");
    expect(prompt).not.toContain("Invented wealth");
    expect(prompt).not.toContain("Malachi 3:10");
    expect(prompt).not.toContain("Unreviewed invented audience claim");
  });

  it("splits large requests into small single-family model batches without losing quantities", () => {
    const requested = __contentMultiplicationTestUtils.buildRequestedQuantities({
      replaceDefaultQuantities: true,
      quantities: {
        QUOTE_GRAPHIC: 8,
        SCRIPTURE_GRAPHIC: 2,
        SERMON_SUMMARY: 4,
        DISCUSSION_QUESTIONS: 4,
      },
    });
    const batches = __contentMultiplicationTestUtils.buildFamilyCoherentGenerationBatches(requested);

    expect(batches.length).toBeGreaterThan(3);
    for (const batch of batches) {
      const size = Object.values(batch.quantities).reduce((sum, quantity) => sum + quantity, 0);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(6);
      expect(__contentMultiplicationTestUtils.requestedContentFamily(batch.quantities)).toBe(batch.family);
    }
    const totals = batches.reduce((acc, batch) => {
      for (const [type, quantity] of Object.entries(batch.quantities)) {
        acc[type] = (acc[type] ?? 0) + quantity;
      }
      return acc;
    }, {} as Record<string, number>);
    expect(totals).toMatchObject({
      QUOTE_GRAPHIC: 8,
      SCRIPTURE_GRAPHIC: 2,
      SERMON_SUMMARY: 4,
      DISCUSSION_QUESTIONS: 4,
    });
  });

  it("builds requested quantities with targeted type", () => {
    const requested = __contentMultiplicationTestUtils.buildRequestedQuantities({
      targetType: "SERMON_SUMMARY",
      quantities: { SERMON_SUMMARY: 2 },
    });

    expect(requested.SERMON_SUMMARY).toBe(2);
    expect(requested.QUOTE_GRAPHIC).toBe(0);
  });

  it("replaces defaults for a coordinated content pack", () => {
    const requested = __contentMultiplicationTestUtils.buildRequestedQuantities({
      replaceDefaultQuantities: true,
      quantities: { PLATFORM_CAPTION_PACK: 1, ENGAGEMENT_STORY_SET: 1 },
    });

    expect(requested.PLATFORM_CAPTION_PACK).toBe(1);
    expect(requested.ENGAGEMENT_STORY_SET).toBe(1);
    expect(requested.QUOTE_GRAPHIC).toBe(0);
    expect(requested.SERMON_SUMMARY).toBe(0);
  });

  it("scopes archive queries to the types regenerated by a pack", () => {
    expect(__contentMultiplicationTestUtils.buildArchiveWhere(
      "sermon-1",
      undefined,
      ["PLATFORM_CAPTION_PACK", "ENGAGEMENT_STORY_SET"],
    )).toMatchObject({
      sermonId: "sermon-1",
      opportunityType: { in: ["PLATFORM_CAPTION_PACK", "ENGAGEMENT_STORY_SET"] },
    });
  });

  it("curates generated output by requested quantity and dedupes", () => {
    const generated = [
      sampleOpportunity,
      { ...sampleOpportunity },
      {
        ...sampleOpportunity,
        title: "Second quote card",
        bodyContent: "\"We can trust him when the wind is strong.\"",
        sourceTranscriptExcerpt: "We can trust him when the wind is strong.",
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

  it("rejects a model-supplied quote excerpt when the quote is not in the stored transcript", () => {
    const batch = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [{
        ...sampleOpportunity,
        bodyContent: "\"We will own tomorrow\"",
        sourceTranscriptExcerpt: "We will own tomorrow",
      }],
      { QUOTE_GRAPHIC: 1 },
      { context: qualityContextFixture() },
    );

    expect(batch.opportunities).toHaveLength(0);
    expect(batch.rejectionCounts.QUOTE_GRAPHIC).toMatchObject({
      QUOTE_EVIDENCE_MISMATCH: 1,
    });
  });

  it("attaches exact transcript segment provenance to a verified quote", () => {
    const now = new Date("2026-07-22T10:00:00.000Z");
    const batch = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [sampleOpportunity],
      { QUOTE_GRAPHIC: 1 },
      { context: qualityContextFixture(), now },
    );

    expect(batch.opportunities).toHaveLength(1);
    expect(batch.opportunities[0]).toMatchObject({
      sourceTranscriptExcerpt: "Faith over fear",
      sourceTranscriptSegmentIds: ["segment-1"],
      sourceStartTimeSeconds: 10,
      sourceEndTimeSeconds: 14,
    });
    const structuredContent = batch.opportunities[0]?.structuredContentJson as {
      family: string;
      sourceEvidence: unknown[];
      legacyConversion: unknown;
    };
    expect(structuredContent).toMatchObject({
      family: "QUOTE_GRAPHIC",
      legacyConversion: {
        origin: "LEGACY_BODY_CONTENT",
        requiresReview: true,
      },
    });
    expect(structuredContent.sourceEvidence[0]).toMatchObject({
      kind: "TRANSCRIPT_SPAN",
      transcriptId: "transcript-1",
      segmentIds: ["segment-1"],
      startMs: 10_000,
      endMs: 14_000,
      verification: {
        status: "VERIFIED",
        method: "TRANSCRIPT_MATCH",
        verifiedBy: "system:content-integrity",
      },
    });
  });

  it("dedupes normalized near-identical candidates against active opportunities", () => {
    const batch = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [sampleOpportunity],
      { QUOTE_GRAPHIC: 1 },
      {
        context: qualityContextFixture(),
        dedupeAgainst: [{
          opportunityType: "QUOTE_GRAPHIC",
          title: "Faith over fear — graphic card",
          bodyContent: "Faith over fear",
        }],
      },
    );

    expect(batch.opportunities).toHaveLength(0);
    expect(batch.rejectionCounts.QUOTE_GRAPHIC).toMatchObject({ DUPLICATE: 1 });
  });

  it("uses typed-contract repetition to dedupe semantically across opportunity types", () => {
    const batch = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [sermonSummaryOpportunity()],
      { SERMON_SUMMARY: 1 },
      {
        context: qualityContextFixture(),
        dedupeAgainst: [{
          id: "existing-caption",
          opportunityType: "CAPTION",
          title: "Faithful through every storm",
          bodyContent: "A caption about God remaining faithful in the storm.",
        }],
      },
    );

    expect(batch.opportunities).toHaveLength(0);
    expect(batch.rejectionCounts.SERMON_SUMMARY).toMatchObject({ DUPLICATE: 1 });
    expect(batch.repairFeedback[0]).toMatchObject({
      opportunityType: "SERMON_SUMMARY",
      reasonCode: "DUPLICATE",
    });
    expect(batch.repairFeedback[0]?.critique.join(" ")).toContain("existing-caption");
  });

  it("rejects a deterministic low-quality candidate regardless of model confidence", () => {
    const batch = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [sermonSummaryOpportunity({
        opportunityType: "DISCUSSION_QUESTIONS",
        title: "STOP SCROLLING NOW!!!",
        bodyContent: "Stop scrolling now!!!",
        shortDescription: "Generic engagement bait.",
        sourceTranscriptExcerpt: null,
        suggestedPlatform: null,
        confidenceScore: 0.999,
      })],
      { DISCUSSION_QUESTIONS: 1 },
      { context: qualityContextFixture() },
    );

    expect(batch.opportunities).toHaveLength(0);
    expect(batch.rejectionCounts.DISCUSSION_QUESTIONS).toMatchObject({
      EDITORIAL_QUALITY_LOW: 1,
    });
    expect(batch.repairFeedback[0]?.critique.join(" ")).toContain("GENERIC_HOOK");
    expect(batch.repairFeedback[0]?.critique.join(" ")).not.toContain("0.999");
  });

  it("rejects Scripture graphics until grounded verse wording and translation are verified", () => {
    const now = new Date("2026-07-22T10:00:00.000Z");
    const grounded = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [{
        ...sampleOpportunity,
        opportunityType: "SCRIPTURE_GRAPHIC" as const,
        title: "Spirit of power",
        bodyContent: "God gives power, love, and self-control.",
        sourceTranscriptExcerpt: null,
        relatedScripture: "2 Timothy 1:7 (NIV)",
      }],
      { SCRIPTURE_GRAPHIC: 1 },
      { context: qualityContextFixture(), now },
    );
    const ungrounded = __contentMultiplicationTestUtils.curateGeneratedOpportunityBatch(
      [{
        ...sampleOpportunity,
        opportunityType: "SCRIPTURE_GRAPHIC" as const,
        title: "A different verse",
        bodyContent: "A different Scripture graphic.",
        sourceTranscriptExcerpt: null,
        relatedScripture: "John 3:16 (NIV)",
      }],
      { SCRIPTURE_GRAPHIC: 1 },
      { context: qualityContextFixture(), now },
    );

    expect(grounded.opportunities).toHaveLength(0);
    expect(grounded.rejectionCounts.SCRIPTURE_GRAPHIC).toMatchObject({
      EDITORIAL_BLOCKER: 1,
    });
    expect(grounded.repairFeedback[0]?.critique.join(" ")).toContain("Scripture graphic");
    expect(grounded.repairFeedback[0]?.repairInstructions.join(" ")).toContain("exact verse wording");
    expect(ungrounded.opportunities).toHaveLength(0);
    expect(ungrounded.rejectionCounts.SCRIPTURE_GRAPHIC).toMatchObject({
      SCRIPTURE_EVIDENCE_INVALID: 1,
    });
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

describe("content opportunity generation quality loop", () => {
  it("repairs missing per-type quantities and persists the complete validated batch", async () => {
    const payloads = [
      { opportunities: [sampleOpportunity] },
      {
        opportunities: [{
          ...sampleOpportunity,
          title: "Trust through strong winds",
          bodyContent: "\"We can trust him when the wind is strong.\"",
          sourceTranscriptExcerpt: "We can trust him when the wind is strong.",
        }],
      },
    ];
    generationMocks.chatCompletion.mockImplementation(async (request: {
      validateResponse: (completion: unknown) => Promise<unknown>;
    }) => request.validateResponse({
      choices: [{ message: { content: JSON.stringify(payloads.shift() ?? { opportunities: [] }) } }],
    }));

    const result = await generateContentOpportunities("sermon-1", {
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 2 },
    });

    expect(generationMocks.chatCompletion).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      opportunityCount: 2,
      complete: true,
      repairPasses: 1,
      shortfalls: [],
    });
    expect(result.generatedQuantities.QUOTE_GRAPHIC).toBe(2);
    expect(generationMocks.createMany).toHaveBeenCalledTimes(1);
    const createInput = generationMocks.createMany.mock.calls[0]?.[0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(createInput.data).toHaveLength(2);
    expect(createInput.data.every((item) => Boolean(item.structuredContentJson))).toBe(true);
    expect(createInput.data.map((item) => item.sourceTranscriptSegmentIds)).toEqual([
      ["segment-1"],
      ["segment-2"],
    ]);
  });

  it("feeds deterministic blocker codes and repair instructions into the bounded repair prompt", async () => {
    const payloads = [
      {
        opportunities: [sermonSummaryOpportunity({
          bodyContent: "God is [insert a promise here] in every storm.",
        })],
      },
      { opportunities: [sermonSummaryOpportunity()] },
    ];
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    generationMocks.chatCompletion.mockImplementation(async (request: {
      messages: Array<{ role: string; content: string }>;
      validateResponse: (completion: unknown) => Promise<unknown>;
    }) => {
      requests.push(request);
      return request.validateResponse({
        choices: [{ message: { content: JSON.stringify(payloads.shift() ?? { opportunities: [] }) } }],
      });
    });

    const result = await generateContentOpportunities("sermon-1", {
      replaceDefaultQuantities: true,
      quantities: { SERMON_SUMMARY: 1 },
    });

    expect(result).toMatchObject({ complete: true, repairPasses: 1, opportunityCount: 1 });
    const repairPrompt = requests[1]?.messages.find((message) => message.role === "user")?.content ?? "";
    expect(repairPrompt).toContain("Quality repair pass 1");
    expect(repairPrompt).toContain("[EDITORIAL_BLOCKER]");
    expect(repairPrompt).toContain("PUBLISHABLE_PLACEHOLDER");
    expect(repairPrompt).toContain("Replace every placeholder with confirmed information");
  });

  it("isolates a repeatedly bad family while persisting other valid families and reporting truthfully", async () => {
    const progress: Array<{ phase: string; percent: number }> = [];
    generationMocks.chatCompletion.mockImplementation(async (request: {
      metadata: { contentFamily: string };
      validateResponse: (completion: unknown) => Promise<unknown>;
    }) => {
      const opportunity = request.metadata.contentFamily === "QUOTE_GRAPHIC"
        ? {
            ...sampleOpportunity,
            title: "Words not preached",
            bodyContent: "\"A future no one can stop\"",
            sourceTranscriptExcerpt: "A future no one can stop",
          }
        : sermonSummaryOpportunity();
      return request.validateResponse({
        choices: [{ message: { content: JSON.stringify({ opportunities: [opportunity] }) } }],
      });
    });

    const result = await generateContentOpportunities("sermon-1", {
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 1, SERMON_SUMMARY: 1 },
      onProgress: async (update) => {
        progress.push(update);
      },
    });

    expect(generationMocks.chatCompletion).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      opportunityCount: 1,
      complete: false,
      repairPasses: 2,
      shortfalls: [{
        opportunityType: "QUOTE_GRAPHIC",
        requested: 1,
        fulfilled: 0,
        missing: 1,
      }],
    });
    expect(result.generatedQuantities).toMatchObject({ QUOTE_GRAPHIC: 0, SERMON_SUMMARY: 1 });
    expect(result.shortfalls[0]?.reasons).toEqual(expect.arrayContaining([
      { code: "QUOTE_EVIDENCE_MISMATCH", count: 3 },
      { code: "MODEL_OUTPUT_SHORTFALL", count: 1 },
    ]));
    const persisted = generationMocks.createMany.mock.calls[0]?.[0] as {
      data: Array<{ opportunityType: string }>;
    };
    expect(persisted.data.map((item) => item.opportunityType)).toEqual(["SERMON_SUMMARY"]);
    expect(progress.map((item) => item.percent)).toEqual(
      [...progress.map((item) => item.percent)].sort((left, right) => left - right),
    );
    const repairStartedAt = progress.findIndex((item) => item.phase === "REPAIRING");
    expect(repairStartedAt).toBeGreaterThanOrEqual(0);
    expect(progress.slice(repairStartedAt).some((item) => item.phase === "GENERATING")).toBe(false);
  });

  it("stops after two repair passes and returns a truthful typed shortfall", async () => {
    generationMocks.chatCompletion.mockImplementation(async (request: {
      validateResponse: (completion: unknown) => Promise<unknown>;
    }) => request.validateResponse({
      choices: [{ message: { content: JSON.stringify({ opportunities: [] }) } }],
    }));

    const result = await generateContentOpportunities("sermon-1", {
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 2 },
    });

    expect(generationMocks.chatCompletion).toHaveBeenCalledTimes(3);
    expect(generationMocks.transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      opportunityCount: 0,
      complete: false,
      repairPasses: 2,
      shortfalls: [{
        opportunityType: "QUOTE_GRAPHIC",
        requested: 2,
        fulfilled: 0,
        missing: 2,
        reasons: [{ code: "MODEL_OUTPUT_SHORTFALL", count: 2 }],
      }],
    });
  });

  it("commits generated rows and the completed job checkpoint in one transaction", async () => {
    generationMocks.chatCompletion.mockImplementation(async (request: {
      validateResponse: (completion: unknown) => Promise<unknown>;
    }) => request.validateResponse({
      choices: [{ message: { content: JSON.stringify({ opportunities: [sampleOpportunity] }) } }],
    }));
    const summary = buildQueuedContentOpportunityJobSummary({
      mode: "CONTENT_PACK",
      quantities: { QUOTE_GRAPHIC: 1 },
      replaceDefaultQuantities: true,
    });

    await generateContentOpportunities("sermon-1", {
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 1 },
      processingJob: { id: "job-1", summary },
    });

    expect(generationMocks.transaction).toHaveBeenCalledTimes(1);
    expect(generationMocks.createMany).toHaveBeenCalledTimes(1);
    expect(generationMocks.processingJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "job-1",
        sermonId: "sermon-1",
        type: "GENERATE_CONTENT_OPPORTUNITIES",
        status: "RUNNING",
      }),
      data: {
        generationSummary: expect.objectContaining({
          progress: expect.objectContaining({ stage: "COMPLETED", percent: 100 }),
          result: expect.objectContaining({ complete: true, opportunityCount: 1 }),
        }),
      },
    }));
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
