"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties } from "react";

import styles from "@/app/ready-to-post/content-assets/[assetId]/studio/studio.module.css";
import {
  estimateContentSingleLineCapacity,
  renderBrandedContentSvg,
  resolveContentTextLayout,
  type ContentAssetBranding,
} from "@/lib/contentAssetRenderer";
import {
  getContentGraphicTemplate,
  getDefaultTemplateId,
  getTemplatesForAssetType,
  getTemplatesForSlideRole,
  type CarouselSlideRole,
  type CarouselStudioSlide,
  type ContentDesignStudioDocument,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";
import { saveContentAssetDesignAction } from "@/server/actions/contentAssetStudio";

type StudioAsset = {
  id: string;
  assetType: string;
  status: string;
  title: string;
  bodyContent: string;
  sermonTitle: string;
  relatedScripture: string | null;
  sourceTranscriptExcerpt: string | null;
  sourceOpportunityStatus: string | null;
  design: ContentDesignStudioDocument;
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

const PREVIEW_FORMATS: Record<PreviewFormat, { label: string; ratio: string; width: number; height: number }> = {
  SQUARE: { label: "Square post", ratio: "1:1", width: 1080, height: 1080 },
  PORTRAIT: { label: "Portrait post", ratio: "4:5", width: 1080, height: 1350 },
  STORY: { label: "Story", ratio: "9:16", width: 1080, height: 1920 },
  LANDSCAPE: { label: "Landscape", ratio: "1.91:1", width: 1200, height: 630 },
};

const DISPLAY_LOCALE = "en-ZA";
const DISPLAY_TIME_ZONE = "Africa/Johannesburg";

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

function designSignature(input: {
  title: string;
  bodyContent: string;
  relatedScripture: string;
  templateId: ContentGraphicTemplateId;
  slides: CarouselStudioSlide[];
}): string {
  return JSON.stringify(input);
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
  const [title, setTitle] = useState(initialAsset.title);
  const [bodyContent, setBodyContent] = useState(initialAsset.bodyContent);
  const [relatedScripture, setRelatedScripture] = useState(initialAsset.relatedScripture ?? "");
  const [templateId, setTemplateId] = useState<ContentGraphicTemplateId>(initialAsset.design.templateId);
  const [slides, setSlides] = useState<CarouselStudioSlide[]>(initialAsset.design.slides);
  const [selectedSlideId, setSelectedSlideId] = useState(initialAsset.design.slides[0]?.id ?? null);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("PORTRAIT");
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const [productionReady, setProductionReady] = useState(
    () => ["READY", "SCHEDULED"].includes(initialAsset.status) && initialAsset.files.length > 0,
  );
  const [savedSignature, setSavedSignature] = useState(() => designSignature({
    title: initialAsset.title,
    bodyContent: initialAsset.bodyContent,
    relatedScripture: initialAsset.relatedScripture ?? "",
    templateId: initialAsset.design.templateId,
    slides: initialAsset.design.slides,
  }));
  const activeSlideIndex = Math.max(0, slides.findIndex((slide) => slide.id === selectedSlideId));
  const activeSlide = slides[activeSlideIndex] ?? null;
  const selectedTemplate = getContentGraphicTemplate(activeSlide?.templateId ?? templateId);
  const availableTemplateOptions = isCarousel && activeSlide
    ? getTemplatesForSlideRole(activeSlide.role)
    : getTemplatesForAssetType(initialAsset.assetType);
  const templateOptions = availableTemplateOptions.some((template) => template.id === selectedTemplate.id)
    ? availableTemplateOptions
    : [selectedTemplate, ...availableTemplateOptions];
  const previewDimensions = isCarousel
    ? { width: 1080, height: 1350 }
    : PREVIEW_FORMATS[previewFormat];
  const previewCopy = activeSlide?.body ?? bodyContent;
  const previewTitle = activeSlide?.title ?? title;
  const previewScripture = activeSlide ? activeSlide.scripture : relatedScripture;
  const previewSvg = useMemo(() => renderBrandedContentSvg({
    title: previewTitle,
    content: previewCopy,
    scripture: previewScripture,
    branding,
    width: previewDimensions.width,
    height: previewDimensions.height,
    templateId: activeSlide?.templateId ?? templateId,
  }), [activeSlide?.templateId, branding, previewCopy, previewDimensions.height, previewDimensions.width, previewScripture, previewTitle, templateId]);
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
      const layout = resolveContentTextLayout({
        content: input.copy,
        width: input.width,
        height: input.height,
        hasTitle: Boolean(input.heading.trim()),
      });
      if (layout.truncated || layout.horizontalOverflow || layout.verticalOverflow) {
        warnings.push(`${input.label} copy`);
      }
      const titleCapacity = estimateContentSingleLineCapacity({
        width: input.width,
        height: input.height,
        role: "title",
        titleScale: input.template.surface === "BOLD" ? 0.82 : 0.64,
      });
      if (input.heading.replace(/\s+/g, " ").trim().length > titleCapacity) {
        warnings.push(`${input.label} heading`);
      }
      const scriptureCapacity = estimateContentSingleLineCapacity({
        width: input.width,
        height: input.height,
        role: "scripture",
      });
      if ((input.scripture ?? "").replace(/\s+/g, " ").trim().length > scriptureCapacity) {
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
  }, [isCarousel, previewCopy, previewTitle, relatedScripture, slides, templateId]);
  const currentSignature = useMemo(() => designSignature({
    title,
    bodyContent,
    relatedScripture,
    templateId,
    slides,
  }), [bodyContent, relatedScripture, slides, templateId, title]);
  const hasUnsavedChanges = currentSignature !== savedSignature;

  function updateActiveSlide(patch: Partial<CarouselStudioSlide>) {
    if (!activeSlide) return;
    setSlides((current) => current.map((slide) => slide.id === activeSlide.id ? { ...slide, ...patch } : slide));
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
    const slide: CarouselStudioSlide = {
      id: makeSlideId(),
      role,
      templateId: getDefaultTemplateId({ slideRole: role }),
      title: `Point ${slides.length + 1}`,
      body: "Add one clear, sermon-grounded idea.",
      scripture: relatedScripture.trim() || null,
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
        slides: isCarousel ? slides : [],
        rerender,
      });
      setFeedback({ message: result.message, success: result.success });
      if (result.success) {
        setSavedSignature(signatureAtSave);
        setProductionReady(rerender);
        router.refresh();
      }
    });
  }

  const hasInvalidCopy = !title.trim() || (isCarousel
    ? slides.length === 0 || slides.some((slide) => !slide.title.trim() || !slide.body.trim())
    : !bodyContent.trim());
  const renderingBlockedByFit = outputFitWarnings.length > 0;
  const studioStyle = {
    "--studio-primary": branding.primaryColor,
    "--studio-secondary": branding.secondaryColor,
  } as CSSProperties;

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

        <div className={renderingBlockedByFit ? styles.fitWarning : styles.fitSuccess} aria-live="polite">
          <strong>{renderingBlockedByFit ? "Copy needs attention" : "Copy fits the artwork"}</strong>
          <span>
            {renderingBlockedByFit
              ? `Shorten ${outputFitWarnings.join(", ")} before rendering.`
              : isCarousel
                ? "This slide fits the production frame."
                : "Ready in all four social sizes."}
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
            <span className="muted small">{previewDimensions.width}×{previewDimensions.height}</span>
            {isCarousel ? <span className="muted small">Slide {activeSlideIndex + 1} of {slides.length}</span> : null}
          </div>
          <div className={styles.previewStage}>
            <div
              className={styles.svgPreview}
              style={{ aspectRatio: `${previewDimensions.width} / ${previewDimensions.height}` }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
          <div className={styles.previewCaption}>
            <span>Every edit appears here immediately.</span>
            <strong>{selectedTemplate.tone} · {selectedTemplate.alignment.toLowerCase()} aligned</strong>
          </div>
        </div>

        {initialAsset.files.length > 0 ? (
          <details className={styles.renderedFiles}>
            <summary>Rendered production files</summary>
            <div>
              {initialAsset.files.map((file) => (
                <a key={file.id} href={`/api/content-assets/${initialAsset.id}/files/${file.id}`} target="_blank" rel="noreferrer">
                  {file.mimeType.startsWith("image/") && file.width && file.height ? (
                    <Image
                      src={`/api/content-assets/${initialAsset.id}/files/${file.id}`}
                      alt={file.fileName}
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

        <label>
          Artwork heading
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={isPending || isReadOnly} />
          <small className="muted">Shown on the finished design.</small>
        </label>

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
              Reference line <span className={styles.optionalLabel}>Optional</span>
              <input value={activeSlide.scripture ?? ""} onChange={(event) => updateActiveSlide({ scripture: event.target.value || null })} maxLength={200} disabled={isPending || isReadOnly} />
            </label>
          </>
        ) : (
          <>
            <label>
              {copyLabel(initialAsset.assetType)}
              <textarea value={bodyContent} onChange={(event) => setBodyContent(event.target.value)} rows={8} maxLength={20_000} disabled={isPending || isReadOnly} />
              <small className="muted">
                {bodyContent.length.toLocaleString(DISPLAY_LOCALE)} characters · {countWords(bodyContent)} words. {copyGuidance(initialAsset.assetType)}
              </small>
            </label>
            <label>
              Reference line <span className={styles.optionalLabel}>Optional</span>
              <input value={relatedScripture} onChange={(event) => setRelatedScripture(event.target.value)} maxLength={200} disabled={isPending || isReadOnly} />
              <small className="muted">For example, John 3:16 or the speaker’s name.</small>
            </label>
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

        <fieldset className={styles.templatePicker} disabled={isPending || isReadOnly}>
          <legend>Choose a look <span>{templateOptions.length} options</span></legend>
          {templateOptions.map((template) => {
            const selected = (activeSlide?.templateId ?? templateId) === template.id;
            return (
              <button
                type="button"
                key={template.id}
                aria-pressed={selected}
                className={selected ? styles.selectedTemplate : ""}
                onClick={() => activeSlide
                  ? updateActiveSlide({ templateId: template.id })
                  : setTemplateId(template.id)}
              >
                <span className={styles.templateSwatch} data-art-direction={template.artDirection.toLowerCase()} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.templateCopy}>
                  <span><strong>{template.label}</strong><em>{template.tone}</em></span>
                  <span>{template.description}</span>
                </span>
                <span className={styles.templateCheck} aria-hidden="true">✓</span>
              </button>
            );
          })}
        </fieldset>

        {feedback ? <p className={feedback.success ? "success-banner" : "error-banner"}>{feedback.message}</p> : null}
        {feedback?.success && productionReady && !hasUnsavedChanges ? (
          <a className="button primary" href={`/ready-to-post?contentAssetId=${initialAsset.id}`}>Continue to scheduling</a>
        ) : null}

        <div className={styles.saveActions}>
          <button type="button" className="button secondary" onClick={() => save(false)} disabled={isPending || isReadOnly || hasInvalidCopy || !hasUnsavedChanges}>
            {isPending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => save(true)}
            disabled={isPending || isReadOnly || hasInvalidCopy || renderingBlockedByFit}
            title={renderingBlockedByFit ? `Shorten ${outputFitWarnings.join(", ")} before rendering.` : undefined}
          >
            {isPending ? "Rendering…" : "Render final artwork"}
          </button>
        </div>
        <p className={styles.renderNote}>Rendering replaces the downloadable PNG and JPEG files with this exact design.</p>
      </aside>
    </section>
  );
}
