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

export type WeeklyGrowthDecision = {
  recommendationAvailable: boolean;
  actionLabel: string;
  title: string;
  detail: string;
  evidence: string;
  measurement: string;
  confidence: "High" | "Medium" | "Low" | "Not available";
};

export function buildWeeklyGrowthDecision(input: {
  recommendation?: {
    title: string;
    confidence: "High" | "Medium" | "Low";
    platforms: string[];
    rationale: string[];
  } | null;
  baselines: HistoricalPerformanceBaseline[];
  connectedCount: number;
}): WeeklyGrowthDecision {
  const measuredPlatforms = input.baselines.filter((baseline) => (
    baseline.snapshotCount >= MIN_MATCHED_FORECAST_SNAPSHOTS
  ));
  const recommendation = input.recommendation;

  if (!recommendation) {
    return {
      recommendationAvailable: false,
      actionLabel: "Review sermon clips",
      title: "Choose a growth-ready sermon moment",
      detail: "No unscheduled approved or exported clip is available for a next-post recommendation.",
      evidence: "No recommendation is claimed until a qualifying clip is present.",
      measurement: measuredPlatforms.length > 0
        ? `${measuredPlatforms.length} measured platform baseline${measuredPlatforms.length === 1 ? "" : "s"} will support a future decision.`
        : "No measured performance baseline is available yet.",
      confidence: "Not available",
    };
  }

  const matchedPlatforms = recommendation.platforms.filter((platform) => (
    Boolean(findMeasuredBaseline(platform, input.baselines))
  ));
  const evidence = recommendation.rationale[0]?.trim()
    || "Ranked from the clip’s saved quality, readiness, audience, and scheduling signals.";
  const measurement = matchedPlatforms.length === recommendation.platforms.length
    && recommendation.platforms.length > 0
    ? `Measured history is available for ${matchedPlatforms.join(", ")}; exact forecasts remain hidden until calibration uses it.`
    : input.connectedCount > 0
      ? "Connected channels are available, but matched performance history is still too limited for a precise forecast."
      : "No connected channel history is available, so this remains a directional editorial recommendation.";

  return {
    recommendationAvailable: true,
    actionLabel: recommendation.confidence === "Low" ? "Review recommendation" : "Prepare this post",
    title: recommendation.title,
    detail: recommendation.confidence === "Low"
      ? "Treat this as a review prompt, not an automatic publishing decision."
      : `Prepare this for ${recommendation.platforms.join(", ") || "the selected channels"}.`,
    evidence,
    measurement,
    confidence: recommendation.confidence,
  };
}
