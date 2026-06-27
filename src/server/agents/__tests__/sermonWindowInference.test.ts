import { describe, expect, it } from "vitest";

import {
  applyInferredSermonWindowToSegments,
  inferSermonWindowFromTranscript,
} from "@/server/agents/sermonWindowInference";

function segment(startTimeSeconds: number, durationSeconds: number, words: number) {
  return {
    startTimeSeconds,
    endTimeSeconds: startTimeSeconds + durationSeconds,
    text: Array.from({ length: words }, (_, index) => `word${index}`).join(" "),
  };
}

describe("sermon window inference", () => {
  it("detects the sustained preaching section inside a long Sunday service", () => {
    const openingAndTransitions = [
      segment(60, 4, 5),
      segment(1800, 5, 8),
      segment(3000, 30, 90),
      segment(4800, 20, 80),
    ];
    const preaching = Array.from({ length: 14 }, (_, index) => {
      return segment(9000 + index * 300, 260, 260);
    });
    const closingAfterLargeGap = [
      segment(13440, 120, 150),
      segment(13700, 20, 20),
      segment(14300, 10, 8),
    ];

    const inferred = inferSermonWindowFromTranscript([
      ...openingAndTransitions,
      ...preaching,
      ...closingAfterLargeGap,
    ], {
      knownDurationSeconds: 4 * 60 * 60,
    });

    expect(inferred).toMatchObject({
      startTimeSeconds: 9000,
      wordCount: expect.any(Number),
      segmentCount: expect.any(Number),
    });
    expect(inferred?.endTimeSeconds).toBeGreaterThanOrEqual(12900);
    expect(inferred?.endTimeSeconds).toBeLessThan(13700);
    expect(inferred?.reason).toContain("densest sustained preaching section");
  });

  it("does not override manual sermon windows", () => {
    const segments = Array.from({ length: 14 }, (_, index) => {
      return segment(9000 + index * 300, 260, 260);
    });

    const inferred = inferSermonWindowFromTranscript(segments, {
      sermonStartSeconds: 9000,
      sermonEndSeconds: 13200,
      knownDurationSeconds: 4 * 60 * 60,
    });

    expect(inferred).toBeNull();
  });

  it("filters segments to the inferred window", () => {
    const segments = [
      segment(30, 5, 10),
      segment(9000, 20, 230),
      segment(9300, 20, 240),
    ];
    const filtered = applyInferredSermonWindowToSegments(segments, {
      startTimeSeconds: 9000,
      endTimeSeconds: 9600,
      durationSeconds: 600,
      wordCount: 470,
      segmentCount: 2,
      reason: "test",
    });

    expect(filtered).toHaveLength(2);
    expect(filtered[0]?.startTimeSeconds).toBe(9000);
  });
});
