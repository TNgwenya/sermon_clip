import type { ClipExportFormat } from "@prisma/client";

import {
  isCaptionStylePresetId,
  type CaptionStylePresetId,
} from "@/lib/captionStylePresets";
import {
  extractCaptionAppearanceSettings,
  extractCaptionDesignSettings,
  extractCaptionStyleOverride,
  extractCaptionStyleSource,
} from "@/lib/clipStudio";

export type ClipStudioPrepareFreshness = "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";

export type ClipStudioPrepareAssetSnapshot = {
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  renderFreshness?: ClipStudioPrepareFreshness | null;
  renderedFileReady: boolean;
  framingPlanReady?: boolean;
  captionsEnabled: boolean;
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionFreshness?: ClipStudioPrepareFreshness | null;
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  captionBurnFreshness?: ClipStudioPrepareFreshness | null;
  captionedFileReady: boolean;
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
  exportFreshness?: ClipStudioPrepareFreshness | null;
};

export type ClipStudioPrepareAssetPlan = {
  prepareVideo: boolean;
  writeCaptions: boolean;
  burnCaptions: boolean;
  skipCaptionBurn: boolean;
  exportPreparedVideo: boolean;
};

export type ClipStudioQueuedAsset = "render" | "caption" | "captionBurn" | "export";

export type FrozenCaptionStyleSnapshot = {
  captionData: Record<string, unknown>;
  changed: boolean;
  captionStylePresetId: CaptionStylePresetId;
};

function normalizeJsonKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonKeyOrder);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeJsonKeyOrder(nestedValue)]),
    );
  }
  return value;
}

function hasEquivalentJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonKeyOrder(left))
    === JSON.stringify(normalizeJsonKeyOrder(right));
}

export function freezeEffectiveCaptionStyleSnapshot(
  captionData: unknown,
  fallbackCaptionStylePresetId: CaptionStylePresetId,
): FrozenCaptionStyleSnapshot {
  const current =
    captionData && typeof captionData === "object" && !Array.isArray(captionData)
      ? captionData as Record<string, unknown>
      : {};
  const captionStyleSource = extractCaptionStyleSource(current);
  const savedPresetId = isCaptionStylePresetId(current["captionStylePresetId"])
    ? current["captionStylePresetId"]
    : null;
  const captionStylePresetId =
    extractCaptionStyleOverride(current)
    || savedPresetId
    || fallbackCaptionStylePresetId;
  const captionDesign = extractCaptionDesignSettings(
    current,
    captionStylePresetId,
  );
  const frozenCaptionData = {
    ...current,
    captionStyleSource,
    captionStylePresetId: captionDesign.presetId,
    captionPosition: captionDesign.layout.verticalPosition,
    captionAppearance: extractCaptionAppearanceSettings(current),
    captionDesign,
  };

  return {
    captionData: frozenCaptionData,
    changed: !hasEquivalentJsonValue(frozenCaptionData, current),
    captionStylePresetId: captionDesign.presetId,
  };
}

export function buildClipStudioQueuedAssetIntent(
  clipId: string,
  forceRebuild: boolean,
): { clipIds: string[]; force: boolean } {
  return {
    clipIds: [clipId],
    force: forceRebuild,
  };
}

export function shouldForceClipStudioPrepare(
  operation: "save" | "prepare",
  _hasPreparedMedia: boolean,
  _serverNeedsUpdate: boolean,
  explicitRebuild = false,
): boolean {
  return operation === "prepare" && explicitRebuild;
}

export function buildClipStudioQueuedAssets(
  snapshot: ClipStudioPrepareAssetSnapshot,
  plan: ClipStudioPrepareAssetPlan,
): ClipStudioQueuedAsset[] {
  const assets: ClipStudioQueuedAsset[] = [];

  if (plan.writeCaptions) {
    assets.push("caption");
  }
  if (plan.prepareVideo) {
    assets.push("render");
  }
  if (plan.burnCaptions) {
    assets.push("captionBurn");
  }
  if (plan.exportPreparedVideo) {
    assets.push("export");
  }

  return assets;
}

export type ClipStudioPreparationRecord = {
  format: ClipExportFormat;
  status: "WAITING" | "RENDERING" | "COMPLETED" | "FAILED";
  outputPath: string | null;
  fileExists: boolean;
  createdAt?: string | null;
  isLatest?: boolean;
};

export type ClipStudioCanonicalExport = {
  format: ClipExportFormat | null;
  status: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED" | null;
  freshness: ClipStudioPrepareFreshness | null;
  outputPath: string | null;
  fileExists: boolean;
};

export type ClipStudioPreparationState = {
  state: "READY" | "NEEDS_UPDATE" | "PREPARING" | "MISSING" | "FAILED";
  ready: boolean;
  needsUpdate: boolean;
  preparing: boolean;
  missing: boolean;
  failed: boolean;
  availableFormats: ClipExportFormat[];
  readyFormats: ClipExportFormat[];
  preparingFormats: ClipExportFormat[];
  missingFormats: ClipExportFormat[];
  failedFormats: ClipExportFormat[];
};

export type ClipStudioPreparationStateInput = {
  selectedFormats: ClipExportFormat[];
  records: ClipStudioPreparationRecord[];
  canonicalExport: ClipStudioCanonicalExport;
  trustCompletedOutputMetadata: boolean;
  upstreamNeedsUpdate?: boolean;
  upstreamPreparing?: boolean;
  upstreamFailed?: boolean;
};

function isUpToDate(value: ClipStudioPrepareFreshness | null | undefined): boolean {
  return value === "UP_TO_DATE";
}

