import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  renderBrandedContentSvg,
  resolveContentTextLayout,
  splitCarouselSlides,
  type ContentAssetBranding,
} from "@/lib/contentAssetRenderer";
import {
  getContentGraphicTemplate,
  getDefaultTemplateId,
  type CarouselSlideRole,
  type CarouselStudioSlide,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";
import { getSharp } from "@/server/agents/sharpClient";
import { getSermonStoragePath } from "@/server/agents/storage";

export const NON_VIDEO_RASTER_FORMATS = {
  SQUARE: {
    width: 1080,
    height: 1080,
    fileName: "square.png",
    label: "Square",
  },
  PORTRAIT: {
    width: 1080,
    height: 1350,
    fileName: "portrait.png",
    label: "Portrait",
  },
  STORY: {
    width: 1080,
    height: 1920,
    fileName: "story.png",
    label: "Story",
  },
  FACEBOOK_LANDSCAPE: {
    width: 1200,
    height: 630,
    fileName: "facebook-landscape.png",
    label: "Facebook landscape",
  },
} as const;

export type NonVideoRasterVariant = keyof typeof NON_VIDEO_RASTER_FORMATS;
export type ApprovedContentStatus = "APPROVED" | "USED";

export type ApprovedNonVideoAssetInput = {
  sermonId: string;
  opportunityId: string;
  opportunityType: string;
  status: ApprovedContentStatus | string;
  title: string;
  approvedContent: string | null | undefined;
  sourceTranscriptExcerpt?: string | null;
  relatedScripture?: string | null;
  branding: ContentAssetBranding;
  templateId?: ContentGraphicTemplateId;
  carouselSlides?: CarouselStudioSlide[];
};

export type NonVideoAssetDiagnosticCode =
  | "CONTENT_NOT_APPROVED"
  | "APPROVED_CONTENT_MISSING"
  | "TITLE_MISSING"
  | "QUOTE_TRANSCRIPT_EVIDENCE_MISSING"
  | "INVALID_IDENTIFIER"
  | "INVALID_BRANDING"
  | "CONTENT_WILL_TRUNCATE"
  | "CONTENT_WILL_OVERFLOW"
  | "TITLE_MAY_OVERFLOW"
  | "SCRIPTURE_MAY_OVERFLOW"
  | "CAROUSEL_HAS_NO_SLIDES"
  | "CAROUSEL_SLIDE_LIMIT_EXCEEDED";

export type NonVideoAssetDiagnostic = {
  code: NonVideoAssetDiagnosticCode;
  severity: "ERROR" | "WARNING";
  blocking: boolean;
  message: string;
  variant?: NonVideoRasterVariant | "CAROUSEL_SLIDE";
  slideNumber?: number;
};

export type TextLayoutAnalysis = {
  lines: string[];
  maxCharactersPerLine: number;
  maxLines: number;
  truncated: boolean;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
};

export type PlannedNonVideoAssetFile = {
  variant: NonVideoRasterVariant | "CAROUSEL_SLIDE";
  name: string;
  width: number;
  height: number;
  order: number;
  content: string;
  title: string;
  scripture?: string | null;
  templateId: ContentGraphicTemplateId;
  slideId?: string;
  slideRole?: CarouselSlideRole;
  slideNumber?: number;
  slideCount?: number;
  layout: TextLayoutAnalysis;
};

export type NonVideoAssetPreflight = {
  ready: boolean;
  diagnostics: NonVideoAssetDiagnostic[];
  plannedFiles: PlannedNonVideoAssetFile[];
};

export type RenderedContentAssetFile = {
  path: string;
  name: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  size: number;
  order: number;
  metadata: {
    variant: NonVideoRasterVariant | "CAROUSEL_SLIDE";
    opportunityId: string;
    opportunityType: string;
    sourceStatus: ApprovedContentStatus;
    publishingFormat: "PNG" | "JPEG";
    slideNumber?: number;
    slideCount?: number;
    templateId: ContentGraphicTemplateId;
    slideId?: string;
    slideRole?: CarouselSlideRole;
  };
};

export type ContentAssetFilePersistenceInput = {
  fileName: string;
  mimeType: "image/png" | "image/jpeg";
  filePath: string;
  width: number;
  height: number;
  sizeBytes: bigint;
  sortOrder: number;
  metadataJson: RenderedContentAssetFile["metadata"];
};

export type RenderApprovedNonVideoAssetsOptions = {
  /** Override the deterministic sermon content-assets directory, primarily for tests. */
  outputRoot?: string;
  /** Use an isolated directory for this render attempt without changing opportunity metadata. */
  storageKey?: string;
  /** Defaults to all four social image variants for non-carousel content. */
  variants?: NonVideoRasterVariant[];
};

export type RenderApprovedNonVideoAssetsResult = {
  outputDirectory: string;
  files: RenderedContentAssetFile[];
  preflight: NonVideoAssetPreflight;
};

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX_COLOR = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const APPROVED_STATUSES = new Set(["APPROVED", "USED"]);
const DEFAULT_VARIANTS = Object.keys(NON_VIDEO_RASTER_FORMATS) as NonVideoRasterVariant[];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value.trim());
}

