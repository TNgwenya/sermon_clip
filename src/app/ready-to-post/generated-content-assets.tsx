"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";

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
import { ContentAssetComposer } from "@/app/opportunities/content-asset-composer";
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
};

type ContentAssetAutomationMode = "MANUAL" | "AUTOMATIC";

const PLATFORM_OPTIONS: Array<{ value: ContentPublishingPlatform; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE_SHORTS", label: "YouTube Shorts" },
];

function scheduleDefaultValue(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toDateTimeLocalInputValue(date);
}

function ContentAssetScheduleModal({
  asset,
  metaPublishingAccounts,
  publishingServiceHealth,
  open,
  onClose,
}: ContentAssetScheduleModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<ContentPublishingPlatform>(asset.platform ?? "INSTAGRAM");
  const [automationMode, setAutomationMode] = useState<ContentAssetAutomationMode>("MANUAL");
  const [socialAccountId, setSocialAccountId] = useState(() => (
    metaPublishingAccounts.find((account) => account.platform === (asset.platform ?? "INSTAGRAM"))?.id ?? ""
  ));
  const [scheduledFor, setScheduledFor] = useState(scheduleDefaultValue);
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const [title, setTitle] = useState(asset.title);
  const [caption, setCaption] = useState(() => buildContentAssetHandoffText(asset));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
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

  if (!open || typeof document === "undefined") return null;

  function schedule() {
    setMessage("");
    startTransition(async () => {
      const result = await scheduleContentAssetAction({
        assetId: asset.id,
        platform,
        scheduledFor: new Date(scheduledFor).toISOString(),
        timezone,
        title,
        caption,
        postingSlot: `${CONTENT_ASSET_TYPE_LABELS[asset.assetType]} handoff`,
        note,
        automationMode,
        socialAccountId: automationMode === "AUTOMATIC" ? socialAccountId : undefined,
      });
      setMessage(result.message);
      if (!result.success) return;
      router.refresh();
      onClose();
    });
  }

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    }}>
      <section className="feature-modal content-asset-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="content-asset-schedule-title">
        <button type="button" className="feature-modal-close" onClick={onClose} disabled={isPending}>Close</button>
        <div className="stack-sm">
          <p className="kicker">Mixed-content calendar</p>
          <h2 id="content-asset-schedule-title">Schedule generated content</h2>
          <p className="muted">Choose a manual media-team handoff or let Sermon Clip publish eligible Meta images at the planned time.</p>
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
                setMessage("");
                if (nextMode === "AUTOMATIC" && platform !== "INSTAGRAM" && platform !== "FACEBOOK") {
                  const fallbackPlatform = metaPublishingAccounts.some((account) => account.platform === "INSTAGRAM")
                    ? "INSTAGRAM"
                    : "FACEBOOK";
                  setPlatform(fallbackPlatform);
                  setSocialAccountId(metaPublishingAccounts.find((account) => account.platform === fallbackPlatform)?.id ?? "");
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
                setSocialAccountId(metaPublishingAccounts.find((account) => account.platform === nextPlatform)?.id ?? "");
                setMessage("");
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
              <select value={socialAccountId} onChange={(event) => setSocialAccountId(event.target.value)} disabled={isPending || automaticAccounts.length === 0}>
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
            <input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} disabled={isPending} />
          </label>
          <label>
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={100} disabled={isPending} />
          </label>
          <label>
            Post title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} disabled={isPending} />
          </label>
          <label className="content-asset-composer-wide">
            Post copy
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={7} maxLength={63_206} disabled={isPending} />
          </label>
          <label className="content-asset-composer-wide">
            Optional note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} disabled={isPending} />
          </label>
        </div>

        {automaticBlocker ? <p className="error-banner">{automaticBlocker}</p> : null}
        {message ? <p className={message.toLowerCase().includes("could not") || message.toLowerCase().includes("before") || message.toLowerCase().includes("choose") || message.toLowerCase().includes("connect") ? "error-banner" : "success-banner"}>{message}</p> : null}

        <div className="feature-modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            type="button"
            className="button primary"
            onClick={schedule}
            disabled={isPending || Boolean(automaticBlocker) || !scheduledFor || !title.trim() || !caption.trim() || !timezone.trim()}
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
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

  if (assets.length === 0) {
    return (
      <section id="generated-content-assets" className="generated-content-assets-panel">
        <div className="stack-sm">
          <p className="kicker">Generated content</p>
          <h2>No prepared non-video posts yet</h2>
          <p className="muted">Approve a quote, carousel, prayer, devotional, discussion post, or invitation, then choose Prepare for publishing.</p>
        </div>
        <a className="button primary" href="/opportunities">Open Publishing Ideas</a>
      </section>
    );
  }

  return (
    <section id="generated-content-assets" className="generated-content-assets-panel stack-md" aria-label="Prepared generated content">
      <div className="generated-content-assets-heading">
        <div className="stack-sm">
          <p className="kicker">Prepared generated content</p>
          <h2>Quotes, carousels, prayers and posts</h2>
          <p className="muted">Review the post package, download production files, or schedule a manual handoff or eligible automatic Meta post.</p>
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

      <div className="generated-content-asset-grid">
        {visibleAssets.map((asset) => {
          const latestSchedule = asset.scheduledPosts[0] ?? null;
          const copyText = buildContentAssetHandoffText(asset);
          const canExportGuidePdf = ["DEVOTIONAL", "PRAYER", "DISCUSSION", "GUIDE", "SERMON_RECAP"].includes(asset.assetType);
          const isVersionLocked = ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(asset.status);
          const supportsManualWithoutMedia = supportsManualContentHandoffWithoutMedia(asset.assetType);
          return (
            <article key={asset.id} className={`generated-content-asset-card ${asset.id === focusedAssetId ? "is-focused" : ""}`}>
              <div className="generated-content-asset-card-head">
                <div>
                  <span className="small muted">{asset.sermonTitle}</span>
                  <h3>{asset.title}</h3>
                </div>
                <div className="clip-badge-row">
                  <span className="status-pill">{CONTENT_ASSET_TYPE_LABELS[asset.assetType]}</span>
                  <span className={`status-pill ${asset.status === "READY" ? "status-exported" : asset.status === "PUBLISHED" ? "status-approved" : ""}`}>
                    {asset.status.toLowerCase()}
                  </span>
                </div>
              </div>
              <p>{(asset.caption?.trim() || asset.bodyContent?.trim() || "Copy pending").slice(0, 280)}{(asset.caption?.length ?? asset.bodyContent?.length ?? 0) > 280 ? "..." : ""}</p>
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
                    ? "This version is locked while scheduled. Cancel its scheduled posts before changing the copy."
                    : "This version preserves what was published. Create a new asset from the sermon’s Content Ideas for future changes."}
                </p>
              ) : null}
              {asset.files.length > 0 ? (
                <details className="content-asset-file-list">
                  <summary>Production files</summary>
                  <ul>
                    {asset.files.map((file) => (
                      <li key={file.id}>
                        <span>{file.fileName}{file.width && file.height ? ` · ${file.width}×${file.height}` : ""}</span>
                        {file.publicUrl ? <a className="text-link small" href={file.publicUrl} target="_blank" rel="noreferrer">Open</a> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="actions-row">
                {isDesignableContentAssetType(asset.assetType) ? (
                  <a className="button secondary" href={`/ready-to-post/content-assets/${asset.id}/studio`}>
                    Open Design Studio
                  </a>
                ) : null}
                {isVersionLocked ? (
                  <a className="button secondary" href={`/opportunities?sermonId=${asset.sermonId}`}>Create a new asset</a>
                ) : (
                  <button type="button" className="button secondary" onClick={() => setComposerAssetId(asset.id)}>Edit post package</button>
                )}
                <button
                  type="button"
                  className="button tertiary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(copyText);
                    setCopiedAssetId(asset.id);
                  }}
                >
                  {copiedAssetId === asset.id ? "Copied" : "Copy handoff"}
                </button>
                <a className="button tertiary" href={`/api/content-assets/${asset.id}/download`}>Download asset</a>
                <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/whatsapp`}>WhatsApp pack</a>
                <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/story`}>Story pack</a>
                <a className="button tertiary" href={`/api/content-assets/${asset.id}/handoff/email`}>HTML email</a>
                {canExportGuidePdf ? (
                  <a className="button tertiary" href={`/api/content-assets/${asset.id}/guide-pdf`}>Branded PDF</a>
                ) : null}
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setScheduleAssetId(asset.id)}
                  disabled={!(["READY", "SCHEDULED"] as ReadyContentAsset["status"][]).includes(asset.status)}
                >
                  {asset.status === "SCHEDULED"
                    ? "Schedule another post"
                    : asset.status === "PREPARED"
                      ? "Rerender before scheduling"
                      : "Schedule post"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {visibleAssets.length === 0 ? <p className="muted">No generated content matches this status.</p> : null}

      {composerAsset ? (
        <ContentAssetComposer
          key={composerAsset.id}
          open
          initialValue={{
            assetId: composerAsset.id,
            sermonId: composerAsset.sermonId,
            sermonTitle: composerAsset.sermonTitle,
            opportunityId: composerAsset.contentOpportunityId,
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
        />
      ) : null}
    </section>
  );
}
