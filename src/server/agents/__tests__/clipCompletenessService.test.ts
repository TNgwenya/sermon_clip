import { describe, expect, it } from "vitest";

import {
  __clipCompletenessTestUtils,
  reviewClipCompletenessCandidates,
  type ClipCompletenessCandidateInput,
} from "@/server/agents/clipCompletenessService";
import type { TranscriptSegmentBoundary } from "@/server/agents/clipBoundaryRefinement";

const baseSegments: TranscriptSegmentBoundary[] = [
  { startTimeSeconds: 0, endTimeSeconds: 10, text: "Here is the question many of us are carrying today." },
  { startTimeSeconds: 10, endTimeSeconds: 20, text: "And God meets us in that place with grace." },
  { startTimeSeconds: 20, endTimeSeconds: 35, text: "He reminds us that faith is not pretending the valley is easy." },
  { startTimeSeconds: 35, endTimeSeconds: 50, text: "Faith is trusting that the Lord is walking with us." },
  { startTimeSeconds: 50, endTimeSeconds: 62, text: "So take the next step, pray again, and do not give up." },
  { startTimeSeconds: 62, endTimeSeconds: 70, text: "Amen." },
];

function candidate(overrides: Partial<ClipCompletenessCandidateInput> = {}): ClipCompletenessCandidateInput {
  return {
    startTimeSeconds: 0,
    endTimeSeconds: 62,
    durationSeconds: 62,
    transcriptText: baseSegments.slice(0, 5).map((segment) => segment.text).join(" "),
    title: "Faith in the Valley",
    hook: "Faith is trusting God in the valley.",
    caption: "God is walking with you in the valley.",
    score: 8,
    reasonSelected: "Strong standalone encouragement.",
    riskLevel: "LOW",
    riskReasons: [],
    contextWarning: false,
    boundaryQuality: "GOOD",
    boundaryAdjustmentReason: "Boundary quality GOOD.",
    adjustedStartTimeSeconds: 0,
    adjustedEndTimeSeconds: 62,
    ...overrides,
  };
}

