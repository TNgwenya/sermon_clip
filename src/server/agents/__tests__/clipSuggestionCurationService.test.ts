import { describe, expect, it } from "vitest";

import {
  planAiSuggestionCuration,
  type CuratableClipSuggestion,
} from "@/server/agents/clipSuggestionCurationService";
import { __clipIntelligenceTestUtils } from "@/server/agents/clipIntelligenceAgent";

function groundingSnapshot(score = 0.92, orderedFlowRatio = 0.95) {
  return {
    transcriptGrounding: {
      score,
      orderedFlowRatio,
    },
  };
}

function clip(overrides: Partial<CuratableClipSuggestion> = {}): CuratableClipSuggestion {
  const id = overrides.id ?? "clip-1";
  const numericIndex = Number(id.match(/\d+/)?.[0]);
  const hashIndex = Number.isFinite(numericIndex)
    ? numericIndex
    : [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const topic = id.replace(/[^a-z0-9]+/gi, " ").trim() || "faith";
  const topicFixtures = [
    {
      title: "Walk By Faith",
      hook: "Faith keeps walking when fear gets loud.",
      transcriptText: "Faith keeps walking when fear gets loud. God has not abandoned the church in pressure, so this week take the obedient step in front of you and trust his grace to meet you there.",
      smartClipCategory: "Best Faith Clip",
      clipType: "inspirational",
      ministryValue: "Encourages faith under pressure.",
    },
    {
      title: "Pray Before You Panic",
      hook: "Prayer gives anxiety somewhere holy to go.",
      transcriptText: "Prayer gives anxiety somewhere holy to go. Bring the burden to Jesus before you carry it alone, because the peace of God strengthens the heart and teaches the church to trust again.",
      smartClipCategory: "Best Prayer Clip",
      clipType: "pastoral",
      ministryValue: "Calls people into prayer.",
    },
    {
      title: "Forgive With Grace",
      hook: "Forgiveness is obedience before it is a feeling.",
      transcriptText: "Forgiveness is obedience before it is a feeling. Grace has already met you, so this week forgive again and let mercy make enough room for families, neighbors, and hearts to heal.",
      smartClipCategory: "Best Encouragement Clip",
      clipType: "pastoral",
      ministryValue: "Applies grace to relationships.",
    },
    {
      title: "Scripture Gives Wisdom",
      hook: "Scripture gives wisdom for the next step.",
      transcriptText: "Scripture gives wisdom for the next step. Do not only admire the Word; obey what God has shown you, because discipleship becomes visible when truth turns into practice.",
      smartClipCategory: "Best Scripture Explanation Clip",
      clipType: "teaching",
      ministryValue: "Connects scripture to obedience.",
    },
    {
      title: "Hope Has A Name",
      hook: "Hope has a name, and his name is Jesus.",
      transcriptText: "Hope has a name, and his name is Jesus. When disappointment tries to write the ending, remember that resurrection power still gives courage, strength, and a future to weary people.",
      smartClipCategory: "Best Encouragement Clip",
      clipType: "inspirational",
      ministryValue: "Encourages hope in Christ.",
    },
    {
      title: "Invite Someone Home",
      hook: "The invitation may be the doorway someone needs.",
      transcriptText: "The invitation may be the doorway someone needs. Do not underestimate a simple act of love; invite someone to church this week and let them hear the good news of Jesus.",
      smartClipCategory: "Best Sunday Promotion Clip",
      clipType: "evangelistic",
      ministryValue: "Encourages invitation and evangelism.",
    },
  ];
  const fixture = topicFixtures[Math.abs(hashIndex) % topicFixtures.length];

  return {
    id,
    title: `${fixture.title} ${topic}`,
    hook: fixture.hook,
    startTimeSeconds: hashIndex * 120,
    endTimeSeconds: hashIndex * 120 + 60,
    durationSeconds: 60,
    status: "SUGGESTED",
    isAiGenerated: true,
    isManuallyEdited: false,
    score: 8,
    finalQualityScore: 7.2,
    qualityLabel: "GOOD_NEEDS_REVIEW",
    postReadyStatus: "GOOD_NEEDS_REVIEW",
    overallPostScore: 7,
    recommendedAction: "NEEDS_REVIEW",
    boundaryQuality: "GOOD",
    riskLevel: "LOW",
    contextWarning: false,
    standaloneClarityScore: 7,
    transcriptText: fixture.transcriptText,
    smartClipCategory: fixture.smartClipCategory,
    clipType: fixture.clipType,
    ministryValue: fixture.ministryValue,
    qualityDebugSnapshot: groundingSnapshot(),
    createdAt: new Date("2026-06-20T10:00:00.000Z"),
    ...overrides,
  };
}

describe("clip suggestion curation service", () => {
  it("rejects weak AI suggestions that should not reach pastor review", () => {
    const summary = planAiSuggestionCuration([
      clip({ id: "strong", qualityLabel: "POST_READY", finalQualityScore: 8.4 }),
      clip({ id: "needs-editing", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.05, recommendedAction: "TRIM_CLIP", qualityWarnings: ["PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION"] }),
      clip({ id: "bad-boundary", boundaryQuality: "BAD", finalQualityScore: 8.8, qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"], recommendedAction: "EXTEND_CONTEXT" }),
      clip({ id: "low-score", finalQualityScore: 4.9 }),
      clip({ id: "decent-but-not-strong", finalQualityScore: 6.9, overallPostScore: 6.9 }),
      clip({ id: "quality-reject", qualityLabel: "REJECT", finalQualityScore: 9 }),
    ]);

    expect(summary.clipsKept).toBe(4);
    expect(summary.clipsRejected).toBe(2);
    expect(summary.decisions.find((decision) => decision.clipId === "needs-editing")).toMatchObject({ action: "KEEP" });
    expect(summary.decisions.find((decision) => decision.clipId === "bad-boundary")).toMatchObject({ action: "KEEP" });
    expect(summary.decisions.find((decision) => decision.clipId === "decent-but-not-strong")).toMatchObject({ action: "KEEP" });
    expect(summary.decisions.find((decision) => decision.clipId === "low-score")).toMatchObject({ action: "REJECT" });
    expect(summary.decisions.find((decision) => decision.clipId === "strong")).toMatchObject({ action: "KEEP" });
  });

  it("caps reviewable AI suggestions to the strongest clips", () => {
    const clips = Array.from({ length: 6 }, (_, index) => clip({
      id: `clip-${index}`,
      finalQualityScore: 8 - index * 0.2,
      score: 8 - index * 0.2,
      createdAt: new Date(`2026-06-20T10:0${index}:00.000Z`),
    }));

    const summary = planAiSuggestionCuration(clips, { maxReviewSuggestions: 3 });

    expect(summary.clipsKept).toBe(3);
    expect(summary.rejectedOverflow).toBe(3);
    expect(summary.decisions.filter((decision) => decision.action === "KEEP").map((decision) => decision.clipId)).toEqual([
      "clip-0",
      "clip-1",
      "clip-2",
    ]);
  });

  it("rejects duplicate sermon ideas before applying the review-board cap", () => {
    const sharedTranscript = "God has placed a gift in you, and the church needs what is in your hand. So this week stir up the gift and serve with courage.";
    const summary = planAiSuggestionCuration([
      clip({
        id: "gift-best",
        title: "Use What God Gave You",
        hook: "God placed a gift in your hand.",
        transcriptText: sharedTranscript,
        finalQualityScore: 8.8,
        score: 8.8,
        startTimeSeconds: 120,
        endTimeSeconds: 180,
        smartClipCategory: "Best Discipleship Clip",
      }),
      clip({
        id: "gift-repeat",
        title: "Stir Up Your Gift",
        hook: "Do not bury what God placed in you.",
        transcriptText: sharedTranscript,
        finalQualityScore: 8.1,
        score: 8.1,
        startTimeSeconds: 600,
        endTimeSeconds: 660,
        smartClipCategory: "Best Discipleship Clip",
      }),
      clip({
        id: "forgiveness",
        title: "Forgive Again With Grace",
        hook: "Forgiveness is obedience before it is a feeling.",
        transcriptText: "Forgiveness is obedience before it is a feeling. So this week forgive again because grace has already met you and mercy keeps the heart free.",
        finalQualityScore: 8.2,
        score: 8.2,
        startTimeSeconds: 900,
        endTimeSeconds: 960,
        smartClipCategory: "Best Encouragement Clip",
      }),
    ], { maxReviewSuggestions: 3 });

    expect(summary.clipsKept).toBe(2);
    expect(summary.decisions.find((decision) => decision.clipId === "gift-repeat")).toMatchObject({
      action: "REJECT",
      duplicateOfClipId: "gift-best",
      reason: expect.stringContaining("repeats another suggested clip"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "forgiveness")).toMatchObject({ action: "KEEP" });
  });

  it("rejects clips with weak hooks or incomplete arcs but keeps repairable pastor-grade warnings", () => {
    const summary = planAiSuggestionCuration([
      clip({ id: "strong", qualityLabel: "POST_READY", postReadyStatus: "POST_READY", finalQualityScore: 8.6, hookScore: 8, arcCompletenessScore: 8, completenessScore: 8 }),
      clip({ id: "weak-hook", qualityLabel: "POST_READY", postReadyStatus: "POST_READY", finalQualityScore: 8.7, hookScore: 4.9 }),
      clip({ id: "weak-arc", qualityLabel: "POST_READY", postReadyStatus: "POST_READY", finalQualityScore: 8.5, arcCompletenessScore: 5.9 }),
      clip({ id: "incomplete", qualityLabel: "POST_READY", postReadyStatus: "POST_READY", finalQualityScore: 8.5, completenessAction: "REJECT_INCOMPLETE" }),
      clip({
        id: "repairable-payoff",
        title: "Invite Someone Home",
        hook: "The invitation may be the doorway someone needs.",
        transcriptText: "The invitation may be the doorway someone needs. Do not underestimate a simple act of love; invite someone to church this week and let them hear the good news of Jesus.",
        smartClipCategory: "Best Sunday Promotion Clip",
        clipType: "evangelistic",
        ministryValue: "Encourages invitation and evangelism.",
        qualityLabel: "NEEDS_EDITING",
        postReadyStatus: "NEEDS_EDITING",
        finalQualityScore: 8.9,
        qualityWarnings: ["PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION"],
        recommendedAction: "TRIM_CLIP",
      }),
    ]);

    expect(summary.decisions.find((decision) => decision.clipId === "strong")).toMatchObject({ action: "KEEP" });
    expect(summary.decisions.find((decision) => decision.clipId === "weak-hook")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("hook"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "weak-arc")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("sermon arc"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "incomplete")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("incomplete"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "repairable-payoff")).toMatchObject({ action: "KEEP" });
  });

  it("rejects suggestions without enough transcript evidence or grounding proof", () => {
    const summary = planAiSuggestionCuration([
      clip({ id: "strong", qualityLabel: "POST_READY", postReadyStatus: "POST_READY", finalQualityScore: 8.6 }),
      clip({ id: "thin-transcript", transcriptText: "God is faithful. Choose prayer today.", finalQualityScore: 9 }),
      clip({ id: "missing-grounding", qualityDebugSnapshot: null, finalQualityScore: 9 }),
      clip({ id: "weak-grounding", qualityDebugSnapshot: groundingSnapshot(0.5, 0.9), finalQualityScore: 9 }),
      clip({ id: "reordered-grounding", qualityDebugSnapshot: groundingSnapshot(0.9, 0.6), finalQualityScore: 9 }),
    ]);

    expect(summary.decisions.find((decision) => decision.clipId === "strong")).toMatchObject({ action: "KEEP" });
    expect(summary.decisions.find((decision) => decision.clipId === "thin-transcript")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("too thin"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "missing-grounding")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("grounding proof"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "weak-grounding")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("not grounded"),
    });
    expect(summary.decisions.find((decision) => decision.clipId === "reordered-grounding")).toMatchObject({
      action: "REJECT",
      reason: expect.stringContaining("wording order"),
    });
  });

  it("does not curate manual, approved, exported, or already rejected clips", () => {
    const summary = planAiSuggestionCuration([
      clip({ id: "manual", isManuallyEdited: true, finalQualityScore: 2 }),
      clip({ id: "approved", status: "APPROVED", finalQualityScore: 2 }),
      clip({ id: "exported", status: "EXPORTED", finalQualityScore: 2 }),
      clip({ id: "rejected", status: "REJECTED", finalQualityScore: 2 }),
    ]);

    expect(summary.clipsFound).toBe(0);
    expect(summary.decisions).toHaveLength(0);
  });

  it("keeps grounded needs-editing clips with missing payoff warnings", () => {
    const summary = planAiSuggestionCuration([
      clip({
        id: "missing-payoff",
        qualityLabel: "NEEDS_EDITING",
        postReadyStatus: "NEEDS_EDITING",
        finalQualityScore: 7.4,
        qualityWarnings: ["PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION"],
        recommendedAction: "TRIM_CLIP",
      }),
    ]);

    expect(summary.decisions[0]).toMatchObject({ action: "KEEP" });
  });

  it("keeps grounded clips with bad but repairable boundaries", () => {
    const summary = planAiSuggestionCuration([
      clip({
        id: "repairable-boundary",
        qualityLabel: "NEEDS_EDITING",
        postReadyStatus: "NEEDS_EDITING",
        boundaryQuality: "BAD",
        finalQualityScore: 7.6,
        qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"],
        recommendedAction: "EXTEND_CONTEXT",
      }),
    ]);

    expect(summary.decisions[0]).toMatchObject({ action: "KEEP" });
  });

  it("keeps grounded rescue and review clip types generated for pastor choice", () => {
    const clips = [
      clip({ id: "missing-payoff", title: "Walk By Faith", hook: "Faith keeps walking when fear gets loud.", transcriptText: "Faith keeps walking when fear gets loud. God has not abandoned the church in pressure, so this week take the obedient step in front of you and trust his grace to meet you there.", smartClipCategory: "Best Faith Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.4, qualityWarnings: ["PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION"], recommendedAction: "TRIM_CLIP" }),
      clip({ id: "setup-without-landing", title: "Pray Before You Panic", hook: "Prayer gives anxiety somewhere holy to go.", transcriptText: "Prayer gives anxiety somewhere holy to go. Bring the burden to Jesus before you carry it alone, because the peace of God strengthens the heart and teaches the church to trust again.", smartClipCategory: "Best Prayer Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.4, qualityWarnings: ["PASTOR_GRADE_SETUP_WITHOUT_LANDING"], recommendedAction: "TRIM_CLIP" }),
      clip({ id: "bad-boundary", title: "Forgive With Grace", hook: "Forgiveness is obedience before it is a feeling.", transcriptText: "Forgiveness is obedience before it is a feeling. Grace has already met you, so this week forgive again and let mercy make enough room for families, neighbors, and hearts to heal.", smartClipCategory: "Best Encouragement Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", boundaryQuality: "BAD", finalQualityScore: 7.4, qualityWarnings: ["PASTOR_GRADE_BAD_BOUNDARY"], recommendedAction: "EXTEND_CONTEXT" }),
      clip({ id: "dependent-opening", title: "Scripture Gives Wisdom", hook: "Scripture gives wisdom for the next step.", transcriptText: "Scripture gives wisdom for the next step. Do not only admire the Word; obey what God has shown you, because discipleship becomes visible when truth turns into practice.", smartClipCategory: "Best Scripture Explanation Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.4, qualityWarnings: ["PASTOR_GRADE_DEPENDENT_OPENING"], recommendedAction: "REVIEW_OPENING" }),
      clip({ id: "dangling-ending", title: "Hope Has A Name", hook: "Hope has a name, and his name is Jesus.", transcriptText: "Hope has a name, and his name is Jesus. When disappointment tries to write the ending, remember that resurrection power still gives courage, strength, and a future to weary people.", smartClipCategory: "Best Encouragement Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.4, qualityWarnings: ["PASTOR_GRADE_DANGLING_ENDING"], recommendedAction: "TRIM_CLIP" }),
      clip({ id: "context-extension", title: "Invite Someone Home", hook: "The invitation may be the doorway someone needs.", transcriptText: "The invitation may be the doorway someone needs. Do not underestimate a simple act of love; invite someone to church this week and let them hear the good news of Jesus.", smartClipCategory: "Best Sunday Promotion Clip", qualityLabel: "NEEDS_EDITING", postReadyStatus: "NEEDS_EDITING", finalQualityScore: 7.4, qualityWarnings: ["NEEDS_CONTEXT_EXTENSION"], recommendedAction: "EXTEND_CONTEXT" }),
    ];

    const summary = planAiSuggestionCuration(clips);

    expect(summary.clipsRejected).toBe(0);
    expect(summary.decisions.every((decision) => decision.action === "KEEP")).toBe(true);
  });

  it("rejects non-sermon logistics, unsupported metadata claims, high-risk, and low-grounding clips", () => {
    const summary = planAiSuggestionCuration([
      clip({ id: "logistics", qualityWarnings: ["PASTOR_GRADE_NON_SERMON_LOGISTICS"], finalQualityScore: 8.5 }),
      clip({ id: "unsupported", qualityWarnings: ["PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM"], finalQualityScore: 8.5 }),
      clip({ id: "high-risk", riskLevel: "HIGH", finalQualityScore: 8.5 }),
      clip({ id: "low-grounding", qualityDebugSnapshot: groundingSnapshot(0.55, 0.9), finalQualityScore: 8.5 }),
    ]);

    expect(summary.decisions.find((decision) => decision.clipId === "logistics")).toMatchObject({ action: "REJECT" });
    expect(summary.decisions.find((decision) => decision.clipId === "unsupported")).toMatchObject({ action: "REJECT" });
    expect(summary.decisions.find((decision) => decision.clipId === "high-risk")).toMatchObject({ action: "REJECT" });
    expect(summary.decisions.find((decision) => decision.clipId === "low-grounding")).toMatchObject({ action: "REJECT" });
  });

  it("matches generation reuse reviewability for the same grounded fixture", () => {
    const candidate = clip({
      id: "shared-reviewable",
      qualityLabel: "NEEDS_EDITING",
      postReadyStatus: "NEEDS_EDITING",
      finalQualityScore: 7.4,
      transcriptText: "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, so this week serve with courage and let faith move first.",
      smartClipCategory: "Best Discipleship Clip",
      qualityWarnings: ["PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION"],
      recommendedAction: "TRIM_CLIP",
    });

    const curation = planAiSuggestionCuration([candidate]);
    const reuse = __clipIntelligenceTestUtils.getExistingSuggestionReuseDecision([{
      qualityLabel: candidate.qualityLabel,
      postReadyStatus: candidate.postReadyStatus,
      finalQualityScore: candidate.finalQualityScore,
      score: candidate.score,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      durationSeconds: 60,
      transcriptText: candidate.transcriptText ?? "",
      qualityDebugSnapshot: candidate.qualityDebugSnapshot,
      smartClipCategory: "Best Faith Clip",
      clipType: "teaching",
      hookScore: 7,
      standaloneClarityScore: 7,
      arcCompletenessScore: 7,
      completenessScore: 7,
      boundaryQuality: candidate.boundaryQuality,
      qualityWarnings: candidate.qualityWarnings,
      riskLevel: candidate.riskLevel,
      riskReasons: [],
      contextWarning: candidate.contextWarning,
    }]);

    expect(curation.decisions[0]).toMatchObject({ action: "KEEP" });
    expect(reuse.reusableCount).toBe(1);
  });
});
