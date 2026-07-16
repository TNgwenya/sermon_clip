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

export function renderBrandedContentSvg(input: ContentAssetInput): string {
  const templateId = isContentGraphicTemplateId(input.templateId)
    ? input.templateId
    : "carousel-content";
  const template = getContentGraphicTemplate(templateId);
  const portrait = input.height > input.width;
  const padding = Math.round(input.width * 0.09);
  const fontSize = portrait ? Math.round(input.width * 0.066) : Math.round(input.width * 0.056);
  const lineHeight = Math.round(fontSize * 1.25);
  const maxLines = portrait ? 10 : 7;
  const lines = wrapContentText(input.content, portrait ? 27 : 34, maxLines);
  const contentHeight = lines.length * lineHeight;
  const titleY = template.surface === "MINIMAL" ? Math.round(input.height * 0.27) : Math.round(input.height * 0.25);
  const contentAreaTop = input.title.trim() ? Math.round(input.height * 0.37) : Math.round(input.height * 0.3);
  const startY = Math.max(contentAreaTop, Math.round((input.height - contentHeight) / 2));
  const title = escapeXml(input.title.toUpperCase());
  const eyebrow = escapeXml(template.eyebrow);
  const church = escapeXml(input.branding.churchName);
  const scripture = input.scripture ? escapeXml(input.scripture) : "";
  const family = escapeXml(input.branding.fontFamily);
  const textAnchor = template.alignment === "CENTER" ? "middle" : "start";
  const contentX = template.alignment === "CENTER" ? Math.round(input.width / 2) : Math.round(padding * 1.45);
  const titleFontSize = Math.round(fontSize * (template.surface === "BOLD" ? 0.82 : 0.64));
  const panel = template.surface === "MINIMAL"
    ? `<circle cx="${Math.round(input.width * 0.82)}" cy="${Math.round(input.height * 0.14)}" r="${Math.round(input.width * 0.2)}" fill="#fff" fill-opacity="0.08"/>`
    : template.surface === "BOLD"
      ? `<path d="M0 ${Math.round(input.height * 0.72)} L${input.width} ${Math.round(input.height * 0.55)} V${input.height} H0 Z" fill="#000" fill-opacity="0.2"/>`
      : `<rect x="${padding}" y="${padding}" width="${input.width - padding * 2}" height="${input.height - padding * 2}" rx="28" fill="#000" fill-opacity="${template.surface === "PANEL" ? "0.2" : "0.12"}" stroke="#fff" stroke-opacity="0.22"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${input.branding.primaryColor}"/><stop offset="1" stop-color="${input.branding.secondaryColor}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${panel}
  <text x="${contentX}" y="${padding * 1.48}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.78" font-family="${family}, sans-serif" font-size="${Math.round(fontSize * 0.33)}" font-weight="800" letter-spacing="3">${eyebrow}</text>
  ${template.showQuoteMark ? `<text x="${contentX}" y="${Math.round(input.height * 0.27)}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.24" font-family="Georgia, serif" font-size="${Math.round(fontSize * 2.5)}">“</text>` : ""}
  ${title ? `<text x="${contentX}" y="${titleY}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.92" font-family="${family}, sans-serif" font-size="${titleFontSize}" font-weight="800">${title}</text>` : ""}
  <text x="${contentX}" y="${startY}" text-anchor="${textAnchor}" fill="#fff" font-family="${family}, sans-serif" font-size="${fontSize}" font-weight="700">
    ${lines.map((line, index) => `<tspan x="${contentX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  ${scripture ? `<text x="${contentX}" y="${input.height - padding * 1.75}" text-anchor="${textAnchor}" fill="#fff" fill-opacity="0.88" font-family="${family}, sans-serif" font-size="${Math.round(fontSize * 0.45)}">${scripture}</text>` : ""}
  <text x="${input.width - padding * 1.45}" y="${input.height - padding * 0.9}" text-anchor="end" fill="#fff" fill-opacity="0.7" font-family="${family}, sans-serif" font-size="${Math.round(fontSize * 0.35)}">${church}</text>
</svg>`;
}

export function splitCarouselSlides(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  const matches = normalized.split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i).map((item) => item.trim()).filter(Boolean);
  if (matches.length > 1) return matches.slice(0, 10);
  return normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

export const __contentAssetRendererTestUtils = { escapeXml };
