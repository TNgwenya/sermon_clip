import type { ClipExportFormat, ClipExportLayoutStrategy, Prisma } from "@prisma/client";

export type PlatformPreset =
  | "INSTAGRAM_REELS"
  | "TIKTOK"
  | "YOUTUBE_SHORTS"
  | "FACEBOOK_REELS"
  | "YOUTUBE_HORIZONTAL"
  | "WEBSITE_HORIZONTAL";

export const PLATFORM_PRESET_LABELS: Record<PlatformPreset, string> = {
  INSTAGRAM_REELS: "Instagram Reels",
  TIKTOK: "TikTok",
  YOUTUBE_SHORTS: "YouTube Shorts",
  FACEBOOK_REELS: "Facebook Reels",
  YOUTUBE_HORIZONTAL: "YouTube horizontal",
  WEBSITE_HORIZONTAL: "Website horizontal",
};

export const FORMAT_LABELS: Record<ClipExportFormat, string> = {
  VERTICAL_9_16: "Vertical video for Reels, TikTok, and Shorts",
  HORIZONTAL_16_9: "Horizontal video for YouTube or website",
  SQUARE_1_1: "Square video for Facebook or Instagram",
};

export const FRAMING_LABELS: Record<ClipExportLayoutStrategy, string> = {
  CENTER_CROP: "Center crop",
  LEFT_FOCUS: "Left crop",
  RIGHT_FOCUS: "Right crop",
  FIT_BLURRED_BACKGROUND: "Fit with blurred background",
  SMART_CROP: "Auto pastor tracking",
};

export const FRAMING_DESCRIPTIONS: Record<ClipExportLayoutStrategy, string> = {
  CENTER_CROP: "Best when the pastor stays near the middle.",
  LEFT_FOCUS: "Use when the pastor is usually on the left side.",
  RIGHT_FOCUS: "Use when the pastor is usually on the right side.",
  FIT_BLURRED_BACKGROUND:
    "Keeps the full video visible with a blurred background, useful when the pastor moves around.",
  SMART_CROP: "Uses saved face/body tracking to keep the pastor near the center.",
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

export function isValidPlatformPreset(value: unknown): value is PlatformPreset {
  return typeof value === "string" && Object.keys(PLATFORM_TO_FORMAT).includes(value);
}

export function isValidExportFormat(value: unknown): value is ClipExportFormat {
  return typeof value === "string" && SELECTABLE_FORMATS.includes(value as ClipExportFormat);
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
}): ExportSettings {
  const fallback: ExportSettings = {
    platformPreset: DEFAULT_PLATFORM_PRESET,
    primaryFormat: input.exportFormat ?? DEFAULT_PRIMARY_FORMAT,
    selectedFormats: [input.exportFormat ?? DEFAULT_PRIMARY_FORMAT],
    framingMode: input.exportLayoutStrategy ?? DEFAULT_FRAMING_MODE,
    framingPersonality: "AUTO_INTELLIGENT",
    backgroundMode: deriveBackgroundMode(input.exportLayoutStrategy ?? DEFAULT_FRAMING_MODE),
  };

  if (!input.captionData || typeof input.captionData !== "object") {
    return {
      ...fallback,
      primaryFormat: isValidExportFormat(fallback.primaryFormat) ? fallback.primaryFormat : DEFAULT_PRIMARY_FORMAT,
      framingMode: isValidFramingMode(fallback.framingMode) ? fallback.framingMode : DEFAULT_FRAMING_MODE,
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
  };
}

export function summarizeExportSettings(settings: ExportSettings): string {
  const mappedFormat = mapPlatformPresetToFormat(settings.platformPreset);
  if (mappedFormat !== settings.primaryFormat) {
    return `Download style: ${FORMAT_LABELS[settings.primaryFormat]}. Chosen platform: ${PLATFORM_PRESET_LABELS[settings.platformPreset]}. Framing: ${FRAMING_LABELS[settings.framingMode].toLowerCase()}.`;
  }

  return `Ready-to-post style: ${FORMAT_LABELS[settings.primaryFormat]} for ${PLATFORM_PRESET_LABELS[settings.platformPreset]} using ${FRAMING_LABELS[settings.framingMode].toLowerCase()}.`;
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
    warnings.push("Refresh video tracking before preparing the download so Auto pastor tracking has the latest face/body estimate.");
  }

  return warnings;
}
