"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import styles from "@/app/ready-to-post/content-assets/[assetId]/studio/studio.module.css";
import { renderBrandedContentSvg, type ContentAssetBranding } from "@/lib/contentAssetRenderer";
import {
  CONTENT_GRAPHIC_TEMPLATES,
  getContentGraphicTemplate,
  getDefaultTemplateId,
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

const PREVIEW_FORMATS: Record<PreviewFormat, { label: string; width: number; height: number }> = {
  SQUARE: { label: "Square", width: 1080, height: 1080 },
  PORTRAIT: { label: "Portrait", width: 1080, height: 1350 },
  STORY: { label: "Story", width: 1080, height: 1920 },
  LANDSCAPE: { label: "Facebook", width: 1200, height: 630 },
};

function makeSlideId(): string {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function templateCompatibleWithGraphic(role: string): boolean {
  return !["COVER", "CONTENT", "CTA"].includes(role);
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
  const [message, setMessage] = useState("");
  const activeSlideIndex = Math.max(0, slides.findIndex((slide) => slide.id === selectedSlideId));
  const activeSlide = slides[activeSlideIndex] ?? null;
  const selectedTemplate = getContentGraphicTemplate(activeSlide?.templateId ?? templateId);
  const templateOptions = isCarousel && activeSlide
    ? getTemplatesForSlideRole(activeSlide.role)
    : CONTENT_GRAPHIC_TEMPLATES.filter((template) => templateCompatibleWithGraphic(template.role));
  const previewDimensions = isCarousel
    ? { width: 1080, height: 1350 }
    : PREVIEW_FORMATS[previewFormat];
  const previewSvg = useMemo(() => renderBrandedContentSvg({
    title: activeSlide?.title ?? title,
    content: activeSlide?.body ?? bodyContent,
    scripture: activeSlide?.scripture ?? relatedScripture,
    branding,
    width: previewDimensions.width,
    height: previewDimensions.height,
    templateId: activeSlide?.templateId ?? templateId,
  }), [activeSlide, branding, bodyContent, previewDimensions.height, previewDimensions.width, relatedScripture, templateId, title]);

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
    setMessage("");
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
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  const hasInvalidCopy = !title.trim() || (isCarousel
    ? slides.length === 0 || slides.some((slide) => !slide.title.trim() || !slide.body.trim())
    : !bodyContent.trim());

  return (
    <section className={styles.workspace} aria-label="Content Design Studio">
      <aside className={styles.rail}>
        <div className="stack-sm">
          <p className="kicker">{initialAsset.sermonTitle}</p>
          <h2>{isCarousel ? `${slides.length} slide carousel` : "Graphic settings"}</h2>
          <p className="muted small">Last saved {new Date(initialAsset.updatedAt).toLocaleString()}</p>
        </div>

        {isCarousel ? (
          <>
            <div className={styles.slideList} role="list" aria-label="Carousel slides">
              {slides.map((slide, index) => (
                <button
                  type="button"
                  role="listitem"
                  key={slide.id}
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
              <button type="button" key={id} className={previewFormat === id ? styles.selectedFormat : ""} onClick={() => setPreviewFormat(id)}>
                {format.label}
              </button>
            ))}
          </div>
        )}

        <div className={styles.fileSummary}>
          <strong>{initialAsset.files.length} rendered file{initialAsset.files.length === 1 ? "" : "s"}</strong>
          <span className="muted small">Status: {initialAsset.status.toLowerCase()}</span>
        </div>
      </aside>

      <div className={styles.canvasColumn}>
        <div className={styles.previewToolbar}>
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
        <p className="muted small">Live preview. Rerender to replace the downloadable PNG and JPEG production files.</p>

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
        <div className="stack-sm">
          <p className="kicker">Edit</p>
          <h2>{isCarousel ? `Slide ${activeSlideIndex + 1}` : "Post artwork"}</h2>
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
          Working title
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={isPending || isReadOnly} />
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
              <small className="muted">{activeSlide.body.length.toLocaleString()} characters. One clear thought per slide reads best.</small>
            </label>
            <label>
              Scripture reference
              <input value={activeSlide.scripture ?? ""} onChange={(event) => updateActiveSlide({ scripture: event.target.value || null })} maxLength={200} disabled={isPending || isReadOnly} />
            </label>
          </>
        ) : (
          <>
            <label>
              Graphic copy
              <textarea value={bodyContent} onChange={(event) => setBodyContent(event.target.value)} rows={8} maxLength={20_000} disabled={isPending || isReadOnly} />
              <small className="muted">{bodyContent.length.toLocaleString()} characters</small>
            </label>
            <label>
              Scripture reference
              <input value={relatedScripture} onChange={(event) => setRelatedScripture(event.target.value)} maxLength={200} disabled={isPending || isReadOnly} />
            </label>
            {initialAsset.assetType === "QUOTE_GRAPHIC" && initialAsset.sourceTranscriptExcerpt ? (
              <details className={styles.evidence}>
                <summary>Compare transcript evidence</summary>
                <p>{initialAsset.sourceTranscriptExcerpt}</p>
              </details>
            ) : null}
          </>
        )}

        <fieldset className={styles.templatePicker} disabled={isPending || isReadOnly}>
          <legend>Church template</legend>
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
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </button>
            );
          })}
        </fieldset>

        {message ? <p className={message.toLowerCase().includes("could not") || message.toLowerCase().includes("before") || message.toLowerCase().includes("failed") ? "error-banner" : "success-banner"}>{message}</p> : null}

        <div className={styles.saveActions}>
          <button type="button" className="button secondary" onClick={() => save(false)} disabled={isPending || isReadOnly || hasInvalidCopy}>
            {isPending ? "Saving…" : "Save copy"}
          </button>
          <button type="button" className="button primary" onClick={() => save(true)} disabled={isPending || isReadOnly || hasInvalidCopy}>
            {isPending ? "Rendering…" : "Save & rerender"}
          </button>
        </div>
      </aside>
    </section>
  );
}
