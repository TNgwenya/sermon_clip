import { access } from "node:fs/promises";

import type { ClipExportFormat } from "@prisma/client";

import {
  resolveBrandBackgroundOpacity,
  type BrandingLowerThirdPlacement,
  type ClipBrandingConfig,
  type WatermarkPosition,
} from "@/lib/clipBranding";
import { getSharp } from "@/server/agents/sharpClient";

export type BrandingOverlayContext = {
  format: ClipExportFormat;
  sermonTitle: string;
  preacherName: string;
  churchName: string;
  themeColor: string | null;
  watermarkPosition: WatermarkPosition;
  width: number;
  height: number;
  logoPath?: string | null;
  lowerThirdPlacement?: BrandingLowerThirdPlacement;
};

export type BrandingOverlayLayer = "all" | "base" | "intro" | "outro";

type TextLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  opacity?: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
};

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r?\n/g, " ")
    .trim();
}

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? fallback).trim();
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function buildTextNode(line: TextLine): string {
  const weight = line.weight ?? 400;
  const opacity = line.opacity ?? 1;
  return `<text x="${line.x}" y="${line.y}" font-family="Arial, Helvetica, sans-serif" font-size="${line.fontSize}" font-weight="${weight}" fill="${line.fill}" fill-opacity="${opacity}" text-anchor="${line.anchor ?? "start"}" dominant-baseline="hanging" paint-order="stroke fill" stroke="#000000" stroke-width="3" stroke-linejoin="round">${escapeSvgText(line.text)}</text>`;
}

function buildBrandBackgroundNode(config: ClipBrandingConfig, width: number, height: number, themeColor: string): string | null {
  if (config.backgroundStyle === "NONE") {
    return null;
  }

  const opacity = resolveBrandBackgroundOpacity(config.backgroundStyle);

  return `<rect x="0" y="0" width="${width}" height="${height}" fill="${themeColor}" fill-opacity="${opacity}" />`;
}

function buildBrandBadge(input: {
  label: string;
  y: number;
  width: number;
  themeColor: string;
}): string {
  const badgeWidth = Math.min(520, Math.max(260, input.width * 0.54));
  const badgeX = Math.round((input.width - badgeWidth) / 2);

  return [
    `<rect x="${badgeX}" y="${input.y}" width="${badgeWidth}" height="72" rx="24" fill="#020617" fill-opacity="0.72" stroke="${input.themeColor}" stroke-opacity="0.58" stroke-width="2" />`,
    buildTextNode({
      text: input.label,
      x: input.width / 2,
      y: input.y + 20,
      fontSize: 24,
      fill: "#FFFFFF",
      weight: 800,
      anchor: "middle",
    }),
  ].join("\n      ");
}

export function getBrandingOverlayDimensions(format: ClipExportFormat): { width: number; height: number } {
  if (format === "HORIZONTAL_16_9") {
    return { width: 1920, height: 1080 };
  }

  if (format === "SQUARE_1_1") {
    return { width: 1080, height: 1080 };
  }

  return { width: 1080, height: 1920 };
}

function buildLayout(width: number, height: number, placement: BrandingLowerThirdPlacement): {
  backgroundX: number;
  backgroundWidth: number;
  backgroundY: number;
  backgroundHeight: number;
  lineYs: number[];
  fontSizes: number[];
} {
  const horizontalInset = height >= 1600 ? 36 : 28;

  if (placement === "TOP") {
    if (height >= 1600) {
      return {
        backgroundX: horizontalInset,
        backgroundWidth: width - horizontalInset * 2,
        backgroundY: 92,
        backgroundHeight: 196,
        lineYs: [116, 164, 208],
        fontSizes: [32, 23, 19],
      };
    }

    return {
      backgroundX: horizontalInset,
      backgroundWidth: width - horizontalInset * 2,
      backgroundY: 48,
      backgroundHeight: 138,
      lineYs: [66, 102, 136],
      fontSizes: [30, 22, 17],
    };
  }

  if (height >= 1600) {
    return {
      backgroundX: horizontalInset,
      backgroundWidth: width - horizontalInset * 2,
      backgroundY: height - 300,
      backgroundHeight: 210,
      lineYs: [height - 282, height - 238, height - 200],
      fontSizes: [32, 22, 18],
    };
  }

  return {
    backgroundX: horizontalInset,
    backgroundWidth: width - horizontalInset * 2,
    backgroundY: height - 170,
    backgroundHeight: 120,
    lineYs: [height - 153, height - 120, height - 92],
    fontSizes: [30, 22, 17],
  };
}

