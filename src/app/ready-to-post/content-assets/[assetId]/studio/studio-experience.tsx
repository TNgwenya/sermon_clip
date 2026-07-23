"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";

import styles from "@/app/ready-to-post/content-assets/[assetId]/studio/studio.module.css";
import {
  buildArtworkRecommendations,
  CONTENT_ARTWORK_BACKGROUNDS,
  CONTENT_ARTWORK_PALETTES,
  CONTENT_ARTWORK_TYPOGRAPHY_PRESETS,
  createDefaultContentArtworkTextOverrides,
  createDefaultContentArtworkSettings,
  getContentArtworkBackground,
  normalizeContentArtworkTextOverrides,
  normalizeContentArtworkSettings,
  type ContentArtworkSettings,
  type ContentArtworkTextOverrides,
} from "@/lib/contentArtworkDesign";
import {
  renderBrandedContentSvg,
  resolveContentArtworkTextMetrics,
  resolveContentSafeArea,
  type ContentAssetBranding,
} from "@/lib/contentAssetRenderer";
import {
  CONTENT_GRAPHIC_TEMPLATE_FAMILY_LABELS,
  getContentGraphicTemplate,
  getDefaultTemplateId,
  isContentGraphicTemplateId,
  type CarouselSlideRole,
  type CarouselStudioSlide,
  type ContentDesignStudioDocument,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";
import { saveContentAssetDesignAction } from "@/server/actions/contentAssetStudio";

type StudioSlide = CarouselStudioSlide & { textOverrides?: ContentArtworkTextOverrides };
type StudioDesignDocument = Omit<ContentDesignStudioDocument, "slides"> & {
  slides: StudioSlide[];
};

type StudioAsset = {
  id: string;
  assetType: string;
  status: string;
  title: string;
  bodyContent: string;
  sermonTitle: string;
  relatedScripture: string | null;
  scriptureTranslation: string | null;
  sourceTranscriptExcerpt: string | null;
  sourceOpportunityStatus: string | null;
  design: StudioDesignDocument & { artwork?: ContentArtworkSettings };
  brandingChangedSinceRender: boolean;
  updatedAt: string;
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }>;
};

type PreviewFormat = "SQUARE" | "PORTRAIT" | "STORY" | "LANDSCAPE";
type GalleryFilter = "RECOMMENDED" | "PHOTO" | "MINIMAL" | "BOLD";

type SavedArtworkStyle = {
  id: string;
  label: string;
  assetType: string;
  slideRole: CarouselSlideRole | null;
  templateId: ContentGraphicTemplateId;
  artwork: ContentArtworkSettings;
};

const PREVIEW_FORMATS: Record<PreviewFormat, { label: string; ratio: string; width: number; height: number }> = {
  SQUARE: { label: "Square post", ratio: "1:1", width: 1080, height: 1080 },
  PORTRAIT: { label: "Portrait post", ratio: "4:5", width: 1080, height: 1350 },
  STORY: { label: "Story", ratio: "9:16", width: 1080, height: 1920 },
  LANDSCAPE: { label: "Landscape", ratio: "1.91:1", width: 1200, height: 630 },
};

const DISPLAY_LOCALE = "en-ZA";
const DISPLAY_TIME_ZONE = "Africa/Johannesburg";
const SAVED_STYLE_STORAGE_KEY = "melusi:content-artwork-styles:v1";
const GALLERY_FILTERS: Array<{ id: GalleryFilter; label: string }> = [
  { id: "RECOMMENDED", label: "All designs" },
  { id: "PHOTO", label: "Photo" },
  { id: "MINIMAL", label: "Minimal" },
  { id: "BOLD", label: "Bold" },
];
const ALIGNMENT_OPTIONS: ContentArtworkSettings["alignment"][] = ["LEFT", "CENTER", "RIGHT"];
const FOCAL_POINT_OPTIONS: Array<{
  x: ContentArtworkSettings["focalPointX"];
  y: ContentArtworkSettings["focalPointY"];
  label: string;
}> = [
  { x: "LEFT", y: "TOP", label: "Top left" },
  { x: "CENTER", y: "TOP", label: "Top centre" },
  { x: "RIGHT", y: "TOP", label: "Top right" },
  { x: "LEFT", y: "CENTER", label: "Centre left" },
  { x: "CENTER", y: "CENTER", label: "Centre" },
  { x: "RIGHT", y: "CENTER", label: "Centre right" },
  { x: "LEFT", y: "BOTTOM", label: "Bottom left" },
  { x: "CENTER", y: "BOTTOM", label: "Bottom centre" },
  { x: "RIGHT", y: "BOTTOM", label: "Bottom right" },
];

function makeSlideId(): string {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatLastSaved(value: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function copyLabel(assetType: string): string {
  if (assetType === "QUOTE_GRAPHIC") return "Quote wording";
  if (assetType === "SCRIPTURE_GRAPHIC") return "Scripture text";
  if (assetType === "PRAYER") return "Prayer copy";
  if (assetType === "DEVOTIONAL") return "Devotional copy";
  return "Graphic copy";
}

function copyGuidance(assetType: string): string {
  if (assetType === "QUOTE_GRAPHIC") return "Keep the strongest spoken line. Short, exact quotes create the best artwork.";
  if (assetType === "SCRIPTURE_GRAPHIC") return "Paste the verse text here and keep the Bible reference on the separate line below.";
  return "One focused thought will be easier to read and share.";
}

function referenceFieldCopy(assetType: string): { label: string; guidance: string } {
  if (assetType === "QUOTE_GRAPHIC") {
    return {
      label: "Speaker / byline",
      guidance: "For example, Pastor Jordan · Sunday message, or add a supporting Scripture reference.",
    };
  }
  if (assetType === "SCRIPTURE_GRAPHIC") {
    return {
      label: "Bible reference + translation",
      guidance: "Include the translation for publishing confidence, for example John 3:16 NIV.",
    };
  }
  return {
    label: "Reference / byline",
    guidance: "Add a Scripture reference, speaker, or source line when it helps the reader.",
  };
}

function designSignature(input: {
  title: string;
  bodyContent: string;
  relatedScripture: string;
  templateId: ContentGraphicTemplateId;
  slides: StudioSlide[];
  artwork: ContentArtworkSettings;
  textOverrides: ContentArtworkTextOverrides;
}): string {
  return JSON.stringify(input);
}

function sameArtworkSettings(left: ContentArtworkSettings, right: ContentArtworkSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function filterMatchesCategory(
  filter: GalleryFilter,
  category: ReturnType<typeof buildArtworkRecommendations>[number]["category"],
): boolean {
  if (filter === "RECOMMENDED") return true;
  if (filter === "PHOTO") return category === "PHOTO";
  if (filter === "BOLD") return category === "BOLD";
  return ["EDITORIAL", "CALM", "CHURCH"].includes(category);
}

function recommendationDisplayLabel(recommendation: { id: string; label: string }): string {
  return recommendation.id === "best-for-message" ? "Church brand starter" : recommendation.label;
}

function artworkBackgroundThumbnailHref(backgroundId: ContentArtworkSettings["backgroundId"]): string | null {
  const background = getContentArtworkBackground(backgroundId);
  return background.kind === "IMAGE"
    ? `/artwork-backgrounds/thumbnails/${background.id}.webp`
    : null;
}

function readSavedArtworkStyles(value: string | null): SavedArtworkStyle[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): SavedArtworkStyle[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const candidate = entry as Record<string, unknown>;
      const validSlideRole = candidate.slideRole === null
        || candidate.slideRole === "COVER"
        || candidate.slideRole === "CONTENT"
        || candidate.slideRole === "CTA";
      if (
        typeof candidate.id !== "string"
        || typeof candidate.label !== "string"
        || typeof candidate.assetType !== "string"
        || !candidate.assetType.trim()
        || !Object.prototype.hasOwnProperty.call(candidate, "slideRole")
        || !validSlideRole
        || !isContentGraphicTemplateId(candidate.templateId)
      ) return [];
      try {
        return [{
          id: candidate.id,
          label: candidate.label,
          assetType: candidate.assetType,
          slideRole: candidate.slideRole as CarouselSlideRole | null,
          templateId: candidate.templateId,
          artwork: normalizeContentArtworkSettings(candidate.artwork, candidate.templateId),
        }];
      } catch {
        return [];
      }
    }).slice(0, 24);
  } catch {
    return [];
  }
}

