import { stat } from "node:fs/promises";

import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { StatCard, StatusBadge } from "@/components/ui";
import { DEFAULT_CAPTION_STYLE_PRESET_ID } from "@/lib/captionStylePresets";
import {
  extractCaptionPackage,
  extractCaptionGuidance,
  extractCaptionAppearanceSettings,
  extractApplyCaptionsToClip,
  extractCaptionPosition,
  extractCaptionRevealMode,
  extractCaptionSyncOffsetSeconds,
  extractCaptionStyleOverride,
  extractBrollLayerConfig,
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
import {
  buildEditableCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptWords,
  parseCaptionSourceWords,
  resolveClipStudioInitialCaptionCues,
} from "@/lib/clipStudioEditing";
import { ClipStudioEditor } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-editor";
import { ClipStudioFormatFraming } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-format-framing";
import { ClipStudioBranding } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-branding";
import { ClipStudioCoverFrame } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-cover-frame";
import { ClipStudioLivePreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-live-preview";
import { ClipStudioPreviewProvider } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";
import { ClipStudioWorkbenchTabs } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-workbench-tabs";
import { ClipStudioPrepareButton } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-prepare-button";
import {
  ClipStudioTimeline,
  ClipStudioTranscriptPanel,
} from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-transcript-panel";
import {
  FORMAT_LABELS,
  exportStatusTone,
  resolveExportHistory,
  resolveExportSettings,
  toPastorFriendlyExportStatus,
} from "@/lib/clipExportSettings";
import { resolveBrandingConfig } from "@/lib/clipBranding";
import { buildClipAssetRecoveryPlan } from "@/lib/clipAssetRecovery";
import { resolveClipStudioPreparationState } from "@/lib/clipStudioPrepare";
import { getBrandingSettings } from "@/server/branding/settings";
import { resolveAvailableBrandingLogoPath } from "@/server/branding/logoStorage";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { isFreshRemotePreview, resolveBestPreviewCandidate } from "@/lib/clipPreview";
import { extractSpeechCleanupEdits } from "@/lib/speechCleanupPlan";
import { parseClipCoverFrameSelection } from "@/lib/clipCoverFrame";

type ClipStudioPageParams = {
  params: Promise<{ id: string; clipId: string }>;
};

type StudioTranscriptSegment = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

const FALLBACK_TRANSCRIPT_SEGMENT_TARGET_WORDS = 24;

function splitTranscriptTextForStudio(transcriptText: string | null): string[] {
  const normalizedText = transcriptText?.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return [];
  }

  const sentencePieces = normalizedText
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((piece) => piece.trim())
    .filter(Boolean) ?? [];

  if (sentencePieces.length > 1) {
    return sentencePieces;
  }

  const words = normalizedText.split(" ").filter(Boolean);
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += FALLBACK_TRANSCRIPT_SEGMENT_TARGET_WORDS) {
    chunks.push(words.slice(index, index + FALLBACK_TRANSCRIPT_SEGMENT_TARGET_WORDS).join(" "));
  }

  return chunks;
}

function buildFallbackTranscriptSegments({
  clipStartSeconds,
  clipEndSeconds,
  transcriptText,
}: {
  clipStartSeconds: number;
  clipEndSeconds: number;
  transcriptText: string | null;
}): StudioTranscriptSegment[] {
  const transcriptPieces = splitTranscriptTextForStudio(transcriptText);

  if (transcriptPieces.length === 0) {
    return [];
  }

  const durationSeconds = Math.max(1, clipEndSeconds - clipStartSeconds);
  const segmentDurationSeconds = durationSeconds / transcriptPieces.length;

  return transcriptPieces.map((text, index) => {
    const startTimeSeconds = clipStartSeconds + segmentDurationSeconds * index;
    const endTimeSeconds = index === transcriptPieces.length - 1
      ? clipEndSeconds
      : clipStartSeconds + segmentDurationSeconds * (index + 1);

    return {
      id: `clip-transcript-${index + 1}`,
      startTimeSeconds,
      endTimeSeconds,
      text,
    };
  });
}

function isStaleFinalExportFreshness(value: string | null | undefined): boolean {
  return value === "OUTDATED" || value === "NEEDS_REGENERATION" || value === "FAILED";
}

