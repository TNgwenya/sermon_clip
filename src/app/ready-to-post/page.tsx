import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { listPostingDrafts } from "@/lib/postingDrafts";
import { listPostingPackageHistory } from "@/lib/postingPackages";
import { buildReadyQueueStatus, formatRecommendedNextAction, sanitizePastorFacingQualityText } from "@/lib/readyToPost";
import { listScheduledPosts } from "@/lib/scheduledPosts";
import { listSocialAccounts } from "@/lib/socialAccounts";
import { PrepareApprovedClipsButton } from "@/app/ready-to-post/prepare-approved-clips-button";
import { ReadyQueueExperience } from "@/app/ready-to-post/ready-queue-experience";
import { ReadyQueueLiveRefresh } from "@/app/ready-to-post/ready-queue-live-refresh";
import { ClipAssetRecoveryButton } from "@/components/clip-asset-recovery-button";
import { buildClipAssetRecoveryPlan } from "@/lib/clipAssetRecovery";
import { isFreshRemotePreview } from "@/lib/clipPreview";
import { resolveReadyMedia } from "@/lib/readyMedia";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { parseClipCoverFrameSelection } from "@/lib/clipCoverFrame";
import { extractCaptionPackage } from "@/lib/clipStudio";

export const dynamic = "force-dynamic";

type SearchParams = {
  sermonId?: string;
  clipId?: string;
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

export default async function ReadyToPostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const controlPanelMode = process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true";
  const sermonId = params.sermonId?.trim() || null;
  const clipId = params.clipId?.trim() || null;
  const scopeWhere: Prisma.ClipCandidateWhereInput = {
    ...(sermonId ? { sermonId } : {}),
    ...(clipId ? { id: clipId } : {}),
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
    clipRecords,
    drafts,
    packageHistory,
    socialAccounts,
    scheduledPosts,
    publishingServiceHealth,
    preparingClipCount,
    approvedWaitingClipCount,
    failedPreparationClipCount,
    approvedWaitingClips,
    focusedSermon,
    focusedClip,
  ] = await Promise.all([
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
    listPostingDrafts(),
    listPostingPackageHistory(),
    listSocialAccounts(),
    listScheduledPosts(),
    getPublishingServiceHealth(),
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
  const clips = await Promise.all(
    clipRecords.map(async (clip) => {
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
        hashtags: clip.hashtags,
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
    }),
  );
  const scopedClipIds = clips.map((clip) => clip.id);
  const scopeClipIds = clipId ? [clipId] : scopedClipIds;
  const scopedClipIdSet = new Set(scopeClipIds);
  const scopeIsActive = Boolean(sermonId || clipId);
  const visibleDrafts = scopeIsActive
    ? drafts.filter((draft) => hasClipOverlap(draft.clipIds, scopedClipIdSet))
    : drafts;
  const visiblePackageHistory = scopeIsActive
    ? packageHistory.filter((item) => hasClipOverlap(item.clipIds, scopedClipIdSet))
    : packageHistory;
  const visibleScheduledPosts = scopeIsActive
    ? scheduledPosts.filter((post) => hasClipOverlap(post.clipIds, scopedClipIdSet))
    : scheduledPosts;
  const scopedSermonTitle = sermonId || focusedClip
    ? focusedSermon?.title ?? focusedClip?.sermon.title ?? clips[0]?.sermon.title ?? "this sermon"
    : null;
  const scopedClipTitle = clipId
    ? focusedClip?.title ?? clips[0]?.title ?? approvedWaitingClips[0]?.title ?? "this clip"
    : null;
  const reviewSermonId = sermonId ?? focusedClip?.sermon.id ?? clips[0]?.sermon.id ?? approvedWaitingClips[0]?.sermon.id ?? null;
  const reviewHref = reviewSermonId ? `/sermons/${reviewSermonId}/review` : "/sermons";
  const downloadableClipCount = clips.filter((clip) => clip.mediaReady).length;
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
          <p className="kicker">Ready to post</p>
          <h1>Prepare your next post</h1>
          <p className="muted">
            {scopedClipTitle
              ? `Review ${scopedClipTitle}${scopedSermonTitle ? ` from ${scopedSermonTitle}` : ""}, prepare the platform copy, then download or schedule it.`
            : scopedSermonTitle
              ? `Choose a finished clip from ${scopedSermonTitle}, check the final video and caption, then send it to the right channel.`
              : "Choose a finished sermon clip, prepare its post, then download or schedule it."}
          </p>
          {scopedClipTitle || scopedSermonTitle ? (
            <div className="ready-scope-pill">
              <span>{scopedClipTitle ? "Showing clip" : "Showing sermon"}</span>
              <strong>{scopedClipTitle ?? scopedSermonTitle}</strong>
            </div>
          ) : null}
          <div className="ready-quick-stats" aria-label="Prepared clip summary">
            <span className="ready-stat-ready"><strong>{downloadableClipCount}</strong> ready</span>
            {preparingClipCount > 0 ? (
              <span><strong>{preparingClipCount}</strong> preparing</span>
            ) : null}
            {blockedReadyClipCount > 0 ? (
              <span className="ready-stat-repair"><strong>{blockedReadyClipCount}</strong> needs repair</span>
            ) : null}
            <span><strong>{visibleScheduledPosts.length}</strong> planned</span>
            {failedPreparationClipCount > 0 ? (
              <span className="ready-stat-repair"><strong>{failedPreparationClipCount}</strong> prep issue{failedPreparationClipCount === 1 ? "" : "s"}</span>
            ) : null}
          </div>
        </div>
        <nav className="ready-publishing-nav" aria-label="Ready to post actions">
          {scopeIsActive ? <Link href="/ready-to-post" className="button tertiary">All ready clips</Link> : null}
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

        <ol className="premium-ready-steps" aria-label="Ready-to-post workflow">
          <li className={clipId ? "is-complete" : "is-current"}>
            <span>1</span>
            <div><strong>Choose a clip</strong><small>Start with the message you want to share.</small></div>
          </li>
          <li className={clipId ? "is-current" : ""}>
            <span>2</span>
            <div><strong>Prepare the post</strong><small>Check the final video and platform copy.</small></div>
          </li>
          <li>
            <span>3</span>
            <div><strong>Download or schedule</strong><small>Hand it off or place it on the calendar.</small></div>
          </li>
        </ol>

        <nav className="premium-ready-view-nav" aria-label="Publishing desk sections">
          <a href="#ready-clips">Ready clips</a>
          <a href="#posting-calendar">Calendar</a>
          <a href="#publishing-support">Publishing history</a>
        </nav>
      </header>

      <div className="ready-publishing-workspace">
        {approvedWaitingClipCount > 0 ? (
          <section className="ready-prep-command premium-ready-prep" aria-label="Approved clips waiting for preparation">
            <div className="ready-prep-copy">
              <p className="kicker">{failedPreparationClipCount > 0 ? "Needs recovery" : "Stage 2 · Prepare post"}</p>
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
        <ReadyQueueLiveRefresh status={queueStatus} />
        <ReadyQueueExperience
          clips={clips}
          clipScopeIds={scopeIsActive ? scopeClipIds : null}
          approvedWaitingCount={approvedWaitingClipCount}
          initialDrafts={visibleDrafts}
          packageHistory={visiblePackageHistory}
          initialSocialAccounts={socialAccounts}
          initialScheduledPosts={visibleScheduledPosts}
          initialPublishingServiceHealth={publishingServiceHealth}
          controlPanelMode={controlPanelMode}
        />
      </div>
    </main>
  );
}
