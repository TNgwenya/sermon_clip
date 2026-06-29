import { stat } from "node:fs/promises";

import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { StatCard, StatusBadge } from "@/components/ui";
import {
  extractCaptionPackage,
  extractCaptionGuidance,
  extractApplyCaptionsToClip,
  extractCaptionStyleOverride,
  extractHookOverlayConfig,
  extractOnVideoCaptionCues,
  extractLanguageHints,
  extractSpeechCleanupSettings,
  formatClipStatusLabel,
  clipStatusTone,
  renderStatusLabel,
  formatMinistryScore,
  formatSocialScore,
  formatTranscriptExcerpt,
  buildClipTimingDisplay,
  hasCaptionPackage,
} from "@/lib/clipStudio";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import { ClipStudioEditor } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-editor";
import { ClipStudioFormatFraming } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-format-framing";
import { ClipStudioBranding } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-branding";
import { ClipStudioLivePreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-live-preview";
import { ClipStudioPreviewProvider } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";
import { ClipStudioWorkbenchTabs } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-workbench-tabs";
import { resolveExportHistory, resolveExportSettings } from "@/lib/clipExportSettings";
import { resolveBrandingConfig } from "@/lib/clipBranding";
import { buildClipAssetRecoveryPlan } from "@/lib/clipAssetRecovery";
import { ClipAssetRecoveryButton } from "@/components/clip-asset-recovery-button";
import { getBrandingSettings } from "@/server/branding/settings";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

type ClipStudioPageParams = {
  params: Promise<{ id: string; clipId: string }>;
};

function extractFramingDecisionSummary(captionData: unknown): string | null {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return null;
  }

  const framingDecision = (captionData as Record<string, unknown>)["framingDecision"];
  if (!framingDecision || typeof framingDecision !== "object" || Array.isArray(framingDecision)) {
    return null;
  }

  const record = framingDecision as Record<string, unknown>;
  const frameQualitySummary = record["frameQualitySummary"];
  if (typeof frameQualitySummary === "string" && frameQualitySummary.trim()) {
    return frameQualitySummary.trim();
  }

  const summary = record["summary"];
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

export default async function ClipStudioPage({ params }: ClipStudioPageParams) {
  const { id: sermonId, clipId } = await params;
  const localMediaAvailable = canRunLocalMediaProcessing();

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sourceVideoPath: true,
    },
  });

  if (!sermon) {
    notFound();
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      title: true,
      hook: true,
      caption: true,
      suggestedHook: true,
      suggestedCaption: true,
      hashtags: true,
      captionData: true,
      transcriptText: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      score: true,
      smartClipCategory: true,
      recommendationReason: true,
      recommendationConfidence: true,
      intendedAudience: true,
      ministryValue: true,
      socialValue: true,
      visualQualityScore: true,
      visualReadinessScore: true,
      speakerVisiblePercentage: true,
      averageTrackingConfidence: true,
      cropStabilityScore: true,
      clipType: true,
      riskLevel: true,
      riskReasons: true,
      contextWarning: true,
      status: true,
      boundaryQuality: true,
      isManuallyEdited: true,
      exportFormat: true,
      exportLayoutStrategy: true,
      manualCropKeyframes: true,
      manualCropUpdatedAt: true,
      smartCropDebugSnapshotPath: true,
      smartCropDebugGeneratedAt: true,
      smartCropDebugError: true,
      renderStatus: true,
      renderedFilePath: true,
      remotePreviewUrl: true,
      renderError: true,
      renderFreshness: true,
      captionStatus: true,
      subtitleFilePath: true,
      captionGenerationError: true,
      captionFreshness: true,
      captionBurnStatus: true,
      captionedVideoPath: true,
      captionBurnError: true,
      captionBurnFreshness: true,
      overlayStatus: true,
      overlayVideoPath: true,
      overlayRenderError: true,
      overlayFreshness: true,
      exportStatus: true,
      exportedFilePath: true,
      exportError: true,
      exportFreshness: true,
      clipNotes: true,
      ministryMomentId: true,
      ministryMoment: {
        select: {
          momentType: true,
          title: true,
          description: true,
          whyDetected: true,
          suggestedAudience: true,
          suggestedUsage: true,
          transcriptExcerpt: true,
          confidenceScore: true,
        },
      },
      videoSubjectTracks: {
        orderBy: { confidenceScore: "desc" },
        select: {
          id: true,
          kind: true,
          source: true,
          label: true,
          confidenceScore: true,
          sampleCount: true,
          boxesJson: true,
        },
      },
    },
  });

  if (!clip) {
    notFound();
  }

  if (clip.sermonId !== sermonId) {
    notFound();
  }

  const transcriptSegments = await prisma.transcriptSegment.findMany({
    where: {
      sermonId,
      startTimeSeconds: { lte: clip.endTimeSeconds + 20 },
      endTimeSeconds: { gte: Math.max(0, clip.startTimeSeconds - 20) },
    },
    orderBy: { startTimeSeconds: "asc" },
    take: 240,
    select: {
      id: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      text: true,
    },
  });

  const sermonDurationSegment = await prisma.transcriptSegment.findFirst({
    where: { sermonId },
    orderBy: { endTimeSeconds: "desc" },
    select: { endTimeSeconds: true },
  });

  const hashtags = Array.isArray(clip.hashtags)
    ? (clip.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
    : [];

  const captionPackage = extractCaptionPackage(clip.captionData, clip.caption, hashtags);
  const captionGuidance = extractCaptionGuidance(clip.captionData);
  const onVideoCaptionCues = extractOnVideoCaptionCues(clip.captionData, clip.caption, clip.durationSeconds);
  const captionStyleOverride = extractCaptionStyleOverride(clip.captionData);
  const applyCaptionsToClip = extractApplyCaptionsToClip(clip.captionData);
  const hookOverlay = extractHookOverlayConfig(clip.captionData, clip.hook || clip.suggestedHook);
  const languageHints = extractLanguageHints(clip.captionData);
  const speechCleanupSettings = extractSpeechCleanupSettings(clip.captionData);
  const framingDecisionSummary = extractFramingDecisionSummary(clip.captionData);
  const exportSettings = resolveExportSettings({
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
  });
  const brandingConfig = resolveBrandingConfig(clip.captionData);
  const appBranding = await getBrandingSettings().catch(() => null);
  const logoAvailable = Boolean(appBranding?.churchLogoPath && appBranding.churchLogoPath.trim().length > 0);
  const exportHistory = resolveExportHistory(clip.captionData);
  const exportHistoryWithFileState = await Promise.all(
    exportHistory.map(async (record) => {
      const hasPath = Boolean(record.outputPath);
      if (!localMediaAvailable || !hasPath || !record.outputPath) {
        return { ...record, fileExists: false };
      }

      try {
        const fileStat = await stat(record.outputPath);
        return { ...record, fileExists: fileStat.isFile() && fileStat.size > 0 };
      } catch {
        return { ...record, fileExists: false };
      }
    }),
  );
  const currentExportFileExists = localMediaAvailable && clip.exportedFilePath
    ? await stat(clip.exportedFilePath)
        .then((fileStat) => fileStat.isFile() && fileStat.size > 0)
        .catch(() => false)
    : false;
  const sourceVideoExists = localMediaAvailable && sermon.sourceVideoPath
    ? await stat(sermon.sourceVideoPath)
        .then((fileStat) => fileStat.isFile() && fileStat.size > 0)
        .catch(() => false)
    : false;
  const transcriptExcerpt = formatTranscriptExcerpt(clip.transcriptText);
  const timing = buildClipTimingDisplay(clip.startTimeSeconds, clip.endTimeSeconds, clip.durationSeconds);
  const initialEditPreview = {
    startLabel: timing.startLabel,
    endLabel: timing.endLabel,
    durationLabel: timing.durationLabel,
    startSeconds: clip.startTimeSeconds,
    endSeconds: clip.endTimeSeconds,
    durationSeconds: clip.durationSeconds,
    mainCaption: onVideoCaptionCues.map((cue) => cue.text).join(" "),
    shortCaption: captionPackage.shortCaption ?? "",
    platformCaption: captionPackage.platformCaption ?? "",
    onVideoCaptionText: onVideoCaptionCues.map((cue) => cue.text).join(" "),
    captionCues: onVideoCaptionCues,
    applyCaptionsToClip,
    captionStylePresetId: captionStyleOverride || appBranding?.defaultCaptionStyleName || "bold-sermon",
    hookOverlay,
    hashtags: captionPackage.hashtags.join(" "),
    isTimingValid: true,
  };
  const ministryScore = formatMinistryScore(clip.ministryValue);
  const socialScore = formatSocialScore(clip.socialValue);
  const videoSubjectTracks = clip.videoSubjectTracks.map((track) => {
    let centerX = 0.5;
    let centerY = 0.5;

    if (Array.isArray(track.boxesJson) && track.boxesJson.length > 0) {
      const first = track.boxesJson[0] as Record<string, unknown>;
      const maybeCenterX = typeof first.centerX === "number" ? first.centerX : null;
      const maybeCenterY = typeof first.centerY === "number" ? first.centerY : null;
      const maybeX = typeof first.x === "number" ? first.x : null;
      const maybeY = typeof first.y === "number" ? first.y : null;
      const maybeWidth = typeof first.width === "number" ? first.width : null;
      const maybeHeight = typeof first.height === "number" ? first.height : null;

      if (maybeCenterX !== null) {
        centerX = maybeCenterX;
      } else if (maybeX !== null && maybeWidth !== null) {
        centerX = maybeX + maybeWidth / 2;
      }

      if (maybeCenterY !== null) {
        centerY = maybeCenterY;
      } else if (maybeY !== null && maybeHeight !== null) {
        centerY = maybeY + maybeHeight / 2;
      }
    }

    return {
      id: track.id,
      kind: track.kind,
      source: track.source,
      label: track.label,
      confidenceScore: track.confidenceScore,
      sampleCount: track.sampleCount,
      centerX,
      centerY,
    };
  });

  const bestPreviewVariant = clip.captionedVideoPath
    ? "captioned"
    : clip.overlayVideoPath
      ? "overlay"
      : clip.exportedFilePath
        ? "exported"
        : clip.renderedFilePath
          ? "rendered"
          : null;
  const bestPreviewPath =
    clip.captionedVideoPath ?? clip.overlayVideoPath ?? clip.exportedFilePath ?? clip.renderedFilePath ?? null;
  const hasRemotePreview = Boolean(clip.remotePreviewUrl);
  const hasPreview = (localMediaAvailable && Boolean(bestPreviewPath)) || hasRemotePreview;
  const previewSrc = hasRemotePreview
    ? `/api/clips/${clip.id}/preview?variant=best`
    : localMediaAvailable && bestPreviewVariant
      ? `/api/clips/${clip.id}/preview?variant=${bestPreviewVariant}`
      : null;

  const clipStatus = clip.status as "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  const renderStatus = clip.renderStatus as "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  const postClipHref = `/ready-to-post?sermonId=${encodeURIComponent(sermonId)}&clipId=${encodeURIComponent(clip.id)}`;
  const recoveryPlan = buildClipAssetRecoveryPlan(clip);

  return (
    <ClipStudioPreviewProvider
      initialExportSettings={exportSettings}
      initialBrandingConfig={brandingConfig}
      initialEditPreview={initialEditPreview}
      churchName={sermon.churchName}
      sermonTitle={sermon.title}
      preacherName={sermon.speakerName}
    >
      <main className="container clip-studio-shell stack-md">
      <header className="card clip-studio-topbar stack-sm">
        <div className="clip-studio-topbar-row">
          <div className="stack-sm">
            <p className="kicker">Clip Studio</p>
            <h1>{clip.title}</h1>
            <p className="muted clip-studio-topbar-subtitle">{sermon.title}</p>
            <div className="clip-studio-status-row">
              <StatusBadge tone={clipStatusTone(clipStatus)}>
                {formatClipStatusLabel(clipStatus, {
                  isManuallyEdited: clip.isManuallyEdited,
                  renderStatus,
                })}
              </StatusBadge>
              <StatusBadge
                tone={
                  clip.boundaryQuality === "GOOD"
                    ? "success"
                    : clip.boundaryQuality === "NEEDS_REVIEW"
                      ? "warning"
                      : "danger"
                }
              >
                {clip.boundaryQuality.replace("_", " ")}
              </StatusBadge>
              <StatusBadge tone={clip.score >= 7 ? "success" : clip.score >= 4 ? "accent" : "warning"}>
                Score {clip.score.toFixed(1)}
              </StatusBadge>
              {clip.contextWarning ? <StatusBadge tone="warning">Needs context</StatusBadge> : null}
            </div>
          </div>

          <div className="clip-studio-topbar-actions">
            <Link href={`/sermons/${sermonId}`} className="button secondary">
              Sermon
            </Link>
            <Link href={`/sermons/${sermonId}/review`} className="button secondary">
              Review
            </Link>
            <Link href={postClipHref} className="button primary">
              Post clip
            </Link>
          </div>
        </div>
      </header>

      <div className="clip-studio-layout">
        <aside className="clip-studio-preview-column stack-md">
          <ClipStudioLivePreview
            clipId={clip.id}
            currentStatus={clipStatus}
            hasPreview={hasPreview}
            previewSrc={previewSrc}
            sourcePreviewSrc={sourceVideoExists ? `/api/sermons/${sermon.id}/source-preview` : null}
            unavailableDescription={
              localMediaAvailable || hasRemotePreview
                ? undefined
                : "No remote preview is available yet. Keep the Mac media worker running to render and upload this clip preview."
            }
            renderLabel={renderStatusLabel(renderStatus)}
            renderTone={renderStatus === "COMPLETED" ? "success" : renderStatus === "FAILED" ? "danger" : "neutral"}
            durationLabel={timing.durationLabel}
            timingLabel={`${timing.startLabel} - ${timing.endLabel}`}
            riskLabel={`${clip.riskLevel} risk`}
            riskClassName={`risk-${clip.riskLevel.toLowerCase()}`}
          />

          {clip.renderError ? <p className="status-help">Render issue: {clip.renderError}</p> : null}
          {clip.captionGenerationError ? <p className="status-help">Caption issue: {clip.captionGenerationError}</p> : null}
          {clip.captionBurnError ? <p className="status-help">Caption burn issue: {clip.captionBurnError}</p> : null}
          {clip.overlayRenderError ? <p className="status-help">Branding issue: {clip.overlayRenderError}</p> : null}
          {clip.exportError ? <p className="status-help">Export issue: {clip.exportError}</p> : null}
          {recoveryPlan.hasRecoverableIssue ? (
            <section className="card stack-sm">
              <p className="kicker">Media recovery</p>
              <h3>{recoveryPlan.failedLabels.length > 0 ? "Some prepared media failed" : "Prepared media needs rebuild"}</h3>
              <p className="muted small">{recoveryPlan.summary}</p>
              <ClipAssetRecoveryButton
                clipId={clip.id}
                label={recoveryPlan.actionLabel}
                busyLabel="Recovering this clip..."
                variant="primary"
              />
            </section>
          ) : null}
        </aside>

        <div className="clip-studio-main-column stack-md">
          <section className="card clip-studio-score-card clip-studio-insight-card stack-sm">
            <div className="section-heading-row">
              <div>
                <p className="kicker">Clip intelligence</p>
                <h3>Why this clip works</h3>
              </div>
              <StatusBadge tone={clip.score >= 7 ? "success" : clip.score >= 4 ? "accent" : "warning"}>
                {clip.score.toFixed(1)}
              </StatusBadge>
            </div>
            <div className="stat-grid">
              <StatCard label="Category" value={clip.smartClipCategory ?? "Uncategorized"} tone="neutral" />
              <StatCard label={ministryScore.label} value={ministryScore.value} tone={ministryScore.tone} />
              <StatCard label={socialScore.label} value={socialScore.value} tone={socialScore.tone} />
              <StatCard
                label="Audience"
                value={clip.intendedAudience || "General"}
                tone="accent"
              />
            </div>
            {clip.recommendationReason ? <p className="muted">{clip.recommendationReason}</p> : null}
          </section>
          <ClipStudioWorkbenchTabs
            edit={
              <ClipStudioEditor
                clipId={clip.id}
                initialStartTimeSeconds={clip.startTimeSeconds}
                initialEndTimeSeconds={clip.endTimeSeconds}
                initialShortCaption={captionPackage.shortCaption ?? ""}
                initialPlatformCaption={captionPackage.platformCaption ?? ""}
                initialHashtags={captionPackage.hashtags}
                initialCaptionCues={onVideoCaptionCues}
                initialApplyCaptionsToClip={applyCaptionsToClip}
                initialCaptionStylePresetId={captionStyleOverride}
                brandCaptionStylePresetId={appBranding?.defaultCaptionStyleName ?? "bold-sermon"}
                initialHook={clip.hook}
                suggestedHook={clip.suggestedHook ?? ""}
                initialHookOverlay={hookOverlay}
                initialSpeechCleanup={speechCleanupSettings}
                transcriptSegments={transcriptSegments}
                knownDurationSeconds={sermonDurationSegment?.endTimeSeconds ?? null}
                captionQualityScore={captionGuidance.qualityScore}
                captionQualityReason={captionGuidance.qualityReason}
                captionWarnings={captionGuidance.warnings}
                translationUncertainty={captionGuidance.translationUncertainty}
                captionImprovementSuggestions={captionGuidance.improvementSuggestions}
              />
            }
            format={
              <ClipStudioFormatFraming
                clipId={clip.id}
                initialSettings={exportSettings}
                exportHistory={exportHistoryWithFileState}
                videoSubjectTracks={videoSubjectTracks}
                manualCropKeyframes={clip.manualCropKeyframes}
                manualCropUpdatedAt={clip.manualCropUpdatedAt?.toISOString() ?? null}
                smartCropDebugGeneratedAt={clip.smartCropDebugGeneratedAt?.toISOString() ?? null}
                smartCropDebugError={clip.smartCropDebugError}
                hasSmartCropDebugSnapshot={Boolean(clip.smartCropDebugSnapshotPath)}
                visualQualityScore={clip.visualQualityScore}
                visualReadinessScore={clip.visualReadinessScore}
                speakerVisiblePercentage={clip.speakerVisiblePercentage}
                averageTrackingConfidence={clip.averageTrackingConfidence}
                cropStabilityScore={clip.cropStabilityScore}
                framingDecisionSummary={framingDecisionSummary}
                currentExport={
                  clip.exportStatus === "COMPLETED" &&
                  clip.exportFormat === "VERTICAL_9_16" &&
                  clip.exportedFilePath
                    ? {
                        format: clip.exportFormat,
                        outputPath: clip.exportedFilePath,
                        fileExists: currentExportFileExists,
                      }
                    : null
                }
              />
            }
            branding={
              <ClipStudioBranding
                clipId={clip.id}
                initialConfig={brandingConfig}
                churchName={sermon.churchName}
                sermonTitle={sermon.title}
                preacherName={sermon.speakerName}
                logoAvailable={logoAvailable}
              />
            }
            evidence={
              <section className="clip-studio-details stack-md">
                {clip.ministryMoment ? (
                  <div className="stack-md">
                    <div className="stack-sm">
                      <p className="muted small">Ministry moment</p>
                      <p>
                        <strong>{clip.ministryMoment.title}</strong>{" "}
                        <StatusBadge tone="accent">{clip.ministryMoment.momentType.replace(/_/g, " ")}</StatusBadge>
                      </p>
                      {clip.ministryMoment.description ? <p>{clip.ministryMoment.description}</p> : null}
                    </div>
                    {clip.ministryMoment.whyDetected ? (
                      <div className="stack-sm">
                        <p className="muted small">Why this moment matters</p>
                        <p>{clip.ministryMoment.whyDetected}</p>
                      </div>
                    ) : null}
                    {clip.ministryMoment.suggestedUsage ? (
                      <div className="stack-sm">
                        <p className="muted small">Suggested pastoral use</p>
                        <p>{clip.ministryMoment.suggestedUsage}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {clip.suggestedHook ? (
                  <div className="stack-sm">
                    <p className="muted small">Suggested hook</p>
                    <p>{clip.suggestedHook}</p>
                  </div>
                ) : null}

                {!hasCaptionPackage(captionPackage) ? (
                  <p className="muted">No caption package exists yet. Add and save captions in the editor above.</p>
                ) : null}

                {languageHints ? (
                  <dl className="data-list stack-sm">
                    {languageHints.detectedLanguage ? (
                      <div className="data-list-row">
                        <dt className="muted small">Detected language</dt>
                        <dd>{languageHints.detectedLanguage}</dd>
                      </div>
                    ) : null}
                    {languageHints.uncertaintyNote ? (
                      <div className="data-list-row">
                        <dt className="muted small">Translation note</dt>
                        <dd className="muted">{languageHints.uncertaintyNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}

                {transcriptExcerpt ? (
                  <div className="transcript-excerpt">
                    <p className="muted small">
                      {formatSecondsForPastorView(clip.startTimeSeconds)} to {formatSecondsForPastorView(clip.endTimeSeconds)}
                    </p>
                    <blockquote className="transcript-quote">{transcriptExcerpt}</blockquote>
                  </div>
                ) : null}
              </section>
            }
          />
        </div>
      </div>
      </main>
    </ClipStudioPreviewProvider>
  );
}
