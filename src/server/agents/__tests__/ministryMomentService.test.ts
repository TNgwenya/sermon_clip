import { describe, expect, it } from "vitest";

import {
  clipJsonCandidateSchema,
} from "@/server/ai/clipJsonSchema";
import {
  type MinistryMomentRecord,
  ministryMomentResponseSchema,
  ministryMomentSchema,
} from "@/server/ai/ministryMomentSchema";
import {
  enrichCandidate,
  matchMinistryMoment,
  __clipIntelligenceTestUtils,
} from "@/server/agents/clipIntelligenceAgent";
import { __ministryMomentTestUtils } from "@/server/agents/ministryMomentService";

const validMoment: MinistryMomentRecord = {
  momentType: "PRAYER_MOMENT",
  title: "Prayer over the congregation",
  description: "The pastor leads the room in prayer.",
  startTimeSeconds: 120,
  endTimeSeconds: 180,
  confidenceScore: 0.94,
  transcriptExcerpt: "Let's pray together",
  whyDetected: "The sermon explicitly transitions into prayer.",
  suggestedAudience: "People needing prayer",
  suggestedUsage: "Use as a prayer encouragement clip.",
  clipCategory: "Best Prayer Clip",
};

const validCandidate = {
  startTimeSeconds: 120,
  endTimeSeconds: 180,
  durationSeconds: 60,
  transcriptText: "Let's pray together.",
  title: "Prayer over the congregation",
  hook: "Join us in this moment of prayer.",
  caption: "Prayer changes everything.",
  suggestedHook: "Join us in this moment of prayer.",
  suggestedCaption: "Prayer changes everything.",
  hashtags: ["#Prayer"],
  score: 9,
  reasonSelected: "This clip is a direct prayer moment with strong ministry value.",
  landingSentence: "Let's pray together.",
  clipType: "pastoral",
  smartClipCategory: "Best Prayer Clip",
  intendedAudience: "People needing prayer",
  ministryValue: "Encourages prayer and dependence on God.",
  socialValue: "Strong short-form devotional value.",
  ministryMomentType: "PRAYER_MOMENT",
  ministryMomentTitle: "Prayer over the congregation",
  riskLevel: "LOW",
  riskReasons: [],
  contextWarning: false,
  languageHints: {
    detectedLanguage: "English + Zulu",
    mixedLanguage: true,
    translatedFrom: "Zulu",
    originalPhrase: "Nkulunkulu unathi",
    englishMeaning: "God is with us",
    translationConfidence: 0.82,
    translationUncertaintyNote: null,
  },
  captionPackage: {
    primaryCaption: "Prayer changes everything.",
    shortCaption: "Prayer changes everything.",
    platformCaption: "Join this prayer moment. Prayer changes everything.",
    optionalHashtags: ["#Prayer", "#Faith"],
    captionQualityScore: 8.4,
    captionReason: "Faithful to the transcript and easy to understand.",
    captionWarnings: [],
  },
  socialPotential: {
    ministryValueScore: 8.8,
    socialMediaPotentialScore: 8.2,
    hookStrength: 7.8,
    clarityScore: 8.5,
    emotionalImpactScore: 8.1,
    shareabilityScore: 7.9,
    standaloneUsefulnessScore: 8.7,
    whyMayPerformWell: "Clear prayer invitation with direct encouragement.",
    whyMayNotPerformWell: "May need brief context text for viewers joining late.",
    recommendedPlatforms: ["Instagram Reels", "YouTube Shorts"],
  },
  selectionReasoning: {
    clipSummary: "Pastor invites the church to pray with expectation.",
    whySelected: "Strong ministry moment with immediate practical application.",
    usefulForAudience: "People needing encouragement and prayer.",
    ministryCategory: "Best Prayer Clip",
    shortFormSuitability: "Complete thought with a clear opening and close.",
    needsCaptionOrContextSupport: false,
    captionOrContextSupportReason: "Helpful for accessibility but not required for understanding.",
  },
};

