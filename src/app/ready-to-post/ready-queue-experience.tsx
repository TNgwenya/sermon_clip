"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CopyCaptionButton } from "@/app/ready-to-post/copy-caption-button";
import { ReadyQueueActions, SchedulePostButton } from "@/app/ready-to-post/ready-queue-actions";
import { ScheduleDraftModal, type ScheduleDraftClipSummary } from "@/app/ready-to-post/schedule-draft-modal";
import { ClipAssetRecoveryButton } from "@/components/clip-asset-recovery-button";
import { EmptyState } from "@/components/ui";
import {
  buildReadyToPostPackage,
  formatPackageSize,
  formatRecommendedNextAction,
  sanitizePastorFacingQualityText,
  type PlatformUploadHandoff,
} from "@/lib/readyToPost";
import type { PostingDraft } from "@/lib/postingDrafts";
import type { PostingPackageHistoryItem } from "@/lib/postingPackages";
import { listCanonicalPlatformPayloads } from "@/lib/publishingPayload";
import type { PublishingServiceHealth } from "@/lib/publishingServiceHealth";
import {
  buildPostingCalendarDays,
  suggestNextCalendarSlot,
  toDateTimeLocalInputValue,
} from "@/lib/postingSchedule";
import type { ManualPublishingStatus, RestorablePublishingStatus, ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";

export type ReadyQueueClip = {
  id: string;
  title: string;
  hook: string;
  caption: string;
  shortCaption?: string | null;
  platformCaption?: string | null;
  coverFrameSelected?: boolean;
  coverFrameTimeSeconds?: number | null;
  hashtags: unknown;
  score: number;
  finalQualityScore: number | null;
  qualityLabel: string | null;
  postReadyStatus: string | null;
  postReadyReasons: string[];
  postReadyBlockers: string[];
  recommendedNextAction: string | null;
  qualityWarnings: string[];
  qualityReasons: string[];
  pastorFriendlyReason: string | null;
  qualitySummary: string | null;
  visualConfidenceScore: number | null;
  audioQualityScore: number | null;
  captionQualityScore: number | null;
  manualCropRecommended: boolean | null;
  smartClipCategory: string | null;
  intendedAudience: string | null;
  mediaReady: boolean;
  estimatedBytes: number | null;
  remotePreviewUrl: string | null;
  sermon: {
    id: string;
    title: string;
    churchName: string;
  };
};

type ReadyQueueExperienceProps = {
  clips: ReadyQueueClip[];
  clipScopeIds?: string[] | null;
  approvedWaitingCount?: number;
  initialDrafts: PostingDraft[];
  packageHistory: PostingPackageHistoryItem[];
  initialSocialAccounts: SocialAccount[];
  initialScheduledPosts: ScheduledPost[];
  initialPublishingServiceHealth: PublishingServiceHealth;
  controlPanelMode?: boolean;
};

type VideoPreviewState = "poster" | "loading" | "ready" | "playing" | "paused" | "error";
type PublishingFilter = "PLANNED" | "READY_FOR_MEDIA_TEAM" | "POSTING" | "FAILED" | "POSTED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";
type CalendarStatusFilter = "ACTIVE" | "ALL" | PublishingFilter;
type CalendarPlatformFilter = "ALL" | ScheduledPost["platform"];
type ClipQualityFilter = "ALL" | "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | "NEEDS_REVIEW";
type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";
type PublishingConfirmationAction = "QUEUE" | "MARK_POSTED" | "SKIP" | "CANCEL";
type PublishingConfirmation = {
  action: PublishingConfirmationAction;
  post: ScheduledPost;
};
type PublishingCorrection = {
  postId: string;
  status: RestorablePublishingStatus;
  expectedCurrentStatus: "POSTED" | "SKIPPED";
  label: string;
};

const VIDEO_PREVIEW_LABELS: Record<VideoPreviewState, string> = {
  poster: "Preview idle",
  loading: "Loading preview",
  ready: "Ready to play",
  playing: "Playing",
  paused: "Paused",
  error: "Preview unavailable",
};

const SCHEDULED_POST_STATUS_LABELS: Record<ScheduledPost["status"], string> = {
  PLANNED: "Planned",
  READY_FOR_MEDIA_TEAM: "Ready for upload",
  POSTING: "Posting",
  POSTED: "Posted",
  FAILED: "Failed",
  PRIVATE_ONLY_UNVERIFIED: "Private pending verification",
  SKIPPED: "Skipped",
};

const PUBLISHING_FILTER_LABELS: Record<PublishingFilter, string> = {
  PLANNED: "Planned",
  READY_FOR_MEDIA_TEAM: "Ready",
  POSTING: "Posting",
  FAILED: "Failed",
  POSTED: "Posted",
  PRIVATE_ONLY_UNVERIFIED: "Private",
  SKIPPED: "Skipped",
};

const CALENDAR_STATUS_FILTER_LABELS: Record<CalendarStatusFilter, string> = {
  ACTIVE: "Active",
  ALL: "All",
  ...PUBLISHING_FILTER_LABELS,
};

const CLIP_QUALITY_FILTER_LABELS: Record<ClipQualityFilter, string> = {
  ALL: "All quality",
  POST_READY: "Post-ready",
  GOOD_NEEDS_REVIEW: "Good, review",
  NEEDS_EDITING: "Needs editing",
  REJECT: "Not recommended",
  NEEDS_REVIEW: "Needs review",
};

const QUALITY_LABELS: Record<ClipQualityLabel, string> = {
  POST_READY: "Post-ready",
  GOOD_NEEDS_REVIEW: "Good, review first",
  NEEDS_EDITING: "Needs editing",
  REJECT: "Not recommended",
};

const PLATFORMS: ScheduledPost["platform"][] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
const INTERNAL_QUALITY_WARNINGS = new Set(["AI_REVIEW_FAILED", "FALLBACK_REVIEW"]);
const DESKTOP_CALENDAR_DAY_COUNT = 14;
const COMPACT_CALENDAR_DAY_COUNT = 7;
const ACTIVE_CALENDAR_STATUSES = new Set<ScheduledPost["status"]>([
  "PLANNED",
  "READY_FOR_MEDIA_TEAM",
  "POSTING",
  "FAILED",
  "PRIVATE_ONLY_UNVERIFIED",
]);
const HIDE_FROM_READY_STATUSES = new Set<ScheduledPost["status"]>([
  "PLANNED",
  "READY_FOR_MEDIA_TEAM",
  "POSTING",
  "POSTED",
  "FAILED",
  "PRIVATE_ONLY_UNVERIFIED",
]);

function buildBatchDownloadHref(selectedClipIds: string[]): string {
  if (selectedClipIds.length === 0) {
    return "/api/ready-to-post/download?clipIds=all";
  }

  return `/api/ready-to-post/download?clipIds=${encodeURIComponent(selectedClipIds.join(","))}`;
}

function buildPackageHistoryDownloadHref(clipIds: string[]): string {
  const normalized = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    return "/api/ready-to-post/download?clipIds=all";
  }

  return `/api/ready-to-post/download?clipIds=${encodeURIComponent(normalized.join(","))}`;
}

function getPlatformCaption(clip: ReadyQueueClip, platform: ScheduledPost["platform"]): string {
  return getPlatformHandoff(clip, platform)?.captionText ?? clip.caption;
}

function buildScheduleClipSummary(clip: ReadyQueueClip): ScheduleDraftClipSummary {
  return {
    id: clip.id,
    title: clip.title,
    caption: clip.caption,
    platformPayloads: listCanonicalPlatformPayloads({
      title: clip.title,
      hook: clip.hook,
      caption: clip.caption,
      shortCaption: clip.shortCaption,
      platformCaption: clip.platformCaption,
      hashtags: clip.hashtags,
      intendedAudience: clip.intendedAudience,
    }),
  };
}

function getPlatformHandoff(clip: ReadyQueueClip, platform: ScheduledPost["platform"]): PlatformUploadHandoff | null {
  const readyPackage = buildReadyToPostPackage({
    clipId: clip.id,
    title: clip.title,
    hook: clip.hook,
    caption: clip.caption,
    shortCaption: clip.shortCaption,
    platformCaption: clip.platformCaption,
    hashtags: clip.hashtags,
    estimatedBytes: clip.estimatedBytes,
    smartClipCategory: clip.smartClipCategory,
    intendedAudience: clip.intendedAudience,
  });

  return readyPackage.handoffs.find((handoff) => handoff.platform === platform) ?? null;
}

function buildScheduledPostCaption(post: ScheduledPost, clips: ReadyQueueClip[]): string {
  if (post.caption.trim()) {
    return post.caption;
  }

  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  return post.clipIds
    .map((clipId) => clipsById.get(clipId))
    .filter((clip): clip is ReadyQueueClip => Boolean(clip))
    .map((clip) => getPlatformCaption(clip, post.platform))
    .join("\n\n---\n\n");
}

function buildScheduledPostTitle(post: ScheduledPost, clips: ReadyQueueClip[]): string {
  if (post.title.trim()) {
    return post.title;
  }

  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const firstClip = post.clipIds.map((clipId) => clipsById.get(clipId)).find(Boolean);

  if (!firstClip) {
    return `${post.platform} post`;
  }

  const handoffTitle = getPlatformHandoff(firstClip, post.platform)?.titleText ?? firstClip.title;
  return post.clipIds.length === 1 ? handoffTitle : `${handoffTitle} + ${post.clipIds.length - 1} more`;
}

function getPlatformClass(platform: ScheduledPost["platform"]): string {
  return platform.toLowerCase().replace(/\s+/g, "-");
}

function getPlatformUploadActionLabel(platform: ScheduledPost["platform"]): string {
  return platform === "YouTube Shorts" ? "Open YouTube Studio upload" : `Open ${platform} upload`;
}

