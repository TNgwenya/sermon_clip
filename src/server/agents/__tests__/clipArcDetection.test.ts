import { describe, expect, it } from "vitest";

import { detectClipArc } from "@/server/agents/clipArcDetection";

const baseCandidate = {
  startTimeSeconds: 30,
  endTimeSeconds: 95,
  durationSeconds: 65,
  title: "Faith That Walks",
  hook: "What do you do when faith feels hard?",
  clipType: "teaching",
  smartClipCategory: "Best Faith Clip",
  contextWarning: false,
};

describe("clip arc detection", () => {
  it("detects scripture explanation and application arcs", () => {
    const arc = detectClipArc({
      ...baseCandidate,
      transcriptText: "The Bible says the just shall live by faith. That means today we choose to trust God and walk in obedience.",
    });

    expect(arc.clipArcType).toBe("SCRIPTURE_EXPLANATION_APPLICATION");
    expect(arc.arcCompletenessScore).toBeGreaterThan(7);
    expect(arc.whatContextMightBeMissing).toBeNull();
  });

  it("warns when payoff or application may be missing", () => {
    const arc = detectClipArc({
      ...baseCandidate,
      transcriptText: "And this is connected to what we said before about the second point",
      contextWarning: true,
    });

    expect(arc.arcCompletenessScore).toBeLessThan(7);
    expect(arc.whatContextMightBeMissing).toContain("May need");
  });
});