describe("ministry moment schema", () => {
  it("accepts a valid ministry moment", () => {
    const result = ministryMomentSchema.safeParse(validMoment);
    expect(result.success).toBe(true);
  });

  it("rejects a ministry moment without excerpt", () => {
    const result = ministryMomentSchema.safeParse({
      ...validMoment,
      transcriptExcerpt: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a ministry moment response payload", () => {
    const result = ministryMomentResponseSchema.safeParse({ moments: [validMoment] });
    expect(result.success).toBe(true);
  });

  it("normalizes common AI enum variants before validating ministry moments", () => {
    const normalized = __ministryMomentTestUtils.normalizeMinistryMomentResponsePayload({
      moments: [
        {
          ...validMoment,
          momentType: "Application Moment",
          clipCategory: "Best Application Clip",
        },
        {
          ...validMoment,
          momentType: "SCRIPTURE_EXPLANATION_MOMENT",
          clipCategory: "Best Worship Clip",
        },
        {
          ...validMoment,
          momentType: "Wisdom Declaration",
          clipCategory: "Best Wisdom Clip",
        },
      ],
    });

    expect(ministryMomentResponseSchema.parse(normalized).moments).toMatchObject([
      {
        momentType: "CALL_TO_ACTION",
        clipCategory: "Best Call To Action Clip",
      },
      {
        momentType: "OTHER",
        clipCategory: "Best Faith Clip",
      },
      {
        momentType: "OTHER",
        clipCategory: null,
      },
    ]);
  });
});

describe("clip recommendation schema", () => {
  it("accepts ministry-aware clip metadata", () => {
    const result = clipJsonCandidateSchema.safeParse(validCandidate);
    expect(result.success).toBe(true);
  });

  it("accepts clip metadata when translation-specific fields are missing", () => {
    const result = clipJsonCandidateSchema.safeParse({
      ...validCandidate,
      languageHints: {
        detectedLanguage: "English",
      },
    });

    expect(result.success).toBe(true);
  });

  it("requires valid social potential score ranges", () => {
    const result = clipJsonCandidateSchema.safeParse({
      ...validCandidate,
      socialPotential: {
        ...validCandidate.socialPotential,
        socialMediaPotentialScore: 11,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing smart clip category", () => {
    const candidate = {
      ...validCandidate,
      smartClipCategory: undefined,
    };
    const result = clipJsonCandidateSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });
});

describe("ministry-aware clip mapping", () => {
  it("matches a clip to a ministry moment by category", () => {
    const moment = { ...validMoment, clipCategory: validMoment.clipCategory ?? null, id: "moment-1" };
    const candidate = clipJsonCandidateSchema.parse(validCandidate);

    const matched = matchMinistryMoment(candidate, [moment]);
    expect(matched?.id).toBe("moment-1");
  });

  it("prefers the timestamp and evidence match when multiple moments share a category", () => {
    const earlyMoment = {
      ...validMoment,
      id: "early-prayer",
      title: "Opening prayer",
      description: "The pastor opens the service in prayer.",
      startTimeSeconds: 20,
      endTimeSeconds: 80,
      transcriptExcerpt: "Lord bless this service",
      confidenceScore: 0.96,
      clipCategory: "Best Prayer Clip" as const,
    };
    const laterMoment = {
      ...validMoment,
      id: "altar-prayer",
      title: "Prayer for weary hearts",
      description: "The pastor prays for people who feel tired and need strength.",
      startTimeSeconds: 900,
      endTimeSeconds: 970,
      transcriptExcerpt: "If your heart feels tired, God gives strength in prayer",
      confidenceScore: 0.91,
      clipCategory: "Best Prayer Clip" as const,
    };
    const candidate = clipJsonCandidateSchema.parse({
      ...validCandidate,
      startTimeSeconds: 912,
      endTimeSeconds: 962,
      durationSeconds: 50,
      transcriptText: "If your heart feels tired, God gives strength in prayer.",
      title: "Prayer for Weary Hearts",
      reasonSelected: "The pastor prays for tired people to receive strength.",
      landingSentence: "If your heart feels tired, God gives strength in prayer.",
    });

    const matched = matchMinistryMoment(candidate, [earlyMoment, laterMoment]);

    expect(matched?.id).toBe("altar-prayer");
  });

  it("does not attach a clip to an unrelated low-evidence ministry moment", () => {
    const unrelatedMoment = {
      ...validMoment,
      id: "unrelated",
      momentType: "LEADERSHIP_MOMENT" as const,
      clipCategory: "Best Leadership Clip" as const,
      title: "Leadership through service",
      description: "The pastor teaches leaders to serve with humility.",
      startTimeSeconds: 10,
      endTimeSeconds: 50,
      transcriptExcerpt: "Leadership requires humility and service",
      confidenceScore: 0.55,
      whyDetected: "The excerpt is about leadership.",
      suggestedAudience: "Church leaders",
      suggestedUsage: "Use as a leadership training clip.",
    };
    const candidate = clipJsonCandidateSchema.parse(validCandidate);

    const matched = matchMinistryMoment(candidate, [unrelatedMoment]);

    expect(matched).toBeNull();
  });

  it("enriches a boundary-adjusted candidate with the related ministry moment id", () => {
    const moment = { ...validMoment, clipCategory: validMoment.clipCategory ?? null, id: "moment-1" };
    const candidate = clipJsonCandidateSchema.parse(validCandidate);

    const enriched = enrichCandidate({
      ...candidate,
      originalStartTimeSeconds: 118,
      originalEndTimeSeconds: 182,
      adjustedStartTimeSeconds: 120,
      adjustedEndTimeSeconds: 180,
      boundaryAdjustmentReason: "Trimmed to prayer section",
      boundaryQuality: "GOOD",
    }, [moment]);

    expect(enriched.ministryMomentId).toBe("moment-1");
    expect(enriched.smartClipCategory).toBe("Best Prayer Clip");
    expect(enriched.recommendationConfidence).toBe(validMoment.confidenceScore);
  });

  it("preserves approved clips during regeneration", () => {
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "APPROVED" })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "SUGGESTED", isManuallyEdited: true })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({ status: "SUGGESTED", isManuallyEdited: false })).toBe(false);
  });

  it("preserves manually edited suggested clips so pastor-edited captions are not overwritten", () => {
    const preserve = __clipIntelligenceTestUtils.shouldPreserveClipDuringRegeneration({
      status: "SUGGESTED",
      isManuallyEdited: true,
    });

    expect(preserve).toBe(true);
  });

  it("reuses existing suggestions only when force is false", () => {
    expect(__clipIntelligenceTestUtils.shouldReuseExistingSuggestions(20, false, { minReviewSuggestions: 20 })).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldReuseExistingSuggestions(2, false, { minReviewSuggestions: 20 })).toBe(false);
    expect(__clipIntelligenceTestUtils.shouldReuseExistingSuggestions(2, false, null)).toBe(true);
    expect(__clipIntelligenceTestUtils.shouldReuseExistingSuggestions(20, true, { minReviewSuggestions: 20 })).toBe(false);
    expect(__clipIntelligenceTestUtils.shouldReuseExistingSuggestions(0, false)).toBe(false);
  });

  it("builds category-scoped delete filter for targeted regeneration", () => {
    const scoped = __clipIntelligenceTestUtils.buildSuggestionDeleteWhere("sermon-1", "Best Prayer Clip");
    expect(scoped).toMatchObject({
      sermonId: "sermon-1",
      status: "SUGGESTED",
      isAiGenerated: true,
      isManuallyEdited: false,
      smartClipCategory: "Best Prayer Clip",
    });

    const unscoped = __clipIntelligenceTestUtils.buildSuggestionDeleteWhere("sermon-1");
    expect(unscoped).not.toHaveProperty("smartClipCategory");
  });
});

describe("ministry moment persistence mapping", () => {
  it("maps ministry moment fields to the Prisma create payload", () => {
    const transcript = "Welcome church. Let's pray together in this holy moment. Amen.";
    const payload = __ministryMomentTestUtils.buildMinistryMomentCreateInput("sermon-1", transcript, validMoment);

    expect(payload.transcriptExcerpt).toBe(validMoment.transcriptExcerpt);
    expect(payload.startTimeSeconds).toBe(validMoment.startTimeSeconds);
    expect(payload.endTimeSeconds).toBe(validMoment.endTimeSeconds);
    expect(payload).not.toHaveProperty("transcriptStartOffset");
    expect(payload).not.toHaveProperty("transcriptEndOffset");
  });

  it("reuses existing ministry moments when force is disabled", () => {
    expect(__ministryMomentTestUtils.shouldReuseExistingMoments(1, false)).toBe(true);
    expect(__ministryMomentTestUtils.shouldReuseExistingMoments(1, true)).toBe(false);
    expect(__ministryMomentTestUtils.shouldReuseExistingMoments(0, false)).toBe(false);
  });
});
