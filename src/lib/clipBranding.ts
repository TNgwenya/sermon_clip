/**
 * Clip-level church branding helpers.
 *
 * Branding is optional. Rendering must work when:
 *   - branding is disabled
 *   - preset is NO_BRANDING
 *   - church name / sermon title / preacher name is blank
 *   - theme color is missing or invalid
 *   - logo file is missing
 *
 * Branding config is stored in ClipCandidate.captionData under "brandingSettings".
 * Falls back to safe defaults when absent.
 */

import type { ClipExportFormat } from "@prisma/client";

// ─── Presets ──────────────────────────────────────────────────────────────────

export type BrandingPreset = "CLEAN_LOWER_THIRD" | "MINIMAL_WATERMARK" | "SERMON_IDENTITY" | "NO_BRANDING";
export type BrandBackgroundStyle = "NONE" | "SOFT_GRADIENT" | "SOLID_BRAND" | "BLURRED_TINT";

export const BRANDING_PRESET_LABELS: Record<BrandingPreset, string> = {
  CLEAN_LOWER_THIRD: "Clean lower third",
  MINIMAL_WATERMARK: "Minimal watermark",
  SERMON_IDENTITY: "Sermon identity",
  NO_BRANDING: "Clean",
};

export const BRANDING_PRESET_DESCRIPTIONS: Record<BrandingPreset, string> = {
  CLEAN_LOWER_THIRD: "Shows church name, sermon title, and preacher name near the bottom.",
  MINIMAL_WATERMARK: "Shows a small church name watermark in the corner.",
  SERMON_IDENTITY: "Shows sermon title and preacher name prominently.",
  NO_BRANDING: "Keeps the clip free of overlays.",
};

export const SELECTABLE_BRANDING_PRESETS: BrandingPreset[] = [
  "CLEAN_LOWER_THIRD",
  "MINIMAL_WATERMARK",
  "SERMON_IDENTITY",
  "NO_BRANDING",
];

// ─── Config types ─────────────────────────────────────────────────────────────

export type WatermarkPosition = "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_LEFT" | "BOTTOM_RIGHT" | "CENTER";

export type ClipBrandingConfig = {
  enabled: boolean;
  preset: BrandingPreset;
  showChurchName: boolean;
  showSermonTitle: boolean;
  showPreacherName: boolean;
  watermarkEnabled: boolean;
  lowerThirdEnabled: boolean;
  introEnabled: boolean;
  outroEnabled: boolean;
  introDurationSeconds?: number;
  outroDurationSeconds?: number;
  backgroundStyle: BrandBackgroundStyle;
  themeColor: string | null;
};

export const DEFAULT_INTRO_DURATION_SECONDS = 2.5;
export const DEFAULT_OUTRO_DURATION_SECONDS = 3;

export type ClipBrandingSnapshot = ClipBrandingConfig & {
  churchNameUsed: string | null;
  sermonTitleUsed: string | null;
  preacherNameUsed: string | null;
  logoAvailable: boolean;
};

export const DEFAULT_CLIP_BRANDING: ClipBrandingConfig = {
  enabled: false,
  preset: "CLEAN_LOWER_THIRD",
  showChurchName: true,
  showSermonTitle: true,
  showPreacherName: true,
  watermarkEnabled: false,
  lowerThirdEnabled: true,
  introEnabled: false,
  outroEnabled: false,
  introDurationSeconds: DEFAULT_INTRO_DURATION_SECONDS,
  outroDurationSeconds: DEFAULT_OUTRO_DURATION_SECONDS,
  backgroundStyle: "NONE",
  themeColor: null,
};

// ─── Validators ───────────────────────────────────────────────────────────────

export function isValidBrandingPreset(value: unknown): value is BrandingPreset {
  return (
    typeof value === "string" &&
    ["CLEAN_LOWER_THIRD", "MINIMAL_WATERMARK", "SERMON_IDENTITY", "NO_BRANDING"].includes(value)
  );
}

const HEX_COLOR_PATTERN = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * Returns a valid hex color string or null if the value is invalid.
 * Allows rendering to fall back safely when theme color is missing.
 */
export function validateThemeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : null;
}

// ─── Config parsing ───────────────────────────────────────────────────────────

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeBrandingDurationSeconds(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Number(Math.min(8, Math.max(1, value)).toFixed(1));
}

function isValidBrandBackgroundStyle(value: unknown): value is BrandBackgroundStyle {
  return typeof value === "string" && ["NONE", "SOFT_GRADIENT", "SOLID_BRAND", "BLURRED_TINT"].includes(value);
}

/**
 * Parses clip-level branding config from the captionData JSON blob.
 * Returns defaults when config is absent or invalid.
 * Safe to call with any unknown value.
 */
