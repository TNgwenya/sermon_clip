import type { ClipExportFormat, ClipExportLayoutStrategy, Prisma } from "@prisma/client";
import { normalizeManualCropKeyframes, type ManualCropKeyframe } from "@/lib/manualCrop";

export type PlatformPreset =
  | "INSTAGRAM_REELS"
  | "TIKTOK"
  | "YOUTUBE_SHORTS"
  | "FACEBOOK_REELS"
  | "YOUTUBE_HORIZONTAL"
  | "WEBSITE_HORIZONTAL";

export const PLATFORM_PRESET_LABELS: Record<PlatformPreset, string> = {
  INSTAGRAM_REELS: "Reels",
  TIKTOK: "TikTok",
  YOUTUBE_SHORTS: "YouTube Shorts",
  FACEBOOK_REELS: "Facebook Reels",
  YOUTUBE_HORIZONTAL: "YouTube horizontal",
  WEBSITE_HORIZONTAL: "Website horizontal",
};

export const FORMAT_LABELS: Record<ClipExportFormat, string> = {
  VERTICAL_9_16: "Vertical 9:16",
  HORIZONTAL_16_9: "Horizontal video for YouTube or website",
  SQUARE_1_1: "Square video for Facebook or Instagram",
};

export const FRAMING_LABELS: Record<ClipExportLayoutStrategy, string> = {
  CENTER_CROP: "Center crop",
  LEFT_FOCUS: "Left crop",
  RIGHT_FOCUS: "Right crop",
  FIT_BLURRED_BACKGROUND: "Fit with blurred background",
  SMART_CROP: "Auto Intelligent",
};

export const FRAMING_DESCRIPTIONS: Record<ClipExportLayoutStrategy, string> = {
  CENTER_CROP: "Best when the pastor stays near the middle.",
  LEFT_FOCUS: "Use when the pastor is usually on the left side.",
  RIGHT_FOCUS: "Use when the pastor is usually on the right side.",
  FIT_BLURRED_BACKGROUND:
    "Keeps the full video visible with a blurred background, useful when the pastor moves around.",
  SMART_CROP: "Chooses a steady crop from saved speaker tracking and stage activity.",
};

export const SELECTABLE_FORMATS: ClipExportFormat[] = [
  "VERTICAL_9_16",
  "HORIZONTAL_16_9",
  "SQUARE_1_1",
];

export const SELECTABLE_FRAMING_MODES: ClipExportLayoutStrategy[] = [
  "CENTER_CROP",
  "LEFT_FOCUS",
  "RIGHT_FOCUS",
  "FIT_BLURRED_BACKGROUND",
  "SMART_CROP",
];

export const DEFAULT_PLATFORM_PRESET: PlatformPreset = "INSTAGRAM_REELS";
export const DEFAULT_PRIMARY_FORMAT: ClipExportFormat = "VERTICAL_9_16";
export const DEFAULT_FRAMING_MODE: ClipExportLayoutStrategy = "SMART_CROP";

export type FramingPersonality =
  | "AUTO_INTELLIGENT"
  | "SPEAKER_FOCUS"
  | "CINEMATIC_CLOSE"
  | "WORSHIP_WIDE"
  | "SOCIAL_PUNCHY"
  | "SAFE_FULL_STAGE";

export const FRAMING_PERSONALITY_LABELS: Record<FramingPersonality, string> = {
  AUTO_INTELLIGENT: "Auto intelligent",
  SPEAKER_FOCUS: "Speaker focus",
  CINEMATIC_CLOSE: "Cinematic close",
  WORSHIP_WIDE: "Worship wide",
  SOCIAL_PUNCHY: "Social punchy",
  SAFE_FULL_STAGE: "Safe full stage",
};

export const FRAMING_PERSONALITY_DISPLAY_LABELS: Record<FramingPersonality, string> = {
  AUTO_INTELLIGENT: "Auto Intelligent",
  SPEAKER_FOCUS: "Speaker Focus",
  CINEMATIC_CLOSE: "Cinematic Close",
  WORSHIP_WIDE: "Worship Wide",
  SOCIAL_PUNCHY: "Social Punchy",
  SAFE_FULL_STAGE: "Full Stage",
};

