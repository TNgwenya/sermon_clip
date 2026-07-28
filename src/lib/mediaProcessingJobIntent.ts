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

export function resolveMediaAssetJobDependencyId(value: unknown): string | null {
  const dependencyId = asRecord(value)?.["mediaAssetDependsOnJobId"];
  return typeof dependencyId === "string" && dependencyId.trim().length > 0
    ? dependencyId.trim()
    : null;
}

export type MediaAssetJobDependencyDecision =
  | { state: "READY"; dependencyId: null | string }
  | { state: "WAITING"; dependencyId: string }
  | { state: "FAILED"; dependencyId: string; reason: string };

export function evaluateMediaAssetJobDependency(input: {
  jobId: string;
  sermonId: string;
  generationSummary: unknown;
  dependency?: {
    id: string;
    sermonId: string;
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  } | null;
}): MediaAssetJobDependencyDecision {
  const dependencyId = resolveMediaAssetJobDependencyId(input.generationSummary);
  if (!dependencyId) {
    return { state: "READY", dependencyId: null };
  }
  if (dependencyId === input.jobId) {
    return {
      state: "FAILED",
      dependencyId,
      reason: "Media job dependency cannot reference the job itself.",
    };
  }
  if (!input.dependency || input.dependency.id !== dependencyId) {
    return {
      state: "FAILED",
      dependencyId,
      reason: `Required predecessor job ${dependencyId} was not found.`,
    };
  }
  if (input.dependency.sermonId !== input.sermonId) {
    return {
      state: "FAILED",
      dependencyId,
      reason: `Required predecessor job ${dependencyId} belongs to a different sermon.`,
    };
  }
  if (input.dependency.status === "FAILED") {
    return {
      state: "FAILED",
      dependencyId,
      reason: `Required predecessor job ${dependencyId} failed.`,
    };
  }
  if (input.dependency.status !== "SUCCEEDED") {
    return { state: "WAITING", dependencyId };
  }
  return { state: "READY", dependencyId };
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