function getPublishingConfirmationCopy(confirmation: PublishingConfirmation): {
  eyebrow: string;
  title: string;
  description: string;
  confirmLabel: string;
  tone: "primary" | "secondary";
} {
  switch (confirmation.action) {
    case "QUEUE":
      return {
        eyebrow: "Publishing check",
        title: `Queue this ${confirmation.post.platform} post now?`,
        description: "Sermon Clip will send this prepared post to the connected publishing service. Review the channel, copy, and media before continuing.",
        confirmLabel: "Queue for publishing",
        tone: "primary",
      };
    case "MARK_POSTED":
      return {
        eyebrow: "Publishing receipt",
        title: "Confirm this post is live",
        description: "Use this after you have completed the platform upload. The post will move out of the active publishing plan and into history.",
        confirmLabel: "Yes, it is live",
        tone: "primary",
      };
    case "SKIP":
      if (confirmation.post.status === "PRIVATE_ONLY_UNVERIFIED") {
        return {
          eyebrow: "Resolve publishing check",
          title: "Confirm this post is not live",
          description: "Use this only after checking the platform. Sermon Clip will record that this upload is not live and keep the prepared clip available.",
          confirmLabel: "Not live — skip it",
          tone: "secondary",
        };
      }
      return {
        eyebrow: "Update the plan",
        title: "Skip this planned post?",
        description: "The prepared clip will stay available, but this platform plan will be removed from the active queue and kept in history.",
        confirmLabel: "Skip this post",
        tone: "secondary",
      };
    case "CANCEL":
      return {
        eyebrow: "Remove from calendar",
        title: "Cancel this scheduled post?",
        description: "This removes the schedule entry from the calendar. Your prepared clip and its approved copy will not be deleted.",
        confirmLabel: "Cancel scheduled post",
        tone: "secondary",
      };
  }
}

function PublishingConfirmationDialog({
  confirmation,
  pending,
  onClose,
  onConfirm,
}: {
  confirmation: PublishingConfirmation;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const copy = getPublishingConfirmationCopy(confirmation);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pending]);

  if (typeof document === "undefined") {
    return null;
  }

  const scheduledLabel = confirmation.post.scheduledFor
    ? new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(confirmation.post.scheduledFor))
    : "No exact time";

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onClick={pending ? undefined : onClose}>
      <section
        className="feature-modal publishing-confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publishing-confirmation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stack-sm">
          <p className="kicker">{copy.eyebrow}</p>
          <h2 id="publishing-confirmation-title">{copy.title}</h2>
          <p className="muted">{copy.description}</p>
        </div>
        <dl className="publishing-confirmation-summary">
          <div><dt>Platform</dt><dd>{confirmation.post.platform}</dd></div>
          <div><dt>Channel</dt><dd>{confirmation.post.socialAccountLabel ?? "Media team handoff"}</dd></div>
          <div><dt>Plan</dt><dd>{scheduledLabel}</dd></div>
        </dl>
        <div className="publishing-confirmation-actions">
          <button type="button" className="button tertiary" onClick={onClose} disabled={pending} autoFocus>
            Keep plan
          </button>
          <button type="button" className={`button ${copy.tone}`} onClick={onConfirm} disabled={pending}>
            {pending ? "Updating..." : copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PublishingFeedback({
  message,
  correction,
  pending,
  onCorrect,
}: {
  message: string;
  correction: PublishingCorrection | null;
  pending: boolean;
  onCorrect: (postId: string, status: RestorablePublishingStatus, expectedCurrentStatus: "POSTED" | "SKIPPED") => void;
}) {
  if (!message) {
    return null;
  }

  const isError = /could not|choose|select|needs to/i.test(message);
  return (
    <div className={`publishing-feedback ${isError ? "is-error" : "is-success"}`} role="status" aria-live="polite">
      <span>{message}</span>
      {correction && !isError ? (
        <button
          type="button"
          className="button tertiary"
          onClick={() => onCorrect(correction.postId, correction.status, correction.expectedCurrentStatus)}
          disabled={pending}
        >
          {pending ? "Reopening..." : correction.label}
        </button>
      ) : null}
    </div>
  );
}

function publishingWorkerStatusLabel(status: ScheduledPost["workerStatus"]): string {
  switch (status) {
    case "CLAIMED":
      return "Claimed by publishing service";
    case "POSTING":
      return "Sending to platform";
    case "SUCCEEDED":
      return "Platform handoff completed";
    case "FAILED":
      return "Platform handoff failed";
    default:
      return "Waiting in queue";
  }
}

function isPublishingInFlight(post: ScheduledPost): boolean {
  return post.status === "POSTING"
    || Boolean(post.claimedAt)
    || post.workerStatus === "CLAIMED"
    || post.workerStatus === "POSTING";
}

function canReschedulePublishingPost(post: ScheduledPost): boolean {
  return (post.status === "PLANNED" || post.status === "READY_FOR_MEDIA_TEAM" || post.status === "FAILED")
    && !post.externalPostId
    && !post.publishedUrl
    && !post.finalPrivacyStatus;
}

function canCancelPublishingPost(post: ScheduledPost): boolean {
  return post.attemptCount === 0
    && !post.externalPostId
    && !post.publishedUrl
    && !post.finalPrivacyStatus
    && (post.status === "PLANNED"
      || post.status === "READY_FOR_MEDIA_TEAM"
      || post.status === "FAILED"
      || post.status === "SKIPPED");
}

function canRestorePublishingPost(post: ScheduledPost): boolean {
  return post.attemptCount === 0
    && !post.externalPostId
    && !post.publishedUrl
    && !post.finalPrivacyStatus;
}

function getRestorablePublishingStatus(post: ScheduledPost): RestorablePublishingStatus | null {
  return post.status === "PLANNED"
    || post.status === "READY_FOR_MEDIA_TEAM"
    || post.status === "FAILED"
    || post.status === "PRIVATE_ONLY_UNVERIFIED"
    || post.status === "SKIPPED"
    ? post.status
    : null;
}

function PublishingTechnicalDetails({ post }: { post: ScheduledPost }) {
  return (
    <details className="publishing-post-diagnostics">
      <summary>Technical details</summary>
      <dl>
        <div><dt>Worker state</dt><dd>{publishingWorkerStatusLabel(post.workerStatus)}</dd></div>
        <div><dt>Attempts</dt><dd>{post.attemptCount}</dd></div>
        <div>
          <dt>Last attempt</dt>
          <dd>{post.lastAttemptAt ? new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(post.lastAttemptAt)) : "Not attempted"}</dd>
        </div>
        <div><dt>Platform result</dt><dd>{post.finalPrivacyStatus ?? "Not reported"}</dd></div>
        <div><dt>Support reference</dt><dd>{post.id.slice(-10)}</dd></div>
      </dl>
    </details>
  );
}

function formatPublishingError(message: string): string {
  if (/confirmation was interrupted/i.test(message)) {
    return "Publishing stopped before Sermon Clip could confirm the result. Check the platform before retrying.";
  }

  if (/received this upload|accepted this post|uploaded privately|as unpublished|check .* before retrying/i.test(message)) {
    return "The platform received this upload, but Sermon Clip could not confirm it is live. Check the platform before taking another action.";
  }

  if (/unauthori[sz]ed|\b401\b|oauth|access token|refresh token/i.test(message)) {
    return "This publishing channel needs to be reconnected before Sermon Clip can try again.";
  }

  if (/forbidden|\b403\b|permission/i.test(message)) {
    return "This channel does not currently allow Sermon Clip to publish. Review its permissions, then retry.";
  }

  if (/timeout|timed out|network|fetch/i.test(message)) {
    return "The publishing service could not reach this channel. Check the connection and retry in a moment.";
  }

  return "Publishing could not be completed. Review the channel connection, then retry this post.";
}

function publishingServiceLabel(health: PublishingServiceHealth): string {
  if (health.status === "ONLINE") {
    return health.dryRun ? "Publishing service online · test mode" : "Automatic publishing online";
  }

  if (health.status === "STALE") {
    return "Automatic publishing is waiting";
  }

  return "Automatic publishing is not connected yet";
}

