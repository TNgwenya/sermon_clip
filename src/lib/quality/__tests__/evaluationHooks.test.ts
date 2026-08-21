import { describe, expect, it } from "vitest";

import { evaluateQualityTags, summarizeQualityEvaluations } from "../evaluationHooks";

describe("quality evaluation hooks", () => {
  it("reports missing and unexpected regression tags", () => {
    const result = evaluateQualityTags({
      fixtureId: "mixed-language-scripture",
      expectedTags: ["multilingual_review", "sensitive_term_review"],
      actualTags: ["multilingual_review", "confidence_low"],
    });
    expect(result).toMatchObject({
      passed: false,
      missingTags: ["sensitive_term_review"],
      unexpectedTags: ["confidence_low"],
    });
  });

  it("summarizes a provider-free fixture run", () => {
    const passed = evaluateQualityTags({ fixtureId: "a", expectedTags: ["pass"], actualTags: ["pass"] });
    const failed = evaluateQualityTags({ fixtureId: "b", expectedTags: ["review"], actualTags: [] });
    expect(summarizeQualityEvaluations([passed, failed])).toEqual({
      fixtureCount: 2,
      passedCount: 1,
      failedFixtureIds: ["b"],
      passRate: 0.5,
    });
  });
});
