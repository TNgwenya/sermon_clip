"use client";

import { useMemo } from "react";

import { StatusBadge } from "@/components/ui";
import type { EditableCaptionCue } from "@/lib/clipStudioEditing";
import type { SpeechCleanupSettings } from "@/lib/clipStudio";
import { buildSpeechCleanupPreviewPlan } from "@/lib/clipStudioPreviewTimeline";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type TranscriptSegment = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function markerPercent(seconds: number, start: number, duration: number): number {
  return clampPercent(((seconds - start) / duration) * 100);
}

export function ClipStudioTranscriptPanel({
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
  const { previewClock, seekPreviewTo } = useClipStudioPreview();
  const durationSeconds = Math.max(0.1, clipDurationSeconds ?? clipEndSeconds - clipStartSeconds);
  const timelineStart = Math.max(0, Math.min(clipStartSeconds, transcriptSegments[0]?.startTimeSeconds ?? clipStartSeconds));
  const timelineEnd = Math.max(
    timelineStart + 1,
    Math.max(clipEndSeconds, transcriptSegments.at(-1)?.endTimeSeconds ?? clipEndSeconds),
  );
  const timelineDuration = timelineEnd - timelineStart;
  const absolutePlayheadSeconds = clipStartSeconds + previewClock.currentSeconds;
  const playheadPercent = markerPercent(absolutePlayheadSeconds, timelineStart, timelineDuration);
  const selectedStartPercent = markerPercent(clipStartSeconds, timelineStart, timelineDuration);
  const selectedEndPercent = markerPercent(clipEndSeconds, timelineStart, timelineDuration);
  const selectedWidthPercent = Math.max(0.8, selectedEndPercent - selectedStartPercent);

  const cleanupPlan = useMemo(
    () =>
      buildSpeechCleanupPreviewPlan({
        captionCues,
        durationSeconds,
        speechCleanup,
      }),
    [captionCues, durationSeconds, speechCleanup],
  );
  const removedSeconds = cleanupPlan.cuts.reduce((total, cut) => total + cut.removedSeconds, 0);

  const selectedSegmentIds = useMemo(() => {
    const ids = new Set<string>();
    transcriptSegments.forEach((segment) => {
      if (segment.endTimeSeconds > clipStartSeconds && segment.startTimeSeconds < clipEndSeconds) {
        ids.add(segment.id);
      }
    });
    return ids;
  }, [clipEndSeconds, clipStartSeconds, transcriptSegments]);

  const tags = [
    momentType ? momentType.replace(/_/g, " ").toLowerCase() : null,
    smartClipCategory,
    momentTitle,
  ].filter((tag): tag is string => Boolean(tag && tag.trim()));

  function seekToAbsolute(seconds: number) {
    seekPreviewTo(Math.max(0, seconds - clipStartSeconds));
  }

  return (
    <>
      <aside className="card clip-studio-transcript-rail stack-md" aria-label="Transcript editor">
        <div className="section-heading-row">
          <div>
            <p className="kicker">Transcript editor</p>
            <h2>Sermon text</h2>
          </div>
          <StatusBadge tone="success">Preview updated</StatusBadge>
        </div>

        <div className="clip-studio-transcript-range">
          <article>
            <span className="kicker">In</span>
            <strong>{formatSecondsForPastorView(clipStartSeconds)}</strong>
          </article>
          <article>
            <span className="kicker">Out</span>
            <strong>{formatSecondsForPastorView(clipEndSeconds)}</strong>
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

        <div className="clip-studio-transcript-list" aria-label="Clickable transcript lines">
          {transcriptSegments.length > 0 ? (
            transcriptSegments.map((segment) => {
              const isSelected = selectedSegmentIds.has(segment.id);
              const isCurrent =
                absolutePlayheadSeconds >= segment.startTimeSeconds &&
                absolutePlayheadSeconds <= segment.endTimeSeconds;

              return (
                <button
                  key={segment.id}
                  type="button"
                  className={[
                    "clip-studio-transcript-line",
                    isSelected ? "is-selected" : "",
                    isCurrent ? "is-current" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => seekToAbsolute(segment.startTimeSeconds)}
                >
                  <span>{formatSecondsForPastorView(segment.startTimeSeconds)}</span>
                  <strong>{segment.text}</strong>
                </button>
              );
            })
          ) : (
            <p className="muted">Transcript lines are not available for this clip yet.</p>
          )}
        </div>
      </aside>

      <section className="card clip-studio-bottom-timeline stack-sm" aria-label="Clip timeline">
        <div className="clip-studio-edit-deck-head">
          <div>
            <p className="kicker">Timeline</p>
            <strong>{formatSecondsForPastorView(clipStartSeconds)} - {formatSecondsForPastorView(clipEndSeconds)}</strong>
          </div>
          <div className="clip-studio-edit-deck-meta">
            <span>AI start</span>
            <span>AI end</span>
            <span>{cleanupPlan.enabled ? `${formatSecondsForPastorView(removedSeconds)} saved` : "Natural pauses"}</span>
          </div>
        </div>

        <div className="clip-studio-timeline-track clip-studio-timeline-track-interactive">
          <span
            className="clip-studio-timeline-selection"
            style={{ left: `${selectedStartPercent}%`, width: `${selectedWidthPercent}%` }}
          />
          <span className="clip-studio-timeline-ai-marker" style={{ left: `${selectedStartPercent}%` }} title="AI start" />
          <span className="clip-studio-timeline-ai-marker" style={{ left: `${selectedEndPercent}%` }} title="AI end" />
          {cleanupPlan.cuts.map((cut, index) => {
            const cutStart = clipStartSeconds + cut.startSeconds;
            const cutEnd = clipStartSeconds + cut.endSeconds;
            const left = markerPercent(cutStart, timelineStart, timelineDuration);
            const width = Math.max(0.6, markerPercent(cutEnd, timelineStart, timelineDuration) - left);

            return (
              <span
                key={`${cut.startSeconds}-${cut.endSeconds}-${index}`}
                className="clip-studio-timeline-dead-air"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${formatSecondsForPastorView(cut.removedSeconds)} removed`}
              />
            );
          })}
          <span className="clip-studio-timeline-playhead" style={{ left: `${playheadPercent}%` }} aria-hidden="true" />
        </div>

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
    </>
  );
}
