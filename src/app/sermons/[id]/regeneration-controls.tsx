"use client";

import { useState, useTransition } from "react";

import {
  regenerateAllExportsAction,
  regenerateAllOutdatedAssetsAction,
  regenerateAllOutdatedCaptionsAction,
  type RegenerationBatchActionState,
} from "@/server/actions/sermons";

type RegenerationControlsProps = {
  sermonId: string;
};

const emptySummary: RegenerationBatchActionState = {
  success: true,
  message: "",
  attempted: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  failures: [],
};

export function RegenerationControls({ sermonId }: RegenerationControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<RegenerationBatchActionState>(emptySummary);

  function runBatch(
    action: (id: string) => Promise<RegenerationBatchActionState>,
  ) {
    startTransition(async () => {
      const result = await action(sermonId);
      setSummary(result);
    });
  }

  return (
    <div className="stack-sm">
      <p className="muted">
        Advanced recovery tools for clips that need to be prepared again. Other clips will continue even if one item fails.
      </p>
      <div className="actions-row">
        <button
          type="button"
          className="button secondary"
          onClick={() => runBatch(regenerateAllOutdatedAssetsAction)}
          disabled={isPending}
        >
          {isPending ? "Preparing..." : "Refresh Clips That Need Attention"}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => runBatch(regenerateAllOutdatedCaptionsAction)}
          disabled={isPending}
        >
          Refresh Captions
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => runBatch(regenerateAllExportsAction)}
          disabled={isPending}
        >
          Recreate Downloads
        </button>
      </div>

      {summary.message ? (
        <p className={summary.success ? "success-banner" : "error-banner"}>{summary.message}</p>
      ) : null}

      {summary.attempted > 0 ? (
        <p className="muted small">
          Checked: {summary.attempted} | Ready: {summary.completed} | Already okay: {summary.skipped} | Needs attention: {summary.failed}
        </p>
      ) : null}

      {summary.failures.length > 0 ? (
        <ul className="jobs-list">
          {summary.failures.slice(0, 10).map((failure, index) => (
            <li key={`${failure.clipId}-${failure.asset}-${index}`}>
              <strong>{failure.clipId}</strong> - {failure.asset} - {failure.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
