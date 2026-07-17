import { describe, expect, it } from "vitest";

import {
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
});
