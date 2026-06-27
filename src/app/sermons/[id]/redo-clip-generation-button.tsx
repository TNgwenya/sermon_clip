"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  redoClipGenerationFromTranscriptAction,
  type RedoClipGenerationFormState,
} from "@/server/actions/sermons";

type RedoClipGenerationButtonProps = {
  sermonId: string;
  hasTranscriptSegments: boolean;
  clipCount: number;
};

const initialState: RedoClipGenerationFormState = {
  success: false,
  message: "",
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
}: RedoClipGenerationButtonProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, action] = useActionState(redoClipGenerationFromTranscriptAction, initialState);
  const router = useRouter();

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
