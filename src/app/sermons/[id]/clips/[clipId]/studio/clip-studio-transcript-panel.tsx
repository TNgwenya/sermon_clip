"use client";

import Link from "next/link";
import { type MouseEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StatusBadge } from "@/components/ui";
import type { EditableCaptionCue } from "@/lib/clipStudioEditing";
import type { SpeechCleanupSettings } from "@/lib/clipStudio";
import {
  CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT,
  type ClipStudioTranscriptCommand,
} from "@/lib/clipStudioTranscriptEvents";
import {
  CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT,
  type ClipStudioSpeechCleanupEditDetail,
} from "@/lib/clipStudioSpeechCleanupEvents";
import {
  CLIP_STUDIO_LAYER_COMMAND_EVENT,
  type ClipStudioLayerCommand,
} from "@/lib/clipStudioLayerEvents";
import {
  buildSpeechCleanupPreviewPlan,
} from "@/lib/clipStudioPreviewTimeline";
import {
  resizeSpeechCleanupEditableCut,
  resolveSpeechCleanupEditableCuts,
  type SpeechCleanupEditableCut,
} from "@/lib/speechCleanupPlan";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type TranscriptSegment = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  confidence?: number | null;
};

type ClipStudioTranscriptPanelProps = {
  transcriptSegments: TranscriptSegment[];
  clipStartSeconds: number;
  clipEndSeconds: number;
  clipDurationSeconds: number | null;
  captionCues: EditableCaptionCue[];
  speechCleanup: SpeechCleanupSettings;
  momentType: string | null;
  momentTitle: string | null;
  smartClipCategory: string | null;
  transcriptReviewRequired?: boolean;
  transcriptReviewHref?: string;
};

const QUICK_CLIP_LENGTH_SECONDS = [30, 45, 60, 90];
const MIN_CLEANUP_CUT_SECONDS = 0.2;
const CLEANUP_CUT_GAP_SECONDS = 0.05;
const MIN_VISUAL_LAYER_SECONDS = 1;

type CleanupCutDragMode = "move" | "start" | "end";
type VisualLayerDragMode = CleanupCutDragMode;

type CleanupCutDragState = {
  cutId: string;
  mode: CleanupCutDragMode;
  pointerId: number;
  originClientX: number;
  originStartSeconds: number;
  originEndSeconds: number;
  trackLeft: number;
  trackWidth: number;
};

type VisualLayerDragState = {
  target: "hook" | "broll";
  cardId?: string;
  mode: VisualLayerDragMode;
  pointerId: number;
  originClientX: number;
  originStartSeconds: number;
  originDurationSeconds: number;
  maximumDurationSeconds: number;
  trackWidth: number;
};

type TimelineLayerSegmentTone = "caption" | "hook" | "broll" | "audio" | "kept";

type TimelineLayerSegment = {
  id: string;
  label: string;
  title: string;
  startSeconds: number;
  leftPercent: number;
  widthPercent: number;
  tone: TimelineLayerSegmentTone;
  cardId?: string;
  hookOverlay?: boolean;
  cleanupCutId?: string;
};

type TimelineLayerRow = {
  id: string;
  label: string;
  status: string;
  enabled: boolean;
  action: ClipStudioLayerCommand | "review-pauses";
  actionLabel: string;
  segments: TimelineLayerSegment[];
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function markerPercent(seconds: number, start: number, duration: number): number {
  return clampPercent(((seconds - start) / duration) * 100);
}

function resolveTimelinePointerSeconds({
  clientX,
  trackLeft,
  trackWidth,
  timelineStart,
  timelineDuration,
}: {
  clientX: number;
  trackLeft: number;
  trackWidth: number;
  timelineStart: number;
  timelineDuration: number;
}): number | null {
  if (
    !Number.isFinite(clientX)
    || !Number.isFinite(trackLeft)
    || !Number.isFinite(trackWidth)
    || trackWidth <= 0
    || !Number.isFinite(timelineStart)
    || !Number.isFinite(timelineDuration)
    || timelineDuration <= 0
  ) {
    return null;
  }

  const ratio = clampSeconds((clientX - trackLeft) / trackWidth, 0, 1);
  return Number((timelineStart + ratio * timelineDuration).toFixed(3));
}

function resolveBrollCardStartSeconds({
  originStartSeconds,
  deltaPixels,
  trackWidth,
  timelineDuration,
  clipDurationSeconds,
  cardDurationSeconds,
}: {
  originStartSeconds: number;
  deltaPixels: number;
  trackWidth: number;
  timelineDuration: number;
  clipDurationSeconds: number;
  cardDurationSeconds: number;
}): number {
  if (
    !Number.isFinite(originStartSeconds)
    || !Number.isFinite(deltaPixels)
    || !Number.isFinite(trackWidth)
    || trackWidth <= 0
    || !Number.isFinite(timelineDuration)
    || timelineDuration <= 0
    || !Number.isFinite(clipDurationSeconds)
    || clipDurationSeconds < 0
    || !Number.isFinite(cardDurationSeconds)
    || cardDurationSeconds < 0
  ) {
    return Number(Math.max(0, originStartSeconds || 0).toFixed(2));
  }

  const maximumStartSeconds = Math.max(0, clipDurationSeconds - Math.max(0, cardDurationSeconds));
  const deltaSeconds = (deltaPixels / trackWidth) * timelineDuration;
  return Number(clampSeconds(originStartSeconds + deltaSeconds, 0, maximumStartSeconds).toFixed(2));
}

function resolveVisualLayerTimingDrag({
  mode,
  originStartSeconds,
  originDurationSeconds,
  deltaPixels,
  trackWidth,
  timelineDuration,
  clipDurationSeconds,
  minimumDurationSeconds = MIN_VISUAL_LAYER_SECONDS,
  maximumDurationSeconds,
}: {
  mode: VisualLayerDragMode;
  originStartSeconds: number;
  originDurationSeconds: number;
  deltaPixels: number;
  trackWidth: number;
  timelineDuration: number;
  clipDurationSeconds: number;
  minimumDurationSeconds?: number;
  maximumDurationSeconds: number;
}): { startSeconds: number; durationSeconds: number } {
  const safeClipDuration = Math.max(minimumDurationSeconds, clipDurationSeconds);
  const safeMaximumDuration = Math.max(
    minimumDurationSeconds,
    Math.min(maximumDurationSeconds, safeClipDuration),
  );
  const safeOriginStart = clampSeconds(
    Number.isFinite(originStartSeconds) ? originStartSeconds : 0,
    0,
    Math.max(0, safeClipDuration - minimumDurationSeconds),
  );
  const safeOriginDuration = clampSeconds(
    Number.isFinite(originDurationSeconds) ? originDurationSeconds : minimumDurationSeconds,
    minimumDurationSeconds,
    Math.min(safeMaximumDuration, safeClipDuration - safeOriginStart),
  );
  if (
    !Number.isFinite(deltaPixels)
    || !Number.isFinite(trackWidth)
    || trackWidth <= 0
    || !Number.isFinite(timelineDuration)
    || timelineDuration <= 0
  ) {
    return {
      startSeconds: Number(safeOriginStart.toFixed(2)),
      durationSeconds: Number(safeOriginDuration.toFixed(2)),
    };
  }

  const deltaSeconds = (deltaPixels / trackWidth) * timelineDuration;
  const originEndSeconds = safeOriginStart + safeOriginDuration;

  if (mode === "start") {
    const startSeconds = clampSeconds(
      safeOriginStart + deltaSeconds,
      Math.max(0, originEndSeconds - safeMaximumDuration),
      originEndSeconds - minimumDurationSeconds,
    );
    return {
      startSeconds: Number(startSeconds.toFixed(2)),
      durationSeconds: Number((originEndSeconds - startSeconds).toFixed(2)),
    };
  }

  if (mode === "end") {
    const endSeconds = clampSeconds(
      originEndSeconds + deltaSeconds,
      safeOriginStart + minimumDurationSeconds,
      Math.min(safeClipDuration, safeOriginStart + safeMaximumDuration),
    );
    return {
      startSeconds: Number(safeOriginStart.toFixed(2)),
      durationSeconds: Number((endSeconds - safeOriginStart).toFixed(2)),
    };
  }

  const startSeconds = clampSeconds(
    safeOriginStart + deltaSeconds,
    0,
    Math.max(0, safeClipDuration - safeOriginDuration),
  );
  return {
    startSeconds: Number(startSeconds.toFixed(2)),
    durationSeconds: Number(safeOriginDuration.toFixed(2)),
  };
}

function formatCleanupDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds === 0) {
    return "0s";
  }

  if (safeSeconds < 1) {
    return `${Math.max(0.1, safeSeconds).toFixed(1)}s`;
  }

  if (safeSeconds < 10 && !Number.isInteger(safeSeconds)) {
    return `${safeSeconds.toFixed(1)}s`;
  }

  return formatSecondsForPastorView(safeSeconds);
}

function removeCleanupMarkerAriaLabel(index: number): string {
  return `Remove cleanup marker ${index + 1}`;
}

function formatCleanupRangeLabel(startSeconds: number, endSeconds: number): string {
  const durationSeconds = Math.max(0, endSeconds - startSeconds);
  if (durationSeconds > 0 && durationSeconds < 1) {
    return `${formatSecondsForPastorView(startSeconds)} · ${formatCleanupDuration(durationSeconds)}`;
  }

  return `${formatSecondsForPastorView(startSeconds)} - ${formatSecondsForPastorView(endSeconds)}`;
}

