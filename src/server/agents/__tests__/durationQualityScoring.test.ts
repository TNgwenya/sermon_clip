import { describe, expect, it } from "vitest";

import { scoreDurationQuality } from "@/server/agents/durationQualityScoring";

describe("duration quality scoring", () => {
  it("uses short targets for quote or punchline clips", () => {
    const result = scoreDurationQuality({
      durationSeconds: 28,
      clipType: "funny",
      smartClipCategory: "Best Quote Clip",
    });

    expect(result.durationQualityLabel).toBe("IDEAL");
    expect(result.targetMaxSeconds).toBe(40);
  });

  it("keeps story and testimony clips targeted to 45-90 seconds", () => {
    const result = scoreDurationQuality({
      durationSeconds: 130,
      clipType: "testimony",
      transcriptText: "This testimony tells the story and then applies it.",
    });

    expect(result.durationQualityLabel).toBe("TOO_LONG");
    expect(result.targetMinSeconds).toBe(45);
    expect(result.targetMaxSeconds).toBe(90);
  });

  it("does not mark a 59-second prayer clip as tight", () => {
    const result = scoreDurationQuality({
      durationSeconds: 59.42,
      clipType: "pastoral",
      smartClipCategory: "Prayer for Families",
      transcriptText: "The pastor prays for families and asks God to help them walk in wisdom.",
    });

    expect(result.durationQualityLabel).toBe("IDEAL");
    expect(result.targetMinSeconds).toBe(45);
    expect(result.targetMaxSeconds).toBe(90);
  });
});
