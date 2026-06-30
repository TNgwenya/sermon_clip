"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setClipReviewStatusAction } from "@/server/actions/sermons";

type ClipStudioDecisionBarProps = {
  clipId: string;
  currentStatus: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
};

export function ClipStudioDecisionBar({ clipId, currentStatus }: ClipStudioDecisionBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(true);
  const isLocked = currentStatus === "EXPORTED";

  function setStatus(status: "SUGGESTED" | "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const result = await setClipReviewStatusAction(clipId, status);
      setSuccess(result.success);
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className={`clip-studio-decision-bar${isLocked ? " is-locked" : ""}`}>
      <div>
        <p className="muted small">Review decision</p>
        <p className="clip-studio-decision-status">
          {isLocked ? "This clip is ready to post. Open Review to change its decision." : "Decide after watching the clip."}
        </p>
      </div>
      {isLocked ? null : (
        <div className="clip-studio-decision-actions">
          <button
            type="button"
            className="button primary"
            disabled={isPending || currentStatus === "APPROVED"}
            onClick={() => setStatus("APPROVED")}
          >
            {currentStatus === "APPROVED" ? "Approved" : "Approve"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={isPending || currentStatus === "SUGGESTED"}
            onClick={() => setStatus("SUGGESTED")}
          >
            Needs review
          </button>
          <button
            type="button"
            className="button tertiary"
            disabled={isPending || currentStatus === "REJECTED"}
            onClick={() => setStatus("REJECTED")}
          >
            Reject
          </button>
        </div>
      )}
      {message ? (
        <p className={success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
