import {
  getContentGraphicTemplate,
  isContentGraphicTemplateId,
  type ContentGraphicTemplate,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";
import {
  getContentArtworkBackground,
  getContentArtworkPalette,
  getContentArtworkTypographyPreset,
  normalizeContentArtworkSettings,
  normalizeContentArtworkTextOverrides,
  type ContentArtworkAlignment,
  type ContentArtworkLogoPosition,
  type ContentArtworkSettings,
  type ContentArtworkTextOverrides,
  type ContentArtworkTypographyPresetId,
} from "@/lib/contentArtworkDesign";

export type ContentAssetBranding = {
  churchName: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoDataUrl?: string | null;
};

export type ContentAssetInput = {
  title: string;
  content: string;
  scripture?: string | null;
  branding: ContentAssetBranding;
  width: number;
  height: number;
  templateId?: ContentGraphicTemplateId | null;
  artwork?: ContentArtworkSettings | Partial<ContentArtworkSettings> | null;
  textOverrides?: ContentArtworkTextOverrides | Partial<ContentArtworkTextOverrides> | null;
  /** A trusted, already-resolved image href may override a built-in image background. */
  backgroundImageHref?: string | null;
};

export type ContentTextLayout = {
  lines: string[];
  maxCharactersPerLine: number;
  maxLines: number;
  truncated: boolean;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  baseFontSize: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  compactLandscape: boolean;
  eyebrowY: number;
  titleY: number;
  contentAreaTop: number;
  startY: number;
  safeBottom: number;
  referenceY: number;
  brandY: number;
  safeArea: ContentSafeArea;
};

export type ContentCanvasFormat = "SQUARE" | "PORTRAIT" | "STORY" | "LANDSCAPE";

export type ContentSafeArea = {
  format: ContentCanvasFormat;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ContentContrastPlan = {
  textColor: "#FFFFFF";
  scrimOpacity: number;
  minimumContrastRatio: number;
};

export type ContentTextRoleMetric = {
  fontSize: number;
  letterSpacing: number;
  approximateCharacterWidth: number;
  capacity: number;
  exceedsCapacity: boolean;
};

export type ContentArtworkTextMetrics = {
  layout: ContentTextLayout;
  title: ContentTextRoleMetric;
  body: ContentTextRoleMetric & {
    maxLines: number;
    truncated: boolean;
    horizontalOverflow: boolean;
    verticalOverflow: boolean;
  };
  reference: ContentTextRoleMetric;
  typographyPresetId: ContentArtworkTypographyPresetId | null;
  textScale: number;
  lineHeight: number;
  reserveTopForLogo: boolean;
};

export type ResolveContentArtworkTextMetricsInput = {
  content: string;
  title?: string | null;
  reference?: string | null;
  width: number;
  height: number;
  templateId?: ContentGraphicTemplateId | null;
  artwork?: ContentArtworkSettings | Partial<ContentArtworkSettings> | null;
  hasLogo?: boolean;
};

const TYPOGRAPHY_CHARACTER_WIDTH_FACTORS: Record<
  ContentArtworkTypographyPresetId,
  { title: number; body: number; reference: number }
> = {
  brand: { title: 0.58, body: 0.5, reference: 0.58 },
  editorial: { title: 0.55, body: 0.53, reference: 0.54 },
  modern: { title: 0.58, body: 0.54, reference: 0.55 },
  humanist: { title: 0.6, body: 0.55, reference: 0.56 },
  bold: { title: 0.65, body: 0.6, reference: 0.58 },
  quiet: { title: 0.54, body: 0.52, reference: 0.53 },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeArtworkLogoDataUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(trimmed) && trimmed.length <= 750_000
    ? trimmed
    : null;
}

export function wrapContentText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?]+$/, "")}…`;
  }
  return lines;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function accessibleArtworkLabel(values: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const part = normalizedText(value ?? "").replace(/[.!?]+$/, "");
    if (!part) continue;
    const identity = part.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    parts.push(part);
  }
  return escapeXml(parts.join(". "));
}

export function resolveContentSafeArea(input: { width: number; height: number }): ContentSafeArea {
  const widthToHeight = input.width / input.height;
  const heightToWidth = input.height / input.width;
  const format: ContentCanvasFormat = heightToWidth >= 1.55
    ? "STORY"
    : heightToWidth >= 1.12
      ? "PORTRAIT"
      : widthToHeight >= 1.4
        ? "LANDSCAPE"
        : "SQUARE";
  const profile = {
    SQUARE: { left: 0.08, top: 0.075, right: 0.08, bottom: 0.085 },
    PORTRAIT: { left: 0.08, top: 0.07, right: 0.08, bottom: 0.09 },
    STORY: { left: 0.075, top: 0.105, right: 0.075, bottom: 0.14 },
    LANDSCAPE: { left: 0.07, top: 0.09, right: 0.07, bottom: 0.1 },
  }[format];
  const left = Math.round(input.width * profile.left);
  const top = Math.round(input.height * profile.top);
  const right = input.width - Math.round(input.width * profile.right);
  const bottom = input.height - Math.round(input.height * profile.bottom);

  return {
    format,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function expandHexColor(value: string): string | null {
  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;
  return match[1].length === 3
    ? match[1].split("").map((character) => `${character}${character}`).join("")
    : match[1];
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function whiteContrastAfterBlackScrim(color: string, opacity: number): number {
  const expanded = expandHexColor(color);
  if (!expanded) return 1;
  const multiplier = 1 - opacity;
  const red = Number.parseInt(expanded.slice(0, 2), 16) * multiplier;
  const green = Number.parseInt(expanded.slice(2, 4), 16) * multiplier;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) * multiplier;
  return 1.05 / (relativeLuminance(red, green, blue) + 0.05);
}

/** Returns the deterministic black scrim needed to keep small white text WCAG-readable. */
export function resolveContentContrast(input: {
  primaryColor: string;
  secondaryColor: string;
  minimumRatio?: number;
}): ContentContrastPlan {
  const minimumRatio = Math.max(4.5, input.minimumRatio ?? 4.75);
  let scrimOpacity = 0.18;
  let measured = 1;

  for (; scrimOpacity <= 0.82; scrimOpacity += 0.01) {
    measured = Math.min(
      whiteContrastAfterBlackScrim(input.primaryColor, scrimOpacity),
      whiteContrastAfterBlackScrim(input.secondaryColor, scrimOpacity),
    );
    if (measured >= minimumRatio) break;
  }

  const boundedOpacity = Math.min(0.82, Number(scrimOpacity.toFixed(2)));
  const finalRatio = Math.min(
    whiteContrastAfterBlackScrim(input.primaryColor, boundedOpacity),
    whiteContrastAfterBlackScrim(input.secondaryColor, boundedOpacity),
  );
  return {
    textColor: "#FFFFFF",
    scrimOpacity: boundedOpacity,
    minimumContrastRatio: Number(finalRatio.toFixed(2)),
  };
}

function buildContentTextLayout(input: {
  content: string;
  width: number;
  height: number;
  hasTitle: boolean;
  hasReference: boolean;
  baseFontSize: number;
  fontSize: number;
  lineHeightMultiplier: number;
  reserveTopForLogo: boolean;
  bodyCharacterWidthFactor: number;
  letterSpacing: number;
}): ContentTextLayout {
  const safeArea = resolveContentSafeArea(input);
  const portrait = safeArea.format === "PORTRAIT" || safeArea.format === "STORY";
  const compactLandscape = input.width / input.height >= 1.4;
  const padding = safeArea.left;
  const lineHeight = Math.round(input.fontSize * input.lineHeightMultiplier);
  const topLogoOffset = input.reserveTopForLogo ? input.baseFontSize * 0.9 : 0;
  const eyebrowY = Math.round(safeArea.top + input.baseFontSize * 0.42 + topLogoOffset);
  const titleY = Math.round(
    safeArea.top + input.baseFontSize * (compactLandscape ? 1.42 : 1.62) + topLogoOffset,
  );
  const contentAreaTop = input.hasTitle
    ? Math.round(safeArea.top + input.baseFontSize * (compactLandscape ? 2.62 : 2.82) + topLogoOffset)
    : Math.round(safeArea.top + input.baseFontSize * 1.72 + topLogoOffset);
  const brandY = Math.round(safeArea.bottom - input.baseFontSize * 0.1);
  const referenceY = Math.round(brandY - input.baseFontSize * 0.78);
  const safeBottom = Math.round(
    input.hasReference
      ? referenceY - input.baseFontSize * 0.72
      : brandY - input.baseFontSize * 0.88,
  );
  const horizontalInset = Math.round(input.width * 0.025);
  const usableWidth = safeArea.width - horizontalInset * 2;
  const bodyCharacterWidth = approximateCharacterWidth(
    input.fontSize,
    input.bodyCharacterWidthFactor,
    input.letterSpacing,
  );
  const maxCharactersPerLine = Math.max(12, Math.floor(usableWidth / bodyCharacterWidth));
  const maximumLineLimit = safeArea.format === "STORY" ? 11 : portrait ? 10 : compactLandscape ? 6 : 8;
  const verticalLineLimit = Math.max(1, Math.floor(
    (safeBottom - contentAreaTop - input.fontSize) / lineHeight,
  ) + 1);
  const maxLines = Math.min(maximumLineLimit, verticalLineLimit);
  const lines = wrapContentText(input.content, maxCharactersPerLine, maxLines);
  const contentHeight = input.fontSize + Math.max(0, lines.length - 1) * lineHeight;
  const availableHeight = Math.max(0, safeBottom - contentAreaTop);
  const startY = Math.round(
    contentAreaTop
      + Math.max(0, (availableHeight - contentHeight) / 2)
      + input.fontSize * 0.78,
  );
  const lastLineBottom = startY
    + Math.max(0, lines.length - 1) * lineHeight
    + Math.round(input.fontSize * 0.25);
  const normalized = normalizedText(input.content);
  const visible = normalizedText(lines.join(" ").replace(/…$/, ""));

  return {
    lines,
    maxCharactersPerLine,
    maxLines,
    truncated: normalized.length > visible.length && lines.at(-1)?.endsWith("…") === true,
    horizontalOverflow: lines.some((line) => line.replace(/…$/, "").length > maxCharactersPerLine),
    verticalOverflow: lastLineBottom > safeBottom,
    baseFontSize: input.baseFontSize,
    fontSize: input.fontSize,
    lineHeight,
    padding,
    compactLandscape,
    eyebrowY,
    titleY,
    contentAreaTop,
    startY,
    safeBottom,
    referenceY,
    brandY,
    safeArea,
  };
}

export function resolveContentTextLayout(input: {
  content: string;
  width: number;
  height: number;
  hasTitle: boolean;
  hasReference?: boolean;
  textScale?: number;
  lineHeight?: number;
  reserveTopForLogo?: boolean;
  typographyPresetId?: ContentArtworkTypographyPresetId | null;
  letterSpacing?: number;
}): ContentTextLayout {
  const portrait = input.height > input.width;
  const compactLandscape = input.width / input.height >= 1.4;
  const unscaledBaseFontSize = portrait
    ? Math.round(input.width * 0.066)
    : Math.round(input.width * 0.056);
  const textScale = Number.isFinite(input.textScale)
    ? Math.min(1.3, Math.max(0.75, input.textScale ?? 1))
    : 1;
  const lineHeightMultiplier = Number.isFinite(input.lineHeight)
    ? Math.min(1.35, Math.max(0.9, input.lineHeight ?? 1.25))
    : 1.25;
  const typographyPresetId = input.typographyPresetId
    && TYPOGRAPHY_CHARACTER_WIDTH_FACTORS[input.typographyPresetId]
    ? input.typographyPresetId
    : "brand";
  const bodyCharacterWidthFactor = TYPOGRAPHY_CHARACTER_WIDTH_FACTORS[typographyPresetId].body;
  const letterSpacing = Number.isFinite(input.letterSpacing)
    ? Math.min(4, Math.max(-1, input.letterSpacing ?? 0.15))
    : 0.15;
  const baseFontSize = Math.round(unscaledBaseFontSize * textScale);
  const minimumFontSize = compactLandscape
    ? Math.round(input.width * 0.034)
    : Math.round(baseFontSize * 0.72);
  const fallback = buildContentTextLayout({
    ...input,
    hasReference: Boolean(input.hasReference),
    baseFontSize,
    fontSize: minimumFontSize,
    lineHeightMultiplier,
    reserveTopForLogo: Boolean(input.reserveTopForLogo),
    bodyCharacterWidthFactor,
    letterSpacing,
  });

  for (let fontSize = baseFontSize; fontSize >= minimumFontSize; fontSize -= 2) {
    const layout = buildContentTextLayout({
      ...input,
      hasReference: Boolean(input.hasReference),
      baseFontSize,
      fontSize,
      lineHeightMultiplier,
      reserveTopForLogo: Boolean(input.reserveTopForLogo),
      bodyCharacterWidthFactor,
      letterSpacing,
    });
    if (!layout.truncated && !layout.horizontalOverflow && !layout.verticalOverflow) {
      return layout;
    }
  }

  return fallback;
}

function approximateCharacterWidth(
  fontSize: number,
  factor: number,
  letterSpacing: number,
): number {
  return Number(Math.max(1, fontSize * factor + letterSpacing).toFixed(3));
}

function singleLineCapacity(
  usableWidth: number,
  fontSize: number,
  factor: number,
  letterSpacing: number,
): number {
  return Math.max(1, Math.floor(
    usableWidth / approximateCharacterWidth(fontSize, factor, letterSpacing),
  ));
}

/**
 * Returns the exact deterministic fit plan used by the SVG renderer. Studio and
 * production preflight should consume this helper instead of independently
 * estimating title, body, or reference capacity.
 */
export function resolveContentArtworkTextMetrics(
  input: ResolveContentArtworkTextMetricsInput,
): ContentArtworkTextMetrics {
  const templateId = isContentGraphicTemplateId(input.templateId)
    ? input.templateId
    : "carousel-content";
  const template = getContentGraphicTemplate(templateId);
  const settings = input.artwork != null
    ? normalizeContentArtworkSettings(input.artwork, templateId)
    : null;
  const typographyPresetId = settings?.typographyPresetId ?? null;
  const factors = TYPOGRAPHY_CHARACTER_WIDTH_FACTORS[typographyPresetId ?? "brand"];
  const textScale = settings?.textScale ?? 1;
  const lineHeight = settings?.lineHeight ?? 1.25;
  const bodyLetterSpacing = settings?.letterSpacing ?? 0.15;
  const titleLetterSpacing = settings
    ? Math.max(-1, settings.letterSpacing * 0.5)
    : 0.2;
  const referenceLetterSpacing = settings
    ? Math.max(-0.5, settings.letterSpacing * 0.4)
    : 0.5;
  const reserveTopForLogo = Boolean(
    input.hasLogo
      && settings?.showLogo
      && settings.logoPosition.startsWith("TOP"),
  );
  const layout = resolveContentTextLayout({
    content: input.content,
    width: input.width,
    height: input.height,
    hasTitle: Boolean(input.title?.trim()),
    hasReference: Boolean(input.reference?.trim()),
    textScale,
    lineHeight,
    reserveTopForLogo,
    typographyPresetId,
    letterSpacing: bodyLetterSpacing,
  });
  const horizontalInset = Math.round(input.width * 0.025);
  const usableWidth = layout.safeArea.width - horizontalInset * 2;
  const titleFontSize = Math.round(
    layout.baseFontSize * (template.surface === "BOLD" ? 0.82 : 0.64),
  );
  const referenceFontSize = Math.round(layout.baseFontSize * 0.43);
  const titleCapacity = singleLineCapacity(
    usableWidth,
    titleFontSize,
    factors.title,
    titleLetterSpacing,
  );
  const referenceUsableWidth = template.referenceTreatment === "PILL"
    ? Math.max(
        referenceFontSize,
        Math.min(usableWidth, Math.round(layout.safeArea.width * 0.76) - referenceFontSize * 1.8),
      )
    : usableWidth;
  const renderedReferencePrefixLength = template.referenceTreatment === "BYLINE" ? 2 : 0;
  const referenceCapacity = Math.max(
    1,
    singleLineCapacity(
      referenceUsableWidth,
      referenceFontSize,
      factors.reference,
      referenceLetterSpacing,
    ) - renderedReferencePrefixLength,
  );
  const bodyCharacterWidth = approximateCharacterWidth(
    layout.fontSize,
    factors.body,
    bodyLetterSpacing,
  );
  const normalizedTitle = normalizedText(input.title ?? "");
  const normalizedReference = normalizedText(input.reference ?? "");

  return {
    layout,
    title: {
      fontSize: titleFontSize,
      letterSpacing: titleLetterSpacing,
      approximateCharacterWidth: approximateCharacterWidth(
        titleFontSize,
        factors.title,
        titleLetterSpacing,
      ),
      capacity: titleCapacity,
      exceedsCapacity: normalizedTitle.length > titleCapacity,
    },
    body: {
      fontSize: layout.fontSize,
      letterSpacing: bodyLetterSpacing,
      approximateCharacterWidth: bodyCharacterWidth,
      capacity: layout.maxCharactersPerLine,
      exceedsCapacity: layout.truncated || layout.horizontalOverflow || layout.verticalOverflow,
      maxLines: layout.maxLines,
      truncated: layout.truncated,
      horizontalOverflow: layout.horizontalOverflow,
      verticalOverflow: layout.verticalOverflow,
    },
    reference: {
      fontSize: referenceFontSize,
      letterSpacing: referenceLetterSpacing,
      approximateCharacterWidth: approximateCharacterWidth(
        referenceFontSize,
        factors.reference,
        referenceLetterSpacing,
      ),
      capacity: referenceCapacity,
      exceedsCapacity: normalizedReference.length > referenceCapacity,
    },
    typographyPresetId,
    textScale,
    lineHeight,
    reserveTopForLogo,
  };
}

/** @deprecated Prefer resolveContentArtworkTextMetrics for complete fit analysis. */
export function estimateContentSingleLineCapacity(input: {
  width: number;
  height: number;
  role: "title" | "scripture";
  titleScale?: number;
  textScale?: number;
  letterSpacing?: number;
  typographyPresetId?: ContentArtworkTypographyPresetId | null;
}): number {
  const typographyPresetId = input.typographyPresetId
    && TYPOGRAPHY_CHARACTER_WIDTH_FACTORS[input.typographyPresetId]
    ? input.typographyPresetId
    : "brand";
  const factors = TYPOGRAPHY_CHARACTER_WIDTH_FACTORS[typographyPresetId];
  const baseFontSize = resolveContentTextLayout({
    content: "Content",
    width: input.width,
    height: input.height,
    hasTitle: true,
    textScale: input.textScale,
    typographyPresetId,
    letterSpacing: input.letterSpacing,
  }).baseFontSize;
  const fontSize = Math.round(baseFontSize * (
    input.role === "title" ? input.titleScale ?? 0.64 : 0.43
  ));
  const safeArea = resolveContentSafeArea(input);
  const horizontalInset = Math.round(input.width * 0.025);
  const usableWidth = safeArea.width - horizontalInset * 2;
  const letterSpacing = input.letterSpacing ?? (input.role === "title" ? 0.2 : 0.5);
  return singleLineCapacity(
    usableWidth,
    fontSize,
    input.role === "title" ? factors.title : factors.reference,
    letterSpacing,
  );
}

type ResolvedArtworkPalette = {
  primary: string;
  secondary: string;
  accent: string;
};

function resolveArtworkPalette(
  artwork: ContentArtworkSettings,
  branding: ContentAssetBranding,
): ResolvedArtworkPalette {
  const palette = getContentArtworkPalette(artwork.paletteId);
  return palette.usesBrandColors
    ? {
        primary: branding.primaryColor,
        secondary: branding.secondaryColor,
        accent: palette.colors[2],
      }
    : {
        primary: palette.colors[0],
        secondary: palette.colors[1],
        accent: palette.colors[2],
      };
}

function safeBackgroundImageHref(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(trimmed)) return trimmed;
  if (/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/u.test(trimmed) && trimmed.length <= 8_000_000) {
    return trimmed;
  }
  return null;
}

function focalPointPreserveAspectRatio(artwork: ContentArtworkSettings): string {
  const horizontal = { LEFT: "xMin", CENTER: "xMid", RIGHT: "xMax" }[artwork.focalPointX];
  const vertical = { TOP: "YMin", CENTER: "YMid", BOTTOM: "YMax" }[artwork.focalPointY];
  return `${horizontal}${vertical} slice`;
}

function renderComposedBackground(input: {
  artwork: ContentArtworkSettings;
  width: number;
  height: number;
  backgroundImageHref?: string | null;
}): { markup: string; isImage: boolean; backgroundId: string } {
  const background = getContentArtworkBackground(input.artwork.backgroundId);
  const explicitImageHref = safeBackgroundImageHref(input.backgroundImageHref);
  const imageHref = explicitImageHref
    ?? safeBackgroundImageHref(background.imagePath);

  if ((background.kind === "IMAGE" || explicitImageHref) && imageHref) {
    return {
      isImage: true,
      backgroundId: background.id,
      markup: `<g data-background-kind="image" data-background-id="${background.id}" filter="url(#backgroundTreatment)"><image href="${escapeXml(imageHref)}" x="0" y="0" width="${input.width}" height="${input.height}" preserveAspectRatio="${focalPointPreserveAspectRatio(input.artwork)}"/></g>
  <rect data-layer="palette-wash" width="${input.width}" height="${input.height}" fill="url(#paletteBackground)" fill-opacity="0.2"/>`,
    };
  }

  const base = `<rect width="${input.width}" height="${input.height}" fill="url(#paletteBackground)"/>`;
  const procedural = (() => {
    switch (background.id) {
      case "soft-glow":
        return `${base}
  <circle cx="${Math.round(input.width * 0.27)}" cy="${Math.round(input.height * 0.23)}" r="${Math.round(input.width * 0.42)}" fill="url(#artworkGlow)" opacity="0.78"/>
  <circle cx="${Math.round(input.width * 0.84)}" cy="${Math.round(input.height * 0.8)}" r="${Math.round(input.width * 0.34)}" fill="url(#artworkGlow)" opacity="0.36"/>`;
      case "paper-wash":
        return `${base}
  <rect width="${input.width}" height="${input.height}" fill="url(#wovenTexture)" opacity="0.58"/>
  <path d="M0 ${Math.round(input.height * 0.76)} Q${Math.round(input.width * 0.48)} ${Math.round(input.height * 0.63)} ${input.width} ${Math.round(input.height * 0.82)} V${input.height} H0 Z" fill="#fff" fill-opacity="0.06"/>`;
      case "radiant-rays":
        return `${base}
  <path d="M${Math.round(input.width * 0.56)} ${Math.round(input.height * 0.43)} L-${Math.round(input.width * 0.08)} 0 H${Math.round(input.width * 0.24)} Z" fill="url(#artworkGlow)" opacity="0.48"/>
  <path d="M${Math.round(input.width * 0.56)} ${Math.round(input.height * 0.43)} L${Math.round(input.width * 0.72)} 0 H${input.width} Z" fill="url(#artworkGlow)" opacity="0.38"/>
  <circle cx="${Math.round(input.width * 0.56)}" cy="${Math.round(input.height * 0.43)}" r="${Math.round(input.width * 0.32)}" fill="url(#artworkGlow)" opacity="0.76"/>`;
      case "woven-depth":
        return `${base}
  <rect width="${input.width}" height="${input.height}" fill="url(#wovenTexture)" opacity="0.82"/>
  <path d="M${Math.round(input.width * 0.65)} 0 H${input.width} V${input.height} H${Math.round(input.width * 0.82)} Q${Math.round(input.width * 0.56)} ${Math.round(input.height * 0.54)} ${Math.round(input.width * 0.65)} 0 Z" fill="url(#artworkGlow)" opacity="0.38"/>`;
      case "midnight-depth":
        return `<rect width="${input.width}" height="${input.height}" fill="#050912"/>
  <ellipse cx="${Math.round(input.width * 0.82)}" cy="${Math.round(input.height * 0.2)}" rx="${Math.round(input.width * 0.62)}" ry="${Math.round(input.height * 0.48)}" fill="url(#paletteBackground)" opacity="0.68"/>
  <rect width="${input.width}" height="${input.height}" fill="url(#dotTexture)" opacity="0.14"/>`;
      case "brand-gradient":
      default:
        return base;
    }
  })();

  return {
    isImage: false,
    backgroundId: background.id,
    markup: `<g data-background-kind="procedural" data-background-id="${background.id}" filter="url(#backgroundTreatment)">${procedural}</g>`,
  };
}

function renderTemplateArtwork(input: {
  template: ContentGraphicTemplate;
  width: number;
  height: number;
  padding: number;
  secondaryColor: string;
  contrastOpacity: number;
  backgroundMarkup?: string;
}): string {
  const { template, width, height, padding, secondaryColor, contrastOpacity } = input;
  const frameRadius = Math.max(18, Math.round(width * 0.026));
  const insetWidth = width - padding * 2;
  const insetHeight = height - padding * 2;
  const commonBackground = `${input.backgroundMarkup ?? `<rect width="${width}" height="${height}" fill="url(#brandBackground)"/>`}
  <rect data-layer="contrast-shield" width="${width}" height="${height}" fill="#000" fill-opacity="${contrastOpacity.toFixed(2)}"/>`;

  switch (template.artDirection) {
    case "MINIMAL":
      return `${commonBackground}
  <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.46)}" r="${Math.round(width * 0.37)}" fill="url(#softGlow)" opacity="0.42"/>
  <rect x="${padding}" y="${padding}" width="${insetWidth}" height="${insetHeight}" rx="${frameRadius}" fill="none" stroke="#fff" stroke-opacity="0.18"/>
  <path d="M${Math.round(width * 0.37)} ${Math.round(height * 0.16)} H${Math.round(width * 0.63)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(width * 0.003))}" stroke-linecap="round" stroke-opacity="0.7"/>
  <path d="M${Math.round(width * 0.45)} ${Math.round(height * 0.86)} H${Math.round(width * 0.55)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(width * 0.003))}" stroke-linecap="round" stroke-opacity="0.42"/>`;
    case "LUMINOUS":
      return `${commonBackground}
  <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.43)}" r="${Math.round(width * 0.49)}" fill="url(#softGlow)" opacity="0.92"/>
  <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.43)}" r="${Math.round(width * 0.36)}" fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="${Math.max(2, Math.round(width * 0.004))}"/>
  <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.43)}" r="${Math.round(width * 0.26)}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="${Math.max(2, Math.round(width * 0.003))}"/>
  <path d="M${padding} ${Math.round(height * 0.82)} Q${Math.round(width * 0.5)} ${Math.round(height * 0.72)} ${width - padding} ${Math.round(height * 0.82)}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="${Math.max(2, Math.round(width * 0.003))}"/>
  <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.13)}" r="${Math.max(4, Math.round(width * 0.008))}" fill="#fff" fill-opacity="0.76"/>`;
    case "TEXTURED":
      return `${commonBackground}
  <rect width="${width}" height="${height}" fill="url(#wovenTexture)" opacity="0.72"/>
  <path d="M${Math.round(width * 0.58)} 0 H${width} V${height} H${Math.round(width * 0.76)} C${Math.round(width * 0.55)} ${Math.round(height * 0.72)}, ${Math.round(width * 0.88)} ${Math.round(height * 0.32)}, ${Math.round(width * 0.58)} 0 Z" fill="${secondaryColor}" fill-opacity="0.26"/>
  <circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.24)}" fill="url(#softGlow)" opacity="0.56"/>
  <rect x="${padding}" y="${Math.round(padding * 1.08)}" width="${insetWidth}" height="${Math.round(height - padding * 2.16)}" rx="${frameRadius}" fill="#050608" fill-opacity="0.22" stroke="#fff" stroke-opacity="0.16"/>
  <path d="M${Math.round(padding * 1.34)} ${Math.round(height * 0.17)} H${Math.round(width * 0.46)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(width * 0.004))}" stroke-opacity="0.5"/>
  <path d="M${Math.round(width * 0.62)} ${Math.round(height * 0.86)} l${Math.round(width * 0.23)} -${Math.round(height * 0.09)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(width * 0.003))}" stroke-opacity="0.18"/>`;
    case "SERENE":
      return `${commonBackground}
  <path d="M0 ${Math.round(height * 0.14)} C${Math.round(width * 0.32)} ${Math.round(height * 0.02)}, ${Math.round(width * 0.7)} ${Math.round(height * 0.24)}, ${width} ${Math.round(height * 0.09)} V0 H0 Z" fill="#fff" fill-opacity="0.075"/>
  <path d="M0 ${Math.round(height * 0.82)} C${Math.round(width * 0.3)} ${Math.round(height * 0.68)}, ${Math.round(width * 0.66)} ${Math.round(height * 0.95)}, ${width} ${Math.round(height * 0.76)} V${height} H0 Z" fill="${secondaryColor}" fill-opacity="0.34"/>
  <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.22)}" fill="#fff" fill-opacity="0.06"/>
  <rect x="${padding}" y="${Math.round(padding * 1.08)}" width="${insetWidth}" height="${Math.round(height - padding * 2.16)}" rx="${Math.round(frameRadius * 1.8)}" fill="#fff" fill-opacity="0.075" stroke="#fff" stroke-opacity="0.13"/>`;
    case "JOURNAL":
      return `${commonBackground}
  <rect x="${Math.round(padding * 1.18)}" y="${Math.round(padding * 0.82)}" width="${insetWidth}" height="${insetHeight}" rx="${frameRadius}" fill="${secondaryColor}" fill-opacity="0.34" transform="rotate(2 ${Math.round(width / 2)} ${Math.round(height / 2)})"/>
  <rect x="${padding}" y="${padding}" width="${insetWidth}" height="${insetHeight}" rx="${frameRadius}" fill="#fff" fill-opacity="0.105" stroke="#fff" stroke-opacity="0.2"/>
  <path d="M${Math.round(padding * 1.45)} ${Math.round(height * 0.19)} H${Math.round(width - padding * 1.45)}" stroke="#fff" stroke-opacity="0.18"/>
  <path d="M${Math.round(width * 0.76)} ${Math.round(height * 0.11)} l${Math.round(width * 0.1)} ${Math.round(height * 0.06)} l-${Math.round(width * 0.1)} ${Math.round(height * 0.06)} Z" fill="#fff" fill-opacity="0.16"/>`;
    case "CELEBRATION":
      return `${commonBackground}
  <path d="M${Math.round(width * 0.58)} 0 H${width} V${height} H${Math.round(width * 0.29)} Z" fill="${secondaryColor}" fill-opacity="0.48"/>
  <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.16)}" r="${Math.round(width * 0.28)}" fill="#fff" fill-opacity="0.09"/>
  <path d="M0 ${Math.round(height * 0.78)} L${width} ${Math.round(height * 0.54)} V${height} H0 Z" fill="#000" fill-opacity="0.16"/>
  <path d="M${padding} ${Math.round(height * 0.11)} H${Math.round(width * 0.34)}" stroke="#fff" stroke-width="${Math.max(4, Math.round(width * 0.009))}" stroke-linecap="round" stroke-opacity="0.82"/>
  <path d="M${Math.round(width * 0.86)} ${Math.round(height * 0.76)} l${Math.round(width * 0.035)} ${Math.round(width * 0.035)} l-${Math.round(width * 0.035)} ${Math.round(width * 0.035)} l-${Math.round(width * 0.035)} -${Math.round(width * 0.035)} Z" fill="#fff" fill-opacity="0.68"/>`;
    case "EDITORIAL":
    default:
      return `${commonBackground}
  <rect width="${width}" height="${height}" fill="url(#dotTexture)" opacity="0.28"/>
  <rect x="${padding}" y="${padding}" width="${insetWidth}" height="${insetHeight}" rx="${frameRadius}" fill="#06070a" fill-opacity="0.1" stroke="#fff" stroke-opacity="0.2"/>
  <rect x="${Math.round(padding * 1.18)}" y="${Math.round(height * 0.37)}" width="${Math.max(6, Math.round(width * 0.011))}" height="${Math.round(height * 0.3)}" rx="${Math.max(3, Math.round(width * 0.006))}" fill="#fff" fill-opacity="0.72"/>
  <circle cx="${Math.round(width * 0.88)}" cy="${Math.round(height * 0.12)}" r="${Math.round(width * 0.2)}" fill="#fff" fill-opacity="0.06"/>
  <path d="M${Math.round(width * 0.65)} ${Math.round(height * 0.88)} H${width - padding}" stroke="#fff" stroke-opacity="0.25" stroke-width="${Math.max(2, Math.round(width * 0.003))}"/>`;
  }
}

