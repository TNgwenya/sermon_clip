"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import {
  formatContentPublishingPlatform,
  normalizeContentHashtags,
  type ContentAssetTypeValue,
  type ContentPublishingPlatform,
} from "@/lib/contentPublishing";
import { isDesignableContentAssetType } from "@/lib/contentGraphicTemplates";
import {
  prepareContentOpportunityForPublishingAction,
  updateContentAssetComposerAction,
} from "@/server/actions/contentAssets";

export type ContentAssetComposerInitialValue = {
  assetId?: string | null;
  sermonId: string;
  sermonTitle: string;
  opportunityId?: string | null;
  assetType?: ContentAssetTypeValue;
  assetTypeLabel: string;
  status?: string | null;
  title: string;
  bodyContent: string;
  caption?: string | null;
  hashtags?: string[] | null;
  callToAction?: string | null;
  platform?: ContentPublishingPlatform | null;
};

type ContentAssetComposerProps = {
  open: boolean;
  initialValue: ContentAssetComposerInitialValue;
  navigateToReadyOnSave?: boolean;
  onClose: () => void;
  onSaved?: (contentAssetId: string) => void;
};

const PLATFORM_OPTIONS: Array<{ value: "" | ContentPublishingPlatform; label: string }> = [
  { value: "", label: "Choose during scheduling" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE_SHORTS", label: "YouTube Shorts" },
];

export function ContentAssetComposer({
  open,
  initialValue,
  navigateToReadyOnSave = false,
  onClose,
  onSaved,
}: ContentAssetComposerProps) {
  const router = useRouter();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialValue.title);
  const [bodyContent, setBodyContent] = useState(initialValue.bodyContent);
  const [caption, setCaption] = useState(initialValue.caption ?? initialValue.bodyContent);
  const [hashtags, setHashtags] = useState((initialValue.hashtags ?? []).join(" "));
  const [callToAction, setCallToAction] = useState(initialValue.callToAction ?? "");
  const [platform, setPlatform] = useState<"" | ContentPublishingPlatform>(initialValue.platform ?? "");
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const isVersionLocked = ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(initialValue.status ?? "");
  const isDesignable = initialValue.assetType
    ? isDesignableContentAssetType(initialValue.assetType)
    : ["Quote graphic", "Scripture graphic", "Carousel"].includes(initialValue.assetTypeLabel);
  const normalizedHashtags = normalizeContentHashtags(hashtags);
  const postPreview = caption.trim() || bodyContent.trim() || "Your post copy will appear here.";

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = requestAnimationFrame(() => {
      if (isVersionLocked) closeButtonRef.current?.focus();
      else titleInputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      returnFocusRef.current?.focus();
    };
  }, [isVersionLocked, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const action = initialValue.assetId
        ? updateContentAssetComposerAction
        : prepareContentOpportunityForPublishingAction;
      const result = await action({
        assetId: initialValue.assetId ?? undefined,
        sermonId: initialValue.sermonId,
        opportunityId: initialValue.opportunityId ?? undefined,
        platform: platform || null,
        title,
        bodyContent,
        caption,
        hashtags: normalizeContentHashtags(hashtags),
        callToAction,
      });

      setFeedback({ message: result.message, success: result.success });
      if (!result.success || !result.contentAssetId) {
        return;
      }

      onSaved?.(result.contentAssetId);
      if (navigateToReadyOnSave) {
        router.push(isDesignable
          ? `/ready-to-post/content-assets/${result.contentAssetId}/studio`
          : result.readyToPostHref ?? `/ready-to-post?contentAssetId=${result.contentAssetId}`);
        return;
      }

      router.refresh();
      onClose();
    });
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !isPending) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    }}>
      <section
        className="feature-modal content-asset-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-asset-composer-title"
        aria-describedby="content-asset-composer-description"
        onKeyDown={handleDialogKeyDown}
      >
        <button ref={closeButtonRef} type="button" className="feature-modal-close" onClick={onClose} disabled={isPending}>Close</button>
        <div className="stack-sm">
          <p className="kicker">Step 2 of 3 · Prepare</p>
          <h2 id="content-asset-composer-title">Make the post yours</h2>
          <p id="content-asset-composer-description" className="muted">
            Edit the content and caption while watching the preview. Saving creates a draft — it will not schedule or publish anything.
          </p>
        </div>

        <ol className="content-asset-composer-steps" aria-label="Publishing progress">
          <li className="is-complete">Idea approved</li>
          <li className="is-current" aria-current="step">Prepare post</li>
          <li>{isDesignable ? "Choose design" : "Schedule"}</li>
        </ol>

        <div className="content-asset-composer-summary">
          <span className="status-pill status-approved">Approved source</span>
          <span className="status-pill">{initialValue.assetTypeLabel}</span>
          <span className="status-pill">{initialValue.sermonTitle}</span>
          {initialValue.status ? <span className="status-pill">{initialValue.status.toLowerCase()}</span> : null}
        </div>

        <div className="content-asset-manual-notice">
          <strong>{isVersionLocked ? "Publishing version locked" : isDesignable ? "Design comes next" : "Scheduling comes next"}</strong>
          <p className="muted small">
            {isVersionLocked
              ? initialValue.status === "SCHEDULED"
                ? "Cancel its scheduled posts before editing, or duplicate the asset to create a separate version."
                : "Published and archived assets preserve exactly what was approved. Duplicate the asset to create a new version."
              : isDesignable
                ? "After saving, choose a template and preview the final square, portrait, or story artwork in Design Studio."
                : "After saving, review the finished post in Ready to Post and choose a date only when your team is ready."}
          </p>
        </div>

        <div className="content-asset-composer-workspace">
          <div className="content-asset-composer-fields">
            <label>
              Working title
              <input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={isPending || isVersionLocked} />
            </label>
            <label>
              Preferred platform
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value as "" | ContentPublishingPlatform)}
                disabled={isPending || isVersionLocked}
              >
                {PLATFORM_OPTIONS.map((option) => (
                  <option key={option.value || "UNSET"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="content-asset-composer-wide">
              {isDesignable ? "Graphic copy" : "Approved content"}
              <textarea value={bodyContent} onChange={(event) => setBodyContent(event.target.value)} rows={7} maxLength={20_000} disabled={isPending || isVersionLocked} />
              <small className="muted">The sermon-grounded source copy. Keep theological meaning intact when editing.</small>
            </label>
            <label className="content-asset-composer-wide">
              Platform caption
              <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={5} maxLength={10_000} disabled={isPending || isVersionLocked} />
              <small className="muted">{caption.length.toLocaleString()} characters · {formatContentPublishingPlatform(platform || null)}</small>
            </label>
            <label>
              Hashtags
              <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#faith #hope" disabled={isPending || isVersionLocked} />
            </label>
            <label>
              Call to action
              <input value={callToAction} onChange={(event) => setCallToAction(event.target.value)} placeholder="Watch the full sermon" maxLength={500} disabled={isPending || isVersionLocked} />
            </label>
          </div>

          <aside className="content-asset-live-preview" aria-label="Live post preview">
            <div className="content-asset-live-preview-heading">
              <div>
                <p className="kicker">Live preview</p>
                <strong>{formatContentPublishingPlatform(platform || null)}</strong>
              </div>
              <span className="status-pill">Draft</span>
            </div>
            {isDesignable ? (
              <div className={`content-asset-creative-preview is-${(initialValue.assetType ?? "OTHER").toLowerCase().replace(/_/g, "-")}`}>
                <span>{initialValue.sermonTitle}</span>
                <blockquote>{bodyContent.trim() || "Your graphic copy will appear here."}</blockquote>
                <small>{initialValue.assetTypeLabel}</small>
              </div>
            ) : null}
            <div className="content-asset-social-preview">
              <div className="content-asset-social-preview-account">
                <span aria-hidden="true">{initialValue.sermonTitle.trim().charAt(0).toUpperCase() || "S"}</span>
                <div>
                  <strong>{initialValue.sermonTitle}</strong>
                  <small>{formatContentPublishingPlatform(platform || null)}</small>
                </div>
              </div>
              <p>{postPreview}</p>
              {normalizedHashtags.length > 0 ? <span>{normalizedHashtags.join(" ")}</span> : null}
              {callToAction.trim() ? <strong className="content-asset-preview-cta">{callToAction.trim()}</strong> : null}
            </div>
            <p className="muted small">Preview updates as you type. You can make more changes before scheduling.</p>
          </aside>
        </div>

        {feedback ? <p className={feedback.success ? "success-banner" : "error-banner"}>{feedback.message}</p> : null}

        <div className="feature-modal-footer">
          <a className="button tertiary" href={`/api/content-packs/${initialValue.sermonId}/download`}>Download production pack</a>
          <button type="button" className="button secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            type="button"
            className="button primary"
            onClick={save}
            disabled={isPending || isVersionLocked || !title.trim() || !bodyContent.trim() || !caption.trim()}
          >
            {isPending
              ? "Saving draft..."
              : isVersionLocked
                ? "Locked — duplicate to edit"
                : isDesignable
                  ? "Save & choose design"
                  : "Save & continue to scheduling"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
