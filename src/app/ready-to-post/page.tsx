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
import { resolveReadyMedia } from "@/lib/readyMedia";

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
    OR: [
      { exportStatus: "COMPLETED" },
      { status: "EXPORTED" },
    ],
  };
  const preparingWhere: Prisma.ClipCandidateWhereInput = {
    ...scopeWhere,
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
        hashtags: true,
        score: true,
        finalQualityScore: true,
        qualityLabel: true,
        postReadyStatus: true,
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
      return {
        id: clip.id,
        title: clip.title,
        hook: clip.hook,
        caption: clip.caption,
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
  const queueStatus = buildReadyQueueStatus({
    readyCount: downloadableClipCount,
    preparingCount: preparingClipCount,
    approvedWaitingCount: approvedWaitingClipCount,
  });
  const readyBytes = clips.reduce((total, clip) => total + (clip.estimatedBytes ?? 0), 0);
  const downloadAllHref = buildReadyDownloadHref(clips.filter((clip) => clip.mediaReady).map((clip) => clip.id));

  return (
    <main className="ready-page-shell stack-lg">
      <header className="ready-publishing-header">
        <div className="ready-title-block">
          <p className="kicker">Ready to post</p>
          <h1>Publishing desk</h1>
          <p className="muted">
            {scopedClipTitle
              ? `Showing ${scopedClipTitle}${scopedSermonTitle ? ` from ${scopedSermonTitle}` : ""}. Prepare this clip if needed, then download the video and platform captions for posting.`
              : scopedSermonTitle
              ? `Showing clips from ${scopedSermonTitle}. Prepare approved clips, then download videos and platform captions for the media team.`
              : "Review finished clips, copy platform captions, and hand posts to the media team."}
          </p>
          {scopedClipTitle || scopedSermonTitle ? (
            <div className="ready-scope-pill">
              <span>{scopedClipTitle ? "Showing clip" : "Showing sermon"}</span>
              <strong>{scopedClipTitle ?? scopedSermonTitle}</strong>
            </div>
          ) : null}
          <div className="ready-quick-stats" aria-label="Ready to post summary">
            <span><strong>{downloadableClipCount}</strong> ready</span>
            <span><strong>{approvedWaitingClipCount}</strong> to prepare</span>
            <span><strong>{visibleScheduledPosts.length}</strong> planned</span>
            <span><strong>{visiblePackageHistory.length}</strong> packages</span>
            {readyBytes > 0 ? <span><strong>{`${Math.round(readyBytes / 1024 / 1024)} MB`}</strong> media</span> : null}
          </div>
        </div>
        <nav className="ready-publishing-nav" aria-label="Ready to post actions">
          <Link href="/" className="button tertiary">Dashboard</Link>
          <a href="/settings/branding" className="button secondary">Brand Kit</a>
          {scopeIsActive ? <Link href="/ready-to-post" className="button secondary">All ready clips</Link> : null}
          {!controlPanelMode && downloadableClipCount > 0 ? <a href={downloadAllHref} className="button primary">Download all</a> : null}
        </nav>
      </header>

      <div className="ready-publishing-workspace">
        {approvedWaitingClipCount > 0 ? (
          <section className="ready-prep-command" aria-label="Approved clips waiting for preparation">
            <div className="ready-prep-copy">
              <p className="kicker">{failedPreparationClipCount > 0 ? "Needs recovery" : "Needs preparation"}</p>
              <h2>
                {failedPreparationClipCount > 0
                  ? `${failedPreparationClipCount} failed item${failedPreparationClipCount === 1 ? "" : "s"} ${failedPreparationClipCount === 1 ? "needs" : "need"} repair`
                  : `${approvedWaitingClipCount} approved clip${approvedWaitingClipCount === 1 ? "" : "s"} ${approvedWaitingClipCount === 1 ? "needs" : "need"} downloads`}
              </h2>
              <p className="muted">
                {failedPreparationClipCount > 0
                  ? "Retry only the missing or failed preparation stages so the clip can get back to ready-to-post."
                  : clipId
                  ? "Prepare this clip to generate the final video file, captions, church branding, and ready-to-post package."
                  : "Prepare them to generate the final video files, captions, church branding, and ready-to-post package."}
              </p>
              <div className="ready-prep-steps" aria-label="Preparation steps">
                <span>Render video</span>
                <span>Write captions</span>
                <span>Add branding</span>
                <span>Create downloads</span>
              </div>
            </div>
            <div className="ready-prep-actions">
              {reviewSermonId ? (
                <PrepareApprovedClipsButton
                  sermonId={reviewSermonId}
                  approvedCount={approvedWaitingClipCount}
                  clipIds={clipId ? [clipId] : undefined}
                  actionLabel={failedPreparationClipCount > 0 ? "Fix failed items" : undefined}
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
                        {clip.sermon.title} · Score {clip.score.toFixed(1)}
                        {clip.smartClipCategory ? ` · ${clip.smartClipCategory}` : ""}
                      </p>
                    </div>
                    {recoveryPlan.hasRecoverableIssue ? (
                      <div className="error-banner">
                        <strong>{recoveryPlan.summary}</strong>
                        {recoveryPlan.failedLabels.length > 0 ? <span>{failureMessage}</span> : null}
                        <ClipAssetRecoveryButton
                          clipId={clip.id}
                          label={recoveryPlan.actionLabel}
                          busyLabel="Repairing this clip..."
                          variant="secondary"
                        />
                      </div>
                    ) : (
                      <p className="muted small">{clip.caption || "Caption will be packaged during preparation."}</p>
                    )}
                    <div className="clip-badge-row">
                      <span className="status-pill status-approved">Approved</span>
                      <span className={`status-pill ${clip.renderStatus === "FAILED" ? "quality-reject" : ""}`}>
                        Render {clip.renderStatus.toLowerCase().replace(/_/g, " ")}
                      </span>
                      <span className={`status-pill ${clip.exportStatus === "FAILED" ? "quality-reject" : ""}`}>
                        Export {clip.exportStatus.toLowerCase().replace(/_/g, " ")}
                      </span>
                      <span className={`status-pill ${clip.captionStatus === "FAILED" ? "quality-reject" : ""}`}>
                        Captions {clip.captionStatus.toLowerCase().replace(/_/g, " ")}
                      </span>
                    </div>
                    <Link href={`/sermons/${clip.sermon.id}/clips/${clip.id}/studio`} className="text-link">
                      Open Studio
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
          controlPanelMode={controlPanelMode}
        />
      </div>
    </main>
  );
}
