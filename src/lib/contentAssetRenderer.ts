import {
  getContentGraphicTemplate,
  isContentGraphicTemplateId,
  type ContentGraphicTemplate,
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

export function estimateContentSingleLineCapacity(input: {
  width: number;
  height: number;
  role: "title" | "scripture";
  titleScale?: number;
}): number {
  const baseFontSize = resolveContentTextLayout({
    content: "Content",
    width: input.width,
    height: input.height,
    hasTitle: true,
  }).baseFontSize;
  const fontSize = baseFontSize * (
    input.role === "title" ? input.titleScale ?? 0.64 : 0.45
  );
  const padding = Math.round(input.width * 0.09);
  const usableWidth = input.width - padding * 2.9;
  return Math.max(1, Math.floor(usableWidth / (fontSize * 0.58)));
}

function renderTemplateArtwork(input: {
  template: ContentGraphicTemplate;
  width: number;
  height: number;
  padding: number;
  secondaryColor: string;
}): string {
  const { template, width, height, padding, secondaryColor } = input;
  const frameRadius = Math.max(18, Math.round(width * 0.026));
  const insetWidth = width - padding * 2;
  const insetHeight = height - padding * 2;
  const commonBackground = `<rect width="${width}" height="${height}" fill="url(#brandBackground)"/>`;

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
  const primaryColor = escapeXml(input.branding.primaryColor);
  const secondaryColor = escapeXml(input.branding.secondaryColor);
  const textAnchor = template.alignment === "CENTER" ? "middle" : "start";
  const contentX = template.alignment === "CENTER" ? Math.round(input.width / 2) : Math.round(padding * 1.45);
  const brandX = template.alignment === "CENTER" ? Math.round(input.width / 2) : input.width - Math.round(padding * 1.45);
  const brandAnchor = template.alignment === "CENTER" ? "middle" : "end";
  const titleFontSize = Math.round(baseFontSize * (template.surface === "BOLD" ? 0.82 : 0.64));
  const bodyFamily = ["QUOTE", "SCRIPTURE", "PRAYER"].includes(template.role)
    ? `Georgia, ${family}, serif`
    : `${family}, sans-serif`;
  const bodyWeight = template.artDirection === "CELEBRATION" ? 750
    : template.artDirection === "EDITORIAL" ? 650
      : 560;
  const artwork = renderTemplateArtwork({
    template,
    width: input.width,
    height: input.height,
    padding,
    secondaryColor,
  });
  const accessibleLabel = escapeXml([input.title, input.content, input.scripture]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().replace(/[.!?]+$/, ""))
    .join(". "));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img" aria-label="${accessibleLabel}" data-template-id="${template.id}" data-design="${template.artDirection.toLowerCase()}">
  <defs>
    <linearGradient id="brandBackground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primaryColor}"/><stop offset="0.58" stop-color="${primaryColor}"/><stop offset="1" stop-color="${secondaryColor}"/></linearGradient>
    <radialGradient id="softGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="0.55" stop-color="${secondaryColor}" stop-opacity="0.13"/><stop offset="1" stop-color="${primaryColor}" stop-opacity="0"/></radialGradient>
    <pattern id="dotTexture" width="${Math.max(24, Math.round(input.width * 0.045))}" height="${Math.max(24, Math.round(input.width * 0.045))}" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" fill-opacity="0.16"/></pattern>
  </defs>
  ${artwork}
  <text x="${contentX}" y="${eyebrowY}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.78" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.33)}" font-weight="800" letter-spacing="3">${eyebrow}</text>
  ${template.showQuoteMark && !compactLandscape ? `<text x="${contentX}" y="${Math.round(input.height * 0.34)}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.15" font-family="Georgia, serif" font-size="${Math.round(baseFontSize * 3.7)}">“</text>` : ""}
  ${title ? `<text x="${contentX}" y="${titleY}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.92" font-family="${family}, sans-serif" font-size="${titleFontSize}" font-weight="800">${title}</text>` : ""}
  <text x="${contentX}" y="${startY}" text-anchor="${textAnchor}" fill="#fff" font-family="${bodyFamily}" font-size="${fontSize}" font-weight="${bodyWeight}" letter-spacing="0.15">
    ${lines.map((line, index) => `<tspan x="${contentX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  ${scripture ? `<text x="${contentX}" y="${input.height - padding * 1.75}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.88" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.45)}">${scripture}</text>` : ""}
  <text x="${brandX}" y="${input.height - padding * 0.82}" text-anchor="${brandAnchor}" fill="#fff" fill-opacity="0.72" font-family="${family}, sans-serif" font-size="${Math.round(baseFontSize * 0.35)}" font-weight="700" letter-spacing="0.6">${church}</text>
</svg>`;
}

export function splitCarouselSlides(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  const matches = normalized.split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i).map((item) => item.trim()).filter(Boolean);
  if (matches.length > 1) return matches.slice(0, 10);
  return normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

export const __contentAssetRendererTestUtils = { escapeXml };