function isSavedArtworkStyleCompatible(
  style: SavedArtworkStyle,
  assetType: string,
  slideRole: CarouselSlideRole | null,
): boolean {
  if (style.assetType !== assetType) return false;
  if (assetType !== "CAROUSEL") {
    const expectedRole = getContentGraphicTemplate(getDefaultTemplateId({ assetType })).role;
    return style.slideRole === null
      && slideRole === null
      && getContentGraphicTemplate(style.templateId).role === expectedRole;
  }
  if (!slideRole || style.slideRole !== slideRole) return false;
  return getContentGraphicTemplate(style.templateId).role === slideRole;
}

function resolvePreviewTextOverrides(
  slide: StudioSlide | null,
  globalOverrides: ContentArtworkTextOverrides,
): ContentArtworkTextOverrides {
  return normalizeContentArtworkTextOverrides(slide?.textOverrides ?? globalOverrides);
}

export const __studioExperienceTestUtils = {
  isSavedArtworkStyleCompatible,
  readSavedArtworkStyles,
  resolvePreviewTextOverrides,
};

function persistSavedArtworkStyles(stylesToSave: SavedArtworkStyle[]): boolean {
  try {
    window.localStorage.setItem(SAVED_STYLE_STORAGE_KEY, JSON.stringify(stylesToSave));
    return true;
  } catch {
    return false;
  }
}

