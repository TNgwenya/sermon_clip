import { describe, expect, it } from "vitest";

import {
  __clipJsonSchemaTestUtils,
  clipJsonCandidateSchema,
} from "@/server/ai/clipJsonSchema";

const baseCandidate = {
  startTimeSeconds: 10,
  endTimeSeconds: 70,
  durationSeconds: 60,
  transcriptText: "God has not forgotten you. Keep walking by faith today.",
  title: "Keep Walking",
  hook: "God has not forgotten you.",
  caption: "Keep walking by faith today.",
  hashtags: ["#Faith"],
  score: 8,
  reasonSelected: "Clear encouragement.",
  landingSentence: "Keep walking by faith today.",
  clipType: "teaching",
  smartClipCategory: "Best Faith Clip",
  intendedAudience: "People who need encouragement",
  ministryValue: "Encouragement rooted in faith.",
  socialValue: "Short-form encouragement.",
  riskLevel: "LOW",
  riskReasons: [],
  contextWarning: false,
};

describe("clip JSON schema", () => {
  it("accepts indexed candidates without model-owned timestamps or transcript text", () => {
    const indexed = { ...baseCandidate } as Record<string, unknown>;
    delete indexed.startTimeSeconds;
    delete indexed.endTimeSeconds;
    delete indexed.durationSeconds;
    delete indexed.transcriptText;
    Object.assign(indexed, {
      windowId: "window-4-10120-10210",
      startSegmentIndex: 1,
      endSegmentIndex: 8,
      hookSegmentIndex: 1,
      landingSegmentIndex: 7,
    });

    const parsed = clipJsonCandidateSchema.parse(indexed);

    expect(parsed.windowId).toBe("window-4-10120-10210");
    expect(parsed.startSegmentIndex).toBe(1);
    expect(parsed.startTimeSeconds).toBeUndefined();
  });

  it("rejects indexed candidates with landing indexes outside the selected range", () => {
    const indexed = {
      ...baseCandidate,
      windowId: "window-4-10120-10210",
      startSegmentIndex: 1,
      endSegmentIndex: 3,
      landingSegmentIndex: 4,
    };

    const result = clipJsonCandidateSchema.safeParse(indexed);

    expect(result.success).toBe(false);
  });

  it("repairs missing arc metadata with defaults for salvage compatibility", () => {
    const parsed = clipJsonCandidateSchema.parse(baseCandidate);

    expect(parsed.arcType).toBe("PROBLEM_TRUTH_APPLICATION");
    expect(parsed.arcSummary).toContain("fallback");
    expect(parsed.whyThisClipFeelsComplete).toContain("schema repair");
    expect(parsed.setupStartTime).toBeNull();
  });

  it("preserves required arc metadata when provided by AI", () => {
    const parsed = clipJsonCandidateSchema.parse({
      ...baseCandidate,
      arcType: "SCRIPTURE_EXPLANATION_APPLICATION",
      arcSummary: "Scripture truth with application.",
      setupStartTime: 10,
      mainPointTime: 25,
      payoffTime: 50,
      applicationTime: 62,
      whyThisClipFeelsComplete: "It has setup, truth, and application.",
      whatContextMightBeMissing: null,
    });

    expect(parsed.arcType).toBe("SCRIPTURE_EXPLANATION_APPLICATION");
    expect(parsed.landingSentence).toBe("Keep walking by faith today.");
    expect(parsed.mainPointTime).toBe(25);
  });

  it("requires explicit spoken landing evidence for AI candidates", () => {
    const withoutLanding = { ...baseCandidate } as Record<string, unknown>;
    delete withoutLanding.landingSentence;

    const result = clipJsonCandidateSchema.safeParse(withoutLanding);

    expect(result.success).toBe(false);
  });

  it("normalizes common AI enum drift without losing valid clips", () => {
    const parsed = clipJsonCandidateSchema.parse({
      ...baseCandidate,
      clipType: "teaching insight",
      smartClipCategory: "scripture explanation",
      riskLevel: "medium risk",
      arcType: "scripture teaching",
      contextWarning: true,
    });

    expect(parsed.clipType).toBe("teaching");
    expect(parsed.smartClipCategory).toBe("Best Scripture Explanation Clip");
    expect(parsed.riskLevel).toBe("MEDIUM");
    expect(parsed.arcType).toBe("SCRIPTURE_EXPLANATION_APPLICATION");
  });

  it("keeps unknown AI enum values invalid instead of guessing", () => {
    const result = clipJsonCandidateSchema.safeParse({
      ...baseCandidate,
      clipType: "financial prophecy breakthrough",
      smartClipCategory: "Best Random Viral Clip",
    });

    expect(result.success).toBe(false);
  });

  it("exposes enum normalizers for targeted regression checks", () => {
    expect(__clipJsonSchemaTestUtils.normalizeClipType("altar call")).toBe("evangelistic");
    expect(__clipJsonSchemaTestUtils.normalizeRiskLevel("moderate risk")).toBe("MEDIUM");
    expect(__clipJsonSchemaTestUtils.normalizeSmartClipCategory("call to action")).toBe("Best Call To Action Clip");
    expect(__clipJsonSchemaTestUtils.normalizeArcType("testimony application")).toBe("TESTIMONY_TO_APPLICATION");
  });
});