function isValidBranding(branding: ContentAssetBranding): boolean {
  return Boolean(
    branding.churchName.trim()
      && branding.fontFamily.trim()
      && HEX_COLOR.test(branding.primaryColor)
      && HEX_COLOR.test(branding.secondaryColor),
  );
}

function isCarousel(input: ApprovedNonVideoAssetInput): boolean {
  return input.opportunityType === "CAROUSEL_IDEA" || input.opportunityType === "CAROUSEL";
}

function splitAllCarouselSlides(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const labelled = normalized
    .split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i)
    .map((item) => item.trim())
    .filter(Boolean);
  if (labelled.length > 1) return labelled;

  return normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

export function analyzeNonVideoTextLayout(
  content: string,
  width: number,
  height: number,
  title = "Prepared content",
): TextLayoutAnalysis {
  return resolveContentTextLayout({
    content,
    width,
    height,
    hasTitle: Boolean(title.trim()),
  });
}

function estimateSingleLineCapacity(
  width: number,
  height: number,
  role: "title" | "scripture",
  titleScale = 0.64,
): number {
  const baseFontSize = resolveContentTextLayout({
    content: "Content",
    width,
    height,
    hasTitle: true,
  }).baseFontSize;
  const fontSize = baseFontSize * (role === "title" ? titleScale : 0.45);
  const padding = Math.round(width * 0.09);
  const usableWidth = width - padding * 2.9;
  return Math.max(1, Math.floor(usableWidth / (fontSize * 0.58)));
}

function buildPlannedFiles(
  input: ApprovedNonVideoAssetInput,
  variants: NonVideoRasterVariant[],
): PlannedNonVideoAssetFile[] {
  const content = input.approvedContent?.trim() ?? "";
  if (isCarousel(input)) {
    const slides = input.carouselSlides?.length
      ? input.carouselSlides.slice(0, 10)
      : splitCarouselSlides(content).map((body, index): CarouselStudioSlide => ({
          id: `slide-${index + 1}`,
          role: index === 0 ? "COVER" : "CONTENT",
          templateId: getDefaultTemplateId({ slideRole: index === 0 ? "COVER" : "CONTENT" }),
          title: `${input.title} · ${index + 1}`,
          body,
          scripture: input.relatedScripture ?? null,
        }));
    return slides.map((slide, index) => ({
      variant: "CAROUSEL_SLIDE" as const,
      name: `carousel/slide-${String(index + 1).padStart(2, "0")}.png`,
      width: 1080,
      height: 1350,
      order: index,
      content: slide.body,
      title: slide.title,
      scripture: slide.scripture ?? input.relatedScripture,
      templateId: slide.templateId,
      slideId: slide.id,
      slideRole: slide.role,
      slideNumber: index + 1,
      slideCount: slides.length,
      layout: analyzeNonVideoTextLayout(slide.body, 1080, 1350, slide.title),
    }));
  }

  return variants.map((variant, index) => {
    const format = NON_VIDEO_RASTER_FORMATS[variant];
    return {
      variant,
      name: format.fileName,
      width: format.width,
      height: format.height,
      order: index,
      content,
      title: input.title,
      scripture: input.relatedScripture,
      templateId: input.templateId ?? getDefaultTemplateId({ assetType: input.opportunityType }),
      layout: analyzeNonVideoTextLayout(content, format.width, format.height, input.title),
    };
  });
}

