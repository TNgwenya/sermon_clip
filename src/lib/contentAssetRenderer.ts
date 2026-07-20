import {
  getContentGraphicTemplate,
  isContentGraphicTemplateId,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";

export type ContentAssetBranding = {
  churchName: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
};

export type ContentAssetInput = {
  title: string;
  content: string;
  scripture?: string | null;
  branding: ContentAssetBranding;
  width: number;
  height: number;
  templateId?: ContentGraphicTemplateId | null;
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
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

function buildContentTextLayout(input: {
  content: string;
  width: number;
  height: number;
  hasTitle: boolean;
  baseFontSize: number;
  fontSize: number;
}): ContentTextLayout {
  const portrait = input.height > input.width;
  const compactLandscape = input.width / input.height >= 1.4;
  const padding = Math.round(input.width * 0.09);
  const lineHeight = Math.round(input.fontSize * 1.25);
  const eyebrowY = compactLandscape
    ? Math.round(input.height * 0.205)
    : Math.round(padding * 1.48);
  const titleY = compactLandscape
    ? Math.round(input.height * 0.3)
    : Math.round(input.height * 0.25);
  const contentAreaTop = input.hasTitle
    ? Math.round(input.height * (compactLandscape ? 0.4 : 0.37))
    : Math.round(input.height * 0.3);
  const safeBottom = input.height - Math.round(padding * (compactLandscape ? 1.95 : 1.4));
  const usableWidth = input.width - padding * 2.9;
  const maxCharactersPerLine = Math.max(12, Math.floor(usableWidth / (input.fontSize * 0.5)));
  const maximumLineLimit = portrait ? 10 : compactLandscape ? 6 : 7;
  const verticalLineLimit = Math.max(1, Math.floor(
    (safeBottom - contentAreaTop - Math.round(input.fontSize * 0.25)) / lineHeight,
  ) + 1);
  const maxLines = Math.min(maximumLineLimit, verticalLineLimit);
  const lines = wrapContentText(input.content, maxCharactersPerLine, maxLines);
  const contentHeight = lines.length * lineHeight;
  const startY = Math.max(contentAreaTop, Math.round((input.height - contentHeight) / 2));
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
  };
}

export function resolveContentTextLayout(input: {
  content: string;
  width: number;
  height: number;
  hasTitle: boolean;
}): ContentTextLayout {
  const portrait = input.height > input.width;
  const compactLandscape = input.width / input.height >= 1.4;
  const baseFontSize = portrait
    ? Math.round(input.width * 0.066)
    : Math.round(input.width * 0.056);
  const minimumFontSize = compactLandscape
    ? Math.round(input.width * 0.034)
    : Math.round(baseFontSize * 0.72);
  const fallback = buildContentTextLayout({
    ...input,
    baseFontSize,
    fontSize: minimumFontSize,
  });

  for (let fontSize = baseFontSize; fontSize >= minimumFontSize; fontSize -= 2) {
    const layout = buildContentTextLayout({ ...input, baseFontSize, fontSize });
    if (!layout.truncated && !layout.horizontalOverflow && !layout.verticalOverflow) {
      return layout;
    }
  }

  return fallback;
}

export function renderBrandedContentSvg(input: ContentAssetInput): string {
  const templateId = isContentGraphicTemplateId(input.templateId)
    ? input.templateId
    : "carousel-content";
  const template = getContentGraphicTemplate(templateId);
  const layout = resolveContentTextLayout({
    content: input.content,
    width: input.width,
    height: input.height,
    hasTitle: Boolean(input.title.trim()),
  });
  const { baseFontSize, compactLandscape, eyebrowY, fontSize, lineHeight, lines, padding, startY } = layout;
  const titleY = template.surface === "MINIMAL" && !compactLandscape
    ? Math.round(input.height * 0.27)
    : layout.titleY;
  const title = escapeXml(input.title.toUpperCase());
  const eyebrow = escapeXml(template.eyebrow);
  const church = escapeXml(input.branding.churchName);
  const scripture = input.scripture ? escapeXml(input.scripture) : "";
  const family = escapeXml(input.branding.fontFamily);
  const textAnchor = template.alignment === "CENTER" ? "middle" : "start";
  const contentX = template.alignment === "CENTER" ? Math.round(input.width / 2) : Math.round(padding * 1.45);
  const titleFontSize = Math.round(baseFontSize * (template.surface === "BOLD" ? 0.82 : 0.64));
  const panel = template.surface === "MINIMAL"
    ? `<circle cx="${Math.round(input.width * 0.82)}" cy="${Math.round(input.height * 0.14)}" r="${Math.round(input.width * 0.2)}" fill="#fff" fill-opacity="0.08"/>`
    : template.surface === "BOLD"
      ? `<path d="M0 ${Math.round(input.height * 0.72)} L${input.width} ${Math.round(input.height * 0.55)} V${input.height} H0 Z" fill="#000" fill-opacity="0.2"/>`
      : `<rect x="${padding}" y="${padding}" width="${input.width - padding * 2}" height="${input.height - padding * 2}" rx="28" fill="#000" fill-opacity="${template.surface === "PANEL" ? "0.2" : "0.12"}" stroke="#fff" stroke-opacity="0.22"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${input.branding.primaryColor}"/><stop offset="1" stop-color="${input.branding.secondaryColor}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${panel}
  <text x="${contentX}" y="${eyebrowY}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.78" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.33)}" font-weight="800" letter-spacing="3">${eyebrow}</text>
  ${template.showQuoteMark && !compactLandscape ? `<text x="${contentX}" y="${Math.round(input.height * 0.27)}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.24" font-family="Georgia, serif" font-size="${Math.round(baseFontSize * 2.5)}">“</text>` : ""}
  ${title ? `<text x="${contentX}" y="${titleY}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.92" font-family="${family}, sans-serif" font-size="${titleFontSize}" font-weight="800">${title}</text>` : ""}
  <text x="${contentX}" y="${startY}" text-anchor="${textAnchor}" fill="#fff" font-family="${family}, sans-serif" font-size="${fontSize}" font-weight="700">
    ${lines.map((line, index) => `<tspan x="${contentX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  ${scripture ? `<text x="${contentX}" y="${input.height - padding * 1.75}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.88" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.45)}">${scripture}</text>` : ""}
  <text x="${input.width - padding * 1.45}" y="${input.height - padding * 0.9}" text-anchor="end" fill="#fff" fill-opacity="0.7" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.35)}">${church}</text>
</svg>`;
}

export function splitCarouselSlides(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  const matches = normalized.split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i).map((item) => item.trim()).filter(Boolean);
  if (matches.length > 1) return matches.slice(0, 10);
  return normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

export const __contentAssetRendererTestUtils = { escapeXml };
