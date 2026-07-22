"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  redoClipGenerationFromTranscriptAction,
  type RedoClipGenerationFormState,
} from "@/server/actions/sermons";
import {
  formatSecondsForPastorView,
  formatSecondsForTimestampInput,
} from "@/lib/sermonSegment";

type RedoClipGenerationButtonProps = {
  sermonId: string;
  hasTranscriptSegments: boolean;
  clipCount: number;
  defaultStartSeconds?: number | null;
  defaultEndSeconds?: number | null;
  durationSeconds?: number | null;
};

type RedoClipGenerationRangeFieldErrors = {
  sermonStartTimestamp?: string;
  sermonEndTimestamp?: string;
};

const initialState: RedoClipGenerationFormState = {
  success: false,
  message: "",
};

function formatOptionalTimestamp(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "";
  }

  return formatSecondsForTimestampInput(seconds);
}

function formatSourceDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return formatSecondsForPastorView(seconds);
}

export const __redoClipGenerationButtonTestUtils = {
  formatOptionalTimestamp,
  formatSourceDuration,
};

function SubmitButton({
  confirmed,
  disabled,
}: {
  confirmed: boolean;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button danger" disabled={pending || disabled || !confirmed}>
      {pending ? "Redoing clips..." : "Redo clips from transcript"}
    </button>
  );
}

export function RedoClipGenerationButton({
  sermonId,
  hasTranscriptSegments,
  clipCount,
  defaultStartSeconds = null,
  defaultEndSeconds = null,
  durationSeconds = null,
}: RedoClipGenerationButtonProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [startTimestamp, setStartTimestamp] = useState(() => formatOptionalTimestamp(defaultStartSeconds));
  const [endTimestamp, setEndTimestamp] = useState(() => formatOptionalTimestamp(defaultEndSeconds));
  const [state, action] = useActionState(redoClipGenerationFromTranscriptAction, initialState);
  const router = useRouter();
  const sourceDuration = formatSourceDuration(durationSeconds);
  const rangeFieldErrors = (state as RedoClipGenerationFormState & {
    fieldErrors?: RedoClipGenerationRangeFieldErrors;
  }).fieldErrors;

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="redo-clip-panel stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <input type="hidden" name="confirmation" value={confirmed ? "redo-clips" : ""} />
      <div className="stack-sm">
        <p className="kicker">Redo from transcript</p>
        <h3>Restart clip discovery</h3>
        <p className="muted small">
          Deletes {clipCount} generated clip{clipCount === 1 ? "" : "s"}, clears clip media/cache files, removes stale posting handoffs, then finds new clips from the existing transcript. The original video, audio, and transcript stay in place.
        </p>
      </div>
      <section className="redo-range-panel stack-sm" aria-labelledby="redo-range-heading">
        <div className="stack-xs">
          <h4 id="redo-range-heading">Choose where to search for clips</h4>
          <p id="redo-range-timeline-help" className="muted small">
            Times use the original source video timeline
            {sourceDuration ? ` (video length: ${sourceDuration})` : ""}. The video and transcript are not trimmed.
          </p>
        </div>
        <fieldset className="redo-range-fieldset" disabled={!hasTranscriptSegments}>
          <legend className="sr-only">Optional source video range</legend>
          <div className="review-edit-grid redo-range-grid">
            <div className="stack-xs">
              <label htmlFor="redoSermonStartTimestamp">
                Start at <span className="field-optional">Optional</span>
              </label>
              <input
                id="redoSermonStartTimestamp"
                name="sermonStartTimestamp"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={12}
                placeholder="Example: 20:00"
                value={startTimestamp}
                onChange={(event) => setStartTimestamp(event.target.value)}
                aria-describedby="redo-range-timeline-help redo-range-start-help"
                aria-invalid={Boolean(rangeFieldErrors?.sermonStartTimestamp)}
              />
              <p id="redo-range-start-help" className="muted small">
                Use <span className="code-text">MM:SS</span> or <span className="code-text">H:MM:SS</span>. Leave blank to start at the beginning of the transcript.
              </p>
              {rangeFieldErrors?.sermonStartTimestamp ? (
                <p className="field-error">{rangeFieldErrors.sermonStartTimestamp}</p>
              ) : null}
            </div>
            <div className="stack-xs">
              <label htmlFor="redoSermonEndTimestamp">
                End at <span className="field-optional">Optional</span>
              </label>
              <input
                id="redoSermonEndTimestamp"
                name="sermonEndTimestamp"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={12}
                placeholder={sourceDuration ? `Up to ${sourceDuration}` : "Example: 1:00:00"}
                value={endTimestamp}
                onChange={(event) => setEndTimestamp(event.target.value)}
                aria-describedby="redo-range-timeline-help redo-range-end-help"
                aria-invalid={Boolean(rangeFieldErrors?.sermonEndTimestamp)}
              />
              <p id="redo-range-end-help" className="muted small">
                Leave blank to search through the end of the transcript.
              </p>
              {rangeFieldErrors?.sermonEndTimestamp ? (
                <p className="field-error">{rangeFieldErrors.sermonEndTimestamp}</p>
              ) : null}
            </div>
          </div>
        </fieldset>
      </section>
      <label className="review-checkbox-row redo-confirm-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={!hasTranscriptSegments}
        />
        <span>I understand this removes existing suggested, approved, and ready-to-post clips for this sermon.</span>
      </label>
      <SubmitButton confirmed={confirmed} disabled={!hasTranscriptSegments} />
      {!hasTranscriptSegments ? (
        <p className="muted small">A completed transcript is required before this redo can run.</p>
      ) : null}
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
      {state.deletedClips !== undefined ? (
        <p className="muted small">
          Deleted: {state.deletedClips} clips | New: {state.generatedClips ?? 0} | Drafts cleared: {state.clearedDrafts ?? 0} | Scheduled posts cleared: {state.clearedScheduledPosts ?? 0}
        </p>
      ) : null}
    </form>
  );
}
