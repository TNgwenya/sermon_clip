import { describe, expect, it } from "vitest";

import { buildResolvedFramingPlanDocument } from "@/lib/resolvedFramingPlan";
import { __resolvedFramingPlanServiceTestUtils } from "@/server/agents/resolvedFramingPlanService";

function resolvedPlan() {
  return buildResolvedFramingPlanDocument({
    clipCandidateId: "clip-1",
    editPlanId: "edit-plan-2",
    editPlanHash: "edit-hash-2",
    requestedLayout: "SMART_CROP",
    requestedPersonality: "SPEAKER_FOCUS",
    sourceGeometry: {
      width: 1920,
      height: 1080,
      role: "ORIGINAL_SOURCE",
    },
    trackingSource: "MODEL",
    trackingPoints: [
      { timeSeconds: 0, centerX: 0.3, centerY: 0.44, confidence: 0.92 },
      { timeSeconds: 8, centerX: 0.7, centerY: 0.5, confidence: 0.9 },
    ],
  });
}

describe("resolved framing plan persistence parsing", () => {
  it("accepts a complete versioned plan attached to an active edit revision", () => {
    const plan = resolvedPlan();
    const parsed = __resolvedFramingPlanServiceTestUtils.parseResolvedFramingPlan(plan);

    expect(parsed?.identity.editPlanId).toBe("edit-plan-2");
    expect(parsed?.effective.treatment).toBe("SPEAKER_FOCUS");
    expect(parsed?.tracking.timeline).toHaveLength(2);
  });

  it("rejects partial or obsolete documents instead of inventing preview tracking", () => {
    expect(__resolvedFramingPlanServiceTestUtils.parseResolvedFramingPlan(null)).toBeNull();
    expect(__resolvedFramingPlanServiceTestUtils.parseResolvedFramingPlan({
      schemaVersion: 0,
      tracking: { timeline: [] },
    })).toBeNull();
  });

  it("requires the plan hash, status, and resolution timestamp before reuse", () => {
    const plan = resolvedPlan();
    const resolvedAt = new Date("2026-07-27T12:00:00.000Z");
    const persisted = __resolvedFramingPlanServiceTestUtils.persistedPlanFromRecord({
      resolvedFramingPlan: plan,
      resolvedFramingPlanHash: "resolved-hash-2",
      framingPlanStatus: "READY",
      framingPlanResolvedAt: resolvedAt,
    });

    expect(persisted).toEqual({
      plan,
      planHash: "resolved-hash-2",
      status: "READY",
      resolvedAt,
      reused: true,
    });
    expect(__resolvedFramingPlanServiceTestUtils.persistedPlanFromRecord({
      resolvedFramingPlan: plan,
      resolvedFramingPlanHash: null,
      framingPlanStatus: "READY",
      framingPlanResolvedAt: resolvedAt,
    })).toBeNull();
  });
});
