import { describe, expect, it } from "vitest";

import { buildBasicClipFallbackPlan } from "@/server/agents/basicClipFallbackService";

describe("basic clip fallback planning", () => {
  it("creates a bounded review set inside the configured sermon range", () => {
    const plan = buildBasicClipFallbackPlan({
      sourceDurationSeconds: 7_770.16,
      sermonStartSeconds: 4_020,
      sermonEndSeconds: 7_680,
      analyzeFullRecording: false,
    });

    expect(plan.windowStartSeconds).toBe(4_020);
    expect(plan.windowEndSeconds).toBe(7_680);
    expect(plan.clipCount).toBe(12);
    expect(plan.clips.every((clip) => clip.durationSeconds === 60)).toBe(true);
    expect(plan.clips.every((clip) => (
      clip.startTimeSeconds >= plan.windowStartSeconds
      && clip.endTimeSeconds <= plan.windowEndSeconds
    ))).toBe(true);
    expect(plan.clips.every((clip, index) => (
      index === 0 || clip.startTimeSeconds >= plan.clips[index - 1].endTimeSeconds
    ))).toBe(true);
  });

  it("uses the full recording when full-recording analysis is configured", () => {
    const plan = buildBasicClipFallbackPlan({
      sourceDurationSeconds: 300,
      sermonStartSeconds: 90,
      sermonEndSeconds: 180,
      analyzeFullRecording: true,
    });

    expect(plan.windowStartSeconds).toBe(0);
    expect(plan.windowEndSeconds).toBe(300);
    expect(plan.clipCount).toBe(3);
    expect(plan.clips.map((clip) => clip.title)).toEqual([
      "Basic clip 01",
      "Basic clip 02",
      "Basic clip 03",
    ]);
  });

  it("refuses to imply a usable clip when the configured range is too short", () => {
    expect(() => buildBasicClipFallbackPlan({
      sourceDurationSeconds: 120,
      sermonStartSeconds: 100,
      sermonEndSeconds: 120,
      analyzeFullRecording: false,
    })).toThrow("shorter than 30 seconds");
  });
});
