import { describe, expect, it } from "vitest";

import { __clipIntelligenceTestUtils } from "@/server/agents/clipIntelligenceAgent";

describe("clip intelligence append mode", () => {
  it("resolves indexed candidates before transcript normalization", () => {
    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([{
      windowId: "window-1",
      startSegmentIndex: 0,
      endSegmentIndex: 1,
      title: "A resolved clip",
      hook: "A strong hook",
      caption: "A caption",
      hashtags: ["#faith"],
      score: 8,
      reasonSelected: "The ending lands clearly.",
      landingSentence: "The ending lands clearly.",
      clipType: "teaching",
      smartClipCategory: "Best Faith Clip",
      intendedAudience: "Church members",
      ministryValue: "Encouragement",
      socialValue: "Shareable teaching",
      riskLevel: "LOW",
      riskReasons: [],
      contextWarning: false,
    } as never], [
      {
        windowId: "window-1",
        startTimeSeconds: 100,
        endTimeSeconds: 140,
        durationSeconds: 40,
        transcriptText: "God is faithful. The ending lands clearly.",
        segmentLines: [
          "[100.0 - 120.0] God is faithful.",
          "[120.0 - 140.0] The ending lands clearly.",
        ],
        segments: [
          { segmentIndex: 0, startTimeSeconds: 100, endTimeSeconds: 120, text: "God is faithful." },
          { segmentIndex: 1, startTimeSeconds: 120, endTimeSeconds: 140, text: "The ending lands clearly." },
        ],
      },
    ] as never);

    const candidate = result.candidates[0];
    expect(candidate?.startTimeSeconds).toBe(100);
    expect(candidate?.endTimeSeconds).toBe(140);
    expect(candidate?.durationSeconds).toBe(40);
    expect(candidate?.transcriptText).toBe("God is faithful. The ending lands clearly.");
  });

  it("accepts local batch window labels from AI responses", () => {
    const result = __clipIntelligenceTestUtils.filterCandidatesToPromptWindows([{
      windowId: "Window 1",
      startSegmentIndex: 0,
      endSegmentIndex: 0,
      title: "A local window label",
      hook: "A strong hook",
      caption: "A caption",
      hashtags: ["#faith"],
      score: 8,
      reasonSelected: "The selected window lands clearly.",
      landingSentence: "The selected window lands clearly.",
      clipType: "teaching",
      smartClipCategory: "Best Faith Clip",
      intendedAudience: "Church members",
      ministryValue: "Encouragement",
      socialValue: "Shareable teaching",
      riskLevel: "LOW",
      riskReasons: [],
      contextWarning: false,
    } as never], [
      {
        windowId: "window-5",
        startTimeSeconds: 500,
        endTimeSeconds: 540,
        durationSeconds: 40,
        transcriptText: "The selected window lands clearly.",
        segmentLines: ["[500.0 - 540.0] The selected window lands clearly."],
        segments: [
          { segmentIndex: 0, startTimeSeconds: 500, endTimeSeconds: 540, text: "The selected window lands clearly." },
        ],
      },
    ] as never);

    const candidate = result.candidates[0];
    expect(candidate?.startTimeSeconds).toBe(500);
    expect(candidate?.transcriptText).toBe("The selected window lands clearly.");
  });

  it("excludes generated candidates that overlap existing clips", () => {
    const candidates = __clipIntelligenceTestUtils.excludeCandidatesOverlappingExisting([
      {
        id: "duplicate-range",
        startTimeSeconds: 110,
        endTimeSeconds: 170,
        durationSeconds: 60,
      },
      {
        id: "new-range",
        startTimeSeconds: 260,
        endTimeSeconds: 320,
        durationSeconds: 60,
      },
    ], [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 160,
        durationSeconds: 60,
      },
    ]);

    expect(candidates.map((candidate) => candidate.id)).toEqual(["new-range"]);
  });
});
