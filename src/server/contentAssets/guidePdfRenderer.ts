import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

export type GuidePdfRenderInput = {
  churchName: string;
  primaryColor: string;
  secondaryColor: string;
  title: string;
  subtitle: string;
  scripture: string;
  bodyContent: string;
};

type GuideBlockKind = "h2" | "h3" | "bullet" | "body";

type GuideBlock = {
  kind: GuideBlockKind;
  text: string;
};

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const PAGE_MARGIN = 52;
const HEADER_HEIGHT = 46;
const FOOTER_HEIGHT = 46;
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);

function colorFromHex(value: string, fallback: string): RGB {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return rgb(
    Number.parseInt(normalized.slice(1, 3), 16) / 255,
    Number.parseInt(normalized.slice(3, 5), 16) / 255,
    Number.parseInt(normalized.slice(5, 7), 16) / 255,
  );
}

function tint(color: RGB, amount: number): RGB {
  return rgb(
    color.red + ((1 - color.red) * amount),
    color.green + ((1 - color.green) * amount),
    color.blue + ((1 - color.blue) * amount),
  );
}

function textSupportedByFont(font: PDFFont, value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");

  return Array.from(normalized, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    const candidate = `${chunk}${character}`;
    if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safeValue = textSupportedByFont(font, value).trim();
  if (!safeValue) return [];

  const words = safeValue.split(/\s+/).flatMap((word) => (
    font.widthOfTextAtSize(word, size) > maxWidth
      ? splitLongWord(word, font, size, maxWidth)
      : [word]
  ));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function guideBlocks(body: string): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  for (const rawBlock of body.replace(/\r/g, "").split(/\n{2,}/)) {
    for (const rawLine of rawBlock.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("### ")) {
        blocks.push({ kind: "h3", text: line.slice(4).trim() });
      } else if (line.startsWith("## ")) {
        blocks.push({ kind: "h2", text: line.slice(3).trim() });
      } else if (line.startsWith("# ")) {
        blocks.push({ kind: "h2", text: line.slice(2).trim() });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        blocks.push({ kind: "bullet", text: line.slice(2).trim() });
      } else if (line.length < 90 && (line.toLowerCase().startsWith("day ") || line.endsWith(":"))) {
        blocks.push({ kind: "h3", text: line.replace(/:$/, "") });
      } else {
        blocks.push({ kind: "body", text: line });
      }
    }
  }
  return blocks;
}

