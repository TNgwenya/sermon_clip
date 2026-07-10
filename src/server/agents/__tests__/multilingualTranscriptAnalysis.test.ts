import { describe, expect, it } from "vitest";

import {
  analyzeMultilingualTranscript,
  findLocalActionMarkers,
  findLocalSpiritualAnchorMarkers,
  hasLocalActionMarker,
  hasLocalSpiritualAnchor,
  tokenizeUnicode,
} from "@/server/agents/multilingualTranscriptAnalysis";
import {
  englishSermonSegments,
  lowConfidenceMixedSegments,
  missingConfidenceSegments,
  sothoSermonSegments,
  zuluEnglishCodeSwitchSegments,
  zuluSermonSegments,
} from "@/server/agents/__tests__/fixtures/multilingualTranscriptFixtures";

describe("multilingual transcript analysis", () => {
  it("tokenizes Unicode wording without dropping local-language letters", () => {
    expect(tokenizeUnicode("Tšepa uNkulunkulu — thandaza!"))
      .toEqual(["tšepa", "unkulunkulu", "thandaza"]);
  });

  it("classifies a high-confidence English sermon without adding review reasons", () => {
    const result = analyzeMultilingualTranscript(englishSermonSegments);

    expect(result.languageProfile).toBe("ENGLISH");
    expect(result.codeSwitching.detected).toBe(false);
    expect(result.confidenceBand).toBe("HIGH");
    expect(result.averageConfidence).toBeCloseTo(0.925, 3);
    expect(result.knownConfidenceCoverageRatio).toBe(1);
    expect(result.uncertainRegions).toEqual([]);
    expect(result.reviewReasons).toEqual([]);
    expect(result.requiresHumanReview).toBe(false);
  });

  it("detects Nguni local-language evidence without inventing a translation", () => {
    const result = analyzeMultilingualTranscript(zuluSermonSegments);

    expect(result.languageProfile).toBe("NGUNI_LOCAL");
    expect(result.codeSwitching.detected).toBe(false);
    expect(result.confidenceBand).toBe("HIGH");
    expect(result.markerEvidence.nguniMarkerCount).toBeGreaterThan(0);
    expect(result.reviewReasons.map((reason) => reason.code)).toContain("LOCAL_LANGUAGE_DETECTED");
    expect(JSON.stringify(result)).not.toMatch(/translation|englishMeaning|gloss/i);
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects Sotho/Tswana evidence and preserves diacritic-aware action markers", () => {
    const result = analyzeMultilingualTranscript(sothoSermonSegments);
    const actions = findLocalActionMarkers("Joale tšepa Jesu mme rapela.");

    expect(result.languageProfile).toBe("SOTHO_TSWANA");
    expect(result.confidenceBand).toBe("HIGH");
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: "SOTHO_TSWANA", token: "tšepa" }),
      expect.objectContaining({ family: "SOTHO_TSWANA", token: "rapela" }),
    ]));
  });

  it("detects both within-segment and between-segment code-switching", () => {
    const result = analyzeMultilingualTranscript(zuluEnglishCodeSwitchSegments);

    expect(result.languageProfile).toBe("MIXED");
    expect(result.codeSwitching).toMatchObject({
      detected: true,
      withinSegment: true,
      betweenSegments: true,
    });
    expect(result.codeSwitching.transitionTimesSeconds).toContain(90);
    expect(result.reviewReasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "LOCAL_LANGUAGE_DETECTED",
      "CODE_SWITCHING_DETECTED",
    ]));
    expect(result.uncertainRegions.some((region) => region.reasons.includes("CODE_SWITCHING"))).toBe(true);
  });

  it("uses real low confidence to identify timed review regions", () => {
    const result = analyzeMultilingualTranscript(lowConfidenceMixedSegments);

    expect(result.confidenceBand).toBe("LOW");
    expect(result.minimumConfidence).toBe(0.55);
    expect(result.lowConfidenceCoverageRatio).toBeCloseTo(2 / 3, 3);
    expect(result.reviewReasons.map((reason) => reason.code)).toContain("LOW_CONFIDENCE_TRANSCRIPT");
    expect(result.uncertainRegions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        startTimeSeconds: 130,
        confidence: 0.58,
        reasons: expect.arrayContaining(["LOW_CONFIDENCE", "CODE_SWITCHING"]),
      }),
      expect.objectContaining({
        startTimeSeconds: 140,
        confidence: 0.55,
        reasons: expect.arrayContaining(["LOW_CONFIDENCE"]),
      }),
    ]));
  });

  it("keeps missing provider confidence unknown instead of assigning a fallback value", () => {
    const result = analyzeMultilingualTranscript(missingConfidenceSegments);

    expect(result.confidenceBand).toBe("UNKNOWN");
    expect(result.averageConfidence).toBeNull();
    expect(result.minimumConfidence).toBeNull();
    expect(result.knownConfidenceCoverageRatio).toBe(0);
    expect(result.reviewReasons.map((reason) => reason.code)).toContain("MISSING_CONFIDENCE");
    expect(result.uncertainRegions).toEqual([
      expect.objectContaining({
        startTimeSeconds: 160,
        endTimeSeconds: 180,
        confidence: null,
        reasons: ["MISSING_CONFIDENCE"],
      }),
    ]);
  });

  it("reports partial confidence coverage conservatively", () => {
    const result = analyzeMultilingualTranscript([
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "God is faithful to the church.", confidence: 0.92 },
      { startTimeSeconds: 10, endTimeSeconds: 20, text: "Today you should pray with faith." },
    ]);

    expect(result.confidenceBand).toBe("REVIEW");
    expect(result.averageConfidence).toBe(0.92);
    expect(result.knownConfidenceCoverageRatio).toBe(0.5);
    expect(result.reviewReasons.map((reason) => reason.code)).toContain("PARTIAL_CONFIDENCE_COVERAGE");
    expect(result.uncertainRegions[0]).toMatchObject({
      startTimeSeconds: 10,
      endTimeSeconds: 20,
      confidence: null,
      reasons: ["MISSING_CONFIDENCE"],
    });
  });

  it("ignores invalid segments and invalid confidence without fabricating evidence", () => {
    const result = analyzeMultilingualTranscript([
      { startTimeSeconds: 0, endTimeSeconds: 0, text: "Invalid timing", confidence: 0.99 },
      { startTimeSeconds: 1, endTimeSeconds: 5, text: "God and the church should pray.", confidence: 1.2 },
    ]);

    expect(result.usableSegmentCount).toBe(1);
    expect(result.invalidSegmentCount).toBe(1);
    expect(result.averageConfidence).toBeNull();
    expect(result.confidenceBand).toBe("UNKNOWN");
    expect(result.reviewReasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "INVALID_SEGMENTS_IGNORED",
      "MISSING_CONFIDENCE",
    ]));
  });

  it("returns an honest unknown result when no segment is usable", () => {
    const result = analyzeMultilingualTranscript([
      { startTimeSeconds: 4, endTimeSeconds: 2, text: "", confidence: 0.9 },
    ]);

    expect(result.languageProfile).toBe("UNKNOWN");
    expect(result.confidenceBand).toBe("UNKNOWN");
    expect(result.averageConfidence).toBeNull();
    expect(result.reviewReasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "NO_USABLE_SEGMENTS",
      "INVALID_SEGMENTS_IGNORED",
    ]));
  });

  it("exposes conservative local spiritual-anchor and action helpers", () => {
    const spiritual = findLocalSpiritualAnchorMarkers("uNkulunkulu noJesu banika abantu ukholo.");

    expect(spiritual).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: "NGUNI_LOCAL", kind: "SPIRITUAL_ANCHOR", token: "unkulunkulu" }),
      expect.objectContaining({ family: "NGUNI_LOCAL", kind: "SPIRITUAL_ANCHOR", token: "nojesu" }),
      expect.objectContaining({ family: "NGUNI_LOCAL", kind: "SPIRITUAL_ANCHOR", token: "ukholo" }),
    ]));
    expect(hasLocalSpiritualAnchor("Modimo o re fa tumelo.")).toBe(true);
    expect(hasLocalActionMarker("Khetha ukholo futhi thandaza.")).toBe(true);
    expect(hasLocalSpiritualAnchor("God gives the church faith.")).toBe(false);
    expect(hasLocalActionMarker("Choose faith and pray.")).toBe(false);
  });

  it("keeps unfamiliar language evidence unknown even when timing confidence is high", () => {
    const result = analyzeMultilingualTranscript([
      {
        startTimeSeconds: 0,
        endTimeSeconds: 8,
        text: "Ndi khou amba mafhungo avhudi kha vhathu vhothe.",
        confidence: 0.95,
      },
    ]);

    expect(result.languageProfile).toBe("UNKNOWN");
    expect(result.confidenceBand).toBe("HIGH");
    expect(result.reviewReasons.map((reason) => reason.code)).toContain("UNKNOWN_LANGUAGE");
    expect(result.requiresHumanReview).toBe(true);
  });
});
