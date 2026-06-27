"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  transcribeAudioAction,
  type TranscribeAudioFormState,
} from "@/server/actions/sermons";

type TranscribeSermonButtonProps = {
  sermonId: string;
  status: string;
  hasAudioFile: boolean;
};

const initialState: TranscribeAudioFormState = {
  success: false,
  message: "",
};

function SubmitButton({ status, hasAudioFile }: { status: string; hasAudioFile: boolean }) {
  const { pending } = useFormStatus();
  const isTranscribing = pending || status === "TRANSCRIBING";

  return (
    <button type="submit" className="button" disabled={isTranscribing || !hasAudioFile}>
      {isTranscribing ? "Transcribing..." : "Transcribe Sermon"}
    </button>
  );
}

export function TranscribeSermonButton({
  sermonId,
  status,
  hasAudioFile,
}: TranscribeSermonButtonProps) {
  const [state, action] = useActionState(transcribeAudioAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton status={status} hasAudioFile={hasAudioFile} />
      {!hasAudioFile ? (
        <p className="muted">Audio file is missing. Extract or restore audio.mp3 first.</p>
      ) : null}
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
    </form>
  );
}
