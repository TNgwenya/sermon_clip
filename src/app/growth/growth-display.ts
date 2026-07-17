import type { HistoricalPerformanceBaseline } from "@/lib/growthPersistence";

export const MIN_MATCHED_FORECAST_SNAPSHOTS = 5;

function normalizePlatformIdentity(value: string): string {
  return value.toLowerCase().replace(/shorts|[^a-z0-9]/g, "");
}

export function findMeasuredBaseline(
  platform: string,
  baselines: HistoricalPerformanceBaseline[],
): HistoricalPerformanceBaseline | null {
  const platformKey = normalizePlatformIdentity(platform);
  return baselines.find((baseline) => (
    normalizePlatformIdentity(baseline.platform) === platformKey
    && baseline.snapshotCount >= MIN_MATCHED_FORECAST_SNAPSHOTS
  )) ?? null;
}

export function hasMeasuredBaseline(
  platforms: string[],
  baselines: HistoricalPerformanceBaseline[],
): boolean {
  return platforms.length > 0
    && platforms.every((platform) => Boolean(findMeasuredBaseline(platform, baselines)));
}

export function canShowCalibratedForecast(input: {
  confidence: string;
  platforms: string[];
  baselines: HistoricalPerformanceBaseline[];
  calibratedFromHistory: boolean;
}): boolean {
  return input.calibratedFromHistory
    && input.confidence.toLowerCase() === "high"
    && hasMeasuredBaseline(input.platforms, input.baselines);
}
