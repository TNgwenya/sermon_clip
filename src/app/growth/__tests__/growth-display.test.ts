import { describe, expect, it } from "vitest";

import {
  buildWeeklyGrowthDecision,
  canShowCalibratedForecast,
  findMeasuredBaseline,
  hasMeasuredBaseline,
  MIN_MATCHED_FORECAST_SNAPSHOTS,
} from "@/app/growth/growth-display";
import type { HistoricalPerformanceBaseline } from "@/lib/growthPersistence";

function baseline(platform: string, snapshotCount: number): HistoricalPerformanceBaseline {
  return {
    platform,
    snapshotCount,
    averageReach: 1_250,
    averageViews: 1_500,
    averageEngagementRate: 4.8,
    totalFollowerGrowth: 12,
    totalWatchTimeSeconds: 3_600,
  };
}

describe("growth forecast display evidence", () => {
  it("requires enough matched measurements before exposing precise forecasts", () => {
    const baselines = [baseline("YouTube", MIN_MATCHED_FORECAST_SNAPSHOTS - 1)];

    expect(findMeasuredBaseline("YouTube Shorts", baselines)).toBeNull();
    expect(hasMeasuredBaseline(["YouTube Shorts"], baselines)).toBe(false);
  });

  it("matches platform aliases once the evidence threshold is met", () => {
    const youtube = baseline("YouTube", MIN_MATCHED_FORECAST_SNAPSHOTS);

    expect(findMeasuredBaseline("YouTube Shorts", [youtube])).toEqual(youtube);
    expect(hasMeasuredBaseline(["Instagram", "YouTube Shorts"], [youtube])).toBe(false);
    expect(hasMeasuredBaseline(["YouTube Shorts"], [youtube])).toBe(true);
  });

  it("keeps exact forecasts hidden until the model actually consumes matched history", () => {
    const youtube = baseline("YouTube", MIN_MATCHED_FORECAST_SNAPSHOTS);

    expect(canShowCalibratedForecast({
      confidence: "High",
      platforms: ["YouTube Shorts"],
      baselines: [youtube],
      calibratedFromHistory: false,
    })).toBe(false);
    expect(canShowCalibratedForecast({
      confidence: "High",
      platforms: ["YouTube Shorts"],
      baselines: [youtube],
      calibratedFromHistory: true,
    })).toBe(true);
  });

  it("turns a recommendation into an evidence-bound weekly decision", () => {
    const decision = buildWeeklyGrowthDecision({
      recommendation: {
        title: "Grace is already moving",
        confidence: "Medium",
        platforms: ["Instagram"],
        rationale: ["This clip has a saved post-ready editorial assessment."],
      },
      baselines: [],
      connectedCount: 1,
    });

    expect(decision.title).toBe("Grace is already moving");
    expect(decision.evidence).toBe("This clip has a saved post-ready editorial assessment.");
    expect(decision.measurement).toContain("too limited");
    expect(decision.measurement).not.toMatch(/\d+ reach|\d+ followers/);
  });

  it("does not claim a recommendation or measurement when qualifying data is absent", () => {
    const decision = buildWeeklyGrowthDecision({
      recommendation: null,
      baselines: [],
      connectedCount: 0,
    });

    expect(decision.recommendationAvailable).toBe(false);
    expect(decision.confidence).toBe("Not available");
    expect(decision.evidence).toContain("No recommendation is claimed");
    expect(decision.measurement).toBe("No measured performance baseline is available yet.");
  });

  it("names measured platforms without claiming that history calibrated the forecast", () => {
    const decision = buildWeeklyGrowthDecision({
      recommendation: {
        title: "A measured YouTube choice",
        confidence: "High",
        platforms: ["YouTube Shorts"],
        rationale: [],
      },
      baselines: [baseline("YouTube", MIN_MATCHED_FORECAST_SNAPSHOTS)],
      connectedCount: 1,
    });

    expect(decision.measurement).toContain("Measured history is available for YouTube Shorts");
    expect(decision.measurement).toContain("forecasts remain hidden");
  });
});
