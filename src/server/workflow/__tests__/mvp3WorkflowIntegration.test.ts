import { describe, expect, it } from "vitest";

import { __contentMultiplicationTestUtils } from "@/server/agents/contentMultiplicationService";
import { __clipIntelligenceTestUtils, enrichCandidate } from "@/server/agents/clipIntelligenceAgent";
import { __ministryMomentTestUtils } from "@/server/agents/ministryMomentService";
import type { MinistryMomentRecord } from "@/server/ai/ministryMomentSchema";

describe("MVP3 sermon intelligence workflow integration", () => {
  it("keeps persisted intelligence/moments/clips/content connected and protects approved or edited records on regeneration", () => {
    const sermon = {
      id: "sermon-1",
      title: "Faith That Acts",
      speakerName: "Pastor Grace",
      churchName: "Grace Community",
      language: "English",
      transcriptFullText: "Church, let us pray together and step out in faith.",
      intelligence: {
        generatedTitle: "Faith That Acts",
        summary: "A call to practical faith.",
        centralTheme: "Faith expressed through action.",
        shortOverview: "Pastoral call to prayer and obedience.",
      },
    };

    const momentRecord = {
      id: "moment-1",
      momentType: "PRAYER_MOMENT",
      title: "Prayer invitation",
      description: "Pastor invites the church to pray.",
      startTimeSeconds: 10,
      endTimeSeconds: 45,
      confidenceScore: 0.92,
      transcriptExcerpt: "let us pray together",
      whyDetected: "Direct invitation to corporate prayer.",
      suggestedAudience: "Entire congregation",
      suggestedUsage: "Short prayer encouragement clip",
      clipCategory: "Best Prayer Clip",
    } satisfies MinistryMomentRecord & { id: string };

    const createMomentInput = __ministryMomentTestUtils.buildMinistryMomentCreateInput(
      sermon.id,
      sermon.transcriptFullText,
      momentRecord,
    );

    expect(createMomentInput.sermonId).toBe(sermon.id);
    expect(createMomentInput.transcriptExcerpt).toBe(momentRecord.transcriptExcerpt);
    expect(createMomentInput).not.toHaveProperty("transcriptStartOffset");
    expect(createMomentInput).not.toHaveProperty("transcriptEndOffset");

    const clipCandidate = {
      startTimeSeconds: 10,
      endTimeSeconds: 45,
      durationSeconds: 35,
      transcriptText: "let us pray together",
      title: "Prayer invitation",
      hook: "Pause and pray with us.",
      caption: "Prayer changes direction.",
      suggestedHook: "Pause and pray with us.",
      suggestedCaption: "Prayer changes direction.",
      hashtags: ["#Prayer", "#Faith"],
      score: 9.2,
      reasonSelected: "Strong prayer moment with clear ministry value.",
      landingSentence: "let us pray together",
      clipType: "pastoral",
      smartClipCategory: "Best Prayer Clip",
      intendedAudience: "Entire congregation",
      ministryValue: "Encourages prayer.",
      socialValue: "Short-form devotional.",
      ministryMomentType: "PRAYER_MOMENT",
      ministryMomentTitle: "Prayer invitation",
      riskLevel: "LOW",
      riskReasons: [],
      contextWarning: false,
      arcType: "ALTAR_CALL_INVITATION",
      arcSummary: "Prayer setup, invitation, and response.",
      setupStartTime: 10,
      mainPointTime: 20,
      payoffTime: 38,
      applicationTime: 42,
      whyThisClipFeelsComplete: "It includes the prayer invitation and response.",
      whatContextMightBeMissing: null,
      originalStartTimeSeconds: 9,
      originalEndTimeSeconds: 47,
      adjustedStartTimeSeconds: 10,
      adjustedEndTimeSeconds: 45,
      boundaryAdjustmentReason: "Trimmed to clean prayer boundary.",
      boundaryQuality: "GOOD",
    } satisfies Parameters<typeof enrichCandidate>[0];

    const enrichedClip = enrichCandidate(clipCandidate, [momentRecord]);
    expect(enrichedClip.ministryMomentId).toBe(momentRecord.id);
    expect(enrichedClip.smartClipCategory).toBe("Best Prayer Clip");

    const generatedOpportunities = [
      {
        category: "SOCIAL",
        opportunityType: "QUOTE_GRAPHIC",
        title: "Pray and Believe",
        shortDescription: "Quote from the prayer moment.",
        bodyContent: "Pray and believe.",
        sourceTranscriptExcerpt: "let us pray together",
        relatedScripture: "Mark 11:24",
        relatedMinistryMomentTitle: "Prayer invitation",
        relatedClipTitle: "Prayer invitation",
        suggestedPlatform: "Instagram",
        confidenceScore: 0.9,
        aiReason: "Directly grounded in a detected ministry moment and clip.",
      },
    ] satisfies Parameters<typeof __contentMultiplicationTestUtils.curateGeneratedOpportunities>[0];

    const curated = __contentMultiplicationTestUtils.curateGeneratedOpportunities(generatedOpportunities, {
      SHORT_FORM_CLIP_IDEA: 0,
      QUOTE_GRAPHIC: 1,
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

    expect(curated).toHaveLength(1);
    expect(curated[0]?.category).toBe("SOCIAL");
    expect(curated[0]?.relatedMinistryMomentTitle).toBe(momentRecord.title);
    expect(curated[0]?.relatedClipTitle).toBe(enrichedClip.title);

    // Regeneration safety checks: approved/edited opportunities and non-suggested clips are preserved.
    expect(
      __contentMultiplicationTestUtils.shouldPreserveOpportunityDuringRegeneration({
        status: "APPROVED",
        isManuallyEdited: false,
        isManuallyCreated: false,
        editedContent: null,
        approvedContent: "Approved by pastor",
      }),
    ).toBe(true);

    expect(
      __contentMultiplicationTestUtils.shouldPreserveOpportunityDuringRegeneration({
        status: "NEEDS_REVIEW",
        isManuallyEdited: true,
        isManuallyCreated: false,
        editedContent: "Edited draft",
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

    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "APPROVED" })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "EXPORTED" })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "SUGGESTED", isManuallyEdited: true })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "SUGGESTED", isManuallyEdited: false })).toBe(false);
  });
});
