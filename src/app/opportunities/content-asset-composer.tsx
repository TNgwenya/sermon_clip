"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";

import {
  formatContentPublishingPlatform,
  normalizeContentHashtags,
  type ContentPublishingPlatform,
} from "@/lib/contentPublishing";
import {
  prepareContentOpportunityForPublishingAction,
  updateContentAssetComposerAction,
} from "@/server/actions/contentAssets";

export type ContentAssetComposerInitialValue = {
  assetId?: string | null;
  sermonId: string;
  sermonTitle: string;
  opportunityId?: string | null;
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
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialValue.title);
  const [bodyContent, setBodyContent] = useState(initialValue.bodyContent);
  const [caption, setCaption] = useState(initialValue.caption ?? initialValue.bodyContent);
  const [hashtags, setHashtags] = useState((initialValue.hashtags ?? []).join(" "));
  const [callToAction, setCallToAction] = useState(initialValue.callToAction ?? "");
  const [platform, setPlatform] = useState<"" | ContentPublishingPlatform>(initialValue.platform ?? "");
  const [message, setMessage] = useState("");
  const isVersionLocked = ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(initialValue.status ?? "");

  if (!open || typeof document === "undefined") {
    return null;
  }

  function save() {
    setMessage("");
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

      setMessage(result.message);
      if (!result.success || !result.contentAssetId) {
        return;
      }

      onSaved?.(result.contentAssetId);
      if (navigateToReadyOnSave) {
        router.push(result.readyToPostHref ?? `/ready-to-post?contentAssetId=${result.contentAssetId}`);
        return;
      }

      router.refresh();
      onClose();
    });
  }

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    }}>
      <section className="feature-modal content-asset-composer" role="dialog" aria-modal="true" aria-labelledby="content-asset-composer-title">
        <button type="button" className="feature-modal-close" onClick={onClose} disabled={isPending}>Close</button>
        <div className="stack-sm">
          <p className="kicker">Prepare for publishing</p>
          <h2 id="content-asset-composer-title">Review the post package</h2>
          <p className="muted">
            This creates one operational asset from the approved sermon content. Your team can edit it again before placing it on the calendar.
          </p>
        </div>

        <div className="content-asset-composer-summary">
          <span className="status-pill status-approved">Approved source</span>
          <span className="status-pill">{initialValue.assetTypeLabel}</span>
          <span className="status-pill">{initialValue.sermonTitle}</span>
          {initialValue.status ? <span className="status-pill">{initialValue.status.toLowerCase()}</span> : null}
        </div>

        <div className="content-asset-manual-notice">
          <strong>{isVersionLocked ? "Publishing version locked" : "Media-team handoff"}</strong>
          <p className="muted small">
            {isVersionLocked
              ? initialValue.status === "SCHEDULED"
                ? "Cancel its scheduled posts before editing, or duplicate the asset to create a separate version."
                : "Published and archived assets preserve exactly what was approved. Duplicate the asset to create a new version."
              : "Non-video posts use reviewed manual handoff for now. Automatic image and carousel publishing stays off until each platform route is verified."}
          </p>
        </div>

        <div className="content-asset-composer-fields">
          <label>
            Working title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={isPending || isVersionLocked} />
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
            Approved content
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

        {message ? <p className={message.toLowerCase().includes("could not") || message.toLowerCase().includes("before") ? "error-banner" : "success-banner"}>{message}</p> : null}

        <div className="feature-modal-footer">
          <a className="button tertiary" href={`/api/content-packs/${initialValue.sermonId}/download`}>Download production pack</a>
          <button type="button" className="button secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            type="button"
            className="button primary"
            onClick={save}
            disabled={isPending || isVersionLocked || !title.trim() || !bodyContent.trim() || !caption.trim()}
          >
            {isPending ? "Preparing..." : isVersionLocked ? "Locked — duplicate to edit" : "Save to Ready to Post"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