function renderReferenceLine(input: {
  template: ContentGraphicTemplate;
  value: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  fontSize: number;
  letterSpacing: number;
  approximateCharacterWidth: number;
  family: string;
  safeArea: ContentSafeArea;
  textColor: string;
}): string {
  const cleanValue = normalizedText(input.value).replace(/^[—–-]\s*/, "");
  if (!cleanValue) return "";
  const fontSize = input.fontSize;
  const textValue = input.template.referenceTreatment === "BYLINE"
    ? `— ${cleanValue}`
    : cleanValue;
  const escapedValue = escapeXml(textValue);
  const text = `<text data-text-role="${input.template.referenceTreatment === "BYLINE" ? "byline" : "reference"}" x="${input.x}" y="${input.y}" text-anchor="${input.anchor}" fill="${input.textColor}" fill-opacity="0.9" font-family="${input.family}" font-size="${fontSize}" font-weight="700" letter-spacing="${input.letterSpacing.toFixed(2)}"${input.template.referenceTreatment === "BYLINE" ? ' font-style="italic"' : ""}>${escapedValue}</text>`;

  if (input.template.referenceTreatment === "PILL") {
    const pillWidth = Math.min(
      Math.round(input.safeArea.width * 0.76),
      Math.max(
        fontSize * 5,
        Math.round(textValue.length * input.approximateCharacterWidth + fontSize * 1.8),
      ),
    );
    const pillHeight = Math.round(fontSize * 1.85);
    const pillX = input.anchor === "middle"
      ? input.x - pillWidth / 2
      : input.anchor === "end"
        ? input.x - pillWidth
        : input.x;
    const pillY = input.y - Math.round(fontSize * 1.3);
    return `<rect data-reference-treatment="pill" x="${Math.round(pillX)}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="${Math.round(pillHeight / 2)}" fill="#000" fill-opacity="0.28" stroke="#fff" stroke-opacity="0.3"/>
  ${text}`;
  }

  if (input.template.referenceTreatment === "RULE") {
    const ruleWidth = Math.round(input.safeArea.width * 0.22);
    const ruleStart = input.anchor === "middle"
      ? input.x - ruleWidth / 2
      : input.anchor === "end"
        ? input.x - ruleWidth
        : input.x;
    return `<path data-reference-treatment="rule" d="M${Math.round(ruleStart)} ${Math.round(input.y - fontSize * 1.15)} h${ruleWidth}" stroke="#fff" stroke-width="${Math.max(2, Math.round(fontSize * 0.08))}" stroke-opacity="0.52" stroke-linecap="round"/>
  ${text}`;
  }

  return text;
}

