"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import styles from "@/app/ready-to-post/generated-content-assets.module.css";

import {
  CONTENT_ASSET_TYPE_LABELS,
  buildContentAssetHandoffText,
  formatContentPublishingPlatform,
  type ContentAssetTypeValue,
  type ContentPublishingPlatform,
} from "@/lib/contentPublishing";
import { toDateTimeLocalInputValue } from "@/lib/postingSchedule";
import {
  selectContentPublishingFiles,
  supportsManualContentHandoffWithoutMedia,
} from "@/lib/contentPublishingPreflight";
import type { PublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { isDesignableContentAssetType } from "@/lib/contentGraphicTemplates";
import {
  CONTENT_ASSET_SCHEDULED_EVENT,
  buildContentScheduleSuccessCopy,
  getContentScheduleValidationMessage,
  resolveWrappedDialogFocusIndex,
  scheduledPostElementId,
  type ContentAssetScheduleCreatedDetail,
} from "@/lib/contentScheduleUi";
import { ContentAssetComposer } from "@/app/opportunities/content-asset-composer";
import { ContentIdeasPostingGuide } from "@/components/content-ideas-posting-guide";
import {
  buildOpportunityHref,
  buildScheduledPostHref,
  hasApprovedAssetPublishingRevision,
} from "@/lib/contentWorkflowUi";
import { scheduleContentAssetAction } from "@/server/actions/contentAssets";

export type ReadyContentAsset = {
  id: string;
  sermonId: string;
  sermonTitle: string;
  contentOpportunityId: string | null;
  assetType: ContentAssetTypeValue;
  status: "GENERATED" | "APPROVED" | "PREPARED" | "READY" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  platform: ContentPublishingPlatform | null;
  title: string;
  bodyContent: string | null;
  caption: string | null;
  hashtags: string[];
  callToAction: string | null;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  currentRevision: {
    revisionNumber: number;
    approvalState: "DRAFT" | "APPROVED" | "REAPPROVAL_REQUIRED";
    approvedAt: string | null;
  } | null;
  sourceOpportunityStatus: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "USED" | "ARCHIVED" | null;
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    publicUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
  scheduledPosts: Array<{
    id: string;
    platform: ContentPublishingPlatform;
    status: string;
    scheduledFor: string | null;
  }>;
};

export type ContentAssetPublishingAccount = {
  id: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  label: string;
  handle: string | null;
};

type ContentAssetScheduleModalProps = {
  asset: ReadyContentAsset;
  metaPublishingAccounts: ContentAssetPublishingAccount[];
  publishingServiceHealth?: Pick<PublishingServiceHealth, "status" | "dryRun" | "summary"> | null;
  open: boolean;
  onClose: () => void;
  onScheduled: (detail: ContentAssetScheduleCreatedDetail) => void;
};

type ContentAssetAutomationMode = "MANUAL" | "AUTOMATIC";

const PLATFORM_OPTIONS: Array<{ value: ContentPublishingPlatform; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE_SHORTS", label: "YouTube Shorts" },
];

const DISPLAY_LOCALE = "en";
const DEFAULT_DISPLAY_TIME_ZONE = "Africa/Johannesburg";

function scheduleDefaultValue(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toDateTimeLocalInputValue(date);
}

function onlyAccountIdForPlatform(
  accounts: ContentAssetPublishingAccount[],
  platform: ContentPublishingPlatform,
): string {
  const matching = accounts.filter((account) => account.platform === platform);
  return matching.length === 1 ? matching[0].id : "";
}

function ContentAssetScheduleModal({
  asset,
  metaPublishingAccounts,
  publishingServiceHealth,
  open,
  onClose,
  onScheduled,
}: ContentAssetScheduleModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<ContentPublishingPlatform>(asset.platform ?? "INSTAGRAM");
  const [automationMode, setAutomationMode] = useState<ContentAssetAutomationMode>("MANUAL");
  const [socialAccountId, setSocialAccountId] = useState(() => (
    onlyAccountIdForPlatform(metaPublishingAccounts, asset.platform ?? "INSTAGRAM")
  ));
  const [scheduledFor, setScheduledFor] = useState(scheduleDefaultValue);
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const [title, setTitle] = useState(asset.title);
  const [caption, setCaption] = useState(() => buildContentAssetHandoffText(asset));
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const supportsManualWithoutMedia = supportsManualContentHandoffWithoutMedia(asset.assetType);
  const automaticAccounts = metaPublishingAccounts.filter((account) => account.platform === platform);
  const publishingFiles = selectContentPublishingFiles({
    assetType: asset.assetType,
    platform: formatContentPublishingPlatform(platform) as "Instagram" | "Facebook" | "TikTok" | "YouTube Shorts",
    files: asset.files,
  });
  const automaticBlocker = automationMode === "AUTOMATIC"
    ? asset.assetType === "STORY"
      ? "Story sets stay manual so your team can add native stickers and interactions."
      : platform !== "INSTAGRAM" && platform !== "FACEBOOK"
        ? "Automatic non-video publishing is currently available for Facebook and Instagram images."
        : publishingServiceHealth?.status && publishingServiceHealth.status !== "ONLINE"
          ? publishingServiceHealth.status === "STALE"
            ? "The publishing service has not checked in recently. Restart it before scheduling an automatic post."
            : "Start the publishing service and wait for its first check-in before scheduling an automatic post."
          : publishingServiceHealth?.dryRun
            ? "The publishing service is in test mode. Turn off dry-run mode before scheduling an automatic post."
        : publishingFiles.length === 0
          ? "Render a platform-ready image before automatic publishing."
          : asset.assetType === "CAROUSEL" && (publishingFiles.length < 2 || publishingFiles.length > 10)
            ? "A Meta carousel needs between 2 and 10 publishing slides."
            : platform === "INSTAGRAM" && publishingFiles.some((file) => file.mimeType !== "image/jpeg" && file.mimeType !== "image/jpg")
              ? "Render JPEG publishing media before automatic Instagram posting."
              : automaticAccounts.length === 0
                ? `Connect a ${formatContentPublishingPlatform(platform)} account with publishing permission first.`
                : !socialAccountId
                  ? "Choose the connected account that should publish this post."
                  : null
    : null;
  const needsPublicUpload = automationMode === "AUTOMATIC"
    && publishingFiles.some((file) => !/^https:\/\//i.test(file.publicUrl?.trim() ?? ""));
  const validationMessage = getContentScheduleValidationMessage({
    scheduledFor,
    timezone,
    title,
    caption,
  });
  const blockingMessage = automaticBlocker ?? validationMessage;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousRootOverflow = root.style.overflow;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    const backdrop = dialogRef.current?.parentElement ?? null;
    const backgroundState = Array.from(body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({ element, inert: element.inert }));

    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
    backgroundState.forEach(({ element }) => {
      element.inert = true;
    });

    const focusFrame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      root.style.overflow = previousRootOverflow;
      backgroundState.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      window.requestAnimationFrame(() => {
        if (returnFocusTo?.isConnected) returnFocusTo.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!isPending) {
          event.preventDefault();
          onClose();
        } else {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>([
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","))).filter((element) => (
        element.getAttribute("aria-hidden") !== "true"
        && window.getComputedStyle(element).visibility !== "hidden"
      ));
      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
      const targetIndex = resolveWrappedDialogFocusIndex(currentIndex, focusableElements.length, event.shiftKey);
      if (targetIndex === null) return;
      event.preventDefault();
      focusableElements[targetIndex]?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPending, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  function schedule() {
    setFeedback(null);
    if (blockingMessage) {
      setFeedback({ message: blockingMessage, success: false });
      return;
    }
    startTransition(async () => {
      const result = await scheduleContentAssetAction({
        assetId: asset.id,
        platform,
        scheduledFor,
        timezone,
        title,
        caption,
        postingSlot: `${CONTENT_ASSET_TYPE_LABELS[asset.assetType]} handoff`,
        note,
        automationMode,
        socialAccountId: automationMode === "AUTOMATIC" ? socialAccountId : undefined,
      });
      if (!result.success || !result.scheduledPostId) {
        setFeedback({
          message: result.success ? "The post was scheduled, but its calendar entry could not be confirmed. Refresh the publishing desk." : result.message,
          success: false,
        });
        return;
      }
      const detail: ContentAssetScheduleCreatedDetail = {
        scheduledPostId: result.scheduledPostId,
        scheduledFor,
        timezone,
        automationMode,
        title: title.trim(),
        platformLabel: formatContentPublishingPlatform(platform),
      };
      router.refresh();
      onScheduled(detail);
    });
  }

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    }}>
      <section
        ref={dialogRef}
        className="feature-modal content-asset-schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-asset-schedule-title"
        aria-describedby="content-asset-schedule-description"
      >
        <button
          ref={initialFocusRef}
          type="button"
          className="feature-modal-close"
          onClick={onClose}
          disabled={isPending}
          aria-label="Close scheduling dialog"
        >
          Close
        </button>
        <div className="stack-sm">
          <p className="kicker">Mixed-content calendar</p>
          <h2 id="content-asset-schedule-title">Schedule generated content</h2>
          <p id="content-asset-schedule-description" className="muted">Choose a manual media-team handoff or let Sermon Clip publish eligible Meta images at the planned time.</p>
        </div>

        <div className="content-asset-manual-notice">
          <strong>{automationMode === "AUTOMATIC" ? "Automatic Meta publishing" : "Manual publishing handoff"}</strong>
          <p className="muted small">
            {automationMode === "AUTOMATIC"
              ? needsPublicUpload
                ? "Sermon Clip will upload the selected JPEG publishing files to public storage, verify the connection and media, then place the post in the automatic queue."
                : "Sermon Clip will verify the connected account and public media, then publish the image or carousel at the chosen time."
              : supportsManualWithoutMedia && publishingFiles.length === 0
                ? "This approved document or text package can go on the calendar without a social image. Your team can copy or download it at the planned time; automatic Meta publishing still requires rendered images."
                : "At the chosen time, your team can download the asset, copy this caption, and finish any native stickers or platform setup."}
          </p>
        </div>

        <div className="content-asset-composer-fields">
          <label>
            Publishing method
            <select
              value={automationMode}
              onChange={(event) => {
                const nextMode = event.target.value as ContentAssetAutomationMode;
                setAutomationMode(nextMode);
                setFeedback(null);
                if (nextMode === "AUTOMATIC" && platform !== "INSTAGRAM" && platform !== "FACEBOOK") {
                  const fallbackPlatform = metaPublishingAccounts.some((account) => account.platform === "INSTAGRAM")
                    ? "INSTAGRAM"
                    : "FACEBOOK";
                  setPlatform(fallbackPlatform);
                  setSocialAccountId(onlyAccountIdForPlatform(metaPublishingAccounts, fallbackPlatform));
                }
              }}
              disabled={isPending}
            >
              <option value="MANUAL">Manual media-team handoff</option>
              <option value="AUTOMATIC">Automatic Facebook / Instagram images</option>
            </select>
          </label>
          <label>
            Platform
            <select
              value={platform}
              onChange={(event) => {
                const nextPlatform = event.target.value as ContentPublishingPlatform;
                setPlatform(nextPlatform);
                setSocialAccountId(onlyAccountIdForPlatform(metaPublishingAccounts, nextPlatform));
                setFeedback(null);
              }}
              disabled={isPending}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={automationMode === "AUTOMATIC" && option.value !== "INSTAGRAM" && option.value !== "FACEBOOK"}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {automationMode === "AUTOMATIC" ? (
            <label className="content-asset-composer-wide">
              Publishing account
              <select
                value={socialAccountId}
                onChange={(event) => {
                  setSocialAccountId(event.target.value);
                  setFeedback(null);
                }}
                disabled={isPending || automaticAccounts.length === 0}
                aria-invalid={!socialAccountId}
              >
                <option value="">Choose a connected account</option>
                {automaticAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.handle ? ` · ${account.handle}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Date and time
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => {
                setScheduledFor(event.target.value);
                setFeedback(null);
              }}
              disabled={isPending}
              required
              aria-invalid={!scheduledFor || Boolean(validationMessage?.includes("date and time"))}
              aria-describedby={validationMessage ? "content-asset-schedule-validation" : undefined}
            />
          </label>
          <label>
            Timezone
            <input
              value={timezone}
              onChange={(event) => {
                setTimezone(event.target.value);
                setFeedback(null);
              }}
              maxLength={100}
              disabled={isPending}
              required
              aria-invalid={Boolean(validationMessage?.toLowerCase().includes("timezone"))}
              aria-describedby={validationMessage ? "content-asset-schedule-validation" : undefined}
            />
          </label>
          <label>
            Post title
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setFeedback(null);
              }}
              maxLength={255}
              disabled={isPending}
              required
              aria-invalid={!title.trim()}
              aria-describedby={!title.trim() ? "content-asset-schedule-validation" : undefined}
            />
          </label>
          <label className="content-asset-composer-wide">
            Post copy
            <textarea
              value={caption}
              onChange={(event) => {
                setCaption(event.target.value);
                setFeedback(null);
              }}
              rows={7}
              maxLength={63_206}
              disabled={isPending}
              required
              aria-invalid={!caption.trim()}
              aria-describedby={!caption.trim() ? "content-asset-schedule-validation" : undefined}
            />
          </label>
          <label className="content-asset-composer-wide">
            Optional note
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setFeedback(null);
              }}
              rows={2}
              maxLength={500}
              disabled={isPending}
            />
          </label>
        </div>

        {blockingMessage ? (
          <p id="content-asset-schedule-validation" className="error-banner" role="alert" aria-live="assertive" aria-atomic="true">
            {blockingMessage}
          </p>
        ) : null}
        {feedback ? (
          <p
            className={feedback.success ? "success-banner" : "error-banner"}
            role={feedback.success ? "status" : "alert"}
            aria-live={feedback.success ? "polite" : "assertive"}
            aria-atomic="true"
          >
            {feedback.message}
          </p>
        ) : null}

        <div className="feature-modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            type="button"
            className="button primary"
            onClick={schedule}
            disabled={isPending || Boolean(blockingMessage)}
          >
            {isPending ? "Scheduling..." : automationMode === "AUTOMATIC" ? "Schedule automatic post" : "Add manual handoff"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function formatScheduledTime(value: string | null): string {
  if (!value) return "Time pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time pending";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  }).format(date);
}

function selectPreviewFile(asset: ReadyContentAsset): ReadyContentAsset["files"][number] | null {
  const imageFiles = asset.files.filter((file) => file.mimeType.startsWith("image/"));
  if (imageFiles.length === 0) return null;

  return imageFiles.find((file) => /(?:^|\/)portrait\.jpe?g$/i.test(file.fileName))
    ?? imageFiles.find((file) => /(?:^|\/)square\.jpe?g$/i.test(file.fileName))
    ?? imageFiles.find((file) => /(?:^|\/)portrait\.png$/i.test(file.fileName))
    ?? imageFiles.find((file) => /(?:^|\/)square\.png$/i.test(file.fileName))
    ?? imageFiles.find((file) => /\.jpe?g$/i.test(file.fileName) && file.width && file.height && file.height >= file.width)
    ?? imageFiles.find((file) => file.width && file.height && file.height >= file.width)
    ?? imageFiles[0];
}

export function GeneratedContentAssets({
  assets,
  focusedAssetId,
  metaPublishingAccounts = [],
  publishingServiceHealth = null,
}: {
  assets: ReadyContentAsset[];
  focusedAssetId?: string | null;
  metaPublishingAccounts?: ContentAssetPublishingAccount[];
  publishingServiceHealth?: Pick<PublishingServiceHealth, "status" | "dryRun" | "summary"> | null;
}) {
  const router = useRouter();
  const [composerAssetId, setComposerAssetId] = useState<string | null>(null);
  const [scheduleAssetId, setScheduleAssetId] = useState<string | null>(null);
  const [scheduleConfirmation, setScheduleConfirmation] = useState<ContentAssetScheduleCreatedDetail | null>(null);
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | ReadyContentAsset["status"]>(() => {
    const focusedStatus = focusedAssetId ? assets.find((asset) => asset.id === focusedAssetId)?.status : null;
    return focusedStatus === "PUBLISHED" || focusedStatus === "ARCHIVED" ? focusedStatus : "ACTIVE";
  });
  const visibleAssets = useMemo(() => assets.filter((asset) => (
    statusFilter === "ACTIVE"
      ? asset.status !== "ARCHIVED" && asset.status !== "PUBLISHED"
      : asset.status === statusFilter
  )), [assets, statusFilter]);
  const composerAsset = composerAssetId ? assets.find((asset) => asset.id === composerAssetId) ?? null : null;
  const scheduleAsset = scheduleAssetId ? assets.find((asset) => asset.id === scheduleAssetId) ?? null : null;
  const scheduleSuccessCopy = scheduleConfirmation
    ? buildContentScheduleSuccessCopy(scheduleConfirmation)
    : null;

  function showScheduledPost(detail: ContentAssetScheduleCreatedDetail) {
    window.dispatchEvent(new CustomEvent<ContentAssetScheduleCreatedDetail>(CONTENT_ASSET_SCHEDULED_EVENT, {
      detail,
    }));
  }

  if (assets.length === 0) {
    return (
      <section id="generated-content-assets" className="generated-content-assets-panel">
        <div className="stack-sm">
          <p className="kicker">Generated content</p>
          <h2>No prepared non-video posts yet</h2>
          <p className="muted">Approve a quote, carousel, prayer, devotional, discussion post, or invitation, then choose Prepare for publishing.</p>
        </div>
        <ContentIdeasPostingGuide compact />
        <a className="button primary" href="/opportunities">Open Publishing Ideas</a>
      </section>
    );
  }

  return (
    <section id="generated-content-assets" className="generated-content-assets-panel stack-md" aria-label="Prepared generated content">
      <div className="generated-content-assets-heading">
        <div className="stack-sm">
          <p className="kicker">Your publishing workspace</p>
          <h2>Review the post, refine it, then choose when to share it</h2>
          <p className="muted">The artwork and copy stay together here, so your team can plan confidently before anything reaches the calendar.</p>
        </div>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="ACTIVE">Active</option>
            <option value="READY">Ready</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
      </div>

      <ol className={styles.workflow} aria-label="Generated content publishing steps">
        <li className={styles.currentStep}><span>1</span><div><strong>Preview</strong><small>See the finished artwork and copy.</small></div></li>
        <li><span>2</span><div><strong>Refine</strong><small>Edit words or polish the design.</small></div></li>
        <li><span>3</span><div><strong>Schedule</strong><small>Choose a date only when it is ready.</small></div></li>
      </ol>

      <ContentIdeasPostingGuide compact />

      {scheduleConfirmation && scheduleSuccessCopy ? (
        <div className={`success-banner ${styles.scheduleSuccess}`} role="status" aria-live="polite" aria-atomic="true">
          <div className={styles.scheduleSuccessCopy}>
            <strong>{scheduleSuccessCopy.heading}</strong>
            <span>{scheduleSuccessCopy.description}</span>
            <small>{scheduleSuccessCopy.scheduledTime} · {scheduleConfirmation.timezone}</small>
          </div>
          <div className={styles.scheduleSuccessActions}>
            <button
              type="button"
              className="button secondary"
              onClick={() => showScheduledPost(scheduleConfirmation)}
              aria-controls={scheduledPostElementId(scheduleConfirmation.scheduledPostId)}
            >
              View in calendar
            </button>
            <button type="button" className="button tertiary" onClick={() => setScheduleConfirmation(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="generated-content-asset-grid">
        {visibleAssets.map((asset) => {
          const latestSchedule = asset.scheduledPosts[0] ?? null;
          const copyText = buildContentAssetHandoffText(asset);
          const canExportGuidePdf = ["DEVOTIONAL", "PRAYER", "DISCUSSION", "GUIDE", "SERMON_RECAP"].includes(asset.assetType);
          const isVersionLocked = ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(asset.status);
          const supportsManualWithoutMedia = supportsManualContentHandoffWithoutMedia(asset.assetType);
          const previewFile = selectPreviewFile(asset);
          const isDesignable = isDesignableContentAssetType(asset.assetType);
          const hasApprovedPublishingRevision = hasApprovedAssetPublishingRevision({
            currentRevisionId: asset.currentRevisionId,
            approvedRevisionId: asset.approvedRevisionId,
            currentRevisionApprovalState: asset.currentRevision?.approvalState,
          });
          const revisionNeedsApproval = !hasApprovedPublishingRevision;
          const approvedVersion = hasApprovedPublishingRevision
            ? asset.currentRevision?.revisionNumber ?? null
            : null;
          const sourceIdeaHref = asset.contentOpportunityId
            ? buildOpportunityHref(asset.sermonId, asset.contentOpportunityId)
            : null;
          return (
            <article key={asset.id} className={`generated-content-asset-card ${asset.id === focusedAssetId ? "is-focused" : ""}`}>
              <div className="generated-content-asset-card-head">
                <div>
                  <span className="small muted">{asset.sermonTitle}</span>
                  <h3>{asset.title}</h3>
                </div>
                <div className="clip-badge-row">
                  <span className="status-pill">{CONTENT_ASSET_TYPE_LABELS[asset.assetType]}</span>
                  <span className={`status-pill ${revisionNeedsApproval ? "tone-warning" : asset.status === "READY" ? "status-exported" : asset.status === "PUBLISHED" ? "status-approved" : ""}`}>
                    {revisionNeedsApproval ? "review required" : asset.status.toLowerCase()}
                  </span>
                </div>
              </div>
              <div className={styles.assetWorkspace}>
                <div className={styles.previewColumn}>
                  {previewFile ? (
                    <a
                      className={styles.previewLink}
                      href={isDesignable
                        ? `/ready-to-post/content-assets/${asset.id}/studio`
                        : `/api/content-assets/${asset.id}/files/${previewFile.id}`}
                      aria-label={isDesignable ? `Review the design for ${asset.title}` : `Open the preview for ${asset.title}`}
                    >
                      <Image
                        className={styles.previewImage}
                        src={`/api/content-assets/${asset.id}/files/${previewFile.id}`}
                        alt={`Preview of ${asset.title}`}
                        width={previewFile.width ?? 1080}
                        height={previewFile.height ?? 1350}
                        loading={asset.id === focusedAssetId ? "eager" : "lazy"}
                        unoptimized
                      />
                      <span>{isDesignable ? "Review design" : "Open preview"}</span>
                    </a>
                  ) : (
                    <div className={styles.previewPlaceholder}>
                      <span>{CONTENT_ASSET_TYPE_LABELS[asset.assetType]}</span>
                      <strong>{supportsManualWithoutMedia ? "Copy ready to review" : "Artwork needs rendering"}</strong>
                      <small>{supportsManualWithoutMedia ? "Review the words before scheduling." : "Open the design tools to create the final preview."}</small>
                    </div>
                  )}
                </div>

                <div className={styles.reviewColumn}>
                  <div>
                    <span className={styles.sectionLabel}>Post copy</span>
                    <p className={styles.copyPreview}>{(asset.caption?.trim() || asset.bodyContent?.trim() || "Copy pending").slice(0, 420)}{(asset.caption?.length ?? asset.bodyContent?.length ?? 0) > 420 ? "..." : ""}</p>
                  </div>
                  <div className="generated-content-asset-meta">
                    <span>{formatContentPublishingPlatform(asset.platform)}</span>
                    <span>{asset.files.length > 0
                      ? `${asset.files.length} production file${asset.files.length === 1 ? "" : "s"}`
                      : supportsManualWithoutMedia
                        ? "Manual document/text handoff"
                        : "Media render required"}</span>
                    {latestSchedule ? <span>{formatScheduledTime(latestSchedule.scheduledFor)}</span> : null}
                  </div>
                  {asset.assetType === "STORY" ? (
                    <p className="status-help">Native poll, quiz, slider, and question-box stickers are added manually in the platform app.</p>
                  ) : null}
                  {isVersionLocked ? (
                    <p className="status-help">
                      {asset.status === "SCHEDULED"
                        ? "This scheduled version is protected. Remove its planned post to edit it, or make a fresh version from Content Ideas."
                        : "This version preserves what was published. Make a fresh version from Content Ideas for future changes."}
                    </p>
                  ) : null}
                  <div className={`${styles.approvalState} ${revisionNeedsApproval ? styles.needsApproval : ""}`}>
                    <strong>{revisionNeedsApproval
                      ? "Review required"
                      : approvedVersion
                        ? `Approved publishing version v${approvedVersion}`
                        : "Publishing version ready"}</strong>
                    <span>{revisionNeedsApproval
                      ? "This publishing version is not approved. Review its words and evidence before placing it on the calendar."
                      : approvedVersion
                        ? "The exact approved words and artwork stay attached to every scheduled post."
                        : "A protected revision will be recorded when this post is scheduled."}</span>
                  </div>
                </div>
              </div>

              <div className={styles.primaryActions}>
                {revisionNeedsApproval ? (
                  <button type="button" className="button primary" onClick={() => setComposerAssetId(asset.id)}>
                    Review publishing version
                  </button>
                ) : asset.status === "PREPARED" && isDesignable ? (
                  <a className="button primary" href={`/ready-to-post/content-assets/${asset.id}/studio`}>
                    Create final artwork
                  </a>
                ) : latestSchedule && (asset.status === "SCHEDULED" || asset.status === "PUBLISHED") ? (
                  <a className="button primary" href={buildScheduledPostHref(latestSchedule.id)}>
                    View in calendar
                  </a>
                ) : (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setScheduleAssetId(asset.id)}
                    disabled={!(["READY", "SCHEDULED"] as ReadyContentAsset["status"][]).includes(asset.status)}
                  >
                    Choose date &amp; time
                  </button>
                )}
              </div>

              <details className={styles.handoffDetails}>
                <summary>More options &amp; downloads</summary>
                <div className={styles.handoffActions}>
                  {!isVersionLocked ? (
                    <button type="button" className="button tertiary" onClick={() => setComposerAssetId(asset.id)}>Edit words &amp; details</button>
                  ) : sourceIdeaHref ? (
                    <a className="button tertiary" href={sourceIdeaHref}>Create a fresh version</a>
                  ) : null}
                  {isDesignable ? (
                    <a className="button tertiary" href={`/ready-to-post/content-assets/${asset.id}/studio`}>
                      {previewFile ? "Review design" : "Create artwork"}
                    </a>
                  ) : null}
                  {sourceIdeaHref ? <a className="button tertiary" href={sourceIdeaHref}>Open source idea</a> : null}
                  {latestSchedule && asset.status === "SCHEDULED" ? (
                    <button type="button" className="button tertiary" onClick={() => setScheduleAssetId(asset.id)}>Plan another time</button>
                  ) : null}
                  <button
                    type="button"
                    className="button tertiary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(copyText);
                      setCopiedAssetId(asset.id);
                    }}
                  >
                    {copiedAssetId === asset.id ? "Copied" : "Copy post copy"}
                  </button>
                  <a className="button tertiary" href={`/api/content-assets/${asset.id}/download`}>Download production files</a>
                  <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/whatsapp`}>WhatsApp pack</a>
                  <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/story`}>Story pack</a>
                  <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/email`}>HTML email</a>
                  {canExportGuidePdf ? (
                    <a className="button tertiary" href={`/api/content-assets/${asset.id}/guide-pdf`}>Branded PDF</a>
                  ) : null}
                </div>
                {asset.files.length > 0 ? (
                  <ul className={styles.fileList}>
                    {asset.files.map((file) => (
                      <li key={file.id}>
                        <span>{file.fileName}{file.width && file.height ? ` · ${file.width}×${file.height}` : ""}</span>
                        <a className="text-link small" href={`/api/content-assets/${asset.id}/files/${file.id}`} target="_blank" rel="noreferrer">Open</a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </article>
          );
        })}
      </div>

      {visibleAssets.length === 0 ? <p className="muted">No generated content matches this status.</p> : null}

      {composerAsset ? (
        <ContentAssetComposer
          key={composerAsset.id}
          open
          navigateToReadyOnSave={isDesignableContentAssetType(composerAsset.assetType)}
          initialValue={{
            assetId: composerAsset.id,
            sermonId: composerAsset.sermonId,
            sermonTitle: composerAsset.sermonTitle,
            opportunityId: composerAsset.contentOpportunityId,
            assetType: composerAsset.assetType,
            assetTypeLabel: CONTENT_ASSET_TYPE_LABELS[composerAsset.assetType],
            status: composerAsset.status,
            title: composerAsset.title,
            bodyContent: composerAsset.bodyContent ?? composerAsset.caption ?? "",
            caption: composerAsset.caption,
            hashtags: composerAsset.hashtags,
            callToAction: composerAsset.callToAction,
            platform: composerAsset.platform,
          }}
          onClose={() => setComposerAssetId(null)}
          onSaved={() => {
            router.refresh();
            setComposerAssetId(null);
          }}
        />
      ) : null}
      {scheduleAsset ? (
        <ContentAssetScheduleModal
          key={`${scheduleAsset.id}:${scheduleAsset.scheduledPosts.length}`}
          asset={scheduleAsset}
          metaPublishingAccounts={metaPublishingAccounts}
          publishingServiceHealth={publishingServiceHealth}
          open
          onClose={() => setScheduleAssetId(null)}
          onScheduled={(detail) => {
            setScheduleConfirmation(detail);
            setScheduleAssetId(null);
            showScheduledPost(detail);
          }}
        />
      ) : null}
    </section>
  );
}