export function resolveBrandingConfig(captionData: unknown): ClipBrandingConfig {
  if (!captionData || typeof captionData !== "object") {
    return { ...DEFAULT_CLIP_BRANDING };
  }

  const root = captionData as Record<string, unknown>;
  const raw = root["brandingSettings"];

  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CLIP_BRANDING };
  }

  const data = raw as Record<string, unknown>;

  return {
    enabled: safeBoolean(data["enabled"], DEFAULT_CLIP_BRANDING.enabled),
    preset: isValidBrandingPreset(data["preset"]) ? data["preset"] : DEFAULT_CLIP_BRANDING.preset,
    showChurchName: safeBoolean(data["showChurchName"], DEFAULT_CLIP_BRANDING.showChurchName),
    showSermonTitle: safeBoolean(data["showSermonTitle"], DEFAULT_CLIP_BRANDING.showSermonTitle),
    showPreacherName: safeBoolean(data["showPreacherName"], DEFAULT_CLIP_BRANDING.showPreacherName),
    watermarkEnabled: safeBoolean(data["watermarkEnabled"], DEFAULT_CLIP_BRANDING.watermarkEnabled),
    lowerThirdEnabled: safeBoolean(data["lowerThirdEnabled"], DEFAULT_CLIP_BRANDING.lowerThirdEnabled),
    introEnabled: safeBoolean(data["introEnabled"], DEFAULT_CLIP_BRANDING.introEnabled),
    outroEnabled: safeBoolean(data["outroEnabled"], DEFAULT_CLIP_BRANDING.outroEnabled),
    introDurationSeconds: normalizeBrandingDurationSeconds(
      data["introDurationSeconds"],
      DEFAULT_INTRO_DURATION_SECONDS,
    ),
    outroDurationSeconds: normalizeBrandingDurationSeconds(
      data["outroDurationSeconds"],
      DEFAULT_OUTRO_DURATION_SECONDS,
    ),
    backgroundStyle: isValidBrandBackgroundStyle(data["backgroundStyle"]) ? data["backgroundStyle"] : DEFAULT_CLIP_BRANDING.backgroundStyle,
    themeColor: safeNullableString(data["themeColor"]),
  };
}

// ─── Preview summary ──────────────────────────────────────────────────────────

type BrandingContext = {
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  logoPath: string | null;
};

/**
 * Builds a human-readable branding summary for the preview card.
 */
export function buildBrandingSummary(config: ClipBrandingConfig, context: BrandingContext): string {
  if (!config.enabled || config.preset === "NO_BRANDING") {
    return "Brand layers are off for this clip.";
  }

  const presetLabel = BRANDING_PRESET_LABELS[config.preset];
  const elements: string[] = [];

  const showLowerThird =
    config.lowerThirdEnabled &&
    config.preset !== "MINIMAL_WATERMARK";

  if (showLowerThird) {
    const fields: string[] = [];
    if (config.showPreacherName && context.preacherName.trim()) fields.push("preacher name");
    if (config.showSermonTitle && context.sermonTitle.trim()) fields.push("sermon title");
    if (config.showChurchName && context.churchName.trim()) fields.push("church name");
    if (fields.length > 0) {
      elements.push(`lower third with ${fields.join(", ")}`);
    }
  }

  if (config.watermarkEnabled || config.preset === "MINIMAL_WATERMARK") {
    elements.push("church name watermark");
  }

  if (config.introEnabled) {
    elements.push(`intro brand card for ${normalizeBrandingDurationSeconds(config.introDurationSeconds, DEFAULT_INTRO_DURATION_SECONDS)}s`);
  }

  if (config.outroEnabled) {
    elements.push(`outro brand card for ${normalizeBrandingDurationSeconds(config.outroDurationSeconds, DEFAULT_OUTRO_DURATION_SECONDS)}s`);
  }

  if (config.backgroundStyle !== "NONE") {
    elements.push("background style");
  }

  if (elements.length === 0) {
    return `Branding preset: ${presetLabel}. No visible elements with current settings.`;
  }

  return `Branding preview: ${presetLabel} — ${elements.join(" and ")}.`;
}

// ─── FFmpeg filter building ───────────────────────────────────────────────────

/**
 * Escapes text for safe use in FFmpeg drawtext filter.
 * Uses the same escaping conventions as clipOverlayService.
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .trim();
}

function hexToFfmpegColor(hex: string | null | undefined, fallback: string): string {
  const raw = (hex ?? fallback).trim();
  return raw.startsWith("#") ? raw.replace("#", "0x") : `0x${raw}`;
}

type LowerThirdLayout = {
  bgY: string;
  bgH: number;
  lineYs: string[];
  fontSizes: number[];
};

function lowerThirdLayoutForFormat(format: ClipExportFormat): LowerThirdLayout {
  if (format === "VERTICAL_9_16") {
    // 1080×1920 — captions sit at ~h-80; safe zone above h-290
    return {
      bgY: "ih-300",
      bgH: 210,
      lineYs: ["h-282", "h-238", "h-200"],
      fontSizes: [32, 22, 18],
    };
  }

  // HORIZONTAL_16_9 (1920×1080) and SQUARE_1_1 (1080×1080)
  // Captions sit at ~h-55; safe zone above h-165
  return {
    bgY: "ih-170",
    bgH: 120,
    lineYs: ["h-153", "h-120", "h-92"],
    fontSizes: [30, 22, 17],
  };
}

export type BrandingFilterContext = {
  format: ClipExportFormat;
  sermonTitle: string;
  preacherName: string;
  churchName: string;
  themeColor: string | null;
};

/**
 * Builds FFmpeg drawbox/drawtext filter segments for the lower-third overlay.
 * Returns an empty array when no elements apply or branding settings disable it.
 */
