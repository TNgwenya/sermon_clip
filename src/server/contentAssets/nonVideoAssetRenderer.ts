import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  getContentArtworkBackground,
  normalizeContentArtworkSettings,
  normalizeContentArtworkTextOverrides,
  type ContentArtworkSettings,
  type ContentArtworkTextOverrides,
} from "@/lib/contentArtworkDesign";
import {
  renderBrandedContentSvg,
  resolveContentArtworkTextMetrics,
  splitCarouselSlides,
  type ContentAssetBranding,
  type ContentSafeArea,
} from "@/lib/contentAssetRenderer";
import {
  getDefaultTemplateId,
  type CarouselSlideRole,
  type CarouselStudioSlide,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";
import {
  detectProductionCopyIssues,
  extractQuoteTextFromContent,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
} from "@/lib/contentIntegrity";
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
  scriptureTranslation?: string | null;
  scriptureAccuracyConfirmed?: boolean;
  branding: ContentAssetBranding;
  templateId?: ContentGraphicTemplateId;
  artwork?: ContentArtworkSettings | Partial<ContentArtworkSettings> | null;
  textOverrides?: ContentArtworkTextOverrides | Partial<ContentArtworkTextOverrides> | null;
  carouselSlides?: CarouselStudioSlide[];
};

export type NonVideoAssetDiagnosticCode =
  | "CONTENT_NOT_APPROVED"
  | "APPROVED_CONTENT_MISSING"
  | "TITLE_MISSING"
  | "QUOTE_TRANSCRIPT_EVIDENCE_MISSING"
  | "QUOTE_TRANSCRIPT_MISMATCH"
  | "SCRIPTURE_REFERENCE_INVALID"
  | "SCRIPTURE_ACCURACY_UNCONFIRMED"
  | "PRODUCTION_COPY_UNSAFE"
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
  baseFontSize: number;
  fontSize: number;
  lineHeight: number;
  startY: number;
  safeBottom: number;
  referenceY: number;
  brandY: number;
  safeArea: ContentSafeArea;
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
  textOverrides?: ContentArtworkTextOverrides;
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
    artworkVersion?: 1;
    backgroundId?: ContentArtworkSettings["backgroundId"];
    paletteId?: ContentArtworkSettings["paletteId"];
    typographyPresetId?: ContentArtworkSettings["typographyPresetId"];
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

export function resolveRenderedScriptureReference(input: {
  relatedScripture?: string | null;
  scriptureTranslation?: string | null;
}): string | null {
  const reference = input.relatedScripture?.trim();
  if (!reference) return null;
  const translation = input.scriptureTranslation?.trim().replace(/^\((.+)\)$/u, "$1").toUpperCase();
  if (!translation) return reference;

  const validated = validateScriptureReference(reference);
  const normalizedReference = validated.normalizedReference
    ?? reference.replace(/\s*(?:\([A-Za-z][A-Za-z0-9-]{1,14}\)|[A-Z][A-Z0-9-]{1,14})\s*$/u, "").trim();
  return `${normalizedReference} ${translation}`;
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
  reference?: string | null,
  artwork?: ContentArtworkSettings | Partial<ContentArtworkSettings> | null,
  templateId?: ContentGraphicTemplateId,
  hasLogo = false,
): TextLayoutAnalysis {
  return resolveContentArtworkTextMetrics({
    content,
    title,
    reference,
    width,
    height,
    templateId,
    artwork,
    hasLogo,
  }).layout;
}

