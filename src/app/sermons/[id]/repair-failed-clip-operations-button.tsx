"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  repairFailedClipOperationsAction,
  type RepairFailedClipOperationsState,
} from "@/server/actions/sermons";

type RepairFailedClipOperationsButtonProps = {
  sermonId: string;
  disabled?: boolean;
};

const initialState: RepairFailedClipOperationsState = {
  success: true,
  message: "",
  previewPrepared: 0,
  previewFailed: 0,
  approvedPrepared: 0,
  approvedFailed: 0,
};

export function RepairFailedClipOperationsButton({
  sermonId,
  disabled = false,
}: RepairFailedClipOperationsButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<RepairFailedClipOperationsState>(initialState);

  function repairFailedClipOperations() {
    startTransition(async () => {
      const result = await repairFailedClipOperationsAction(sermonId);
      setState(result);
      router.refresh();
    });
  }

  return (
    <div className="stack-sm">
      <button
        type="button"
        className="button primary"
        onClick={repairFailedClipOperations}
        disabled={disabled || isPending}
      >
        {isPending ? "Repairing clips..." : "Fix failed clip operations"}
      </button>
      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
