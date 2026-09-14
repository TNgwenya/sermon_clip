import { describe, expect, it } from "vitest";
import { isBasicFallbackClip, transcriptReadinessLabel } from "../sermonReadiness";

describe("honest sermon readiness", () => {
  it("recognizes persisted fallback evidence", () => {
    expect(isBasicFallbackClip({ qualityDebugSnapshot: { fallback: { kind: "BASIC_TIME_BASED_CLIP" } } })).toBe(true);
    expect(isBasicFallbackClip({ qualityWarnings: ["BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE"] })).toBe(true);
    expect(isBasicFallbackClip({})).toBe(false);
    expect(isBasicFallbackClip({ qualityDebugSnapshot: { fallback: null } })).toBe(false);
  });
  it("never confuses saved transcript data with quality validation", () => {
    expect(transcriptReadinessLabel(true, true, true)).toBe("Saved — quality review required");
    expect(transcriptReadinessLabel(true, true, false)).toBe("Saved — verify wording");
    expect(transcriptReadinessLabel(true, false, true)).toBe("Not ready");
  });
});