function clipLayerSegment({
  id,
  label,
  title,
  relativeStartSeconds,
  relativeEndSeconds,
  activeClipStartSeconds,
  timelineStart,
  timelineDuration,
  tone,
  cardId,
  hookOverlay,
  cleanupCutId,
}: {
  id: string;
  label: string;
  title: string;
  relativeStartSeconds: number;
  relativeEndSeconds: number;
  activeClipStartSeconds: number;
  timelineStart: number;
  timelineDuration: number;
  tone: TimelineLayerSegmentTone;
  cardId?: string;
  hookOverlay?: boolean;
  cleanupCutId?: string;
}): TimelineLayerSegment | null {
  if (!Number.isFinite(relativeStartSeconds) || !Number.isFinite(relativeEndSeconds) || relativeEndSeconds <= relativeStartSeconds) {
    return null;
  }

  const absoluteStartSeconds = activeClipStartSeconds + Math.max(0, relativeStartSeconds);
  const absoluteEndSeconds = activeClipStartSeconds + Math.max(0, relativeEndSeconds);
  const leftPercent = markerPercent(absoluteStartSeconds, timelineStart, timelineDuration);
  const rightPercent = markerPercent(absoluteEndSeconds, timelineStart, timelineDuration);

  return {
    id,
    label,
    title,
    startSeconds: absoluteStartSeconds,
    leftPercent,
    widthPercent: Math.max(0.9, rightPercent - leftPercent),
    tone,
    cardId,
    hookOverlay,
    cleanupCutId,
  };
}

function isTranscriptSegmentCurrent(
  segment: TranscriptSegment,
  index: number,
  segments: TranscriptSegment[],
  absoluteSeconds: number,
): boolean {
  const isLastSegment = index === segments.length - 1;
  return (
    absoluteSeconds >= segment.startTimeSeconds &&
    (isLastSegment ? absoluteSeconds <= segment.endTimeSeconds : absoluteSeconds < segment.endTimeSeconds)
  );
}

type TranscriptSegmentClipStatus = "included" | "partial" | "outside";

function resolveTranscriptSegmentClipStatus(
  segment: TranscriptSegment,
  clipStartSeconds: number,
  clipEndSeconds: number,
): TranscriptSegmentClipStatus {
  if (
    segment.endTimeSeconds <= clipStartSeconds
    || segment.startTimeSeconds >= clipEndSeconds
  ) {
    return "outside";
  }

  if (
    segment.startTimeSeconds >= clipStartSeconds
    && segment.endTimeSeconds <= clipEndSeconds
  ) {
    return "included";
  }

  return "partial";
}

function transcriptSegmentClipStatusLabel(status: TranscriptSegmentClipStatus): string {
  switch (status) {
    case "included":
      return "Included in clip";
    case "partial":
      return "Partially included in clip";
    case "outside":
      return "Outside clip";
  }
}

function getInitialFocusedSegmentId(
  transcriptSegments: TranscriptSegment[],
  clipStartSeconds: number,
  clipEndSeconds: number,
): string {
  return (
    transcriptSegments.find(
      (segment) => segment.endTimeSeconds > clipStartSeconds && segment.startTimeSeconds < clipEndSeconds,
    )?.id ??
    transcriptSegments[0]?.id ??
    ""
  );
}

function activateTranscriptSegment({
  segment,
  setFocusedSegmentId,
  seekToAbsolute,
  requestPreviewPlayback,
}: {
  segment: TranscriptSegment;
  setFocusedSegmentId: (segmentId: string) => void;
  seekToAbsolute: (seconds: number) => void;
  requestPreviewPlayback?: () => void;
}) {
  setFocusedSegmentId(segment.id);
  seekToAbsolute(segment.startTimeSeconds);
  requestPreviewPlayback?.();
}

function previewTimelineLayerSegment({
  segment,
  setSelectedBrollCardId,
  seekToAbsolute,
  requestPreviewPlayback,
}: {
  segment: Pick<TimelineLayerSegment, "cardId" | "startSeconds">;
  setSelectedBrollCardId?: (cardId: string) => void;
  seekToAbsolute: (seconds: number) => void;
  requestPreviewPlayback: () => void;
}) {
  if (segment.cardId) {
    setSelectedBrollCardId?.(segment.cardId);
  }
  seekToAbsolute(segment.startSeconds);
  requestPreviewPlayback();
}

function resolveTimelineBoundarySeconds({
  command,
  seconds,
  timelineStart,
  timelineEnd,
  activeClipStartSeconds,
  activeClipEndSeconds,
}: {
  command: "set-start-seconds" | "set-end-seconds";
  seconds: number;
  timelineStart: number;
  timelineEnd: number;
  activeClipStartSeconds: number;
  activeClipEndSeconds: number;
}): number | null {
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const nextSeconds = command === "set-start-seconds"
    ? clampSeconds(seconds, timelineStart, activeClipEndSeconds - 0.1)
    : clampSeconds(seconds, activeClipStartSeconds + 0.1, timelineEnd);
  return Number(nextSeconds.toFixed(3));
}

function useClipStudioTranscriptState({
  transcriptSegments,
  clipStartSeconds,
  clipEndSeconds,
  clipDurationSeconds,
  captionCues,
  speechCleanup,
  momentType,
  momentTitle,
  smartClipCategory,
}: ClipStudioTranscriptPanelProps) {
  const {
    editPreview,
    isDraftDirty,
    previewClock,
    requestPreviewPlayback,
    seekSourcePreviewTo,
  } = useClipStudioPreview();
  const activeClipStartSeconds = editPreview.startSeconds ?? clipStartSeconds;
  const activeClipEndSeconds = editPreview.endSeconds ?? clipEndSeconds;
  const durationSeconds = Math.max(0.1, editPreview.durationSeconds ?? clipDurationSeconds ?? activeClipEndSeconds - activeClipStartSeconds);
  const timelineStart = Math.max(0, Math.min(activeClipStartSeconds, transcriptSegments[0]?.startTimeSeconds ?? activeClipStartSeconds));
  const timelineEnd = Math.max(
    timelineStart + 1,
    Math.max(activeClipEndSeconds, transcriptSegments.at(-1)?.endTimeSeconds ?? activeClipEndSeconds),
  );
  const timelineDuration = timelineEnd - timelineStart;
  const absolutePlayheadSeconds = activeClipStartSeconds + previewClock.sourceCurrentSeconds;
  const playheadPercent = markerPercent(absolutePlayheadSeconds, timelineStart, timelineDuration);
  const selectedStartPercent = markerPercent(activeClipStartSeconds, timelineStart, timelineDuration);
  const selectedEndPercent = markerPercent(activeClipEndSeconds, timelineStart, timelineDuration);
  const selectedWidthPercent = Math.max(0.8, selectedEndPercent - selectedStartPercent);
  const activeCaptionCues = editPreview.captionCues.length > 0 ? editPreview.captionCues : captionCues;
  const activeSpeechCleanup = editPreview.speechCleanup ?? speechCleanup;
  const activeAudioSilenceEvents = editPreview.audioSilenceEvents;
  const activeAudioSilenceAnalyzed = editPreview.audioSilenceAnalyzed;

  const cleanupPlan = useMemo(
    () =>
      buildSpeechCleanupPreviewPlan({
        captionCues: activeCaptionCues,
        durationSeconds,
        speechCleanup: activeSpeechCleanup,
        audioSilenceEvents: activeAudioSilenceEvents,
        audioSilenceAnalysisAvailable: activeAudioSilenceAnalyzed,
        speechCleanupEdits: editPreview.speechCleanupEdits,
      }),
    [
      activeAudioSilenceAnalyzed,
      activeAudioSilenceEvents,
      activeCaptionCues,
      activeSpeechCleanup,
      durationSeconds,
      editPreview.speechCleanupEdits,
    ],
  );
  const editableCleanupCuts = useMemo(
    () => cleanupPlan.enabled ? resolveSpeechCleanupEditableCuts(cleanupPlan, editPreview.speechCleanupEdits) : [],
    [cleanupPlan, editPreview.speechCleanupEdits],
  );
  const removedSeconds = cleanupPlan.removedRanges.reduce((total, range) => total + range.removedSeconds, 0);

  const selectedSegmentIds = useMemo(() => {
    const ids = new Set<string>();
    transcriptSegments.forEach((segment) => {
      if (segment.endTimeSeconds > activeClipStartSeconds && segment.startTimeSeconds < activeClipEndSeconds) {
        ids.add(segment.id);
      }
    });
    return ids;
  }, [activeClipEndSeconds, activeClipStartSeconds, transcriptSegments]);

  const tags = [
    momentType ? momentType.replace(/_/g, " ").toLowerCase() : null,
    smartClipCategory,
    momentTitle,
  ].filter((tag): tag is string => Boolean(tag && tag.trim()));

  function seekToAbsolute(seconds: number) {
    seekSourcePreviewTo(Math.max(0, seconds - activeClipStartSeconds));
  }

  return {
    absolutePlayheadSeconds,
    activeClipEndSeconds,
    activeClipStartSeconds,
    activeCaptionCues,
    editPreview,
    isDraftDirty,
    cleanupPlan,
    durationSeconds,
    editableCleanupCuts,
    playheadPercent,
    previewClock,
    requestPreviewPlayback,
    removedSeconds,
    seekToAbsolute,
    selectedEndPercent,
    selectedSegmentIds,
    selectedStartPercent,
    selectedWidthPercent,
    tags,
    timelineDuration,
    timelineEnd,
    timelineStart,
  };
}

