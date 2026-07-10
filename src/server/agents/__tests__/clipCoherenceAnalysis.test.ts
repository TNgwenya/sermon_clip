import { describe, expect, it } from "vitest";

import { analyzeClipCoherence } from "@/server/agents/clipCoherenceAnalysis";
import { reviewClipCompletenessCandidates, type ClipCompletenessCandidateInput } from "@/server/agents/clipCompletenessService";
import type { TranscriptSegmentBoundary } from "@/server/agents/clipBoundaryRefinement";

function candidateFromSegments(segments: TranscriptSegmentBoundary[]): ClipCompletenessCandidateInput {
  const start = segments[0].startTimeSeconds;
  const end = segments[segments.length - 1].endTimeSeconds;
  return {
    startTimeSeconds: start,
    endTimeSeconds: end,
    durationSeconds: end - start,
    transcriptText: segments.map((segment) => segment.text).join(" "),
    title: "Coherence Test",
    hook: segments[0].text,
    caption: "Test caption.",
    score: 8,
    reasonSelected: "Test fixture.",
    riskLevel: "LOW",
    riskReasons: [],
    contextWarning: false,
    boundaryQuality: "GOOD",
    boundaryAdjustmentReason: "Boundary quality GOOD.",
    adjustedStartTimeSeconds: start,
    adjustedEndTimeSeconds: end,
  };
}

describe("clip coherence analysis", () => {
  it("uses local-language ministry markers as positive evidence without translating them", () => {
    const result = analyzeClipCoherence(
      "UNkulunkulu uthembekile futhi abantu bakhe kufanele bakholwe. Manje khetha ukholo, themba uJesu, futhi thandaza.",
    );

    expect(result.hasSpiritualAnchor).toBe(true);
    expect(result.landingStatus).toBe("APPLICATION");
    expect(result.evidence.reasonCodes).toContain("LOCAL_LANGUAGE_REVIEW_REQUIRED");
    expect(result.evidence.landingText).toContain("thandaza");
  });

  it("detects application landing", () => {
    const result = analyzeClipCoherence("God gives courage when pressure comes. So this week choose obedience and pray again.");

    expect(result.landingStatus).toBe("APPLICATION");
    expect(result.hasClearTakeaway).toBe(true);
    expect(result.evidence.reasonCodes).toContain("LANDING_APPLICATION");
  });

  it("detects pastoral declaration", () => {
    const result = analyzeClipCoherence("The storm is real. God strengthens you and carries your heart when faith feels weak.");

    expect(result.landingStatus).toBe("DECLARATION");
    expect(result.hasSpiritualAnchor).toBe(true);
  });

  it("detects testimony lesson", () => {
    const result = analyzeClipCoherence("I remember when God restored our family. Today choose to trust him with your next step.");

    expect(result.landingStatus).toBe("TESTIMONY_LESSON");
  });

  it("detects scripture answer", () => {
    const result = analyzeClipCoherence("Romans teaches that grace changes the heart and therefore faith keeps walking.");

    expect(result.landingStatus).toBe("SCRIPTURE_ANSWER");
  });

  it("detects quote punchline", () => {
    const result = analyzeClipCoherence("Hear me, delayed obedience is still disobedience.");

    expect(result.landingStatus).toBe("QUOTE_PUNCHLINE");
  });

  it("detects setup-only introduction", () => {
    const result = analyzeClipCoherence("Today I want to show you why faith matters before we understand obedience.");

    expect(result.setupOnly).toBe(true);
    expect(result.standaloneStatus).toBe("INSUFFICIENT");
  });

  it("detects future-response promises", () => {
    const result = analyzeClipCoherence("Next we are going to explain how we respond, apply, obey, and pray.");

    expect(result.pointsToFutureResponse).toBe(true);
  });

  it("detects connector opening", () => {
    const result = analyzeClipCoherence("And God gives grace for the assignment. Today choose obedience.");

    expect(result.openingStatus).toBe("SOFT_CONNECTOR");
  });

  it("detects dependent reference opening", () => {
    const result = analyzeClipCoherence("That means obedience cannot wait until fear disappears.");

    expect(result.openingStatus).toBe("DEPENDENT");
  });

  it("detects dangling ending", () => {
    const result = analyzeClipCoherence("God gives courage because");

    expect(result.endingStatus).toBe("DANGLING");
  });

  it("treats a complete ASR phrase without terminal punctuation as clean when the thought lands", () => {
    const result = analyzeClipCoherence("God gives courage to serve the church so this week choose obedience and pray again");

    expect(result.endingStatus).toBe("CLEAN");
    expect(result.hasClearTakeaway).toBe(true);
  });

  it("does not treat lowercase ASR starts as mid-sentence by themselves", () => {
    const result = analyzeClipCoherence("god gives courage to serve the church so this week choose obedience");

    expect(result.openingStatus).toBe("CLEAN");
  });

  it("detects calling gift stewardship payoff", () => {
    const result = analyzeClipCoherence("God has placed a gift in you for the church. Stir up what God gave and serve somebody this week.");

    expect(result.landingStatus).toBe("APPLICATION");
    expect(result.evidence.reasonCodes).toContain("CALLING_GIFT_STEWARDSHIP_PAYOFF");
  });

  it("does not treat generic theology as listener payoff", () => {
    const result = analyzeClipCoherence("God is faithful. God is good. Scripture is true. Grace matters in every season.");

    expect(result.hasSpiritualAnchor).toBe(true);
    expect(result.landingStatus).toBe("NONE");
    expect(result.hasClearTakeaway).toBe(false);
  });

  it("keeps completeness and coherence consistent on landing status", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 15, text: "God has placed a gift in you for the church." },
      { startTimeSeconds: 15, endTimeSeconds: 35, text: "Stir up what God gave and serve somebody this week." },
    ];
    const coherence = analyzeClipCoherence(segments.map((segment) => segment.text).join(" "));
    const [reviewed] = await reviewClipCompletenessCandidates([candidateFromSegments(segments)], segments, {
      disableAi: true,
    });

    expect(coherence.landingStatus).not.toBe("NONE");
    expect(reviewed.completenessWarnings).not.toContain("MISSING_LANDING");
    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
  });
});
