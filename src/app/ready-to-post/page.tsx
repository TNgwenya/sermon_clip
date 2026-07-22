import Link from "next/link";
import { Suspense } from "react";
import type { Prisma } from "@prisma/client";

import { databaseReadBatch, prisma } from "@/lib/prisma";
import { listPostingDrafts } from "@/lib/postingDrafts";
import { listPostingPackageHistory } from "@/lib/postingPackages";
import { buildReadyQueueStatus, formatRecommendedNextAction, sanitizePastorFacingQualityText } from "@/lib/readyToPost";
import { listScheduledPosts } from "@/lib/scheduledPosts";
import { listSocialAccounts } from "@/lib/socialAccounts";
import { PrepareApprovedClipsButton } from "@/app/ready-to-post/prepare-approved-clips-button";
import { ReadyQueueExperience } from "@/app/ready-to-post/ready-queue-experience";
import { ReadyQueueLiveRefresh } from "@/app/ready-to-post/ready-queue-live-refresh";
import { GeneratedContentAssets } from "@/app/ready-to-post/generated-content-assets";
import { ClipAssetRecoveryButton } from "@/components/clip-asset-recovery-button";
import { buildClipAssetRecoveryPlan } from "@/lib/clipAssetRecovery";
import { isFreshRemotePreview } from "@/lib/clipPreview";
import { resolveReadyMedia } from "@/lib/readyMedia";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { parseClipCoverFrameSelection } from "@/lib/clipCoverFrame";
import { extractCaptionPackage } from "@/lib/clipStudio";
import { normalizeContentHashtags } from "@/lib/contentPublishing";
import { isEditoriallyPostReady } from "@/app/ready-to-post/readiness-display";
import { supportsManualContentHandoffWithoutMedia } from "@/lib/contentPublishingPreflight";
import { hasApprovedAssetPublishingRevision } from "@/lib/contentWorkflowUi";

export const dynamic = "force-dynamic";

type SearchParams = {
  sermonId?: string;
  clipId?: string;
  contentAssetId?: string;
  scheduledPostId?: string;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function hasClipOverlap(clipIds: string[], scopeClipIds: Set<string>): boolean {
  return clipIds.some((clipId) => scopeClipIds.has(clipId));
}

function buildReadyDownloadHref(clipIds: string[]): string {
  if (clipIds.length === 0) {
    return "#";
  }

  return `/api/ready-to-post/download?clipIds=${encodeURIComponent(clipIds.join(","))}`;
}

function formatPreparationFailureMessage(message: string | null): string {
  if (!message) {
    return "Retry preparation to regenerate this clip.";
  }

  if (
    message.includes("FFmpeg failed")
    || message.includes("Failed to configure input pad")
    || message.includes("Invalid argument")
  ) {
    return "Smart crop processing failed. Retry preparation to use the safer full-stage framing fallback.";
  }

  return message.length > 180 ? `${message.slice(0, 177).trimEnd()}...` : message;
}

async function mapWithConcurrency<T, Result>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<Result>,
): Promise<Result[]> {
  if (items.length === 0) return [];
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.trunc(concurrency)));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }));

  return results;
}

function ReadyToPostLoading() {
  return (
    <main className="ready-page-shell premium-ready-page stack-lg" aria-busy="true" aria-live="polite">
      <header className="ready-publishing-header premium-ready-header">
        <div className="ready-title-block">
          <p className="kicker">Publishing desk</p>
          <h1>From finished clip to published post.</h1>
          <p className="muted">Your publishing desk is open. Prepared media, generated posts, and the calendar are arriving next.</p>
        </div>
      </header>
      <section className="panel stack-md" role="status">
        <span className="route-loading-line" aria-hidden="true" />
        <span className="route-loading-line short" aria-hidden="true" />
        <div className="route-loading-grid" aria-hidden="true">
          <span className="route-loading-panel" />
          <span className="route-loading-panel" />
        </div>
        <span className="sr-only">Loading publishing content.</span>
      </section>
    </main>
  );
}

