import { describe, expect, it } from "vitest";

import type {
  GrowthClipInput,
  GrowthRecommendation,
} from "@/lib/growthSystem";
import {
  aggregateGrowthEvidence,
  evidenceBoundRecommendationMatchesApprovedClip,
  buildEvidenceBoundSavedRecommendations,
  type GrowthMetricSnapshotInput,
} from "./evidenceBoundRecommendationService";

const scope = {
  organizationId: "org-grace",
  campusId: "campus-central",
};

function clip(): GrowthClipInput {
  return {
    id: "clip-1",
    title: "God remains near",
    hook: "You are not alone in this storm.",
    caption: "God remains near when life feels loud.",
    hashtags: ["#Faith"],
    score: 80,
    finalQualityScore: 84,
    exportStatus: "COMPLETED",
    status: "EXPORTED",
    sermon: {
      id: "sermon-1",
      title: "Peace in the storm",
      churchName: "Grace Church",
    },
  };
}

function recommendation(): GrowthRecommendation {
  return {
    id: "growth-rec-clip-1",
    priority: 84,
    title: "Generated growth title",
    sourceClipId: "clip-1",
    sourceSermonId: "sermon-1",
    ministryTheme: "Prayer",
    platforms: ["Instagram", "Facebook"],
    postingWindow: "Generated unproven time",
    hook: "Generated hook",
    caption: "Generated copy that should not replace approval.",
    cta: "Generated CTA",
    hashtags: ["#Generated"],
    prediction: {
      reachLow: 100,
      reachHigh: 200,
      engagementRate: 4,
      followerGrowthLow: 0,
      followerGrowthHigh: 2,
      expectedWatchTimeSeconds: 20,
      confidence: "Medium",
      reasoning: [],
    },
    rationale: ["Generated rationale"],
    guardrails: ["Human approval required."],
  };
}

function snapshots(input: {
  organizationId?: string;
  count?: number;
} = {}): GrowthMetricSnapshotInput[] {
  return Array.from({ length: input.count ?? 5 }, (_, index) => ({
    organizationId: input.organizationId ?? scope.organizationId,
    campusId: scope.campusId,
    platform: "INSTAGRAM",
    capturedAt: new Date(`2026-07-${String(20 + index).padStart(2, "0")}T08:00:00.000Z`),
    engagementRate: 4 + index,
    reach: 100 + index * 10,
    watchTimeSeconds: 1_000 + index * 100,
    retentionRate: null,
    saves: 5 + index,
    shares: null,
    followerGrowth: 1,
  }));
}

describe("evidence-bound growth recommendation service", () => {
  it("aggregates only tenant evidence into stable citations", () => {
    const evidence = aggregateGrowthEvidence({
      scope,
      snapshots: [
        ...snapshots(),
        ...snapshots({ organizationId: "org-other" }),
      ],
    });

    expect(evidence.find((item) => item.metric === "ENGAGEMENT_RATE")).toMatchObject({
      organizationId: "org-grace",
      platform: "Instagram",
      value: 6,
      sampleSize: 5,
      aggregation: "AGGREGATED",
    });
    expect(evidence.every((item) => item.citationId.startsWith("growth-evidence:"))).toBe(true);
  });

  it("persists only the exact approved clip copy with cited operational guidance", () => {
    const result = buildEvidenceBoundSavedRecommendations({
      scope,
      evaluatedAt: new Date("2026-07-29T09:00:00.000Z"),
      recommendations: [recommendation()],
      clips: [clip()],
      snapshots: snapshots(),
    });

    expect(result.blockedCount).toBe(0);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      title: "God remains near",
      hook: "You are not alone in this storm.",
      caption: "God remains near when life feels loud.",
      cta: "",
      hashtags: ["#Faith"],
      platforms: ["Instagram"],
      postingWindow: "Choose a reviewed publishing window",
      evidenceBoundRelease: {
        change: {
          kind: "PRIORITIZE_APPROVED_ASSET",
          platform: "Instagram",
        },
        contentLock: {
          mayAlterTheology: false,
          allowedMutationPaths: ["queuePriority"],
          requiresApprovedPreviewIdentityAtPublish: true,
        },
      },
    });
    expect(result.recommendations[0].caption).not.toContain("Generated");
    expect(result.recommendations[0].evidenceBoundRelease.citations.length).toBeGreaterThan(0);
    expect(evidenceBoundRecommendationMatchesApprovedClip(
      result.recommendations[0],
      clip(),
    )).toBe(true);
    expect(evidenceBoundRecommendationMatchesApprovedClip(
      { ...result.recommendations[0], caption: "Changed later" },
      clip(),
    )).toBe(false);
  });

  it("fails closed when aggregate evidence does not reach the privacy threshold", () => {
    const result = buildEvidenceBoundSavedRecommendations({
      scope,
      evaluatedAt: new Date("2026-07-29T09:00:00.000Z"),
      recommendations: [recommendation()],
      clips: [clip()],
      snapshots: snapshots({ count: 2 }),
    });

    expect(result.recommendations).toEqual([]);
    expect(result.blockedCount).toBe(1);
  });

  it("does not release unapproved clip content", () => {
    const result = buildEvidenceBoundSavedRecommendations({
      scope,
      evaluatedAt: new Date("2026-07-29T09:00:00.000Z"),
      recommendations: [recommendation()],
      clips: [{ ...clip(), status: "SUGGESTED" }],
      snapshots: snapshots(),
    });

    expect(result.recommendations).toEqual([]);
    expect(result.blockedCount).toBe(1);
  });
});
