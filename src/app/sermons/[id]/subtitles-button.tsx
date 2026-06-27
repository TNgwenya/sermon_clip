"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  generateCaptionsForApprovedClipsAction,
  type SubtitleActionState,
} from "@/server/actions/sermons";

type SubtitlesButtonProps = {
  sermonId: string;
  hasApprovedClips: boolean;
};

const initialState: SubtitleActionState = {
  success: false,
  message: "",
};

function SubmitButton({ hasApprovedClips }: { hasApprovedClips: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button" disabled={pending || !hasApprovedClips}>
      {pending ? "Writing captions..." : "Write Captions for Approved Clips"}
    </button>
  );
}

export function SubtitlesButton({ sermonId, hasApprovedClips }: SubtitlesButtonProps) {
  const [state, action] = useActionState(generateCaptionsForApprovedClipsAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton hasApprovedClips={hasApprovedClips} />
      {!hasApprovedClips ? <p className="muted">Approve at least one clip before writing captions.</p> : null}
      {state.message ? <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p> : null}
    </form>
  );
}
