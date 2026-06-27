"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  extractAudioAction,
  type ExtractAudioFormState,
} from "@/server/actions/sermons";

type ExtractAudioButtonProps = {
  sermonId: string;
  status: string;
  hasSourceVideo: boolean;
};

const initialState: ExtractAudioFormState = {
  success: false,
  message: "",
};

function SubmitButton({ status, hasSourceVideo }: { status: string; hasSourceVideo: boolean }) {
  const { pending } = useFormStatus();
  const isExtracting = pending || status === "AUDIO_EXTRACTING";

  return (
    <button type="submit" className="button" disabled={isExtracting || !hasSourceVideo}>
      {isExtracting ? "Extracting..." : "Extract Audio"}
    </button>
  );
}

export function ExtractAudioButton({
  sermonId,
  status,
  hasSourceVideo,
}: ExtractAudioButtonProps) {
  const [state, action] = useActionState(extractAudioAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton status={status} hasSourceVideo={hasSourceVideo} />
      {!hasSourceVideo ? (
        <p className="muted">Source video file is missing. Download or restore source.mp4 first.</p>
      ) : null}
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
    </form>
  );
}