export function ClipStudioTranscriptPanel(props: ClipStudioTranscriptPanelProps) {
  const {
    clipEndSeconds,
    clipStartSeconds,
    transcriptReviewHref = "#",
    transcriptReviewRequired = false,
    transcriptSegments,
  } = props;
  const focusedLineRef = useRef<HTMLButtonElement | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const [focusedSegmentId, setFocusedSegmentId] = useState(() =>
    getInitialFocusedSegmentId(transcriptSegments, clipStartSeconds, clipEndSeconds),
  );
  const [followPlayback, setFollowPlayback] = useState(true);
  const {
    absolutePlayheadSeconds,
    activeClipEndSeconds,
    activeClipStartSeconds,
    durationSeconds,
    editPreview,
    previewClock,
    requestPreviewPlayback,
    seekToAbsolute,
    selectedSegmentIds,
    tags,
  } = useClipStudioTranscriptState(props);
  const currentSegment = useMemo(
    () =>
      transcriptSegments.find((segment, index) =>
        isTranscriptSegmentCurrent(
          segment,
          index,
          transcriptSegments,
          absolutePlayheadSeconds,
        ),
      ) ?? null,
    [absolutePlayheadSeconds, transcriptSegments],
  );
  const focusedSegment = useMemo(
    () =>
      (followPlayback && previewClock.isPlaying ? currentSegment : null) ??
      transcriptSegments.find((segment) => segment.id === focusedSegmentId) ??
      currentSegment ??
      transcriptSegments.find((segment) => selectedSegmentIds.has(segment.id)) ??
      transcriptSegments[0] ??
      null,
    [currentSegment, focusedSegmentId, followPlayback, previewClock.isPlaying, selectedSegmentIds, transcriptSegments],
  );

  useEffect(() => {
    const list = transcriptListRef.current;
    const line = focusedLineRef.current;
    if (
      window.matchMedia("(max-width: 760px)").matches
      || !list
      || !line
      || list.scrollHeight <= list.clientHeight + 1
    ) {
      return;
    }

    const listRect = list.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    if (lineRect.top < listRect.top) {
      list.scrollTop -= listRect.top - lineRect.top;
    } else if (lineRect.bottom > listRect.bottom) {
      list.scrollTop += lineRect.bottom - listRect.bottom;
    }
  }, [focusedSegment?.id]);

  function focusSegment(segment: TranscriptSegment) {
    activateTranscriptSegment({ segment, setFocusedSegmentId, seekToAbsolute });
  }

  function previewSegment(segment: TranscriptSegment) {
    activateTranscriptSegment({
      segment,
      setFocusedSegmentId,
      seekToAbsolute,
      requestPreviewPlayback,
    });
  }

  function dispatchTranscriptCommand(command: ClipStudioTranscriptCommand, segment?: TranscriptSegment) {
    if (segment) {
      focusSegment(segment);
    } else if (command === "reset-ai") {
      setFocusedSegmentId(transcriptSegments[0]?.id ?? "");
    }

    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, {
        detail: {
          command,
          segmentId: segment?.id,
        },
      }),
    );
  }

  function openCaptionWordingEditor() {
    if (!editPreview.applyCaptionsToClip) {
      window.dispatchEvent(
        new CustomEvent(CLIP_STUDIO_LAYER_COMMAND_EVENT, {
          detail: { command: "toggle-captions" satisfies ClipStudioLayerCommand },
        }),
      );
    }
    dispatchTranscriptCommand("open-caption-editor", focusedSegment ?? undefined);
  }

  const focusedClipStatus = focusedSegment
    ? resolveTranscriptSegmentClipStatus(focusedSegment, activeClipStartSeconds, activeClipEndSeconds)
    : null;
  const focusedClipStatusLabel = focusedClipStatus
    ? transcriptSegmentClipStatusLabel(focusedClipStatus)
    : null;
  const wordingCorrectionLocked = focusedClipStatus === "outside";

  return (
    <aside
      id="clip-studio-transcript"
      className="card clip-studio-transcript-rail stack-md"
      aria-label="Spoken transcript and clip boundaries"
      data-testid="clip-studio-transcript-panel"
      tabIndex={-1}
    >
      <div className="section-heading-row">
        <h2>Transcript</h2>
      </div>

      {focusedSegment ? (
        <div
          className="clip-studio-transcript-active"
          data-testid="clip-studio-transcript-active-line"
          aria-live="polite"
        >
          <div className="clip-studio-transcript-active-heading">
            <h3>Selected line</h3>
            <div className="actions-row">
              {typeof focusedSegment.confidence === "number" && focusedSegment.confidence < 0.78 ? (
                <span className="status-pill quality-needs-editing">Check wording</span>
              ) : null}
              <span className={`status-pill ${focusedClipStatus === "outside" ? "quality-needs-editing" : "quality-good"}`}>
                {focusedClipStatusLabel}
              </span>
            </div>
          </div>
          <div>
            <strong>
              {formatSecondsForPastorView(focusedSegment.startTimeSeconds)} - {formatSecondsForPastorView(focusedSegment.endTimeSeconds)}
            </strong>
            <p className="clip-studio-transcript-spoken-line">{focusedSegment.text}</p>
            <p className="muted small">
              Start and end trim the recording. Caption corrections change text only.
            </p>
          </div>
          <div className="clip-studio-transcript-actions" aria-label="Transcript line actions">
            <button
              type="button"
              className="button primary"
              onClick={() => previewSegment(focusedSegment)}
            >
              Preview selected line
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("set-start", focusedSegment)}
            >
              Set start to {formatSecondsForPastorView(focusedSegment.startTimeSeconds)}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("set-end", focusedSegment)}
            >
              Set end to {formatSecondsForPastorView(focusedSegment.endTimeSeconds)}
            </button>
          </div>
          <div className="clip-studio-transcript-correction" aria-label="Transcript wording and review">
            <div>
              <strong>Caption wording</strong>
              <p className="muted small">
                {wordingCorrectionLocked
                  ? "This line is outside the clip. Set a start or end boundary that includes it before editing its on-screen words."
                  : editPreview.applyCaptionsToClip
                    ? "Open the matching caption lines to correct spelling or wording without changing the spoken audio."
                    : "Captions are off. Turn them on to correct the words that will appear on screen."}
              </p>
            </div>
            <div className="clip-studio-transcript-correction-actions">
              <button
                type="button"
                className="button secondary"
                onClick={openCaptionWordingEditor}
                disabled={wordingCorrectionLocked}
                aria-describedby={wordingCorrectionLocked ? "clip-studio-wording-requirement" : undefined}
              >
                {editPreview.applyCaptionsToClip ? "Edit caption words" : "Enable captions to edit"}
              </button>
              <Link href={transcriptReviewHref} className="button tertiary">
                Review transcript
              </Link>
            </div>
            {wordingCorrectionLocked ? (
              <p id="clip-studio-wording-requirement" className="muted small">
                Requirement: include this spoken line in the clip first.
              </p>
            ) : null}
          </div>
          {transcriptReviewRequired ? (
            <div className="clip-studio-transcript-review-required" role="status">
              <div>
                <strong>Spoken transcript review required before final video</strong>
                <p>
                  Preparing is locked until a reviewer confirms the spoken wording. Caption edits here do not complete that review.
                </p>
              </div>
              <Link href={transcriptReviewHref} className="button secondary">
                Review and confirm wording
              </Link>
            </div>
          ) : null}
          <div className="clip-studio-transcript-actions compact" aria-label="Transcript timing actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("snap-to-sentence")}
            >
              Snap to sentence
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("reset-ai")}
            >
              Reset to AI
            </button>
          </div>
        </div>
      ) : null}

      <p className="muted small">
        Select a line to preview or edit its timing.
      </p>

      <div className="clip-studio-ministry-tags" aria-label="Spoken transcript guide">
        <span aria-label="In clip: highlighted green">In clip</span>
        <span aria-label="Playing now: highlighted yellow">Playing</span>
        <span aria-label="Selected row: white outline">Selected</span>
      </div>

      <label className="muted small">
        <input
          type="checkbox"
          checked={followPlayback}
          onChange={(event) => setFollowPlayback(event.target.checked)}
        />{" "}
        Follow playback
      </label>

      <div className="clip-studio-transcript-range">
        <article>
          <span className="kicker">In</span>
          <strong>{formatSecondsForPastorView(activeClipStartSeconds)}</strong>
        </article>
        <article>
          <span className="kicker">Out</span>
          <strong>{formatSecondsForPastorView(activeClipEndSeconds)}</strong>
        </article>
        <article>
          <span className="kicker">Length</span>
          <strong>{formatSecondsForPastorView(durationSeconds)}</strong>
        </article>
      </div>

      {tags.length > 0 ? (
        <div className="clip-studio-ministry-tags" aria-label="Sermon moment tags">
          {tags.slice(0, 5).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      <div ref={transcriptListRef} className="clip-studio-transcript-list" aria-label="Spoken transcript lines">
        {transcriptSegments.length > 0 ? (
          transcriptSegments.map((segment, index) => {
            const isSelected = selectedSegmentIds.has(segment.id);
            const isCurrent = isTranscriptSegmentCurrent(
              segment,
              index,
              transcriptSegments,
              absolutePlayheadSeconds,
            );
            const clipStatus = resolveTranscriptSegmentClipStatus(
              segment,
              activeClipStartSeconds,
              activeClipEndSeconds,
            );
            const clipStatusLabel = transcriptSegmentClipStatusLabel(clipStatus);

            const displayText = segment.text;

            return (
              <button
                key={segment.id}
                type="button"
                aria-label={`Select and play spoken transcript line at ${formatSecondsForPastorView(segment.startTimeSeconds)}: ${displayText}. ${clipStatusLabel}.`}
                aria-current={isCurrent ? "true" : undefined}
                aria-pressed={focusedSegment?.id === segment.id}
                data-testid="clip-studio-transcript-line"
                data-transcript-segment-id={segment.id}
                data-clip-status={clipStatus}
                ref={focusedSegment?.id === segment.id ? focusedLineRef : undefined}
                className={[
                  "clip-studio-transcript-line",
                  isSelected ? "is-selected" : "",
                  isCurrent ? "is-current" : "",
                  focusedSegment?.id === segment.id ? "is-focused" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => previewSegment(segment)}
              >
                <span>{formatSecondsForPastorView(segment.startTimeSeconds)}</span>
                <strong>{displayText}</strong>
                <small className="clip-studio-transcript-line-action">
                  {focusedSegment?.id === segment.id ? "Selected" : "Select & play"}
                </small>
              </button>
            );
          })
        ) : (
          <p className="muted">Transcript lines are not available for this clip yet.</p>
        )}
      </div>
    </aside>
  );
}

export function ClipStudioTimeline(props: ClipStudioTranscriptPanelProps) {
  const {
    transcriptSegments,
  } = props;
  const [selectedCleanupCutId, setSelectedCleanupCutId] = useState<string | null>(null);
  const [cleanupReviewOpen, setCleanupReviewOpen] = useState(false);
  const [advancedCleanupOpen, setAdvancedCleanupOpen] = useState(false);
  const [cleanupCutDrag, setCleanupCutDrag] = useState<CleanupCutDragState | null>(null);
  const [selectedBrollCardId, setSelectedBrollCardId] = useState<string | null>(null);
  const [visualLayerDrag, setVisualLayerDrag] = useState<VisualLayerDragState | null>(null);
  const cleanupCutDragMovedRef = useRef(false);
  const visualLayerDragMovedRef = useRef(false);
  const visualLayerDragRangeRef = useRef<{ startSeconds: number; durationSeconds: number } | null>(null);
  const {
    absolutePlayheadSeconds,
    activeClipEndSeconds,
    activeClipStartSeconds,
    activeCaptionCues,
    cleanupPlan,
    durationSeconds,
    editPreview,
    editableCleanupCuts,
    playheadPercent,
    previewClock,
    requestPreviewPlayback,
    removedSeconds,
    seekToAbsolute,
    selectedEndPercent,
    selectedSegmentIds,
    selectedStartPercent,
    selectedWidthPercent,
    timelineDuration,
    timelineEnd,
    timelineStart,
  } = useClipStudioTranscriptState(props);
  const durationTone =
    durationSeconds < 30
      ? "warning"
      : durationSeconds <= 90
        ? "success"
        : durationSeconds <= 120
          ? "accent"
          : "warning";
  const durationLabel =
    durationSeconds < 30
      ? "Very short"
      : durationSeconds <= 90
        ? "Short-form"
        : durationSeconds <= 120
          ? "Extended"
          : "Long";
  const activeEditableCleanupCuts = editableCleanupCuts.filter((cut) => cut.enabled);
  const tightenedPauseCount = activeEditableCleanupCuts.length;
  const keptPauseCount = editableCleanupCuts.length - tightenedPauseCount;
  const cleanupSavedLabel = formatCleanupDuration(removedSeconds);
  const selectedCleanupCut = selectedCleanupCutId
    ? editableCleanupCuts.find((cut) => cut.id === selectedCleanupCutId) ?? null
    : null;
  const selectedBrollCard = (
    selectedBrollCardId
      ? editPreview.brollLayer.cards.find((card) => card.id === selectedBrollCardId)
      : null
  ) ?? editPreview.brollLayer.cards.find((card) => card.enabled && card.text.trim()) ?? null;
  const playheadRelativeSeconds = clampSeconds(absolutePlayheadSeconds - activeClipStartSeconds, 0, durationSeconds);
  const canAddCleanupCut = cleanupPlan.enabled && durationSeconds >= MIN_CLEANUP_CUT_SECONDS;
  const cleanupTimelineLabel = cleanupPlan.enabled
    ? tightenedPauseCount > 0
      ? `${tightenedPauseCount} pause${tightenedPauseCount === 1 ? "" : "s"} tightened · ${cleanupSavedLabel} saved`
      : "No long pauses found"
    : "Natural pauses";
  const cleanupSummaryTitle = cleanupPlan.enabled
    ? editableCleanupCuts.length > 0
      ? `${tightenedPauseCount} of ${editableCleanupCuts.length} pauses will be tightened`
      : "No long pauses found"
    : "Natural pacing kept";
  const cleanupSummaryMeta = cleanupPlan.enabled
    ? editableCleanupCuts.length > 0
      ? `${cleanupSavedLabel} saved · ${keptPauseCount} kept`
      : `Preview length ${formatSecondsForPastorView(durationSeconds)}`
    : `Preview length ${formatSecondsForPastorView(durationSeconds)}`;
  const timelineLayerRows = useMemo<TimelineLayerRow[]>(() => {
    const captionSegments = editPreview.applyCaptionsToClip
      ? activeCaptionCues.flatMap((cue, index) => {
          const segment = clipLayerSegment({
            id: `caption-${cue.index}-${index}`,
            label: String(index + 1),
            title: cue.text.trim() || `Caption ${index + 1}`,
            relativeStartSeconds: cue.startSeconds,
            relativeEndSeconds: cue.endSeconds,
            activeClipStartSeconds,
            timelineStart,
            timelineDuration,
            tone: "caption",
          });

          return segment ? [segment] : [];
        })
      : [];
    const hookEndSeconds = editPreview.hookOverlay.startSeconds + editPreview.hookOverlay.durationSeconds;
    const hookSegment = editPreview.hookOverlay.enabled && editPreview.hookOverlay.text.trim()
      ? clipLayerSegment({
          id: "hook-overlay",
          label: "Hook",
          title: editPreview.hookOverlay.text,
          relativeStartSeconds: editPreview.hookOverlay.startSeconds,
          relativeEndSeconds: hookEndSeconds,
          activeClipStartSeconds,
          timelineStart,
          timelineDuration,
          tone: "hook",
          hookOverlay: true,
        })
      : null;
    const brollSegments = editPreview.brollLayer.enabled
      ? editPreview.brollLayer.cards.flatMap((card, index) => {
          if (!card.enabled || !card.text.trim()) {
            return [];
          }

          const segment = clipLayerSegment({
            id: `broll-${card.id}`,
            label: String(index + 1),
            title: card.text,
            relativeStartSeconds: card.startSeconds,
            relativeEndSeconds: card.startSeconds + card.durationSeconds,
            activeClipStartSeconds,
            timelineStart,
            timelineDuration,
            tone: "broll",
            cardId: card.id,
          });

          return segment ? [segment] : [];
        })
      : [];
    const pacingSegments = editableCleanupCuts.flatMap((cut, index) => {
      const segment = clipLayerSegment({
        id: `cleanup-${cut.id}`,
        label: cut.enabled ? "" : "Kept",
        title: `Pause ${index + 1}`,
        relativeStartSeconds: cut.startSeconds,
        relativeEndSeconds: cut.endSeconds,
        activeClipStartSeconds,
        timelineStart,
        timelineDuration,
        tone: cut.enabled ? "audio" : "kept",
        cleanupCutId: cut.id,
      });

      return segment ? [segment] : [];
    });

    return [
      {
        id: "captions",
        label: "Captions",
        status: editPreview.applyCaptionsToClip ? `${captionSegments.length} cue${captionSegments.length === 1 ? "" : "s"}` : "Off",
        enabled: editPreview.applyCaptionsToClip,
        action: "toggle-captions",
        actionLabel: editPreview.applyCaptionsToClip ? "Hide" : "Show",
        segments: captionSegments,
      },
      {
        id: "hook",
        label: "Hook",
        status: editPreview.hookOverlay.enabled ? `${Math.round(editPreview.hookOverlay.durationSeconds)}s` : "Off",
        enabled: editPreview.hookOverlay.enabled,
        action: "toggle-hook",
        actionLabel: editPreview.hookOverlay.enabled ? "Hide" : "Show",
        segments: hookSegment ? [hookSegment] : [],
      },
      {
        id: "broll",
        label: "B-roll",
        status: editPreview.brollLayer.enabled ? `${brollSegments.length} card${brollSegments.length === 1 ? "" : "s"}` : "Off",
        enabled: editPreview.brollLayer.enabled,
        action: "toggle-broll-layer",
        actionLabel: editPreview.brollLayer.enabled ? "Hide" : "Show",
        segments: brollSegments,
      },
      {
        id: "pacing",
        label: "Pacing",
        status: cleanupPlan.enabled ? `${tightenedPauseCount} cut${tightenedPauseCount === 1 ? "" : "s"}` : "Off",
        enabled: cleanupPlan.enabled,
        action: "review-pauses",
        actionLabel: cleanupReviewOpen ? "Hide" : "Review",
        segments: pacingSegments,
      },
    ];
  }, [
    activeCaptionCues,
    activeClipStartSeconds,
    cleanupPlan.enabled,
    cleanupReviewOpen,
    editPreview.applyCaptionsToClip,
    editPreview.brollLayer,
    editPreview.hookOverlay,
    editableCleanupCuts,
    tightenedPauseCount,
    timelineDuration,
    timelineStart,
  ]);

  function setQuickDuration(lengthSeconds: number) {
    window.dispatchEvent(new CustomEvent("clip-studio-set-duration", { detail: { lengthSeconds } }));
  }

  function dispatchLayerCommand(
    command: ClipStudioLayerCommand,
    cardId?: string,
    startSeconds?: number,
    layerDurationSeconds?: number,
  ) {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_LAYER_COMMAND_EVENT, {
        detail: {
          command,
          cardId,
          startSeconds,
          durationSeconds: layerDurationSeconds,
        },
      }),
    );
  }

  function updateBrollCardStart(cardId: string, startSeconds: number, seekPreview = true) {
    const card = editPreview.brollLayer.cards.find((item) => item.id === cardId);
    if (!card || !Number.isFinite(startSeconds)) {
      return;
    }

    const nextStartSeconds = resolveBrollCardStartSeconds({
      originStartSeconds: startSeconds,
      deltaPixels: 0,
      trackWidth: 1,
      timelineDuration,
      clipDurationSeconds: durationSeconds,
      cardDurationSeconds: card.durationSeconds,
    });
    setSelectedBrollCardId(cardId);
    dispatchLayerCommand("set-broll-card-timing", cardId, nextStartSeconds, card.durationSeconds);
    if (seekPreview) {
      seekToAbsolute(activeClipStartSeconds + nextStartSeconds);
    }
  }

  function updateBrollCardDuration(cardId: string, nextDurationSeconds: number) {
    const card = editPreview.brollLayer.cards.find((item) => item.id === cardId);
    if (!card || !Number.isFinite(nextDurationSeconds)) {
      return;
    }

    const nextRange = resolveVisualLayerTimingDrag({
      mode: "move",
      originStartSeconds: card.startSeconds,
      originDurationSeconds: nextDurationSeconds,
      deltaPixels: 0,
      trackWidth: 1,
      timelineDuration,
      clipDurationSeconds: durationSeconds,
      maximumDurationSeconds: 12,
    });
    setSelectedBrollCardId(cardId);
    dispatchLayerCommand(
      "set-broll-card-timing",
      cardId,
      nextRange.startSeconds,
      nextRange.durationSeconds,
    );
  }

  function updateHookTiming(startSeconds: number, hookDurationSeconds: number, seekPreview = false) {
    if (!Number.isFinite(startSeconds) || !Number.isFinite(hookDurationSeconds)) {
      return;
    }

    const nextRange = resolveVisualLayerTimingDrag({
      mode: "move",
      originStartSeconds: startSeconds,
      originDurationSeconds: hookDurationSeconds,
      deltaPixels: 0,
      trackWidth: 1,
      timelineDuration,
      clipDurationSeconds: durationSeconds,
      maximumDurationSeconds: 20,
    });
    dispatchLayerCommand(
      "set-hook-overlay-timing",
      undefined,
      nextRange.startSeconds,
      nextRange.durationSeconds,
    );
    if (seekPreview) {
      seekToAbsolute(activeClipStartSeconds + nextRange.startSeconds);
    }
  }

  function dispatchTimelineBoundary(command: "set-start-seconds" | "set-end-seconds", seconds: number) {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, {
        detail: {
          command,
          seconds,
        },
      }),
    );
  }

  function updateTimelineBoundary(command: "set-start-seconds" | "set-end-seconds", seconds: number) {
    const nextSeconds = resolveTimelineBoundarySeconds({
      command,
      seconds,
      timelineStart,
      timelineEnd,
      activeClipStartSeconds,
      activeClipEndSeconds,
    });
    if (nextSeconds === null) {
      return;
    }

    dispatchTimelineBoundary(command, nextSeconds);
  }

  function dispatchTimelineCommand(command: "snap-to-sentence" | "reset-ai") {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, {
        detail: { command },
      }),
    );
  }

  function seekFromTimelineTrack(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("[data-cleanup-cut-id]")) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const seconds = resolveTimelinePointerSeconds({
      clientX: event.clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      timelineStart,
      timelineDuration,
    });
    if (seconds === null) {
      return;
    }

    seekToAbsolute(seconds);
  }

  function dispatchCleanupEdit(detail: ClipStudioSpeechCleanupEditDetail) {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT, {
        detail,
      }),
    );
  }

  function toggleCleanupCut(cut: SpeechCleanupEditableCut) {
    setSelectedCleanupCutId(cut.id);
    setCleanupReviewOpen(true);
    dispatchCleanupEdit({ command: "toggle-cut", cutId: cut.id });
  }

  function setAllCleanupCuts(enabled: boolean) {
    setCleanupReviewOpen(true);
    dispatchCleanupEdit({ command: "set-all-cuts", enabled });
  }

  function deleteCleanupCut(cut: SpeechCleanupEditableCut) {
    dispatchCleanupEdit({ command: "delete-cut", cutId: cut.id });
    setSelectedCleanupCutId(null);
  }

  function resetCleanupCuts() {
    dispatchCleanupEdit({ command: "reset-cuts" });
    setSelectedCleanupCutId(null);
  }

  function addCleanupCutAtPlayhead() {
    if (!canAddCleanupCut) {
      return;
    }

    const cutDurationSeconds = Math.min(0.7, Math.max(MIN_CLEANUP_CUT_SECONDS, durationSeconds));
    let startSeconds = clampSeconds(playheadRelativeSeconds - cutDurationSeconds / 2, 0, Math.max(0, durationSeconds - cutDurationSeconds));
    let endSeconds = startSeconds + cutDurationSeconds;

    for (const cut of [...editableCleanupCuts].sort((left, right) => left.startSeconds - right.startSeconds)) {
      const overlaps = Math.max(startSeconds, cut.startSeconds) < Math.min(endSeconds, cut.endSeconds);
      if (!overlaps) {
        continue;
      }

      startSeconds = cut.endSeconds + CLEANUP_CUT_GAP_SECONDS;
      endSeconds = startSeconds + cutDurationSeconds;
    }

    if (endSeconds > durationSeconds) {
      return;
    }

    dispatchCleanupEdit({
      command: "add-cut",
      source: "manual",
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number(endSeconds.toFixed(3)),
    });
    setCleanupReviewOpen(true);
  }

  function previewCleanupCut(cut: SpeechCleanupEditableCut) {
    setSelectedCleanupCutId(cut.id);
    setCleanupReviewOpen(true);
    seekToAbsolute(activeClipStartSeconds + Math.max(0, cut.startSeconds - 1.25));
    requestPreviewPlayback();
  }

  function previewCleanedClip() {
    seekToAbsolute(activeClipStartSeconds + cleanupPlan.sourceStartSeconds);
    requestPreviewPlayback();
  }

  const getCleanupCutBounds = useCallback((cut: SpeechCleanupEditableCut) => {
    const earlierCuts = editableCleanupCuts.filter((item) => item.id !== cut.id && item.endSeconds <= cut.startSeconds);
    const laterCuts = editableCleanupCuts.filter((item) => item.id !== cut.id && item.startSeconds >= cut.endSeconds);

    return {
      minStartSeconds: Math.max(0, ...earlierCuts.map((item) => item.endSeconds + CLEANUP_CUT_GAP_SECONDS)),
      maxEndSeconds: Math.min(durationSeconds, ...laterCuts.map((item) => item.startSeconds - CLEANUP_CUT_GAP_SECONDS)),
    };
  }, [durationSeconds, editableCleanupCuts]);

  function updateCleanupCutRemovalDuration(cut: SpeechCleanupEditableCut, nextRemovedSeconds: number) {
    const bounds = getCleanupCutBounds(cut);
    const resizedCut = resizeSpeechCleanupEditableCut({
      cut,
      removedSeconds: nextRemovedSeconds,
      ...bounds,
      minRemovedSeconds: MIN_CLEANUP_CUT_SECONDS,
    });

    setSelectedCleanupCutId(cut.id);
    setCleanupReviewOpen(true);
    dispatchCleanupEdit({
      command: "update-cut",
      cutId: cut.id,
      startSeconds: resizedCut.startSeconds,
      endSeconds: resizedCut.endSeconds,
    });
  }

  const constrainCleanupCutRange = useCallback(({
    cut,
    mode,
    proposedStartSeconds,
    proposedEndSeconds,
  }: {
    cut: SpeechCleanupEditableCut;
    mode: CleanupCutDragMode;
    proposedStartSeconds: number;
    proposedEndSeconds: number;
  }): { startSeconds: number; endSeconds: number } => {
    const { minStartSeconds, maxEndSeconds } = getCleanupCutBounds(cut);

    if (mode === "start") {
      const startSeconds = clampSeconds(proposedStartSeconds, minStartSeconds, cut.endSeconds - MIN_CLEANUP_CUT_SECONDS);
      return {
        startSeconds: Number(startSeconds.toFixed(3)),
        endSeconds: cut.endSeconds,
      };
    }

    if (mode === "end") {
      const endSeconds = clampSeconds(proposedEndSeconds, cut.startSeconds + MIN_CLEANUP_CUT_SECONDS, maxEndSeconds);
      return {
        startSeconds: cut.startSeconds,
        endSeconds: Number(endSeconds.toFixed(3)),
      };
    }

    const cutDurationSeconds = Math.max(MIN_CLEANUP_CUT_SECONDS, cut.endSeconds - cut.startSeconds);
    const startSeconds = clampSeconds(proposedStartSeconds, minStartSeconds, Math.max(minStartSeconds, maxEndSeconds - cutDurationSeconds));
    return {
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number((startSeconds + cutDurationSeconds).toFixed(3)),
    };
  }, [getCleanupCutBounds]);

  function startCleanupCutDrag(
    event: PointerEvent<HTMLElement>,
    cut: SpeechCleanupEditableCut,
    mode: CleanupCutDragMode,
  ) {
    const track = event.currentTarget.closest(".clip-studio-timeline-track, .clip-studio-layer-track");
    if (!(track instanceof HTMLElement)) {
      return;
    }

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    event.stopPropagation();
    if (mode !== "move") {
      event.preventDefault();
    }
    cleanupCutDragMovedRef.current = false;
    setCleanupCutDrag({
      cutId: cut.id,
      mode,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originStartSeconds: cut.startSeconds,
      originEndSeconds: cut.endSeconds,
      trackLeft: rect.left,
      trackWidth: rect.width,
    });
  }

  useEffect(() => {
    if (!cleanupCutDrag) {
      return undefined;
    }

    const activeDrag = cleanupCutDrag;

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) {
        return;
      }

      const cut = editableCleanupCuts.find((item) => item.id === activeDrag.cutId);
      if (!cut || activeDrag.trackWidth <= 0) {
        return;
      }

      const deltaSeconds = ((event.clientX - activeDrag.originClientX) / activeDrag.trackWidth) * timelineDuration;
      if (Math.abs(event.clientX - activeDrag.originClientX) > 3) {
        cleanupCutDragMovedRef.current = true;
        setSelectedCleanupCutId(cut.id);
      }

      const proposedStartSeconds = activeDrag.mode === "end"
        ? activeDrag.originStartSeconds
        : activeDrag.originStartSeconds + deltaSeconds;
      const proposedEndSeconds = activeDrag.mode === "start"
        ? activeDrag.originEndSeconds
        : activeDrag.originEndSeconds + deltaSeconds;
      const nextRange = constrainCleanupCutRange({
        cut,
        mode: activeDrag.mode,
        proposedStartSeconds,
        proposedEndSeconds,
      });

      dispatchCleanupEdit({
        command: "update-cut",
        cutId: activeDrag.cutId,
        startSeconds: nextRange.startSeconds,
        endSeconds: nextRange.endSeconds,
      });
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      if (event.pointerId === activeDrag.pointerId) {
        setCleanupCutDrag(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [cleanupCutDrag, constrainCleanupCutRange, editableCleanupCuts, timelineDuration]);

  function startVisualLayerDrag(
    event: PointerEvent<HTMLElement>,
    {
      target,
      cardId,
      mode,
    }: {
      target: "hook" | "broll";
      cardId?: string;
      mode: VisualLayerDragMode;
    },
  ) {
    const card = target === "broll" && cardId
      ? editPreview.brollLayer.cards.find((item) => item.id === cardId) ?? null
      : null;
    const startSeconds = target === "hook"
      ? editPreview.hookOverlay.startSeconds
      : card?.startSeconds;
    const duration = target === "hook"
      ? editPreview.hookOverlay.durationSeconds
      : card?.durationSeconds;
    const track = event.currentTarget.closest(".clip-studio-layer-track");
    if (
      !(track instanceof HTMLElement)
      || typeof startSeconds !== "number"
      || !Number.isFinite(startSeconds)
      || typeof duration !== "number"
      || !Number.isFinite(duration)
    ) {
      return;
    }

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    event.stopPropagation();
    if (mode !== "move") {
      event.preventDefault();
    }
    visualLayerDragMovedRef.current = false;
    visualLayerDragRangeRef.current = {
      startSeconds,
      durationSeconds: duration,
    };
    if (cardId) {
      setSelectedBrollCardId(cardId);
    }
    setVisualLayerDrag({
      target,
      cardId,
      mode,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originStartSeconds: startSeconds,
      originDurationSeconds: duration,
      maximumDurationSeconds: target === "hook" ? 20 : 12,
      trackWidth: rect.width,
    });
  }

  useEffect(() => {
    if (!visualLayerDrag) {
      return undefined;
    }

    const activeDrag = visualLayerDrag;

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) {
        return;
      }

      const deltaPixels = event.clientX - activeDrag.originClientX;
      if (Math.abs(deltaPixels) <= 3) {
        return;
      }

      event.preventDefault();
      visualLayerDragMovedRef.current = true;
      const nextRange = resolveVisualLayerTimingDrag({
        mode: activeDrag.mode,
        originStartSeconds: activeDrag.originStartSeconds,
        originDurationSeconds: activeDrag.originDurationSeconds,
        deltaPixels,
        trackWidth: activeDrag.trackWidth,
        timelineDuration,
        clipDurationSeconds: durationSeconds,
        maximumDurationSeconds: activeDrag.maximumDurationSeconds,
      });
      visualLayerDragRangeRef.current = nextRange;
      window.dispatchEvent(
        new CustomEvent(CLIP_STUDIO_LAYER_COMMAND_EVENT, {
          detail: activeDrag.target === "hook"
            ? {
                command: "set-hook-overlay-timing",
                startSeconds: nextRange.startSeconds,
                durationSeconds: nextRange.durationSeconds,
              }
            : {
                command: "set-broll-card-timing",
                cardId: activeDrag.cardId,
                startSeconds: nextRange.startSeconds,
                durationSeconds: nextRange.durationSeconds,
              },
        }),
      );
      seekToAbsolute(activeClipStartSeconds + nextRange.startSeconds);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) {
        return;
      }

      if (visualLayerDragMovedRef.current && visualLayerDragRangeRef.current !== null) {
        seekToAbsolute(activeClipStartSeconds + visualLayerDragRangeRef.current.startSeconds);
      }
      setVisualLayerDrag(null);
      window.setTimeout(() => {
        visualLayerDragMovedRef.current = false;
        visualLayerDragRangeRef.current = null;
      }, 0);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeClipStartSeconds, durationSeconds, seekToAbsolute, timelineDuration, visualLayerDrag]);

  return (
    <section className="card clip-studio-bottom-timeline stack-sm" aria-label="Clip timeline">
      <div className="clip-studio-edit-deck-head">
        <div>
          <p className="kicker">Timeline</p>
          <strong>{formatSecondsForPastorView(activeClipStartSeconds)} - {formatSecondsForPastorView(activeClipEndSeconds)}</strong>
        </div>
        <div className="clip-studio-edit-deck-meta">
          <StatusBadge tone={durationTone}>{durationLabel}</StatusBadge>
          <span>{cleanupTimelineLabel}</span>
        </div>
      </div>

      <div className="clip-studio-timeline-action-row">
        <div className="clip-studio-quick-lengths clip-studio-timeline-lengths" aria-label="Quick clip lengths">
          {QUICK_CLIP_LENGTH_SECONDS.map((lengthSeconds) => (
            <button
              key={lengthSeconds}
              type="button"
              className="button secondary"
              onClick={() => setQuickDuration(lengthSeconds)}
            >
              {lengthSeconds}s
            </button>
          ))}
        </div>
        <label className="clip-studio-playhead-time-control">
          <span>Playhead (seconds)</span>
          <input
            type="number"
            min={timelineStart}
            max={timelineEnd}
            step={0.1}
            value={Number(absolutePlayheadSeconds.toFixed(3))}
            onChange={(event) => seekToAbsolute(event.currentTarget.valueAsNumber)}
            aria-describedby="clip-studio-timeline-draft-help"
          />
        </label>
        <div className="clip-studio-timeline-boundary-actions" aria-label="Timeline boundary actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => dispatchTimelineBoundary("set-start-seconds", absolutePlayheadSeconds)}
          >
            Set Start
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => dispatchTimelineBoundary("set-end-seconds", absolutePlayheadSeconds)}
          >
            Set End
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => dispatchTimelineCommand("snap-to-sentence")}
          >
            Snap
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => dispatchTimelineCommand("reset-ai")}
          >
            Reset
          </button>
        </div>
      </div>
      <p id="clip-studio-timeline-draft-help" className="muted small clip-studio-timeline-draft-help">
        Click to seek. Timing stays draft-only until saved.
      </p>

      <div className="clip-studio-transcript-range" aria-label="Precise clip timing">
        <article>
          <label className="stack-sm" htmlFor="clip-studio-timeline-in-seconds">
            <span className="kicker">In (seconds)</span>
            <input
              id="clip-studio-timeline-in-seconds"
              type="number"
              min={timelineStart}
              max={activeClipEndSeconds - 0.1}
              step={0.1}
              value={Number(activeClipStartSeconds.toFixed(3))}
              aria-describedby="clip-studio-timeline-boundary-help"
              onChange={(event) => updateTimelineBoundary("set-start-seconds", event.currentTarget.valueAsNumber)}
            />
          </label>
          <div className="clip-studio-transcript-actions compact">
            <button
              type="button"
              className="button tertiary"
              aria-label="Move In point earlier by 0.1 seconds"
              disabled={activeClipStartSeconds <= timelineStart}
              onClick={() => updateTimelineBoundary("set-start-seconds", activeClipStartSeconds - 0.1)}
            >
              -0.1
            </button>
            <button
              type="button"
              className="button tertiary"
              aria-label="Move In point later by 0.1 seconds"
              disabled={activeClipStartSeconds >= activeClipEndSeconds - 0.1}
              onClick={() => updateTimelineBoundary("set-start-seconds", activeClipStartSeconds + 0.1)}
            >
              +0.1
            </button>
          </div>
        </article>
        <article>
          <label className="stack-sm" htmlFor="clip-studio-timeline-out-seconds">
            <span className="kicker">Out (seconds)</span>
            <input
              id="clip-studio-timeline-out-seconds"
              type="number"
              min={activeClipStartSeconds + 0.1}
              max={timelineEnd}
              step={0.1}
              value={Number(activeClipEndSeconds.toFixed(3))}
              aria-describedby="clip-studio-timeline-boundary-help"
              onChange={(event) => updateTimelineBoundary("set-end-seconds", event.currentTarget.valueAsNumber)}
            />
          </label>
          <div className="clip-studio-transcript-actions compact">
            <button
              type="button"
              className="button tertiary"
              aria-label="Move Out point earlier by 0.1 seconds"
              disabled={activeClipEndSeconds <= activeClipStartSeconds + 0.1}
              onClick={() => updateTimelineBoundary("set-end-seconds", activeClipEndSeconds - 0.1)}
            >
              -0.1
            </button>
            <button
              type="button"
              className="button tertiary"
              aria-label="Move Out point later by 0.1 seconds"
              disabled={activeClipEndSeconds >= timelineEnd}
              onClick={() => updateTimelineBoundary("set-end-seconds", activeClipEndSeconds + 0.1)}
            >
              +0.1
            </button>
          </div>
        </article>
        <article>
          <span className="kicker">Clip length</span>
          <strong>{formatSecondsForPastorView(durationSeconds)}</strong>
          <span id="clip-studio-timeline-boundary-help" className="muted small">
            Type a time or nudge either edge.
          </span>
        </article>
      </div>

      <div className="clip-studio-pacing-panel" aria-label="Pacing cleanup">
        <div className="clip-studio-pacing-summary">
          <div>
            <p className="kicker">Pacing cleanup</p>
            <strong>{cleanupSummaryTitle}</strong>
            <span>{cleanupSummaryMeta}</span>
            <span id="clip-studio-pacing-drag-help" className="muted small">
              Drag a pacing block to move it, or drag either edge to change the cut length. Use Review pauses for exact controls.
            </span>
          </div>
          <StatusBadge tone={cleanupPlan.enabled && tightenedPauseCount > 0 ? "success" : "neutral"}>
            {cleanupPlan.enabled ? "Preview ready" : "Off"}
          </StatusBadge>
        </div>
        <div className="clip-studio-pacing-actions">
          <button type="button" className="button primary" onClick={previewCleanedClip}>
            Preview cleaned clip
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setCleanupReviewOpen((open) => !open)}
            aria-pressed={cleanupReviewOpen}
          >
            {cleanupReviewOpen ? "Hide pause review" : `Review pauses${editableCleanupCuts.length > 0 ? ` (${editableCleanupCuts.length})` : ""}`}
          </button>
          {editableCleanupCuts.length > 0 ? (
            <>
              <button type="button" className="button secondary" onClick={() => setAllCleanupCuts(false)}>
                Keep natural pacing
              </button>
              <button type="button" className="button secondary" onClick={() => setAllCleanupCuts(true)}>
                Tighten all
              </button>
            </>
          ) : null}
          {cleanupPlan.enabled ? (
            <button type="button" className="button secondary" onClick={addCleanupCutAtPlayhead} disabled={!canAddCleanupCut}>
              Add cut at playhead
            </button>
          ) : null}
          <button
            type="button"
            className="button tertiary"
            onClick={() => setAdvancedCleanupOpen((open) => !open)}
            aria-pressed={advancedCleanupOpen}
          >
            {advancedCleanupOpen ? "Lock fine edit" : "Fine edit timeline"}
          </button>
        </div>
      </div>

      <div
        className="clip-studio-unified-timeline-scroll"
        aria-label="Shared editing timeline"
        tabIndex={0}
      >
        <div className="clip-studio-layer-stack clip-studio-unified-timeline">
          {timelineLayerRows.map((row, rowIndex) => (
            <div
              key={row.id}
              className={[
                "clip-studio-layer-row",
                row.enabled ? "is-enabled" : "is-disabled",
              ].join(" ")}
              style={{ gridRow: rowIndex + 1 }}
            >
              <div className="clip-studio-layer-label">
                <strong>{row.label}</strong>
                <span>{row.status}</span>
              </div>
              <div
                className="clip-studio-layer-track"
                aria-label={`${row.label} layer timeline`}
                onClick={seekFromTimelineTrack}
              >
                {row.segments.length > 0 ? (
                  row.segments.map((segment) => {
                    const isBrollSegment = Boolean(segment.cardId);
                    const isHookSegment = segment.hookOverlay === true;
                    const isVisualTimingSegment = isBrollSegment || isHookSegment;
                    const isSelectedBrollSegment = isBrollSegment && selectedBrollCard?.id === segment.cardId;
                    const cleanupCut = segment.cleanupCutId
                      ? editableCleanupCuts.find((cut) => cut.id === segment.cleanupCutId) ?? null
                      : null;
                    const isPacingSegment = cleanupCut !== null;
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        className={[
                          "clip-studio-layer-segment",
                          `is-${segment.tone}`,
                          isVisualTimingSegment ? "is-draggable is-resizable" : "",
                          isPacingSegment ? "is-pacing-cut is-draggable is-resizable" : "",
                          isSelectedBrollSegment ? "is-selected" : "",
                        ].filter(Boolean).join(" ")}
                        data-cleanup-cut-id={cleanupCut?.id}
                        data-hook-overlay={isHookSegment ? "true" : undefined}
                        style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                        title={
                          isVisualTimingSegment
                            ? `${segment.title} · drag the block or either edge`
                            : isPacingSegment
                              ? `${segment.title} · drag the block or either edge`
                              : segment.title
                        }
                        aria-label={
                          isBrollSegment
                            ? `Preview and select ${row.label} item at ${formatSecondsForPastorView(segment.startSeconds)}. Drag the block to move it or drag either edge to change its duration.`
                            : isHookSegment
                              ? `Preview hook at ${formatSecondsForPastorView(segment.startSeconds)}. Drag the block to move it or drag either edge to change its duration.`
                            : isPacingSegment
                              ? `Preview pacing cut at ${formatSecondsForPastorView(segment.startSeconds)}. Drag the block to move it or drag either edge to change its length.`
                              : `Preview ${row.label} layer at ${formatSecondsForPastorView(segment.startSeconds)}`
                        }
                        aria-describedby={
                          isBrollSegment
                            ? "clip-studio-broll-drag-help"
                            : isHookSegment
                              ? "clip-studio-hook-drag-help"
                            : isPacingSegment
                              ? "clip-studio-pacing-drag-help"
                              : undefined
                        }
                        onPointerDown={(event) => {
                          if (segment.cardId) {
                            startVisualLayerDrag(event, {
                              target: "broll",
                              cardId: segment.cardId,
                              mode: "move",
                            });
                          } else if (isHookSegment) {
                            startVisualLayerDrag(event, { target: "hook", mode: "move" });
                          } else if (cleanupCut) {
                            startCleanupCutDrag(event, cleanupCut, "move");
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isVisualTimingSegment && visualLayerDragMovedRef.current) {
                            visualLayerDragMovedRef.current = false;
                            return;
                          }
                          if (cleanupCut && cleanupCutDragMovedRef.current) {
                            cleanupCutDragMovedRef.current = false;
                            return;
                          }
                          if (cleanupCut) {
                            setSelectedCleanupCutId(cleanupCut.id);
                            setCleanupReviewOpen(true);
                          }
                          previewTimelineLayerSegment({
                            segment,
                            setSelectedBrollCardId,
                            seekToAbsolute,
                            requestPreviewPlayback,
                          });
                        }}
                      >
                        {cleanupCut || isVisualTimingSegment ? (
                          <span
                            className="clip-studio-timeline-cut-resize is-start"
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              if (cleanupCut) {
                                startCleanupCutDrag(event, cleanupCut, "start");
                              } else {
                                startVisualLayerDrag(event, {
                                  target: isHookSegment ? "hook" : "broll",
                                  cardId: segment.cardId,
                                  mode: "start",
                                });
                              }
                            }}
                          />
                        ) : null}
                        <span>{segment.label}</span>
                        {cleanupCut || isVisualTimingSegment ? (
                          <span
                            className="clip-studio-timeline-cut-resize is-end"
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              if (cleanupCut) {
                                startCleanupCutDrag(event, cleanupCut, "end");
                              } else {
                                startVisualLayerDrag(event, {
                                  target: isHookSegment ? "hook" : "broll",
                                  cardId: segment.cardId,
                                  mode: "end",
                                });
                              }
                            }}
                          />
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <span className="clip-studio-layer-empty" aria-hidden="true" />
                )}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (row.action === "review-pauses") {
                    setCleanupReviewOpen((open) => !open);
                    return;
                  }

                  dispatchLayerCommand(row.action);
                }}
              >
                {row.actionLabel}
              </button>
            </div>
          ))}

          <div
            className="clip-studio-layer-row is-enabled"
            style={{ gridRow: timelineLayerRows.length + 1 }}
          >
            <div className="clip-studio-layer-label">
              <strong>Clip range</strong>
              <span>Start and end</span>
            </div>
            <div
              className="clip-studio-timeline-track clip-studio-timeline-track-interactive"
              aria-label="Clip boundary timeline"
              onClick={seekFromTimelineTrack}
            >
              <span
                className="clip-studio-timeline-selection"
                style={{ left: `${selectedStartPercent}%`, width: `${selectedWidthPercent}%` }}
              />
              <span className="clip-studio-timeline-ai-marker" style={{ left: `${selectedStartPercent}%` }} title="AI start" />
              <span className="clip-studio-timeline-ai-marker" style={{ left: `${selectedEndPercent}%` }} title="AI end" />
              {editableCleanupCuts.map((range) => {
                const cutStart = activeClipStartSeconds + range.startSeconds;
                const cutEnd = activeClipStartSeconds + range.endSeconds;
                const left = markerPercent(cutStart, timelineStart, timelineDuration);
                const width = Math.max(0.6, markerPercent(cutEnd, timelineStart, timelineDuration) - left);
                const title = range.source === "audio"
                  ? `${formatCleanupDuration(range.removedSeconds)} audio silence`
                  : `${formatCleanupDuration(range.removedSeconds)} estimated pause`;

                return (
                  <button
                    key={range.id}
                    type="button"
                    data-cleanup-cut-id={range.id}
                    aria-pressed={range.enabled}
                    aria-label={`${range.enabled ? "Keep" : "Restore"} and preview pause cleanup at ${formatSecondsForPastorView(cutStart)}`}
                    className={[
                      "clip-studio-timeline-dead-air",
                      range.source === "audio" ? "is-audio" : "is-transcript",
                      range.enabled ? "is-active" : "is-disabled",
                      selectedCleanupCut?.id === range.id ? "is-selected" : "",
                    ].join(" ")}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={title}
                    onPointerDown={(event) => {
                      if (advancedCleanupOpen) {
                        startCleanupCutDrag(event, range, "move");
                      }
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (cleanupCutDragMovedRef.current) {
                        cleanupCutDragMovedRef.current = false;
                        return;
                      }
                      seekToAbsolute(cutStart);
                      requestPreviewPlayback();
                      toggleCleanupCut(range);
                    }}
                  >
                    {advancedCleanupOpen ? (
                      <span
                        className="clip-studio-timeline-cut-resize is-start"
                        aria-hidden="true"
                        onPointerDown={(event) => startCleanupCutDrag(event, range, "start")}
                      />
                    ) : null}
                    <span className="clip-studio-timeline-cut-label">{range.enabled ? "" : "Kept"}</span>
                    {advancedCleanupOpen ? (
                      <span
                        className="clip-studio-timeline-cut-resize is-end"
                        aria-hidden="true"
                        onPointerDown={(event) => startCleanupCutDrag(event, range, "end")}
                      />
                    ) : null}
                  </button>
                );
              })}
              <span className="clip-studio-timeline-handle" style={{ left: `${selectedStartPercent}%` }} aria-hidden="true" />
              <span className="clip-studio-timeline-handle" style={{ left: `${selectedEndPercent}%` }} aria-hidden="true" />
              <input
                className="clip-studio-timeline-slider clip-studio-timeline-slider-start"
                type="range"
                min={timelineStart}
                max={timelineEnd}
                step={0.1}
                value={activeClipStartSeconds}
                onChange={(event) => updateTimelineBoundary("set-start-seconds", Number(event.target.value))}
                aria-label="Clip start handle"
              />
              <input
                className="clip-studio-timeline-slider clip-studio-timeline-slider-end"
                type="range"
                min={timelineStart}
                max={timelineEnd}
                step={0.1}
                value={activeClipEndSeconds}
                onChange={(event) => updateTimelineBoundary("set-end-seconds", Number(event.target.value))}
                aria-label="Clip end handle"
              />
            </div>
            <span className="clip-studio-layer-action-spacer" aria-hidden="true" />
          </div>

          <div
            className="clip-studio-layer-row is-enabled"
            style={{ gridRow: timelineLayerRows.length + 2 }}
          >
            <div className="clip-studio-layer-label">
              <strong>Spoken</strong>
              <span>{transcriptSegments.length} line{transcriptSegments.length === 1 ? "" : "s"}</span>
            </div>
            <div
              className="clip-studio-transcript-strip"
              aria-label="Spoken transcript timeline"
              onClick={seekFromTimelineTrack}
            >
              {transcriptSegments.map((segment, index) => {
                const left = markerPercent(segment.startTimeSeconds, timelineStart, timelineDuration);
                const right = markerPercent(segment.endTimeSeconds, timelineStart, timelineDuration);
                const isSelected = selectedSegmentIds.has(segment.id);

                return (
                  <button
                    key={segment.id}
                    type="button"
                    className={isSelected ? "clip-studio-transcript-block is-selected" : "clip-studio-transcript-block"}
                    style={{ left: `${left}%`, width: `${Math.max(0.65, right - left)}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      seekToAbsolute(segment.startTimeSeconds);
                      requestPreviewPlayback();
                    }}
                    aria-label={`Preview spoken line ${index + 1} at ${formatSecondsForPastorView(segment.startTimeSeconds)}`}
                    title={segment.text}
                  >
                    <span>{index + 1}</span>
                  </button>
                );
              })}
            </div>
            <span className="clip-studio-layer-action-spacer" aria-hidden="true" />
          </div>

          <span
            className="clip-studio-shared-playhead"
            style={{ gridRow: `1 / span ${timelineLayerRows.length + 2}` }}
            aria-hidden="true"
          >
            <span style={{ left: `${playheadPercent}%` }} />
          </span>
        </div>
      </div>

      <div className="clip-studio-timeline-labels muted small">
        <span>{formatSecondsForPastorView(timelineStart)}</span>
        <span>{previewClock.isPlaying ? "Playing" : "Ready"}</span>
        <span>{formatSecondsForPastorView(timelineEnd)}</span>
      </div>

      {editPreview.hookOverlay.enabled && editPreview.hookOverlay.text.trim() ? (
        <div className="clip-studio-broll-timeline-controls" aria-label="Hook timing">
          <div>
            <span className="kicker">Opening hook</span>
            <strong>{editPreview.hookOverlay.text}</strong>
          </div>
          <label>
            Starts (seconds)
            <input
              type="number"
              min={0}
              max={Math.max(0, durationSeconds - editPreview.hookOverlay.durationSeconds)}
              step={0.1}
              value={editPreview.hookOverlay.startSeconds}
              onChange={(event) => updateHookTiming(
                event.currentTarget.valueAsNumber,
                editPreview.hookOverlay.durationSeconds,
                true,
              )}
              aria-describedby="clip-studio-hook-drag-help"
            />
          </label>
          <label>
            Duration (seconds)
            <input
              type="number"
              min={MIN_VISUAL_LAYER_SECONDS}
              max={Math.min(20, durationSeconds - editPreview.hookOverlay.startSeconds)}
              step={0.1}
              value={editPreview.hookOverlay.durationSeconds}
              onChange={(event) => updateHookTiming(
                editPreview.hookOverlay.startSeconds,
                event.currentTarget.valueAsNumber,
              )}
              aria-describedby="clip-studio-hook-drag-help"
            />
          </label>
          <div className="clip-studio-broll-timeline-nudges">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                seekToAbsolute(activeClipStartSeconds + editPreview.hookOverlay.startSeconds);
                requestPreviewPlayback();
              }}
            >
              Preview hook
            </button>
          </div>
          <span id="clip-studio-hook-drag-help" className="muted small">
            Drag the purple hook to move it, drag either edge to resize it, or type exact values. Changes stay in this unsaved draft.
          </span>
        </div>
      ) : null}

      {selectedBrollCard ? (
        <div className="clip-studio-broll-timeline-controls" aria-label="Selected B-roll or highlight card timing">
          <div>
            <span className="kicker">Selected cutaway</span>
            <strong>{selectedBrollCard.label || selectedBrollCard.text}</strong>
          </div>
          <label>
            Starts (seconds)
            <input
              type="number"
              min={0}
              max={Math.max(0, durationSeconds - selectedBrollCard.durationSeconds)}
              step={0.1}
              value={selectedBrollCard.startSeconds}
              onChange={(event) => updateBrollCardStart(selectedBrollCard.id, event.currentTarget.valueAsNumber)}
              aria-describedby="clip-studio-broll-drag-help"
            />
          </label>
          <label>
            Duration (seconds)
            <input
              type="number"
              min={MIN_VISUAL_LAYER_SECONDS}
              max={Math.min(12, durationSeconds - selectedBrollCard.startSeconds)}
              step={0.1}
              value={selectedBrollCard.durationSeconds}
              onChange={(event) => updateBrollCardDuration(
                selectedBrollCard.id,
                event.currentTarget.valueAsNumber,
              )}
              aria-describedby="clip-studio-broll-drag-help"
            />
          </label>
          <div className="clip-studio-broll-timeline-nudges" aria-label="Nudge selected cutaway">
            <button
              type="button"
              className="button tertiary"
              onClick={() => updateBrollCardStart(selectedBrollCard.id, selectedBrollCard.startSeconds - 0.5)}
              disabled={selectedBrollCard.startSeconds <= 0}
            >
              0.5s earlier
            </button>
            <button
              type="button"
              className="button tertiary"
              onClick={() => updateBrollCardStart(selectedBrollCard.id, selectedBrollCard.startSeconds + 0.5)}
              disabled={selectedBrollCard.startSeconds >= durationSeconds - selectedBrollCard.durationSeconds}
            >
              0.5s later
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                seekToAbsolute(activeClipStartSeconds + selectedBrollCard.startSeconds);
                requestPreviewPlayback();
              }}
            >
              Preview here
            </button>
          </div>
          <span id="clip-studio-broll-drag-help" className="muted small">
            Drag the yellow cutaway to move it, drag either edge to resize it, or type exact values. This changes only the unsaved draft.
          </span>
        </div>
      ) : null}

        {cleanupReviewOpen ? (
          <div className="clip-studio-cleanup-review" aria-label="Pause review">
            {editableCleanupCuts.length > 0 ? (
              <div className="clip-studio-cleanup-review-list">
                {editableCleanupCuts.map((cut, index) => {
                  const cutStart = activeClipStartSeconds + cut.startSeconds;
                  const cutEnd = activeClipStartSeconds + cut.endSeconds;
                  const cutRangeLabel = formatCleanupRangeLabel(cutStart, cutEnd);
                  const isSelected = selectedCleanupCut?.id === cut.id;
                  const cutBounds = getCleanupCutBounds(cut);
                  const maximumRemovedSeconds = Math.max(
                    MIN_CLEANUP_CUT_SECONDS,
                    Math.min(cut.rawGapSeconds, cutBounds.maxEndSeconds - cutBounds.minStartSeconds),
                  );
                  const removalControlId = `clip-studio-pause-removal-${index + 1}`;

                  return (
                    <article
                      key={cut.id}
                      className={[
                        "clip-studio-cleanup-review-item",
                        cut.enabled ? "is-tightened" : "is-kept",
                        isSelected ? "is-selected" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      <div>
                        <span className="kicker">Pause {index + 1}</span>
                        <strong>{cutRangeLabel}</strong>
                        <p className="muted small">
                          {formatCleanupDuration(cut.removedSeconds)} {cut.enabled ? "removed" : "kept"} · {cut.confidence === "confirmed" ? "Confirmed" : "Review"}
                        </p>
                        <label className="stack-sm" htmlFor={`${removalControlId}-range`}>
                          Remove from detected pause
                          <input
                            id={`${removalControlId}-range`}
                            type="range"
                            min={MIN_CLEANUP_CUT_SECONDS}
                            max={maximumRemovedSeconds}
                            step={0.1}
                            value={Math.min(cut.removedSeconds, maximumRemovedSeconds)}
                            aria-valuetext={`${formatCleanupDuration(cut.removedSeconds)} removed from a ${formatCleanupDuration(cut.rawGapSeconds)} pause`}
                            onChange={(event) => updateCleanupCutRemovalDuration(cut, event.currentTarget.valueAsNumber)}
                          />
                        </label>
                        <label className="stack-sm" htmlFor={`${removalControlId}-seconds`}>
                          Removal (seconds)
                          <input
                            id={`${removalControlId}-seconds`}
                            type="number"
                            min={MIN_CLEANUP_CUT_SECONDS}
                            max={maximumRemovedSeconds}
                            step={0.1}
                            value={Number(Math.min(cut.removedSeconds, maximumRemovedSeconds).toFixed(3))}
                            onChange={(event) => updateCleanupCutRemovalDuration(cut, event.currentTarget.valueAsNumber)}
                          />
                        </label>
                        <span className="muted small">
                          Detected pause: {formatCleanupDuration(cut.rawGapSeconds)}. Adjust how much silence disappears.
                        </span>
                      </div>
                      <div className="clip-studio-cleanup-review-actions">
                        <StatusBadge tone={cut.enabled ? "success" : "neutral"}>
                          {cut.enabled ? "Tightened" : "Kept"}
                        </StatusBadge>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => previewCleanupCut(cut)}
                          aria-label={`Preview pause ${index + 1}`}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => toggleCleanupCut(cut)}
                          aria-label={`${cut.enabled ? "Keep" : "Tighten"} pause ${index + 1}`}
                        >
                          {cut.enabled ? "Keep" : "Tighten"}
                        </button>
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => deleteCleanupCut(cut)}
                          aria-label={removeCleanupMarkerAriaLabel(index)}
                        >
                          Remove marker
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="clip-studio-cleanup-review-empty">
                <strong>No pauses in review</strong>
                <span className="muted small">Current intensity found nothing to tighten.</span>
              </div>
            )}
            <div className="clip-studio-cleanup-review-footer">
              <button type="button" className="button secondary" onClick={addCleanupCutAtPlayhead} disabled={!canAddCleanupCut}>
                Add cut at playhead
              </button>
              <button type="button" className="button tertiary" onClick={resetCleanupCuts}>
                Reset cleanup
              </button>
            </div>
          </div>
        ) : null}

    </section>
  );
}

export const __clipStudioTranscriptPanelTestUtils = {
  activateTranscriptSegment,
  previewTimelineLayerSegment,
  removeCleanupMarkerAriaLabel,
  resolveBrollCardStartSeconds,
  resolveVisualLayerTimingDrag,
  resolveTimelinePointerSeconds,
  resolveTranscriptSegmentClipStatus,
  resolveTimelineBoundarySeconds,
};
