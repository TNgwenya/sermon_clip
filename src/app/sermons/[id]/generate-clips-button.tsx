"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  generateClipSuggestionsAction,
  type GenerateClipSuggestionsFormState,
} from "@/server/actions/sermons";

type GenerateClipsButtonProps = {
  sermonId: string;
  status: string;
  hasTranscriptSegments: boolean;
};

const initialState: GenerateClipSuggestionsFormState = {
  success: false,
  message: "",
};

function SubmitButton({
  status,
  hasTranscriptSegments,
}: {
  status: string;
  hasTranscriptSegments: boolean;
}) {
  const { pending } = useFormStatus();
  const isGenerating = pending || status === "GENERATING_CLIPS";

  return (
    <button type="submit" className="button" disabled={isGenerating || !hasTranscriptSegments}>
      {isGenerating ? "Finding moments..." : "Find More Clip Moments"}
    </button>
  );
}

export function GenerateClipsButton({
  sermonId,
  status,
  hasTranscriptSegments,
}: GenerateClipsButtonProps) {
  const [state, action] = useActionState(generateClipSuggestionsAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton status={status} hasTranscriptSegments={hasTranscriptSegments} />
      {!hasTranscriptSegments ? (
        <p className="muted">A sermon transcript is needed before finding clip moments.</p>
      ) : null}
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
    </form>
  );
}
