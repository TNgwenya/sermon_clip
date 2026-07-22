import type { Prisma, ProcessingJobType } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizedClipIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((clipId): clipId is string => typeof clipId === "string")
      .map((clipId) => clipId.trim())
      .filter(Boolean),
  )).sort();
}

export function buildForcedProcessingJobSummary(
  type: "DOWNLOAD_VIDEO" | "EXTRACT_AUDIO" | "TRANSCRIBE_AUDIO",
): Prisma.InputJsonObject {
  return {
    intentKey: `processing:${type}:force`,
    forceProcessing: true,
  };
}

export function isForcedProcessingJobSummary(value: unknown): boolean {
  return asRecord(value)?.["forceProcessing"] === true;
}

export function buildForcedMediaAssetRetrySummary(
  type: ProcessingJobType,
  failedGenerationSummary: unknown,
): Prisma.InputJsonObject {
  const failedSummary = asRecord(failedGenerationSummary);
  const hasClipScope = failedSummary !== null
    && Object.prototype.hasOwnProperty.call(failedSummary, "mediaAssetClipIds");
  const clipIds = normalizedClipIds(failedSummary?.["mediaAssetClipIds"]);
  const scopeKey = hasClipScope ? clipIds.join(",") || "none" : "all";

  return {
    intentKey: `media-assets:${type}:force:${scopeKey}`,
    ...(hasClipScope ? { mediaAssetClipIds: clipIds } : {}),
    forceMediaAssets: true,
  };
}