function formatContentPotential(score: number): string {
  const normalized = score > 10 && score <= 100 ? score / 10 : score;
  if (normalized >= 8) return "Strong";
  if (normalized >= 6) return "Worth reviewing";
  return "Needs refinement";
}

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

  const [sermon, clip] = await Promise.all([
    prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sourceVideoPath: true,
    },
    }),
    prisma.clipCandidate.findUnique({
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
      transcriptSafetyStatus: true,
      transcriptSafetyReasons: true,
      transcriptSafetyReviewedAt: true,
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
      renderedAt: true,
      remotePreviewUrl: true,
      remotePreviewUploadedAt: true,
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
      exportPath: true,
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
    }),
  ]);

  if (!sermon || !clip || clip.sermonId !== sermonId) {
    notFound();
  }

  const [transcriptSegments, sermonDurationSegment, transcriptRecord, appBranding] = await Promise.all([
    prisma.transcriptSegment.findMany({
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
        confidence: true,
      },
    }),
    prisma.transcriptSegment.findFirst({
      where: { sermonId },
      orderBy: { endTimeSeconds: "desc" },
      select: { endTimeSeconds: true },
    }),
    prisma.transcript.findUnique({
      where: { sermonId },
      select: { wordTimings: true },
    }),
    getBrandingSettings().catch(() => null),
  ]);

  const hashtags = Array.isArray(clip.hashtags)
    ? (clip.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
    : [];

  const captionPackage = extractCaptionPackage(clip.captionData, clip.caption, hashtags);
  const captionGuidance = extractCaptionGuidance(clip.captionData);
  const savedOnVideoCaptionCues = extractOnVideoCaptionCues(clip.captionData, null, null);
  const fallbackOnVideoCaptionCues = extractOnVideoCaptionCues(null, clip.transcriptText, clip.durationSeconds);
  const captionStyleOverride = extractCaptionStyleOverride(clip.captionData);
  const captionPosition = extractCaptionPosition(clip.captionData);
  const captionAppearance = extractCaptionAppearanceSettings(clip.captionData);
  const captionRevealMode = extractCaptionRevealMode(clip.captionData);
  const captionSyncOffsetSeconds = extractCaptionSyncOffsetSeconds(clip.captionData);
  const applyCaptionsToClip = extractApplyCaptionsToClip(clip.captionData);
  const hookOverlay = extractHookOverlayConfig(clip.captionData, clip.hook || clip.suggestedHook);
  const brollLayer = extractBrollLayerConfig(
    clip.captionData,
    clip.durationSeconds ?? Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds),
  );
  const languageHints = extractLanguageHints(clip.captionData);
  const speechCleanupSettings = extractSpeechCleanupSettings(clip.captionData);
  const speechCleanupEdits = extractSpeechCleanupEdits(clip.captionData, clip.durationSeconds ?? Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds));
  const framingDecisionSummary = extractFramingDecisionSummary(clip.captionData);
  const exportSettings = resolveExportSettings({
    exportFormat: clip.exportFormat,
    exportLayoutStrategy: clip.exportLayoutStrategy,
    captionData: clip.captionData,
    manualCropKeyframes: clip.manualCropKeyframes,
  });
  const brandingConfig = resolveBrandingConfig(clip.captionData);
  const brandChurchName = sermon.churchName.trim() || appBranding?.churchName.trim() || "";
  const availableLogoPath = await resolveAvailableBrandingLogoPath(appBranding?.churchLogoPath);
  const logoAvailable = Boolean(availableLogoPath);
  const logoSrc = logoAvailable
    ? `/api/branding/logo?v=${appBranding?.updatedAt.getTime() ?? 0}`
    : null;
  const exportHistory = resolveExportHistory(clip.captionData);
  const latestExportHistory = exportHistory.filter((record) => record.isLatest).slice(0, 4);
  const [exportHistoryWithFileState, currentExportFileExists] = await Promise.all([
    Promise.all(latestExportHistory.map(async (record) => {
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
    })),
    localMediaAvailable && (clip.exportedFilePath || clip.exportPath)
      ? stat(clip.exportedFilePath || clip.exportPath!)
        .then((fileStat) => fileStat.isFile() && fileStat.size > 0)
        .catch(() => false)
      : Promise.resolve(false),
  ]);
  // Source media is verified by the preview and audio-review endpoints when it
  // is actually requested. Avoid blocking Studio's first paint on disk I/O.
  const sourceVideoPreviewAvailable = localMediaAvailable && Boolean(sermon.sourceVideoPath);
  const audioSilenceReviewUrl = sourceVideoPreviewAvailable
    ? `/api/clips/${clip.id}/audio-silence-review?start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}`
    : null;
  const transcriptExcerpt = formatTranscriptExcerpt(clip.transcriptText);
  const studioTranscriptSegments = transcriptSegments.length > 0
    ? transcriptSegments
    : buildFallbackTranscriptSegments({
        clipStartSeconds: clip.startTimeSeconds,
        clipEndSeconds: clip.endTimeSeconds,
        transcriptText: clip.transcriptText,
      });
  const transcriptWords = parseCaptionSourceWords(transcriptRecord?.wordTimings).filter(
    (word) =>
      word.endTimeSeconds >= Math.max(0, clip.startTimeSeconds - 20) &&
      word.startTimeSeconds <= clip.endTimeSeconds + 20,
  );
  const exactWordCaptionCues = transcriptWords.length > 0
    ? buildTimedCaptionCuesFromTranscriptWords({
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: clip.endTimeSeconds,
        words: transcriptWords,
        maxWordsPerCue: captionRevealMode === "single-word" ? 1 : 5,
        maxCueDurationSeconds: captionRevealMode === "single-word" ? 1.4 : 2.4,
      })
    : [];
  const transcriptCaptionCues = exactWordCaptionCues.length > 0
    ? exactWordCaptionCues
    : captionRevealMode === "single-word"
      ? buildTimedCaptionCuesFromTranscriptSegments({
          startTimeSeconds: clip.startTimeSeconds,
          endTimeSeconds: clip.endTimeSeconds,
          segments: studioTranscriptSegments,
        })
      : buildEditableCaptionCuesFromTranscriptSegments({
          startTimeSeconds: clip.startTimeSeconds,
          endTimeSeconds: clip.endTimeSeconds,
          segments: studioTranscriptSegments,
        });
  const generatedOnVideoCaptionCues = transcriptCaptionCues.length > 0
    ? transcriptCaptionCues
    : fallbackOnVideoCaptionCues;
  const captionDataRecord = clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
    ? clip.captionData as Record<string, unknown>
    : null;
  const onVideoCaptionCues = resolveClipStudioInitialCaptionCues({
    savedCues: savedOnVideoCaptionCues,
    transcriptCues: generatedOnVideoCaptionCues,
    clipDurationSeconds: Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds),
    savedCuesManuallyEdited: captionDataRecord?.["manuallyEdited"] === true,
  });
  const timing = buildClipTimingDisplay(clip.startTimeSeconds, clip.endTimeSeconds, clip.durationSeconds);
  const initialEditPreview = {
    startLabel: timing.startLabel,
    endLabel: timing.endLabel,
    durationLabel: timing.durationLabel,
    startSeconds: clip.startTimeSeconds,
    endSeconds: clip.endTimeSeconds,
    durationSeconds: clip.durationSeconds,
    title: clip.title,
    editorialHook: clip.hook,
    mainCaption: captionPackage.primaryCaption ?? clip.caption,
    shortCaption: captionPackage.shortCaption ?? "",
    platformCaption: captionPackage.platformCaption ?? "",
    onVideoCaptionText: onVideoCaptionCues.map((cue) => cue.text).join(" "),
    captionCues: onVideoCaptionCues,
    applyCaptionsToClip,
    captionStylePresetId: captionStyleOverride || appBranding?.defaultCaptionStyleName || DEFAULT_CAPTION_STYLE_PRESET_ID,
    captionPosition,
    captionAppearance,
    captionRevealMode,
    captionSyncOffsetSeconds,
    hookOverlay,
    brollLayer,
    speechCleanup: speechCleanupSettings,
    speechCleanupEdits,
    audioSilenceEvents: [],
    audioSilenceAnalyzed: false,
    hashtags: captionPackage.hashtags.join(" "),
    isTimingValid: true,
  };
  const ministryScore = formatMinistryScore(clip.ministryValue);
  const socialScore = formatSocialScore(clip.socialValue);
  const hasMinistryScore = Boolean(clip.ministryValue?.trim());
  const hasSocialScore = Boolean(clip.socialValue?.trim());
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

  const bestPreview = resolveBestPreviewCandidate(clip);
  const hasRemotePreview = isFreshRemotePreview(clip);
  const hasPreview = (localMediaAvailable && Boolean(bestPreview)) || hasRemotePreview;
  const previewSrc = hasRemotePreview
    ? `/api/clips/${clip.id}/preview?variant=best`
    : localMediaAvailable && bestPreview
      ? `/api/clips/${clip.id}/preview?variant=${bestPreview.variant}`
      : null;

  const clipStatus = clip.status as "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  const renderStatus = clip.renderStatus as "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  const recoveryPlan = buildClipAssetRecoveryPlan(clip);
  const upstreamPreparing =
    renderStatus === "QUEUED" ||
    renderStatus === "RENDERING" ||
    (applyCaptionsToClip && (clip.captionStatus === "GENERATING" || clip.captionBurnStatus === "BURNING")) ||
    clip.overlayStatus === "RENDERING" ||
    clip.exportStatus === "QUEUED" ||
    clip.exportStatus === "EXPORTING";
  const captionsNeedUpdate = applyCaptionsToClip && (
    (clip.captionStatus !== "GENERATED" && clip.captionStatus !== "GENERATING") ||
    (clip.captionBurnStatus !== "COMPLETED" && clip.captionBurnStatus !== "BURNING")
  );
  const upstreamNeedsUpdate =
    (renderStatus !== "COMPLETED" && renderStatus !== "QUEUED" && renderStatus !== "RENDERING") ||
    captionsNeedUpdate ||
    (clip.exportStatus !== "COMPLETED" && clip.exportStatus !== "QUEUED" && clip.exportStatus !== "EXPORTING") ||
    isStaleFinalExportFreshness(clip.renderFreshness) ||
    (applyCaptionsToClip && (
      isStaleFinalExportFreshness(clip.captionFreshness) ||
      isStaleFinalExportFreshness(clip.captionBurnFreshness)
    )) ||
    isStaleFinalExportFreshness(clip.overlayFreshness) ||
    isStaleFinalExportFreshness(clip.exportFreshness);
  const upstreamFailed = recoveryPlan.failedLabels.some((label) => (
    applyCaptionsToClip || (label !== "Captions" && label !== "Caption burn")
  ));
  const preparationState = resolveClipStudioPreparationState({
    selectedFormats: exportSettings.selectedFormats,
    records: exportHistoryWithFileState,
    canonicalExport: {
      format: clip.exportFormat,
      status: clip.exportStatus,
      freshness: clip.exportFreshness,
      outputPath: clip.exportedFilePath || clip.exportPath,
      fileExists: currentExportFileExists,
    },
    trustCompletedOutputMetadata: !localMediaAvailable,
    upstreamNeedsUpdate,
    upstreamPreparing,
    upstreamFailed,
  });
  const hasPreparedMedia = preparationState.availableFormats.length > 0;
  const preparedFinalNeedsUpdate = preparationState.needsUpdate;
  const preparedFinalReady = preparationState.ready;
  const readyFormatSet = new Set(preparationState.readyFormats);
  const latestExportRecords = exportHistoryWithFileState;
  const transcriptReviewRequired = clip.transcriptSafetyStatus === "REVIEW_REQUIRED";
  const transcriptReviewed = clip.transcriptSafetyStatus === "REVIEWED";
  const studioMediaIssues = [
    clip.renderError ? { label: "Render", message: clip.renderError } : null,
    clip.captionGenerationError ? { label: "Captions", message: clip.captionGenerationError } : null,
    clip.captionBurnError ? { label: "Caption burn", message: clip.captionBurnError } : null,
    clip.overlayRenderError ? { label: "Branding", message: clip.overlayRenderError } : null,
    clip.exportError ? { label: "Export", message: clip.exportError } : null,
  ].filter((issue): issue is { label: string; message: string } => Boolean(issue));

  return (
    <ClipStudioPreviewProvider
      initialExportSettings={exportSettings}
      initialBrandingConfig={brandingConfig}
      initialEditPreview={initialEditPreview}
      churchName={brandChurchName}
      sermonTitle={sermon.title}
      preacherName={sermon.speakerName}
      logoSrc={logoSrc}
    >
      <main className="container clip-studio-shell stack-md">
        <header className="clip-studio-topbar" aria-labelledby="clip-studio-title">
          <div className="clip-studio-topbar-row">
            <div className="clip-studio-title-block">
              <div className="clip-studio-title-copy stack-sm">
                <p className="kicker">Clip Studio · Message-safe editing</p>
                <h1 id="clip-studio-title">{clip.title}</h1>
                <p className="muted clip-studio-topbar-subtitle">
                  {sermon.title} · Polish the moment without losing its meaning.
                </p>
              </div>

              <div className="clip-studio-primary-status" aria-label="Current clip status">
                <StatusBadge tone={clipStatusTone(clipStatus)}>
                  {formatClipStatusLabel(clipStatus, {
                    isManuallyEdited: clip.isManuallyEdited,
                    renderStatus,
                  })}
                </StatusBadge>
                <span className="muted small">Content potential · {formatContentPotential(clip.score)}</span>
              </div>

              <details className="clip-studio-status-details">
                <summary>
                  <span>Clip checks</span>
                  <span className="muted small">
                    {clip.boundaryQuality === "GOOD" ? "Timing looks good" : "Review timing and context"}
                  </span>
                </summary>
                <div className="clip-studio-status-row">
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
                  {clip.contextWarning ? <StatusBadge tone="warning">Needs context</StatusBadge> : null}
                  {transcriptReviewRequired ? <StatusBadge tone="warning">Transcript review needed</StatusBadge> : null}
                  {transcriptReviewed ? <StatusBadge tone="success">Transcript reviewed</StatusBadge> : null}
                </div>
              </details>

              {transcriptReviewRequired ? (
                <p className="warning-banner">
                  Review the local-language wording before preparing. Saving captions does not confirm transcript accuracy—approve it in Review before export.
                </p>
              ) : null}
            </div>

            <div className="clip-studio-topbar-actions" aria-label="Clip Studio navigation and preparation">
              <div className="clip-studio-context-actions">
                <Link href={`/sermons/${sermonId}`} className="button tertiary">
                  Back to sermon
                </Link>
                <Link href={`/sermons/${sermonId}/review`} className="button tertiary">
                  Review moments
                </Link>
              </div>
              <ClipStudioPrepareButton
                clipId={clip.id}
                clipStatus={clipStatus}
                hasPreparedMedia={hasPreparedMedia}
                serverNeedsUpdate={preparedFinalNeedsUpdate}
                serverIsPreparing={preparationState.preparing}
                transcriptReviewRequired={transcriptReviewRequired}
              />
            </div>
          </div>
        </header>

        <div className="clip-studio-layout">
          <ClipStudioTranscriptPanel
            transcriptSegments={studioTranscriptSegments}
            clipStartSeconds={clip.startTimeSeconds}
            clipEndSeconds={clip.endTimeSeconds}
            clipDurationSeconds={clip.durationSeconds}
            captionCues={onVideoCaptionCues}
            speechCleanup={speechCleanupSettings}
            momentType={clip.ministryMoment?.momentType ?? clip.clipType ?? null}
            momentTitle={clip.ministryMoment?.title ?? null}
            smartClipCategory={clip.smartClipCategory}
          />

          <aside className="clip-studio-preview-column stack-md">
            <ClipStudioLivePreview
              hasPreview={hasPreview}
              previewSrc={previewSrc}
              sourcePreviewSrc={sourceVideoPreviewAvailable ? `/api/sermons/${sermon.id}/source-preview` : null}
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

            {studioMediaIssues.length > 0 ? (
              <aside className="clip-studio-media-alert" aria-label="Media preparation issues">
                <strong>Media needs attention</strong>
                <ul>
                  {studioMediaIssues.map((issue) => (
                    <li key={issue.label}>
                      <span>{issue.label}</span>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </aside>

          <div className="clip-studio-main-column stack-md">
            <ClipStudioWorkbenchTabs
            edit={
              <ClipStudioEditor
                initialStartTimeSeconds={clip.startTimeSeconds}
                initialEndTimeSeconds={clip.endTimeSeconds}
                initialTitle={clip.title}
                initialEditorialHook={clip.hook}
                initialMainCaption={captionPackage.primaryCaption ?? clip.caption}
                initialShortCaption={captionPackage.shortCaption ?? ""}
                initialPlatformCaption={captionPackage.platformCaption ?? ""}
                initialHashtags={captionPackage.hashtags}
                initialCaptionCues={onVideoCaptionCues}
                initialApplyCaptionsToClip={applyCaptionsToClip}
                initialCaptionStylePresetId={captionStyleOverride}
                initialCaptionPosition={captionPosition}
                initialCaptionAppearance={captionAppearance}
                initialCaptionRevealMode={captionRevealMode}
                initialCaptionSyncOffsetSeconds={captionSyncOffsetSeconds}
                brandCaptionStylePresetId={appBranding?.defaultCaptionStyleName ?? DEFAULT_CAPTION_STYLE_PRESET_ID}
                suggestedHook={clip.suggestedHook ?? ""}
                suggestedCaption={clip.suggestedCaption ?? ""}
                titleOptions={captionPackage.titleOptions}
                hookOptions={captionPackage.hookOptions}
                ctaOptions={captionPackage.ctaOptions}
                initialHookOverlay={hookOverlay}
                initialBrollLayer={brollLayer}
                initialSpeechCleanup={speechCleanupSettings}
                initialSpeechCleanupEdits={speechCleanupEdits}
                initialAudioSilenceEvents={[]}
                initialAudioSilenceAnalyzed={false}
                audioSilenceReviewUrl={audioSilenceReviewUrl}
                transcriptSegments={studioTranscriptSegments}
                transcriptWords={transcriptWords}
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
                clipDurationSeconds={clip.durationSeconds}
                initialSettings={exportSettings}
                videoSubjectTracks={videoSubjectTracks}
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
              />
            }
            branding={
              <div className="stack-md">
                <ClipStudioBranding
                  initialConfig={brandingConfig}
                  churchName={brandChurchName}
                  sermonTitle={sermon.title}
                  preacherName={sermon.speakerName}
                  logoAvailable={logoAvailable}
                  logoSrc={logoSrc}
                />
                <ClipStudioCoverFrame
                  clipId={clip.id}
                  durationSeconds={clip.durationSeconds ?? Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds)}
                  initialSelection={parseClipCoverFrameSelection(clip.captionData)}
                  localMediaAvailable={localMediaAvailable}
                />
              </div>
            }
            post={
              <section className="clip-studio-details stack-md">
                <div className="section-heading-row">
                  <div>
                    <p className="kicker">Publishing handoff</p>
                    <h3>
                      {preparationState.preparing
                        ? "Preparing final video"
                        : preparationState.failed
                          ? "Preparation needs attention"
                          : preparedFinalReady
                            ? "Prepared video ready"
                            : "Final video needs updating"}
                    </h3>
                  </div>
                  <StatusBadge tone={preparedFinalReady ? "success" : preparationState.preparing ? "accent" : "warning"}>
                    {preparedFinalReady
                      ? "Prepared"
                      : preparationState.preparing
                        ? "Preparing"
                        : preparationState.failed
                          ? "Needs attention"
                          : "Not prepared"}
                  </StatusBadge>
                </div>
                <p className="muted small">
                  {preparationState.preparing
                    ? "The media worker is building the selected output formats."
                    : preparedFinalReady
                      ? "Prepared media is ready for the ready-to-post package."
                      : "Use Prepare for Posting to save this composition, approve the clip, and update the final video."}
                </p>
                {!preparationState.preparing && preparationState.missingFormats.length > 0 ? (
                  <p className="muted small">
                    Still needed: {preparationState.missingFormats.map((format) => FORMAT_LABELS[format]).join(", ")}.
                  </p>
                ) : null}
                {preparedFinalNeedsUpdate && recoveryPlan.hasRecoverableIssue ? (
                  <p className="muted small">{recoveryPlan.summary}</p>
                ) : null}
                {latestExportRecords.length > 0 ? (
                  <div className="posting-draft-list">
                    {latestExportRecords.map((record) => (
                      <article className="posting-draft-card" key={record.id}>
                        <div className="actions-row">
                          <strong>{FORMAT_LABELS[record.format]}</strong>
                          <StatusBadge tone={exportStatusTone(record.status)}>
                            {toPastorFriendlyExportStatus(record.status)}
                          </StatusBadge>
                        </div>
                        <p className="muted small">
                          {record.outputFilename ?? "No file yet"}
                          {record.fileSizeBytes ? ` · ${(record.fileSizeBytes / 1_000_000).toFixed(1)} MB` : ""}
                        </p>
                        <p className="muted small">
                          {record.status === "COMPLETED" && readyFormatSet.has(record.format)
                            ? record.fileExists
                              ? "File verified locally"
                              : "Prepared output confirmed by the media worker"
                            : record.status === "FAILED"
                              ? record.errorMessage ?? "Export failed"
                              : "Preparing or waiting for a fresh export"}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted small">Prepared output records will appear here after the first prepare run.</p>
                )}
                {preparedFinalReady ? (
                  <Link href={`/ready-to-post?clipId=${clip.id}`} className="button secondary">
                    Open publishing desk
                  </Link>
                ) : null}
              </section>
            }
            evidence={
              <section className="clip-studio-details stack-md">
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
                  {hasMinistryScore ? (
                    <StatCard label={ministryScore.label} value={ministryScore.value} tone={ministryScore.tone} />
                  ) : null}
                  {hasSocialScore ? (
                    <StatCard label={socialScore.label} value={socialScore.value} tone={socialScore.tone} />
                  ) : null}
                  <StatCard
                    label="Audience"
                    value={clip.intendedAudience || "General"}
                    tone="accent"
                  />
                </div>
                {clip.recommendationReason ? <p className="muted">{clip.recommendationReason}</p> : null}

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
                  <p className="muted">No caption package exists yet. Add captions in the Clip inspector before preparing.</p>
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
            advanced={
              <section className="clip-studio-details stack-md">
                <div className="section-heading-row">
                  <div>
                    <p className="kicker">Advanced</p>
                    <h3>Diagnostics</h3>
                  </div>
                  <StatusBadge tone="neutral">Hidden by default</StatusBadge>
                </div>
                <p className="muted small">
                  Frame checks, subject tracking, crop stability, safe-area snapshots, and raw render details stay inside diagnostics instead of the main editor.
                </p>
                <dl className="data-list stack-sm">
                  <div className="data-list-row">
                    <dt className="muted small">Frame check</dt>
                    <dd>{clip.visualQualityScore !== null ? `${clip.visualQualityScore.toFixed(1)}/10` : "Prepare video to check framing quality."}</dd>
                  </div>
                  <div className="data-list-row">
                    <dt className="muted small">Speaker tracking</dt>
                    <dd>{videoSubjectTracks.length > 0 ? `${videoSubjectTracks.length} track${videoSubjectTracks.length === 1 ? "" : "s"}` : "Speaker tracking not ready"}</dd>
                  </div>
                  {clip.renderError ? (
                    <div className="data-list-row">
                      <dt className="muted small">Render issue</dt>
                      <dd>{clip.renderError}</dd>
                    </div>
                  ) : null}
                  {clip.smartCropDebugError ? (
                    <div className="data-list-row">
                      <dt className="muted small">Frame diagnostic</dt>
                      <dd>{clip.smartCropDebugError}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            }
            />
          </div>

          <ClipStudioTimeline
            transcriptSegments={studioTranscriptSegments}
            clipStartSeconds={clip.startTimeSeconds}
            clipEndSeconds={clip.endTimeSeconds}
            clipDurationSeconds={clip.durationSeconds}
            captionCues={onVideoCaptionCues}
            speechCleanup={speechCleanupSettings}
            momentType={clip.ministryMoment?.momentType ?? clip.clipType ?? null}
            momentTitle={clip.ministryMoment?.title ?? null}
            smartClipCategory={clip.smartClipCategory}
          />
        </div>
      </main>
    </ClipStudioPreviewProvider>
  );
}
