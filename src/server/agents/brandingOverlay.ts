import { access } from "node:fs/promises";

import type { ClipExportFormat } from "@prisma/client";

import type { ClipBrandingConfig, WatermarkPosition } from "@/lib/clipBranding";
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
};

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

export function getBrandingOverlayDimensions(format: ClipExportFormat): { width: number; height: number } {
  if (format === "HORIZONTAL_16_9") {
    return { width: 1920, height: 1080 };
  }

  if (format === "SQUARE_1_1") {
    return { width: 1080, height: 1080 };
  }

  return { width: 1080, height: 1920 };
}

function buildLayout(width: number, height: number): {
  backgroundY: number;
  backgroundHeight: number;
  lineYs: number[];
  fontSizes: number[];
} {
  if (height >= 1600) {
    return {
      backgroundY: height - 300,
      backgroundHeight: 210,
      lineYs: [height - 282, height - 238, height - 200],
      fontSizes: [32, 22, 18],
    };
  }

  return {
    backgroundY: height - 170,
    backgroundHeight: 120,
    lineYs: [height - 153, height - 120, height - 92],
    fontSizes: [30, 22, 17],
  };
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

export function buildBrandingOverlaySvg(config: ClipBrandingConfig, context: BrandingOverlayContext): string {
  const { width, height } = context;
  const layout = buildLayout(width, height);
  const themeColor = normalizeHexColor(context.themeColor, "#FFFFFF");
  const lines: string[] = [];

  const hasPreacher = config.showPreacherName && context.preacherName.trim().length > 0;
  const hasTitle = config.showSermonTitle && context.sermonTitle.trim().length > 0;
  const hasChurch = config.showChurchName && context.churchName.trim().length > 0;
  const showLowerThird = config.lowerThirdEnabled && config.preset !== "MINIMAL_WATERMARK";

  if (showLowerThird && (hasPreacher || hasTitle || hasChurch)) {
    lines.push(`<rect x="0" y="${layout.backgroundY}" width="${width}" height="${layout.backgroundHeight}" fill="#000000" fill-opacity="0.65" />`);

    if (hasPreacher) {
      lines.push(buildTextNode({ text: context.preacherName.trim(), x: 48, y: layout.lineYs[0] ?? layout.backgroundY + 18, fontSize: layout.fontSizes[0] ?? 28, fill: themeColor, weight: 700 }));
    }

    if (hasTitle) {
      lines.push(buildTextNode({ text: context.sermonTitle.trim(), x: 48, y: layout.lineYs[1] ?? layout.backgroundY + 62, fontSize: layout.fontSizes[1] ?? 22, fill: themeColor, opacity: 0.85, weight: 700 }));
    }

    if (hasChurch) {
      lines.push(buildTextNode({ text: context.churchName.trim(), x: 48, y: layout.lineYs[2] ?? layout.backgroundY + 100, fontSize: layout.fontSizes[2] ?? 17, fill: "#FFFFFF", opacity: 0.7, weight: 600 }));
    }
  }

  if (config.watermarkEnabled || config.preset === "MINIMAL_WATERMARK") {
    const watermarkText = context.churchName.trim();
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
): Promise<boolean> {
  if (!config.enabled || config.preset === "NO_BRANDING") {
    return false;
  }

  const svg = buildBrandingOverlaySvg(config, context);
  const sharp = await getSharp();
  await sharp(Buffer.from(svg)).png().toFile(/* turbopackIgnore: true */ outputPath);
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
};
