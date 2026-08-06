import { describe, expect, it } from "vitest";

import { teachingVideoWindowResponseSchema } from "@/server/ai/teachingVideoSchema";

const validCandidate = {
  startAnchorId: "segment-000010:start",
  endAnchorId: "segment-000080:end",
  recommendedStartSeconds: 120,
  recommendedEndSeconds: 680,
  titleOptions: [
    "Could What You’re Watching Be Holding You Back?",
    "What Is Your Focus Doing to Your Future?",
    "Are You Feeding the Thoughts That Keep You Stuck?",
  ],
  titleEvidence: "faith that endures",
  teachingType: "SCRIPTURE_EXPOSITION",
  completeness: {
    standaloneScore: 0.92,
    boundaryConfidence: 0.88,
    topicIntroduced: true,
    argumentResolved: true,
    scriptureComplete: true,
    illustrationComplete: true,
    prayerOrConclusionComplete: true,
  },
  startReason: "A new complete teaching claim begins here.",
  endReason: "The application resolves before a new subject begins.",
  contextDependencies: [],
  riskFlags: [],
  durationExceptionReason: null,
} as const;

describe("teaching video AI response schema", () => {
  it("accepts a strict continuous-range candidate", () => {
    expect(teachingVideoWindowResponseSchema.parse({
      schemaVersion: 2,
      windowId: "teaching-window-001",
      candidates: [validCandidate],
    }).candidates).toHaveLength(1);
  });

  it("allows the model to return no suitable teaching section", () => {
    expect(teachingVideoWindowResponseSchema.parse({
      schemaVersion: 2,
      windowId: "teaching-window-002",
      candidates: [],
    }).candidates).toEqual([]);
  });

  it("rejects extra editing instructions or missing anchor evidence", () => {
    expect(() => teachingVideoWindowResponseSchema.parse({
      schemaVersion: 2,
      windowId: "teaching-window-001",
      candidates: [{
        ...validCandidate,
        startAnchorId: "",
        rearrangedTranscript: "This field must never be accepted.",
      }],
    })).toThrow();
  });

  it("rejects fewer than three distinct title options", () => {
    expect(() => teachingVideoWindowResponseSchema.parse({
      schemaVersion: 2,
      windowId: "teaching-window-001",
      candidates: [{
        ...validCandidate,
        titleOptions: [
          "Could This Habit Be Holding You Back?",
          "Could This Habit Be Holding You Back?",
        ],
      }],
    })).toThrow();
  });
});
