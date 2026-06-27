"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { regenerateClipOutdatedAssetsAction } from "@/server/actions/sermons";

type ClipAssetRecoveryButtonProps = {
  clipId: string;
  label?: string;
  busyLabel?: string;
  variant?: "primary" | "secondary" | "tertiary";
  disabled?: boolean;
};

export function ClipAssetRecoveryButton({
  clipId,
  label = "Recover clip media",
  busyLabel = "Recovering media...",
  variant = "secondary",
  disabled = false,
}: ClipAssetRecoveryButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(true);

  function recoverClipMedia() {
    setMessage("");
    startTransition(async () => {
      const result = await regenerateClipOutdatedAssetsAction(clipId);
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
        onClick={recoverClipMedia}
        disabled={disabled || isPending}
      >
        {isPending ? busyLabel : label}
      </button>
      {message ? (
        <p className={success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
