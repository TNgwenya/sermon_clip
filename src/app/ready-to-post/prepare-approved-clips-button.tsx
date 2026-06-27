"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { prepareApprovedClipsAction } from "@/server/actions/sermons";

type PrepareApprovedClipsButtonProps = {
  sermonId: string;
  approvedCount: number;
  clipIds?: string[];
  variant?: "primary" | "secondary";
  actionLabel?: string;
};

export function PrepareApprovedClipsButton({
  sermonId,
  approvedCount,
  clipIds,
  variant = "primary",
  actionLabel,
}: PrepareApprovedClipsButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(true);

  function prepareApprovedClips() {
    setMessage("");
    startTransition(async () => {
      const result = await prepareApprovedClipsAction({ sermonId, clipIds });
      setSuccess(result.success);
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="ready-prepare-action">
      <button
        type="button"
        className={`button ${variant}`}
        onClick={prepareApprovedClips}
        disabled={isPending || approvedCount <= 0}
      >
        {isPending
          ? "Preparing clips..."
          : actionLabel
            ? actionLabel
            : clipIds?.length === 1
            ? "Prepare this clip"
            : `Prepare ${approvedCount} approved clip${approvedCount === 1 ? "" : "s"}`}
      </button>
      {message ? (
        <p className={success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
