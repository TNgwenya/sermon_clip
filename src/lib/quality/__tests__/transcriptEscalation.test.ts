import { describe, expect, it } from "vitest";

import {
  decideTranscriptQualityEscalation,
  detectUncertainSensitiveTerms,
  fingerprintCanonicalTimestampTranscript,
} from "../transcriptEscalation";

const healthy = {
  qualityReady: true,
  usableSegmentCount: 120,
  wordCount: 3_200,
  coverageRatio: 0.94,
  expectedDurationCoverageRatio: 0.92,
  maxGapSeconds: 8,
  largeGapCount: 0,
  languageProfile: "ENGLISH" as const,
  confidenceBand: "HIGH" as const,
  knownConfidenceCoverageRatio: 0.95,
  lowConfidenceCoverageRatio: 0.01,
};

describe("transcript quality escalation", () => {
  it("accepts high-quality evidence without spending a retry", () => {
    expect(decideTranscriptQualityEscalation(healthy)).toMatchObject({
      disposition: "ACCEPT",
      automationMode: "FULL",
      retry: "NONE",
      canonicalTranscriptMayBeRewritten: false,
    });
  });

  it("uses one explainable retry for fixable coverage and confidence issues", () => {
    const decision = decideTranscriptQualityEscalation({
      ...healthy,
      qualityReady: false,
      expectedDurationCoverageRatio: 0.48,
      confidenceBand: "LOW",
      lowConfidenceCoverageRatio: 0.3,
    });

    expect(decision).toMatchObject({
      disposition: "RETRY_ONCE",
      retry: "SPEECH_ENHANCED_AUDIO_ONCE",
      retryBudgetRemaining: 1,
      allowBasicRecovery: false,
    });
    expect(decision.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "BASE_QUALITY_GATE_FAILED",
      "LOW_EXPECTED_COVERAGE",
      "LOW_PROVIDER_CONFIDENCE",
    ]));
  });

  it("falls back to manual-review-only after the bounded retry", () => {
    const decision = decideTranscriptQualityEscalation({
      ...healthy,
      qualityReady: false,
      languageProfile: "MIXED",
      confidenceBand: "LOW",
      uncertainScriptureCount: 2,
      enhancementAttemptsUsed: 1,
    });

    expect(decision).toMatchObject({
      disposition: "MANUAL_REVIEW_ONLY",
      automationMode: "MANUAL_REVIEW_ONLY",
      retry: "NONE",
      allowBasicRecovery: true,
    });
    expect(decision.evaluationTags).toEqual(expect.arrayContaining([
      "multilingual_review",
      "sensitive_term_review",
    ]));
  });

  it("uses truthful manual review when the enhancement lane is unavailable", () => {
    expect(decideTranscriptQualityEscalation({
      ...healthy,
      qualityReady: false,
      confidenceBand: "LOW",
      enhancementAvailable: false,
    })).toMatchObject({
      disposition: "MANUAL_REVIEW_ONLY",
      retry: "NONE",
      retryBudgetRemaining: 0,
      allowBasicRecovery: true,
    });
  });

  it("requires fluent review for otherwise good local-language wording", () => {
    const decision = decideTranscriptQualityEscalation({
      ...healthy,
      languageProfile: "NGUNI_LOCAL",
    });
    expect(decision.disposition).toBe("MANUAL_REVIEW_ONLY");
    expect(decision.retry).toBe("NONE");
  });

  it("fails closed when no reviewable timestamp transcript exists", () => {
    expect(decideTranscriptQualityEscalation({
      ...healthy,
      usableSegmentCount: 0,
      wordCount: 0,
    })).toMatchObject({
      disposition: "BLOCKED",
      automationMode: "NONE",
      allowBasicRecovery: false,
    });
  });

  it("detects only known names and reference-shaped Scripture inside uncertain regions", () => {
    expect(detectUncertainSensitiveTerms({
      uncertainRegions: [
        { text: "Pastor Ndlovu reads John 3:16 before the invitation." },
        { text: "A separate uncertain sentence mentions Grace." },
      ],
      knownNames: ["Pastor Ndlovu", "Someone Else"],
    })).toEqual({ uncertainNameCount: 1, uncertainScriptureCount: 1 });
  });

  it("fingerprints exact timestamp evidence without reordering or rewriting it", () => {
    const segments = [
      { startTimeSeconds: 1.25, endTimeSeconds: 3.5, text: "Keep the exact words.", confidence: 0.91 },
      { startTimeSeconds: 3.5, endTimeSeconds: 5, text: "And exact timing." },
    ];
    const fingerprint = fingerprintCanonicalTimestampTranscript(segments);
    expect(fingerprint).toHaveLength(64);
    expect(fingerprintCanonicalTimestampTranscript([...segments].reverse())).not.toBe(fingerprint);
    expect(segments[0]).toEqual({ startTimeSeconds: 1.25, endTimeSeconds: 3.5, text: "Keep the exact words.", confidence: 0.91 });
  });
});
