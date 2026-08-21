import { describe, expect, it } from "vitest";

import {
  assessInventoryCoverage,
  assessSourceWindow,
  MEDIA_COST_SAFETY_POLICY,
} from "@/lib/mediaCostPolicy";

describe("media cost safety policy", () => {
  it("keeps expensive follow-on work on demand and publishing explicit", () => {
    expect(MEDIA_COST_SAFETY_POLICY).toEqual({
      eagerPreviewLimit: 3,
      remainingPreviewMode: "ON_DEMAND",
      contentWeekMode: "ON_DEMAND",
      finalRenderMode: "APPROVAL_GATED",
      publishingMode: "EXPLICIT_INTENT",
      artifactReuseMode: "REUSE_MATCHING_FRESH_ARTIFACT",
      lifecycleMode: "OBSERVE_ONLY",
      automaticDeletionEnabled: false,
    });
  });

  it("quantifies a complete preaching window without claiming realised savings", () => {
    expect(assessSourceWindow({
      sourceDurationSeconds: 7_200,
      sermonStartSeconds: 1_200,
      sermonEndSeconds: 4_800,
      analyzeFullRecording: false,
    })).toMatchObject({
      status: "BOUNDED",
      analysisWindowSeconds: 3_600,
      potentialAvoidedSeconds: 3_600,
    });
  });

  it("flags incomplete and invalid boundaries instead of estimating", () => {
    expect(assessSourceWindow({
      sourceDurationSeconds: 3_600,
      sermonStartSeconds: 600,
      sermonEndSeconds: null,
    })).toMatchObject({ status: "PARTIAL", potentialAvoidedSeconds: null });
    expect(assessSourceWindow({
      sourceDurationSeconds: 3_600,
      sermonStartSeconds: 2_000,
      sermonEndSeconds: 1_000,
    })).toMatchObject({ status: "INVALID", potentialAvoidedSeconds: null });
  });

  it("labels inventory totals as partial when size metadata is missing", () => {
    expect(assessInventoryCoverage({
      recordCount: 5,
      recordsWithSize: 3,
      knownBytes: BigInt(4_096),
    })).toEqual({
      recordCount: 5,
      recordsWithSize: 3,
      knownBytes: BigInt(4_096),
      coveragePercent: 60,
      completeness: "PARTIAL_METADATA",
    });
  });
});