export async function renderContentGuidePdf(input: GuidePdfRenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const primary = colorFromHex(input.primaryColor, "#0F766E");
  const secondary = colorFromHex(input.secondaryColor, "#1D4ED8");
  const bodyColor = colorFromHex("#263238", "#263238");
  const mutedColor = colorFromHex("#607D8B", "#607D8B");
  const churchName = textSupportedByFont(bold, input.churchName || "Local Church");

  pdf.setTitle(textSupportedByFont(regular, input.title || "Sermon Guide"));
  pdf.setAuthor(churchName);
  pdf.setSubject("Sermon-grounded ministry guide");
  pdf.setCreator("Sermon Clip");

  let page!: PDFPage;
  let cursorY = 0;
  let pageNumber = 0;

  const drawFrame = (target: PDFPage, number: number) => {
    target.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: primary });
    target.drawText(churchName.slice(0, 90), {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - 29,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    target.drawLine({
      start: { x: PAGE_MARGIN, y: 40 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 40 },
      thickness: 0.7,
      color: colorFromHex("#DDE5E7", "#DDE5E7"),
    });
    target.drawText("Sermon Clip ministry resource", {
      x: PAGE_MARGIN,
      y: 25,
      size: 8,
      font: regular,
      color: mutedColor,
    });
    const pageLabel = `Page ${number}`;
    target.drawText(pageLabel, {
      x: PAGE_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(pageLabel, 8),
      y: 25,
      size: 8,
      font: regular,
      color: mutedColor,
    });
  };

  const addPage = () => {
    page = pdf.addPage(PageSizes.A4);
    pageNumber += 1;
    drawFrame(page, pageNumber);
    cursorY = PAGE_HEIGHT - HEADER_HEIGHT - 24;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < FOOTER_HEIGHT) addPage();
  };

  const drawBlock = (value: string, options: {
    font: PDFFont;
    size: number;
    leading: number;
    color: RGB;
    indent?: number;
    prefix?: string;
    spaceBefore?: number;
    spaceAfter?: number;
    keepWithNext?: boolean;
  }) => {
    const indent = options.indent ?? 0;
    const prefix = options.prefix ?? "";
    const prefixWidth = prefix ? options.font.widthOfTextAtSize(prefix, options.size) : 0;
    const lines = wrapText(value, options.font, options.size, CONTENT_WIDTH - indent - prefixWidth);
    const blockHeight = (options.spaceBefore ?? 0)
      + (lines.length * options.leading)
      + (options.spaceAfter ?? 0)
      + (options.keepWithNext ? 22 : 0);
    if (blockHeight <= PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT) ensureSpace(blockHeight);
    cursorY -= options.spaceBefore ?? 0;

    lines.forEach((line, index) => {
      ensureSpace(options.leading);
      const linePrefix = index === 0 ? prefix : "";
      page.drawText(`${linePrefix}${line}`, {
        x: PAGE_MARGIN + indent,
        y: cursorY - options.size,
        size: options.size,
        font: options.font,
        color: options.color,
      });
      cursorY -= options.leading;
    });
    cursorY -= options.spaceAfter ?? 0;
  };

  addPage();

  const title = input.title || "Sermon Guide";
  const subtitle = input.subtitle || "A sermon-grounded ministry resource";
  const titleLines = wrapText(title, bold, 26, CONTENT_WIDTH - 46);
  const subtitleLines = wrapText(subtitle, regular, 11, CONTENT_WIDTH - 46);
  const coverHeight = Math.max(116, 32 + (titleLines.length * 31) + (subtitleLines.length * 16));
  ensureSpace(coverHeight + 18);
  const coverBottom = cursorY - coverHeight;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: coverBottom,
    width: CONTENT_WIDTH,
    height: coverHeight,
    color: primary,
  });
  let coverY = cursorY - 34;
  for (const line of titleLines) {
    page.drawText(line, { x: PAGE_MARGIN + 23, y: coverY, size: 26, font: bold, color: rgb(1, 1, 1) });
    coverY -= 31;
  }
  coverY -= 4;
  for (const line of subtitleLines) {
    page.drawText(line, { x: PAGE_MARGIN + 23, y: coverY, size: 11, font: regular, color: tint(primary, 0.86) });
    coverY -= 16;
  }
  cursorY = coverBottom - 18;

  if (input.scripture.trim()) {
    const scriptureText = `Main Scripture: ${input.scripture.trim()}`;
    const scriptureLines = wrapText(scriptureText, italic, 10.5, CONTENT_WIDTH - 24);
    const scriptureHeight = Math.max(42, 20 + (scriptureLines.length * 15));
    ensureSpace(scriptureHeight + 14);
    const scriptureBottom = cursorY - scriptureHeight;
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: scriptureBottom,
      width: CONTENT_WIDTH,
      height: scriptureHeight,
      color: tint(primary, 0.92),
      borderColor: tint(primary, 0.72),
      borderWidth: 0.8,
    });
    let scriptureY = cursorY - 22;
    for (const line of scriptureLines) {
      page.drawText(line, { x: PAGE_MARGIN + 12, y: scriptureY, size: 10.5, font: italic, color: primary });
      scriptureY -= 15;
    }
    cursorY = scriptureBottom - 14;
  }

  const blocks = guideBlocks(input.bodyContent);
  if (blocks.length === 0) {
    drawBlock("No approved guide content was provided.", {
      font: regular,
      size: 10.5,
      leading: 16,
      color: bodyColor,
      spaceAfter: 7,
    });
  } else {
    for (const block of blocks) {
      if (block.kind === "h2") {
        drawBlock(block.text, {
          font: bold,
          size: 17,
          leading: 22,
          color: primary,
          spaceBefore: 10,
          spaceAfter: 7,
          keepWithNext: true,
        });
      } else if (block.kind === "h3") {
        drawBlock(block.text, {
          font: bold,
          size: 13,
          leading: 18,
          color: secondary,
          spaceBefore: 8,
          spaceAfter: 5,
          keepWithNext: true,
        });
      } else if (block.kind === "bullet") {
        drawBlock(block.text, {
          font: regular,
          size: 10.5,
          leading: 16,
          color: bodyColor,
          indent: 10,
          prefix: "- ",
          spaceAfter: 5,
        });
      } else {
        drawBlock(block.text, {
          font: regular,
          size: 10.5,
          leading: 16,
          color: bodyColor,
          spaceAfter: 7,
        });
      }
    }
  }

  return pdf.save({ useObjectStreams: false });
}

export const __guidePdfRendererTestUtils = {
  guideBlocks,
  wrapText,
};
