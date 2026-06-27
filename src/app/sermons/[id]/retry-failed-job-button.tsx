"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  retryFailedProcessingJobAction,
  type RetryFailedJobFormState,
} from "@/server/actions/sermons";

type RetryFailedJobButtonProps = {
  sermonId: string;
  jobId: string;
};

const initialState: RetryFailedJobFormState = {
  success: false,
  message: "",
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button primary" disabled={pending}>
      {pending ? "Retrying..." : "Retry step"}
    </button>
  );
}

export function RetryFailedJobButton({ sermonId, jobId }: RetryFailedJobButtonProps) {
  const [state, action] = useActionState(retryFailedProcessingJobAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton />
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
      ) : null}
    </form>
  );
}
