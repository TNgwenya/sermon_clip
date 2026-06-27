"use client";

import { useActionState } from "react";
import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  downloadVideoAction,
  type DownloadVideoFormState,
} from "@/server/actions/sermons";

type DownloadVideoButtonProps = {
  sermonId: string;
  status: string;
};

const initialState: DownloadVideoFormState = {
  success: false,
  message: "",
};

function SubmitButton({ status }: { status: string }) {
  const { pending } = useFormStatus();
  const isDownloading = pending || status === "DOWNLOADING";

  return (
    <button type="submit" className="button" disabled={isDownloading}>
      {isDownloading ? "Downloading..." : "Download Video"}
    </button>
  );
}

export function DownloadVideoButton({ sermonId, status }: DownloadVideoButtonProps) {
  const [state, action] = useActionState(downloadVideoAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton status={status} />
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
    </form>
  );
}
