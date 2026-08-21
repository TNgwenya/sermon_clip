export type QualityEvaluationResult = {
  fixtureId: string;
  passed: boolean;
  expectedTags: string[];
  actualTags: string[];
  missingTags: string[];
  unexpectedTags: string[];
};

/** A provider-free hook for golden fixtures and pilot regression dashboards. */
export function evaluateQualityTags(input: {
  fixtureId: string;
  expectedTags: string[];
  actualTags: string[];
  allowUnexpected?: boolean;
}): QualityEvaluationResult {
  const expected = [...new Set(input.expectedTags)].sort();
  const actual = [...new Set(input.actualTags)].sort();
  const missingTags = expected.filter((tag) => !actual.includes(tag));
  const unexpectedTags = actual.filter((tag) => !expected.includes(tag));
  return {
    fixtureId: input.fixtureId,
    passed: missingTags.length === 0 && (input.allowUnexpected === true || unexpectedTags.length === 0),
    expectedTags: expected,
    actualTags: actual,
    missingTags,
    unexpectedTags,
  };
}

export function summarizeQualityEvaluations(results: QualityEvaluationResult[]): {
  fixtureCount: number;
  passedCount: number;
  failedFixtureIds: string[];
  passRate: number;
} {
  const passedCount = results.filter((result) => result.passed).length;
  return {
    fixtureCount: results.length,
    passedCount,
    failedFixtureIds: results.filter((result) => !result.passed).map((result) => result.fixtureId),
    passRate: results.length > 0 ? Number((passedCount / results.length).toFixed(4)) : 1,
  };
}