function fitBrandText(value: string, maxCharacters: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
}

function resolveLogoPlacement(input: {
  position: WatermarkPosition;
  width: number;
  height: number;
  logoWidth: number;
  logoHeight: number;
  lowerThirdPlacement: BrandingLowerThirdPlacement;
}): { left: number; top: number } {
  const margin = input.height >= 1600 ? 52 : 36;
  const safePosition = input.lowerThirdPlacement === "TOP"
    ? input.position === "BOTTOM_LEFT"
      ? "TOP_LEFT"
      : input.position === "BOTTOM_RIGHT"
        ? "TOP_RIGHT"
        : input.position
    : input.lowerThirdPlacement === "BOTTOM"
      ? input.position === "TOP_LEFT"
        ? "BOTTOM_LEFT"
        : input.position === "TOP_RIGHT"
          ? "BOTTOM_RIGHT"
          : input.position
      : input.position;

  if (safePosition === "TOP_LEFT") {
    return { left: margin, top: margin };
  }

  if (safePosition === "BOTTOM_LEFT") {
    return { left: margin, top: input.height - input.logoHeight - margin };
  }

  if (safePosition === "BOTTOM_RIGHT") {
    return {
      left: input.width - input.logoWidth - margin,
      top: input.height - input.logoHeight - margin,
    };
  }

  if (safePosition === "CENTER") {
    return { left: Math.round((input.width - input.logoWidth) / 2), top: margin };
  }

  return { left: input.width - input.logoWidth - margin, top: margin };
}

function buildWatermarkPosition(
  position: WatermarkPosition,
  width: number,
  height: number,
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  switch (position) {
    case "TOP_LEFT":
      return { x: 24, y: 24, anchor: "start" };
    case "TOP_RIGHT":
      return { x: width - 24, y: 24, anchor: "end" };
    case "BOTTOM_LEFT":
      return { x: 24, y: height - 80, anchor: "start" };
    case "CENTER":
      return { x: width / 2, y: 24, anchor: "middle" };
    case "BOTTOM_RIGHT":
    default:
      return { x: width - 24, y: height - 80, anchor: "end" };
  }
}

