import { describe, expect, it } from "vitest";

import { __clipIntelligenceTestUtils } from "@/server/agents/clipIntelligenceAgent";

describe("clip intelligence generation summary", () => {
  function reusableGroundingSnapshot(score = 0.92, orderedFlowRatio = 0.95) {
    return {
      transcriptGrounding: {
        score,
        orderedFlowRatio,
      },
    };
  }

  it("builds structured generation counts and top clip ids", () => {
    const summary = __clipIntelligenceTestUtils.buildStructuredGenerationSummary({
      totalCandidatesGenerated: 8,
      validCandidates: 5,
      boundaryRejectedCount: 2,
      validationRejectedCount: 1,
      semanticDuplicateCount: 1,
      savedClips: [
        { id: "edit", qualityLabel: "NEEDS_EDITING", rankingCategory: "NEEDS_REVIEW", finalQualityScore: 9 },
        { id: "ready", qualityLabel: "POST_READY", rankingCategory: "BEST_OVERALL", finalQualityScore: 8.2 },
        { id: "review", qualityLabel: "GOOD_NEEDS_REVIEW", rankingCategory: "BEST_TEACHING_CLIP", finalQualityScore: 7.4 },
      ],
    });

    expect(summary.totalCandidatesGenerated).toBe(8);
    expect(summary.validCandidates).toBe(5);
    expect(summary.rejectedCandidates).toBe(3);
    expect(summary.postReadyCount).toBe(1);
    expect(summary.needsReviewCount).toBe(1);
    expect(summary.needsEditingCount).toBe(1);
    expect(summary.bestOverallClipId).toBe("ready");
    expect(summary.topClipIds[0]).toBe("ready");
  });

  it("counts saved clips as post-ready only when the deeper quality gates agree", () => {
    const summary = __clipIntelligenceTestUtils.buildStructuredGenerationSummary({
      totalCandidatesGenerated: 4,
      validCandidates: 4,
      boundaryRejectedCount: 0,
      validationRejectedCount: 0,
      semanticDuplicateCount: 0,
      savedClips: [
        {
          id: "stale-label",
          qualityLabel: "POST_READY",
          postReadyStatus: "GOOD_NEEDS_REVIEW",
          boundaryQuality: "GOOD",
          rankingCategory: "BEST_OVERALL",
          finalQualityScore: 8.9,
        },
        {
          id: "bad-boundary",
          qualityLabel: "POST_READY",
          postReadyStatus: "POST_READY",
          boundaryQuality: "NEEDS_REVIEW",
          rankingCategory: "BEST_TEACHING_CLIP",
          finalQualityScore: 8.8,
        },
        {
          id: "low-score",
          qualityLabel: "POST_READY",
          postReadyStatus: "POST_READY",
          boundaryQuality: "GOOD",
          rankingCategory: "BEST_DISCIPLESHIP_CLIP",
          finalQualityScore: 7.9,
        },
        {
          id: "true-ready",
          qualityLabel: "POST_READY",
          postReadyStatus: "POST_READY",
          boundaryQuality: "GOOD",
          rankingCategory: "BEST_PRAYER_CLIP",
          finalQualityScore: 8.4,
        },
      ],
    });

    expect(summary.postReadyCount).toBe(1);
    expect(summary.topClipIds[0]).toBe("true-ready");
    expect(summary.bestOverallClipId).toBe("true-ready");
  });

  it("keeps only pastor-grade clips when enough strong candidates exist", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      { id: "weak-edit", qualityLabel: "NEEDS_EDITING" as const, finalQualityScore: 9.1, score: 9.1, startTimeSeconds: 0 },
      { id: "reject", qualityLabel: "REJECT" as const, finalQualityScore: 9.5, score: 9.5, startTimeSeconds: 0 },
      { id: "ready-1", qualityLabel: "POST_READY" as const, finalQualityScore: 8.4, score: 8.4, startTimeSeconds: 0 },
      { id: "ready-2", qualityLabel: "POST_READY" as const, finalQualityScore: 8.1, score: 8.1, startTimeSeconds: 0 },
      { id: "review-1", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.8, score: 7.8, startTimeSeconds: 0 },
      { id: "review-2", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.6, score: 7.6, startTimeSeconds: 0 },
      { id: "review-3", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.5, score: 7.5, startTimeSeconds: 0 },
      { id: "low-review", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 6.2, score: 6.2, startTimeSeconds: 0 },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["ready-1", "ready-2", "review-1", "review-2"]);
  });

  it("builds deterministic fallback candidates when AI clip selection quota is unavailable", () => {
    const candidates = __clipIntelligenceTestUtils.buildHeuristicClipCandidatesFromWindows([
      {
        windowId: "window-fixture",
        startTimeSeconds: 9000,
        endTimeSeconds: 9090,
        durationSeconds: 90,
        transcriptText: "God placed a gift in you. Stir it up and use what is already in your hand.",
        segmentLines: ["[9000.0 - 9090.0] God placed a gift in you."],
        wordCount: 17,
        meaningfulSegmentCount: 2,
        openingHookScore: 8,
        ministryPayoffScore: 8,
        windowQualityScore: 8.7,
        windowQualityWarnings: [],
      },
    ]);

    expect(__clipIntelligenceTestUtils.isAiQuotaError(new Error("429 quota exceeded"))).toBe(true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      startTimeSeconds: 9000,
      endTimeSeconds: 9090,
      title: "Stir Up the Gift",
      score: 8.7,
      clipType: "teaching",
      smartClipCategory: "Best Discipleship Clip",
      riskLevel: "LOW",
      contextWarning: false,
    });
    expect(candidates[0]?.reasonSelected).toContain("spoken transcript lands with");
  });

  it("rejects fragment-style pastor titles", () => {
    const validation = __clipIntelligenceTestUtils.validatePastorTitle(
      "And the Gift of",
      "God placed a gift in you so serve with courage this week.",
    );

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("dangling");
  });

  it("rejects grounded but unreadable AI title fragments", () => {
    const transcript = "We cannot pray through labor pains without grace. God has designed the family to function in wisdom, but when wisdom is missing it becomes a struggle.";

    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "Pray for We Cannot Pray for a Labor Pains",
      transcript,
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "God Has Designed to Function in Becomes a Struggle",
      transcript,
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "I Sit Can I Stand Up Can I Lie",
      transcript,
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "However If We Begin with the Root Meaning",
      transcript,
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "Neither Their Sex Has a Spiritual Advantage Greater Access",
      "We are all equal before God the Father. Men and women have equal access to worship God.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "Choose to Wait Upon the Lord at",
      "Choose to wait upon the Lord at the right time because God is faithful.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "God Has Created If I Believe Let Us Create",
      "God created humanity in his image. Men and women carry the image of God.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "Ruling Outside Family It Is Reigning",
      "God has created men and women in his likeness so they can govern the world together.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "He Must Do",
      "A church leader must be above reproach and faithful to his family.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "With Integrity Let Us Lead Honestly Faithfully Follow Me",
      "Let us lead with integrity. Let us lead honestly and faithfully.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "Our Bible Scripture Give Us a Learning",
      "Our Bible scripture gives us learning about leadership and service.",
    ).valid).toBe(false);
    expect(__clipIntelligenceTestUtils.validatePastorTitle(
      "See That His Well",
      "He must manage his own family well and take care of God's church.",
    ).valid).toBe(false);
  });

  it("derives pastor-facing titles from a grounded landing", () => {
    const title = __clipIntelligenceTestUtils.deterministicPastorTitle({
      transcriptText: [
        "Paul reminded Timothy that the gift of God had to be stirred up.",
        "So this week choose one faithful act of service and stir up what God placed in your hand.",
      ].join(" "),
      landingSentence: "So this week choose one faithful act of service and stir up what God placed in your hand.",
    });

    expect(title).toBe("Choose One Faithful Act of Service");
    expect(__clipIntelligenceTestUtils.validatePastorTitle(title, "Choose one faithful act of service this week.").valid).toBe(true);
  });

  it("replaces unsupported dramatic AI titles deterministically", () => {
    const normalized = __clipIntelligenceTestUtils.normalizePastorTitle({
      title: "Financial Breakthrough Secret",
      transcriptText: "God placed a gift in you. Stir it up and serve with courage this week.",
      landingSentence: "Stir it up and serve with courage this week.",
      hook: "God placed a gift in you.",
    });

    expect(normalized).toBe("Stir Up the Gift");
    expect(normalized).not.toBe("Financial Breakthrough Secret");
  });

  it("replaces grounded ASR fragment titles with pastor-readable titles", () => {
    const normalized = __clipIntelligenceTestUtils.normalizePastorTitle({
      title: "Neither Their Sex Has a Spiritual Advantage Greater Access",
      transcriptText: "Men and women are created by God with dignity. We are all equal before God the Father.",
      landingSentence: "We are all equal before God the Father.",
      hook: "Neither sex has greater access to God.",
    });

    expect(normalized).toBe("Equal Before God");
  });

  it("replaces creation ASR fragments with image-of-God titles", () => {
    const normalized = __clipIntelligenceTestUtils.normalizePastorTitle({
      title: "God Has Created If I Believe Let Us Create",
      transcriptText: "God created humanity in his image. Men and women carry the image of God.",
      landingSentence: "Men and women carry the image of God.",
      hook: "God created humanity in his image.",
    });

    expect(normalized).toBe("Created in God's Image");
  });

  it("replaces rule-and-reign ASR fragments with likeness titles", () => {
    const normalized = __clipIntelligenceTestUtils.normalizePastorTitle({
      title: "Ruling Outside Family It Is Reigning",
      transcriptText: "God has created everything. Let us create men in our likeness so they can govern the world together.",
      landingSentence: "Let us create men in our likeness so they can govern the world together.",
      hook: "Ruling outside family it is reigning.",
    });

    expect(normalized).toBe("Created in God's Likeness");
  });

  it("replaces live-run leadership ASR fragments with readable grounded titles", () => {
    expect(__clipIntelligenceTestUtils.normalizePastorTitle({
      title: "He Must Do",
      transcriptText: "A church leader must be above reproach and faithful to his family.",
      landingSentence: "The overseer must be above reproach and faithful.",
      hook: "He must do.",
    })).toBe("Faithful Church Leadership");

    expect(__clipIntelligenceTestUtils.normalizePastorTitle({
      title: "With Integrity Let Us Lead Honestly Faithfully Follow Me",
      transcriptText: "Let us lead with integrity. Let us lead honestly and faithfully. Follow me as I follow Christ.",
      landingSentence: "Let us lead with integrity.",
      hook: "Let us lead with integrity.",
    })).toBe("Lead With Integrity");

    expect(__clipIntelligenceTestUtils.normalizePastorTitle({
      title: "Our Bible Scripture Give Us a Learning",
      transcriptText: "Our Bible scripture gives us learning about leadership and service.",
      landingSentence: "Our Bible scripture gives us learning.",
      hook: "Our Bible scripture gives us learning.",
    })).toBe("Learning From Scripture");

    expect(__clipIntelligenceTestUtils.normalizePastorTitle({
      title: "See That His Well",
      transcriptText: "He must manage his own family well and take care of God's church.",
      landingSentence: "How can he take care of God's church?",
      hook: "See that his well.",
    })).toBe("Care for God's Church");
  });

  it("does not accept neutral titles when a grounded deterministic title exists", () => {
    const normalized = __clipIntelligenceTestUtils.normalizePastorTitle({
      title: "Sermon Moment for Review",
      transcriptText: "Through your sweat you will work the ground. Men work hard and take care of the family.",
      landingSentence: "Men work hard and take care of the family.",
      hook: "Work hard and take care of the family.",
    });

    expect(normalized).toBe("Work Hard for the Family");
  });

  it("reuses existing suggestions only when the whole set still passes pastor-grade selection", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.5,
        score: 8.5,
        startTimeSeconds: 0,
        endTimeSeconds: 65,
        durationSeconds: 65,
        transcriptText: "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, so this week serve with courage and let faith move first.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 7.4,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.2,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 7.8,
        score: 7.8,
        startTimeSeconds: 420,
        endTimeSeconds: 485,
        durationSeconds: 65,
        transcriptText: "Forgiveness is not pretending the wound did not happen. It is choosing obedience before the feeling arrives, because grace has already met you and mercy keeps the heart free enough to love again. That freedom lets families heal and neighbors see Christ clearly.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        smartClipCategory: "Best Healing Clip",
        clipType: "pastoral",
        hookScore: 7.2,
        standaloneClarityScore: 7.2,
        arcCompletenessScore: 7.1,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(true);
    expect(decision.reusableCount).toBe(2);
    expect(decision.totalCount).toBe(2);
    expect(__clipIntelligenceTestUtils.shouldReplaceExistingSuggestionsBeforeSave(decision)).toBe(false);
  });

  it("regenerates mixed existing suggestions instead of preserving weak review clutter", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.5,
        score: 8.5,
        startTimeSeconds: 0,
        endTimeSeconds: 65,
        durationSeconds: 65,
        transcriptText: "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, so this week serve with courage and let faith move first.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        hookScore: 7.4,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.2,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        qualityLabel: "NEEDS_EDITING" as const,
        finalQualityScore: 6.8,
        score: 6.8,
        startTimeSeconds: 60,
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(1);
    expect(decision.reason).toContain("remove weak");
    expect(__clipIntelligenceTestUtils.shouldReplaceExistingSuggestionsBeforeSave(decision)).toBe(true);
  });

  it("regenerates existing suggestions when saved clips lack spoken transcript evidence", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9,
        score: 9,
        startTimeSeconds: 0,
        endTimeSeconds: 60,
        durationSeconds: 60,
        transcriptText: "",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(0);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("regenerates existing suggestions when saved clips lack transcript grounding proof", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9,
        score: 9,
        startTimeSeconds: 0,
        endTimeSeconds: 70,
        durationSeconds: 70,
        transcriptText: "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, so this week serve with courage and let faith move first.",
        qualityDebugSnapshot: reusableGroundingSnapshot(0.5, 0.7),
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(0);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("regenerates existing suggestions when saved transcript substance fails current pastor-grade gates", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.8,
        score: 8.8,
        startTimeSeconds: 0,
        endTimeSeconds: 60,
        durationSeconds: 60,
        transcriptText: "God is faithful. Choose faith today.",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(0);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("regenerates existing suggestions when saved clips have only generic landing without ministry payoff", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.8,
        score: 8.8,
        startTimeSeconds: 0,
        endTimeSeconds: 70,
        durationSeconds: 70,
        transcriptText: "God is faithful across generations. Scripture teaches that faith matters. The church has responsibilities in discipleship. This truth is important for believers today and the passage helps us understand ministry.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(0);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("regenerates existing suggestions when saved standalone clarity fails current pastor-grade gates", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.8,
        score: 8.8,
        startTimeSeconds: 0,
        endTimeSeconds: 72,
        durationSeconds: 72,
        transcriptText: "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, because fear will always argue with calling. This week, serve with what is in your hand and let faith move first.",
        hookScore: 8,
        standaloneClarityScore: 5.8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(0);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("regenerates existing suggestions when saved suggestions are stale or weak", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "NEEDS_EDITING" as const,
        finalQualityScore: 8.9,
        score: 8.9,
        startTimeSeconds: 0,
      },
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "NEEDS_EDITING" as const,
        finalQualityScore: 9.1,
        score: 9.1,
        startTimeSeconds: 60,
        hookScore: 4.5,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain("not pastor-grade");
    expect(__clipIntelligenceTestUtils.shouldReplaceExistingSuggestionsBeforeSave(decision)).toBe(true);
  });

  it("deletes only replaceable AI suggestions when weak suggestions are regenerated", () => {
    expect(__clipIntelligenceTestUtils.buildSuggestionDeleteWhere("sermon-1")).toEqual({
      sermonId: "sermon-1",
      status: "SUGGESTED",
      isAiGenerated: true,
      isManuallyEdited: false,
    });

    expect(__clipIntelligenceTestUtils.buildSuggestionDeleteWhere("sermon-1", "Best Prayer Clip")).toEqual({
      sermonId: "sermon-1",
      status: "SUGGESTED",
      isAiGenerated: true,
      isManuallyEdited: false,
      smartClipCategory: "Best Prayer Clip",
    });

    expect(__clipIntelligenceTestUtils.buildSuggestionDeleteWhere("sermon-1", undefined, true)).toEqual({
      sermonId: "sermon-1",
      status: { in: ["SUGGESTED", "REJECTED"] },
      isAiGenerated: true,
      isManuallyEdited: false,
    });
  });

  it("does not pad generation with editable clips when there are few strong candidates", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      { id: "ready", qualityLabel: "POST_READY" as const, finalQualityScore: 8.2, score: 8.2, startTimeSeconds: 0 },
      { id: "review", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.7, score: 7.7, startTimeSeconds: 0 },
      { id: "editable-1", qualityLabel: "NEEDS_EDITING" as const, finalQualityScore: 6.7, score: 6.7, startTimeSeconds: 0 },
      { id: "editable-2", qualityLabel: "NEEDS_EDITING" as const, finalQualityScore: 6.1, score: 6.1, startTimeSeconds: 0 },
      { id: "too-low", qualityLabel: "NEEDS_EDITING" as const, finalQualityScore: 5.2, score: 5.2, startTimeSeconds: 0 },
      { id: "reject", qualityLabel: "REJECT" as const, finalQualityScore: 8.8, score: 8.8, startTimeSeconds: 0 },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["ready", "review"]);
  });

  it("does not select high-score clips with weak pastor-grade signals", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "strong",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.6,
        score: 8.6,
        startTimeSeconds: 0,
        hookScore: 7.5,
        arcCompletenessScore: 7.4,
        completenessScore: 7.2,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "weak-hook",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.1,
        score: 9.1,
        startTimeSeconds: 60,
        hookScore: 4.9,
        arcCompletenessScore: 8.2,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "incomplete-arc",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.9,
        score: 8.9,
        startTimeSeconds: 120,
        hookScore: 7.5,
        arcCompletenessScore: 5.8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "stale-post-ready",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "NEEDS_EDITING" as const,
        finalQualityScore: 8.7,
        score: 8.7,
        startTimeSeconds: 180,
        hookScore: 7.5,
        arcCompletenessScore: 7.5,
        completenessScore: 7.5,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "pastor-grade-blocker",
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 8.1,
        score: 8.1,
        startTimeSeconds: 240,
        hookScore: 7.2,
        arcCompletenessScore: 7.1,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: ["PASTOR_GRADE_NO_SPIRITUAL_ANCHOR"],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["strong"]);
  });

  it("does not select stale high-risk clips even when older scores look strong", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "stale-high-risk",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.2,
        score: 9.2,
        startTimeSeconds: 0,
        endTimeSeconds: 70,
        durationSeconds: 70,
        transcriptText: "That means the church should serve with courage because God has already given the gift for this season.",
        riskLevel: "HIGH" as const,
        riskReasons: [],
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "stale-risk-reason",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9,
        score: 9,
        startTimeSeconds: 90,
        endTimeSeconds: 160,
        durationSeconds: 70,
        transcriptText: "God has placed a gift in every believer, and this week the church can serve with faith and courage.",
        riskLevel: "LOW" as const,
        riskReasons: ["Clip may be missing setup needed for standalone viewing."],
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "fresh-safe",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.4,
        score: 8.4,
        startTimeSeconds: 240,
        endTimeSeconds: 310,
        durationSeconds: 70,
        transcriptText: "Paul tells Timothy to stir up the gift of God, and the application is clear for the church today: serve with what grace has already placed in your hand, take one faithful step, and let courage answer fear.",
        riskLevel: "LOW" as const,
        riskReasons: [],
        hookScore: 7.6,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.6,
        completenessScore: 7.4,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["fresh-safe"]);
  });

  it("regenerates existing suggestions when old risk reasons contradict a post-ready label", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.9,
        score: 8.9,
        startTimeSeconds: 0,
        endTimeSeconds: 70,
        durationSeconds: 70,
        transcriptText: "God gives the church courage to serve this week with the gift already placed in their hands.",
        riskLevel: "LOW" as const,
        riskReasons: ["Clip may not make sense without additional context."],
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("does not select sparse spoken fragments even when scores look strong", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "sparse",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.2,
        score: 9.2,
        startTimeSeconds: 0,
        endTimeSeconds: 60,
        durationSeconds: 60,
        transcriptText: "This is important. Remember that. Amen.",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "substantial",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.6,
        score: 8.6,
        startTimeSeconds: 80,
        endTimeSeconds: 140,
        durationSeconds: 60,
        transcriptText: "God has placed a gift in you, but gifts grow when they are used in obedience. Paul tells Timothy to stir up what was already given, because fear will always argue with calling. This week, serve with what is in your hand and let faith move first.",
        hookScore: 7.8,
        standaloneClarityScore: 7.7,
        arcCompletenessScore: 7.8,
        completenessScore: 7.7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["substantial"]);
  });

  it("selects calling and gift moments when the transcript lands with stewardship", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "calling-gift-payoff",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.7,
        score: 8.7,
        startTimeSeconds: 0,
        endTimeSeconds: 68,
        durationSeconds: 68,
        transcriptText: "God has placed a gift in you, and the Holy Spirit did not give it so it could stay hidden. Paul tells Timothy to stir up what God gave. Use what grace entrusted to you, step into your calling, and serve with what is in your hand.",
        hookScore: 7.8,
        standaloneClarityScore: 7.7,
        arcCompletenessScore: 7.8,
        completenessScore: 7.7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "generic-gift-teaching",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.1,
        score: 9.1,
        startTimeSeconds: 120,
        endTimeSeconds: 188,
        durationSeconds: 68,
        transcriptText: "Spiritual gifts are important in the New Testament. There are different views about gifts, and many churches teach about gifts in different ways. This subject is worth studying because it appears in several letters.",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["calling-gift-payoff"]);
  });

  it("does not select candidates with missing spoken transcript excerpts", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "missing-transcript",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.2,
        score: 9.2,
        startTimeSeconds: 0,
        endTimeSeconds: 60,
        durationSeconds: 60,
        transcriptText: "",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "grounded-transcript",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.6,
        score: 8.6,
        startTimeSeconds: 80,
        endTimeSeconds: 140,
        durationSeconds: 60,
        transcriptText: "God has placed a gift in you, and the church does not need you to bury it because fear became loud. So this week choose one faithful step and serve with what God placed in your hand.",
        hookScore: 7.8,
        standaloneClarityScore: 7.7,
        arcCompletenessScore: 7.8,
        completenessScore: 7.7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["grounded-transcript"]);
  });

  it("does not treat clips with unresolved boundary review as post-ready", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "boundary-needs-review",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9.1,
        score: 9.1,
        startTimeSeconds: 0,
        endTimeSeconds: 66,
        durationSeconds: 66,
        transcriptText: "That means fear cannot lead your obedience anymore. God has placed a gift in your hand, and the church is strengthened when believers stop hiding what grace has given them. This week you can choose one faithful step of service that strengthens somebody in the church and reminds them that God is still working through ordinary obedience.",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "NEEDS_REVIEW" as const,
        qualityWarnings: [],
      },
      {
        id: "clean-boundary",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.7,
        score: 8.7,
        startTimeSeconds: 80,
        endTimeSeconds: 146,
        durationSeconds: 66,
        transcriptText: "Fear cannot lead your obedience anymore. God has placed a gift in your hand, and the church is strengthened when believers stop hiding what grace has given them. This week you can choose one faithful step of service that strengthens somebody in the church and reminds them that God is still working through ordinary obedience.",
        hookScore: 7.8,
        standaloneClarityScore: 7.8,
        arcCompletenessScore: 7.8,
        completenessScore: 7.8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["clean-boundary"]);
  });

  it("does not trust stale post-ready labels when the final score is not excellent", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "stale-ready-label",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 7.8,
        score: 7.8,
        startTimeSeconds: 0,
        hookScore: 7.4,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.5,
        completenessScore: 7.2,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "truly-ready",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.3,
        score: 8.3,
        startTimeSeconds: 60,
        hookScore: 7.4,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.5,
        completenessScore: 7.2,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["truly-ready"]);
  });

  it("rejects context-dependent clips that do not clearly stand alone", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "context-dependent",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.6,
        score: 8.6,
        startTimeSeconds: 0,
        hookScore: 7.8,
        standaloneClarityScore: 6.5,
        arcCompletenessScore: 7.5,
        completenessScore: 7.4,
        boundaryQuality: "GOOD" as const,
        contextWarning: true,
        qualityWarnings: [],
      },
      {
        id: "clear-standalone",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.4,
        score: 8.4,
        startTimeSeconds: 60,
        hookScore: 7.6,
        standaloneClarityScore: 7.2,
        arcCompletenessScore: 7.4,
        completenessScore: 7.1,
        boundaryQuality: "GOOD" as const,
        contextWarning: false,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["clear-standalone"]);
  });

  it("rejects final selections that have high scores but no spoken landing", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "setup-only",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9,
        score: 9,
        startTimeSeconds: 0,
        endTimeSeconds: 62,
        durationSeconds: 62,
        transcriptText: "Today I want to talk about spiritual gifts and we are going to look at the foundation of the passage. Before we can understand the application, we need to define what the gift is and why Paul writes to Timothy.",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        contextWarning: false,
        qualityWarnings: [],
      },
      {
        id: "application-landing",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.5,
        score: 8.5,
        startTimeSeconds: 90,
        endTimeSeconds: 150,
        durationSeconds: 60,
        transcriptText: "God gives courage to serve when fear tells you to hide. So this week choose one act of obedience, stir up the gift in your hand, and serve somebody with what God already placed inside you.",
        hookScore: 7.8,
        standaloneClarityScore: 7.8,
        arcCompletenessScore: 7.8,
        completenessScore: 7.8,
        boundaryQuality: "GOOD" as const,
        contextWarning: false,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["application-landing"]);
  });

  it("regenerates existing suggestions when a post-ready label no longer meets the score floor", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 7.8,
        score: 7.8,
        startTimeSeconds: 0,
        hookScore: 7.4,
        standaloneClarityScore: 7.4,
        arcCompletenessScore: 7.5,
        completenessScore: 7.2,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain("not pastor-grade");
  });

  it("keeps strong selections diverse instead of filling the queue with one theme", () => {
    const repeatedTeaching = Array.from({ length: 8 }, (_, index) => ({
      id: `teaching-${index + 1}`,
      qualityLabel: "POST_READY" as const,
      finalQualityScore: 9 - index * 0.1,
      score: 9 - index * 0.1,
      startTimeSeconds: index * 60,
      smartClipCategory: "Best Teaching Clip",
      clipType: "teaching",
    }));
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      ...repeatedTeaching,
      { id: "prayer", qualityLabel: "POST_READY" as const, finalQualityScore: 8.1, score: 8.1, startTimeSeconds: 600, smartClipCategory: "Best Prayer Clip", clipType: "pastoral" },
      { id: "testimony", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.7, score: 7.7, startTimeSeconds: 700, smartClipCategory: "Best Testimony Clip", clipType: "testimony" },
    ]);

    expect(selected.filter((clip) => clip.smartClipCategory === "Best Teaching Clip")).toHaveLength(4);
    expect(selected.map((clip) => clip.id)).toContain("prayer");
    expect(selected.map((clip) => clip.id)).toContain("testimony");
  });

  it("skips near-duplicate clips while keeping distant related sermon options", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "best-gift-application",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 9,
        score: 9,
        startTimeSeconds: 420,
        endTimeSeconds: 485,
        durationSeconds: 65,
        transcriptText: "God already placed a gift in you, and the church does not need you to bury it because fear became loud. Paul tells Timothy to stir up what was given, so this week take one faithful step and serve with what God placed in your hand.",
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "near-repeat-gift",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.7,
        score: 8.7,
        startTimeSeconds: 460,
        endTimeSeconds: 525,
        durationSeconds: 65,
        transcriptText: "God has already placed a gift in you, and fear cannot be the reason you bury it. Stir up what was given, take one faithful step this week, and serve with what God placed in your hand.",
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 7.9,
        standaloneClarityScore: 7.9,
        arcCompletenessScore: 7.9,
        completenessScore: 7.9,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "same-gift-point-later",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.5,
        score: 8.5,
        startTimeSeconds: 980,
        endTimeSeconds: 1045,
        durationSeconds: 65,
        transcriptText: "Do not bury the gift God gave you just because fear has been loud. The body of Christ needs what is in your hand, and the faithful response this week is to stir up the gift and serve with courage.",
        smartClipCategory: "Best Application Clip",
        clipType: "teaching",
        hookScore: 7.8,
        standaloneClarityScore: 7.8,
        arcCompletenessScore: 7.8,
        completenessScore: 7.8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "distinct-forgiveness",
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.2,
        score: 8.2,
        startTimeSeconds: 1320,
        endTimeSeconds: 1385,
        durationSeconds: 65,
        transcriptText: "Forgiveness is not pretending the wound did not happen. It is choosing obedience before the feeling arrives, because grace has already met you and mercy keeps the heart free enough to love again. That freedom lets families heal and neighbors see Christ clearly.",
        smartClipCategory: "Best Healing Clip",
        clipType: "pastoral",
        hookScore: 7.6,
        standaloneClarityScore: 7.6,
        arcCompletenessScore: 7.6,
        completenessScore: 7.6,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["best-gift-application", "same-gift-point-later", "distinct-forgiveness"]);
  });

  it("skips overlapping degraded-transcript clips with the same generated label", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "leadership-best-trim",
        title: "Leadership That Serves",
        hook: "Leadership That Serves",
        qualityLabel: "NEEDS_EDITING" as const,
        postReadyStatus: "NEEDS_EDITING" as const,
        finalQualityScore: 7.9,
        score: 9.1,
        startTimeSeconds: 6235,
        endTimeSeconds: 6324,
        durationSeconds: 89,
        transcriptText: "We have learnt a lot on what leadership is and what leadership is not. Leadership is a position of influence in guiding others and above all it is a position where you serve others towards a shared purpose or a vision.",
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 7.8,
        standaloneClarityScore: 7.5,
        arcCompletenessScore: 6.6,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: ["DEGRADED_TRANSCRIPT_REVIEW_REQUIRED"],
      },
      {
        id: "leadership-repeat-offset",
        title: "Leadership That Serves",
        hook: "Leadership That Serves",
        qualityLabel: "NEEDS_EDITING" as const,
        postReadyStatus: "NEEDS_EDITING" as const,
        finalQualityScore: 7.2,
        score: 9,
        startTimeSeconds: 6243,
        endTimeSeconds: 6328,
        durationSeconds: 85,
        transcriptText: "We have lent a lot on what leadership is and what leadership is not. Leadership is position influence guiding others and above all position where you serve others toward shared purpose vision.",
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 7.2,
        standaloneClarityScore: 6.8,
        arcCompletenessScore: 6.2,
        completenessScore: 6.7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: ["DEGRADED_TRANSCRIPT_REVIEW_REQUIRED", "REVIEW_ENDING"],
      },
      {
        id: "lead-with-integrity-later",
        title: "Lead With Integrity",
        hook: "Lead With Integrity",
        qualityLabel: "NEEDS_EDITING" as const,
        postReadyStatus: "NEEDS_EDITING" as const,
        finalQualityScore: 7.4,
        score: 8.8,
        startTimeSeconds: 6571,
        endTimeSeconds: 6660,
        durationSeconds: 89,
        transcriptText: "Leadership is being a shepherd knowing your flock and taking care of those who are following you. A faithful leader does not only give instructions from far away, but walks with the people, sees their needs, protects their hearts, and serves with integrity. Let us lead with integrity and serve others faithfully this week.",
        smartClipCategory: "Best Leadership Integrity Clip",
        clipType: "teaching",
        hookScore: 7.4,
        standaloneClarityScore: 7,
        arcCompletenessScore: 6.4,
        completenessScore: 7,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: ["DEGRADED_TRANSCRIPT_REVIEW_REQUIRED"],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["leadership-best-trim", "lead-with-integrity-later"]);
  });

  it("regenerates existing suggestions when older saved clips repeat the same idea in the same section", () => {
    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.8,
        score: 8.8,
        startTimeSeconds: 120,
        endTimeSeconds: 185,
        durationSeconds: 65,
        transcriptText: "God already placed a gift in you, and the church does not need you to bury it because fear became loud. Paul tells Timothy to stir up what was given, so this week take one faithful step and serve with what God placed in your hand.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 8,
        standaloneClarityScore: 8,
        arcCompletenessScore: 8,
        completenessScore: 8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        qualityLabel: "POST_READY" as const,
        postReadyStatus: "POST_READY" as const,
        finalQualityScore: 8.4,
        score: 8.4,
        startTimeSeconds: 160,
        endTimeSeconds: 225,
        durationSeconds: 65,
        transcriptText: "God has already placed a gift in you, and fear cannot be the reason you bury it. Stir up what was given, take one faithful step this week, and serve with what God placed in your hand.",
        qualityDebugSnapshot: reusableGroundingSnapshot(),
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        hookScore: 7.8,
        standaloneClarityScore: 7.8,
        arcCompletenessScore: 7.8,
        completenessScore: 7.8,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(decision.reuse).toBe(false);
    expect(decision.reusableCount).toBe(1);
    expect(decision.reason).toContain("duplicate");
  });

  it("limits good-needs-review clips so the pastor queue is led by post-ready moments", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      { id: "ready-faith", qualityLabel: "POST_READY" as const, finalQualityScore: 8.8, score: 8.8, startTimeSeconds: 0, smartClipCategory: "Best Faith Clip" },
      { id: "ready-prayer", qualityLabel: "POST_READY" as const, finalQualityScore: 8.4, score: 8.4, startTimeSeconds: 300, smartClipCategory: "Best Prayer Clip" },
      { id: "review-testimony", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.95, score: 7.95, startTimeSeconds: 600, smartClipCategory: "Best Testimony Clip" },
      { id: "review-leadership", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.9, score: 7.9, startTimeSeconds: 900, smartClipCategory: "Best Leadership Clip" },
      { id: "review-family", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.85, score: 7.85, startTimeSeconds: 1200, smartClipCategory: "Best Family Clip" },
      { id: "review-application", qualityLabel: "GOOD_NEEDS_REVIEW" as const, finalQualityScore: 7.8, score: 7.8, startTimeSeconds: 1500, smartClipCategory: "Best Call To Action Clip" },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual([
      "ready-faith",
      "ready-prayer",
      "review-testimony",
      "review-leadership",
      "review-family",
      "review-application",
    ]);
    expect(selected.filter((clip) => clip.qualityLabel === "GOOD_NEEDS_REVIEW")).toHaveLength(4);
  });

  it("keeps a review-only batch as pastor-review options", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "review-strong-testimony",
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 7.95,
        score: 7.95,
        startTimeSeconds: 600,
        smartClipCategory: "Best Testimony Clip",
        transcriptText: "God met me in a season when I wanted to quit, and the lesson for the church is that grace does not only forgive us, it strengthens us to take the next obedient step when fear is loud.",
        hookScore: 7.8,
        standaloneClarityScore: 7.6,
        arcCompletenessScore: 7.7,
        completenessScore: 7.6,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
      {
        id: "review-strong-application",
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 7.85,
        score: 7.85,
        startTimeSeconds: 900,
        smartClipCategory: "Best Application Clip",
        transcriptText: "The response this week is not to wait until everything feels easy. The response is to stir up the gift God placed in your hand and serve one person with courage, because obedience grows as it is practiced.",
        hookScore: 7.7,
        standaloneClarityScore: 7.6,
        arcCompletenessScore: 7.6,
        completenessScore: 7.5,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual([
      "review-strong-testimony",
      "review-strong-application",
    ]);
  });

  it("reuses grounded needs-editing review-board suggestions instead of regenerating", () => {
    const reviewableEditingSuggestion = {
      qualityLabel: "NEEDS_EDITING" as const,
      postReadyStatus: "NEEDS_EDITING" as const,
      finalQualityScore: 6.9,
      score: 8,
      startTimeSeconds: 120,
      endTimeSeconds: 235,
      durationSeconds: 115,
      transcriptText: "God has placed a gift in you, and the church still needs what is in your hand. Do not bury what God gave you because fear became loud; take one faithful step and serve with courage this week.",
      qualityDebugSnapshot: reusableGroundingSnapshot(),
      smartClipCategory: "Best Discipleship Clip",
      clipType: "teaching",
      boundaryQuality: "NEEDS_REVIEW" as const,
      riskLevel: "LOW" as const,
      qualityWarnings: ["NEEDS_CONTEXT_EXTENSION", "MISSING_CAPTION_SEGMENTS"],
    };

    const decision = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([
      reviewableEditingSuggestion,
      {
        ...reviewableEditingSuggestion,
        startTimeSeconds: 600,
        endTimeSeconds: 705,
        durationSeconds: 105,
        transcriptText: "Prayer is not only a religious habit; it is where weary people learn to trust God again. Bring your family before the Lord, ask for wisdom, and let grace lead the next conversation.",
        smartClipCategory: "Best Prayer Clip",
        clipType: "pastoral",
      },
    ]);

    expect(decision.reuse).toBe(true);
    expect(decision.reusableCount).toBe(2);
    expect(decision.reason).toContain("pastor-review reuse checks");
  });

  it("keeps strong AI review-only clips for pastor review when no post-ready anchor survives", () => {
    const selected = __clipIntelligenceTestUtils.selectStrongReviewOnlyClipCandidates([
      {
        id: "review-strong-testimony",
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 7.95,
        score: 7.95,
        startTimeSeconds: 600,
        smartClipCategory: "Best Testimony Clip",
        transcriptText: "God met me in a season when I wanted to quit, and the lesson for the church is that grace does not only forgive us, it strengthens us to take the next obedient step when fear is loud.",
        hookScore: 7.8,
        standaloneClarityScore: 7.6,
        arcCompletenessScore: 7.7,
        completenessScore: 7.6,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
        transcriptGroundingScore: 1,
        transcriptGroundingOrderedFlowRatio: 1,
        riskLevel: "LOW" as const,
      },
      {
        id: "review-weak-grounding",
        qualityLabel: "GOOD_NEEDS_REVIEW" as const,
        postReadyStatus: "GOOD_NEEDS_REVIEW" as const,
        finalQualityScore: 7.9,
        score: 7.9,
        startTimeSeconds: 900,
        smartClipCategory: "Best Encouragement Clip",
        transcriptText: "The response this week is not to wait until everything feels easy. The response is to stir up the gift God placed in your hand and serve one person with courage, because obedience grows as it is practiced.",
        hookScore: 7.7,
        standaloneClarityScore: 7.6,
        arcCompletenessScore: 7.6,
        completenessScore: 7.5,
        boundaryQuality: "GOOD" as const,
        qualityWarnings: [],
        transcriptGroundingScore: 0.4,
        transcriptGroundingOrderedFlowRatio: 1,
        riskLevel: "LOW" as const,
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["review-strong-testimony"]);
  });

  it("rescues grounded boundary-review clips instead of returning an empty review board", () => {
    const selected = __clipIntelligenceTestUtils.selectBoundaryReviewClipCandidates([
      {
        id: "grounded-boundary-review",
        qualityLabel: "REJECT" as const,
        postReadyStatus: "REJECT" as const,
        finalQualityScore: 6.22,
        score: 6.22,
        startTimeSeconds: 9583,
        endTimeSeconds: 9661,
        smartClipCategory: "Best Discipleship Clip",
        transcriptText: "A life of a believer is a journey of faith where God forms endurance in us. Do not bury the gift because the season is hard. Stir up what God has placed in you and serve with courage because obedience grows when it is practiced.",
        boundaryQuality: "BAD" as const,
        qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"],
        transcriptGroundingScore: 1,
        transcriptGroundingOrderedFlowRatio: 1,
        riskLevel: "LOW" as const,
      },
      {
        id: "unsafe-boundary-review",
        qualityLabel: "REJECT" as const,
        postReadyStatus: "REJECT" as const,
        finalQualityScore: 7.1,
        score: 7.1,
        startTimeSeconds: 9700,
        endTimeSeconds: 9780,
        smartClipCategory: "Best Discipleship Clip",
        transcriptText: "This is a grounded section with enough words but it should not be included because the risk is too high for pastor review without a human creating it manually.",
        boundaryQuality: "BAD" as const,
        qualityWarnings: ["PASTOR_GRADE_HIGH_CONTEXT_RISK"],
        transcriptGroundingScore: 1,
        transcriptGroundingOrderedFlowRatio: 1,
        riskLevel: "HIGH" as const,
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["grounded-boundary-review"]);
  });

  it("keeps the final review set from crowding one sermon section", () => {
    const selected = __clipIntelligenceTestUtils.selectBestClipCandidates([
      {
        id: "opening-best",
        qualityLabel: "POST_READY" as const,
        finalQualityScore: 9.3,
        score: 9.3,
        startTimeSeconds: 120,
        endTimeSeconds: 180,
        smartClipCategory: "Best Faith Clip",
        clipType: "teaching",
      },
      {
        id: "opening-second",
        qualityLabel: "POST_READY" as const,
        finalQualityScore: 9.1,
        score: 9.1,
        startTimeSeconds: 210,
        endTimeSeconds: 270,
        smartClipCategory: "Best Prayer Clip",
        clipType: "pastoral",
      },
      {
        id: "opening-third",
        qualityLabel: "POST_READY" as const,
        finalQualityScore: 8.9,
        score: 8.9,
        startTimeSeconds: 300,
        endTimeSeconds: 360,
        smartClipCategory: "Best Testimony Clip",
        clipType: "testimony",
      },
      {
        id: "later-application",
        qualityLabel: "POST_READY" as const,
        finalQualityScore: 8.4,
        score: 8.4,
        startTimeSeconds: 820,
        endTimeSeconds: 880,
        smartClipCategory: "Best Call To Action Clip",
        clipType: "teaching",
      },
    ]);

    expect(selected.map((clip) => clip.id)).toEqual(["opening-best", "opening-second", "opening-third", "later-application"]);
  });

  it("requires enough transcript substance before clipping", () => {
    const sermonLines = [
      "Faith keeps walking when pressure comes because God is still faithful today.",
      "The scripture teaches us to stir up the gift that God has already placed inside us.",
      "When fear speaks loudly, the believer answers with obedience and prayer.",
      "You do not need perfect conditions before you take the next step of faith.",
      "Paul reminded Timothy that spiritual gifts must be practiced with courage.",
      "Some of us have buried what God gave us because disappointment made us tired.",
      "But grace calls us forward again and reminds us that the calling still matters.",
      "This week, choose one act of obedience and serve with what is already in your hand.",
      "The church grows stronger when every member brings their gift to the body.",
      "So do not wait for another confirmation when God has already spoken clearly.",
    ];
    const segments = sermonLines.map((text, index) => ({
      startTimeSeconds: index * 12,
      endTimeSeconds: index * 12 + 10,
      text,
    }));

    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(result.ready).toBe(true);
    expect(result.wordCount).toBeGreaterThanOrEqual(120);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(90);
    expect(result.coverageRatio).toBeGreaterThan(0.2);
  });

  it("builds focused 45-90 second windows instead of broad 150 second discovery ranges", () => {
    const segments = Array.from({ length: 16 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `God uses testimony ${index} to remind the church to trust him, so today choose courage and serve again.`,
    }));

    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(windows.some((window) => window.durationSeconds <= 50)).toBe(true);
    expect(windows.some((window) => window.durationSeconds > 50 && window.durationSeconds <= 70)).toBe(true);
    expect(windows.some((window) => window.durationSeconds > 70 && window.durationSeconds <= 90)).toBe(true);
    expect(Math.max(...windows.map((window) => window.durationSeconds))).toBeLessThanOrEqual(90);
    expect(windows.every((window) => window.windowQualityScore > 0)).toBe(true);
    expect(windows.every((window) => window.wordCount >= 35)).toBe(true);
  });

  it("builds multiple focused variants so sharp clips are not diluted", () => {
    const segments = Array.from({ length: 16 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `Faith application ${index} gives the church a clear thought, so this week trust God and pray again.`,
    }));

    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);
    const startsAtZero = windows.filter((window) => window.startTimeSeconds === 0);

    expect(startsAtZero.map((window) => window.durationSeconds)).toEqual(expect.arrayContaining([40, 60, 90]));
    expect(new Set(windows.map((window) => `${window.startTimeSeconds}:${window.endTimeSeconds}`)).size).toBe(windows.length);
  });

  it("adds ministry-moment anchored windows between the regular rolling anchors", () => {
    const segments = Array.from({ length: 18 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `Scripture forms discipleship application ${index}, so choose obedience and take one faithful action today.`,
    }));
    const ministryMoment = {
      id: "moment-1",
      momentType: "FAITH_DECLARATION",
      title: "Gift stirring application",
      description: "A strong application moment begins between normal rolling anchors.",
      startTimeSeconds: 35,
      endTimeSeconds: 95,
      confidenceScore: 0.93,
      transcriptExcerpt: "stir up the gift with obedience",
      whyDetected: "Clear pastoral application.",
      suggestedAudience: "Believers ready to serve",
      suggestedUsage: "Discipleship clip",
      clipCategory: "Best Discipleship Clip",
    };

    const rollingOnly = __clipIntelligenceTestUtils.buildRollingWindows(segments);
    const anchored = __clipIntelligenceTestUtils.buildRollingWindows(segments, [ministryMoment]);

    expect(rollingOnly.some((window) => window.startTimeSeconds === 20)).toBe(false);
    expect(anchored.some((window) => window.startTimeSeconds === 20 && window.endTimeSeconds <= 110)).toBe(true);
    expect(anchored.length).toBeGreaterThan(rollingOnly.length);
  });

  it("ranks transcript windows by quality while spreading the first batch across sermon sections", () => {
    const makeWindow = (
      id: string,
      startTimeSeconds: number,
      windowQualityScore: number,
      wordCount = 80,
      meaningfulSegmentCount = 6,
    ) => ({
      id,
      windowId: id,
      startTimeSeconds,
      endTimeSeconds: startTimeSeconds + 80,
      durationSeconds: 80,
      transcriptText: `${id} sermon application.`,
      segmentLines: [`[${startTimeSeconds}.00-${startTimeSeconds + 80}.00] ${id}`],
      wordCount,
      meaningfulSegmentCount,
      windowQualityScore,
      windowQualityWarnings: [],
    });

    const ranked = __clipIntelligenceTestUtils.rankClipWindowsForSelection([
      makeWindow("opening-second-best", 60, 8.8, 95),
      makeWindow("opening-best", 120, 9.5, 100),
      makeWindow("middle-best", 300, 9.1, 88),
      makeWindow("middle-second-best", 360, 8.7, 86),
      makeWindow("closing-best", 620, 8.4, 82),
    ]);

    expect(ranked.map((window) => window.transcriptText.split(" ")[0])).toEqual([
      "opening-best",
      "middle-best",
      "closing-best",
      "opening-second-best",
      "middle-second-best",
    ]);
  });

  it("rejects AI clip candidates that fall outside the prompt batch windows", () => {
    const windows = [
      {
        windowId: "window-1",
        startTimeSeconds: 100,
        endTimeSeconds: 190,
        durationSeconds: 90,
        transcriptText: "God gives courage to serve, so this week choose obedience and stir up the gift.",
        segmentLines: ["[100.00-190.00] God gives courage to serve, so this week choose obedience and stir up the gift."],
        wordCount: 70,
        meaningfulSegmentCount: 5,
        windowQualityScore: 8.6,
        windowQualityWarnings: [],
      },
      {
        windowId: "window-2",
        startTimeSeconds: 420,
        endTimeSeconds: 510,
        durationSeconds: 90,
        transcriptText: "The church is strengthened when every believer brings their gift with faith.",
        segmentLines: ["[420.00-510.00] The church is strengthened when every believer brings their gift with faith."],
        wordCount: 68,
        meaningfulSegmentCount: 5,
        windowQualityScore: 8.1,
        windowQualityWarnings: [],
      },
    ];
    const makeCandidate = (id: string, startTimeSeconds: number, endTimeSeconds: number) => ({
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds: endTimeSeconds - startTimeSeconds,
      transcriptText: `${id} God gives courage to serve, so choose obedience and stir up the gift.`,
      title: id,
      hook: "God gives courage to serve.",
      caption: "Choose obedience and stir up the gift.",
      hashtags: ["#Faith"],
      score: 8.4,
      reasonSelected: "The phrase choose obedience and stir up the gift lands the application.",
      landingSentence: "God gives courage to serve, so choose obedience and stir up the gift.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers ready to serve",
      ministryValue: "Encourages faithful service.",
      socialValue: "Clear short-form application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
      arcType: "SCRIPTURE_EXPLANATION_APPLICATION" as const,
      arcSummary: "Truth and application.",
      setupStartTime: startTimeSeconds,
      mainPointTime: startTimeSeconds + 12,
      payoffTime: endTimeSeconds - 15,
      applicationTime: endTimeSeconds - 6,
      whyThisClipFeelsComplete: "The application lands inside the selected range.",
      whatContextMightBeMissing: null,
    });

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([
      makeCandidate("inside-first-window", 112, 176),
      makeCandidate("between-windows", 250, 320),
      makeCandidate("inside-second-window", 430, 500),
    ], windows);

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "inside-first-window",
      "inside-second-window",
    ]);
    expect(result.rejectedReasons).toHaveLength(1);
    expect(result.rejectedReasons[0]).toContain("outside the transcript windows");
  });

  it("filters low-substance transcript windows before AI clip selection", () => {
    const segments = Array.from({ length: 12 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 3,
      text: index % 2 === 0 ? "Amen." : "Yes.",
    }));

    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);
    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments.slice(0, 6), 60);

    expect(windows).toHaveLength(0);
    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("LOW_WINDOW_WORD_COUNT");
    expect(quality.windowQualityWarnings).toContain("LOW_WINDOW_SUBSTANCE");
  });

  it("allows sparse but meaningful transcripts into review-first clip generation", () => {
    const sermonLines = [
      "God forms leaders through hidden obedience before public responsibility ever appears.",
      "The gift inside a believer becomes useful when courage answers the call to serve.",
      "Prayer keeps the heart tender when pressure wants to make faith defensive.",
      "Scripture shows Timothy receiving courage for ministry during a difficult season.",
      "Grace does not remove responsibility but gives strength for the assignment.",
      "A church becomes healthier when every member brings their portion faithfully.",
      "Forgiveness releases people from carrying yesterday into every conversation.",
      "The Spirit teaches courage that looks like patience mercy and steady witness.",
      "Families are strengthened when believers choose blessing instead of bitterness.",
      "Worship reminds tired hearts that Jesus is still worthy of trust.",
      "Generosity becomes discipleship when love notices practical needs around us.",
      "Leadership starts with serving people before anyone recognizes the title.",
      "Healing often begins when someone brings pain honestly before the Lord.",
      "The gospel gives identity that fear cannot rewrite during hard seasons.",
      "Wisdom helps the church respond with truth without losing compassion.",
      "Testimony carries hope because someone else can borrow courage from your story.",
      "Holiness is not performance but a life surrendered to the presence of God.",
      "Mission becomes ordinary when believers carry mercy into their workplace.",
      "Faithfulness in small places prepares the soul for larger stewardship.",
      "So this week take one obedient step and strengthen someone with your gift.",
    ];
    const segments = sermonLines.map((text, index) => ({
      startTimeSeconds: index * 100,
      endTimeSeconds: index * 100 + 10,
      text,
    }));

    const readiness = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(readiness.ready).toBe(false);
    expect(readiness.largeGapCount).toBeGreaterThan(2);
    expect(__clipIntelligenceTestUtils.isReviewOnlyTranscriptUsableForClipGeneration(readiness)).toBe(true);
    expect(__clipIntelligenceTestUtils.classifyTranscriptQualityForClipGeneration(readiness)).toBe("LOW_RESCUE");
  });

  it("classifies very sparse usable transcripts as low-rescue mode", () => {
    const sermonLines = [
      "God forms leaders through hidden obedience before public responsibility appears, and the church learns courage when ordinary people serve faithfully.",
      "The gift inside a believer becomes useful when courage answers the call to serve, pray, forgive, lead, and strengthen another person.",
      "Prayer keeps the heart tender when pressure wants to make faith defensive, because Jesus teaches patient mercy in hard seasons.",
      "Scripture shows Timothy receiving courage for ministry during difficulty, and that word still helps believers steward calling with discipline.",
      "Grace does not remove responsibility but gives strength for the assignment, so obedience becomes a response to mercy rather than performance.",
      "A church becomes healthier when every member brings their portion faithfully, serving the body with humility, honesty, and spiritual maturity.",
      "Forgiveness releases people from carrying yesterday into every conversation, and it opens a future where families can practice peace.",
      "The Spirit teaches courage that looks like patience, mercy, witness, and steady service when fear wants believers to hide.",
      "Families are strengthened when believers choose blessing instead of bitterness, because the gospel gives identity deeper than pain.",
      "Worship reminds tired hearts that Jesus is still worthy of trust, even when circumstances have not yet changed visibly.",
      "Generosity becomes discipleship when love notices practical needs, listens carefully, and responds with compassion instead of performance.",
      "Leadership starts with serving people before anyone recognizes the title, and faithful shepherds protect the flock with integrity.",
    ];
    const segments = sermonLines.map((text, index) => ({
      startTimeSeconds: index * 120,
      endTimeSeconds: index * 120 + 12,
      text,
    }));

    const readiness = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(readiness.ready).toBe(false);
    expect(__clipIntelligenceTestUtils.isReviewOnlyTranscriptUsableForClipGeneration(readiness)).toBe(true);
    expect(__clipIntelligenceTestUtils.classifyTranscriptQualityForClipGeneration(readiness)).toBe("LOW_RESCUE");
  });

  it("builds timed rescue candidates from low-confidence transcript islands", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "God forms leaders through hidden obedience and calls the church to serve with courage today.",
      },
      {
        startTimeSeconds: 118,
        endTimeSeconds: 130,
        text: "The gift inside believers becomes useful when faith answers pressure with prayer and action.",
      },
      {
        startTimeSeconds: 320,
        endTimeSeconds: 332,
        text: "Scripture teaches the church to lead with integrity and care for people faithfully.",
      },
      {
        startTimeSeconds: 338,
        endTimeSeconds: 350,
        text: "So this week choose one act of obedience and strengthen someone with your gift.",
      },
    ];

    const candidates = __clipIntelligenceTestUtils.buildLowTranscriptTimedFallbackCandidates(segments, {
      startTimeSeconds: 0,
      endTimeSeconds: 420,
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((candidate) => candidate.durationSeconds <= 90)).toBe(true);
    expect(candidates.every((candidate) => candidate.canonicalizationWarnings?.includes("LOW_TRANSCRIPT_TIMED_FALLBACK"))).toBe(true);
    expect(candidates.map((candidate) => candidate.reasonSelected).join(" ")).toContain("transcript-rescue timed option");
  });

  it("does not allow thin sparse transcripts into review-first clip generation", () => {
    const segments = Array.from({ length: 4 }, (_, index) => ({
      startTimeSeconds: index * 120,
      endTimeSeconds: index * 120 + 8,
      text: "Amen yes.",
    }));

    const readiness = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(readiness.ready).toBe(false);
    expect(__clipIntelligenceTestUtils.isReviewOnlyTranscriptUsableForClipGeneration(readiness)).toBe(false);
  });

  it("allows meaningful sparse transcripts into manual rescue mode", () => {
    const sermonLines = [
      "God gives courage for calling when the church feels pressure and every believer must answer with obedience.",
      "The gift is not for hiding but for serving people with prayer love patience and spiritual responsibility.",
      "Scripture teaches Timothy to stir up what God placed inside him because fear cannot lead the assignment.",
      "So choose one faithful step this week and strengthen somebody with the grace God already gave you today in ministry.",
    ];
    const segments = sermonLines.map((text, index) => ({
      startTimeSeconds: index * 35,
      endTimeSeconds: index * 35 + 14,
      text,
    }));

    const readiness = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(readiness.ready).toBe(false);
    expect(__clipIntelligenceTestUtils.isReviewOnlyTranscriptUsableForClipGeneration(readiness)).toBe(false);
    expect(__clipIntelligenceTestUtils.isManualRescueTranscriptUsableForClipGeneration(readiness)).toBe(true);
    expect(__clipIntelligenceTestUtils.classifyTranscriptQualityForClipGeneration(readiness)).toBe("MANUAL_RESCUE");
  });

  it("does not allow filler-only sparse transcripts into manual rescue mode", () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({
      startTimeSeconds: index * 30,
      endTimeSeconds: index * 30 + 8,
      text: "Amen amen yes okay hallelujah.",
    }));

    const readiness = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(readiness.ready).toBe(false);
    expect(__clipIntelligenceTestUtils.isReviewOnlyTranscriptUsableForClipGeneration(readiness)).toBe(false);
    expect(__clipIntelligenceTestUtils.isManualRescueTranscriptUsableForClipGeneration(readiness)).toBe(false);
    expect(__clipIntelligenceTestUtils.classifyTranscriptQualityForClipGeneration(readiness)).toBe("UNUSABLE");
  });

  it("splits rolling windows around large transcript gaps instead of rejecting both islands", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "God gives courage to serve the church with faithful obedience." },
      { startTimeSeconds: 13, endTimeSeconds: 25, text: "The gift inside believers becomes strength when it is used in love." },
      { startTimeSeconds: 26, endTimeSeconds: 38, text: "So this week choose one faithful act and encourage somebody in the body." },
      { startTimeSeconds: 39, endTimeSeconds: 51, text: "Grace is already available for the assignment God placed in your hand." },
      { startTimeSeconds: 120, endTimeSeconds: 132, text: "Prayer teaches the church to trust Jesus when pressure is heavy." },
      { startTimeSeconds: 133, endTimeSeconds: 145, text: "The Spirit gives courage for witness service and mercy in ordinary life." },
      { startTimeSeconds: 146, endTimeSeconds: 158, text: "So take the next step with faith and let your obedience become testimony." },
      { startTimeSeconds: 159, endTimeSeconds: 171, text: "God strengthens people through believers who show up with grace." },
    ];

    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some((window) => window.startTimeSeconds < 80 && window.endTimeSeconds > 100)).toBe(false);
    expect(windows.some((window) => window.startTimeSeconds < 60)).toBe(true);
    expect(windows.some((window) => window.startTimeSeconds >= 120)).toBe(true);
  });

  it("rejects transcript windows that have substance but no spoken landing", () => {
    const segments = [
      "Spiritual gifts matter in the life of the church and Paul writes about them with care.",
      "The background of Timothy's ministry helps us understand the pressure around leadership.",
      "The language of gift and calling appears throughout the passage in several important ways.",
      "The congregation can see how this theme connects to discipleship and church life.",
      "There are many observations in the text that shape how believers think about purpose.",
      "The sermon has now introduced the ideas of calling, courage, service, and community.",
      "These ideas create a framework for a later section of the message.",
      "The next section will bring the point together and explain the wider sermon argument.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(35);
    expect(quality.meaningfulSegmentCount).toBeGreaterThanOrEqual(3);
    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("WINDOW_NO_CLEAR_LANDING");
    expect(windows).toHaveLength(0);
  });

  it("rejects exposition-only divine statements that are not a clip landing", () => {
    const segments = [
      "The covenant history of Israel shows that God is faithful across many generations.",
      "Paul uses this theological foundation to help Timothy understand ministry responsibility.",
      "The phrase gift of God appears in a wider argument about calling and discipleship.",
      "Grace is described in the passage as a doctrine that shapes the church's identity.",
      "The sermon is tracing these ideas through the letter before reaching the application.",
      "This section explains the background and prepares the congregation for the main point.",
      "Several observations connect the text to courage service and spiritual formation.",
      "The next movement of the message will explain how believers should respond.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(35);
    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("WINDOW_NO_CLEAR_LANDING");
    expect(windows).toHaveLength(0);
  });

  it("keeps pastoral declarations that land with personal ministry payoff", () => {
    const segments = [
      "Fear tries to make obedience feel unsafe when the calling still matters.",
      "The gift of God can become quiet when disappointment has been speaking loudly.",
      "Paul reminds Timothy that courage is not personality but grace at work.",
      "The church is strengthened when believers serve with what God placed in them.",
      "God is not finished with the gift in you and grace is already available for obedience.",
      "The next faithful step may be small but it can strengthen somebody this week.",
      "Prayer service encouragement and presence are ways the body receives that gift.",
      "God strengthens the church when every believer brings what was placed in their hand.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(quality.accepted).toBe(true);
    expect(quality.windowQualityWarnings).not.toContain("WINDOW_NO_CLEAR_LANDING");
    expect(windows.length).toBeGreaterThan(0);
  });

  it("rejects repetitive windows even when they have enough words", () => {
    const repeatedSegments = Array.from({ length: 8 }, (_, index) => ({
      startTimeSeconds: index * 12,
      endTimeSeconds: index * 12 + 10,
      text: "God is faithful and God is faithful and God is faithful today.",
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(repeatedSegments, 96);

    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("REPETITIVE_WINDOW");
  });

  it("rejects windows padded with repeated filler instead of sermon substance", () => {
    const paddedFillerSegments = Array.from({ length: 8 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text: index === 3
        ? "The gift of God must be stirred through obedient service in the body."
        : "Amen come on church amen come on church amen come on church.",
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(paddedFillerSegments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(paddedFillerSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(35);
    expect(quality.distinctSermonTokenCount).toBeLessThan(12);
    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("LOW_WINDOW_DISTINCT_SERMON_SUBSTANCE");
    expect(windows).toHaveLength(0);
  });

  it("rejects setup-only transcript windows before AI clip selection", () => {
    const setupSegments = [
      "Today I want to show you the foundation of spiritual gifts in scripture.",
      "We are going to look at the background of Paul's letter to Timothy.",
      "Before we can understand obedience, we need to define calling and purpose.",
      "Let me explain the context, the culture, and the problem Timothy faced.",
      "The question is how a believer discovers what God has placed inside them.",
      "These notes will help us follow the sermon argument with clarity.",
      "We will look at three observations before we reach the main application.",
      "This background prepares us for the answer that comes later in the message.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(setupSegments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(setupSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(35);
    expect(quality.meaningfulSegmentCount).toBeGreaterThanOrEqual(3);
    expect(quality.accepted).toBe(false);
    expect(quality.windowQualityWarnings).toContain("WINDOW_SETUP_WITHOUT_LANDING");
    expect(windows).toHaveLength(0);
  });

  it("keeps a missing-landing window when a payoff is available in forward repair range", () => {
    const segments = [
      "Spiritual gifts matter in the life of the church and Paul writes about them with care.",
      "The background of Timothy's ministry helps us understand the pressure around leadership.",
      "The language of gift and calling appears throughout the passage in several important ways.",
      "The congregation can see how this theme connects to discipleship and church life.",
      "There are many observations in the text that shape how believers think about purpose.",
      "This framework explains why courage and service belong together.",
      "Paul is building the argument slowly before the final application.",
      "The thought is almost ready to land for the congregation.",
      "So this week choose one faithful act of service and stir up what God placed in your hand.",
    ].map((text, index) => ({
      startTimeSeconds: index < 8 ? index * 10 : 95,
      endTimeSeconds: index < 8 ? index * 10 + 8 : 110,
      text,
    }));

    const originalQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments.slice(0, 8), 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(originalQuality.accepted).toBe(false);
    expect(originalQuality.windowEligibility).toBe("REPAIRABLE");
    expect(originalQuality.windowQualityWarnings).toContain("WINDOW_NO_CLEAR_LANDING");
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.windowEligibility).toBe("REPAIRABLE");
    expect(windows[0]?.repairableWarnings).toContain("WINDOW_NO_CLEAR_LANDING");
    expect(windows[0]?.landingContextAvailable).toBe(true);
    expect(windows[0]?.suggestedExtendedEndTimeSeconds).toBe(110);
    expect(windows[0]?.endTimeSeconds).toBe(110);
    expect(windows[0]?.durationSeconds).toBeLessThanOrEqual(150);
    expect(windows[0]?.segments?.at(-1)?.segmentIndex).toBe((windows[0]?.segments?.length ?? 0) - 1);
  });

  it("keeps a setup-only window when adjacent context contains the actual payoff", () => {
    const segments = [
      "Today I want to show you the foundation of spiritual gifts in scripture.",
      "We are going to look at the background of Paul's letter to Timothy.",
      "Before we can understand obedience, we need to define calling and purpose.",
      "Let me explain the context, the culture, and the problem Timothy faced.",
      "The question is how a believer discovers what God has placed inside them.",
      "These notes will help us follow the sermon argument with clarity.",
      "We will look at three observations before we reach the main application.",
      "This background prepares us for the answer that comes later in the message.",
      "So this week choose one act of obedience and serve with what God gave you.",
    ].map((text, index) => ({
      startTimeSeconds: index < 8 ? index * 10 : 95,
      endTimeSeconds: index < 8 ? index * 10 + 8 : 110,
      text,
    }));

    const originalQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(segments.slice(0, 8), 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);

    expect(originalQuality.accepted).toBe(false);
    expect(originalQuality.windowQualityWarnings).toContain("WINDOW_SETUP_WITHOUT_LANDING");
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.windowEligibility).toBe("REPAIRABLE");
    expect(windows[0]?.repairableWarnings).toContain("WINDOW_SETUP_WITHOUT_LANDING");
    expect(windows[0]?.endTimeSeconds).toBe(110);
  });

  it("keeps a dependent opening when nearby setup can be included", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 18, text: "God has placed a gift in every believer for the building up of the church." },
      { startTimeSeconds: 18, endTimeSeconds: 35, text: "Faithful service is how that gift becomes encouragement to somebody else." },
      { startTimeSeconds: 55, endTimeSeconds: 66, text: "The calling is not meant to stay hidden when grace gives courage." },
      { startTimeSeconds: 80, endTimeSeconds: 84, text: "Grace gives courage for faithful obedience today." },
      { startTimeSeconds: 85, endTimeSeconds: 99, text: "That means obedience cannot wait until fear disappears." },
      { startTimeSeconds: 99, endTimeSeconds: 119, text: "So this week choose one faithful act of service and stir up your gift." },
      { startTimeSeconds: 119, endTimeSeconds: 141, text: "The church is strengthened when every believer brings what God placed in their hand." },
      { startTimeSeconds: 141, endTimeSeconds: 159, text: "Pray again, take the step, and encourage somebody in the body." },
    ];

    const windows = __clipIntelligenceTestUtils.buildRollingWindows(segments);
    const repairable = windows.find((window) => window.repairableWarnings?.includes("WINDOW_DEPENDENT_OPENING"));

    expect(repairable).toBeTruthy();
    expect(repairable?.windowEligibility).toBe("REPAIRABLE");
    expect(repairable?.startTimeSeconds).toBe(80);
    expect(repairable?.segments?.[0]?.segmentIndex).toBe(0);
  });

  it("ranks clean windows above repairable windows when quality is otherwise equal", () => {
    const ranked = __clipIntelligenceTestUtils.rankClipWindowsForSelection([
      {
        windowId: "repairable-window",
        startTimeSeconds: 0,
        endTimeSeconds: 80,
        durationSeconds: 80,
        transcriptText: "That means obedience matters. So this week choose one act of obedience.",
        segmentLines: ["0: [0.0 - 80.0] That means obedience matters. So this week choose one act of obedience."],
        wordCount: 72,
        meaningfulSegmentCount: 8,
        openingHookScore: 8,
        ministryPayoffScore: 8,
        windowQualityScore: 8.4,
        windowQualityWarnings: ["WINDOW_DEPENDENT_OPENING"],
        windowEligibility: "REPAIRABLE",
        repairableWarnings: ["WINDOW_DEPENDENT_OPENING"],
      },
      {
        windowId: "clean-window",
        startTimeSeconds: 300,
        endTimeSeconds: 380,
        durationSeconds: 80,
        transcriptText: "God gives courage for obedience. So this week choose one act of obedience.",
        segmentLines: ["0: [300.0 - 380.0] God gives courage for obedience. So this week choose one act of obedience."],
        wordCount: 72,
        meaningfulSegmentCount: 8,
        openingHookScore: 8,
        ministryPayoffScore: 8,
        windowQualityScore: 8.4,
        windowQualityWarnings: [],
        windowEligibility: "CLEAN",
        repairableWarnings: [],
      },
    ]);

    expect(ranked[0]?.windowId).toBe("clean-window");
  });

  it("keeps setup windows when the same window includes the actual sermon landing", () => {
    const landingSegments = [
      "Today I want to show you why faith matters when pressure gets loud.",
      "Scripture reminds Timothy that the gift of God must not stay buried.",
      "Fear tries to make obedience feel unsafe and unnecessary.",
      "But God gives courage through grace when the calling still matters.",
      "The point is that faith is not only agreement, it is obedient action.",
      "So this week choose one act of obedience and serve with what God gave you.",
      "Pray again, take the step, and encourage somebody in the body.",
      "God strengthens the church when every believer brings their gift.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(landingSegments, 80);
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(landingSegments);

    expect(quality.accepted).toBe(true);
    expect(quality.windowQualityWarnings).not.toContain("WINDOW_SETUP_WITHOUT_LANDING");
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.windowQualityScore).toBeGreaterThan(0);
  });

  it("scores windows with strong social openings above buried setup openings", () => {
    const setupOpening = [
      "Today I want to show you the background of Paul's words to Timothy.",
      "The passage gives us language about gift calling and purpose in the church.",
      "Fear tries to make obedience feel unsafe and unnecessary.",
      "But God gives courage through grace when the calling still matters.",
      "The point is that faith is not only agreement, it is obedient action.",
      "So this week choose one act of obedience and serve with what God gave you.",
      "Pray again, take the step, and encourage somebody in the body.",
      "God strengthens the church when every believer brings their gift.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));
    const strongOpening = [
      "What if fear has been louder than the gift God placed inside you?",
      "The passage gives us language about gift calling and purpose in the church.",
      "Fear tries to make obedience feel unsafe and unnecessary.",
      "But God gives courage through grace when the calling still matters.",
      "The point is that faith is not only agreement, it is obedient action.",
      "So this week choose one act of obedience and serve with what God gave you.",
      "Pray again, take the step, and encourage somebody in the body.",
      "God strengthens the church when every believer brings their gift.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));

    const setupQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(setupOpening, 80);
    const strongQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(strongOpening, 80);

    expect(setupQuality.accepted).toBe(true);
    expect(strongQuality.accepted).toBe(true);
    expect(strongQuality.openingHookScore).toBeGreaterThan(setupQuality.openingHookScore);
    expect(strongQuality.windowQualityScore).toBeGreaterThan(setupQuality.windowQualityScore);
  });

  it("ranks otherwise similar windows with stronger openings first", () => {
    const ranked = __clipIntelligenceTestUtils.rankClipWindowsForSelection([
      {
        windowId: "setup-window",
        startTimeSeconds: 0,
        endTimeSeconds: 80,
        durationSeconds: 80,
        transcriptText: "Today I want to show you the background. So this week choose one act of obedience.",
        segmentLines: ["0-80 Today I want to show you the background. So this week choose one act of obedience."],
        wordCount: 72,
        meaningfulSegmentCount: 8,
        openingHookScore: 4.4,
        windowQualityScore: 7.6,
        windowQualityWarnings: [],
      },
      {
        windowId: "strong-window",
        startTimeSeconds: 300,
        endTimeSeconds: 380,
        durationSeconds: 80,
        transcriptText: "What if fear has been louder than your calling? So this week choose one act of obedience.",
        segmentLines: ["300-380 What if fear has been louder than your calling? So this week choose one act of obedience."],
        wordCount: 72,
        meaningfulSegmentCount: 8,
        openingHookScore: 8.8,
        windowQualityScore: 8.4,
        windowQualityWarnings: [],
      },
    ]);

    expect(ranked[0]?.startTimeSeconds).toBe(300);
  });

  it("scores and ranks windows with stronger ministry payoff above generic teaching", () => {
    const genericTeaching = [
      "The background of this passage helps us understand why Paul writes to Timothy.",
      "Spiritual gifts matter in the church because they connect to calling and service.",
      "The language of gift appears in the letter as part of a wider teaching section.",
      "This doctrine shows that the church has responsibilities across generations.",
      "There are several observations that explain how ministry works in this passage.",
      "The next section will bring the argument toward a practical response.",
      "God gives gifts to the church and Scripture teaches that faith matters.",
      "This truth is important for how believers understand discipleship.",
    ].map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 8,
      text,
    }));
    const ministryClimax = [
      "Fear tries to make obedience feel unsafe when the calling still matters.",
      "Some of you have let disappointment make the gift of God quiet.",
      "But God has not forgotten what he placed in you for his church.",
      "Grace is already available for the assignment in front of you.",
      "So this week choose one act of obedience and serve somebody with courage.",
      "Pray again encourage the family and bring your gift back into the light.",
      "The church is strengthened when believers use what God placed in their hands.",
      "Your next faithful step may help somebody else keep walking with Jesus.",
    ].map((text, index) => ({
      startTimeSeconds: 300 + index * 10,
      endTimeSeconds: 300 + index * 10 + 8,
      text,
    }));

    const genericQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(genericTeaching, 80);
    const ministryQuality = __clipIntelligenceTestUtils.assessClipWindowQuality(ministryClimax, 80);
    const ranked = __clipIntelligenceTestUtils.rankClipWindowsForSelection([
      {
        windowId: "generic-window",
        startTimeSeconds: 0,
        endTimeSeconds: 80,
        durationSeconds: 80,
        transcriptText: genericTeaching.map((segment) => segment.text).join(" "),
        segmentLines: genericTeaching.map((segment) => segment.text),
        wordCount: genericQuality.wordCount,
        meaningfulSegmentCount: genericQuality.meaningfulSegmentCount,
        openingHookScore: genericQuality.openingHookScore,
        ministryPayoffScore: genericQuality.ministryPayoffScore,
        windowQualityScore: 8,
        windowQualityWarnings: [],
      },
      {
        windowId: "ministry-window",
        startTimeSeconds: 300,
        endTimeSeconds: 380,
        durationSeconds: 80,
        transcriptText: ministryClimax.map((segment) => segment.text).join(" "),
        segmentLines: ministryClimax.map((segment) => segment.text),
        wordCount: ministryQuality.wordCount,
        meaningfulSegmentCount: ministryQuality.meaningfulSegmentCount,
        openingHookScore: ministryQuality.openingHookScore,
        ministryPayoffScore: ministryQuality.ministryPayoffScore,
        windowQualityScore: 8,
        windowQualityWarnings: [],
      },
    ]);

    expect(genericQuality.accepted).toBe(true);
    expect(ministryQuality.accepted).toBe(true);
    expect(ministryQuality.ministryPayoffScore).toBeGreaterThan(genericQuality.ministryPayoffScore);
    expect(ministryQuality.windowQualityScore).toBeGreaterThan(genericQuality.windowQualityScore);
    expect(ranked[0]?.startTimeSeconds).toBe(300);
  });

  it("scopes ministry moment prompt context to the current transcript window batch", () => {
    const windows = [{
      windowId: "weary-window",
      startTimeSeconds: 880,
      endTimeSeconds: 1010,
      durationSeconds: 130,
      transcriptText: "If your heart feels tired, God gives strength in prayer.",
      segmentLines: ["[900.00-930.00] If your heart feels tired, God gives strength in prayer."],
      wordCount: 60,
      meaningfulSegmentCount: 5,
      windowQualityScore: 8.4,
      windowQualityWarnings: [],
    }];
    const selected = __clipIntelligenceTestUtils.selectPromptMinistryMomentsForWindows(windows, [
      {
        id: "opening",
        momentType: "PRAYER_MOMENT",
        title: "Opening prayer",
        description: "The pastor opens the service.",
        startTimeSeconds: 20,
        endTimeSeconds: 80,
        confidenceScore: 0.98,
        transcriptExcerpt: "Lord bless this service",
        whyDetected: "Opening prayer.",
        suggestedAudience: "Church",
        suggestedUsage: "Opening context",
        clipCategory: "Best Prayer Clip",
      },
      {
        id: "weary",
        momentType: "PRAYER_MOMENT",
        title: "Prayer for weary hearts",
        description: "The pastor prays for tired people to receive strength.",
        startTimeSeconds: 900,
        endTimeSeconds: 970,
        confidenceScore: 0.91,
        transcriptExcerpt: "If your heart feels tired, God gives strength in prayer",
        whyDetected: "Direct pastoral prayer.",
        suggestedAudience: "People who feel tired",
        suggestedUsage: "Prayer encouragement clip",
        clipCategory: "Best Prayer Clip",
      },
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.title).toBe("Prayer for weary hearts");
  });

  it("scores overlapping ministry moments above distant moments", () => {
    const windows = [{
      windowId: "overlap-window",
      startTimeSeconds: 600,
      endTimeSeconds: 720,
      durationSeconds: 120,
      transcriptText: "The pastor teaches a complete discipleship application.",
      segmentLines: ["[600.00-620.00] The pastor teaches a complete discipleship application."],
      wordCount: 75,
      meaningfulSegmentCount: 6,
      windowQualityScore: 8.6,
      windowQualityWarnings: [],
    }];
    const overlapping = {
      id: "overlap",
      momentType: "FAITH_DECLARATION",
      title: "Faith application",
      description: "Faith application overlaps the batch.",
      startTimeSeconds: 630,
      endTimeSeconds: 690,
      confidenceScore: 0.72,
      transcriptExcerpt: "faith application",
      whyDetected: "Faith language.",
      suggestedAudience: "Believers",
      suggestedUsage: "Discipleship clip",
      clipCategory: "Best Discipleship Clip",
    };
    const distant = {
      ...overlapping,
      id: "distant",
      title: "Distant faith moment",
      startTimeSeconds: 1400,
      endTimeSeconds: 1460,
      confidenceScore: 0.99,
    };

    expect(__clipIntelligenceTestUtils.scoreMomentForWindows(overlapping, windows)).toBeGreaterThan(
      __clipIntelligenceTestUtils.scoreMomentForWindows(distant, windows),
    );
  });

  it("blocks sparse transcripts before weak clips can be generated", () => {
    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping([
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Amen." },
      { startTimeSeconds: 10, endTimeSeconds: 20, text: "Yes." },
    ]);

    expect(result.ready).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("blocks transcripts with large unexplained coverage gaps", () => {
    const segments = Array.from({ length: 10 }, (_, index) => ({
      startTimeSeconds: index * 220,
      endTimeSeconds: index * 220 + 12,
      text: "Faith keeps walking when pressure comes because God is still faithful to his people today.",
    }));

    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(result.ready).toBe(false);
    expect(result.reason).toContain("coverage");
    expect(result.maxGapSeconds).toBeGreaterThan(150);
  });

  it("blocks repetitive transcript output before weak clips can be generated", () => {
    const segments = Array.from({ length: 12 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text: "God is faithful and God is faithful and God is faithful today.",
    }));

    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(result.ready).toBe(false);
    expect(result.reason).toContain("repetitive");
    expect(result.repeatedSegmentRatio).toBeGreaterThan(0.28);
  });

  it("blocks near-repeated transcript substance before weak clips can be generated", () => {
    const segments = Array.from({ length: 12 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text: `Faith prayer strength mercy grace blessing courage today ${index} faith prayer strength mercy grace blessing courage today.`,
    }));

    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(result.ready).toBe(false);
    expect(result.reason).toContain("distinct sermon substance");
    expect(result.repeatedSegmentRatio).toBe(0);
    expect(result.distinctSermonTokenRatio).toBeLessThan(0.38);
  });

  it("blocks coarse transcript timing before imprecise clips can be generated", () => {
    const segments = [
      "Faith keeps walking when pressure comes because God is still faithful to his people today.",
      "Paul tells Timothy to stir up the gift that was placed inside him by prayer.",
      "That means spiritual gifts can become quiet when fear and disappointment take over.",
      "But the Spirit of God has not given us fear but power love and discipline.",
      "Some of you have been waiting for confidence when obedience is the doorway to courage.",
      "The church needs what God placed in you because ministry is not only for the platform.",
      "When you serve with your gift another believer receives strength for their own journey.",
      "So this week take one practical step and use what is already in your hand.",
      "Pray again call the person encourage the family and show up with faith.",
      "God is not finished with the gift and he is not finished with your obedience.",
      "The moment you move in faith you discover grace was already available for the assignment.",
      "Do not bury what heaven gave you because someone needs the testimony in your mouth.",
    ].map((text, index) => ({
      startTimeSeconds: index * 52,
      endTimeSeconds: index * 52 + 50,
      text,
    }));

    const result = __clipIntelligenceTestUtils.assessTranscriptReadinessForClipping(segments);

    expect(result.ready).toBe(false);
    expect(result.reason).toContain("timestamps are too coarse");
    expect(result.warnings).toContain("COARSE_TRANSCRIPT_TIMING");
    expect(result.averageSegmentDurationSeconds).toBeGreaterThanOrEqual(38);
  });

  it("accepts AI clip excerpts that are grounded in the transcript range", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "Paul tells Timothy to stir up the gift of God that is already inside him.",
      },
      {
        startTimeSeconds: 112,
        endTimeSeconds: 124,
        text: "That means fear cannot be the leader of your obedience anymore.",
      },
      {
        startTimeSeconds: 124,
        endTimeSeconds: 136,
        text: "You take the next faithful step with what God has placed in your hand.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateTranscriptGrounding({
      candidateTranscriptText: "Paul tells Timothy to stir up the gift of God that is already inside him. That means fear cannot be the leader of your obedience anymore.",
      startTimeSeconds: 100,
      endTimeSeconds: 124,
      segments,
    });

    expect(result.accepted).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.orderedFlowRatio).toBe(1);
  });

  it("accepts candidates only when the selected range contains the spoken sermon landing", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "Paul tells Timothy to stir up the gift of God that is already inside him.",
      },
      {
        startTimeSeconds: 112,
        endTimeSeconds: 124,
        text: "Fear tries to make obedience feel unsafe and unnecessary.",
      },
      {
        startTimeSeconds: 124,
        endTimeSeconds: 136,
        text: "So this week choose one act of obedience and serve with what God placed in your hand.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 126,
        applicationTime: 130,
        landingSentence: "So this week choose one act of obedience and serve with what God placed in your hand.",
        reasonSelected: "The landing is the call to choose one act of obedience.",
        whyThisClipFeelsComplete: "The clip moves from scripture to fear to a practical obedience application.",
      },
      startTimeSeconds: 100,
      endTimeSeconds: 136,
      segments,
    });

    expect(result.accepted).toBe(true);
    expect(result.hasLanding).toBe(true);
    expect(result.checkedArcTimes).toBe(2);
    expect(result.landingClaimGrounded).toBe(true);
    expect(result.landingClaimMatchedTokens).toBeGreaterThanOrEqual(2);
  });

  it("rejects candidates whose claimed landing is only exposition about a future response", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "The covenant history shows that God is faithful across many generations.",
      },
      {
        startTimeSeconds: 112,
        endTimeSeconds: 124,
        text: "Paul uses this foundation to help Timothy understand ministry responsibility.",
      },
      {
        startTimeSeconds: 124,
        endTimeSeconds: 136,
        text: "The next movement of the message will explain how believers should respond.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 110,
        applicationTime: 132,
        landingSentence: "The next movement of the message will explain how believers should respond.",
        reasonSelected: "The clip sets up how believers should respond.",
        whyThisClipFeelsComplete: "The candidate explains theological background and points to a future response.",
      },
      startTimeSeconds: 100,
      endTimeSeconds: 136,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.hasLanding).toBe(false);
    expect(result.reason).toContain("does not include a clear spoken landing");
  });

  it("rejects candidates when the explicit landing sentence is not in the selected transcript", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "Paul tells Timothy to stir up the gift of God that is already inside him.",
      },
      {
        startTimeSeconds: 112,
        endTimeSeconds: 124,
        text: "Fear tries to make obedience feel unsafe and unnecessary.",
      },
      {
        startTimeSeconds: 124,
        endTimeSeconds: 136,
        text: "So this week choose one act of obedience and serve with what God placed in your hand.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 126,
        applicationTime: 130,
        landingSentence: "God will restore your finances and unlock a hidden miracle this week.",
        reasonSelected: "The landing is the call to choose one act of obedience.",
        whyThisClipFeelsComplete: "The clip moves from scripture to fear to a practical obedience application.",
      },
      startTimeSeconds: 100,
      endTimeSeconds: 136,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.hasLanding).toBe(true);
    expect(result.landingClaimGrounded).toBe(false);
    expect(result.reason).toContain("Landing sentence is not grounded");
  });

  it("rejects candidates when the AI claims a generic landing instead of grounded spoken evidence", () => {
    const segments = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 112,
        text: "Paul tells Timothy to stir up the gift of God that is already inside him.",
      },
      {
        startTimeSeconds: 112,
        endTimeSeconds: 124,
        text: "Fear tries to make obedience feel unsafe and unnecessary.",
      },
      {
        startTimeSeconds: 124,
        endTimeSeconds: 136,
        text: "So this week choose one act of obedience and serve with what God placed in your hand.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 126,
        applicationTime: 130,
        reasonSelected: "This is a strong teaching moment with a clear practical application.",
        landingSentence: "A strong teaching moment with practical application.",
        whyThisClipFeelsComplete: "The clip feels complete and useful for social media.",
      },
      startTimeSeconds: 100,
      endTimeSeconds: 136,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.hasLanding).toBe(true);
    expect(result.landingClaimGrounded).toBe(false);
    expect(result.reason).toContain("Landing sentence is not grounded");
  });

  it("rejects setup-only candidate ranges before they can be scored as pastor-grade", () => {
    const segments = [
      {
        startTimeSeconds: 200,
        endTimeSeconds: 212,
        text: "Today I want to show you the foundation of spiritual gifts in scripture.",
      },
      {
        startTimeSeconds: 212,
        endTimeSeconds: 224,
        text: "We are going to look at the background of Paul's letter to Timothy.",
      },
      {
        startTimeSeconds: 224,
        endTimeSeconds: 236,
        text: "Before we can understand obedience, we need to define calling and purpose.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 232,
        applicationTime: null,
        reasonSelected: "The pastor sets up a strong teaching about calling.",
        landingSentence: "Today I want to show you the foundation of spiritual gifts in scripture.",
        whyThisClipFeelsComplete: "The setup introduces the topic.",
      },
      startTimeSeconds: 200,
      endTimeSeconds: 236,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("does not include a clear spoken landing");
  });

  it("rejects candidates when claimed payoff or application timestamps sit outside the selected clip", () => {
    const segments = [
      {
        startTimeSeconds: 300,
        endTimeSeconds: 312,
        text: "The church grows stronger when every member brings their gift to the body.",
      },
      {
        startTimeSeconds: 312,
        endTimeSeconds: 324,
        text: "This week choose one act of obedience and serve with what is already in your hand.",
      },
      {
        startTimeSeconds: 324,
        endTimeSeconds: 336,
        text: "God strengthens the church when every believer brings their gift.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateLandingEvidence({
      candidate: {
        payoffTime: 390,
        applicationTime: 318,
        reasonSelected: "The clip lands with the call to serve this week.",
        landingSentence: "This week choose one act of obedience and serve with what is already in your hand.",
        whyThisClipFeelsComplete: "The clip includes practical application.",
      },
      startTimeSeconds: 300,
      endTimeSeconds: 336,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("payoffTime");
    expect(result.reason).toContain("outside the selected clip range");
  });

  it("rejects polished AI excerpts that are not supported by the transcript timestamps", () => {
    const segments = [
      {
        startTimeSeconds: 200,
        endTimeSeconds: 212,
        text: "The church grows stronger when every member brings their gift to the body.",
      },
      {
        startTimeSeconds: 212,
        endTimeSeconds: 224,
        text: "This week choose one act of obedience and serve with what is already in your hand.",
      },
      {
        startTimeSeconds: 224,
        endTimeSeconds: 236,
        text: "Do not wait for another confirmation when God has already spoken clearly.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateTranscriptGrounding({
      candidateTranscriptText: "The pastor delivers a powerful testimony about supernatural financial breakthrough and generational healing.",
      startTimeSeconds: 200,
      endTimeSeconds: 236,
      segments,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("not sufficiently grounded");
    expect(result.score).toBeLessThan(0.5);
  });

  it("rejects reordered sermon words that are not faithful to the spoken phrase order", () => {
    const segments = [
      {
        startTimeSeconds: 200,
        endTimeSeconds: 212,
        text: "The church grows stronger when every member brings their gift to the body.",
      },
      {
        startTimeSeconds: 212,
        endTimeSeconds: 224,
        text: "This week choose one act of obedience and serve with what is already in your hand.",
      },
      {
        startTimeSeconds: 224,
        endTimeSeconds: 236,
        text: "Do not wait for another confirmation when God has already spoken clearly.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateTranscriptGrounding({
      candidateTranscriptText: "Gift body stronger member grows bring obedience choose week hand serve confirmation wait God clearly spoken.",
      startTimeSeconds: 200,
      endTimeSeconds: 236,
      segments,
    });

    expect(result.matchedTokens).toBe(result.tokenCount);
    expect(result.accepted).toBe(false);
    expect(result.matchedBigrams).toBeLessThan(result.bigramCount);
    expect(result.orderedFlowRatio).toBeLessThan(0.82);
  });

  it("rejects stitched excerpts that reuse real phrases in the wrong sermon flow", () => {
    const segments = [
      {
        startTimeSeconds: 300,
        endTimeSeconds: 312,
        text: "Faith keeps walking when pressure comes because God is still faithful to his people today.",
      },
      {
        startTimeSeconds: 312,
        endTimeSeconds: 324,
        text: "The scripture teaches us to stir up the gift that God has already placed inside us.",
      },
      {
        startTimeSeconds: 324,
        endTimeSeconds: 336,
        text: "Obedience becomes the doorway to courage when fear tries to silence your calling.",
      },
    ];

    const result = __clipIntelligenceTestUtils.assessCandidateTranscriptGrounding({
      candidateTranscriptText: "Obedience becomes the doorway to courage. The scripture teaches us to stir up the gift. Faith keeps walking when pressure comes.",
      startTimeSeconds: 300,
      endTimeSeconds: 336,
      segments,
    });

    expect(result.matchedTokens).toBe(result.tokenCount);
    expect(result.matchedBigrams).toBeGreaterThan(0);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("ordered flow");
    expect(result.orderedFlowRatio).toBeLessThan(0.82);
  });

  it("repairs a missing landing by extending to an actual transcript segment boundary", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives every believer a gift for the body." },
      { startTimeSeconds: 20, endTimeSeconds: 40, text: "Fear tries to make obedience feel unsafe." },
      { startTimeSeconds: 40, endTimeSeconds: 58, text: "So this week choose one faithful act of service and stir up your gift." },
    ];
    const candidate = {
      startTimeSeconds: 0,
      endTimeSeconds: 40,
      durationSeconds: 40,
      transcriptText: "God gives every believer a gift for the body. Fear tries to make obedience feel unsafe.",
      reasonSelected: "Grounded gift teaching.",
      riskReasons: [],
      originalStartTimeSeconds: 0,
      originalEndTimeSeconds: 40,
      adjustedStartTimeSeconds: 0,
      adjustedEndTimeSeconds: 40,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const repaired = __clipIntelligenceTestUtils.repairMissingLanding(candidate as never, segments) as unknown as {
      adjusted: boolean;
      candidate: { endTimeSeconds: number; transcriptText: string; boundaryQuality: string };
      warnings: string[];
      coverage: { transcriptLimitedEnding: boolean };
    };

    expect(repaired.adjusted).toBe(true);
    expect(repaired.candidate.endTimeSeconds).toBe(58);
    expect(repaired.candidate.transcriptText).toContain("So this week choose");
    expect(repaired.candidate.boundaryQuality).toBe("GOOD");
    expect(repaired.warnings).toContain("LANDING_REPAIRED");
    expect(repaired.warnings).not.toContain("NEEDS_END_TRIM");
    expect(repaired.warnings).not.toContain("REVIEW_ENDING");
  });

  it("keeps unresolved missing landing candidates as reviewable warnings when transcript coverage ends", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives every believer a gift for the body." },
      { startTimeSeconds: 20, endTimeSeconds: 40, text: "Fear tries to make obedience feel unsafe." },
    ];
    const candidate = {
      startTimeSeconds: 0,
      endTimeSeconds: 40,
      durationSeconds: 40,
      transcriptText: "God gives every believer a gift for the body. Fear tries to make obedience feel unsafe.",
      reasonSelected: "Grounded gift teaching.",
      riskReasons: [],
      originalStartTimeSeconds: 0,
      originalEndTimeSeconds: 40,
      adjustedStartTimeSeconds: 0,
      adjustedEndTimeSeconds: 40,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const repaired = __clipIntelligenceTestUtils.repairMissingLanding(candidate as never, segments) as unknown as {
      adjusted: boolean;
      candidate: { boundaryQuality: string };
      warnings: string[];
      coverage: { transcriptLimitedEnding: boolean };
    };

    expect(repaired.adjusted).toBe(false);
    expect(repaired.candidate.boundaryQuality).toBe("NEEDS_REVIEW");
    expect(repaired.warnings).toContain("TRANSCRIPT_LIMITED_ENDING");
    expect(repaired.coverage.transcriptLimitedEnding).toBe(true);
  });

  it("repairs dependent openings by moving the start boundary to a stronger setup segment", () => {
    const segments = [
      { startTimeSeconds: 100, endTimeSeconds: 110, text: "Every gift God gives carries a responsibility to serve faithfully." },
      { startTimeSeconds: 110, endTimeSeconds: 124, text: "And that is why you cannot bury what heaven placed inside you." },
      { startTimeSeconds: 124, endTimeSeconds: 145, text: "Use it this week to strengthen someone else's faith." },
    ];
    const candidate = {
      startTimeSeconds: 110,
      endTimeSeconds: 145,
      durationSeconds: 35,
      transcriptText: "And that is why you cannot bury what heaven placed inside you. Use it this week to strengthen someone else's faith.",
      reasonSelected: "Clear teaching about spiritual gifts.",
      riskReasons: [],
      originalStartTimeSeconds: 110,
      originalEndTimeSeconds: 145,
      adjustedStartTimeSeconds: 110,
      adjustedEndTimeSeconds: 145,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const repaired = __clipIntelligenceTestUtils.repairWeakOpening(candidate as never, segments) as unknown as {
      adjusted: boolean;
      candidate: { startTimeSeconds: number; durationSeconds: number; transcriptText: string; boundaryQuality: string };
      warnings: string[];
      details: { succeeded: boolean; searchDistanceSeconds: number; reason: string };
    };

    expect(repaired.adjusted).toBe(true);
    expect(repaired.candidate.startTimeSeconds).toBe(100);
    expect(repaired.candidate.durationSeconds).toBe(45);
    expect(repaired.candidate.transcriptText).toMatch(/^Every gift God gives/);
    expect(repaired.candidate.boundaryQuality).toBe("GOOD");
    expect(repaired.warnings).toContain("OPENING_REPAIRED");
    expect(repaired.warnings).not.toContain("NEEDS_START_TRIM");
    expect(repaired.details.succeeded).toBe(true);
    expect(repaired.details.searchDistanceSeconds).toBe(10);
  });

  it("keeps dependent openings reviewable when no stronger setup exists inside the repair window", () => {
    const segments = [
      { startTimeSeconds: 70, endTimeSeconds: 88, text: "Every believer has a gift from God." },
      { startTimeSeconds: 110, endTimeSeconds: 124, text: "And that is why you cannot bury what heaven placed inside you." },
      { startTimeSeconds: 124, endTimeSeconds: 145, text: "Use it this week to strengthen someone else's faith." },
    ];
    const candidate = {
      startTimeSeconds: 110,
      endTimeSeconds: 145,
      durationSeconds: 35,
      transcriptText: "And that is why you cannot bury what heaven placed inside you. Use it this week to strengthen someone else's faith.",
      reasonSelected: "Clear teaching about spiritual gifts.",
      riskReasons: [],
      originalStartTimeSeconds: 110,
      originalEndTimeSeconds: 145,
      adjustedStartTimeSeconds: 110,
      adjustedEndTimeSeconds: 145,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const repaired = __clipIntelligenceTestUtils.repairWeakOpening(candidate as never, segments) as unknown as {
      adjusted: boolean;
      candidate: { startTimeSeconds: number; boundaryQuality: string };
      warnings: string[];
      details: { succeeded: boolean; reason: string };
    };

    expect(repaired.adjusted).toBe(false);
    expect(repaired.candidate.startTimeSeconds).toBe(110);
    expect(repaired.candidate.boundaryQuality).toBe("NEEDS_REVIEW");
    expect(repaired.warnings).toContain("NEEDS_START_TRIM");
    expect(repaired.details.succeeded).toBe(false);
    expect(repaired.details.reason).toContain("no stronger setup");
  });

  it("keeps a clean sermon-boundary clamp post-ready eligible when final validation passes", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives every believer a gift for the body." },
      { startTimeSeconds: 20, endTimeSeconds: 40, text: "Fear tries to make obedience feel unsafe." },
      { startTimeSeconds: 40, endTimeSeconds: 58, text: "So this week choose one faithful act of service and stir up your gift." },
    ];
    const candidate = {
      startTimeSeconds: 0,
      endTimeSeconds: 66,
      durationSeconds: 66,
      transcriptText: "God gives every believer a gift for the body. Fear tries to make obedience feel unsafe. So this week choose one faithful act of service and stir up your gift.",
      reasonSelected: "Grounded gift teaching.",
      riskReasons: [],
      originalStartTimeSeconds: 0,
      originalEndTimeSeconds: 66,
      adjustedStartTimeSeconds: 0,
      adjustedEndTimeSeconds: 66,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const clamped = __clipIntelligenceTestUtils.clampCandidateToBounds(candidate as never, segments, {
      endTimeSeconds: 58,
    }) as unknown as {
      adjusted: boolean;
      candidate: { endTimeSeconds: number; durationSeconds: number; boundaryQuality: string };
      warnings: string[];
    };

    expect(clamped.adjusted).toBe(true);
    expect(clamped.candidate.endTimeSeconds).toBe(58);
    expect(clamped.candidate.durationSeconds).toBe(58);
    expect(clamped.candidate.boundaryQuality).toBe("GOOD");
    expect(clamped.warnings).toEqual(["SERMON_BOUNDARY_CLAMPED"]);
  });

  it("trims long rescued candidates to a 45-90 second subrange before scoring", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 15, text: "Earlier setup explains the wider sermon background." },
      { startTimeSeconds: 15, endTimeSeconds: 30, text: "More setup continues before the strongest standalone point." },
      { startTimeSeconds: 30, endTimeSeconds: 45, text: "God gives every believer dignity and calling in the church." },
      { startTimeSeconds: 45, endTimeSeconds: 60, text: "The gospel teaches us to see people through grace and truth." },
      { startTimeSeconds: 60, endTimeSeconds: 75, text: "Men and women are created by God with dignity." },
      { startTimeSeconds: 75, endTimeSeconds: 90, text: "We are all equal before God the Father." },
      { startTimeSeconds: 90, endTimeSeconds: 105, text: "So honor one another and serve with humility this week." },
      { startTimeSeconds: 105, endTimeSeconds: 120, text: "The church is stronger when everyone obeys God faithfully." },
    ];
    const candidate = {
      startTimeSeconds: 0,
      endTimeSeconds: 120,
      durationSeconds: 120,
      transcriptText: segments.map((segment) => segment.text).join(" "),
      title: "Neither Their Sex Has a Spiritual Advantage Greater Access",
      hook: "Neither sex has a greater spiritual advantage.",
      caption: "We are all equal before God.",
      hashtags: [],
      score: 8.2,
      clipType: "teaching",
      smartClipCategory: "Best Discipleship Clip",
      intendedAudience: "Church members.",
      ministryValue: "Grounded teaching.",
      socialValue: "Clear takeaway.",
      reasonSelected: "Grounded equality teaching.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
      originalStartTimeSeconds: 0,
      originalEndTimeSeconds: 120,
      adjustedStartTimeSeconds: 0,
      adjustedEndTimeSeconds: 120,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const trimmed = __clipIntelligenceTestUtils.trimCandidateToShortSubrange(candidate as never, segments) as unknown as {
      adjusted: boolean;
      candidate: { startTimeSeconds: number; durationSeconds: number; title: string; transcriptText: string; boundaryQuality: string };
    };

    expect(trimmed.adjusted).toBe(true);
    expect(trimmed.candidate.startTimeSeconds).toBe(30);
    expect(trimmed.candidate.durationSeconds).toBe(90);
    expect(trimmed.candidate.boundaryQuality).toBe("GOOD");
    expect(trimmed.candidate.title).toBe("Equal Before God");
    expect(trimmed.candidate.transcriptText).not.toContain("Earlier setup");
  });

  it("marks invalid final timing as bad during deterministic revalidation", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives every believer a gift for the body." },
      { startTimeSeconds: 20, endTimeSeconds: 40, text: "So this week choose one faithful act of service." },
    ];
    const candidate = {
      startTimeSeconds: 30,
      endTimeSeconds: 20,
      durationSeconds: -10,
      transcriptText: "So this week choose one faithful act of service.",
      reasonSelected: "Invalid timing fixture.",
      riskReasons: [],
      originalStartTimeSeconds: 30,
      originalEndTimeSeconds: 20,
      adjustedStartTimeSeconds: 30,
      adjustedEndTimeSeconds: 20,
      boundaryAdjustmentReason: "Boundary kept.",
      boundaryQuality: "GOOD" as const,
    };

    const revalidated = __clipIntelligenceTestUtils.revalidateCandidateBoundary(candidate as never, segments) as unknown as {
      candidate: { boundaryQuality: string };
      unresolvedWarnings: string[];
    };

    expect(revalidated.candidate.boundaryQuality).toBe("BAD");
    expect(revalidated.unresolvedWarnings).toContain("INVALID_BOUNDARY");
  });

  it("rejects AI window ids and segment indexes that reference another batch", () => {
    const windows = [{
      windowId: "batch-window-1",
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      durationSeconds: 60,
      transcriptText: "God gives courage to serve. So this week choose obedience.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 100, endTimeSeconds: 120, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 120, endTimeSeconds: 160, text: "So this week choose obedience." },
      ],
      segmentLines: [
        "0: [100.0 - 120.0] God gives courage to serve.",
        "1: [120.0 - 160.0] So this week choose obedience.",
      ],
      wordCount: 40,
      meaningfulSegmentCount: 2,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      windowId: "other-window",
      startSegmentIndex: 0,
      endSegmentIndex: 1,
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      durationSeconds: 60,
      transcriptText: "God gives courage to serve. So this week choose obedience.",
      title: "Serve With Courage",
      hook: "God gives courage to serve.",
      caption: "Choose obedience this week.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "So this week choose obedience lands the point.",
      landingSentence: "So this week choose obedience.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
      arcType: "PROBLEM_TRUTH_APPLICATION" as const,
      arcSummary: "Truth and application.",
      setupStartTime: 100,
      mainPointTime: 115,
      payoffTime: 145,
      applicationTime: 150,
      whyThisClipFeelsComplete: "The application lands.",
      whatContextMightBeMissing: null,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate], windows);

    expect(result.candidates).toHaveLength(0);
    expect(result.rejectedReasons[0]).toContain("OUTSIDE_BATCH");
  });

  it("normalizes indexed AI candidates from actual window segments", () => {
    const windows = [{
      windowId: "window-4-10120-10210",
      startTimeSeconds: 10120,
      endTimeSeconds: 10210,
      durationSeconds: 90,
      transcriptText: "God gives courage to serve. Fear does not get the final word. So this week choose obedience and serve with your gift.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 10120, endTimeSeconds: 10140, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 10140, endTimeSeconds: 10170, text: "Fear does not get the final word." },
        { segmentIndex: 2, startTimeSeconds: 10170, endTimeSeconds: 10210, text: "So this week choose obedience and serve with your gift." },
      ],
      segmentLines: [
        "0: [10120.0 - 10140.0] God gives courage to serve.",
        "1: [10140.0 - 10170.0] Fear does not get the final word.",
        "2: [10170.0 - 10210.0] So this week choose obedience and serve with your gift.",
      ],
      wordCount: 22,
      meaningfulSegmentCount: 3,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      windowId: "window-4-10120-10210",
      startSegmentIndex: 1,
      endSegmentIndex: 2,
      hookSegmentIndex: 1,
      landingSegmentIndex: 2,
      title: "Serve With Your Gift",
      hook: "Fear does not get the final word.",
      caption: "Choose obedience and serve with your gift.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "So this week choose obedience and serve with your gift lands the point.",
      landingSentence: "So this week choose obedience and serve with your gift.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate] as never, windows);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].startTimeSeconds).toBe(10140);
    expect(result.candidates[0].endTimeSeconds).toBe(10210);
    expect(result.candidates[0].durationSeconds).toBe(70);
    expect(result.candidates[0].transcriptText).toBe("Fear does not get the final word. So this week choose obedience and serve with your gift.");
    expect(result.candidates[0].responseFormat).toBe("INDEXED");
  });

  it("lets indexes win when AI timestamps and transcript text disagree", () => {
    const windows = [{
      windowId: "window-4-10120-10210",
      startTimeSeconds: 10120,
      endTimeSeconds: 10210,
      durationSeconds: 90,
      transcriptText: "God gives courage to serve. So this week choose obedience and serve with your gift.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 10120, endTimeSeconds: 10140, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 10140, endTimeSeconds: 10210, text: "So this week choose obedience and serve with your gift." },
      ],
      segmentLines: [
        "0: [10120.0 - 10140.0] God gives courage to serve.",
        "1: [10140.0 - 10210.0] So this week choose obedience and serve with your gift.",
      ],
      wordCount: 16,
      meaningfulSegmentCount: 2,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      windowId: "window-4-10120-10210",
      startSegmentIndex: 0,
      endSegmentIndex: 1,
      landingSegmentIndex: 1,
      startTimeSeconds: 0,
      endTimeSeconds: 60,
      durationSeconds: 60,
      transcriptText: "Invented replacement transcript.",
      title: "Serve With Your Gift",
      hook: "God gives courage to serve.",
      caption: "Choose obedience and serve with your gift.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "So this week choose obedience and serve with your gift lands the point.",
      landingSentence: "So this week choose obedience and serve with your gift.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate], windows);

    expect(result.candidates[0].startTimeSeconds).toBe(10120);
    expect(result.candidates[0].endTimeSeconds).toBe(10210);
    expect(result.candidates[0].transcriptText).toBe("God gives courage to serve. So this week choose obedience and serve with your gift.");
    expect(result.formatWarnings.join(" ")).toContain("INDEX_TIMESTAMP_DISAGREEMENT");
    expect(result.formatWarnings.join(" ")).toContain("INDEX_TRANSCRIPT_DISAGREEMENT");
  });

  it("rejects invalid indexed segment boundaries", () => {
    const windows = [{
      windowId: "window-index-test",
      startTimeSeconds: 0,
      endTimeSeconds: 80,
      durationSeconds: 80,
      transcriptText: "God gives courage to serve. So this week choose obedience and serve with your gift. Faith keeps walking with courage.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 20, endTimeSeconds: 55, text: "So this week choose obedience and serve with your gift." },
        { segmentIndex: 2, startTimeSeconds: 55, endTimeSeconds: 80, text: "Faith keeps walking with courage." },
      ],
      segmentLines: [
        "0: [0.0 - 20.0] God gives courage to serve.",
        "1: [20.0 - 55.0] So this week choose obedience and serve with your gift.",
        "2: [55.0 - 80.0] Faith keeps walking with courage.",
      ],
      wordCount: 18,
      meaningfulSegmentCount: 3,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      windowId: windows[0].windowId,
      startSegmentIndex: 0,
      endSegmentIndex: 99,
      landingSegmentIndex: 0,
      title: "Serve With Your Gift",
      hook: "God gives courage to serve.",
      caption: "Choose obedience.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "Choose obedience lands the point.",
      landingSentence: "Choose obedience.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate] as never, windows);

    expect(result.candidates).toHaveLength(0);
    expect(result.rejectedReasons.join(" ")).toContain("INVALID_SEGMENT_INDEX");
  });

  it("rejects indexed landing segments outside the selected range", () => {
    const windows = [{
      windowId: "window-landing-test",
      startTimeSeconds: 0,
      endTimeSeconds: 80,
      durationSeconds: 80,
      transcriptText: "God gives courage to serve. So this week choose obedience and serve with your gift. Faith keeps walking with courage.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 20, endTimeSeconds: 55, text: "So this week choose obedience and serve with your gift." },
        { segmentIndex: 2, startTimeSeconds: 55, endTimeSeconds: 80, text: "Faith keeps walking with courage." },
      ],
      segmentLines: [
        "0: [0.0 - 20.0] God gives courage to serve.",
        "1: [20.0 - 55.0] So this week choose obedience and serve with your gift.",
        "2: [55.0 - 80.0] Faith keeps walking with courage.",
      ],
      wordCount: 18,
      meaningfulSegmentCount: 3,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      windowId: windows[0].windowId,
      startSegmentIndex: 0,
      endSegmentIndex: 1,
      landingSegmentIndex: 2,
      title: "Serve With Your Gift",
      hook: "God gives courage to serve.",
      caption: "Choose obedience.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "Choose obedience lands the point.",
      landingSentence: "Choose obedience.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate] as never, windows);

    expect(result.candidates).toHaveLength(0);
    expect(result.rejectedReasons.join(" ")).toContain("LANDING_SEGMENT_OUTSIDE_RANGE");
  });

  it("keeps accepting valid legacy timestamp responses during compatibility window", () => {
    const windows = [{
      windowId: "window-legacy-test",
      startTimeSeconds: 0,
      endTimeSeconds: 80,
      durationSeconds: 80,
      transcriptText: "God gives courage to serve. So this week choose obedience and serve with your gift. Faith keeps walking with courage.",
      segments: [
        { segmentIndex: 0, startTimeSeconds: 0, endTimeSeconds: 20, text: "God gives courage to serve." },
        { segmentIndex: 1, startTimeSeconds: 20, endTimeSeconds: 55, text: "So this week choose obedience and serve with your gift." },
        { segmentIndex: 2, startTimeSeconds: 55, endTimeSeconds: 80, text: "Faith keeps walking with courage." },
      ],
      segmentLines: [
        "0: [0.0 - 20.0] God gives courage to serve.",
        "1: [20.0 - 55.0] So this week choose obedience and serve with your gift.",
        "2: [55.0 - 80.0] Faith keeps walking with courage.",
      ],
      wordCount: 18,
      meaningfulSegmentCount: 3,
      windowQualityScore: 8,
      windowQualityWarnings: [],
    }];
    const candidate = {
      startTimeSeconds: windows[0].startTimeSeconds,
      endTimeSeconds: windows[0].endTimeSeconds,
      durationSeconds: windows[0].durationSeconds,
      transcriptText: windows[0].transcriptText,
      title: "Serve With Your Gift",
      hook: "God gives courage to serve.",
      caption: "Choose obedience.",
      hashtags: ["#Faith"],
      score: 8,
      reasonSelected: "Choose obedience lands the point.",
      landingSentence: "Choose obedience.",
      clipType: "teaching" as const,
      smartClipCategory: "Best Faith Clip" as const,
      intendedAudience: "Believers",
      ministryValue: "Encourages service.",
      socialValue: "Clear application.",
      riskLevel: "LOW" as const,
      riskReasons: [],
      contextWarning: false,
    };

    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([candidate], windows);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].responseFormat).toBe("LEGACY_TIMESTAMPS");
  });

  it("rescues grounded low-risk candidates from the pre-dedupe pool while skipping hard rejects", () => {
    const makeCandidate = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      title: id,
      hook: "God placed a gift in you.",
      caption: "Serve with courage.",
      transcriptText: "God placed a gift in you for the church. So this week choose one faithful act of service and stir up your gift.",
      startTimeSeconds: Number(id.split("-").pop() ?? 0) * 100,
      endTimeSeconds: Number(id.split("-").pop() ?? 0) * 100 + 60,
      durationSeconds: 60,
      score: 8,
      finalQualityScore: 6.8,
      qualityLabel: "REJECT" as const,
      postReadyStatus: "REJECT" as const,
      boundaryQuality: "BAD" as const,
      riskLevel: "LOW" as const,
      riskReasons: [],
      qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"],
      transcriptGroundingScore: 0.95,
      transcriptGroundingOrderedFlowRatio: 0.96,
      smartClipCategory: id,
      clipType: "teaching",
      postReadyBlockers: [],
      qualityReasons: [],
      rankingCategory: "REJECTED" as const,
      recommendedNextAction: "REJECT" as const,
      overallPostScore: 6.8,
      qualitySummary: "Repairable boundary.",
      pastorFriendlyReason: "Repairable boundary.",
      ...overrides,
    });

    const rescued = __clipIntelligenceTestUtils.selectRescueClipCandidates([
      makeCandidate("clip-0"),
      makeCandidate("clip-1"),
      makeCandidate("unsafe-2", { riskLevel: "HIGH" }),
      makeCandidate("ungrounded-3", { transcriptGroundingScore: 0.4 }),
      makeCandidate("hard-4", { qualityWarnings: ["PASTOR_GRADE_NO_SPIRITUAL_ANCHOR"] }),
      makeCandidate("clip-5"),
      makeCandidate("clip-6"),
      makeCandidate("clip-7"),
    ] as never, [] as never, 5, 6) as unknown as Array<{ id: string; qualityLabel: string }>;

    expect(rescued).toHaveLength(5);
    expect(rescued.every((candidate) => candidate.qualityLabel === "NEEDS_EDITING")).toBe(true);
    expect(rescued.map((candidate) => candidate.id)).not.toContain("unsafe-2");
    expect(rescued.map((candidate) => candidate.id)).not.toContain("ungrounded-3");
    expect(rescued.map((candidate) => candidate.id)).not.toContain("hard-4");
  });

  it("fills the pastor review board with grounded editing options when strong clips are limited", () => {
    const makeCandidate = (index: number) => ({
      id: `editing-${index}`,
      title: `Review Option ${index}`,
      hook: "God calls the church to serve.",
      caption: "Choose one faithful act of service this week.",
      transcriptText: `God calls the church to serve with courage and faithfulness in this moment ${index}. So this week choose one faithful act of service and strengthen someone with your gift.`,
      startTimeSeconds: index * 95,
      endTimeSeconds: index * 95 + 60,
      durationSeconds: 60,
      score: 6.8,
      finalQualityScore: 6.8,
      qualityLabel: "NEEDS_EDITING" as const,
      postReadyStatus: "NEEDS_EDITING" as const,
      boundaryQuality: "NEEDS_REVIEW" as const,
      riskLevel: "LOW" as const,
      riskReasons: [],
      qualityWarnings: ["NEEDS_CONTEXT_EXTENSION"],
      transcriptGroundingScore: 0.94,
      transcriptGroundingOrderedFlowRatio: 0.96,
      smartClipCategory: `Review Category ${index % 6}`,
      clipType: "teaching",
      postReadyBlockers: ["Needs pastor trim."],
      qualityReasons: [],
      rankingCategory: "NEEDS_EDITING" as const,
      recommendedNextAction: "EXTEND_CONTEXT" as const,
      overallPostScore: 6.8,
      qualitySummary: "Grounded but needs context.",
      pastorFriendlyReason: "Pastor should choose whether this moment is worth trimming.",
    });

    const rescued = __clipIntelligenceTestUtils.selectRescueClipCandidates(
      Array.from({ length: 16 }, (_, index) => makeCandidate(index)) as never,
      [] as never,
      12,
      24,
    ) as unknown as Array<{ id: string; qualityLabel: string; postReadyStatus: string }>;

    expect(rescued).toHaveLength(12);
    expect(rescued.every((candidate) => candidate.qualityLabel === "NEEDS_EDITING")).toBe(true);
    expect(new Set(rescued.map((candidate) => candidate.id)).size).toBe(12);
  });

  it("allows another eligible duplicate-cluster member to survive when the top member is rejected", () => {
    const selected = __clipIntelligenceTestUtils.selectRescueClipCandidates([
      {
        id: "bad-top",
        title: "Gift",
        hook: "God placed a gift in you.",
        caption: "Serve with courage.",
        transcriptText: "God placed a gift in you for the church. So this week choose one faithful act of service and stir up your gift.",
        startTimeSeconds: 0,
        endTimeSeconds: 60,
        durationSeconds: 60,
        score: 9,
        finalQualityScore: 9,
        qualityLabel: "REJECT",
        postReadyStatus: "REJECT",
        boundaryQuality: "GOOD",
        riskLevel: "LOW",
        qualityWarnings: ["PASTOR_GRADE_NO_SPIRITUAL_ANCHOR"],
        transcriptGroundingScore: 0.95,
        transcriptGroundingOrderedFlowRatio: 0.96,
        smartClipCategory: "Best Faith Clip",
        clipType: "teaching",
      },
      {
        id: "eligible-alt",
        title: "Gift",
        hook: "God placed a gift in you.",
        caption: "Serve with courage.",
        transcriptText: "God placed a gift in you for the church. So this week choose one faithful act of service and stir up your gift.",
        startTimeSeconds: 2,
        endTimeSeconds: 62,
        durationSeconds: 60,
        score: 7,
        finalQualityScore: 7,
        qualityLabel: "NEEDS_EDITING",
        postReadyStatus: "NEEDS_EDITING",
        boundaryQuality: "BAD",
        riskLevel: "LOW",
        qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"],
        transcriptGroundingScore: 0.95,
        transcriptGroundingOrderedFlowRatio: 0.96,
        smartClipCategory: "Best Faith Clip",
        clipType: "teaching",
      },
    ] as never, [] as never, 1, 3) as unknown as Array<{ id: string }>;

    expect(selected.map((candidate) => candidate.id)).toEqual(["eligible-alt"]);
  });
});
