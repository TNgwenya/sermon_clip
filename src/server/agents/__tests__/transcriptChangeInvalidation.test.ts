import { describe, expect, it } from "vitest";

import {
  planClipTranscriptReplacement,
  transcriptSegmentEvidenceChanged,
  transcriptExcerptForRange,
  transcriptTextChanged,
} from "@/server/agents/transcriptChangeInvalidation";

const segments = [
  { startTimeSeconds: 0, endTimeSeconds: 8, text: "Opening outside the clip.", confidence: 0.92 },
  { startTimeSeconds: 10, endTimeSeconds: 18, text: "Trust God in every season.", confidence: 0.91 },
  { startTimeSeconds: 18, endTimeSeconds: 28, text: "His grace will carry you.", confidence: 0.9 },
];

describe("transcript change invalidation", () => {
  it("builds the replacement excerpt only from overlapping timed segments", () => {
    expect(transcriptExcerptForRange(segments, 10, 28)).toBe(
      "Trust God in every season. His grace will carry you.",
    );
  });

  it("compares normalized Unicode transcript text without inventing changes", () => {
    expect(transcriptTextChanged("  uNkulunkulu   uyathembeka ", "uNkulunkulu uyathembeka")).toBe(false);
    expect(transcriptTextChanged("Modimo o molemo", "Modimo o a re rata")).toBe(true);
  });

  it("detects timing or confidence changes even when the wording is unchanged", () => {
    expect(transcriptSegmentEvidenceChanged(segments, segments.map((segment) => ({ ...segment })))).toBe(false);
    expect(transcriptSegmentEvidenceChanged(segments, segments.map((segment, index) => (
      index === 1 ? { ...segment, confidence: 0.51 } : segment
    )))).toBe(true);
    expect(transcriptSegmentEvidenceChanged(segments, segments.map((segment, index) => (
      index === 1 ? { ...segment, startTimeSeconds: 11 } : segment
    )))).toBe(true);
  });

  it("preserves review history reasons while resetting changed clip evidence", () => {
    const plan = planClipTranscriptReplacement({
      clip: {
        id: "clip-1",
        startTimeSeconds: 10,
        endTimeSeconds: 28,
        transcriptText: "An older uncertain transcript.",
        transcriptSafetyReasons: ["CODE_SWITCHING_DETECTED"],
        postReadyBlockers: [],
        qualityWarnings: ["PASTOR_REVIEW_BOUNDARY"],
      },
      previousSegments: [{
        startTimeSeconds: 10,
        endTimeSeconds: 28,
        text: "An older uncertain transcript.",
        confidence: null,
      }],
      segments,
    });

    expect(plan.excerptChanged).toBe(true);
    expect(plan.transcriptText).toContain("His grace will carry you");
    expect(plan.transcriptSafetyReasons).toEqual(expect.arrayContaining([
      "CODE_SWITCHING_DETECTED",
      "TRANSCRIPT_CHANGED_AFTER_CLIP_GENERATION",
    ]));
    expect(plan.qualityWarnings).toContain("TRANSCRIPT_CHANGED_REVIEW_REQUIRED");
    expect(plan.postReadyBlockers).toContain(
      "Review the transcript wording before captions, export, or posting.",
    );
    expect(plan.qualityDebugSnapshot.transcriptEvidence.confidenceBand).toBe("HIGH");
  });

  it("requires fresh review for confidence-only changes and replaces stale uncertainty evidence", () => {
    const previousSegments = segments.map((segment) => ({ ...segment }));
    const lowerConfidenceSegments = segments.map((segment, index) => (
      index === 1 ? { ...segment, confidence: 0.48 } : segment
    ));
    const plan = planClipTranscriptReplacement({
      clip: {
        id: "clip-2",
        startTimeSeconds: 10,
        endTimeSeconds: 28,
        transcriptText: "Trust God in every season. His grace will carry you.",
        transcriptSafetyReasons: [],
        postReadyBlockers: [],
        qualityWarnings: [],
      },
      previousSegments,
      segments: lowerConfidenceSegments,
    });

    expect(plan.excerptChanged).toBe(false);
    expect(plan.evidenceChanged).toBe(true);
    expect(plan.requiresFreshReview).toBe(true);
    expect(plan.transcriptSafetyReasons).toContain("LOW_CONFIDENCE_TRANSCRIPT_REGION");
    expect(plan.qualityDebugSnapshot.transcriptEvidence.confidenceBand).toBe("LOW");
    expect(plan.qualityDebugSnapshot.transcriptEvidence.uncertainRegions[0]).toMatchObject({
      startTimeSeconds: 10,
      confidence: 0.48,
    });
  });
});