export function renderBrandedContentSvg(input: ContentAssetInput): string {
  const templateId = isContentGraphicTemplateId(input.templateId)
    ? input.templateId
    : "carousel-content";
  const template = getContentGraphicTemplate(templateId);
  const hasComposedArtwork = input.artwork != null || Boolean(input.backgroundImageHref?.trim());
  const artworkSettings = hasComposedArtwork
    ? normalizeContentArtworkSettings(input.artwork, templateId)
    : null;
  const textOverrides = normalizeContentArtworkTextOverrides(input.textOverrides);
  const logoDataUrl = safeArtworkLogoDataUrl(input.branding.logoDataUrl);
  const textMetrics = resolveContentArtworkTextMetrics({
    content: input.content,
    title: input.title,
    reference: input.scripture,
    width: input.width,
    height: input.height,
    templateId,
    artwork: artworkSettings,
    hasLogo: Boolean(logoDataUrl),
  });
  const layout = textMetrics.layout;
  const {
    baseFontSize,
    brandY,
    compactLandscape,
    contentAreaTop,
    eyebrowY,
    fontSize,
    lineHeight,
    lines,
    padding,
    referenceY,
    safeArea,
    startY,
  } = layout;
  const titleY = layout.titleY;
  const title = escapeXml(input.title.toUpperCase());
  const eyebrow = escapeXml(textOverrides.eyebrowText ?? template.eyebrow);
  const church = escapeXml(textOverrides.footerText ?? input.branding.churchName);
  const scripture = input.scripture ? escapeXml(input.scripture) : "";
  const family = escapeXml(input.branding.fontFamily);
  const resolvedPalette = artworkSettings
    ? resolveArtworkPalette(artworkSettings, input.branding)
    : {
        primary: input.branding.primaryColor,
        secondary: input.branding.secondaryColor,
        accent: "#FFFFFF",
      };
  const primaryColor = escapeXml(resolvedPalette.primary);
  const secondaryColor = escapeXml(resolvedPalette.secondary);
  const accentColor = escapeXml(resolvedPalette.accent);
  const composedBackground = artworkSettings
    ? renderComposedBackground({
        artwork: artworkSettings,
        width: input.width,
        height: input.height,
        backgroundImageHref: input.backgroundImageHref,
      })
    : null;
  const contrast = resolveContentContrast({
    primaryColor: composedBackground?.isImage ? "#FFFFFF" : resolvedPalette.primary,
    secondaryColor: composedBackground?.isImage ? "#FFFFFF" : resolvedPalette.secondary,
  });
  const contrastOpacity = artworkSettings
    ? Math.max(contrast.scrimOpacity, artworkSettings.overlayOpacity)
    : contrast.scrimOpacity;
  const alignment: ContentArtworkAlignment = artworkSettings?.alignment ?? template.alignment;
  const textAnchor = alignment === "CENTER" ? "middle" : alignment === "RIGHT" ? "end" : "start";
  const horizontalInset = Math.round(input.width * 0.025);
  const contentX = alignment === "CENTER"
    ? Math.round((safeArea.left + safeArea.right) / 2)
    : alignment === "RIGHT"
      ? safeArea.right - horizontalInset
      : safeArea.left + horizontalInset;
  const brandX = alignment === "CENTER"
    ? Math.round((safeArea.left + safeArea.right) / 2)
    : alignment === "RIGHT"
      ? safeArea.left + horizontalInset
      : safeArea.right - horizontalInset;
  const brandAnchor = alignment === "CENTER" ? "middle" : alignment === "RIGHT" ? "start" : "end";
  const logoHeight = Math.max(24, Math.round(baseFontSize * 0.58));
  const logoWidth = Math.max(76, Math.round(baseFontSize * 2.25));
  const logoPosition: ContentArtworkLogoPosition = artworkSettings?.logoPosition ?? "BOTTOM_LEFT";
  const logoOnRight = logoPosition.endsWith("RIGHT");
  const logoOnTop = logoPosition.startsWith("TOP");
  const logoX = logoOnRight
    ? safeArea.right - horizontalInset - logoWidth
    : safeArea.left + horizontalInset;
  const logoY = logoOnTop
    ? safeArea.top + Math.round(baseFontSize * 0.1)
    : Math.round(brandY - logoHeight * 0.82);
  const shouldShowLogo = artworkSettings?.showLogo ?? true;
  const footerBrandX = logoDataUrl && shouldShowLogo && !logoOnTop
    ? logoOnRight
      ? safeArea.left + horizontalInset
      : safeArea.right - horizontalInset
    : brandX;
  const footerBrandAnchor = logoDataUrl && shouldShowLogo && !logoOnTop
    ? logoOnRight ? "start" : "end"
    : brandAnchor;
  const logoPositionAttribute = artworkSettings
    ? ` data-logo-position="${logoPosition.toLowerCase()}"`
    : "";
  const brandLogo = logoDataUrl && shouldShowLogo
    ? `<g data-brand-logo="true"${logoPositionAttribute} aria-hidden="true"><rect x="${logoX - Math.round(logoHeight * 0.24)}" y="${logoY - Math.round(logoHeight * 0.18)}" width="${logoWidth + Math.round(logoHeight * 0.48)}" height="${Math.round(logoHeight * 1.36)}" rx="${Math.round(logoHeight * 0.26)}" fill="#fff" fill-opacity="0.9"/><image href="${escapeXml(logoDataUrl)}" x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMinYMid meet"/></g>`
    : "";
  const typography = artworkSettings
    ? getContentArtworkTypographyPreset(artworkSettings.typographyPresetId)
    : null;
  const presetFamily = (value: string | undefined, fallback: string) => escapeXml(
    !value || value === "BRAND" ? fallback : value,
  );
  const titleFamily = presetFamily(typography?.headingFamily, `${input.branding.fontFamily}, sans-serif`);
  const titleFontSize = textMetrics.title.fontSize;
  const legacyBodyFamily = template.family === "BOLD_RADIANT"
    ? `${family}, sans-serif`
    : ["QUOTE", "SCRIPTURE", "PRAYER"].includes(template.role)
      ? `Georgia, ${family}, serif`
      : `${family}, sans-serif`;
  const bodyFamily = !typography || typography.id === "brand"
    ? legacyBodyFamily
    : presetFamily(typography.bodyFamily, `${input.branding.fontFamily}, sans-serif`);
  const legacyBodyWeight = template.family === "BOLD_RADIANT" ? 760
    : template.artDirection === "EDITORIAL" ? 650
      : template.artDirection === "MINIMAL" ? 500
        : 580;
  const bodyWeight = !typography || typography.id === "brand" ? legacyBodyWeight : typography.bodyWeight;
  const titleWeight = typography && typography.id !== "brand" ? typography.headingWeight : 850;
  const letterSpacing = textMetrics.body.letterSpacing;
  const titleLetterSpacing = textMetrics.title.letterSpacing.toFixed(2);
  const referenceFamily = typography && typography.id !== "brand" ? bodyFamily : `${family}, sans-serif`;
  const artwork = renderTemplateArtwork({
    template,
    width: input.width,
    height: input.height,
    padding,
    secondaryColor,
    contrastOpacity,
    backgroundMarkup: composedBackground?.markup,
  });
  const reference = scripture
    ? renderReferenceLine({
        template,
        value: input.scripture ?? "",
        x: contentX,
        y: referenceY,
        anchor: textAnchor,
        fontSize: textMetrics.reference.fontSize,
        letterSpacing: textMetrics.reference.letterSpacing,
        approximateCharacterWidth: textMetrics.reference.approximateCharacterWidth,
        family: referenceFamily,
        safeArea,
        textColor: contrast.textColor,
      })
    : "";
  const accessibleLabel = accessibleArtworkLabel([
    textOverrides.showEyebrow ? textOverrides.eyebrowText : null,
    input.title,
    input.content,
    input.scripture,
    textOverrides.showFooter ? textOverrides.footerText : null,
  ]);
  const artworkAttributes = artworkSettings && composedBackground
    ? ` data-artwork-version="${artworkSettings.version}" data-background-id="${composedBackground.backgroundId}" data-palette-id="${artworkSettings.paletteId}" data-typography-id="${artworkSettings.typographyPresetId}" data-alignment="${artworkSettings.alignment.toLowerCase()}"`
    : "";
  const composedDefinitions = artworkSettings
    ? `
    <linearGradient id="paletteBackground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primaryColor}"/><stop offset="0.64" stop-color="${secondaryColor}"/><stop offset="1" stop-color="${primaryColor}"/></linearGradient>
    <radialGradient id="artworkGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="${accentColor}" stop-opacity="0.72"/><stop offset="0.54" stop-color="${secondaryColor}" stop-opacity="0.28"/><stop offset="1" stop-color="${primaryColor}" stop-opacity="0"/></radialGradient>
    <filter id="backgroundTreatment" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${artworkSettings.blur.toFixed(2)}" result="backgroundBlur"/><feComponentTransfer in="backgroundBlur"><feFuncR type="linear" slope="${artworkSettings.brightness.toFixed(2)}"/><feFuncG type="linear" slope="${artworkSettings.brightness.toFixed(2)}"/><feFuncB type="linear" slope="${artworkSettings.brightness.toFixed(2)}"/></feComponentTransfer></filter>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img" aria-label="${accessibleLabel}" data-template-id="${template.id}" data-design="${template.artDirection.toLowerCase()}" data-family="${template.family.toLowerCase()}" data-safe-area="${safeArea.left},${safeArea.top},${safeArea.right},${safeArea.bottom}" data-min-contrast="${contrast.minimumContrastRatio.toFixed(2)}"${artworkAttributes}>
  <defs>
    <linearGradient id="brandBackground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primaryColor}"/><stop offset="0.58" stop-color="${primaryColor}"/><stop offset="1" stop-color="${secondaryColor}"/></linearGradient>
    <radialGradient id="softGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="0.55" stop-color="${secondaryColor}" stop-opacity="0.13"/><stop offset="1" stop-color="${primaryColor}" stop-opacity="0"/></radialGradient>
    <pattern id="dotTexture" width="${Math.max(24, Math.round(input.width * 0.045))}" height="${Math.max(24, Math.round(input.width * 0.045))}" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" fill-opacity="0.16"/></pattern>
    <pattern id="wovenTexture" width="${Math.max(18, Math.round(input.width * 0.026))}" height="${Math.max(18, Math.round(input.width * 0.026))}" patternUnits="userSpaceOnUse"><path d="M0 1 H100 M1 0 V100" stroke="#fff" stroke-opacity="0.075" stroke-width="1"/><path d="M0 0 L100 100 M100 0 L0 100" stroke="#000" stroke-opacity="0.05" stroke-width="1"/></pattern>
    ${composedDefinitions}
  </defs>
  ${artwork}
  <rect data-layer="safe-area" x="${safeArea.left}" y="${safeArea.top}" width="${safeArea.width}" height="${safeArea.height}" fill="none" opacity="0"/>
  ${textOverrides.showEyebrow ? `<text data-text-role="eyebrow" x="${contentX}" y="${eyebrowY}" text-anchor="${textAnchor}" fill="${contrast.textColor}" fill-opacity="0.8" font-family="${titleFamily}" font-size="${Math.round(baseFontSize * 0.33)}" font-weight="800" letter-spacing="3">${eyebrow}</text>` : ""}
  ${template.showQuoteMark && !compactLandscape ? `<text aria-hidden="true" x="${contentX}" y="${Math.round(contentAreaTop - baseFontSize * 0.18)}" text-anchor="${textAnchor}" fill="${contrast.textColor}" fill-opacity="0.14" font-family="Georgia, serif" font-size="${Math.round(baseFontSize * 3.2)}">“</text>` : ""}
  ${title ? `<text data-text-role="title" x="${contentX}" y="${titleY}" text-anchor="${textAnchor}" fill="${contrast.textColor}" fill-opacity="0.94" font-family="${titleFamily}" font-size="${titleFontSize}" font-weight="${titleWeight}" letter-spacing="${titleLetterSpacing}">${title}</text>` : ""}
  <text data-text-role="body" x="${contentX}" y="${startY}" text-anchor="${textAnchor}" fill="${contrast.textColor}" font-family="${bodyFamily}" font-size="${fontSize}" font-weight="${bodyWeight}" letter-spacing="${letterSpacing.toFixed(2)}">
    ${lines.map((line, index) => `<tspan x="${contentX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  ${reference}
  ${brandLogo}
  ${textOverrides.showFooter ? `<text data-text-role="brand" x="${footerBrandX}" y="${brandY}" text-anchor="${footerBrandAnchor}" fill="${contrast.textColor}" fill-opacity="0.74" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.35)}" font-weight="700" letter-spacing="0.6">${church}</text>` : ""}
</svg>`;
}

export function splitCarouselSlides(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  const matches = normalized.split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i).map((item) => item.trim()).filter(Boolean);
  if (matches.length > 1) return matches.slice(0, 10);
  return normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

export const __contentAssetRendererTestUtils = { escapeXml };