export function ContentAssetDesignStudio({
  initialAsset,
  branding,
}: {
  initialAsset: StudioAsset;
  branding: ContentAssetBranding;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isCarousel = initialAsset.assetType === "CAROUSEL";
  const lifecycleEditable = initialAsset.status === "PREPARED" || initialAsset.status === "READY";
  const sourceApproved = initialAsset.sourceOpportunityStatus === "APPROVED" || initialAsset.sourceOpportunityStatus === "USED";
  const isReadOnly = !lifecycleEditable || !sourceApproved;
  const scriptureAccuracyRequired = initialAsset.assetType === "SCRIPTURE_GRAPHIC";
  const [title, setTitle] = useState(initialAsset.title);
  const [bodyContent, setBodyContent] = useState(initialAsset.bodyContent);
  const [relatedScripture, setRelatedScripture] = useState(initialAsset.relatedScripture ?? "");
  const [scriptureAccuracyConfirmed, setScriptureAccuracyConfirmed] = useState(false);
  const [quoteWordingOverrideConfirmed, setQuoteWordingOverrideConfirmed] = useState(false);
  const [templateId, setTemplateId] = useState<ContentGraphicTemplateId>(initialAsset.design.templateId);
  const [artwork, setArtwork] = useState<ContentArtworkSettings>(() => normalizeContentArtworkSettings(
    initialAsset.design.artwork ?? createDefaultContentArtworkSettings(initialAsset.design.templateId),
    initialAsset.design.templateId,
  ));
  const [textOverrides, setTextOverrides] = useState<ContentArtworkTextOverrides>(() => (
    normalizeContentArtworkTextOverrides(
      initialAsset.design.textOverrides ?? createDefaultContentArtworkTextOverrides(),
    )
  ));
  const [slides, setSlides] = useState<StudioSlide[]>(initialAsset.design.slides);
  const [selectedSlideId, setSelectedSlideId] = useState(initialAsset.design.slides[0]?.id ?? null);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("PORTRAIT");
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>("RECOMMENDED");
  const [wordsEditorOpen, setWordsEditorOpen] = useState(isCarousel || scriptureAccuracyRequired);
  const [savedStyles, setSavedStyles] = useState<SavedArtworkStyle[]>([]);
  const [styleFeedback, setStyleFeedback] = useState<string | null>(null);
  const [brandingIsStale, setBrandingIsStale] = useState(initialAsset.brandingChangedSinceRender);
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const [productionReady, setProductionReady] = useState(
    () => !initialAsset.brandingChangedSinceRender
      && ["READY", "SCHEDULED"].includes(initialAsset.status)
      && initialAsset.files.length > 0,
  );
  const [savedSignature, setSavedSignature] = useState(() => designSignature({
    title: initialAsset.title,
    bodyContent: initialAsset.bodyContent,
    relatedScripture: initialAsset.relatedScripture ?? "",
    templateId: initialAsset.design.templateId,
    slides: initialAsset.design.slides,
    artwork: normalizeContentArtworkSettings(
      initialAsset.design.artwork ?? createDefaultContentArtworkSettings(initialAsset.design.templateId),
      initialAsset.design.templateId,
    ),
    textOverrides: normalizeContentArtworkTextOverrides(
      initialAsset.design.textOverrides ?? createDefaultContentArtworkTextOverrides(),
    ),
  }));
  const activeSlideIndex = Math.max(0, slides.findIndex((slide) => slide.id === selectedSlideId));
  const activeSlide = slides[activeSlideIndex] ?? null;
  const selectedTemplate = getContentGraphicTemplate(activeSlide?.templateId ?? templateId);
  const artworkRecommendations = useMemo(() => buildArtworkRecommendations(
    initialAsset.assetType,
    activeSlide?.templateId ?? templateId,
  ), [activeSlide?.templateId, initialAsset.assetType, templateId]);
  const visibleRecommendations = artworkRecommendations.filter((recommendation) => (
    filterMatchesCategory(galleryFilter, recommendation.category)
  ));
  const previewDimensions = isCarousel
    ? { width: 1080, height: 1350 }
    : PREVIEW_FORMATS[previewFormat];
  const previewCopy = activeSlide?.body ?? bodyContent;
  const previewTitle = activeSlide?.title ?? title;
  const previewScripture = activeSlide ? activeSlide.scripture : relatedScripture;
  const previewTextOverrides = useMemo(
    () => resolvePreviewTextOverrides(activeSlide, textOverrides),
    [activeSlide, textOverrides],
  );
  const compatibleSavedStyles = savedStyles.filter((style) => isSavedArtworkStyleCompatible(
    style,
    initialAsset.assetType,
    activeSlide?.role ?? null,
  ));
  const previewSvg = useMemo(() => renderBrandedContentSvg({
    title: previewTitle,
    content: previewCopy,
    scripture: previewScripture,
    branding,
    width: previewDimensions.width,
    height: previewDimensions.height,
    templateId: activeSlide?.templateId ?? templateId,
    artwork,
    textOverrides: previewTextOverrides,
  }), [activeSlide?.templateId, artwork, branding, previewCopy, previewDimensions.height, previewDimensions.width, previewScripture, previewTextOverrides, previewTitle, templateId]);
  const recommendationPreviews = useMemo(() => new Map(artworkRecommendations.map((recommendation) => [
    recommendation.id,
    renderBrandedContentSvg({
      title: previewTitle,
      content: previewCopy,
      scripture: previewScripture,
      branding,
      width: 240,
      height: 300,
      templateId: recommendation.templateId,
      artwork: recommendation.settings,
      backgroundImageHref: artworkBackgroundThumbnailHref(recommendation.settings.backgroundId),
      textOverrides: previewTextOverrides,
    }),
  ])), [artworkRecommendations, branding, previewCopy, previewScripture, previewTextOverrides, previewTitle]);
  const previewSafeArea = resolveContentSafeArea(previewDimensions);
  const safeAreaGuideStyle = {
    "--safe-left": `${(previewSafeArea.left / previewDimensions.width) * 100}%`,
    "--safe-top": `${(previewSafeArea.top / previewDimensions.height) * 100}%`,
    "--safe-width": `${(previewSafeArea.width / previewDimensions.width) * 100}%`,
    "--safe-height": `${(previewSafeArea.height / previewDimensions.height) * 100}%`,
  } as CSSProperties;
  const outputFitWarnings = useMemo(() => {
    function collectWarnings(input: {
      label: string;
      copy: string;
      heading: string;
      scripture: string | null;
      width: number;
      height: number;
      template: ReturnType<typeof getContentGraphicTemplate>;
    }): string[] {
      const warnings: string[] = [];
      const metrics = resolveContentArtworkTextMetrics({
        content: input.copy,
        title: input.heading,
        reference: input.scripture,
        width: input.width,
        height: input.height,
        templateId: input.template.id,
        artwork,
        hasLogo: Boolean(branding.logoDataUrl),
      });
      if (metrics.body.exceedsCapacity) {
        warnings.push(`${input.label} copy`);
      }
      if (metrics.title.exceedsCapacity) {
        warnings.push(`${input.label} heading`);
      }
      if (metrics.reference.exceedsCapacity) {
        warnings.push(`${input.label} reference`);
      }
      return warnings;
    }

    if (isCarousel) {
      return slides.flatMap((slide, index) => {
        return collectWarnings({
          label: `Slide ${index + 1}`,
          copy: slide.body,
          heading: slide.title,
          scripture: slide.scripture,
          width: 1080,
          height: 1350,
          template: getContentGraphicTemplate(slide.templateId),
        });
      });
    }

    const template = getContentGraphicTemplate(templateId);
    return Object.values(PREVIEW_FORMATS).flatMap((format) => (
      collectWarnings({
        label: format.label,
        copy: previewCopy,
        heading: previewTitle,
        scripture: relatedScripture,
        width: format.width,
        height: format.height,
        template,
      })
    ));
  }, [artwork, branding.logoDataUrl, isCarousel, previewCopy, previewTitle, relatedScripture, slides, templateId]);
  const currentSignature = useMemo(() => designSignature({
    title,
    bodyContent,
    relatedScripture,
    templateId,
    slides,
    artwork,
    textOverrides,
  }), [artwork, bodyContent, relatedScripture, slides, templateId, textOverrides, title]);
  const hasUnsavedChanges = currentSignature !== savedSignature;
  const existingFilesAreHistorical = initialAsset.files.length > 0 && (hasUnsavedChanges || brandingIsStale);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSavedStyles(readSavedArtworkStyles(window.localStorage.getItem(SAVED_STYLE_STORAGE_KEY)));
      } catch {
        setSavedStyles([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function updateActiveSlide(patch: Partial<StudioSlide>) {
    if (!activeSlide) return;
    setSlides((current) => current.map((slide) => slide.id === activeSlide.id ? { ...slide, ...patch } : slide));
  }

  function updateTextOverrides(patch: Partial<ContentArtworkTextOverrides>) {
    const next: ContentArtworkTextOverrides = { ...previewTextOverrides, ...patch, version: 1 };
    if (activeSlide) {
      updateActiveSlide({ textOverrides: next });
    } else {
      setTextOverrides(next);
    }
  }

  function updateArtwork(patch: Partial<ContentArtworkSettings>) {
    setStyleFeedback(null);
    setArtwork((current) => normalizeContentArtworkSettings({ ...current, ...patch }, activeSlide?.templateId ?? templateId));
  }

  function applyArtworkRecipe(input: {
    templateId: ContentGraphicTemplateId;
    artwork: ContentArtworkSettings;
  }) {
    setStyleFeedback(null);
    setArtwork(normalizeContentArtworkSettings(input.artwork, input.templateId));
    if (activeSlide) {
      updateActiveSlide({ templateId: input.templateId });
    } else {
      setTemplateId(input.templateId);
    }
  }

  function saveCurrentStyle() {
    if (isReadOnly) return;
    const styleNumber = compatibleSavedStyles.length + 1;
    const nextStyle: SavedArtworkStyle = {
      id: `style-${Date.now()}`,
      label: `My church style ${styleNumber}`,
      assetType: initialAsset.assetType,
      slideRole: activeSlide?.role ?? null,
      templateId: activeSlide?.templateId ?? templateId,
      artwork,
    };
    const next = [nextStyle, ...savedStyles].slice(0, 24);
    if (persistSavedArtworkStyles(next)) {
      setSavedStyles(next);
      setStyleFeedback(`${nextStyle.label} saved on this device.`);
    } else {
      setStyleFeedback("This browser could not store a reusable style. Your artwork changes are still safe to save as a draft.");
    }
  }

  function removeSavedStyle(styleId: string) {
    const next = savedStyles.filter((style) => style.id !== styleId);
    if (persistSavedArtworkStyles(next)) {
      setSavedStyles(next);
      setStyleFeedback("Saved style removed.");
    }
  }

  function applySavedStyle(style: SavedArtworkStyle) {
    if (!isSavedArtworkStyleCompatible(style, initialAsset.assetType, activeSlide?.role ?? null)) {
      setStyleFeedback("That saved style belongs to another content type or carousel slide role.");
      return;
    }
    applyArtworkRecipe(style);
  }

  function changeSlideRole(role: CarouselSlideRole) {
    updateActiveSlide({ role, templateId: getDefaultTemplateId({ slideRole: role }) });
  }

  function moveSlide(direction: -1 | 1) {
    if (!activeSlide) return;
    const nextIndex = activeSlideIndex + direction;
    if (nextIndex < 0 || nextIndex >= slides.length) return;
    setSlides((current) => {
      const next = [...current];
      [next[activeSlideIndex], next[nextIndex]] = [next[nextIndex], next[activeSlideIndex]];
      return next;
    });
  }

  function addSlide() {
    if (slides.length >= 10) return;
    const role: CarouselSlideRole = "CONTENT";
    const slide: StudioSlide = {
      id: makeSlideId(),
      role,
      templateId: getDefaultTemplateId({ slideRole: role }),
      title: `Point ${slides.length + 1}`,
      body: "Add one clear, sermon-grounded idea.",
      scripture: relatedScripture.trim() || null,
      textOverrides: createDefaultContentArtworkTextOverrides(),
    };
    setSlides((current) => [...current, slide]);
    setSelectedSlideId(slide.id);
  }

  function removeSlide() {
    if (!activeSlide || slides.length <= 1) return;
    const remaining = slides.filter((slide) => slide.id !== activeSlide.id);
    setSlides(remaining);
    setSelectedSlideId(remaining[Math.min(activeSlideIndex, remaining.length - 1)]?.id ?? null);
  }

  function save(rerender: boolean) {
    setFeedback(null);
    const signatureAtSave = currentSignature;
    startTransition(async () => {
      const result = await saveContentAssetDesignAction({
        assetId: initialAsset.id,
        title,
        templateId,
        bodyContent: isCarousel ? undefined : bodyContent,
        relatedScripture: relatedScripture.trim() || null,
        quoteWordingOverrideConfirmed,
        slides: isCarousel ? slides : [],
        artwork,
        textOverrides,
        rerender,
        scriptureAccuracyConfirmed,
      });
      setFeedback({ message: result.message, success: result.success });
      if (result.success) {
        setSavedSignature(signatureAtSave);
        setProductionReady(rerender);
        if (rerender) setBrandingIsStale(false);
        router.refresh();
      }
    });
  }

  const hasInvalidCopy = !title.trim() || (isCarousel
    ? slides.length === 0 || slides.some((slide) => !slide.title.trim() || !slide.body.trim())
    : !bodyContent.trim());
  const renderingBlockedByFit = outputFitWarnings.length > 0;
  const scriptureApprovalBlocked = scriptureAccuracyRequired && (
    !relatedScripture.trim() || !scriptureAccuracyConfirmed
  );
  const renderBlockReason = renderingBlockedByFit
    ? `Shorten ${outputFitWarnings.join(", ")} before rendering.`
    : scriptureApprovalBlocked
      ? "Confirm that the verse wording, reference, and displayed translation match before approving."
      : undefined;
  const saveDraftBlockReason = isReadOnly
    ? !lifecycleEditable
      ? "This artwork is locked. Approve and prepare the content before editing, or create a new asset from Content Ideas."
      : "The source publishing idea must be approved before this artwork can be saved."
    : hasInvalidCopy
      ? isCarousel
        ? "Add a heading and quote copy to every slide before saving."
        : "Add an artwork heading and quote copy before saving."
      : !hasUnsavedChanges
        ? "Make an edit above to enable Save draft."
        : undefined;
  const studioStyle = {
    "--studio-primary": branding.primaryColor,
    "--studio-secondary": branding.secondaryColor,
  } as CSSProperties;
  const referenceCopy = referenceFieldCopy(initialAsset.assetType);

  return (
    <section className={styles.workspace} aria-label="Content Design Studio" style={studioStyle}>
      <aside className={styles.rail}>
        <div className="stack-sm">
          <p className="kicker">{initialAsset.sermonTitle}</p>
          <h2>{isCarousel ? `${slides.length} slide carousel` : "Preview sizes"}</h2>
          <p className="muted small">Last saved {formatLastSaved(initialAsset.updatedAt)}</p>
          <span className={hasUnsavedChanges ? styles.unsavedStatus : styles.savedStatus}>
            <span aria-hidden="true" />
            {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>

        {isCarousel ? (
          <>
            <div className={styles.slideList} aria-label="Carousel slides">
              {slides.map((slide, index) => (
                <button
                  type="button"
                  key={slide.id}
                  aria-pressed={slide.id === activeSlide?.id}
                  className={slide.id === activeSlide?.id ? styles.activeSlide : styles.slideButton}
                  onClick={() => setSelectedSlideId(slide.id)}
                >
                  <span>{index + 1}</span>
                  <span><strong>{slide.title}</strong><small>{slide.role.toLowerCase()}</small></span>
                </button>
              ))}
            </div>
            <button type="button" className="button secondary" onClick={addSlide} disabled={isPending || isReadOnly || slides.length >= 10}>
              Add slide
            </button>
            <p className="muted small">Instagram supports up to 10 slides in this workflow.</p>
          </>
        ) : (
          <div className={styles.formatButtons} aria-label="Preview format">
            {(Object.entries(PREVIEW_FORMATS) as Array<[PreviewFormat, typeof PREVIEW_FORMATS[PreviewFormat]]>).map(([id, format]) => (
              <button
                type="button"
                key={id}
                aria-pressed={previewFormat === id}
                className={previewFormat === id ? styles.selectedFormat : ""}
                onClick={() => setPreviewFormat(id)}
              >
                <strong>{format.label}</strong>
                <span>{format.ratio}</span>
              </button>
            ))}
          </div>
        )}

        {brandingIsStale ? (
          <div className={styles.staleArtworkWarning} role="status">
            <strong>Branding changed since the last render</strong>
            <span>The live preview uses the current Brand Kit. Approve and render again before scheduling so the downloadable artwork matches it.</span>
          </div>
        ) : null}

        <div className={renderingBlockedByFit ? styles.fitWarning : styles.fitSuccess} aria-live="polite">
          <strong>{renderingBlockedByFit ? "Copy needs attention" : "Copy fits the artwork"}</strong>
          <span>
            {renderingBlockedByFit
              ? `Shorten ${outputFitWarnings.join(", ")} before rendering.`
              : isCarousel
                ? "This slide fits inside the protected production area."
                : "Safe areas and copy fit are protected in all four social sizes."}
          </span>
        </div>

        <div className={styles.fileSummary}>
          <strong>{initialAsset.files.length} rendered file{initialAsset.files.length === 1 ? "" : "s"}</strong>
          <span className="muted small">Status: {initialAsset.status.toLowerCase()}</span>
        </div>
      </aside>

      <div className={styles.canvasColumn}>
        <div className={styles.previewDock}>
          <div className={styles.previewToolbar}>
            <span className={styles.liveBadge}><span aria-hidden="true" /> Live preview</span>
            <span className="status-pill">{selectedTemplate.label}</span>
            {branding.logoDataUrl && artwork.showLogo ? <span className={styles.confidenceBadge}>Church logo applied</span> : null}
            <span className={styles.confidenceBadge}>Safe area protected</span>
            <span className="muted small">{previewDimensions.width}×{previewDimensions.height}</span>
            {isCarousel ? <span className="muted small">Slide {activeSlideIndex + 1} of {slides.length}</span> : null}
          </div>
          <div className={styles.previewStage}>
            <div
              className={styles.svgPreview}
              style={{ aspectRatio: `${previewDimensions.width} / ${previewDimensions.height}` }}
            >
              <span dangerouslySetInnerHTML={{ __html: previewSvg }} />
              <span className={styles.safeAreaGuide} style={safeAreaGuideStyle} aria-hidden="true" />
            </div>
          </div>
          <div className={styles.previewCaption}>
            <span>Every edit appears here immediately.</span>
            <strong>{CONTENT_GRAPHIC_TEMPLATE_FAMILY_LABELS[selectedTemplate.family]} · {artwork.alignment.toLowerCase()} aligned</strong>
          </div>
        </div>

        {initialAsset.files.length > 0 ? (
          <details className={styles.renderedFiles}>
            <summary>{existingFilesAreHistorical ? "Last approved output" : "Approved production files"}</summary>
            {existingFilesAreHistorical ? (
              <p className={styles.outputHistoryNote}>
                These downloads show the last approved render. The live preview includes {brandingIsStale ? "new branding" : "your unsaved changes"}.
              </p>
            ) : null}
            <a className="button tertiary" href={`/api/content-assets/${initialAsset.id}/download`}>
              Download production files
            </a>
            <div>
              {initialAsset.files.map((file) => (
                <a key={file.id} href={`/api/content-assets/${initialAsset.id}/files/${file.id}`} target="_blank" rel="noreferrer">
                  {file.mimeType.startsWith("image/") && file.width && file.height ? (
                    <Image
                      src={`/api/content-assets/${initialAsset.id}/files/${file.id}`}
                      alt={`${existingFilesAreHistorical ? "Last approved output" : "Approved output"}: ${file.fileName}`}
                      width={file.width}
                      height={file.height}
                      unoptimized
                    />
                  ) : null}
                  <span>{file.fileName}</span>
                </a>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <aside className={styles.inspector}>
        <div className={styles.inspectorHeading}>
          <div className="stack-sm">
            <p className="kicker">Create</p>
            <h2>{isCarousel ? `Edit slide ${activeSlideIndex + 1}` : "Shape the artwork"}</h2>
          </div>
          <span>{countWords(previewCopy)} words</span>
        </div>

        <div className={styles.mobileLivePreview} aria-hidden="true">
          <span>Live preview · {selectedTemplate.label}</span>
          <div
            style={{ aspectRatio: `${previewDimensions.width} / ${previewDimensions.height}` }}
            dangerouslySetInnerHTML={{ __html: previewSvg }}
          />
        </div>

        {isReadOnly ? (
          <div className="error-banner">
            {!lifecycleEditable
              ? ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(initialAsset.status)
                ? `This design is read-only because it is already ${initialAsset.status.toLowerCase()}. Create a new asset from Content Ideas for future changes.`
                : "Approve and prepare this content before changing it in Design Studio."
              : "The source publishing idea must be approved before this design can change."}
          </div>
        ) : null}

        <div className={styles.editorIntro}>
          <strong>Choose a finished direction first</strong>
          <p>Every option uses your real words and church brand. Pick the closest fit, then fine-tune only what matters.</p>
        </div>

        <section className={styles.designChooser} aria-labelledby="design-directions-heading">
          <div className={styles.sectionHeading}>
            <div>
              <h3 id="design-directions-heading">Artwork directions</h3>
              <p>Twelve distinct starting points, with no extra AI calls.</p>
            </div>
            <span>{artworkRecommendations.length} options</span>
          </div>
          <div className={styles.galleryFilters} aria-label="Filter artwork directions">
            {GALLERY_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={galleryFilter === filter.id ? styles.activeFilter : ""}
                aria-pressed={galleryFilter === filter.id}
                onClick={() => setGalleryFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className={styles.designGallery}>
            {visibleRecommendations.map((recommendation) => {
              const selected = (activeSlide?.templateId ?? templateId) === recommendation.templateId
                && sameArtworkSettings(artwork, recommendation.settings);
              const displayLabel = recommendationDisplayLabel(recommendation);
              return (
                <button
                  key={recommendation.id}
                  type="button"
                  className={`${styles.designCard} ${selected ? styles.selectedDesign : ""}`}
                  aria-pressed={selected}
                  aria-label={`${displayLabel}. ${recommendation.description}`}
                  onClick={() => applyArtworkRecipe({ templateId: recommendation.templateId, artwork: recommendation.settings })}
                  disabled={isPending || isReadOnly}
                >
                  <span className={styles.designPreview} aria-hidden="true" dangerouslySetInnerHTML={{ __html: recommendationPreviews.get(recommendation.id) ?? "" }} />
                  <span className={styles.designCardCopy}>
                    <strong>{displayLabel}</strong>
                    <span>{recommendation.description}</span>
                  </span>
                  <span className={styles.designSelectionMark} aria-hidden="true">✓</span>
                </button>
              );
            })}
          </div>
        </section>

        <details className={styles.customizer}>
          <summary>
            <span className={styles.summaryCopy}>
              <strong>Customize this design</strong>
              <span>Background, type, colour, crop and church mark</span>
            </span>
          </summary>
          <div className={styles.customizerBody}>
            <section className={styles.controlGroup} aria-labelledby="background-control-heading">
              <div className={styles.controlHeading}>
                <strong id="background-control-heading">Background</strong>
                <span>{CONTENT_ARTWORK_BACKGROUNDS.length} curated choices</span>
              </div>
              <div className={styles.optionGrid}>
                {CONTENT_ARTWORK_BACKGROUNDS.map((background) => (
                  <button
                    key={background.id}
                    type="button"
                    className={`${styles.optionButton} ${artwork.backgroundId === background.id ? styles.selectedOption : ""}`}
                    aria-pressed={artwork.backgroundId === background.id}
                    title={background.description}
                    onClick={() => updateArtwork({ backgroundId: background.id })}
                    disabled={isPending || isReadOnly}
                  >
                    <span
                      className={styles.backgroundSwatch}
                      style={{
                        "--swatch-a": background.previewColors[0],
                        "--swatch-b": background.previewColors[1],
                        backgroundImage: artworkBackgroundThumbnailHref(background.id)
                          ? `linear-gradient(rgba(5, 7, 10, 0.08), rgba(5, 7, 10, 0.28)), url("${artworkBackgroundThumbnailHref(background.id)}")`
                          : undefined,
                      } as CSSProperties}
                      aria-hidden="true"
                    />
                    <small>{background.label}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="palette-control-heading">
              <div className={styles.controlHeading}>
                <strong id="palette-control-heading">Colour palette</strong>
                <span>Brand-safe combinations</span>
              </div>
              <div className={styles.paletteGrid}>
                {CONTENT_ARTWORK_PALETTES.map((palette) => {
                  const colors = palette.usesBrandColors
                    ? [branding.primaryColor, branding.secondaryColor, "#ffffff"]
                    : [...palette.colors];
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      className={`${styles.paletteButton} ${artwork.paletteId === palette.id ? styles.selectedOption : ""}`}
                      aria-pressed={artwork.paletteId === palette.id}
                      title={palette.description}
                      onClick={() => updateArtwork({ paletteId: palette.id })}
                      disabled={isPending || isReadOnly}
                    >
                      <span className={styles.paletteSwatch} aria-hidden="true">
                        {colors.map((color, index) => <span key={`${color}-${index}`} style={{ "--swatch-color": color } as CSSProperties} />)}
                      </span>
                      <small>{palette.label}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="typography-control-heading">
              <div className={styles.controlHeading}>
                <strong id="typography-control-heading">Typography</strong>
                <span>Professional font pairings</span>
              </div>
              <div className={styles.typeGrid}>
                {CONTENT_ARTWORK_TYPOGRAPHY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`${styles.typeButton} ${artwork.typographyPresetId === preset.id ? styles.selectedOption : ""}`}
                    aria-pressed={artwork.typographyPresetId === preset.id}
                    title={preset.description}
                    onClick={() => updateArtwork({ typographyPresetId: preset.id })}
                    disabled={isPending || isReadOnly}
                  >
                    <span style={{ "--type-preview": preset.headingFamily } as CSSProperties}>Ag</span>
                    <small>{preset.label}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="composition-control-heading">
              <div className={styles.controlHeading}>
                <strong id="composition-control-heading">Text composition</strong>
                <span>Protected inside safe areas</span>
              </div>
              <div className={styles.segmentedControl} aria-label="Text alignment">
                {ALIGNMENT_OPTIONS.map((alignment) => (
                  <button
                    key={alignment}
                    type="button"
                    className={artwork.alignment === alignment ? styles.selectedOption : ""}
                    aria-pressed={artwork.alignment === alignment}
                    onClick={() => updateArtwork({ alignment })}
                    disabled={isPending || isReadOnly}
                  >
                    {alignment.charAt(0) + alignment.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <div className={styles.rangeStack}>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Text size</span><output>{Math.round(artwork.textScale * 100)}%</output></span>
                  <input aria-label="Text size" type="range" min="0.75" max="1.3" step="0.05" value={artwork.textScale} onChange={(event) => updateArtwork({ textScale: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Line height</span><output>{artwork.lineHeight.toFixed(2)}</output></span>
                  <input aria-label="Line height" type="range" min="0.9" max="1.35" step="0.05" value={artwork.lineHeight} onChange={(event) => updateArtwork({ lineHeight: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Letter spacing</span><output>{artwork.letterSpacing.toFixed(1)}</output></span>
                  <input aria-label="Letter spacing" type="range" min="-1" max="4" step="0.5" value={artwork.letterSpacing} onChange={(event) => updateArtwork({ letterSpacing: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="image-control-heading">
              <div className={styles.controlHeading}>
                <strong id="image-control-heading">Image treatment</strong>
                <span>Readability remains protected</span>
              </div>
              <div className={styles.rangeStack}>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Text overlay</span><output>{Math.round(artwork.overlayOpacity * 100)}%</output></span>
                  <input aria-label="Text overlay" type="range" min="0" max="0.9" step="0.05" value={artwork.overlayOpacity} onChange={(event) => updateArtwork({ overlayOpacity: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Brightness</span><output>{Math.round(artwork.brightness * 100)}%</output></span>
                  <input aria-label="Brightness" type="range" min="0.45" max="1.25" step="0.05" value={artwork.brightness} onChange={(event) => updateArtwork({ brightness: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
                <label className={styles.rangeControl}>
                  <span className={styles.rangeLabel}><span>Background blur</span><output>{artwork.blur}px</output></span>
                  <input aria-label="Background blur" type="range" min="0" max="20" step="1" value={artwork.blur} onChange={(event) => updateArtwork({ blur: Number(event.target.value) })} disabled={isPending || isReadOnly} />
                </label>
              </div>
              <div className={styles.controlHeading}>
                <strong>Focal point</strong>
                <span>Choose what stays visible when sizes change</span>
              </div>
              <div className={styles.focalGrid} aria-label="Background focal point">
                {FOCAL_POINT_OPTIONS.map((point) => {
                  const selected = artwork.focalPointX === point.x && artwork.focalPointY === point.y;
                  return (
                    <button
                      key={`${point.x}-${point.y}`}
                      type="button"
                      className={selected ? styles.selectedOption : ""}
                      aria-label={point.label}
                      aria-pressed={selected}
                      onClick={() => updateArtwork({ focalPointX: point.x, focalPointY: point.y })}
                      disabled={isPending || isReadOnly}
                    />
                  );
                })}
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="brand-control-heading">
              <div className={styles.controlHeading}>
                <strong id="brand-control-heading">Church mark</strong>
                <span>{branding.logoDataUrl ? "Logo ready" : "Church name remains visible"}</span>
              </div>
              <label className={styles.toggleRow}>
                Show church logo
                <input type="checkbox" checked={artwork.showLogo} onChange={(event) => updateArtwork({ showLogo: event.target.checked })} disabled={isPending || isReadOnly || !branding.logoDataUrl} />
              </label>
              <div className={`${styles.segmentedControl} ${styles.logoPositionGrid}`} aria-label="Logo position">
                {(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"] as ContentArtworkSettings["logoPosition"][]).map((position) => (
                  <button
                    key={position}
                    type="button"
                    className={artwork.logoPosition === position ? styles.selectedOption : ""}
                    aria-pressed={artwork.logoPosition === position}
                    onClick={() => updateArtwork({ logoPosition: position })}
                    disabled={isPending || isReadOnly || !artwork.showLogo}
                  >
                    {position.split("_").map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ")}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.controlGroup} aria-labelledby="saved-style-heading">
              <div className={styles.controlHeading}>
                <strong id="saved-style-heading">Saved styles</strong>
                <span>Reuse a recognisable church look</span>
              </div>
              <div className={styles.savedStyleActions}>
                <button type="button" className="button secondary" onClick={saveCurrentStyle} disabled={isPending || isReadOnly}>Save as my style</button>
                {compatibleSavedStyles.length > 0 ? (
                  <div className={styles.savedStyleList}>
                    {compatibleSavedStyles.map((style) => (
                      <div className={styles.savedStyle} key={style.id}>
                        <button type="button" onClick={() => applySavedStyle(style)} disabled={isPending || isReadOnly}>{style.label}</button>
                        <button type="button" aria-label={`Remove ${style.label}`} onClick={() => removeSavedStyle(style.id)} disabled={isPending}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {styleFeedback ? <span className="muted small" aria-live="polite">{styleFeedback}</span> : null}
              </div>
            </section>
          </div>
        </details>

        <details
          id="studio-words-editor"
          className={styles.wordsEditor}
          open={wordsEditorOpen}
          onToggle={(event) => setWordsEditorOpen(event.currentTarget.open)}
        >
          <summary>
            <span className={styles.summaryCopy}>
              <strong>Edit words and source</strong>
              <span>{countWords(previewCopy)} words · accuracy checks stay active</span>
            </span>
          </summary>
          <div className={styles.wordsEditorBody}>
            <label>
              Artwork heading
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={isPending || isReadOnly} />
              <small className="muted">Shown on the finished design.</small>
            </label>

            <section className={styles.wordingLayers} aria-labelledby="supporting-wording-heading">
              <div className={styles.controlHeading}>
                <strong id="supporting-wording-heading">Supporting wording</strong>
                <span>Edit every visible text layer</span>
              </div>

              <div className={styles.wordingLayer}>
                <div className={styles.layerHeader}>
                  <label htmlFor="artwork-top-label">Top label</label>
                  <label className={styles.layerToggle}>
                    <input
                      type="checkbox"
                      aria-label="Show top label"
                      checked={previewTextOverrides.showEyebrow}
                      onChange={(event) => updateTextOverrides({ showEyebrow: event.target.checked })}
                      disabled={isPending || isReadOnly}
                    />
                    <span>Show</span>
                  </label>
                </div>
                <input
                  id="artwork-top-label"
                  value={previewTextOverrides.eyebrowText ?? selectedTemplate.eyebrow}
                  onChange={(event) => updateTextOverrides({
                    eyebrowText: event.target.value.trim() ? event.target.value : null,
                  })}
                  maxLength={48}
                  disabled={isPending || isReadOnly}
                />
                <div className={styles.layerHelp}>
                  <small>Template default: {selectedTemplate.eyebrow}</small>
                  <button
                    type="button"
                    onClick={() => updateTextOverrides({ eyebrowText: null, showEyebrow: true })}
                    disabled={isPending || isReadOnly || (previewTextOverrides.eyebrowText === null && previewTextOverrides.showEyebrow)}
                  >
                    Reset to template
                  </button>
                </div>
              </div>

              <div className={styles.wordingLayer}>
                <div className={styles.layerHeader}>
                  <label htmlFor="artwork-footer-text">Footer / church text</label>
                  <label className={styles.layerToggle}>
                    <input
                      type="checkbox"
                      aria-label="Show footer text"
                      checked={previewTextOverrides.showFooter}
                      onChange={(event) => updateTextOverrides({ showFooter: event.target.checked })}
                      disabled={isPending || isReadOnly}
                    />
                    <span>Show</span>
                  </label>
                </div>
                <input
                  id="artwork-footer-text"
                  value={previewTextOverrides.footerText ?? branding.churchName}
                  onChange={(event) => updateTextOverrides({
                    footerText: event.target.value.trim() ? event.target.value : null,
                  })}
                  maxLength={60}
                  disabled={isPending || isReadOnly}
                />
                <div className={styles.layerHelp}>
                  <small>Brand Kit default: {branding.churchName}</small>
                  <button
                    type="button"
                    onClick={() => updateTextOverrides({ footerText: null, showFooter: true })}
                    disabled={isPending || isReadOnly || (previewTextOverrides.footerText === null && previewTextOverrides.showFooter)}
                  >
                    Use Brand Kit
                  </button>
                </div>
              </div>
            </section>

            {isCarousel && activeSlide ? (
              <>
                <div className={styles.inlineFields}>
                  <label>
                    Slide type
                    <select value={activeSlide.role} onChange={(event) => changeSlideRole(event.target.value as CarouselSlideRole)} disabled={isPending || isReadOnly}>
                      <option value="COVER">Cover</option>
                      <option value="CONTENT">Teaching</option>
                      <option value="CTA">Response / CTA</option>
                    </select>
                  </label>
                  <div className={styles.reorderButtons}>
                    <span>Order</span>
                    <div>
                      <button type="button" onClick={() => moveSlide(-1)} disabled={isPending || isReadOnly || activeSlideIndex === 0} aria-label="Move slide earlier">↑</button>
                      <button type="button" onClick={() => moveSlide(1)} disabled={isPending || isReadOnly || activeSlideIndex === slides.length - 1} aria-label="Move slide later">↓</button>
                      <button type="button" onClick={removeSlide} disabled={isPending || isReadOnly || slides.length <= 1} aria-label="Remove slide">Remove</button>
                    </div>
                  </div>
                </div>
                <label>
                  Slide heading
                  <input value={activeSlide.title} onChange={(event) => updateActiveSlide({ title: event.target.value })} maxLength={120} disabled={isPending || isReadOnly} />
                </label>
                <label>
                  Slide copy
                  <textarea value={activeSlide.body} onChange={(event) => updateActiveSlide({ body: event.target.value })} rows={7} maxLength={1_200} disabled={isPending || isReadOnly} />
                  <small className="muted">{activeSlide.body.length.toLocaleString(DISPLAY_LOCALE)} characters · {countWords(activeSlide.body)} words. One clear thought per slide reads best.</small>
                </label>
                <label>
                  Reference / byline <span className={styles.optionalLabel}>Optional</span>
                  <input value={activeSlide.scripture ?? ""} onChange={(event) => updateActiveSlide({ scripture: event.target.value || null })} maxLength={200} disabled={isPending || isReadOnly} />
                  <small className="muted">Add a Scripture reference, speaker, or source line. The selected look controls its treatment.</small>
                </label>
              </>
            ) : (
              <>
                <label>
                  {copyLabel(initialAsset.assetType)}
                  <textarea
                    value={bodyContent}
                    onChange={(event) => {
                      setBodyContent(event.target.value);
                      setQuoteWordingOverrideConfirmed(false);
                      if (scriptureAccuracyRequired) {
                        setScriptureAccuracyConfirmed(false);
                        setWordsEditorOpen(true);
                      }
                    }}
                    rows={8}
                    maxLength={20_000}
                    disabled={isPending || isReadOnly}
                  />
                <small className="muted">
                    {bodyContent.length.toLocaleString(DISPLAY_LOCALE)} characters · {countWords(bodyContent)} words. {copyGuidance(initialAsset.assetType)}
                </small>
                {initialAsset.assetType === "QUOTE_GRAPHIC" ? (
                  <label className={styles.accuracyConfirmation}>
                    <input
                      type="checkbox"
                      checked={quoteWordingOverrideConfirmed}
                      onChange={(event) => setQuoteWordingOverrideConfirmed(event.target.checked)}
                      disabled={isPending || isReadOnly}
                    />
                    <span>
                      <strong>Render as edited wording</strong>
                      I understand this version may not be an exact transcript quote and want to use it as edited artwork copy.
                    </span>
                  </label>
                ) : null}
                </label>
                <label>
                  {referenceCopy.label} <span className={styles.optionalLabel}>{scriptureAccuracyRequired ? "Required" : "Optional"}</span>
                  <input
                    value={relatedScripture}
                    onChange={(event) => {
                      setRelatedScripture(event.target.value);
                      if (scriptureAccuracyRequired) {
                        setScriptureAccuracyConfirmed(false);
                        setWordsEditorOpen(true);
                      }
                    }}
                    maxLength={200}
                    disabled={isPending || isReadOnly}
                  />
                  <small className="muted">{referenceCopy.guidance}</small>
                </label>
                {scriptureAccuracyRequired ? (
                  <label className={styles.accuracyConfirmation}>
                    <input
                      type="checkbox"
                      checked={scriptureAccuracyConfirmed}
                      onChange={(event) => setScriptureAccuracyConfirmed(event.target.checked)}
                      disabled={isPending || isReadOnly || !bodyContent.trim() || !relatedScripture.trim()}
                    />
                    <span>
                      <strong>Translation accuracy check</strong>
                      I confirm the verse wording and reference match the displayed {initialAsset.scriptureTranslation?.trim().toUpperCase() || "Bible translation"}.
                    </span>
                  </label>
                ) : null}
                {initialAsset.assetType === "QUOTE_GRAPHIC" && initialAsset.sourceTranscriptExcerpt ? (
                  <details className={styles.evidence}>
                    <summary>Check against the sermon transcript</summary>
                    <p>{initialAsset.sourceTranscriptExcerpt}</p>
                    <button
                      type="button"
                      className="button tertiary"
                      onClick={() => setBodyContent(initialAsset.sourceTranscriptExcerpt ?? "")}
                      disabled={isPending || isReadOnly}
                    >
                      Use exact transcript wording
                    </button>
                  </details>
                ) : null}
              </>
            )}
          </div>
        </details>

        {scriptureApprovalBlocked ? (
          <div id="scripture-approval-blocker" className={styles.scriptureApprovalBlocker} role="status" aria-live="polite">
            <span>
              <strong>Scripture approval required</strong>
              Confirm the exact verse wording, reference, and displayed translation before final artwork can be rendered.
            </span>
            <button
              type="button"
              className="button secondary"
              aria-controls="studio-words-editor"
              onClick={() => setWordsEditorOpen(true)}
            >
              Review Scripture and confirm
            </button>
          </div>
        ) : null}

        {feedback ? <p className={feedback.success ? "success-banner" : "error-banner"}>{feedback.message}</p> : null}
        {feedback?.success && productionReady && !hasUnsavedChanges ? (
          <a className="button primary" href={`/ready-to-post?contentAssetId=${initialAsset.id}`}>Continue to scheduling</a>
        ) : null}

        <div className={styles.saveActions}>
          <button
            type="button"
            className="button secondary"
            onClick={() => save(false)}
            disabled={isPending || isReadOnly || hasInvalidCopy || !hasUnsavedChanges}
            title={saveDraftBlockReason}
            aria-describedby={saveDraftBlockReason ? "save-draft-help" : undefined}
          >
            {isPending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => save(true)}
            disabled={isPending || isReadOnly || hasInvalidCopy || renderingBlockedByFit || scriptureApprovalBlocked}
            title={renderBlockReason}
            aria-describedby={scriptureApprovalBlocked ? "scripture-approval-blocker" : undefined}
          >
            {isPending ? "Approving artwork…" : "Approve & render final artwork"}
          </button>
        </div>
        {saveDraftBlockReason ? <p id="save-draft-help" className="muted small" role="status">{saveDraftBlockReason}</p> : null}
        <p className={styles.renderNote}>Approval locks this exact design into a new downloadable PNG and JPEG revision.</p>
      </aside>
    </section>
  );
}
