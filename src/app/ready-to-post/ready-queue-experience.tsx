"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { CopyCaptionButton } from "@/app/ready-to-post/copy-caption-button";
import { ReadyQueueActions, SchedulePostButton } from "@/app/ready-to-post/ready-queue-actions";
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
import type { ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";

export type ReadyQueueClip = {
  id: string;
  title: string;
  hook: string;
  caption: string;
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
  controlPanelMode?: boolean;
};

type VideoPreviewState = "poster" | "loading" | "ready" | "playing" | "paused" | "error";
type PublishingFilter = "PLANNED" | "READY_FOR_MEDIA_TEAM" | "POSTING" | "FAILED" | "POSTED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";
type ClipQualityFilter = "ALL" | "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | "NEEDS_REVIEW";
type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";

const VIDEO_PREVIEW_LABELS: Record<VideoPreviewState, string> = {
  poster: "Ready preview",
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

function getPlatformHandoff(clip: ReadyQueueClip, platform: ScheduledPost["platform"]): PlatformUploadHandoff | null {
  const readyPackage = buildReadyToPostPackage({
    clipId: clip.id,
    title: clip.title,
    hook: clip.hook,
    caption: clip.caption,
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

function getPlatformInitials(platform: ScheduledPost["platform"]): string {
  switch (platform) {
    case "Instagram":
      return "IG";
    case "TikTok":
      return "TT";
    case "YouTube Shorts":
      return "YT";
    case "Facebook":
      return "FB";
  }
}

function getPlatformClass(platform: ScheduledPost["platform"]): string {
  return platform.toLowerCase().replace(/\s+/g, "-");
}

function hasClipOverlap(clipIds: string[], scopeClipIds: Set<string> | null): boolean {
  if (!scopeClipIds) {
    return true;
  }

  return clipIds.some((clipId) => scopeClipIds.has(clipId));
}

function getScheduledPostGroupKey(post: ScheduledPost): string {
  return [post.platform, post.postingSlot, [...post.clipIds].sort().join("|")].join("::");
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

export function ReadyQueueExperience({
  clips,
  clipScopeIds = null,
  approvedWaitingCount = 0,
  initialDrafts,
  packageHistory,
  initialSocialAccounts,
  initialScheduledPosts,
  controlPanelMode = false,
}: ReadyQueueExperienceProps) {
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<PostingDraft[]>(initialDrafts);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>(initialSocialAccounts);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>(initialScheduledPosts);
  const [publishingMessage, setPublishingMessage] = useState("");
  const [pendingScheduledPostId, setPendingScheduledPostId] = useState<string | null>(null);
  const [publishingFilter, setPublishingFilter] = useState<PublishingFilter>("PLANNED");
  const [qualityFilter, setQualityFilter] = useState<ClipQualityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedClipId, setFocusedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [activeCaptionPlatform, setActiveCaptionPlatform] = useState<ScheduledPost["platform"]>("TikTok");
  const [videoPreviewStates, setVideoPreviewStates] = useState<Record<string, VideoPreviewState>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const clipScopeIdSet = useMemo(() => clipScopeIds ? new Set(clipScopeIds) : null, [clipScopeIds]);
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const downloadableClips = useMemo(() => clips.filter((clip) => clip.mediaReady), [clips]);
  const downloadableClipIds = useMemo(() => new Set(downloadableClips.map((clip) => clip.id)), [downloadableClips]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredClips = useMemo(() => {
    return clips.filter((clip) => {
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
  }, [clips, normalizedSearchQuery, qualityFilter]);
  const selectedDownloadableClipIds = selectedClipIds.filter((clipId) => downloadableClipIds.has(clipId));
  const batchDownloadHref = buildBatchDownloadHref(
    selectedDownloadableClipIds.length > 0 ? selectedDownloadableClipIds : downloadableClips.map((clip) => clip.id),
  );
  const selectedClip = clips.find((clip) => clip.id === focusedClipId)
    ?? clips.find((clip) => selectedClipIdSet.has(clip.id))
    ?? filteredClips[0]
    ?? clips[0]
    ?? null;
  const selectedReadyPackage = selectedClip
    ? buildReadyToPostPackage({
      clipId: selectedClip.id,
      title: selectedClip.title,
      hook: selectedClip.hook,
      caption: selectedClip.caption,
      hashtags: selectedClip.hashtags,
      estimatedBytes: selectedClip.estimatedBytes,
      smartClipCategory: selectedClip.smartClipCategory,
      intendedAudience: selectedClip.intendedAudience,
    })
    : null;
  const selectedQualityLabel = selectedClip ? getQualityLabel(selectedClip) : null;
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
  const activeCaptionVariant = selectedReadyPackage?.variants.find((variant) => variant.platform === activeCaptionPlatform)
    ?? selectedReadyPackage?.variants[0]
    ?? null;
  const scopedDrafts = drafts.filter((draft) => hasClipOverlap(draft.clipIds, clipScopeIdSet));
  const scopedPackageHistory = packageHistory.filter((item) => hasClipOverlap(item.clipIds, clipScopeIdSet));
  const scopedScheduledPosts = scheduledPosts.filter((post) => hasClipOverlap(post.clipIds, clipScopeIdSet));
  const postedCount = scopedScheduledPosts.filter((post) => post.status === "POSTED").length;
  const filteredScheduledPosts = scopedScheduledPosts.filter((post) => post.status === publishingFilter);
  const groupedScheduledPosts = Array.from(
    new Map(filteredScheduledPosts.map((post) => [getScheduledPostGroupKey(post), post])).values(),
  );

  function toggleClip(clipId: string) {
    setFocusedClipId(clipId);
    setSelectedClipIds((current) => (
      current.includes(clipId)
        ? current.filter((item) => item !== clipId)
        : [...current, clipId]
    ));
  }

  function selectAll() {
    setSelectedClipIds(filteredClips.length > 0 ? filteredClips.map((clip) => clip.id) : clips.map((clip) => clip.id));
  }

  function clearSelection() {
    setSelectedClipIds([]);
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
    void refreshScheduledPosts();
  }

  function addSocialAccount(account: SocialAccount) {
    setSocialAccounts((current) => [account, ...current].slice(0, 100));
  }

  async function patchScheduledPost(
    postId: string,
    body: { status: "READY_FOR_MEDIA_TEAM" | "POSTED" | "FAILED" | "SKIPPED" } | { action: "POST_NOW" },
  ) {
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
        return;
      }
      setScheduledPosts((current) => current.map((post) => (post.id === postId ? data.scheduledPost : post)));
      if ("action" in body && body.action === "POST_NOW") {
        setPublishingMessage("Post moved to now. The Mac worker will pick it up on its next check.");
      } else if ("status" in body) {
        setPublishingMessage(body.status === "POSTED" ? "Post marked as published." : "Scheduled post updated.");
      }
    } catch {
      setPublishingMessage("Could not update this scheduled post.");
    } finally {
      setPendingScheduledPostId(null);
    }
  }

  async function updateScheduledPostStatus(postId: string, status: "READY_FOR_MEDIA_TEAM" | "POSTED" | "FAILED" | "SKIPPED") {
    await patchScheduledPost(postId, { status });
  }

  async function postScheduledPostNow(postId: string) {
    await patchScheduledPost(postId, { action: "POST_NOW" });
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
      <section className="publishing-desk-grid ready-master-detail" aria-label="Publishing workspace">
        <div className="publishing-board-panel">
          <div className="publishing-section-head">
            <div>
              <p className="kicker">Ready clips</p>
              <h2>Choose what to post next</h2>
              <p className="muted small">Preview a finished clip, copy the caption, then download or schedule it.</p>
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
          {clips.length === 0 ? (
            <EmptyState
              title={approvedWaitingCount > 0 ? "Approved clips are waiting above" : "No finished clips yet"}
              description={
                approvedWaitingCount > 0
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
                const readyPackage = buildReadyToPostPackage({
                  clipId: clip.id,
                  title: clip.title,
                  hook: clip.hook,
                  caption: clip.caption,
                  hashtags: clip.hashtags,
                  estimatedBytes: clip.estimatedBytes,
                  smartClipCategory: clip.smartClipCategory,
                  intendedAudience: clip.intendedAudience,
                });
                const qualityLabel = getQualityLabel(clip);
                const qualityIssues = buildReadinessIssues(clip);
                const isBatchSelected = selectedClipIdSet.has(clip.id);
                const isFocused = selectedClip?.id === clip.id;

                return (
                  <article key={clip.id} className={`asset-tray-card ${isBatchSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}>
                    <button type="button" className="asset-tray-thumb" onClick={() => focusClip(clip.id)} aria-label={`Preview ${clip.title}`}>
                      {controlPanelMode ? (
                        <strong className="asset-tray-thumb-placeholder" aria-hidden="true">SC</strong>
                      ) : (
                        <Image src={`/api/clips/${clip.id}/thumbnail`} alt="" width={72} height={128} />
                      )}
                      <span>{isFocused ? "Previewing" : "Preview"}</span>
                    </button>
                    <div className="asset-tray-main">
                      <label className="asset-select-check">
                        <input type="checkbox" checked={isBatchSelected} onChange={() => toggleClip(clip.id)} />
                        <span>{clip.title}</span>
                      </label>
                      <p className="muted small">{clip.sermon.title}</p>
                      <p className="muted small">{readyPackage.contentsLabel}{readyPackage.sizeLabel ? ` · ${readyPackage.sizeLabel}` : ""}</p>
                    </div>
                    <div className="clip-badge-row">
                      <span className={`status-pill ${getQualityToneClass(qualityLabel)}`}>
                        {getQualityLabelText(qualityLabel)}
                      </span>
                      <span className={`status-pill ${clip.mediaReady ? "status-exported" : "quality-reject"}`}>
                        {clip.mediaReady ? "Ready to share" : "Needs repair"}
                      </span>
                    </div>
                    {qualityIssues[0] ? <p className="muted small">{qualityIssues[0]}</p> : null}
                    <div className="selected-asset-actions compact-actions">
                      {clip.mediaReady && !controlPanelMode ? (
                        <a className="button secondary" href={readyPackage.downloadHref}>Download</a>
                      ) : clip.mediaReady ? null : (
                        <ClipAssetRecoveryButton
                          clipId={clip.id}
                          label="Refresh media"
                          busyLabel="Refreshing..."
                          variant="secondary"
                        />
                      )}
                      <button type="button" className="button tertiary" onClick={() => focusClip(clip.id)}>
                        {isFocused ? "Previewing" : "Preview"}
                      </button>
                      {clip.mediaReady ? <SchedulePostButton clipId={clip.id} label="Schedule" onDraftCreated={addDraft} /> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="selected-asset-panel" aria-label="Selected ready clip">
          {selectedClip && selectedReadyPackage ? (
            <>
              <div className="publishing-section-head compact">
                <div>
                  <p className="kicker">Preview and post</p>
                  <h2>{selectedClip.title}</h2>
                  <p className="muted small">{selectedClip.sermon.title}</p>
                </div>
                <span className={`status-pill ${getQualityToneClass(selectedQualityLabel)}`}>
                  {getQualityLabelText(selectedQualityLabel)}
                </span>
              </div>
              <div className={`selected-action-summary ${selectedClip.mediaReady ? "is-ready" : "needs-attention"}`}>
                <div>
                  <strong>{selectedClip.mediaReady ? "Ready to share" : "Needs media refresh"}</strong>
                  <span>
                    {selectedClip.mediaReady
                      ? "Preview the clip, copy the caption, then download or schedule it."
                      : "Refresh the media before downloading or scheduling this clip."}
                  </span>
                </div>
                <span className="status-pill">{selectedClip.mediaReady ? "Next: post" : "Next: repair"}</span>
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
              {!controlPanelMode ? <div
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
                <span className="video-quality-pill">{selectedClip.mediaReady ? "Ready" : "Needs repair"}</span>
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
                  <p className="muted small">The Vercel control panel does not stream local clip files. Use the Mac app for preview and downloads.</p>
                </div>
              )}
              <div className="selected-asset-actions">
                {selectedClip.mediaReady ? (
                  <>
                    {!controlPanelMode ? <a className="button primary" href={selectedReadyPackage.downloadHref}>Download video</a> : null}
                    <CopyCaptionButton label="Copy caption" text={activeHandoff?.captionText ?? selectedClip.caption} />
                    <SchedulePostButton clipId={selectedClip.id} label="Schedule" onDraftCreated={addDraft} />
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
              <div className="platform-caption-panel">
                <div className="platform-caption-tabs" role="tablist" aria-label="Platform caption previews">
                  {PLATFORMS.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      className={activeCaptionPlatform === platform ? "active" : ""}
                      onClick={() => setActiveCaptionPlatform(platform)}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
                {activeHandoff ? (
                  <div className="platform-caption-card">
                    <div className="publishing-section-head compact">
                      <div>
                        <p className="kicker">{activeHandoff.platform}</p>
                        <h3>{activeCaptionVariant?.label ?? `${activeHandoff.platform} handoff`}</h3>
                      </div>
                      <span className="status-pill">{activeHandoff.captionText.length} chars</span>
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
                    </div>
                    <div className="caption-copy-grid">
                      <CopyCaptionButton label={activeHandoff.primaryCopyLabel} text={activeHandoff.primaryCopyText} />
                      {activeHandoff.platform === "YouTube Shorts" ? <CopyCaptionButton label="Copy caption" text={activeHandoff.captionText} /> : null}
                      <CopyCaptionButton label="Copy hashtags" text={selectedReadyPackage.hashtags.join(" ")} />
                      <a className="button tertiary" href={activeHandoff.uploadUrl} target="_blank" rel="noreferrer">
                        Open {activeHandoff.platform === "YouTube Shorts" ? "Studio" : activeHandoff.platform}
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="ready-mobile-action-bar" aria-label="Selected clip actions">
                {selectedClip.mediaReady ? (
                  <>
                    {!controlPanelMode ? <a className="button primary" href={selectedReadyPackage.downloadHref}>Download</a> : null}
                    <CopyCaptionButton label="Copy caption" text={activeHandoff?.captionText ?? selectedClip.caption} />
                    <SchedulePostButton clipId={selectedClip.id} label="Schedule" onDraftCreated={addDraft} />
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
              title="No ready clip selected"
              description="Finished clips will appear here after preparation completes."
            />
          )}
        </aside>
      </section>

      <section className="ready-support-grid" aria-label="Publishing support">
        <div className="posting-draft-panel compact-panel">
          <div className="publishing-section-head compact">
            <div>
              <p className="kicker">Support</p>
              <h2>Channels and downloads</h2>
            </div>
          </div>
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
            socialAccounts={socialAccounts}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDraftCreated={addDraft}
            onSocialAccountCreated={addSocialAccount}
            controlPanelMode={controlPanelMode}
          />
        </div>

        <div className="posting-draft-panel compact-panel">
          <div className="publishing-section-head compact">
            <div>
              <p className="kicker">Planned posts</p>
              <h2>{scopedScheduledPosts.length} upload{scopedScheduledPosts.length === 1 ? "" : "s"} planned</h2>
              <p className="muted small">
                {controlPanelMode
                  ? "Scheduled posts are listed here. Open the Mac app to preview and download local media."
                  : "A quiet view of what is scheduled, ready for upload, or already posted."}
              </p>
            </div>
            <button type="button" className="button tertiary" onClick={refreshScheduledPosts}>Refresh</button>
          </div>

          <div className="publishing-toolbar">
            <span className="publishing-search-chip">{postedCount} posted</span>
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

          {publishingMessage ? <p className={publishingMessage.includes("Could not") ? "error-banner" : "success-banner"}>{publishingMessage}</p> : null}

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
                const canPostNow = post.automationMode === "AUTOMATIC" && (post.status === "PLANNED" || post.status === "FAILED");

                return (
                  <article key={post.id} className="manual-publishing-card">
                    <div className={`platform-mark platform-${getPlatformClass(post.platform)}`} aria-hidden="true">
                      {getPlatformInitials(post.platform)}
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
                      {post.publishError ? <p className="error-banner">{post.publishError}</p> : null}
                      {post.publishedUrl ? (
                        <a className="text-link small" href={post.publishedUrl} target="_blank" rel="noreferrer">View published post</a>
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
                      {canPostNow ? (
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => postScheduledPostNow(post.id)}
                          disabled={isPending}
                        >
                          {isPending ? "Moving..." : "Post now"}
                        </button>
                      ) : null}
                      {post.automationMode === "MANUAL" && !controlPanelMode ? <a className="button secondary" href={downloadHref}>Download</a> : null}
                      <CopyCaptionButton
                        label={platformHandoff?.primaryCopyLabel ?? (post.platform === "YouTube Shorts" ? "Copy title" : "Copy caption")}
                        text={platformHandoff?.primaryCopyText ?? (captionText || `${post.platform} caption pending`)}
                      />
                      {post.platform === "YouTube Shorts" ? <CopyCaptionButton label="Copy caption" text={captionText || "Caption pending"} /> : null}
                      {post.automationMode === "MANUAL" ? <a className="button tertiary" href={platformHandoff?.uploadUrl ?? "#"} target="_blank" rel="noreferrer">
                        Open {post.platform === "YouTube Shorts" ? "Studio" : post.platform}
                      </a> : null}
                      <button
                        type="button"
                        className={canPostNow ? "button tertiary" : "button primary"}
                        onClick={() => updateScheduledPostStatus(post.id, "POSTED")}
                        disabled={isPending || post.status === "POSTED"}
                      >
                        {isPending ? "Updating..." : "Mark posted"}
                      </button>
                      {post.status !== "POSTED" ? (
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => updateScheduledPostStatus(post.id, "SKIPPED")}
                          disabled={isPending || post.status === "SKIPPED"}
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
        </div>
      </section>

    </>
  );
}