async function ReadyToPostContent({ params }: { params: SearchParams }) {
  const controlPanelMode = process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true";
  const sermonId = params.sermonId?.trim() || null;
  const clipId = params.clipId?.trim() || null;
  const contentAssetId = params.contentAssetId?.trim() || null;
  const scheduledPostId = params.scheduledPostId?.trim() || null;
  const focusedScheduledPosts = scheduledPostId
    ? await listScheduledPosts({ scheduledPostId, contentAssetId, includeContentAssetFiles: false })
    : null;
  const focusedScheduledPost = focusedScheduledPosts?.[0] ?? null;
  const scheduledPostClipIds = focusedScheduledPost?.clipIds ?? [];
  const scheduledPostContentAssetIds = focusedScheduledPost?.contentAssets?.map((asset) => asset.id) ?? [];
  const contentAssetOnlyFocus = Boolean(contentAssetId && !sermonId && !clipId);
  const scheduledPostOnlyFocus = Boolean(scheduledPostId && !sermonId && !clipId && !contentAssetId);
  const focusedPublishingItem = contentAssetOnlyFocus || scheduledPostOnlyFocus;
  const scopeWhere: Prisma.ClipCandidateWhereInput = {
    ...(sermonId ? { sermonId } : {}),
    ...(clipId
      ? { id: clipId }
      : contentAssetOnlyFocus
        ? { id: "__content_asset_focus_has_no_clip__" }
        : scheduledPostOnlyFocus
          ? {
              id: {
                in: scheduledPostClipIds.length > 0
                  ? scheduledPostClipIds
                  : ["__scheduled_post_has_no_clip__"],
              },
            }
        : {}),
  };
  const clipWhere: Prisma.ClipCandidateWhereInput = {
    ...scopeWhere,
    transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
    OR: [
      { exportStatus: "COMPLETED" },
      { status: "EXPORTED" },
    ],
  };
  const preparingWhere: Prisma.ClipCandidateWhereInput = {
    ...scopeWhere,
    transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
    OR: [
      { renderStatus: { in: ["QUEUED", "RENDERING"] } },
      { captionStatus: "GENERATING" },
      { captionBurnStatus: "BURNING" },
      { overlayStatus: "RENDERING" },
      { exportStatus: { in: ["QUEUED", "EXPORTING"] } },
    ],
  };
  const approvedWaitingWhere: Prisma.ClipCandidateWhereInput = {
    ...scopeWhere,
    status: "APPROVED",
    transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
    exportStatus: { not: "COMPLETED" },
    NOT: {
      OR: [
        { renderStatus: { in: ["QUEUED", "RENDERING"] } },
        { captionStatus: "GENERATING" },
        { captionBurnStatus: "BURNING" },
        { overlayStatus: "RENDERING" },
        { exportStatus: { in: ["QUEUED", "EXPORTING"] } },
      ],
    },
  };
  const failedPreparationWhere: Prisma.ClipCandidateWhereInput = {
    ...approvedWaitingWhere,
    OR: [
      { renderStatus: "FAILED" },
      { captionStatus: "FAILED" },
      { captionBurnStatus: "FAILED" },
      { overlayStatus: "FAILED" },
      { exportStatus: "FAILED" },
    ],
  };
  const [
    [
      clipRecords,
      metaPublishingAccountRecords,
      preparingClipCount,
      approvedWaitingClipCount,
      failedPreparationClipCount,
      approvedWaitingClips,
      contentAssetRecords,
    ],
    drafts,
    packageHistory,
    socialAccounts,
    scheduledPosts,
    publishingServiceHealth,
    focusedSermon,
    focusedClip,
  ] = await Promise.all([
    // The read batch uses pooled concurrency when available and one transaction
    // for the direct fallback. Non-database work still runs concurrently.
    databaseReadBatch([
      prisma.clipCandidate.findMany({
      where: clipWhere,
      orderBy: { exportedAt: "desc" },
      select: {
        id: true,
        title: true,
        hook: true,
        caption: true,
        captionData: true,
        hashtags: true,
        score: true,
        finalQualityScore: true,
        qualityLabel: true,
        postReadyStatus: true,
        transcriptSafetyStatus: true,
        postReadyReasons: true,
        postReadyBlockers: true,
        recommendedNextAction: true,
        qualityWarnings: true,
        qualityReasons: true,
        pastorFriendlyReason: true,
        qualitySummary: true,
        visualConfidenceScore: true,
        audioQualityScore: true,
        captionQualityScore: true,
        manualCropRecommended: true,
        smartClipCategory: true,
        intendedAudience: true,
        exportFormat: true,
        exportStatus: true,
        exportFreshness: true,
        exportedFilePath: true,
        exportPath: true,
        overlayVideoPath: true,
        captionedVideoPath: true,
        renderedFilePath: true,
        renderedAt: true,
        remotePreviewUrl: true,
        remotePreviewUploadedAt: true,
        renderFreshness: true,
        sermon: {
          select: {
            id: true,
            title: true,
            churchName: true,
          },
        },
      },
      take: 50,
      }),
      prisma.socialAccount.findMany({
      where: {
        status: "CONNECTED",
        OR: [
          {
            platform: "FACEBOOK",
            credentials: { some: { provider: "META_FACEBOOK", status: "CONNECTED" } },
          },
          {
            platform: "INSTAGRAM",
            credentials: { some: { provider: "META_INSTAGRAM", status: "CONNECTED" } },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platform: true,
        label: true,
        handle: true,
        credentials: {
          where: {
            status: "CONNECTED",
            provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] },
          },
          select: {
            provider: true,
            scopesJson: true,
          },
        },
      },
      }),
      prisma.clipCandidate.count({
        where: preparingWhere,
      }),
      prisma.clipCandidate.count({
        where: approvedWaitingWhere,
      }),
      prisma.clipCandidate.count({
        where: failedPreparationWhere,
      }),
      prisma.clipCandidate.findMany({
      where: approvedWaitingWhere,
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: {
        id: true,
        title: true,
        caption: true,
        score: true,
        smartClipCategory: true,
        renderStatus: true,
        renderError: true,
        renderFreshness: true,
        captionStatus: true,
        captionFreshness: true,
        captionBurnStatus: true,
        captionBurnFreshness: true,
        overlayStatus: true,
        overlayFreshness: true,
        exportStatus: true,
        exportFreshness: true,
        exportError: true,
        sermon: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      }),
      prisma.contentAsset.findMany({
      where: contentAssetId
        ? { id: contentAssetId }
        : scheduledPostOnlyFocus
          ? {
              id: {
                in: scheduledPostContentAssetIds.length > 0
                  ? scheduledPostContentAssetIds
                  : ["__scheduled_post_has_no_content_asset__"],
              },
            }
        : {
            status: { in: ["PREPARED", "READY", "SCHEDULED", "PUBLISHED"] },
            ...(sermonId ? { sermonId } : {}),
          },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        sermonId: true,
        contentOpportunityId: true,
        assetType: true,
        status: true,
        platform: true,
        title: true,
        bodyContent: true,
        caption: true,
        hashtagsJson: true,
        callToAction: true,
        currentRevisionId: true,
        approvedRevisionId: true,
        currentRevision: {
          select: {
            revisionNumber: true,
            approvalState: true,
            approvedAt: true,
          },
        },
        sermon: { select: { title: true } },
        contentOpportunity: {
          select: {
            id: true,
            status: true,
          },
        },
        files: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            publicUrl: true,
            width: true,
            height: true,
          },
        },
        scheduledPostLinks: {
          orderBy: { createdAt: "desc" },
          select: {
            scheduledPost: {
              select: {
                id: true,
                platform: true,
                status: true,
                scheduledFor: true,
              },
            },
          },
        },
      },
      }),
    ]),
    focusedPublishingItem ? Promise.resolve([]) : listPostingDrafts(),
    focusedPublishingItem ? Promise.resolve([]) : listPostingPackageHistory(),
    focusedPublishingItem ? Promise.resolve([]) : listSocialAccounts(),
    focusedScheduledPosts
      ? Promise.resolve(focusedScheduledPosts)
      : listScheduledPosts({ contentAssetId, includeContentAssetFiles: false }),
    getPublishingServiceHealth(),
    sermonId
      ? prisma.sermon.findUnique({
          where: { id: sermonId },
          select: { title: true },
        })
      : Promise.resolve(null),
    clipId
      ? prisma.clipCandidate.findFirst({
          where: {
            id: clipId,
            ...(sermonId ? { sermonId } : {}),
          },
          select: {
            id: true,
            title: true,
            sermon: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);
  const clips = await mapWithConcurrency(
    clipRecords,
    8,
    async (clip) => {
      const media = await resolveReadyMedia(clip, { trustMetadata: controlPanelMode });
      const coverFrameSelection = parseClipCoverFrameSelection(clip.captionData);
      const postCopy = extractCaptionPackage(
        clip.captionData,
        clip.caption,
        normalizeStringArray(clip.hashtags),
      );
      return {
        id: clip.id,
        title: clip.title,
        hook: clip.hook,
        caption: postCopy.primaryCaption ?? clip.caption,
        shortCaption: postCopy.shortCaption,
        platformCaption: postCopy.platformCaption,
        coverFrameSelected: Boolean(coverFrameSelection),
        coverFrameTimeSeconds: coverFrameSelection?.timeSeconds ?? null,
        hashtags: postCopy.hashtags,
        score: clip.score,
        finalQualityScore: clip.finalQualityScore,
        qualityLabel: clip.qualityLabel,
        postReadyStatus: clip.postReadyStatus,
        postReadyReasons: normalizeStringArray(clip.postReadyReasons),
        postReadyBlockers: [
          ...normalizeStringArray(clip.postReadyBlockers),
          ...(media.mediaReady ? [] : ["Prepared download file is missing. Rebuild the posting media before publishing."]),
        ],
        recommendedNextAction: formatRecommendedNextAction(clip.recommendedNextAction),
        qualityWarnings: normalizeStringArray(clip.qualityWarnings),
        qualityReasons: normalizeStringArray(clip.qualityReasons),
        pastorFriendlyReason: sanitizePastorFacingQualityText(clip.pastorFriendlyReason),
        qualitySummary: sanitizePastorFacingQualityText(clip.qualitySummary),
        visualConfidenceScore: clip.visualConfidenceScore,
        audioQualityScore: clip.audioQualityScore,
        captionQualityScore: clip.captionQualityScore,
        manualCropRecommended: clip.manualCropRecommended,
        smartClipCategory: clip.smartClipCategory,
        intendedAudience: clip.intendedAudience,
        mediaReady: media.mediaReady,
        estimatedBytes: media.estimatedBytes,
        remotePreviewUrl: isFreshRemotePreview(clip) ? clip.remotePreviewUrl?.trim() ?? null : null,
        sermon: clip.sermon,
      };
    },
  );
  const scopedClipIds = clips.map((clip) => clip.id);
  const scopeClipIds = clipId
    ? [clipId]
    : scheduledPostOnlyFocus
      ? scheduledPostClipIds
      : scopedClipIds;
  const scopedClipIdSet = new Set(scopeClipIds);
  const scopedContentAssetIdSet = new Set(contentAssetRecords.map((asset) => asset.id));
  const scopeIsActive = Boolean(sermonId || clipId || contentAssetId || scheduledPostId);
  const visibleDrafts = scopeIsActive
    ? drafts.filter((draft) => hasClipOverlap(draft.clipIds, scopedClipIdSet))
    : drafts;
  const visiblePackageHistory = scopeIsActive
    ? packageHistory.filter((item) => hasClipOverlap(item.clipIds, scopedClipIdSet))
    : packageHistory;
  const visibleScheduledPosts = scheduledPostId || contentAssetId
    ? scheduledPosts
    : scopeIsActive
      ? scheduledPosts.filter((post) => (
          hasClipOverlap(post.clipIds, scopedClipIdSet)
          || post.contentAssets?.some((asset) => scopedContentAssetIdSet.has(asset.id))
        ))
      : scheduledPosts;
  const contentAssets = contentAssetRecords.map((asset) => ({
    id: asset.id,
    sermonId: asset.sermonId,
    sermonTitle: asset.sermon.title,
    contentOpportunityId: asset.contentOpportunityId,
    assetType: asset.assetType,
    status: asset.status,
    platform: asset.platform,
    title: asset.title,
    bodyContent: asset.bodyContent,
    caption: asset.caption,
    hashtags: normalizeContentHashtags(Array.isArray(asset.hashtagsJson) ? asset.hashtagsJson.filter((item): item is string => typeof item === "string") : []),
    callToAction: asset.callToAction,
    currentRevisionId: asset.currentRevisionId,
    approvedRevisionId: asset.approvedRevisionId,
    currentRevision: asset.currentRevision ? {
      revisionNumber: asset.currentRevision.revisionNumber,
      approvalState: asset.currentRevision.approvalState,
      approvedAt: asset.currentRevision.approvedAt?.toISOString() ?? null,
    } : null,
    sourceOpportunityStatus: asset.contentOpportunity?.status ?? null,
    files: asset.files,
    scheduledPosts: asset.scheduledPostLinks.map((link) => ({
      id: link.scheduledPost.id,
      platform: link.scheduledPost.platform,
      status: link.scheduledPost.status,
      scheduledFor: link.scheduledPost.scheduledFor?.toISOString() ?? null,
    })),
  }));
  const metaPublishingAccounts = metaPublishingAccountRecords.flatMap((account) => {
    if (account.platform !== "FACEBOOK" && account.platform !== "INSTAGRAM") return [];
    const provider = account.platform === "FACEBOOK" ? "META_FACEBOOK" : "META_INSTAGRAM";
    const requiredScope = account.platform === "FACEBOOK" ? "pages_manage_posts" : "instagram_content_publish";
    const credential = account.credentials.find((item) => item.provider === provider);
    const scopes = Array.isArray(credential?.scopesJson)
      ? credential.scopesJson.filter((scope): scope is string => typeof scope === "string")
      : [];
    if (
      !credential
      || !scopes.includes(requiredScope)
    ) {
      return [];
    }
    return [{
      id: account.id,
      platform: account.platform,
      label: account.label,
      handle: account.handle,
    }];
  });
  const focusedContentAsset = contentAssetId
    ? contentAssets.find((asset) => asset.id === contentAssetId) ?? null
    : null;
  const focusedScheduledContentAsset = scheduledPostId
    ? contentAssets[0] ?? null
    : null;
  const focusedPublishingAsset = focusedContentAsset ?? focusedScheduledContentAsset;
  const focusedContentAssetNeedsReview = Boolean(
    focusedPublishingAsset
    && !hasApprovedAssetPublishingRevision({
      currentRevisionId: focusedPublishingAsset.currentRevisionId,
      approvedRevisionId: focusedPublishingAsset.approvedRevisionId,
      currentRevisionApprovalState: focusedPublishingAsset.currentRevision?.approvalState,
    }),
  );
  const scopedSermonTitle = sermonId || focusedClip
    ? focusedSermon?.title ?? focusedClip?.sermon.title ?? clips[0]?.sermon.title ?? "this sermon"
    : null;
  const scopedClipTitle = clipId
    ? focusedClip?.title ?? clips[0]?.title ?? approvedWaitingClips[0]?.title ?? "this clip"
    : null;
  const reviewSermonId = sermonId ?? focusedClip?.sermon.id ?? clips[0]?.sermon.id ?? approvedWaitingClips[0]?.sermon.id ?? null;
  const reviewHref = reviewSermonId ? `/sermons/${reviewSermonId}/review` : "/sermons";
  const downloadableClipCount = clips.filter((clip) => clip.mediaReady).length;
  const editoriallyPostReadyClipCount = clips.filter(isEditoriallyPostReady).length;
  const preparedGeneratedPostCount = contentAssets.filter((asset) => !["PUBLISHED", "ARCHIVED"].includes(asset.status)).length;
  const readyGeneratedPostCount = contentAssets.filter((asset) => (
    ["READY", "SCHEDULED"].includes(asset.status)
    && hasApprovedAssetPublishingRevision({
      currentRevisionId: asset.currentRevisionId,
      approvedRevisionId: asset.approvedRevisionId,
      currentRevisionApprovalState: asset.currentRevision?.approvalState,
    })
    && (supportsManualContentHandoffWithoutMedia(asset.assetType) || asset.files.length > 0)
  )).length;
  const preparedItemCount = downloadableClipCount + preparedGeneratedPostCount;
  const readyToPostItemCount = editoriallyPostReadyClipCount + readyGeneratedPostCount;
  const scheduledItemCount = visibleScheduledPosts.filter((post) => (
    post.status === "PLANNED"
    || post.status === "READY_FOR_MEDIA_TEAM"
    || post.status === "POSTING"
  )).length;
  const blockedReadyClips = clips.filter((clip) => !clip.mediaReady);
  const blockedReadyClipCount = blockedReadyClips.length;
  const firstBlockedClip = blockedReadyClips[0] ?? null;
  const queueStatus = buildReadyQueueStatus({
    readyCount: downloadableClipCount,
    preparingCount: preparingClipCount,
    approvedWaitingCount: approvedWaitingClipCount,
  });
  const downloadAllHref = buildReadyDownloadHref(clips.filter((clip) => clip.mediaReady).map((clip) => clip.id));

  return (
    <main className="ready-page-shell premium-ready-page stack-lg">
      <header className="ready-publishing-header premium-ready-header">
        <div className="ready-title-block">
          <p className="kicker">Publishing desk</p>
          <h1>{focusedPublishingAsset ? "Review, refine, and plan this post." : "From finished clip to published post."}</h1>
          <p className="muted">
            {focusedPublishingAsset
              ? focusedContentAssetNeedsReview
                ? `Review ${focusedPublishingAsset.title} from ${focusedPublishingAsset.sermonTitle} and approve its current publishing version before downloading or scheduling it.`
                : `Prepare ${focusedPublishingAsset.title} from ${focusedPublishingAsset.sermonTitle}, then download it or place it on the calendar.`
              : scopedClipTitle
              ? `Prepare ${scopedClipTitle}${scopedSermonTitle ? ` from ${scopedSermonTitle}` : ""}, then download it or place it on the calendar.`
            : scopedSermonTitle
              ? `Choose a finished clip from ${scopedSermonTitle}, prepare its platform copy, then download or schedule it.`
              : "Choose a finished sermon clip, prepare the platform copy, then download or schedule it."}
          </p>
          {focusedPublishingAsset || scopedClipTitle || scopedSermonTitle ? (
            <div className="ready-scope-pill">
              <span>{focusedPublishingAsset ? "Showing generated post" : scopedClipTitle ? "Showing clip" : "Showing sermon"}</span>
              <strong>{focusedPublishingAsset?.title ?? scopedClipTitle ?? scopedSermonTitle}</strong>
            </div>
          ) : null}
          <div className="premium-ready-summary" aria-label="Publishing summary">
            <div><strong>{preparedItemCount}</strong><span>Prepared items</span></div>
            <div><strong>{readyToPostItemCount}</strong><span>Ready to post</span></div>
            <div><strong>{scheduledItemCount}</strong><span>Scheduled</span></div>
            <details>
              <summary>Queue details</summary>
              <dl>
                <div><dt>Generated posts</dt><dd>{contentAssets.length}</dd></div>
                <div><dt>Preparing now</dt><dd>{preparingClipCount}</dd></div>
                <div><dt>Media needs repair</dt><dd>{blockedReadyClipCount}</dd></div>
                <div><dt>Preparation issues</dt><dd>{failedPreparationClipCount}</dd></div>
              </dl>
            </details>
          </div>
        </div>
        <nav className="ready-publishing-nav" aria-label="Ready to post actions">
          {scopeIsActive ? <Link href="/ready-to-post" className="button tertiary">All prepared content</Link> : null}
          {!controlPanelMode && downloadableClipCount > 0 ? (
            <a href={downloadAllHref} className="button secondary">
              {blockedReadyClipCount > 0 ? "Download ready clips" : "Download all"}
            </a>
          ) : null}
          {blockedReadyClipCount > 0 && firstBlockedClip ? (
            <Link href={`/ready-to-post?clipId=${firstBlockedClip.id}`} className={downloadableClipCount > 0 ? "button secondary" : "button primary"}>
              Review blocked clips
            </Link>
          ) : null}
        </nav>

        {!focusedPublishingAsset ? (
          <ol className="premium-ready-steps" aria-label="Ready-to-post workflow">
            <li className={clipId ? "is-complete" : "is-current"}>
              <span>1</span>
              <div><strong>Choose</strong><small>Select the message you want to share.</small></div>
            </li>
            <li className={clipId ? "is-current" : ""}>
              <span>2</span>
              <div><strong>Prepare</strong><small>Check the final video and platform copy.</small></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>Download or schedule</strong><small>Hand it off or place it on the calendar.</small></div>
            </li>
          </ol>
        ) : null}

        <nav className="premium-ready-view-nav" aria-label="Publishing desk sections">
          {!focusedPublishingAsset ? <a href="#ready-clips">Clips</a> : null}
          <a href="#generated-content-assets">Generated posts</a>
          <a href="#posting-calendar">Calendar</a>
          {!focusedPublishingAsset ? <a href="#publishing-support">History</a> : null}
        </nav>
      </header>

      <div className="ready-publishing-workspace">
        {approvedWaitingClipCount > 0 ? (
          <section className="ready-prep-command premium-ready-prep" aria-label="Approved clips waiting for preparation">
            <div className="ready-prep-copy">
              <p className="kicker">{failedPreparationClipCount > 0 ? "Needs recovery" : "2 · Prepare"}</p>
              <h2>
                {failedPreparationClipCount > 0
                  ? `${failedPreparationClipCount} clip${failedPreparationClipCount === 1 ? "" : "s"} ${failedPreparationClipCount === 1 ? "needs" : "need"} attention`
                  : `${approvedWaitingClipCount} approved clip${approvedWaitingClipCount === 1 ? "" : "s"} ${approvedWaitingClipCount === 1 ? "is" : "are"} almost ready`}
              </h2>
              <p className="muted">
                {failedPreparationClipCount > 0
                  ? "Refresh the missing media pieces so these clips can return to the posting queue."
                  : clipId
                  ? "Prepare this clip so the final video, captions, and church branding are packaged for posting."
                  : "Prepare these clips so the final videos, captions, and church branding are packaged for posting."}
              </p>
              <div className="ready-prep-steps" aria-label="Preparation steps">
                <span>Video</span>
                <span>Captions</span>
                <span>Branding</span>
                <span>Download</span>
              </div>
            </div>
            <div className="ready-prep-actions">
              {reviewSermonId ? (
                <PrepareApprovedClipsButton
                  sermonId={reviewSermonId}
                  approvedCount={approvedWaitingClipCount}
                  clipIds={clipId ? [clipId] : undefined}
                  actionLabel={failedPreparationClipCount > 0 ? "Refresh media" : undefined}
                />
              ) : (
                <Link href="/sermons" className="button primary">Choose a sermon</Link>
              )}
              <Link href={reviewHref} className="button secondary">Open pastor review</Link>
            </div>
            <div className="ready-prep-card-grid">
              {approvedWaitingClips.map((clip) => {
                const recoveryPlan = buildClipAssetRecoveryPlan(clip);
                const failureMessage = formatPreparationFailureMessage(clip.renderError ?? clip.exportError ?? null);

                return (
                  <article key={clip.id} className="ready-prep-card">
                    <div>
                      <h3>{clip.title}</h3>
                      <p className="muted small">
                        {clip.sermon.title}
                        {clip.smartClipCategory ? ` · ${clip.smartClipCategory}` : ""}
                      </p>
                    </div>
                    {recoveryPlan.hasRecoverableIssue ? (
                      <div className="error-banner">
                        <strong>{recoveryPlan.summary}</strong>
                        {recoveryPlan.failedLabels.length > 0 ? <span>{failureMessage}</span> : null}
                        <ClipAssetRecoveryButton
                          clipId={clip.id}
                          label="Refresh media"
                          busyLabel="Refreshing media..."
                          variant="secondary"
                        />
                      </div>
                    ) : (
                      <p className="muted small">{clip.caption || "Caption will be packaged during preparation."}</p>
                    )}
                    <div className="premium-ready-prep-state">
                      <span className="status-pill status-approved">Approved</span>
                      {recoveryPlan.hasRecoverableIssue ? <span className="status-pill quality-reject">Needs attention</span> : null}
                    </div>
                    <details className="premium-ready-prep-details">
                      <summary>Preparation details</summary>
                      <div className="clip-badge-row">
                        <span className={`status-pill ${clip.renderStatus === "FAILED" ? "quality-reject" : ""}`}>
                          Video {clip.renderStatus === "FAILED" ? "needs attention" : "readying"}
                        </span>
                        <span className={`status-pill ${clip.exportStatus === "FAILED" ? "quality-reject" : ""}`}>
                          Download {clip.exportStatus === "FAILED" ? "needs attention" : "pending"}
                        </span>
                        <span className={`status-pill ${clip.captionStatus === "FAILED" ? "quality-reject" : ""}`}>
                          Captions {clip.captionStatus === "FAILED" ? "need attention" : "readying"}
                        </span>
                      </div>
                    </details>
                    <Link href={`/sermons/${clip.sermon.id}/clips/${clip.id}/studio`} className="button tertiary">
                      Open in Studio
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
        <GeneratedContentAssets
          assets={contentAssets}
          focusedAssetId={focusedPublishingAsset?.id ?? null}
          metaPublishingAccounts={metaPublishingAccounts}
          publishingServiceHealth={publishingServiceHealth}
        />
        <ReadyQueueLiveRefresh status={queueStatus} />
        <ReadyQueueExperience
          clips={clips}
          clipScopeIds={scheduledPostId
            ? null
            : scopeIsActive && !focusedContentAsset
              ? scopeClipIds
              : null}
          contentAssetScopeIds={scheduledPostId
            ? null
            : sermonId || contentAssetId
              ? contentAssets.map((asset) => asset.id)
              : null}
          approvedWaitingCount={approvedWaitingClipCount}
          initialDrafts={visibleDrafts}
          packageHistory={visiblePackageHistory}
          initialSocialAccounts={socialAccounts}
          initialScheduledPosts={visibleScheduledPosts}
          initialPublishingServiceHealth={publishingServiceHealth}
          controlPanelMode={controlPanelMode}
          contentAssetFocus={Boolean(focusedPublishingAsset)}
          initialFocusedScheduledPostId={scheduledPostId}
          scheduledPostScope={{ scheduledPostId, contentAssetId }}
        />
      </div>
    </main>
  );
}

export default async function ReadyToPostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  return (
    <Suspense fallback={<ReadyToPostLoading />}>
      <ReadyToPostContent params={params} />
    </Suspense>
  );
}
