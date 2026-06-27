import { describe, expect, it } from "vitest";

import {
  analyzeClipHook,
  applyHookBoundaryAdjustment,
} from "@/server/agents/clipHookAnalysisService";

describe("clip hook analysis service", () => {
  it("flags weak contextual starts", () => {
    const result = analyzeClipHook({
      startTimeSeconds: 12,
      endTimeSeconds: 52,
      durationSeconds: 40,
      transcriptText: "And the next thing is that we need to understand grace.",
    });

    expect(result.hookType).toBe("WEAK_CONTEXTUAL_START");
    expect(result.hookScore).toBeLessThan(6);
    expect(result.hookProblem).toContain("Weak opening");
  });

  it("flags prepositional context-dependent openings", () => {
    const result = analyzeClipHook({
      startTimeSeconds: 20,
      endTimeSeconds: 70,
      durationSeconds: 50,
      transcriptText: "In that place God gives grace for the next faithful step.",
    });

    expect(result.hookType).toBe("WEAK_CONTEXTUAL_START");
    expect(result.hookScore).toBeLessThan(6);
    expect(result.hookProblem).toContain("Weak opening");
  });

  it("moves to a stronger nearby opening when possible", () => {
    const adjusted = applyHookBoundaryAdjustment(
      {
        startTimeSeconds: 10,
        endTimeSeconds: 55,
        durationSeconds: 45,
        transcriptText: "And that is why we trust him.",
      },
      [
        { startTimeSeconds: 0, endTimeSeconds: 8, text: "God has not forgotten the promise he made to you." },
        { startTimeSeconds: 10, endTimeSeconds: 18, text: "And that is why we trust him." },
        { startTimeSeconds: 18, endTimeSeconds: 55, text: "He is faithful in every season." },
      ],
    );

    expect(adjusted.adjusted).toBe(true);
    expect(adjusted.candidate.startTimeSeconds).toBe(0);
    expect(adjusted.candidate.hookScore).toBeGreaterThanOrEqual(6);
  });
});