function pushLayoutDiagnostics(
  diagnostics: NonVideoAssetDiagnostic[],
  input: ApprovedNonVideoAssetInput,
  planned: PlannedNonVideoAssetFile,
): void {
  const location = planned.slideNumber ? `Carousel slide ${planned.slideNumber}` : NON_VIDEO_RASTER_FORMATS[planned.variant as NonVideoRasterVariant].label;
  if (planned.layout.truncated) {
    diagnostics.push({
      code: "CONTENT_WILL_TRUNCATE",
      severity: "ERROR",
      blocking: true,
      message: `${location} content exceeds ${planned.layout.maxLines} lines and would be truncated. Shorten the approved copy before rendering.`,
      variant: planned.variant,
      slideNumber: planned.slideNumber,
    });
  }

  if (planned.layout.horizontalOverflow || planned.layout.verticalOverflow) {
    const directions = [
      planned.layout.horizontalOverflow ? "horizontally" : null,
      planned.layout.verticalOverflow ? "vertically" : null,
    ].filter(Boolean).join(" and ");
    diagnostics.push({
      code: "CONTENT_WILL_OVERFLOW",
      severity: "ERROR",
      blocking: true,
      message: `${location} content would overflow ${directions}. Shorten the approved copy before rendering.`,
      variant: planned.variant,
      slideNumber: planned.slideNumber,
    });
  }

  const template = getContentGraphicTemplate(planned.templateId);
  const titleCapacity = estimateSingleLineCapacity(
    planned.width,
    planned.height,
    "title",
    template.surface === "BOLD" ? 0.82 : 0.64,
  );
  if (normalizeText(planned.title).length > titleCapacity) {
    diagnostics.push({
      code: "TITLE_MAY_OVERFLOW",
      severity: "ERROR",
      blocking: true,
      message: `${location} title may overflow its safe area (approximately ${titleCapacity} characters available).`,
      variant: planned.variant,
      slideNumber: planned.slideNumber,
    });
  }

  const scripture = normalizeText(planned.scripture ?? input.relatedScripture ?? "");
  const scriptureCapacity = estimateSingleLineCapacity(planned.width, planned.height, "scripture");
  if (scripture.length > scriptureCapacity) {
    diagnostics.push({
      code: "SCRIPTURE_MAY_OVERFLOW",
      severity: "ERROR",
      blocking: true,
      message: `${location} Scripture reference may overflow its safe area (approximately ${scriptureCapacity} characters available).`,
      variant: planned.variant,
      slideNumber: planned.slideNumber,
    });
  }
}

export function preflightApprovedNonVideoAssets(
  input: ApprovedNonVideoAssetInput,
  options: Pick<RenderApprovedNonVideoAssetsOptions, "variants"> = {},
): NonVideoAssetPreflight {
  const diagnostics: NonVideoAssetDiagnostic[] = [];
  const variants = options.variants?.length ? Array.from(new Set(options.variants)) : DEFAULT_VARIANTS;

  if (!APPROVED_STATUSES.has(input.status)) {
    diagnostics.push({
      code: "CONTENT_NOT_APPROVED",
      severity: "ERROR",
      blocking: true,
      message: "Only approved content can be rendered into publishing assets.",
    });
  }

  if (!input.approvedContent?.trim()) {
    diagnostics.push({
      code: "APPROVED_CONTENT_MISSING",
      severity: "ERROR",
      blocking: true,
      message: "Approved content is missing. Approve the final copy before rendering.",
    });
  }

  if (!input.title.trim()) {
    diagnostics.push({
      code: "TITLE_MISSING",
      severity: "ERROR",
      blocking: true,
      message: "A title is required before content can be rendered.",
    });
  }

  if (input.opportunityType === "QUOTE_GRAPHIC" && !input.sourceTranscriptExcerpt?.trim()) {
    diagnostics.push({
      code: "QUOTE_TRANSCRIPT_EVIDENCE_MISSING",
      severity: "ERROR",
      blocking: true,
      message: "A quote graphic requires transcript evidence before it can be rendered.",
    });
  }

  if (!isSafePathSegment(input.sermonId) || !isSafePathSegment(input.opportunityId)) {
    diagnostics.push({
      code: "INVALID_IDENTIFIER",
      severity: "ERROR",
      blocking: true,
      message: "Sermon and content opportunity IDs must be safe storage path segments.",
    });
  }

  if (!isValidBranding(input.branding)) {
    diagnostics.push({
      code: "INVALID_BRANDING",
      severity: "ERROR",
      blocking: true,
      message: "Church name, font, and valid hex brand colours are required.",
    });
  }

  const plannedFiles = input.approvedContent?.trim()
    ? buildPlannedFiles(input, variants)
    : [];

  if (isCarousel(input)) {
    const allSlides = splitAllCarouselSlides(input.approvedContent ?? "");
    if (plannedFiles.length === 0) {
      diagnostics.push({
        code: "CAROUSEL_HAS_NO_SLIDES",
        severity: "ERROR",
        blocking: true,
        message: "The approved carousel copy does not contain any slides.",
      });
    }
    if (allSlides.length > 10) {
      diagnostics.push({
        code: "CAROUSEL_SLIDE_LIMIT_EXCEEDED",
        severity: "ERROR",
        blocking: true,
        message: `The carousel has ${allSlides.length} slides; a maximum of 10 can be rendered.`,
        variant: "CAROUSEL_SLIDE",
      });
    }
  }

  for (const planned of plannedFiles) {
    pushLayoutDiagnostics(diagnostics, input, planned);
  }

  return {
    ready: diagnostics.every((diagnostic) => !diagnostic.blocking),
    diagnostics,
    plannedFiles,
  };
}