function formatPublishingServiceLastSeen(health: PublishingServiceHealth): string {
  if (!health.lastSeenAt) {
    return "No service signal recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(health.lastSeenAt));
}

function PlatformIcon({ platform }: { platform: ScheduledPost["platform"] }) {
  const label = platform === "YouTube Shorts" ? "YouTube" : platform;

  if (platform === "Instagram") {
    return (
      <svg className="social-platform-icon" viewBox="0 0 24 24" role="img" aria-label={label}>
        <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="5" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <circle cx="16.8" cy="7.3" r="1.1" fill="currentColor" />
      </svg>
    );
  }

  if (platform === "TikTok") {
    return (
      <svg className="social-platform-icon" viewBox="0 0 24 24" role="img" aria-label={label}>
        <path d="M14.6 3.4v10.4a4.7 4.7 0 1 1-4.7-4.7c.4 0 .8.1 1.2.2v3.2a1.7 1.7 0 1 0 1.3 1.6V3.4h2.2Z" />
        <path d="M14.6 3.4c.5 2.7 2.1 4.4 4.9 4.7v3.1c-1.8 0-3.5-.6-4.9-1.7V3.4Z" />
      </svg>
    );
  }

  if (platform === "YouTube Shorts") {
    return (
      <svg className="social-platform-icon" viewBox="0 0 24 24" role="img" aria-label={label}>
        <rect x="2.7" y="6.3" width="18.6" height="11.4" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path d="m10.2 9 5 3-5 3V9Z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className="social-platform-icon" viewBox="0 0 24 24" role="img" aria-label={label}>
      <path d="M14.4 8.2h3.1V4.4c-.6-.1-1.9-.2-3.4-.2-3.4 0-5.7 2.1-5.7 5.8v3.1H5v4.2h3.4v6.5h4.3v-6.5h3.5l.6-4.2h-4.1v-2.7c0-1.2.4-2.2 1.7-2.2Z" />
    </svg>
  );
}

function hasClipOverlap(clipIds: string[], scopeClipIds: Set<string> | null): boolean {
  if (!scopeClipIds) {
    return true;
  }

  return clipIds.some((clipId) => scopeClipIds.has(clipId));
}

function getScheduledPostGroupKey(post: ScheduledPost): string {
  return [
    post.platform,
    post.socialAccountId ?? post.socialAccountLabel ?? "media-team",
    post.postingSlot,
    [...post.clipIds].sort().join("|"),
    [...(post.contentAssets ?? []).map((asset) => asset.id)].sort().join("|"),
  ].join("::");
}

function getQualityLabel(clip: ReadyQueueClip): ClipQualityLabel | null {
  if (
    clip.qualityLabel === "POST_READY"
    || clip.qualityLabel === "GOOD_NEEDS_REVIEW"
    || clip.qualityLabel === "NEEDS_EDITING"
    || clip.qualityLabel === "REJECT"
  ) {
    return clip.qualityLabel;
  }

  if (clip.postReadyStatus === "POST_READY") {
    return "POST_READY";
  }

  if (clip.postReadyStatus === "NEEDS_EDITING") {
    return "NEEDS_EDITING";
  }

  return null;
}

function getQualityLabelText(label: ClipQualityLabel | null): string {
  return label ? QUALITY_LABELS[label] : "Needs review";
}

function getQualityToneClass(label: ClipQualityLabel | null): string {
  switch (label) {
    case "POST_READY":
      return "quality-post-ready";
    case "GOOD_NEEDS_REVIEW":
      return "quality-good-needs-review";
    case "NEEDS_EDITING":
      return "quality-needs-editing";
    case "REJECT":
      return "quality-reject";
    default:
      return "quality-good-needs-review";
  }
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "--";
}

function titleCaseFromCode(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyWarning(warning: string): string {
  const messages: Record<string, string> = {
    LOW_TRACKING_CONFIDENCE: "Smart crop confidence is low.",
    SMART_CROP_REVIEW_RECOMMENDED: "Review smart crop before publishing.",
    MANUAL_CROP_RECOMMENDED: "Manual crop review is recommended.",
    AUDIO_CLIPPING_RISK: "Audio may be clipping.",
    LOW_AUDIO_VOLUME: "Audio may be too quiet.",
    NO_AUDIO_DETECTED: "No audio was detected.",
    MISSING_CAPTION_SEGMENTS: "Caption coverage may be incomplete.",
    CAPTIONS_TOO_FAST: "Captions may be moving too quickly.",
    CAPTIONS_OUT_OF_SAFE_ZONE: "Captions may sit outside the safe zone.",
  };

  return messages[warning] ?? titleCaseFromCode(warning);
}

function buildReadinessIssues(clip: ReadyQueueClip): string[] {
  const issues = [
    ...(clip.mediaReady ? [] : ["Prepared download file is missing."]),
    ...clip.postReadyBlockers,
    ...clip.qualityWarnings.filter((warning) => !INTERNAL_QUALITY_WARNINGS.has(warning)),
    ...(clip.manualCropRecommended ? ["MANUAL_CROP_RECOMMENDED"] : []),
  ];

  return Array.from(new Set(issues)).map(friendlyWarning);
}

function formatPackageCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatCalendarDayName(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatCalendarDayNumber(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
  }).format(date);
}

function formatCalendarMonth(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
  }).format(date);
}

function formatCalendarTime(value: string | null): string {
  if (!value) {
    return "No time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildCalendarPostingSlot(date: Date): string {
  return `${formatCalendarDayName(date)} social calendar`;
}

function buildCalendarWindowLabel(startDate: Date, dayCount: number): string {
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + Math.max(0, dayCount - 1));
  return `${formatCalendarDayName(startDate)} - ${formatCalendarDayName(endDate)}`;
}

function matchesCalendarStatus(post: ScheduledPost, filter: CalendarStatusFilter): boolean {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "ACTIVE") {
    return ACTIVE_CALENDAR_STATUSES.has(post.status);
  }

  return post.status === filter;
}

function matchesCalendarPlatform(post: ScheduledPost, filter: CalendarPlatformFilter): boolean {
  return filter === "ALL" || post.platform === filter;
}

function getCalendarPostToneClass(post: ScheduledPost): string {
  if (post.status === "POSTED") {
    return "is-posted";
  }

  if (post.status === "FAILED" || post.status === "PRIVATE_ONLY_UNVERIFIED") {
    return "needs-attention";
  }

  if (post.status === "POSTING") {
    return "is-posting";
  }

  return "is-planned";
}