export const FRAMING_PERSONALITY_DESCRIPTIONS: Record<FramingPersonality, string> = {
  AUTO_INTELLIGENT: "Chooses the crop style from tracking, clip type, and stage activity.",
  SPEAKER_FOCUS: "Keeps the pastor framed in a steady medium crop.",
  CINEMATIC_CLOSE: "Moves closer when the moment feels personal or emotional.",
  WORSHIP_WIDE: "Keeps more stage context for worship teams, prayer, and group moments.",
  SOCIAL_PUNCHY: "Uses a tighter, energetic crop for hooks and short social moments.",
  SAFE_FULL_STAGE: "Prioritizes never cutting anyone off.",
};

export const SELECTABLE_FRAMING_PERSONALITIES: FramingPersonality[] = [
  "AUTO_INTELLIGENT",
  "SPEAKER_FOCUS",
  "CINEMATIC_CLOSE",
  "WORSHIP_WIDE",
  "SOCIAL_PUNCHY",
  "SAFE_FULL_STAGE",
];

const PLATFORM_TO_FORMAT: Record<PlatformPreset, ClipExportFormat> = {
  INSTAGRAM_REELS: "VERTICAL_9_16",
  TIKTOK: "VERTICAL_9_16",
  YOUTUBE_SHORTS: "VERTICAL_9_16",
  FACEBOOK_REELS: "VERTICAL_9_16",
  YOUTUBE_HORIZONTAL: "HORIZONTAL_16_9",
  WEBSITE_HORIZONTAL: "HORIZONTAL_16_9",
};

export type ExportSettings = {
  platformPreset: PlatformPreset;
  primaryFormat: ClipExportFormat;
  selectedFormats: ClipExportFormat[];
  framingMode: ClipExportLayoutStrategy;
  framingPersonality: FramingPersonality;
  backgroundMode: "BLURRED" | "CROP";
  manualCropKeyframes: ManualCropKeyframe[];
};

export type ClipStudioExportStatus = "WAITING" | "RENDERING" | "COMPLETED" | "FAILED";

export type ClipStudioExportRecord = {
  id: string;
  clipId: string;
  sermonId: string;
  format: ClipExportFormat;
  platformPreset: PlatformPreset;
  framingMode: ClipExportLayoutStrategy;
  status: ClipStudioExportStatus;
  outputPath: string | null;
  outputFilename: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  renderVersion: string;
  captionText: string | null;
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED" | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isLatest: boolean;
  brandingSnapshot: Prisma.JsonObject | null;
};

export type ClipStudioExportArtifactSummary = {
  id: string;
  format: ClipExportFormat | null;
  status: "READY" | "FAILED" | "DELETED";
  freshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  filePath: string | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  generatedAt: Date | string | null;
  createdAt: Date | string;
};

type CanonicalClipStudioExportSummary = {
  format: ClipExportFormat | null;
  status: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED" | null;
  outputPath: string | null;
  errorMessage: string | null;
  exportedAt: Date | string | null;
};

export function isValidPlatformPreset(value: unknown): value is PlatformPreset {
  return typeof value === "string" && Object.keys(PLATFORM_TO_FORMAT).includes(value);
}

export function isValidExportFormat(value: unknown): value is ClipExportFormat {
  return typeof value === "string" && SELECTABLE_FORMATS.includes(value as ClipExportFormat);
}

/**
 * Export services persist one canonical format/path on the clip record. Keep
 * the chosen primary format last so a successful multi-format run leaves that
 * canonical pointer on the format the editor selected as primary.
 */
export function orderExportFormatsForCanonicalPrimary(
  formats: ClipExportFormat[],
  primaryFormat: ClipExportFormat,
): ClipExportFormat[] {
  const uniqueFormats = Array.from(new Set(formats));
  if (!uniqueFormats.includes(primaryFormat)) {
    return uniqueFormats;
  }

  return [
    ...uniqueFormats.filter((format) => format !== primaryFormat),
    primaryFormat,
  ];
}

export function isValidFramingMode(value: unknown): value is ClipExportLayoutStrategy {
  return typeof value === "string" && SELECTABLE_FRAMING_MODES.includes(value as ClipExportLayoutStrategy);
}