describe("clip completeness service", () => {
  it("keeps a clean complete clip as-is", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([candidate()], baseSegments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
    expect(reviewed.startTimeSeconds).toBe(0);
    expect(reviewed.endTimeSeconds).toBe(62);
    expect(reviewed.boundaryQuality).toBe("GOOD");
  });

  it("extends a connector start earlier when nearby setup fits", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 10,
        endTimeSeconds: 62,
        durationSeconds: 52,
        transcriptText: "And God meets us in that place with grace. He reminds us that faith is not pretending the valley is easy. Faith is trusting that the Lord is walking with us. So take the next step, pray again, and do not give up.",
        adjustedStartTimeSeconds: 10,
        adjustedEndTimeSeconds: 62,
      }),
    ], baseSegments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("START_EARLIER");
    expect(reviewed.startTimeSeconds).toBe(0);
    expect(reviewed.transcriptText).toContain("Here is the question");
    expect(reviewed.completenessWarnings).not.toContain("CONNECTOR_START");
  });

  it("adjusts an unresolved pronoun start when setup is available", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 9, text: "God gives strength to people who feel weary." },
      { startTimeSeconds: 9, endTimeSeconds: 22, text: "This is why you can keep praying when you are tired." },
      { startTimeSeconds: 22, endTimeSeconds: 45, text: "The Lord has not abandoned you in the waiting." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 9,
        endTimeSeconds: 45,
        durationSeconds: 36,
        transcriptText: "This is why you can keep praying when you are tired. The Lord has not abandoned you in the waiting.",
        adjustedStartTimeSeconds: 9,
        adjustedEndTimeSeconds: 45,
      }),
    ], segments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("START_EARLIER");
    expect(reviewed.startTimeSeconds).toBe(0);
    expect(reviewed.completenessWarnings).not.toContain("UNRESOLVED_PRONOUN_START");
  });

  it("does not treat a natural 'this morning' sermon opening as unresolved context", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "This morning I want to encourage you to stir up the gift of God." },
      { startTimeSeconds: 10, endTimeSeconds: 25, text: "The Lord has placed something in your life that can strengthen the church." },
      { startTimeSeconds: 25, endTimeSeconds: 42, text: "So take one faithful step and serve with what is already in your hand." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 42,
        durationSeconds: 42,
        transcriptText: segments.map((segment) => segment.text).join(" "),
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 42,
      }),
    ], segments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
    expect(reviewed.completenessWarnings).not.toContain("UNRESOLVED_PRONOUN_START");
    expect(reviewed.startTimeSeconds).toBe(0);
  });

  it("adjusts context-dependent 'that means' starts when setup is available", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Paul tells Timothy to stir up the gift that God placed inside him." },
      { startTimeSeconds: 10, endTimeSeconds: 24, text: "That means obedience cannot wait until fear disappears." },
      { startTimeSeconds: 24, endTimeSeconds: 44, text: "The Spirit gives power, love, and discipline for the assignment." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 10,
        endTimeSeconds: 44,
        durationSeconds: 34,
        transcriptText: "That means obedience cannot wait until fear disappears. The Spirit gives power, love, and discipline for the assignment.",
        adjustedStartTimeSeconds: 10,
        adjustedEndTimeSeconds: 44,
      }),
    ], segments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("START_EARLIER");
    expect(reviewed.startTimeSeconds).toBe(0);
    expect(reviewed.completenessWarnings).not.toContain("UNRESOLVED_PRONOUN_START");
    expect(reviewed.transcriptText).toContain("Paul tells Timothy");
  });

  it("extends a cut-off ending later", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "When fear rises, remember who holds your future." },
      { startTimeSeconds: 12, endTimeSeconds: 30, text: "You do not have to quit because" },
      { startTimeSeconds: 30, endTimeSeconds: 42, text: "therefore trust God, pray again, and take the next step." },
      { startTimeSeconds: 42, endTimeSeconds: 52, text: "Amen." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 30,
        durationSeconds: 30,
        transcriptText: "When fear rises, remember who holds your future. You do not have to quit because",
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 30,
      }),
    ], segments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("END_LATER");
    expect(reviewed.endTimeSeconds).toBe(42);
    expect(reviewed.transcriptText).toContain("take the next step");
    expect(reviewed.completenessWarnings).not.toContain("INCOMPLETE_ENDING");
  });

  it("extends a clean ending when the nearby sermon application has not landed yet", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "Paul tells Timothy that the gift of God is already inside him." },
      { startTimeSeconds: 12, endTimeSeconds: 24, text: "Fear will try to make obedience feel unsafe." },
      { startTimeSeconds: 24, endTimeSeconds: 36, text: "The Spirit gives power love and discipline." },
      { startTimeSeconds: 36, endTimeSeconds: 48, text: "So this week choose one faithful act of service and stir up your gift." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 36,
        durationSeconds: 36,
        transcriptText: segments.slice(0, 3).map((segment) => segment.text).join(" "),
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 36,
      }),
    ], segments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("END_LATER");
    expect(reviewed.endTimeSeconds).toBe(48);
    expect(reviewed.transcriptText).toContain("So this week choose one faithful act");
    expect(reviewed.completenessWarnings).not.toContain("MISSING_LANDING");
    expect(reviewed.riskReasons).not.toContain("Clip may stop before the sermon application lands.");
  });

  it("marks missing landing for review when the application cannot fit safely", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 30, text: "The pastor builds a long teaching about gifts and service." },
      { startTimeSeconds: 30, endTimeSeconds: 60, text: "The pastor continues explaining the scripture with a complete thought." },
      { startTimeSeconds: 60, endTimeSeconds: 90, text: "The pastor gives one more complete thought about courage." },
      { startTimeSeconds: 90, endTimeSeconds: 110, text: "So this week choose one act of service and stir up the gift." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 90,
        durationSeconds: 90,
        transcriptText: segments.slice(0, 3).map((segment) => segment.text).join(" "),
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 90,
      }),
    ], segments, { disableAi: true, maxDurationSeconds: 90 });

    expect(reviewed.completenessAction).toBe("NEEDS_REVIEW");
    expect(reviewed.endTimeSeconds).toBe(90);
    expect(reviewed.completenessWarnings).toContain("MISSING_LANDING");
    expect(reviewed.completenessWarnings).toContain("DURATION_LIMIT");
  });

  it("marks a clip needs review when setup would exceed max duration", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "The setup is important for this answer." },
      { startTimeSeconds: 12, endTimeSeconds: 52, text: "And this answer needs the earlier question to make sense." },
      { startTimeSeconds: 52, endTimeSeconds: 92, text: "The application is strong, but the setup cannot fit inside the short-form limit." },
    ];

    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 12,
        endTimeSeconds: 92,
        durationSeconds: 80,
        transcriptText: "And this answer needs the earlier question to make sense. The application is strong, but the setup cannot fit inside the short-form limit.",
        adjustedStartTimeSeconds: 12,
        adjustedEndTimeSeconds: 92,
      }),
    ], segments, { disableAi: true, maxDurationSeconds: 90 });

    expect(reviewed.completenessAction).toBe("NEEDS_REVIEW");
    expect(reviewed.startTimeSeconds).toBe(12);
    expect(reviewed.completenessWarnings).toContain("DURATION_LIMIT");
  });

  it("keeps clean long-form ministry clips when they fit inside the hard duration limit", async () => {
    const longSegments: TranscriptSegmentBoundary[] = Array.from({ length: 12 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `Complete testimony movement ${index} lands with a clear pastoral application.`,
    }));
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 120,
        durationSeconds: 120,
        transcriptText: longSegments.map((segment) => segment.text).join(" "),
        title: "Complete Testimony",
        hook: "God can use the whole story.",
        caption: "The full testimony lands with hope.",
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 120,
      }),
    ], longSegments, { disableAi: true });

    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
    expect(reviewed.completenessWarnings).not.toContain("DURATION_LIMIT");
    expect(reviewed.boundaryQuality).toBe("GOOD");
  });

  it("rejects a weak clip that cannot be made standalone", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        score: 4.5,
        riskLevel: "HIGH",
        contextWarning: true,
        startTimeSeconds: 10,
        endTimeSeconds: 62,
        durationSeconds: 52,
        transcriptText: "And God meets us in that place with grace. He reminds us that faith is not pretending the valley is easy. Faith is trusting that the Lord is walking with us. So take the next step, pray again, and do not give up.",
        adjustedStartTimeSeconds: 10,
        adjustedEndTimeSeconds: 62,
      }),
    ], baseSegments, { disableAi: true, maxDurationSeconds: 55 });

    expect(["REJECT_INCOMPLETE", "NEEDS_REVIEW"]).toContain(reviewed.completenessAction);
    expect(reviewed.boundaryQuality).not.toBe("GOOD");
    expect(reviewed.contextWarning).toBe(true);
  });

  it("falls back to deterministic review when AI completeness parsing fails", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([candidate()], baseSegments, {
      rawResponseOverride: "not json",
    });

    expect(reviewed.completenessReviewSource).toBe("FALLBACK");
    expect(reviewed.completenessWarnings).toContain("AI_COMPLETENESS_FAILED");
    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
  });

  it("updates transcript text and duration after boundary adjustment", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 10,
        endTimeSeconds: 62,
        durationSeconds: 52,
        transcriptText: "And God meets us in that place with grace. He reminds us that faith is not pretending the valley is easy. Faith is trusting that the Lord is walking with us. So take the next step, pray again, and do not give up.",
        adjustedStartTimeSeconds: 10,
        adjustedEndTimeSeconds: 62,
      }),
    ], baseSegments, { disableAi: true });

    expect(reviewed.startTimeSeconds).toBe(0);
    expect(reviewed.durationSeconds).toBe(62);
    expect(reviewed.transcriptText).toBe(baseSegments.slice(0, 5).map((segment) => segment.text).join(" "));
    expect(reviewed.previousAdjustedStartTimeSeconds).toBe(10);
    expect(reviewed.previousAdjustedEndTimeSeconds).toBe(62);
  });

  it("lets AI KEEP_AS_IS plus clean deterministic revalidation clear stale structural warnings", async () => {
    const fallbackOnly = await reviewClipCompletenessCandidates([candidate()], baseSegments, { disableAi: true });
    const [reviewed] = await reviewClipCompletenessCandidates([candidate()], baseSegments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 9.4,
          action: "KEEP_AS_IS",
          suggestedStartTimeSeconds: null,
          suggestedEndTimeSeconds: null,
          warnings: [],
          reason: "The repaired clip now opens cleanly and lands the thought.",
        }],
      }),
    });

    expect(reviewed.completenessReviewSource).toBe("AI");
    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
    expect(reviewed.completenessWarnings).not.toContain("MISSING_SETUP");
    expect(reviewed.completenessWarnings).not.toContain("MISSING_LANDING");
    expect(reviewed.completenessScore).toBeGreaterThan(fallbackOnly[0].completenessScore);
  });

  it("does not let AI clear a dangling ending without a valid boundary change", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "God gives courage when fear rises." },
      { startTimeSeconds: 12, endTimeSeconds: 30, text: "You can keep walking because" },
    ];
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 30,
        durationSeconds: 30,
        transcriptText: segments.map((segment) => segment.text).join(" "),
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 30,
      }),
    ], segments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 9,
          action: "KEEP_AS_IS",
          warnings: [],
          reason: "Looks complete.",
        }],
      }),
    });

    expect(reviewed.completenessReviewSource).toBe("AI");
    expect(reviewed.completenessAction).not.toBe("KEEP_AS_IS");
    expect(reviewed.completenessWarnings).toContain("INCOMPLETE_ENDING");
  });

  it("applies a valid AI suggested end by snapping to a real transcript segment", async () => {
    const segments: TranscriptSegmentBoundary[] = [
      { startTimeSeconds: 0, endTimeSeconds: 14, text: "God placed a gift in you for the church." },
      { startTimeSeconds: 14, endTimeSeconds: 30, text: "You can serve with courage because" },
      { startTimeSeconds: 30, endTimeSeconds: 55, text: "therefore choose one faithful act this week and stir up your gift." },
    ];
    const [reviewed] = await reviewClipCompletenessCandidates([
      candidate({
        startTimeSeconds: 0,
        endTimeSeconds: 30,
        durationSeconds: 30,
        transcriptText: segments.slice(0, 2).map((segment) => segment.text).join(" "),
        adjustedStartTimeSeconds: 0,
        adjustedEndTimeSeconds: 30,
      }),
    ], segments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 8.8,
          action: "END_LATER",
          suggestedEndTimeSeconds: 54.2,
          warnings: [],
          reason: "Extend to the application segment.",
        }],
      }),
    });

    expect(reviewed.endTimeSeconds).toBe(55);
    expect(reviewed.durationSeconds).toBe(55);
    expect(reviewed.transcriptText).toContain("stir up your gift");
    expect(reviewed.completenessWarnings).not.toContain("INCOMPLETE_ENDING");
  });

  it("ignores an out-of-range AI suggested time", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([candidate()], baseSegments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 9,
          action: "END_LATER",
          suggestedEndTimeSeconds: 9999,
          warnings: [],
          reason: "Invalid extension.",
        }],
      }),
    });

    expect(reviewed.endTimeSeconds).toBe(62);
    expect(reviewed.completenessAction).toBe("KEEP_AS_IS");
    expect(reviewed.completenessWarnings).toEqual([]);
  });

  it("lets AI lower a score when it identifies a real issue", async () => {
    const [reviewed] = await reviewClipCompletenessCandidates([candidate()], baseSegments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 5.4,
          action: "NEEDS_REVIEW",
          warnings: ["CONTEXT_RISK"],
          reason: "The clip may need pastoral context.",
        }],
      }),
    });

    expect(reviewed.completenessReviewSource).toBe("AI");
    expect(reviewed.completenessScore).toBeLessThan(8.4);
    expect(reviewed.completenessWarnings).toContain("CONTEXT_RISK");
  });

  it("falls back safely when an AI response omits a candidate review", async () => {
    const reviewed = await reviewClipCompletenessCandidates([candidate(), candidate({ title: "Second Clip" })], baseSegments, {
      rawResponseOverride: JSON.stringify({
        reviews: [{
          candidateIndex: 0,
          standaloneCompletenessScore: 8.8,
          action: "KEEP_AS_IS",
          warnings: [],
          reason: "First clip is complete.",
        }],
      }),
    });

    expect(reviewed[0].completenessReviewSource).toBe("AI");
    expect(reviewed[1].completenessReviewSource).toBe("FALLBACK");
    expect(reviewed[1].completenessAction).toBe("KEEP_AS_IS");
  });

  it("includes only nearby transcript context in the completeness prompt", () => {
    const manySegments: TranscriptSegmentBoundary[] = Array.from({ length: 80 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `Segment ${index} sermon text.`,
    }));
    const prompt = __clipCompletenessTestUtils.buildUserPrompt([{
      candidate: candidate({
        startTimeSeconds: 300,
        endTimeSeconds: 340,
        durationSeconds: 40,
        transcriptText: manySegments.slice(30, 34).map((segment) => segment.text).join(" "),
      }),
      originalIndex: 0,
    }], manySegments);

    expect(prompt).toContain("[30] IN_CLIP");
    expect(prompt).toContain("[28] CONTEXT");
    expect(prompt).toContain("[36] CONTEXT");
    expect(prompt).not.toContain("[0] CONTEXT");
    expect(prompt).not.toContain("Segment 79 sermon text.");
  });

  it("batches candidates while preserving candidate identity and order", async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => candidate({
      title: `Clip ${index}`,
      startTimeSeconds: 0,
      endTimeSeconds: 62,
      durationSeconds: 62,
    }));
    const reviewed = await reviewClipCompletenessCandidates(candidates, baseSegments, {
      batchSize: 3,
      rawResponseOverride: [
        JSON.stringify({
          reviews: [0, 1, 2].map((candidateIndex) => ({
            candidateIndex,
            standaloneCompletenessScore: 8 + candidateIndex * 0.1,
            action: "KEEP_AS_IS",
            warnings: [],
            reason: `Batch one review ${candidateIndex}.`,
          })),
        }),
        JSON.stringify({
          reviews: [3, 4].map((candidateIndex) => ({
            candidateIndex,
            standaloneCompletenessScore: 8 + candidateIndex * 0.1,
            action: "KEEP_AS_IS",
            warnings: [],
            reason: `Batch two review ${candidateIndex}.`,
          })),
        }),
      ],
    });

    expect(reviewed.map((item) => item.title)).toEqual(["Clip 0", "Clip 1", "Clip 2", "Clip 3", "Clip 4"]);
    expect(reviewed.every((item) => item.completenessReviewSource === "AI")).toBe(true);
    expect(reviewed[4].completenessReason).toContain("Batch two review 4");
  });
});