function buildPlannedFiles(
  input: ApprovedNonVideoAssetInput,
  variants: NonVideoRasterVariant[],
): PlannedNonVideoAssetFile[] {
  const content = input.approvedContent?.trim() ?? "";
  const globalTextOverrides = input.textOverrides == null
    ? undefined
    : normalizeContentArtworkTextOverrides(input.textOverrides);
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
      scripture: slide.scripture,
      templateId: slide.templateId,
      textOverrides: slide.textOverrides == null
        ? globalTextOverrides
        : normalizeContentArtworkTextOverrides(slide.textOverrides),
      slideId: slide.id,
      slideRole: slide.role,
      slideNumber: index + 1,
      slideCount: slides.length,
      layout: analyzeNonVideoTextLayout(
        slide.body,
        1080,
        1350,
        slide.title,
        slide.scripture,
        input.artwork,
        slide.templateId,
        Boolean(input.branding.logoDataUrl),
      ),
    }));
  }

  return variants.map((variant, index) => {
    const format = NON_VIDEO_RASTER_FORMATS[variant];
    const renderedScripture = resolveRenderedScriptureReference(input);
    return {
      variant,
      name: format.fileName,
      width: format.width,
      height: format.height,
      order: index,
      content,
      title: input.title,
      scripture: renderedScripture,
      templateId: input.templateId ?? getDefaultTemplateId({ assetType: input.opportunityType }),
      textOverrides: globalTextOverrides,
      layout: analyzeNonVideoTextLayout(
        content,
        format.width,
        format.height,
        input.title,
        renderedScripture,
        input.artwork,
        input.templateId ?? getDefaultTemplateId({ assetType: input.opportunityType }),
        Boolean(input.branding.logoDataUrl),
      ),
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

  const metrics = resolveContentArtworkTextMetrics({
    content: planned.content,
    title: planned.title,
    reference: planned.scripture,
    width: planned.width,
    height: planned.height,
    templateId: planned.templateId,
    artwork: input.artwork,
    hasLogo: Boolean(input.branding.logoDataUrl),
  });
  if (metrics.title.exceedsCapacity) {
    diagnostics.push({
      code: "TITLE_MAY_OVERFLOW",
      severity: "ERROR",
      blocking: true,
      message: `${location} title may overflow its safe area (approximately ${metrics.title.capacity} characters available).`,
      variant: planned.variant,
      slideNumber: planned.slideNumber,
    });
  }

  const scripture = normalizeText(
    planned.variant === "CAROUSEL_SLIDE"
      ? planned.scripture ?? ""
      : planned.scripture ?? input.relatedScripture ?? "",
  );
  if (scripture && metrics.reference.exceedsCapacity) {
    diagnostics.push({
      code: "SCRIPTURE_MAY_OVERFLOW",
      severity: "ERROR",
      blocking: true,
      message: `${location} Scripture reference may overflow its safe area (approximately ${metrics.reference.capacity} characters available).`,
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

  if (
    input.opportunityType === "QUOTE_GRAPHIC"
    && input.approvedContent?.trim()
    && input.sourceTranscriptExcerpt?.trim()
  ) {
    const quoteIntegrity = verifyQuoteTextAgainstTranscript({
      quoteText: extractQuoteTextFromContent(input.approvedContent),
      sourceTranscriptExcerpt: input.sourceTranscriptExcerpt,
    });
    if (!quoteIntegrity.verified) {
      diagnostics.push({
        code: "QUOTE_TRANSCRIPT_MISMATCH",
        severity: "ERROR",
        blocking: true,
        message: quoteIntegrity.message,
      });
    }
  }

  if (input.opportunityType === "SCRIPTURE_GRAPHIC") {
    const renderedReference = resolveRenderedScriptureReference(input);
    const scripture = validateScriptureReference(renderedReference);
    if (!scripture.valid || scripture.versionStatus !== "RECOGNIZED") {
      diagnostics.push({
        code: "SCRIPTURE_REFERENCE_INVALID",
        severity: "ERROR",
        blocking: true,
        message: scripture.errors[0]
          ?? (scripture.versionStatus === "MISSING"
            ? "Add a recognized Bible translation/version, for example NIV, NLT, ESV, or KJV."
            : "Use a valid Bible reference and recognized translation/version label."),
      });
    }
    if (input.scriptureAccuracyConfirmed !== true) {
      diagnostics.push({
        code: "SCRIPTURE_ACCURACY_UNCONFIRMED",
        severity: "ERROR",
        blocking: true,
        message: "Confirm that the verse wording and reference match the displayed Bible translation before rendering.",
      });
    }
  }

  if (
    (input.opportunityType === "QUOTE_GRAPHIC" || input.opportunityType === "SCRIPTURE_GRAPHIC")
    && input.approvedContent?.trim()
    && detectProductionCopyIssues({ artworkText: input.approvedContent }).length > 0
  ) {
    diagnostics.push({
      code: "PRODUCTION_COPY_UNSAFE",
      severity: "ERROR",
      blocking: true,
      message: "Remove internal production instructions or placeholders from the artwork before rendering.",
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

async function resolveBuiltInArtworkBackgroundDataUrl(
  artwork: ContentArtworkSettings | null,
): Promise<string | null> {
  if (!artwork) return null;
  const background = getContentArtworkBackground(artwork.backgroundId);
  if (background.kind !== "IMAGE" || !background.imagePath?.startsWith("/artwork-backgrounds/")) {
    return null;
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const resolvedPath = path.resolve(publicRoot, background.imagePath.slice(1));
  if (!resolvedPath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error("The selected artwork background is outside the public artwork library.");
  }
  const bytes = await readFile(resolvedPath);
  if (bytes.byteLength > 8_000_000) {
    throw new Error("The selected artwork background exceeds the production renderer limit.");
  }
  const mime = resolvedPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
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
  const baseArtwork = input.artwork
    ? normalizeContentArtworkSettings(input.artwork, input.templateId)
    : null;
  const backgroundImageHref = await resolveBuiltInArtworkBackgroundDataUrl(baseArtwork);

  for (const planned of preflight.plannedFiles) {
    const outputPath = path.join(outputDirectory, planned.name);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const svg = renderBrandedContentSvg({
      title: planned.title,
      content: planned.content,
      scripture: planned.variant === "CAROUSEL_SLIDE"
        ? planned.scripture
        : planned.scripture ?? input.relatedScripture,
      branding: input.branding,
      width: planned.width,
      height: planned.height,
      templateId: planned.templateId,
      artwork: input.artwork
        ? normalizeContentArtworkSettings(input.artwork, planned.templateId)
        : undefined,
      textOverrides: planned.textOverrides,
      backgroundImageHref,
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
        ...(baseArtwork
          ? {
              artworkVersion: baseArtwork.version,
              backgroundId: baseArtwork.backgroundId,
              paletteId: baseArtwork.paletteId,
              typographyPresetId: baseArtwork.typographyPresetId,
            }
          : {}),
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
      scripture: planned.variant === "CAROUSEL_SLIDE"
        ? planned.scripture
        : planned.scripture ?? input.relatedScripture,
      branding: input.branding,
      width: planned.width,
      height: planned.height,
      templateId: planned.templateId,
      artwork: input.artwork
        ? normalizeContentArtworkSettings(input.artwork, planned.templateId)
        : undefined,
      textOverrides: planned.textOverrides,
      backgroundImageHref,
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
        ...(baseArtwork
          ? {
              artworkVersion: baseArtwork.version,
              backgroundId: baseArtwork.backgroundId,
              paletteId: baseArtwork.paletteId,
              typographyPresetId: baseArtwork.typographyPresetId,
            }
          : {}),
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