export function isValidFramingPersonality(value: unknown): value is FramingPersonality {
  return typeof value === "string" && SELECTABLE_FRAMING_PERSONALITIES.includes(value as FramingPersonality);
}

export function mapPlatformPresetToFormat(preset: PlatformPreset): ClipExportFormat {
  return PLATFORM_TO_FORMAT[preset];
}

export function deriveBackgroundMode(framingMode: ClipExportLayoutStrategy): "BLURRED" | "CROP" {
  return framingMode === "FIT_BLURRED_BACKGROUND" ? "BLURRED" : "CROP";
}

export function resolveFramingDisplayLabel(
  settings: Pick<ExportSettings, "framingMode" | "framingPersonality">,
): string {
  if (settings.framingMode === "SMART_CROP") {
    return FRAMING_PERSONALITY_DISPLAY_LABELS[settings.framingPersonality] ?? FRAMING_LABELS[settings.framingMode];
  }

  if (settings.framingMode === "FIT_BLURRED_BACKGROUND") {
    if (settings.framingPersonality === "WORSHIP_WIDE") return "Worship Wide";
    if (settings.framingPersonality === "SAFE_FULL_STAGE") return "Full Stage";
    return "Blurred Background";
  }

  return FRAMING_LABELS[settings.framingMode];
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isValidExportStatus(value: unknown): value is ClipStudioExportStatus {
  return value === "WAITING" || value === "RENDERING" || value === "COMPLETED" || value === "FAILED";
}

function toPlatformPreset(value: unknown): PlatformPreset {
  return isValidPlatformPreset(value) ? value : DEFAULT_PLATFORM_PRESET;
}

function toFramingMode(value: unknown): ClipExportLayoutStrategy {
  return isValidFramingMode(value) ? value : DEFAULT_FRAMING_MODE;
}

function toFormat(value: unknown): ClipExportFormat | null {
  return isValidExportFormat(value) ? value : null;
}

export function resolveExportHistory(captionData: unknown): ClipStudioExportRecord[] {
  if (!captionData || typeof captionData !== "object") {
    return [];
  }

  const root = captionData as Record<string, unknown>;
  const rawHistory = root["exportHistory"];
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const records: ClipStudioExportRecord[] = [];

  for (const item of rawHistory) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const format = toFormat(record["format"]);
    const status = record["status"];
    if (!format || !isValidExportStatus(status)) {
      continue;
    }

    records.push({
      id: typeof record["id"] === "string" ? record["id"] : `${format}-${Date.now()}`,
      clipId: typeof record["clipId"] === "string" ? record["clipId"] : "",
      sermonId: typeof record["sermonId"] === "string" ? record["sermonId"] : "",
      format,
      platformPreset: toPlatformPreset(record["platformPreset"]),
      framingMode: toFramingMode(record["framingMode"]),
      status,
      outputPath: typeof record["outputPath"] === "string" ? record["outputPath"] : null,
      outputFilename: typeof record["outputFilename"] === "string" ? record["outputFilename"] : null,
      fileSizeBytes: safeNumber(record["fileSizeBytes"]),
      errorMessage: typeof record["errorMessage"] === "string" ? record["errorMessage"] : null,
      renderVersion: typeof record["renderVersion"] === "string" ? record["renderVersion"] : "v1",
      captionText: typeof record["captionText"] === "string" ? record["captionText"] : null,
      captionBurnStatus:
        record["captionBurnStatus"] === "NOT_BURNED" ||
        record["captionBurnStatus"] === "BURNING" ||
        record["captionBurnStatus"] === "COMPLETED" ||
        record["captionBurnStatus"] === "FAILED"
          ? record["captionBurnStatus"]
          : null,
      createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : new Date().toISOString(),
      startedAt: typeof record["startedAt"] === "string" ? record["startedAt"] : null,
      completedAt: typeof record["completedAt"] === "string" ? record["completedAt"] : null,
      isLatest: record["isLatest"] === true,
      brandingSnapshot:
        record["brandingSnapshot"] && typeof record["brandingSnapshot"] === "object"
          ? (record["brandingSnapshot"] as Prisma.JsonObject)
          : null,
    });
  }

  return markLatestExports(records).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function exportRecordFilename(outputPath: string | null): string | null {
  if (!outputPath?.trim()) {
    return null;
  }

  return outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

function exportRecordTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Studio export history predates durable ClipArtifact records. Merge both so
 * a completed worker export remains visible even when legacy caption JSON has
 * no exportHistory entry (for example after an EC2/local-worker hand-off).
 */
export function resolveLatestClipStudioExportRecords(input: {
  clipId: string;
  sermonId: string;
  selectedFormats: ClipExportFormat[];
  platformPreset: PlatformPreset;
  framingMode: ClipExportLayoutStrategy;
  history: ClipStudioExportRecord[];
  artifacts: ClipStudioExportArtifactSummary[];
  canonicalExport: CanonicalClipStudioExportSummary;
}): ClipStudioExportRecord[] {
  const selectedFormats = Array.from(new Set(input.selectedFormats));
  const candidates = new Map<ClipExportFormat, ClipStudioExportRecord>();
  const consider = (record: ClipStudioExportRecord) => {
    if (!selectedFormats.includes(record.format)) {
      return;
    }
    const current = candidates.get(record.format);
    if (!current || Date.parse(record.createdAt) > Date.parse(current.createdAt)) {
      candidates.set(record.format, record);
    }
  };

  input.history.filter((record) => record.isLatest).forEach(consider);

  for (const artifact of input.artifacts) {
    if (
      !artifact.format ||
      artifact.status === "DELETED" ||
      (artifact.status === "READY" && artifact.freshness !== "UP_TO_DATE")
    ) {
      continue;
    }
    const createdAt = exportRecordTimestamp(artifact.generatedAt ?? artifact.createdAt);
    consider({
      id: `artifact-${artifact.id}`,
      clipId: input.clipId,
      sermonId: input.sermonId,
      format: artifact.format,
      platformPreset: input.platformPreset,
      framingMode: input.framingMode,
      status: artifact.status === "READY" ? "COMPLETED" : "FAILED",
      outputPath: artifact.status === "READY" ? artifact.filePath : null,
      outputFilename: exportRecordFilename(artifact.filePath),
      fileSizeBytes: artifact.sizeBytes,
      errorMessage: artifact.errorMessage,
      renderVersion: "artifact",
      captionText: null,
      captionBurnStatus: null,
      createdAt,
      startedAt: null,
      completedAt: createdAt,
      isLatest: true,
      brandingSnapshot: null,
    });
  }

  const canonical = input.canonicalExport;
  if (canonical.format) {
    const status = canonical.status === "COMPLETED"
      ? "COMPLETED"
      : canonical.status === "FAILED"
        ? "FAILED"
        : canonical.status === "QUEUED"
          ? "WAITING"
          : canonical.status === "EXPORTING"
            ? "RENDERING"
            : null;
    if (status) {
      const createdAt = exportRecordTimestamp(canonical.exportedAt);
      consider({
        id: `canonical-${input.clipId}-${canonical.format}`,
        clipId: input.clipId,
        sermonId: input.sermonId,
        format: canonical.format,
        platformPreset: input.platformPreset,
        framingMode: input.framingMode,
        status,
        outputPath: canonical.outputPath,
        outputFilename: exportRecordFilename(canonical.outputPath),
        fileSizeBytes: null,
        errorMessage: canonical.errorMessage,
        renderVersion: "canonical",
        captionText: null,
        captionBurnStatus: null,
        createdAt,
        startedAt: null,
        completedAt: status === "COMPLETED" || status === "FAILED" ? createdAt : null,
        isLatest: true,
        brandingSnapshot: null,
      });
    }
  }

  return selectedFormats.flatMap((format) => {
    const record = candidates.get(format);
    return record ? [{ ...record, isLatest: true }] : [];
  });
}

export function toPastorFriendlyExportError(errorMessage: string | null | undefined): string {
  const normalized = errorMessage?.toLocaleLowerCase() ?? "";

  if (normalized.includes("height not divisible") || normalized.includes("width not divisible")) {
    return "This format did not fit the selected frame size. Review Format & framing, then rebuild the video.";
  }
  if (
    normalized.includes("no such file") ||
    normalized.includes("enoent") ||
    (normalized.includes("source video") && normalized.includes("not"))
  ) {
    return "The source video is unavailable to the media worker. Reconnect the original video, then rebuild.";
  }
  if (normalized.includes("stale") || normalized.includes("changed while")) {
    return "The Studio draft changed while this format was preparing. Save the latest draft and rebuild.";
  }

  return "This format could not be prepared. Rebuild it; if it fails again, check the source video and framing.";
}

export function markLatestExports(records: ClipStudioExportRecord[]): ClipStudioExportRecord[] {
  const latestByFormat = new Map<ClipExportFormat, ClipStudioExportRecord>();

  for (const record of records) {
    const existing = latestByFormat.get(record.format);
    if (!existing || Date.parse(record.createdAt) > Date.parse(existing.createdAt)) {
      latestByFormat.set(record.format, record);
    }
  }

  return records.map((record) => ({
    ...record,
    isLatest: latestByFormat.get(record.format)?.id === record.id,
  }));
}

function captionDataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function markInProgressClipStudioExportsFailed(
  captionData: unknown,
  errorMessage: string,
  completedAt = new Date().toISOString(),
): Record<string, unknown> {
  const root = captionDataRecord(captionData);
  const history = resolveExportHistory(captionData);
  if (history.length === 0) {
    return root;
  }

  return {
    ...root,
    exportHistory: history.map((record) =>
      record.isLatest && (record.status === "WAITING" || record.status === "RENDERING")
        ? {
            ...record,
            status: "FAILED" as const,
            errorMessage,
            completedAt,
          }
        : record,
    ),
  };
}

export function markLatestClipStudioExportCompleted(
  captionData: unknown,
  input: {
    format: ClipExportFormat;
    outputPath: string;
    outputFilename: string | null;
    fileSizeBytes: number | null;
    captionBurnStatus: ClipStudioExportRecord["captionBurnStatus"];
    completedAt?: string;
  },
): Record<string, unknown> {
  const root = captionDataRecord(captionData);
  const history = resolveExportHistory(captionData);
  if (history.length === 0) {
    return root;
  }

  const completedAt = input.completedAt ?? new Date().toISOString();
  return {
    ...root,
    exportHistory: history.map((record) =>
      record.isLatest
      && record.format === input.format
      && (record.status === "WAITING" || record.status === "RENDERING")
        ? {
            ...record,
            status: "COMPLETED" as const,
            outputPath: input.outputPath,
            outputFilename: input.outputFilename,
            fileSizeBytes: input.fileSizeBytes,
            captionBurnStatus: input.captionBurnStatus,
            errorMessage: null,
            startedAt: record.startedAt ?? completedAt,
            completedAt,
          }
        : record,
    ),
  };
}

export function toPastorFriendlyExportStatus(status: ClipStudioExportStatus): string {
  switch (status) {
    case "WAITING":
      return "Waiting to prepare";
    case "RENDERING":
      return "Preparing";
    case "COMPLETED":
      return "Ready to download";
    case "FAILED":
      return "Needs attention";
  }
}

export function exportStatusTone(status: ClipStudioExportStatus): "neutral" | "success" | "warning" | "danger" | "accent" {
  switch (status) {
    case "WAITING":
      return "neutral";
    case "RENDERING":
      return "accent";
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "danger";
  }
}

export function resolveExportSettings(input: {
  exportFormat: ClipExportFormat | null;
  exportLayoutStrategy: ClipExportLayoutStrategy | null;
  captionData: unknown;
  manualCropKeyframes?: unknown;
}): ExportSettings {
  const fallback: ExportSettings = {
    platformPreset: DEFAULT_PLATFORM_PRESET,
    primaryFormat: input.exportFormat ?? DEFAULT_PRIMARY_FORMAT,
    selectedFormats: [input.exportFormat ?? DEFAULT_PRIMARY_FORMAT],
    framingMode: input.exportLayoutStrategy ?? DEFAULT_FRAMING_MODE,
    framingPersonality: "AUTO_INTELLIGENT",
    backgroundMode: deriveBackgroundMode(input.exportLayoutStrategy ?? DEFAULT_FRAMING_MODE),
    manualCropKeyframes: normalizeManualCropKeyframes(input.manualCropKeyframes),
  };

  if (!input.captionData || typeof input.captionData !== "object") {
    return {
      ...fallback,
      primaryFormat: isValidExportFormat(fallback.primaryFormat) ? fallback.primaryFormat : DEFAULT_PRIMARY_FORMAT,
      framingMode: isValidFramingMode(fallback.framingMode) ? fallback.framingMode : DEFAULT_FRAMING_MODE,
      manualCropKeyframes: normalizeManualCropKeyframes(input.manualCropKeyframes),
    };
  }

  const root = input.captionData as Record<string, unknown>;
  const exportSettings =
    root["exportSettings"] && typeof root["exportSettings"] === "object"
      ? (root["exportSettings"] as Record<string, unknown>)
      : null;

  const platformPreset =
    exportSettings && isValidPlatformPreset(exportSettings["platformPreset"])
      ? exportSettings["platformPreset"]
      : fallback.platformPreset;

  const primaryFormat =
    exportSettings && isValidExportFormat(exportSettings["primaryFormat"])
      ? exportSettings["primaryFormat"]
      : isValidExportFormat(fallback.primaryFormat)
        ? fallback.primaryFormat
        : mapPlatformPresetToFormat(platformPreset);

  const framingMode =
    exportSettings && isValidFramingMode(exportSettings["framingMode"])
      ? exportSettings["framingMode"]
      : isValidFramingMode(fallback.framingMode)
        ? fallback.framingMode
        : DEFAULT_FRAMING_MODE;

  const selectedFormatsRaw = exportSettings ? safeStringArray(exportSettings["selectedFormats"]) : [];
  const selectedFormats = selectedFormatsRaw
    .filter((item): item is ClipExportFormat => isValidExportFormat(item));
  const framingPersonality =
    exportSettings && isValidFramingPersonality(exportSettings["framingPersonality"])
      ? exportSettings["framingPersonality"]
      : fallback.framingPersonality;

  const normalizedSelectedFormats =
    selectedFormats.length > 0
      ? Array.from(new Set([primaryFormat, ...selectedFormats]))
      : [primaryFormat];

  return {
    platformPreset,
    primaryFormat,
    selectedFormats: normalizedSelectedFormats,
    framingMode,
    framingPersonality,
    backgroundMode: deriveBackgroundMode(framingMode),
    manualCropKeyframes: normalizeManualCropKeyframes(input.manualCropKeyframes),
  };
}

export function summarizeExportSettings(settings: ExportSettings): string {
  const mappedFormat = mapPlatformPresetToFormat(settings.platformPreset);
  if (mappedFormat !== settings.primaryFormat) {
    return `Download style: ${FORMAT_LABELS[settings.primaryFormat]}. Chosen platform: ${PLATFORM_PRESET_LABELS[settings.platformPreset]}. Framing: ${resolveFramingDisplayLabel(settings).toLowerCase()}.`;
  }

  return `Ready-to-post style: ${FORMAT_LABELS[settings.primaryFormat]} for ${PLATFORM_PRESET_LABELS[settings.platformPreset]} using ${resolveFramingDisplayLabel(settings).toLowerCase()}.`;
}

export function buildFramingWarnings(settings: ExportSettings): string[] {
  const warnings: string[] = [];

  if (
    settings.primaryFormat === "VERTICAL_9_16" &&
    settings.framingMode !== "FIT_BLURRED_BACKGROUND" &&
    settings.framingMode !== "SMART_CROP"
  ) {
    warnings.push("Vertical crop may cut out the pastor if he moves away from the center.");
  }

  if (settings.primaryFormat === "VERTICAL_9_16" && settings.framingMode === "CENTER_CROP") {
    warnings.push("Use blurred background if the pastor moves across the stage.");
  }

  if (settings.primaryFormat === "VERTICAL_9_16" && settings.framingMode === "SMART_CROP") {
    warnings.push("Refresh video tracking before preparing the final video so Auto Intelligent framing has the latest speaker estimate.");
  }

  return warnings;
}