export function buildBrandingOverlaySvg(
  config: ClipBrandingConfig,
  context: BrandingOverlayContext,
  layer: BrandingOverlayLayer = "all",
): string {
  const { width, height } = context;
  const lowerThirdPlacement = context.lowerThirdPlacement ?? "BOTTOM";
  const layout = buildLayout(width, height, lowerThirdPlacement);
  const themeColor = normalizeHexColor(context.themeColor, "#FFFFFF");
  const lines: string[] = [];
  const backgroundNode = buildBrandBackgroundNode(config, width, height, themeColor);

  const showBase = layer === "all" || layer === "base";
  const showIntro = layer === "all" || layer === "intro";
  const showOutro = layer === "all" || layer === "outro";

  if (showBase && backgroundNode) {
    lines.push(backgroundNode);
  }

  const hasPreacher = config.showPreacherName && context.preacherName.trim().length > 0;
  const hasTitle = config.showSermonTitle && context.sermonTitle.trim().length > 0;
  const hasChurch = config.showChurchName && context.churchName.trim().length > 0;
  const showLowerThird = config.lowerThirdEnabled && config.preset !== "MINIMAL_WATERMARK";

  if (showBase && showLowerThird && (hasPreacher || hasTitle || hasChurch)) {
    lines.push(`<rect x="${layout.backgroundX}" y="${layout.backgroundY}" width="${layout.backgroundWidth}" height="${layout.backgroundHeight}" rx="28" fill="#020617" fill-opacity="0.82" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="2" />`);
    lines.push(`<rect x="${layout.backgroundX}" y="${layout.backgroundY}" width="8" height="${layout.backgroundHeight}" rx="4" fill="${themeColor}" fill-opacity="0.96" />`);
    const textX = layout.backgroundX + 34;
    const logoReservedCharacters = context.logoPath ? 10 : 0;

    if (hasPreacher) {
      lines.push(buildTextNode({ text: fitBrandText(context.preacherName, 42 - logoReservedCharacters), x: textX, y: layout.lineYs[0] ?? layout.backgroundY + 18, fontSize: layout.fontSizes[0] ?? 28, fill: themeColor, weight: 800 }));
    }

    if (hasTitle) {
      lines.push(buildTextNode({ text: fitBrandText(context.sermonTitle, 54 - logoReservedCharacters), x: textX, y: layout.lineYs[1] ?? layout.backgroundY + 62, fontSize: layout.fontSizes[1] ?? 22, fill: "#FFFFFF", opacity: 0.94, weight: 700 }));
    }

    if (hasChurch) {
      lines.push(buildTextNode({ text: fitBrandText(context.churchName, 58 - logoReservedCharacters), x: textX, y: layout.lineYs[2] ?? layout.backgroundY + 100, fontSize: layout.fontSizes[2] ?? 17, fill: "#FFFFFF", opacity: 0.72, weight: 650 }));
    }
  }

  if (showBase && (config.watermarkEnabled || config.preset === "MINIMAL_WATERMARK")) {
    const watermarkText = context.logoPath ? "" : context.churchName.trim();
    if (watermarkText) {
      const position = buildWatermarkPosition(context.watermarkPosition, width, height);
      lines.push(
        buildTextNode({
          text: watermarkText,
          x: position.x,
          y: position.y,
          fontSize: 18,
          fill: "#FFFFFF",
          opacity: 0.45,
          weight: 700,
          anchor: position.anchor,
        }),
      );
    }
  }

  if (showIntro && config.introEnabled) {
    lines.push(buildBrandBadge({
      label: (context.churchName.trim() || context.sermonTitle.trim() || "Sermon Clip").slice(0, 52),
      y: height >= 1600 ? 150 : 90,
      width,
      themeColor,
    }));
  }

  if (showOutro && config.outroEnabled) {
    lines.push(buildBrandBadge({
      label: context.churchName.trim()
        ? `${context.churchName.trim().slice(0, 34)} · Reflect · Share`
        : "Reflect · Share · Invite",
      y: height >= 1600 ? height - 430 : height - 250,
      width,
      themeColor,
    }));
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="transparent" />
      ${lines.join("\n      ")}
    </svg>
  `;
}

export async function renderBrandingOverlayPng(
  outputPath: string,
  config: ClipBrandingConfig,
  context: BrandingOverlayContext,
  layer: BrandingOverlayLayer = "all",
): Promise<boolean> {
  if (!config.enabled || config.preset === "NO_BRANDING") {
    return false;
  }

  const logoRequested = config.watermarkEnabled || config.preset === "MINIMAL_WATERMARK";
  const hasLogo = Boolean(
    logoRequested
    && context.logoPath?.trim()
    && (layer === "all" || layer === "base")
    && await fileExists(context.logoPath.trim()),
  );
  const renderContext = {
    ...context,
    logoPath: hasLogo ? context.logoPath?.trim() ?? null : null,
  };
  const svg = buildBrandingOverlaySvg(config, renderContext, layer);
  const sharp = await getSharp();
  const overlay = sharp(Buffer.from(svg));

  if (hasLogo && renderContext.logoPath) {
    const logoMaxWidth = Math.round(context.width * (context.height >= 1600 ? 0.18 : 0.14));
    const logoMaxHeight = context.height >= 1600 ? 124 : 88;
    const logoBuffer = await sharp(/* turbopackIgnore: true */ renderContext.logoPath)
      .resize({
        width: logoMaxWidth,
        height: logoMaxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const logoMetadata = await sharp(logoBuffer).metadata();
    const logoWidth = logoMetadata.width ?? logoMaxWidth;
    const logoHeight = logoMetadata.height ?? logoMaxHeight;
    const placement = resolveLogoPlacement({
      position: context.watermarkPosition,
      width: context.width,
      height: context.height,
      logoWidth,
      logoHeight,
      lowerThirdPlacement: context.lowerThirdPlacement ?? "BOTTOM",
    });

    await overlay
      .composite([{ input: logoBuffer, left: placement.left, top: placement.top }])
      .png()
      .toFile(/* turbopackIgnore: true */ outputPath);
    return true;
  }

  await overlay.png().toFile(/* turbopackIgnore: true */ outputPath);
  return true;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

export const __brandingOverlayTestUtils = {
  buildBrandingOverlaySvg,
  overlayDimensions: getBrandingOverlayDimensions,
  resolveLogoPlacement,
};
