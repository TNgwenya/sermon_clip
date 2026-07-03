"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  deleteSermonProjectAction,
  type DeleteSermonProjectState,
} from "@/server/actions/sermons";

type DeleteSermonProjectButtonProps = {
  sermonId: string;
  sermonTitle: string;
};

export function DeleteSermonProjectButton({
  sermonId,
  sermonTitle,
}: DeleteSermonProjectButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [result, setResult] = useState<DeleteSermonProjectState | null>(null);
  const canDelete = confirmationTitle.trim() === sermonTitle.trim();

  function closeConfirmation() {
    if (isPending) {
      return;
    }

    setIsConfirming(false);
    setConfirmationTitle("");
    setResult(null);
  }

  function deleteProject() {
    if (!canDelete || isPending) {
      return;
    }

    setResult(null);
    startTransition(async () => {
      const nextResult = await deleteSermonProjectAction({
        sermonId,
        confirmationTitle,
      });
      setResult(nextResult);

      if (nextResult.success) {
        setIsConfirming(false);
        setConfirmationTitle("");
        router.refresh();
      }
    });
  }

  return (
    <div className="library-delete-control">
      <button
        type="button"
        className="button danger library-delete-trigger"
        onClick={() => {
          setIsConfirming(true);
          setResult(null);
        }}
        disabled={isPending}
      >
        Delete
      </button>

      {isConfirming ? (
        <div className="library-delete-confirm" role="dialog" aria-label={`Delete ${sermonTitle}`}>
          <div className="stack-xs">
            <strong>Delete project?</strong>
            <p className="muted small">This removes the sermon, clips, drafts, and local media files.</p>
          </div>
          <label className="library-delete-confirm-field">
            <span>Type the project title</span>
            <input
              type="text"
              value={confirmationTitle}
              onChange={(event) => setConfirmationTitle(event.target.value)}
              placeholder={sermonTitle}
              disabled={isPending}
            />
          </label>
          <div className="library-delete-actions">
            <button
              type="button"
              className="button danger"
              onClick={deleteProject}
              disabled={!canDelete || isPending}
            >
              {isPending ? "Deleting..." : "Delete project"}
            </button>
            <button type="button" className="button secondary" onClick={closeConfirmation} disabled={isPending}>
              Cancel
            </button>
          </div>
          {result ? (
            <p className={result.success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {result.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
