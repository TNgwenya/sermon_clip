"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  exportApprovedClipsAction,
  type ExportApprovedClipsFormState,
} from "@/server/actions/sermons";

type ExportClipsButtonProps = {
  sermonId: string;
  status: string;
  hasSourceVideo: boolean;
  hasApprovedClips: boolean;
};

const initialState: ExportApprovedClipsFormState = {
  success: false,
  message: "",
};

function SubmitButton({
  status,
  hasSourceVideo,
}: {
  status: string;
  hasSourceVideo: boolean;
}) {
  const { pending } = useFormStatus();
  const isExporting = pending || status === "EXPORTING";

  return (
    <button type="submit" className="button" disabled={isExporting || !hasSourceVideo}>
      {isExporting ? "Preparing downloads..." : "Prepare Approved Downloads"}
    </button>
  );
}

export function ExportClipsButton({
  sermonId,
  status,
  hasSourceVideo,
  hasApprovedClips,
}: ExportClipsButtonProps) {
  const [state, action] = useActionState(exportApprovedClipsAction, initialState);
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
      {!hasSourceVideo ? <p className="muted">Source video file is missing. Download or restore source.mp4 first.</p> : null}
      {hasSourceVideo && !hasApprovedClips ? <p className="muted">Approve at least one clip before preparing downloads.</p> : null}
      {state.message ? <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p> : null}
    </form>
  );
}