export function getNonVideoAssetOutputDirectory(
  sermonId: string,
  opportunityId: string,
  outputRoot?: string,
  storageKey = opportunityId,
): string {
  if (!isSafePathSegment(sermonId) || !isSafePathSegment(opportunityId) || !isSafePathSegment(storageKey)) {
    throw new Error("Invalid sermon or content opportunity ID for asset storage.");
  }

  const contentAssetsRoot = outputRoot
    ? path.resolve(outputRoot)
    : path.join(getSermonStoragePath(sermonId), "content-assets");
  return path.join(contentAssetsRoot, storageKey);
}

/** Maps renderer output directly into a nested ContentAssetFile create payload. */
export function toContentAssetFilePersistenceInput(
  file: RenderedContentAssetFile,
): ContentAssetFilePersistenceInput {
  return {
    fileName: file.name,
    mimeType: file.mime,
    filePath: file.path,
    width: file.width,
    height: file.height,
    sizeBytes: BigInt(file.size),
    sortOrder: file.order,
    metadataJson: file.metadata,
  };
}

export async function renderApprovedNonVideoAssets(
  input: ApprovedNonVideoAssetInput,
  options: RenderApprovedNonVideoAssetsOptions = {},
): Promise<RenderApprovedNonVideoAssetsResult> {
  const preflight = preflightApprovedNonVideoAssets(input, options);
  if (!preflight.ready) {
    const reasons = preflight.diagnostics
      .filter((diagnostic) => diagnostic.blocking)
      .map((diagnostic) => diagnostic.message)
      .join(" ");
    throw new Error(`Non-video asset preflight failed. ${reasons}`);
  }

  const outputDirectory = getNonVideoAssetOutputDirectory(
    input.sermonId,
    input.opportunityId,
    options.outputRoot,
    options.storageKey,
  );
  const sharp = await getSharp();
  const files: RenderedContentAssetFile[] = [];

  for (const planned of preflight.plannedFiles) {
    const outputPath = path.join(outputDirectory, planned.name);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const svg = renderBrandedContentSvg({
      title: planned.title,
      content: planned.content,
      scripture: planned.scripture ?? input.relatedScripture,
      branding: input.branding,
      width: planned.width,
      height: planned.height,
      templateId: planned.templateId,
    });
    const info = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);

    files.push({
      path: outputPath,
      name: path.basename(planned.name),
      mime: "image/png",
      width: info.width,
      height: info.height,
      size: info.size,
      order: planned.order,
      metadata: {
        variant: planned.variant,
        opportunityId: input.opportunityId,
        opportunityType: input.opportunityType,
        sourceStatus: input.status as ApprovedContentStatus,
        publishingFormat: "PNG",
        ...(planned.slideNumber ? { slideNumber: planned.slideNumber } : {}),
        ...(planned.slideCount ? { slideCount: planned.slideCount } : {}),
        templateId: planned.templateId,
        ...(planned.slideId ? { slideId: planned.slideId } : {}),
        ...(planned.slideRole ? { slideRole: planned.slideRole } : {}),
      },
    });
  }

  for (const planned of preflight.plannedFiles) {
    const jpegName = planned.name.replace(/\.png$/i, ".jpg");
    const outputPath = path.join(outputDirectory, jpegName);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const svg = renderBrandedContentSvg({
      title: planned.title,
      content: planned.content,
      scripture: planned.scripture ?? input.relatedScripture,
      branding: input.branding,
      width: planned.width,
      height: planned.height,
      templateId: planned.templateId,
    });
    const info = await sharp(Buffer.from(svg))
      .flatten({ background: input.branding.primaryColor })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(outputPath);

    files.push({
      path: outputPath,
      name: path.basename(jpegName),
      mime: "image/jpeg",
      width: info.width,
      height: info.height,
      size: info.size,
      order: preflight.plannedFiles.length + planned.order,
      metadata: {
        variant: planned.variant,
        opportunityId: input.opportunityId,
        opportunityType: input.opportunityType,
        sourceStatus: input.status as ApprovedContentStatus,
        publishingFormat: "JPEG",
        ...(planned.slideNumber ? { slideNumber: planned.slideNumber } : {}),
        ...(planned.slideCount ? { slideCount: planned.slideCount } : {}),
        templateId: planned.templateId,
        ...(planned.slideId ? { slideId: planned.slideId } : {}),
        ...(planned.slideRole ? { slideRole: planned.slideRole } : {}),
      },
    });
  }

  return { outputDirectory, files, preflight };
}
