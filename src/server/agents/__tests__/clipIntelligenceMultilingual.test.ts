import { describe, expect, it } from "vitest";

import { __clipIntelligenceTestUtils } from "@/server/agents/clipIntelligenceAgent";

const zuluSegments = [
  { startTimeSeconds: 0, endTimeSeconds: 10, text: "UNkulunkulu uthembekile futhi abantu bakhe bayamazi ngezikhathi zonke.", confidence: 0.91 },
  { startTimeSeconds: 10, endTimeSeconds: 20, text: "Ngoba uJesu unathi asidingi ukuhamba ngokwesaba ezinhliziyweni zethu.", confidence: 0.9 },
  { startTimeSeconds: 20, endTimeSeconds: 30, text: "Ukholo lusifundisa ukubheka phambili lapho indlela ingakacaci kahle.", confidence: 0.89 },
  { startTimeSeconds: 30, endTimeSeconds: 40, text: "Manje khetha ukumethemba, lalela izwi lakhe, futhi uqhubeke ngesibindi.", confidence: 0.88 },
  { startTimeSeconds: 40, endTimeSeconds: 50, text: "Thandaza nomndeni wakho, khonza ibandla, uthethelele labo abakuzwise ubuhlungu.", confidence: 0.87 },
  { startTimeSeconds: 50, endTimeSeconds: 60, text: "Hamba ngokholo namuhla ngoba insindiso nomusa wakhe kusipha ithemba.", confidence: 0.9 },
];

describe("multilingual clip discovery", () => {
  it("does not discard a structurally complete Zulu sermon moment for lacking English landing words", () => {
    const quality = __clipIntelligenceTestUtils.assessClipWindowQuality(
      zuluSegments,
      60,
      { sermonLanguage: "isiZulu" },
    );
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(
      zuluSegments,
      [],
      { sermonLanguage: "isiZulu" },
    );

    expect(quality.windowQualityWarnings).not.toContain("WINDOW_NO_CLEAR_LANDING");
    expect(quality.windowQualityScore).toBeGreaterThan(6);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].transcriptEvidence).toMatchObject({
      languageProfile: "NGUNI_LOCAL",
      requiresHumanReview: true,
    });
  });

  it("keeps code-switch evidence separate from transcript grounding and requires review", () => {
    const mixedSegments = zuluSegments.map((segment, index) => (
      index === 2
        ? { ...segment, text: "God is faithful, futhi ukholo lusifundisa ukubheka phambili." }
        : segment
    ));
    const windows = __clipIntelligenceTestUtils.buildRollingWindows(
      mixedSegments,
      [],
      { sermonLanguage: "English and isiZulu" },
    );

    expect(windows.some((window) => window.transcriptEvidence?.codeSwitching.detected)).toBe(true);
    expect(windows.some((window) => window.transcriptEvidence?.requiresHumanReview)).toBe(true);
  });
});
