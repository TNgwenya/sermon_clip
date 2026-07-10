import { describe, expect, it } from "vitest";

import {
  buildTranscriptReviewGuidance,
  extractTranscriptReviewEvidence,
} from "@/lib/transcriptReviewGuidance";

describe("transcript review guidance", () => {
  it("extracts only durable transcript evidence from a quality snapshot", () => {
    const evidence = extractTranscriptReviewEvidence({
      transcriptEvidence: {
        languageProfile: "MIXED",
        confidenceBand: "LOW",
        codeSwitching: { detected: true },
        reviewReasons: [{ code: "CODE_SWITCHING_DETECTED", message: "Check the language change." }],
        uncertainRegions: [{
          startTimeSeconds: 12,
          endTimeSeconds: 18,
          text: "Ngoba uNkulunkulu is faithful",
          reasons: ["CODE_SWITCHING", "LOW_CONFIDENCE"],
        }],
      },
    });

    expect(evidence).toMatchObject({
      languageProfile: "MIXED",
      confidenceBand: "LOW",
      codeSwitchingDetected: true,
    });
    expect(evidence?.uncertainRegions[0].text).toContain("uNkulunkulu");
  });

  it("prioritizes a clear code-switch review action without claiming a translation", () => {
    const guidance = buildTranscriptReviewGuidance({
      transcriptSafetyReasons: ["CODE_SWITCHING_DETECTED"],
      evidence: {
        languageProfile: "MIXED",
        confidenceBand: "HIGH",
        codeSwitchingDetected: true,
        reviewReasons: [],
        uncertainRegions: [],
      },
      boundaryQuality: "GOOD",
    });

    expect(guidance.title).toContain("language change");
    expect(guidance.summary).toContain("has not translated");
    expect(guidance.actionLabel).toContain("listened");
  });
});
