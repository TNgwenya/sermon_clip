"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { processSermonAction, type ProcessSermonFormState } from "@/server/actions/sermons";

type ProcessSermonButtonProps = {
  sermonId: string;
};

const initialState: ProcessSermonFormState = {
  success: false,
  message: "",
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? "Finding clip moments..." : "Find Sermon Clips"}
    </button>
  );
}

export function ProcessSermonButton({ sermonId }: ProcessSermonButtonProps) {
  const [state, action] = useActionState(processSermonAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.message.length > 0) {
      router.refresh();
    }
  }, [router, state.message]);

  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="sermonId" value={sermonId} />
      <SubmitButton />
      <p className="muted">
        Finds the strongest moments in this sermon and prepares them for pastor review. You will approve clips before anything is made ready to post.
      </p>
      {state.message ? <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p> : null}
    </form>
  );
}