export function ReadyQueueExperience({
  clips,
  clipScopeIds = null,
  approvedWaitingCount = 0,
  initialDrafts,
  packageHistory,
  initialSocialAccounts,
  initialScheduledPosts,
  initialPublishingServiceHealth,
  controlPanelMode = false,
}: ReadyQueueExperienceProps) {
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<PostingDraft[]>(initialDrafts);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>(initialSocialAccounts);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>(initialScheduledPosts);
  const [publishingServiceHealth, setPublishingServiceHealth] = useState(initialPublishingServiceHealth);
  const [publishingMessage, setPublishingMessage] = useState("");
  const [pendingScheduledPostId, setPendingScheduledPostId] = useState<string | null>(null);
  const [publishingConfirmation, setPublishingConfirmation] = useState<PublishingConfirmation | null>(null);
  const [publishingConfirmationPending, setPublishingConfirmationPending] = useState(false);
  const [publishingCorrection, setPublishingCorrection] = useState<PublishingCorrection | null>(null);
  const [publishingFilter, setPublishingFilter] = useState<PublishingFilter>("PLANNED");
  const [qualityFilter, setQualityFilter] = useState<ClipQualityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedClipId, setFocusedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [activeCaptionPlatform, setActiveCaptionPlatform] = useState<ScheduledPost["platform"]>("TikTok");
  const [videoPreviewStates, setVideoPreviewStates] = useState<Record<string, VideoPreviewState>>({});
  const [calendarStartDate, setCalendarStartDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [compactPlanner, setCompactPlanner] = useState(false);
  const [calendarPlatformFilter, setCalendarPlatformFilter] = useState<CalendarPlatformFilter>("ALL");
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<CalendarStatusFilter>("ACTIVE");
  const [calendarScheduleIntent, setCalendarScheduleIntent] = useState<{
    key: string;
    clipIds: string[];
    clipDetails: ScheduleDraftClipSummary[];
    postingSlot: string;
    scheduledFor: string;
  } | null>(null);
  const [rescheduleValues, setRescheduleValues] = useState<Record<string, string>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const refreshPublishingServiceHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/ready-to-post/publishing-health", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.health) {
        setPublishingServiceHealth(data.health);
      }
    } catch {
      // Preserve the last known signal when the status check itself is unavailable.
    }
  }, []);
  const clipScopeIdSet = useMemo(() => clipScopeIds ? new Set(clipScopeIds) : null, [clipScopeIds]);
  const scheduledClipIds = useMemo(() => {
    const ids = new Set<string>();
    scheduledPosts.forEach((post) => {
      if (HIDE_FROM_READY_STATUSES.has(post.status)) {
        post.clipIds.forEach((clipId) => ids.add(clipId));
      }
    });
    return ids;
  }, [scheduledPosts]);
  const visibleSelectedClipIds = useMemo(
    () => selectedClipIds.filter((clipId) => !scheduledClipIds.has(clipId)),
    [scheduledClipIds, selectedClipIds],
  );
  const selectedClipIdSet = useMemo(() => new Set(visibleSelectedClipIds), [visibleSelectedClipIds]);
  const readyQueueClips = useMemo(() => clips.filter((clip) => !scheduledClipIds.has(clip.id)), [clips, scheduledClipIds]);
  const hiddenScheduledClipCount = clips.length - readyQueueClips.length;
  const downloadableClips = useMemo(() => readyQueueClips.filter((clip) => clip.mediaReady), [readyQueueClips]);
  const downloadableClipIds = useMemo(() => new Set(downloadableClips.map((clip) => clip.id)), [downloadableClips]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredClips = useMemo(() => {
    return readyQueueClips.filter((clip) => {
      const qualityLabel = getQualityLabel(clip);
      const matchesQuality = qualityFilter === "ALL"
        || (qualityFilter === "NEEDS_REVIEW" ? !qualityLabel : qualityLabel === qualityFilter);
      const matchesSearch = normalizedSearchQuery.length === 0
        || [
          clip.title,
          clip.caption,
          clip.hook,
          clip.sermon.title,
          clip.sermon.churchName,
          clip.smartClipCategory ?? "",
          clip.intendedAudience ?? "",
        ].join(" ").toLowerCase().includes(normalizedSearchQuery);

      return matchesQuality && matchesSearch;
    });
  }, [normalizedSearchQuery, qualityFilter, readyQueueClips]);
  const selectedDownloadableClipIds = visibleSelectedClipIds.filter((clipId) => downloadableClipIds.has(clipId));
  const batchDownloadHref = buildBatchDownloadHref(
    selectedDownloadableClipIds.length > 0 ? selectedDownloadableClipIds : downloadableClips.map((clip) => clip.id),
  );
  const selectedClip = readyQueueClips.find((clip) => clip.id === focusedClipId)
    ?? readyQueueClips.find((clip) => selectedClipIdSet.has(clip.id))
    ?? filteredClips[0]
    ?? readyQueueClips[0]
    ?? null;
  const selectedReadyPackage = selectedClip
    ? buildReadyToPostPackage({
      clipId: selectedClip.id,
      title: selectedClip.title,
      hook: selectedClip.hook,
      caption: selectedClip.caption,
      shortCaption: selectedClip.shortCaption,
      platformCaption: selectedClip.platformCaption,
      hashtags: selectedClip.hashtags,
      estimatedBytes: selectedClip.estimatedBytes,
      smartClipCategory: selectedClip.smartClipCategory,
      intendedAudience: selectedClip.intendedAudience,
    })
    : null;
  const selectedQualityLabel = selectedClip ? getQualityLabel(selectedClip) : null;
  const selectedNeedsEditorialReview = selectedQualityLabel !== "POST_READY";
  const selectedQualityIssues = selectedClip ? buildReadinessIssues(selectedClip) : [];
  const selectedQualitySummary = selectedClip
    ? sanitizePastorFacingQualityText(selectedClip.qualitySummary) ??
      sanitizePastorFacingQualityText(selectedClip.pastorFriendlyReason) ??
      formatRecommendedNextAction(selectedClip.recommendedNextAction) ??
      "Ready for media team review."
    : "Ready for media team review.";
  const selectedNextActionLabel = selectedClip ? formatRecommendedNextAction(selectedClip.recommendedNextAction) : null;
  const activeHandoff = selectedReadyPackage?.handoffs.find((handoff) => handoff.platform === activeCaptionPlatform)
    ?? selectedReadyPackage?.handoffs[0]
    ?? null;
  const activePlatformPayload = selectedReadyPackage?.platformPayloads.find((payload) => payload.platform === activeCaptionPlatform)
    ?? selectedReadyPackage?.platformPayloads[0]
    ?? null;
  const activeCaptionVariant = selectedReadyPackage?.variants.find((variant) => variant.platform === activeCaptionPlatform)
    ?? selectedReadyPackage?.variants[0]
    ?? null;
  const scopedDrafts = useMemo(
    () => drafts.filter((draft) => hasClipOverlap(draft.clipIds, clipScopeIdSet)),
    [clipScopeIdSet, drafts],
  );
  const scopedPackageHistory = useMemo(
    () => packageHistory.filter((item) => hasClipOverlap(item.clipIds, clipScopeIdSet)),
    [clipScopeIdSet, packageHistory],
  );
  const scopedScheduledPosts = useMemo(
    () => scheduledPosts.filter((post) => hasClipOverlap(post.clipIds, clipScopeIdSet)),
    [clipScopeIdSet, scheduledPosts],
  );
  const postedCount = scopedScheduledPosts.filter((post) => post.status === "POSTED").length;
  const filteredScheduledPosts = scopedScheduledPosts.filter((post) => post.status === publishingFilter);
  const groupedScheduledPosts = Array.from(
    new Map(filteredScheduledPosts.map((post) => [getScheduledPostGroupKey(post), post])).values(),
  );
  const calendarPosts = useMemo(() => scopedScheduledPosts.filter((post) => (
    post.scheduledFor
    && matchesCalendarStatus(post, calendarStatusFilter)
    && matchesCalendarPlatform(post, calendarPlatformFilter)
  )), [calendarPlatformFilter, calendarStatusFilter, scopedScheduledPosts]);
  const calendarDayCount = compactPlanner ? COMPACT_CALENDAR_DAY_COUNT : DESKTOP_CALENDAR_DAY_COUNT;
  const calendarDays = useMemo(() => buildPostingCalendarDays(calendarPosts, {
    startDate: calendarStartDate,
    dayCount: calendarDayCount,
  }), [calendarDayCount, calendarPosts, calendarStartDate]);
  const unscheduledCalendarPosts = useMemo(() => scopedScheduledPosts.filter((post) => (
    !post.scheduledFor
    && matchesCalendarStatus(post, calendarStatusFilter)
    && matchesCalendarPlatform(post, calendarPlatformFilter)
  )), [calendarPlatformFilter, calendarStatusFilter, scopedScheduledPosts]);
  const calendarClipIds = selectedDownloadableClipIds.length > 0
    ? selectedDownloadableClipIds
    : selectedClip && selectedClip.mediaReady
      ? [selectedClip.id]
      : [];
  const calendarClipDetails = calendarClipIds
    .map((clipId) => clips.find((clip) => clip.id === clipId))
    .filter((clip): clip is ReadyQueueClip => Boolean(clip))
    .map(buildScheduleClipSummary);
  const calendarWindowLabel = buildCalendarWindowLabel(calendarStartDate, calendarDayCount);
  const calendarWindowPosts = calendarDays.flatMap((day) => day.posts);
  const calendarPlannedCount = calendarWindowPosts.filter((post) => ACTIVE_CALENDAR_STATUSES.has(post.status)).length;
  const calendarPostedCount = calendarWindowPosts.filter((post) => post.status === "POSTED").length;
  const calendarGeneratedContentCount = calendarWindowPosts.filter((post) => (post.contentAssets?.length ?? 0) > 0).length;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const syncPlannerMode = () => setCompactPlanner(mediaQuery.matches);

    syncPlannerMode();
    mediaQuery.addEventListener("change", syncPlannerMode);
    return () => mediaQuery.removeEventListener("change", syncPlannerMode);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshPublishingServiceHealth();
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [refreshPublishingServiceHealth]);

  function toggleClip(clipId: string) {
    setFocusedClipId(clipId);
    setSelectedClipIds((current) => (
      current.includes(clipId)
        ? current.filter((item) => item !== clipId)
        : [...current, clipId]
    ));
  }

  function selectAll() {
    setSelectedClipIds(filteredClips.length > 0 ? filteredClips.map((clip) => clip.id) : readyQueueClips.map((clip) => clip.id));
  }

  function clearSelection() {
    setSelectedClipIds([]);
  }

  function moveCalendarWindow(dayOffset: number) {
    setCalendarStartDate((current) => {
      const next = new Date(current);
      next.setDate(current.getDate() + dayOffset);
      next.setHours(0, 0, 0, 0);
      return next;
    });
  }

  function resetCalendarWindow() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setCalendarStartDate(today);
  }

  function openCalendarSchedule(day: { key: string; date: Date; posts: ScheduledPost[] }) {
    if (calendarClipIds.length === 0) {
      setPublishingMessage("Select a prepared clip before scheduling it on the calendar.");
      return;
    }

    const scheduledFor = suggestNextCalendarSlot({
      day: day.date,
      existingPosts: day.posts,
    });
    setCalendarScheduleIntent({
      key: `${day.key}:${scheduledFor.toISOString()}:${calendarClipIds.join(",")}`,
      clipIds: calendarClipIds,
      clipDetails: calendarClipDetails,
      postingSlot: buildCalendarPostingSlot(day.date),
      scheduledFor: toDateTimeLocalInputValue(scheduledFor),
    });
  }

  async function refreshScheduledPosts() {
    try {
      const response = await fetch("/api/ready-to-post/scheduled-posts");
      const data = await response.json();
      if (Array.isArray(data.scheduledPosts)) {
        setScheduledPosts(data.scheduledPosts);
      }
    } catch {
      // Keep the server-rendered posting queue if refresh fails.
    }
  }

  function addDraft(draft: PostingDraft) {
    setDrafts((current) => [draft, ...current].slice(0, 6));
    setPublishingCorrection(null);
    setPublishingMessage("Publishing plan saved. It appears in history and on the calendar when a time is set.");
    void refreshScheduledPosts();
  }

  function addSocialAccount(account: SocialAccount) {
    setSocialAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)].slice(0, 100));
  }

  function syncSocialAccounts(accounts: SocialAccount[]) {
    setSocialAccounts((current) => {
      const syncedIds = new Set(accounts.map((account) => account.id));
      return [...accounts, ...current.filter((account) => !syncedIds.has(account.id))].slice(0, 100);
    });
  }

  async function patchScheduledPost(
    postId: string,
    body:
      | { status: ManualPublishingStatus }
      | { action: "POST_NOW" }
      | { action: "RESTORE_PREVIOUS"; restoreStatus: RestorablePublishingStatus; expectedCurrentStatus: "POSTED" | "SKIPPED" }
      | { scheduledFor: string; timezone?: string },
  ): Promise<boolean> {
    setPendingScheduledPostId(postId);
    setPublishingMessage("");
    try {
      const response = await fetch("/api/ready-to-post/scheduled-posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPublishingMessage(data.error ?? "Could not update this scheduled post.");
        return false;
      }
      setScheduledPosts((current) => current.map((post) => (post.id === postId ? data.scheduledPost : post)));
      if ("action" in body && body.action === "POST_NOW") {
        const previousPost = scheduledPosts.find((post) => post.id === postId);
        setPublishingMessage(previousPost?.status === "FAILED"
          ? "Publishing retry queued. The publishing service will try again on its next check."
          : "Post queued for publishing. The publishing service will pick it up on its next check.");
      } else if ("action" in body && body.action === "RESTORE_PREVIOUS") {
        setPublishingMessage("The post was restored to its previous publishing status.");
      } else if ("scheduledFor" in body) {
        setPublishingMessage("Scheduled post time updated.");
      } else if ("status" in body) {
        setPublishingMessage(body.status === "POSTED" ? "Post marked as published." : "Scheduled post updated.");
      }
      return true;
    } catch {
      setPublishingMessage("Could not update this scheduled post.");
      return false;
    } finally {
      setPendingScheduledPostId(null);
    }
  }

  async function updateScheduledPostStatus(postId: string, status: ManualPublishingStatus) {
    return patchScheduledPost(postId, { status });
  }

  async function queueScheduledPostForPublishing(postId: string) {
    setPublishingCorrection(null);
    return patchScheduledPost(postId, { action: "POST_NOW" });
  }

  function updateRescheduleValue(post: ScheduledPost, value: string) {
    setRescheduleValues((current) => ({
      ...current,
      [post.id]: value,
    }));
  }

  async function reschedulePost(post: ScheduledPost) {
    const value = rescheduleValues[post.id] || (post.scheduledFor ? toDateTimeLocalInputValue(new Date(post.scheduledFor)) : "");
    if (!value) {
      setPublishingMessage("Choose a new date and time for this post.");
      return;
    }

    const scheduledFor = new Date(value);
    if (Number.isNaN(scheduledFor.getTime())) {
      setPublishingMessage("Choose a valid date and time for this post.");
      return;
    }

    await patchScheduledPost(post.id, {
      scheduledFor: scheduledFor.toISOString(),
      timezone: post.timezone ?? "Africa/Johannesburg",
    });
  }

  async function cancelScheduledPost(postId: string): Promise<boolean> {
    setPendingScheduledPostId(postId);
    setPublishingMessage("");
    try {
      const response = await fetch("/api/ready-to-post/scheduled-posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPublishingMessage(data.error ?? "Could not cancel this scheduled post.");
        return false;
      }

      setScheduledPosts((current) => current.filter((post) => post.id !== postId));
      setPublishingCorrection(null);
      setPublishingMessage("Scheduled post cancelled.");
      return true;
    } catch {
      setPublishingMessage("Could not cancel this scheduled post.");
      return false;
    } finally {
      setPendingScheduledPostId(null);
    }
  }

  function requestPublishingConfirmation(post: ScheduledPost, action: PublishingConfirmationAction) {
    setPublishingConfirmation({ post, action });
  }

  async function confirmPublishingAction() {
    if (!publishingConfirmation) {
      return;
    }

    const { action, post } = publishingConfirmation;
    setPublishingConfirmationPending(true);
    let updated = false;

    if (action === "QUEUE") {
      updated = await queueScheduledPostForPublishing(post.id);
    } else if (action === "MARK_POSTED") {
      updated = await updateScheduledPostStatus(post.id, "POSTED");
      if (updated) {
        const previousStatus = canRestorePublishingPost(post) ? getRestorablePublishingStatus(post) : null;
        setPublishingCorrection(previousStatus
          ? {
            postId: post.id,
            status: previousStatus,
            expectedCurrentStatus: "POSTED",
            label: "Restore previous status",
          }
          : null);
      }
    } else if (action === "SKIP") {
      updated = await updateScheduledPostStatus(post.id, "SKIPPED");
      if (updated) {
        const previousStatus = canRestorePublishingPost(post) ? getRestorablePublishingStatus(post) : null;
        setPublishingCorrection(previousStatus
          ? {
            postId: post.id,
            status: previousStatus,
            expectedCurrentStatus: "SKIPPED",
            label: "Restore previous status",
          }
          : null);
      }
    } else {
      updated = await cancelScheduledPost(post.id);
    }

    setPublishingConfirmationPending(false);
    if (updated) {
      setPublishingConfirmation(null);
    }
  }

  async function correctPublishingStatus(
    postId: string,
    status: RestorablePublishingStatus,
    expectedCurrentStatus: "POSTED" | "SKIPPED",
  ) {
    const updated = await patchScheduledPost(postId, {
      action: "RESTORE_PREVIOUS",
      restoreStatus: status,
      expectedCurrentStatus,
    });
    if (updated) {
      setPublishingCorrection(null);
      setPublishingMessage("The post was restored to its previous publishing status.");
    }
  }

  function setVideoPreviewState(clipId: string, state: VideoPreviewState) {
    setVideoPreviewStates((current) => ({
      ...current,
      [clipId]: state,
    }));
  }

  function playPreview(clipId: string) {
    const video = videoRefs.current[clipId];
    if (!video) {
      return;
    }

    setVideoPreviewState(clipId, "loading");
    video.muted = false;
    video.play().catch(() => undefined);
  }

  function pausePreview(clipId: string) {
    videoRefs.current[clipId]?.pause();
  }

  function togglePreview(clipId: string) {
    const previewState = videoPreviewStates[clipId] ?? "poster";
    if (previewState === "playing") {
      pausePreview(clipId);
      return;
    }

    playPreview(clipId);
  }

  function focusClip(clipId: string) {
    setFocusedClipId(clipId);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadDraftsAndScheduledPosts() {
      try {
        const [draftResponse, scheduledPostResponse] = await Promise.all([
          fetch("/api/ready-to-post/drafts"),
          fetch("/api/ready-to-post/scheduled-posts"),
        ]);
        const draftData = await draftResponse.json();
        const scheduledPostData = await scheduledPostResponse.json();
        if (isMounted && Array.isArray(draftData.drafts)) {
          setDrafts(draftData.drafts);
        }
        if (isMounted && Array.isArray(scheduledPostData.scheduledPosts)) {
          setScheduledPosts(scheduledPostData.scheduledPosts);
        }
      } catch {
        // Keep the server-rendered queue if the refresh fails.
      }
    }

    loadDraftsAndScheduledPosts();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <section id="ready-clips" className="publishing-desk-grid ready-master-detail premium-ready-workspace" aria-label="Publishing workspace">
        <div className="publishing-board-panel premium-ready-clip-picker">
          <div className="publishing-section-head">
            <div>
              <p className="kicker">Stage 1 · Choose a clip</p>
              <h2>What should your church share next?</h2>
              <p className="muted small">Select a finished moment to open its video, caption, and posting options.</p>
            </div>
          </div>
          <div className="ready-filter-row">
            <label className="ready-search-field">
              <span>Search clips</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Title, caption, audience..."
              />
            </label>
            <label className="ready-select-field">
              <span>Readiness</span>
              <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as ClipQualityFilter)}>
                {(Object.keys(CLIP_QUALITY_FILTER_LABELS) as ClipQualityFilter[]).map((filter) => (
                  <option key={filter} value={filter}>{CLIP_QUALITY_FILTER_LABELS[filter]}</option>
                ))}
              </select>
            </label>
          </div>
          {clips.length === 0 || readyQueueClips.length === 0 ? (
            <EmptyState
              title={
                clips.length > 0 && readyQueueClips.length === 0
                  ? "All prepared clips are already scheduled"
                  : approvedWaitingCount > 0 ? "Approved clips are waiting above" : "No finished clips yet"
              }
              description={
                clips.length > 0 && readyQueueClips.length === 0
                  ? "Scheduled and posted clips move out of this list so you can focus on what still needs a posting plan."
                  : approvedWaitingCount > 0
                  ? "Prepare approved clips first. Finished videos will appear here with captions and posting actions."
                  : "Finished sermon clips will appear here when preparation is complete."
              }
            />
          ) : filteredClips.length === 0 ? (
            <div className="publishing-empty-state">
              <h3>No clips match those filters</h3>
              <p className="muted small">Clear search or choose another readiness status.</p>
              <button type="button" className="button tertiary" onClick={() => {
                setSearchQuery("");
                setQualityFilter("ALL");
              }}>Clear filters</button>
            </div>
          ) : (
            <div className="asset-tray-list">
              {filteredClips.map((clip) => {
                const qualityLabel = getQualityLabel(clip);
                const isBatchSelected = selectedClipIdSet.has(clip.id);
                const isFocused = selectedClip?.id === clip.id;

                return (
                  <article key={clip.id} className={`asset-tray-card ${isBatchSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}>
                    <button type="button" className="asset-tray-thumb" onClick={() => focusClip(clip.id)} aria-label={`Preview ${clip.title}`}>
                      {controlPanelMode ? (
                        <strong className="asset-tray-thumb-placeholder" aria-hidden="true">SC</strong>
                      ) : (
                        <Image
                          src={`/api/clips/${clip.id}/thumbnail`}
                          alt=""
                          width={72}
                          height={128}
                          unoptimized
                        />
                      )}
                      <span>{isFocused ? "Previewing" : "Preview"}</span>
                    </button>
                    <div className="asset-tray-main">
                      <label className="asset-select-check">
                        <input type="checkbox" checked={isBatchSelected} onChange={() => toggleClip(clip.id)} />
                        <span>{clip.title}</span>
                      </label>
                      <p className="muted small">{clip.sermon.title}</p>
                      <div className="ready-tray-state-row">
                        <span className={`status-pill ${clip.mediaReady ? "status-exported" : "quality-reject"}`}>
                          {clip.mediaReady ? "Video prepared" : "Video needs repair"}
                        </span>
                        <span className={`status-pill ${getQualityToneClass(qualityLabel)}`}>
                          {getQualityLabelText(qualityLabel)}
                        </span>
                        {isBatchSelected ? <span className="status-pill premium-batch-selected">Selected for batch</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="selected-asset-panel premium-ready-composer" aria-label="Selected prepared clip">
          {selectedClip && selectedReadyPackage ? (
            <>
              <div className="publishing-section-head compact">
                <div>
                  <p className="kicker">Stage 2 · Prepare the post</p>
                  <h2>{selectedClip.title}</h2>
                  <p className="muted small">{selectedClip.sermon.title}</p>
                </div>
                <span className={`status-pill ${getQualityToneClass(selectedQualityLabel)}`}>
                  {getQualityLabelText(selectedQualityLabel)}
                </span>
              </div>
              <div className={`selected-action-summary ${selectedClip.mediaReady ? "is-ready" : "needs-attention"}`}>
                <div>
                  <strong>{selectedClip.mediaReady ? "Posting video prepared" : "Posting video needs a refresh"}</strong>
                  <span>
                    {selectedClip.mediaReady
                      ? selectedNeedsEditorialReview
                        ? "Rendering is complete. Review the separate editorial readiness note before publishing."
                        : "Rendering and editorial review are complete. This clip is ready for its final handoff."
                      : "This clip is blocked until its media is repaired."}
                  </span>
                </div>
                <span className="status-pill">{selectedClip.mediaReady ? "Media: prepared" : "Media: repair"}</span>
              </div>
              {(!controlPanelMode || selectedClip.remotePreviewUrl) ? <div
                className="video-card-shell ready-video-shell selected-asset-video"
                data-preview-state={videoPreviewStates[selectedClip.id] ?? "poster"}
              >
                <video
                  ref={(node) => {
                    videoRefs.current[selectedClip.id] = node;
                  }}
                  className="ready-clip-video"
                  controls
                  preload="none"
                  poster={`/api/clips/${selectedClip.id}/thumbnail`}
                  src={selectedReadyPackage.previewHref}
                  onLoadStart={() => setVideoPreviewState(selectedClip.id, "loading")}
                  onCanPlay={() => setVideoPreviewState(selectedClip.id, "ready")}
                  onPlaying={() => setVideoPreviewState(selectedClip.id, "playing")}
                  onPause={() => setVideoPreviewState(selectedClip.id, "paused")}
                  onEnded={() => setVideoPreviewState(selectedClip.id, "ready")}
                  onError={() => setVideoPreviewState(selectedClip.id, "error")}
                />
                <span className="video-quality-pill">{selectedClip.mediaReady ? "Video prepared" : "Video needs repair"}</span>
                <span className={`video-state-pill video-state-${videoPreviewStates[selectedClip.id] ?? "poster"}`}>{VIDEO_PREVIEW_LABELS[videoPreviewStates[selectedClip.id] ?? "poster"]}</span>
                <button
                  type="button"
                  className="video-play-button"
                  onClick={() => togglePreview(selectedClip.id)}
                  disabled={(videoPreviewStates[selectedClip.id] ?? "poster") === "error"}
                  aria-label={`Preview ${selectedClip.title}`}
                >
                  {(videoPreviewStates[selectedClip.id] ?? "poster") === "playing" ? "Pause" : "Preview"}
                </button>
              </div> : (
                <div className="selected-quality-panel">
                  <strong>Media stored on Mac</strong>
                  <p className="muted small">This clip does not have a remote preview yet. Use the Mac app for local preview, or refresh review assets before previewing remotely.</p>
                </div>
              )}
              <div className="selected-action-summary">
                <div>
                  <strong>{selectedClip.coverFrameSelected ? "Chosen cover frame included" : "Automatic cover frame included"}</strong>
                  <span>
                    {selectedClip.coverFrameSelected && typeof selectedClip.coverFrameTimeSeconds === "number"
                      ? `The saved frame at ${formatSecondsForPastorView(selectedClip.coverFrameTimeSeconds)} is used as this clip’s poster. Confirm it in each platform before publishing.`
                      : "Sermon Clip is using a neutral automatic poster. Choose a deliberate frame in Clip Studio for stronger presentation."}
                  </span>
                </div>
                <a
                  className="button tertiary"
                  href={`/api/clips/${selectedClip.id}/thumbnail?download=cover`}
                  download={`${selectedClip.title}-cover.jpg`}
                >
                  Download cover
                </a>
              </div>
              <details className="selected-quality-panel selected-quality-details">
                <summary>Readiness note</summary>
                <div className="selected-quality-summary">
                  <strong>{selectedQualitySummary}</strong>
                  {selectedNextActionLabel ? <span>{selectedNextActionLabel}</span> : null}
                </div>
                <div className="selected-metric-grid" aria-label="Quality metrics">
                  <div><span>Visual</span><strong>{formatScore(selectedClip.visualConfidenceScore)}</strong></div>
                  <div><span>Audio</span><strong>{formatScore(selectedClip.audioQualityScore)}</strong></div>
                  <div><span>Captions</span><strong>{formatScore(selectedClip.captionQualityScore)}</strong></div>
                </div>
                {selectedQualityIssues.length > 0 ? (
                  <ul className="selected-warning-list" aria-label="Quality issues">
                    {selectedQualityIssues.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                ) : (
                  <p className="muted small">No quality blockers are currently attached to this clip.</p>
                )}
              </details>
              {selectedClip.mediaReady ? (
                <details className="platform-caption-panel platform-caption-details premium-platform-copy" open>
                  <summary>Suggested copy for manual upload</summary>
                  <p className="muted small premium-platform-copy-intro">
                    Choose a platform, review the suggestion, then follow the handoff below. Scheduling confirms its own post copy separately.
                  </p>
                  <div className="platform-caption-tabs" role="group" aria-label="Platform caption previews">
                    {PLATFORMS.map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        aria-pressed={activeCaptionPlatform === platform}
                        className={activeCaptionPlatform === platform ? "active" : ""}
                        onClick={() => setActiveCaptionPlatform(platform)}
                      >
                        <PlatformIcon platform={platform} />
                        {platform}
                      </button>
                    ))}
                  </div>
                  {activeHandoff ? (
                    <div className="platform-caption-card">
                      <div className="publishing-section-head compact">
                        <div>
                          <p className="kicker">{activeHandoff.platform}</p>
                          <h3>{activeCaptionVariant?.label ?? `${activeHandoff.platform} handoff`} suggestion</h3>
                        </div>
                        <span className="status-pill">
                          {activeHandoff.captionText.length}
                          {activePlatformPayload ? ` / ${activePlatformPayload.constraints.captionMaxCharacters}` : ""} chars
                        </span>
                      </div>
                      <div className="platform-handoff-stack">
                        <div>
                          <span>Title</span>
                          <p>{activeHandoff.titleText}</p>
                        </div>
                        <div>
                          <span>Caption</span>
                          <p>{activeHandoff.captionText || "Caption pending."}</p>
                        </div>
                        {activePlatformPayload ? (
                          <>
                            <div>
                              <span>Why this version fits</span>
                              <p>{activePlatformPayload.guidance.rationale}</p>
                            </div>
                            <div>
                              <span>Final platform check</span>
                              <p>{activePlatformPayload.guidance.formatChecks[0]}</p>
                              <small className="muted">{activePlatformPayload.guidance.callToAction}</small>
                            </div>
                          </>
                        ) : null}
                      </div>
                      <ol className="premium-manual-handoff" aria-label={`${activeHandoff.platform} manual upload handoff`}>
                        <li>
                          <span>1</span>
                          <div><strong>Download the final video</strong><small>Use the prepared vertical video with captions and branding.</small></div>
                          {!controlPanelMode ? (
                            <a className="button secondary" href={selectedReadyPackage.downloadHref}>Download video</a>
                          ) : (
                            <span className="status-pill">Download in Mac app</span>
                          )}
                        </li>
                        <li>
                          <span>2</span>
                          <div><strong>Copy the suggested platform copy</strong><small>Review and adjust it in the platform before publishing.</small></div>
                          <CopyCaptionButton
                            label={activeHandoff.platform === "YouTube Shorts" ? "Copy suggested title" : "Copy suggested caption"}
                            text={activeHandoff.primaryCopyText}
                          />
                        </li>
                        <li>
                          <span>3</span>
                          <div><strong>Open the platform upload</strong><small>Upload the video, paste the copy, and confirm the cover and privacy.</small></div>
                          <a className="button tertiary" href={activeHandoff.uploadUrl} target="_blank" rel="noreferrer">
                            {getPlatformUploadActionLabel(activeHandoff.platform)}
                          </a>
                        </li>
                      </ol>
                      <div className="caption-copy-grid premium-handoff-extras">
                        {activeHandoff.platform === "YouTube Shorts" ? <CopyCaptionButton label="Copy suggested caption" text={activeHandoff.captionText} /> : null}
                        <CopyCaptionButton label="Copy hashtags" text={(activePlatformPayload?.hashtags ?? selectedReadyPackage.hashtags).join(" ")} />
                      </div>
                    </div>
                  ) : null}
                </details>
              ) : null}
              <div className="premium-ready-finish-heading">
                <span>3</span>
                <div>
                  <strong>{selectedClip.mediaReady ? selectedNeedsEditorialReview ? "Review, then download or schedule" : "Download or schedule" : "Refresh the final media"}</strong>
                  <small>{selectedClip.mediaReady ? selectedNeedsEditorialReview ? "The video is prepared; editorial readiness still needs your decision." : "Choose the handoff that fits your media team." : "Repair the prepared file before it can be posted."}</small>
                </div>
              </div>
              <div className="selected-asset-actions">
                {selectedClip.mediaReady ? (
                  <>
                    {!controlPanelMode ? <a className="button primary" href={selectedReadyPackage.downloadHref}>Download video</a> : null}
                    <CopyCaptionButton label="Copy suggested copy" text={activeHandoff?.captionText ?? selectedClip.caption} />
                    <SchedulePostButton
                      clipId={selectedClip.id}
                      clipDetails={[buildScheduleClipSummary(selectedClip)]}
                      label="Schedule"
                      initialPlatform={activeCaptionPlatform}
                      socialAccounts={socialAccounts}
                      onDraftCreated={addDraft}
                    />
                  </>
                ) : (
                  <ClipAssetRecoveryButton
                    clipId={selectedClip.id}
                    label="Refresh media"
                    busyLabel="Refreshing media..."
                    variant="primary"
                  />
                )}
                <Link href={`/sermons/${selectedClip.sermon.id}/clips/${selectedClip.id}/studio`} className="button tertiary">Edit clip</Link>
              </div>
              <div className="ready-mobile-action-bar" aria-label="Selected clip actions">
                {selectedClip.mediaReady ? (
                  <>
                    {!controlPanelMode ? <a className="button primary" href={selectedReadyPackage.downloadHref}>Download</a> : null}
                    <CopyCaptionButton label="Copy suggested copy" text={activeHandoff?.captionText ?? selectedClip.caption} />
                    <SchedulePostButton
                      clipId={selectedClip.id}
                      clipDetails={[buildScheduleClipSummary(selectedClip)]}
                      label="Schedule"
                      initialPlatform={activeCaptionPlatform}
                      socialAccounts={socialAccounts}
                      onDraftCreated={addDraft}
                    />
                    <Link href={`/sermons/${selectedClip.sermon.id}/clips/${selectedClip.id}/studio`} className="button tertiary">Edit clip</Link>
                  </>
                ) : (
                  <>
                    <ClipAssetRecoveryButton
                      clipId={selectedClip.id}
                      label="Refresh"
                      busyLabel="Refreshing..."
                      variant="primary"
                    />
                    <Link href={`/sermons/${selectedClip.sermon.id}/clips/${selectedClip.id}/studio`} className="button tertiary">Edit clip</Link>
                  </>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="No prepared clip selected"
              description="Finished clips will appear here after preparation completes."
            />
          )}
        </aside>
      </section>

      <section id="posting-calendar" className="social-calendar-panel premium-ready-calendar" aria-label="Mixed-content social media calendar">
        <div className="social-calendar-header">
          <div>
            <p className="kicker">Plan ahead</p>
            <h2>Mixed-content calendar</h2>
            <p className="muted small">
              Track clips, quote cards, carousels, prayers, devotionals, and invitations in one publishing plan.
            </p>
          </div>
          <div className="social-calendar-window-controls" aria-label="Calendar window controls">
            <button type="button" className="button tertiary" onClick={() => moveCalendarWindow(-calendarDayCount)}>
              Previous
            </button>
            <button type="button" className="button tertiary" onClick={resetCalendarWindow}>
              Today
            </button>
            <button type="button" className="button tertiary" onClick={() => moveCalendarWindow(calendarDayCount)}>
              Next
            </button>
            <button type="button" className="button secondary" onClick={refreshScheduledPosts}>
              Refresh
            </button>
          </div>
        </div>

        <section className={`publishing-service-card is-${publishingServiceHealth.status.toLowerCase()}`} aria-label="Automatic publishing service status">
          <div className="publishing-service-copy">
            <span className="publishing-service-indicator" aria-hidden="true" />
            <div>
              <strong>{publishingServiceLabel(publishingServiceHealth)}</strong>
              <p className="muted small">{publishingServiceHealth.summary}</p>
            </div>
          </div>
          <div className="publishing-service-actions">
            <button type="button" className="button tertiary" onClick={() => void refreshPublishingServiceHealth()}>
              Check service
            </button>
            <details className="publishing-service-details">
              <summary>Technical details</summary>
              <dl>
                <div><dt>Last signal</dt><dd>{formatPublishingServiceLastSeen(publishingServiceHealth)}</dd></div>
                <div><dt>Service mode</dt><dd>{publishingServiceHealth.status !== "ONLINE" ? "Not reported" : publishingServiceHealth.dryRun ? "Test mode" : "Live publishing"}</dd></div>
                <div><dt>Worker reference</dt><dd>{publishingServiceHealth.workerId ?? "Not recorded"}</dd></div>
              </dl>
            </details>
          </div>
        </section>

        <div className="social-calendar-toolbar">
          <div className="social-calendar-summary">
            <strong>{calendarWindowLabel}</strong>
            <span>
              {calendarPlannedCount} active · {calendarPostedCount} posted · {calendarGeneratedContentCount} generated post{calendarGeneratedContentCount === 1 ? "" : "s"}
              {calendarClipIds.length > 0 ? ` · ${calendarClipIds.length} clip${calendarClipIds.length === 1 ? "" : "s"} selected` : ""}
            </span>
          </div>
          <label className="ready-select-field">
            <span>Platform</span>
            <select value={calendarPlatformFilter} onChange={(event) => setCalendarPlatformFilter(event.target.value as CalendarPlatformFilter)}>
              <option value="ALL">All platforms</option>
              {PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </label>
          <label className="ready-select-field">
            <span>Status</span>
            <select value={calendarStatusFilter} onChange={(event) => setCalendarStatusFilter(event.target.value as CalendarStatusFilter)}>
              {(Object.keys(CALENDAR_STATUS_FILTER_LABELS) as CalendarStatusFilter[]).map((filter) => (
                <option key={filter} value={filter}>{CALENDAR_STATUS_FILTER_LABELS[filter]}</option>
              ))}
            </select>
          </label>
        </div>

        <PublishingFeedback
          message={publishingMessage}
          correction={publishingCorrection}
          pending={Boolean(pendingScheduledPostId)}
          onCorrect={(postId, status, expectedCurrentStatus) => void correctPublishingStatus(postId, status, expectedCurrentStatus)}
        />

        <div className="social-calendar-grid" aria-label="Upcoming social media posts">
          {calendarDays.map((day) => (
            <article
              key={day.key}
              className={`social-calendar-day ${day.isToday ? "is-today" : ""} ${day.isPast ? "is-past" : ""}`}
            >
              <div className="social-calendar-day-head">
                <div className="social-calendar-date">
                  <span>{formatCalendarMonth(day.date)}</span>
                  <strong>{formatCalendarDayNumber(day.date)}</strong>
                </div>
                <div>
                  <h3>{formatCalendarDayName(day.date)}</h3>
                  <p className="muted small">
                    {day.posts.length === 0
                      ? "Open slot"
                      : `${day.posts.length} post${day.posts.length === 1 ? "" : "s"} · ${day.plannedCount} active`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="button tertiary social-calendar-schedule-button"
                onClick={() => openCalendarSchedule(day)}
                disabled={calendarClipIds.length === 0}
              >
                Schedule here
              </button>

              <div className="social-calendar-post-list">
                {day.posts.length === 0 ? (
                  <p className="muted small">No posts planned for this day.</p>
                ) : day.posts.slice(0, 5).map((post) => {
                  const title = buildScheduledPostTitle(post, clips);
                  const captionText = buildScheduledPostCaption(post, clips);
                  const isPending = pendingScheduledPostId === post.id;
                  const publishingLocked = isPublishingInFlight(post);
                  const canReschedule = canReschedulePublishingPost(post);
                  const canCancel = canCancelPublishingPost(post);
                  const canQueueForPublishing = post.automationMode === "AUTOMATIC"
                    && (post.status === "PLANNED" || post.status === "FAILED")
                    && !post.externalPostId
                    && !post.publishedUrl
                    && !post.finalPrivacyStatus;
                  const queueActionLabel = post.status === "FAILED" ? "Retry publishing" : "Queue for publishing";
                  const queuePendingLabel = post.status === "FAILED" ? "Retrying..." : "Queuing...";

                  return (
                    <div key={post.id} className={`social-calendar-post ${getCalendarPostToneClass(post)}`}>
                      <div className={`platform-mark platform-${getPlatformClass(post.platform)}`} aria-hidden="true">
                        <PlatformIcon platform={post.platform} />
                      </div>
                      <div className="social-calendar-post-copy">
                        <strong>{formatCalendarTime(post.scheduledFor)} · {post.platform}</strong>
                        <span>{title}</span>
                        <small>{post.socialAccountLabel ?? "Media team handoff"}</small>
                        <div className="clip-badge-row">
                          <span className={`status-pill ${post.status === "POSTED" ? "status-exported" : ""}`}>
                            {SCHEDULED_POST_STATUS_LABELS[post.status]}
                          </span>
                          <span className="status-pill">{post.automationMode === "AUTOMATIC" ? "Automatic" : "Manual"}</span>
                          {(post.contentAssets ?? []).slice(0, 2).map((asset) => (
                            <span key={asset.id} className="status-pill">{asset.assetType.replace(/_/g, " ").toLowerCase()}</span>
                          ))}
                        </div>
                        {post.publishError ? (
                          <div className="error-banner stack-sm">
                            <span>{formatPublishingError(post.publishError)}</span>
                            <Link href="/settings/social" className="text-link small">Review social channels</Link>
                          </div>
                        ) : null}
                        {post.automationMode === "AUTOMATIC" ? <PublishingTechnicalDetails post={post} /> : null}
                      </div>
                      <div className="social-calendar-post-actions">
                        <label className="social-calendar-reschedule-field" htmlFor={`reschedule-${post.id}`}>
                          <span>Time</span>
                          <input
                            id={`reschedule-${post.id}`}
                            type="datetime-local"
                            value={rescheduleValues[post.id] ?? (post.scheduledFor ? toDateTimeLocalInputValue(new Date(post.scheduledFor)) : "")}
                            onChange={(event) => updateRescheduleValue(post, event.target.value)}
                            disabled={isPending || publishingLocked || !canReschedule}
                          />
                        </label>
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => reschedulePost(post)}
                          disabled={isPending || publishingLocked || !canReschedule}
                        >
                          {isPending ? "Saving..." : "Save time"}
                        </button>
                        {canQueueForPublishing ? (
                          <button
                            type="button"
                            className="button tertiary"
                            onClick={() => requestPublishingConfirmation(post, "QUEUE")}
                            disabled={isPending}
                          >
                            {isPending ? queuePendingLabel : queueActionLabel}
                          </button>
                        ) : null}
                        <CopyCaptionButton label="Copy caption" text={captionText || "Caption pending"} />
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => requestPublishingConfirmation(post, "MARK_POSTED")}
                          disabled={isPending || publishingLocked || post.status === "POSTED"}
                        >
                          {isPending ? "Updating..." : "Mark posted"}
                        </button>
                        {canCancel ? (
                          <button
                            type="button"
                            className="button tertiary"
                            onClick={() => requestPublishingConfirmation(post, "CANCEL")}
                            disabled={isPending || publishingLocked}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {day.posts.length > 5 ? (
                  <p className="muted small">+ {day.posts.length - 5} more post{day.posts.length - 5 === 1 ? "" : "s"} this day</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {unscheduledCalendarPosts.length > 0 ? (
          <details className="social-calendar-unscheduled">
            <summary>{unscheduledCalendarPosts.length} post{unscheduledCalendarPosts.length === 1 ? "" : "s"} without exact calendar time</summary>
            <div className="manual-publishing-list">
              {unscheduledCalendarPosts.slice(0, 6).map((post) => (
                <article key={post.id} className="manual-publishing-card compact-calendar-card">
                  <div className={`platform-mark platform-${getPlatformClass(post.platform)}`} aria-hidden="true">
                    <PlatformIcon platform={post.platform} />
                  </div>
                  <div className="manual-publishing-copy">
                    <h3>{post.platform} · {post.postingSlot}</h3>
                    <p className="muted small">{buildScheduledPostTitle(post, clips)}</p>
                    <span className="status-pill">{SCHEDULED_POST_STATUS_LABELS[post.status]}</span>
                  </div>
                  <div className="manual-publishing-actions">
                    <CopyCaptionButton label="Copy caption" text={buildScheduledPostCaption(post, clips) || "Caption pending"} />
                    <button
                      type="button"
                      className="button tertiary"
                      onClick={() => requestPublishingConfirmation(post, "MARK_POSTED")}
                      disabled={pendingScheduledPostId === post.id || isPublishingInFlight(post) || post.status === "POSTED"}
                    >
                      Mark posted
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section id="publishing-support" className="ready-support-grid premium-ready-support" aria-label="Publishing support">
        <details className="posting-draft-panel compact-panel ready-support-details">
          <summary>
            <div>
              <p className="kicker">Support</p>
              <h2>Channels and downloads</h2>
              <p className="muted small">{socialAccounts.length} channels · {scopedDrafts.length} handoffs · {scopedPackageHistory.length} downloads</p>
            </div>
          </summary>
          <div className="setup-list">
            <article className="setup-item">
              <div>
                <h3>{socialAccounts.length} church channel{socialAccounts.length === 1 ? "" : "s"}</h3>
                <p className="muted small">
                  {socialAccounts[0]
                    ? `${socialAccounts[0].label}${socialAccounts[0].handle ? ` · ${socialAccounts[0].handle}` : ""}`
                    : "Add account labels so drafts route to the right page."}
                </p>
              </div>
              <span className="status-pill">Accounts</span>
            </article>
            <article className="setup-item">
              <div>
                <h3>{scopedDrafts.length} handoff{scopedDrafts.length === 1 ? "" : "s"}</h3>
                <p className="muted small">{scopedDrafts[0] ? `${scopedDrafts[0].postingSlot} · ${scopedDrafts[0].platforms.join(", ")}` : "Select clips and schedule them."}</p>
              </div>
              <span className="status-pill status-exported">Drafts</span>
            </article>
            <article className="setup-item package-history-overview">
              <div>
                <h3>{scopedPackageHistory.length} recent download{scopedPackageHistory.length === 1 ? "" : "s"}</h3>
                <p className="muted small">Re-download a recent handoff when the media team needs it again.</p>
              </div>
              <span className="status-pill">{scopedPackageHistory.length > 0 ? "Recent" : "Empty"}</span>
            </article>
            {scopedPackageHistory.length > 0 && !controlPanelMode ? (
              <details className="package-history-details">
                <summary>Show recent downloads</summary>
                <div className="package-history-list" aria-label="Recent package history">
                  {scopedPackageHistory.slice(0, 3).map((item) => (
                    <article key={item.id} className="package-history-card">
                      <div>
                        <h3>{item.fileName}</h3>
                        <p className="muted small">
                          {item.clipCount} clip{item.clipCount === 1 ? "" : "s"} · {formatPackageSize(item.totalVideoBytes) ?? "Size unavailable"} · {formatPackageCreatedAt(item.createdAt)}
                        </p>
                      </div>
                      <a className="button tertiary" href={buildPackageHistoryDownloadHref(item.clipIds)}>Re-download</a>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
          <ReadyQueueActions
            clipCount={downloadableClips.length}
            selectedCount={selectedDownloadableClipIds.length}
            downloadHref={batchDownloadHref}
            selectedClipIds={selectedDownloadableClipIds}
            clipDetails={downloadableClips.map(buildScheduleClipSummary)}
            socialAccounts={socialAccounts}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDraftCreated={addDraft}
            onSocialAccountCreated={addSocialAccount}
            onSocialAccountsSynced={syncSocialAccounts}
            controlPanelMode={controlPanelMode}
          />
        </details>

        <details className="posting-draft-panel compact-panel ready-support-details">
          <summary>
            <div>
              <p className="kicker">Planned posts</p>
              <h2>{scopedScheduledPosts.length} upload{scopedScheduledPosts.length === 1 ? "" : "s"} planned</h2>
              <p className="muted small">
                {controlPanelMode
                  ? "Scheduled posts are listed here. Open the Mac app to preview and download local media."
                  : "A quiet view of what is scheduled, ready for upload, or already posted."}
              </p>
            </div>
          </summary>
          <div className="publishing-section-head compact ready-support-actions">
            <button type="button" className="button tertiary" onClick={refreshScheduledPosts}>Refresh</button>
          </div>

          <div className="publishing-toolbar">
            <span className="publishing-search-chip">{postedCount} posted</span>
            {hiddenScheduledClipCount > 0 ? <span className="publishing-search-chip">{hiddenScheduledClipCount} moved from ready</span> : null}
            <div className="publishing-segmented" aria-label="Filter scheduled posts">
              {(Object.keys(PUBLISHING_FILTER_LABELS) as PublishingFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={publishingFilter === filter ? "active" : ""}
                  onClick={() => setPublishingFilter(filter)}
                >
                  {PUBLISHING_FILTER_LABELS[filter]}
                </button>
              ))}
            </div>
          </div>

          <PublishingFeedback
            message={publishingMessage}
            correction={publishingCorrection}
            pending={Boolean(pendingScheduledPostId)}
            onCorrect={(postId, status, expectedCurrentStatus) => void correctPublishingStatus(postId, status, expectedCurrentStatus)}
          />

          {scopedScheduledPosts.length === 0 ? (
            <div className="publishing-empty-state">
              <h3>{approvedWaitingCount > 0 ? "Scheduling unlocks after preparation" : "No planned posts yet"}</h3>
              <p className="muted small">
                {approvedWaitingCount > 0
                  ? "Prepare approved clips first. Then schedule the strongest clips for the week."
                  : "Schedule a ready clip when you know where it should go."}
              </p>
            </div>
          ) : filteredScheduledPosts.length === 0 ? (
            <div className="publishing-empty-state">
              <h3>No {PUBLISHING_FILTER_LABELS[publishingFilter].toLowerCase()} uploads</h3>
              <p className="muted small">Switch filters to see the rest of the posting plan.</p>
            </div>
          ) : (
            <div className="manual-publishing-list">
              {groupedScheduledPosts.slice(0, 8).map((post) => {
                const downloadHref = buildPackageHistoryDownloadHref(post.clipIds);
                const captionText = buildScheduledPostCaption(post, clips);
                const title = buildScheduledPostTitle(post, clips);
                const firstClip = post.clipIds.map((clipId) => clips.find((clip) => clip.id === clipId)).find(Boolean);
                const platformHandoff = firstClip ? getPlatformHandoff(firstClip, post.platform) : null;
                const isPending = pendingScheduledPostId === post.id;
                const publishingLocked = isPublishingInFlight(post);
                const canQueueForPublishing = post.automationMode === "AUTOMATIC"
                  && (post.status === "PLANNED" || post.status === "FAILED")
                  && !post.externalPostId
                  && !post.publishedUrl
                  && !post.finalPrivacyStatus;
                const queueActionLabel = post.status === "FAILED" ? "Retry publishing" : "Queue for publishing";
                const queuePendingLabel = post.status === "FAILED" ? "Retrying..." : "Queuing...";
                const savedPrimaryCopy = post.platform === "YouTube Shorts" ? title : captionText;

                return (
                  <article key={post.id} className="manual-publishing-card">
                    <div className={`platform-mark platform-${getPlatformClass(post.platform)}`} aria-hidden="true">
                      <PlatformIcon platform={post.platform} />
                    </div>
                    <div className="manual-publishing-copy">
                      <h3>{post.platform} · {post.postingSlot}</h3>
                      <p className="muted small">
                        {title}{post.socialAccountLabel ? ` · ${post.socialAccountLabel}` : " · Media team handoff"}
                      </p>
                      {post.scheduledFor ? (
                        <p className="muted small">
                          {post.automationMode === "AUTOMATIC" ? "Automatic" : "Manual"} · {new Intl.DateTimeFormat(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(post.scheduledFor))}
                        </p>
                      ) : (
                        <p className="muted small">{post.automationMode === "AUTOMATIC" ? "Automatic" : "Manual"} · No exact time set</p>
                      )}
                      {post.note ? <p className="muted small">{post.note}</p> : null}
                      {post.publishError ? (
                        <div className="error-banner stack-sm">
                          <span>{formatPublishingError(post.publishError)}</span>
                          <Link href="/settings/social" className="text-link small">Review social channels</Link>
                        </div>
                      ) : null}
                      {post.automationMode === "AUTOMATIC" ? <PublishingTechnicalDetails post={post} /> : null}
                      {post.publishedUrl ? (
                        <a className="text-link small" href={post.publishedUrl} target="_blank" rel="noreferrer">
                          {post.status === "POSTED" ? "View published post" : "Review platform result"}
                        </a>
                      ) : null}
                      <div className="clip-badge-row">
                        <span className={`status-pill ${post.status === "POSTED" ? "status-exported" : ""}`}>
                          {SCHEDULED_POST_STATUS_LABELS[post.status]}
                        </span>
                        <span className="status-pill">{post.clipIds.length} clip{post.clipIds.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="posting-checklist" aria-label={`${post.platform} posting checklist`}>
                        <span className="posting-check-step is-ready">Video</span>
                        <span className={`posting-check-step ${captionText ? "is-ready" : "needs-attention"}`}>Caption</span>
                        <span className={`posting-check-step ${post.status === "POSTED" ? "is-ready" : ""}`}>Posted</span>
                      </div>
                    </div>
                    <div className="manual-publishing-actions">
                      {canQueueForPublishing ? (
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => requestPublishingConfirmation(post, "QUEUE")}
                          disabled={isPending}
                        >
                          {isPending ? queuePendingLabel : queueActionLabel}
                        </button>
                      ) : null}
                      {post.automationMode === "MANUAL" && !controlPanelMode ? <a className="button secondary" href={downloadHref}>Download</a> : null}
                      <CopyCaptionButton
                        label={post.platform === "YouTube Shorts" ? "Copy title" : "Copy caption"}
                        text={savedPrimaryCopy || platformHandoff?.primaryCopyText || `${post.platform} copy pending`}
                      />
                      {post.platform === "YouTube Shorts" ? <CopyCaptionButton label="Copy caption" text={captionText || "Caption pending"} /> : null}
                      {post.automationMode === "MANUAL" ? <a className="button tertiary" href={platformHandoff?.uploadUrl ?? "#"} target="_blank" rel="noreferrer">
                        {getPlatformUploadActionLabel(post.platform)}
                      </a> : null}
                      <button
                        type="button"
                        className={canQueueForPublishing ? "button tertiary" : "button primary"}
                        onClick={() => requestPublishingConfirmation(post, "MARK_POSTED")}
                        disabled={isPending || publishingLocked || post.status === "POSTED"}
                      >
                        {isPending ? "Updating..." : "Mark posted"}
                      </button>
                      {post.status !== "POSTED" ? (
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => requestPublishingConfirmation(post, "SKIP")}
                          disabled={isPending || publishingLocked || post.status === "SKIPPED"}
                        >
                          Skip
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </details>
      </section>

      {calendarScheduleIntent ? (
        <ScheduleDraftModal
          key={calendarScheduleIntent.key}
          clipIds={calendarScheduleIntent.clipIds}
          clipDetails={calendarScheduleIntent.clipDetails}
          socialAccounts={socialAccounts}
          initialAutomationMode="AUTOMATIC"
          initialPostingSlot={calendarScheduleIntent.postingSlot}
          initialScheduledFor={calendarScheduleIntent.scheduledFor}
          open
          onClose={() => setCalendarScheduleIntent(null)}
          onCreated={(draft) => {
            addDraft(draft);
            setCalendarScheduleIntent(null);
          }}
        />
      ) : null}
      {publishingConfirmation ? (
        <PublishingConfirmationDialog
          confirmation={publishingConfirmation}
          pending={publishingConfirmationPending}
          onClose={() => setPublishingConfirmation(null)}
          onConfirm={() => void confirmPublishingAction()}
        />
      ) : null}
    </>
  );
}