function recordTime(record: ClipStudioPreparationRecord): number {
  const timestamp = record.createdAt ? Date.parse(record.createdAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestRecordForFormat(
  records: ClipStudioPreparationRecord[],
  format: ClipExportFormat,
): ClipStudioPreparationRecord | null {
  const matching = records.filter((record) => record.format === format);
  const explicitlyLatest = matching.filter((record) => record.isLatest === true);
  const candidates = explicitlyLatest.length > 0 ? explicitlyLatest : matching;

  return candidates.reduce<ClipStudioPreparationRecord | null>((latest, record) => {
    if (!latest || recordTime(record) >= recordTime(latest)) {
      return record;
    }
    return latest;
  }, null);
}

function outputIsAvailable(input: {
  outputPath: string | null;
  fileExists: boolean;
  trustCompletedOutputMetadata: boolean;
}): boolean {
  if (!input.outputPath?.trim()) {
    return false;
  }

  return input.trustCompletedOutputMetadata || input.fileExists;
}

export function resolveClipStudioPreparationState(
  input: ClipStudioPreparationStateInput,
): ClipStudioPreparationState {
  const selectedFormats = Array.from(new Set(input.selectedFormats));
  const availableFormats: ClipExportFormat[] = [];
  const readyFormats: ClipExportFormat[] = [];
  const preparingFormats: ClipExportFormat[] = [];
  const missingFormats: ClipExportFormat[] = [];
  const failedFormats: ClipExportFormat[] = [];

  for (const format of selectedFormats) {
    const record = latestRecordForFormat(input.records, format);
    if (record) {
      if (record.status === "WAITING" || record.status === "RENDERING") {
        preparingFormats.push(format);
        continue;
      }
      if (record.status === "FAILED") {
        failedFormats.push(format);
        continue;
      }

      const available = outputIsAvailable({
        outputPath: record.outputPath,
        fileExists: record.fileExists,
        trustCompletedOutputMetadata: input.trustCompletedOutputMetadata,
      });
      if (available) {
        availableFormats.push(format);
        readyFormats.push(format);
      } else {
        missingFormats.push(format);
      }
      continue;
    }

    if (input.canonicalExport.format === format) {
      if (input.canonicalExport.status === "QUEUED" || input.canonicalExport.status === "EXPORTING") {
        preparingFormats.push(format);
        continue;
      }
      if (input.canonicalExport.status === "FAILED") {
        failedFormats.push(format);
        continue;
      }
      if (input.canonicalExport.status === "COMPLETED") {
        const available = outputIsAvailable({
          outputPath: input.canonicalExport.outputPath,
          fileExists: input.canonicalExport.fileExists,
          trustCompletedOutputMetadata: input.trustCompletedOutputMetadata,
        });
        if (available) {
          availableFormats.push(format);
          if (isUpToDate(input.canonicalExport.freshness)) {
            readyFormats.push(format);
          }
        } else {
          missingFormats.push(format);
        }
        continue;
      }
    }

    missingFormats.push(format);
  }

  const preparing = Boolean(input.upstreamPreparing) || preparingFormats.length > 0;
  const failed = Boolean(input.upstreamFailed) || failedFormats.length > 0;
  const missing = selectedFormats.length === 0 || missingFormats.length > 0;
  const needsUpdate =
    Boolean(input.upstreamNeedsUpdate) ||
    failed ||
    missing ||
    (!preparing && readyFormats.length !== selectedFormats.length);
  const ready =
    selectedFormats.length > 0 &&
    readyFormats.length === selectedFormats.length &&
    !needsUpdate &&
    !preparing;
  const state: ClipStudioPreparationState["state"] = ready
    ? "READY"
    : failed
      ? "FAILED"
      : preparing
        ? "PREPARING"
        : missing
          ? "MISSING"
          : "NEEDS_UPDATE";

  return {
    state,
    ready,
    needsUpdate,
    preparing,
    missing,
    failed,
    availableFormats,
    readyFormats,
    preparingFormats,
    missingFormats,
    failedFormats,
  };
}

export function buildClipStudioPrepareAssetPlan(
  snapshot: ClipStudioPrepareAssetSnapshot,
  options: { forceRebuild?: boolean } = {},
): ClipStudioPrepareAssetPlan {
  const writeCaptions =
    snapshot.captionsEnabled &&
    (
      snapshot.captionStatus !== "GENERATED" ||
      !isUpToDate(snapshot.captionFreshness)
    );

  if (options.forceRebuild) {
    return {
      prepareVideo: true,
      writeCaptions,
      burnCaptions: snapshot.captionsEnabled,
      skipCaptionBurn: !snapshot.captionsEnabled && snapshot.captionBurnStatus !== "NOT_BURNED",
      exportPreparedVideo: true,
    };
  }

  const prepareVideo =
    snapshot.renderStatus !== "COMPLETED" ||
    !isUpToDate(snapshot.renderFreshness) ||
    !snapshot.renderedFileReady ||
    snapshot.framingPlanReady === false;
  const burnCaptions =
    snapshot.captionsEnabled &&
    (
      prepareVideo ||
      writeCaptions ||
      snapshot.captionBurnStatus !== "COMPLETED" ||
      !isUpToDate(snapshot.captionBurnFreshness) ||
      !snapshot.captionedFileReady
    );
  const skipCaptionBurn = !snapshot.captionsEnabled && snapshot.captionBurnStatus !== "NOT_BURNED";
  const exportPreparedVideo =
    prepareVideo ||
    burnCaptions ||
    skipCaptionBurn ||
    snapshot.exportStatus !== "COMPLETED" ||
    !isUpToDate(snapshot.exportFreshness);

  return {
    prepareVideo,
    writeCaptions,
    burnCaptions,
    skipCaptionBurn,
    exportPreparedVideo,
  };
}
