"use client";

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
};

const QUICK_CLIP_LENGTH_SECONDS = [30, 45, 60, 90];
const MIN_CLEANUP_CUT_SECONDS = 0.2;
const CLEANUP_CUT_GAP_SECONDS = 0.05;

type CleanupCutDragMode = "move" | "start" | "end";

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

function findCaptionCueForTranscriptSegment({
  activeClipStartSeconds,
  activeClipEndSeconds,
  captionCues,
  segment,
}: {
  activeClipStartSeconds: number;
  activeClipEndSeconds: number;
  captionCues: EditableCaptionCue[];
  segment: TranscriptSegment;
}): EditableCaptionCue | null {
  const overlapStart = Math.max(activeClipStartSeconds, segment.startTimeSeconds);
  const overlapEnd = Math.min(activeClipEndSeconds, segment.endTimeSeconds);
  if (overlapEnd <= overlapStart) {
    return null;
  }

  const relativeStart = Number((overlapStart - activeClipStartSeconds).toFixed(3));
  const relativeEnd = Number((overlapEnd - activeClipStartSeconds).toFixed(3));

  return (
    captionCues.find(
      (cue) =>
        Math.abs(cue.startSeconds - relativeStart) < 0.08 &&
        Math.abs(cue.endSeconds - relativeEnd) < 0.08,
    ) ?? null
  );
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
    seekPreviewTo,
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
  const absolutePlayheadSeconds = activeClipStartSeconds + previewClock.currentSeconds;
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
    seekPreviewTo(Math.max(0, seconds - activeClipStartSeconds));
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
    transcriptSegments,
  } = props;
  const focusedLineRef = useRef<HTMLButtonElement | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const [focusedSegmentId, setFocusedSegmentId] = useState(() =>
    getInitialFocusedSegmentId(transcriptSegments, clipStartSeconds, clipEndSeconds),
  );
  const {
    absolutePlayheadSeconds,
    activeCaptionCues,
    activeClipEndSeconds,
    activeClipStartSeconds,
    durationSeconds,
    isDraftDirty,
    seekToAbsolute,
    selectedSegmentIds,
    tags,
  } = useClipStudioTranscriptState(props);
  function getSegmentDisplayText(segment: TranscriptSegment): string {
    return (
      findCaptionCueForTranscriptSegment({
        activeClipEndSeconds,
        activeClipStartSeconds,
        captionCues: activeCaptionCues,
        segment,
      })?.text ?? segment.text
    );
  }

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
      transcriptSegments.find((segment) => segment.id === focusedSegmentId) ??
      currentSegment ??
      transcriptSegments.find((segment) => selectedSegmentIds.has(segment.id)) ??
      transcriptSegments[0] ??
      null,
    [currentSegment, focusedSegmentId, selectedSegmentIds, transcriptSegments],
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

  function previewSegment(segment: TranscriptSegment) {
    setFocusedSegmentId(segment.id);
    seekToAbsolute(segment.startTimeSeconds);
  }

  function dispatchTranscriptCommand(command: ClipStudioTranscriptCommand, segment?: TranscriptSegment) {
    if (segment) {
      previewSegment(segment);
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

  function dispatchTranscriptTextUpdate(segment: TranscriptSegment, text: string) {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, {
        detail: {
          command: "update-text",
          segmentId: segment.id,
          text,
        },
      }),
    );
  }

  return (
    <aside
      id="clip-studio-transcript"
      className="card clip-studio-transcript-rail stack-md"
      aria-label="Clip transcript editor"
      data-testid="clip-studio-transcript-panel"
      tabIndex={-1}
    >
      <div className="section-heading-row">
        <div>
          <p className="kicker">Clip transcript</p>
          <h2>On-video words</h2>
        </div>
        <StatusBadge tone={isDraftDirty ? "warning" : "success"}>
          {isDraftDirty ? "Unsaved draft" : "Saved settings"}
        </StatusBadge>
      </div>

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

      {focusedSegment ? (
        <div className="clip-studio-transcript-active" data-testid="clip-studio-transcript-active-line">
          <div>
            <span className="kicker">Selected line</span>
            <strong>
              {formatSecondsForPastorView(focusedSegment.startTimeSeconds)} - {formatSecondsForPastorView(focusedSegment.endTimeSeconds)}
            </strong>
            <label className="stack-sm clip-studio-transcript-word-editor">
              On-video words
              <textarea
                aria-label="Edit on-video words for the selected line"
                className="clip-studio-caption-textarea"
                value={getSegmentDisplayText(focusedSegment)}
                onChange={(event) => dispatchTranscriptTextUpdate(focusedSegment, event.target.value)}
              />
            </label>
          </div>
          <div className="clip-studio-transcript-actions" aria-label="Transcript line actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("set-start", focusedSegment)}
            >
              Set start
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("set-end", focusedSegment)}
            >
              Set end
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => previewSegment(focusedSegment)}
            >
              Preview line
            </button>
          </div>
          <div className="clip-studio-transcript-actions compact" aria-label="Transcript timing actions">
            {getSegmentDisplayText(focusedSegment).trim() !== focusedSegment.text.trim() ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => dispatchTranscriptCommand("reset-text", focusedSegment)}
              >
                Reset words
              </button>
            ) : null}
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatchTranscriptCommand("snap-to-sentence")}
            >
              Snap to Sentence
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

      <div ref={transcriptListRef} className="clip-studio-transcript-list" aria-label="Clip transcript lines">
        {transcriptSegments.length > 0 ? (
          transcriptSegments.map((segment, index) => {
            const isSelected = selectedSegmentIds.has(segment.id);
            const isCurrent = isTranscriptSegmentCurrent(
              segment,
              index,
              transcriptSegments,
              absolutePlayheadSeconds,
            );

            const displayText = getSegmentDisplayText(segment);

            return (
              <button
                key={segment.id}
                type="button"
                aria-label={`Preview transcript line at ${formatSecondsForPastorView(segment.startTimeSeconds)}: ${displayText}`}
                aria-pressed={focusedSegment?.id === segment.id}
                data-testid="clip-studio-transcript-line"
                data-transcript-segment-id={segment.id}
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
                {typeof segment.confidence === "number" && segment.confidence < 0.78 ? (
                  <small className="status-pill quality-needs-editing">Check wording</small>
                ) : null}
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
  const cleanupCutDragMovedRef = useRef(false);
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

  function dispatchLayerCommand(command: ClipStudioLayerCommand, cardId?: string) {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_LAYER_COMMAND_EVENT, {
        detail: { command, cardId },
      }),
    );
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

  function dispatchTimelineCommand(command: "snap-to-sentence" | "reset-ai") {
    window.dispatchEvent(
      new CustomEvent(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, {
        detail: { command },
      }),
    );
  }

  function onTimelineTrackClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input") || target.closest("[data-cleanup-cut-id]")) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const clickRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seekToAbsolute(timelineStart + clickRatio * timelineDuration);
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
    const earlierCuts = editableCleanupCuts.filter((item) => item.id !== cut.id && item.endSeconds <= cut.startSeconds);
    const laterCuts = editableCleanupCuts.filter((item) => item.id !== cut.id && item.startSeconds >= cut.endSeconds);
    const minStartSeconds = Math.max(0, ...earlierCuts.map((item) => item.endSeconds + CLEANUP_CUT_GAP_SECONDS));
    const maxEndSeconds = Math.min(durationSeconds, ...laterCuts.map((item) => item.startSeconds - CLEANUP_CUT_GAP_SECONDS));

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
  }, [durationSeconds, editableCleanupCuts]);

  function startCleanupCutDrag(
    event: PointerEvent<HTMLElement>,
    cut: SpeechCleanupEditableCut,
    mode: CleanupCutDragMode,
  ) {
    const track = event.currentTarget.closest(".clip-studio-timeline-track");
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

  return (
    <section className="card clip-studio-bottom-timeline stack-sm" aria-label="Clip timeline">
      <div className="clip-studio-edit-deck-head">
        <div>
          <p className="kicker">Timeline</p>
          <strong>{formatSecondsForPastorView(activeClipStartSeconds)} - {formatSecondsForPastorView(activeClipEndSeconds)}</strong>
        </div>
        <div className="clip-studio-edit-deck-meta">
          <span>AI start</span>
          <span>AI end</span>
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

      <div className="clip-studio-pacing-panel" aria-label="Pacing cleanup">
        <div className="clip-studio-pacing-summary">
          <div>
            <p className="kicker">Pacing cleanup</p>
            <strong>{cleanupSummaryTitle}</strong>
            <span>{cleanupSummaryMeta}</span>
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
          ) : cleanupPlan.enabled ? (
            <button type="button" className="button secondary" onClick={addCleanupCutAtPlayhead} disabled={!canAddCleanupCut}>
              Add pause at playhead
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

      <div className="clip-studio-layer-stack" aria-label="Edit layers">
        {timelineLayerRows.map((row) => (
          <div
            key={row.id}
            className={[
              "clip-studio-layer-row",
              row.enabled ? "is-enabled" : "is-disabled",
            ].join(" ")}
          >
            <div className="clip-studio-layer-label">
              <strong>{row.label}</strong>
              <span>{row.status}</span>
            </div>
            <div className="clip-studio-layer-track" aria-label={`${row.label} layer timeline`}>
              {row.segments.length > 0 ? (
                row.segments.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    className={`clip-studio-layer-segment is-${segment.tone}`}
                    style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                    title={segment.title}
                    aria-label={`Preview ${row.label} layer at ${formatSecondsForPastorView(segment.startSeconds)}`}
                    onClick={() => {
                      seekToAbsolute(segment.startSeconds);
                      requestPreviewPlayback();
                    }}
                  >
                    <span>{segment.label}</span>
                  </button>
                ))
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
      </div>

        <div
          className="clip-studio-timeline-track clip-studio-timeline-track-interactive"
          aria-label="Clip boundary timeline"
          onClick={onTimelineTrackClick}
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
                aria-label={`${range.enabled ? "Keep" : "Restore"} pause cleanup at ${formatSecondsForPastorView(cutStart)}`}
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
          <span className="clip-studio-timeline-playhead" style={{ left: `${playheadPercent}%` }} aria-hidden="true" />
          <span className="clip-studio-timeline-handle" style={{ left: `${selectedStartPercent}%` }} aria-hidden="true" />
          <span className="clip-studio-timeline-handle" style={{ left: `${selectedEndPercent}%` }} aria-hidden="true" />
          <input
            className="clip-studio-timeline-slider clip-studio-timeline-slider-start"
            type="range"
            min={timelineStart}
            max={timelineEnd}
            step={0.1}
            value={activeClipStartSeconds}
            onChange={(event) => dispatchTimelineBoundary("set-start-seconds", Number(event.target.value))}
            aria-label="Clip start handle"
          />
          <input
            className="clip-studio-timeline-slider clip-studio-timeline-slider-end"
            type="range"
            min={timelineStart}
            max={timelineEnd}
            step={0.1}
            value={activeClipEndSeconds}
            onChange={(event) => dispatchTimelineBoundary("set-end-seconds", Number(event.target.value))}
            aria-label="Clip end handle"
          />
        </div>

        {cleanupReviewOpen ? (
          <div className="clip-studio-cleanup-review" aria-label="Pause review">
            {editableCleanupCuts.length > 0 ? (
              <div className="clip-studio-cleanup-review-list">
                {editableCleanupCuts.map((cut, index) => {
                  const cutStart = activeClipStartSeconds + cut.startSeconds;
                  const cutEnd = activeClipStartSeconds + cut.endSeconds;
                  const cutRangeLabel = formatCleanupRangeLabel(cutStart, cutEnd);
                  const isSelected = selectedCleanupCut?.id === cut.id;

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
                          aria-label={`Delete pause ${index + 1}`}
                        >
                          Delete
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
                Add pause at playhead
              </button>
              <button type="button" className="button tertiary" onClick={resetCleanupCuts}>
                Reset cleanup
              </button>
            </div>
          </div>
        ) : null}

        <div className="clip-studio-transcript-strip" aria-label="Transcript timeline markers">
          <span className="clip-studio-transcript-playhead" style={{ left: `${playheadPercent}%` }} aria-hidden="true" />
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
                onClick={() => seekToAbsolute(segment.startTimeSeconds)}
                title={segment.text}
              >
                <span>{index + 1}</span>
              </button>
            );
          })}
        </div>

        <div className="clip-studio-timeline-labels muted small">
          <span>{formatSecondsForPastorView(timelineStart)}</span>
          <span>{previewClock.isPlaying ? "Playing" : "Ready"}</span>
          <span>{formatSecondsForPastorView(timelineEnd)}</span>
        </div>
    </section>
  );
}