export function buildLowerThirdFilters(
  config: ClipBrandingConfig,
  ctx: BrandingFilterContext,
): string[] {
  if (!config.lowerThirdEnabled) return [];
  if (config.preset === "NO_BRANDING" || config.preset === "MINIMAL_WATERMARK") return [];

  const hasPreacher = config.showPreacherName && ctx.preacherName.trim().length > 0;
  const hasTitle = config.showSermonTitle && ctx.sermonTitle.trim().length > 0;
  const hasChurch = config.showChurchName && ctx.churchName.trim().length > 0;

  if (!hasPreacher && !hasTitle && !hasChurch) return [];

  const parts: string[] = [];
  const layout = lowerThirdLayoutForFormat(ctx.format);
  const bgColor = hexToFfmpegColor(ctx.themeColor, "#000000");

  parts.push(`drawbox=x=0:y=${layout.bgY}:w=iw:h=${layout.bgH}:color=${bgColor}@0.65:t=fill`);

  let lineIndex = 0;

  const addLine = (text: string, opacity: string, fontsize: number) => {
    if (lineIndex >= layout.lineYs.length) return;
    const escaped = escapeDrawtext(text);
    const y = layout.lineYs[lineIndex] ?? "h-100";
    parts.push(
      `drawtext=text='${escaped}':fontcolor=white${opacity}:fontsize=${fontsize}:x=48:y=${y}:fontname=Arial:shadowcolor=black@0.8:shadowx=1:shadowy=1`,
    );
    lineIndex++;
  };

  // Line order: preacher name → sermon title → church name
  if (hasPreacher) addLine(ctx.preacherName, "", layout.fontSizes[0] ?? 28);
  if (hasTitle) addLine(ctx.sermonTitle, "@0.85", layout.fontSizes[1] ?? 22);
  if (hasChurch) addLine(ctx.churchName, "@0.70", layout.fontSizes[2] ?? 17);

  return parts;
}

/**
 * Builds an FFmpeg drawtext filter segment for the watermark.
 * Returns an empty array when watermark is not applicable.
 */
export function buildWatermarkFilters(
  config: ClipBrandingConfig,
  ctx: BrandingFilterContext,
  watermarkPosition: WatermarkPosition,
): string[] {
  const shouldAdd = config.watermarkEnabled || config.preset === "MINIMAL_WATERMARK";
  if (!shouldAdd) return [];

  const text = ctx.churchName.trim();
  if (!text) return [];

  const escaped = escapeDrawtext(text);

  let x: string;
  let y: string;

  switch (watermarkPosition) {
    case "TOP_LEFT":
      x = "24";
      y = "24";
      break;
    case "TOP_RIGHT":
      x = "w-tw-24";
      y = "24";
      break;
    case "BOTTOM_LEFT":
      x = "24";
      y = "h-th-80";
      break;
    case "CENTER":
      x = "(w-tw)/2";
      y = "24";
      break;
    case "BOTTOM_RIGHT":
    default:
      x = "w-tw-24";
      y = "h-th-80";
      break;
  }

  return [
    `drawtext=text='${escaped}':fontcolor=white@0.45:fontsize=18:x=${x}:y=${y}:fontname=Arial:shadowcolor=black@0.5:shadowx=1:shadowy=1`,
  ];
}

/**
 * Builds all branding filter segments to append to the framing filter chain.
 * Returns an empty array when branding is disabled or yields no elements.
 */
export function buildBrandingFilters(
  config: ClipBrandingConfig,
  ctx: BrandingFilterContext,
  watermarkPosition: WatermarkPosition,
): string[] {
  if (!config.enabled || config.preset === "NO_BRANDING") return [];

  return [
    ...buildLowerThirdFilters(config, ctx),
    ...buildWatermarkFilters(config, ctx, watermarkPosition),
  ];
}

/**
 * Appends branding drawtext filters to an existing FFmpeg filter_complex string.
 *
 * All framing filters output [v]. This renames [v] → [vframed], then chains
 * branding filters outputting [v]. If brandingFilters is empty the original
 * filter is returned unchanged.
 */
export function appendBrandingToFilter(framingFilter: string, brandingFilters: string[]): string {
  if (brandingFilters.length === 0) return framingFilter;

  const withRenamed = framingFilter.replace(/\[v\]$/, "[vframed]");
  const brandingChain = brandingFilters.join(",");
  return `${withRenamed}; [vframed]${brandingChain}[v]`;
}

// ─── Test utilities ───────────────────────────────────────────────────────────

export const __clipBrandingTestUtils = {
  resolveBrandingConfig,
  validateThemeColor,
  buildBrandingSummary,
  buildLowerThirdFilters,
  buildWatermarkFilters,
  buildBrandingFilters,
  appendBrandingToFilter,
  escapeDrawtext,
  isValidBrandingPreset,
  normalizeBrandingDurationSeconds,
};
