"use client";

import { useState, useTransition } from "react";

import {
  prepareMissingPostersAction,
  repairAndRebuildLibraryAction,
  rebuildPriorityLibraryAssetsAction,
  repairLocalLibraryAction,
  retryLatestFailedProcessingJobsAction,
  type HealthActionResult,
} from "@/app/health/actions";

type HealthRecoveryPanelProps = {
  issueCount: number;
  affectedClipCount: number;
  affectedSermonCount: number;
  draftIssueCount: number;
  totalIssueCount: number;
  missingPosterCount: number;
  failedOperationCount: number;
  failedProcessingJobCount: number;
  failedMediaAssetCount: number;
  outdatedAssetCount: number;
};

type RecoveryAction = {
  label: string;
  busyLabel: string;
  description: string;
  disabled?: boolean;
  action: () => Promise<HealthActionResult>;
};

function buildRecoveryMessage(input: {
  failedProcessingJobCount: number;
  failedMediaAssetCount: number;
  issueCount: number;
  affectedClipCount: number;
  affectedSermonCount: number;
  outdatedAssetCount: number;
  draftIssueCount: number;
}): string {
  if (input.failedProcessingJobCount > 0) {
    return `${input.failedProcessingJobCount} sermon processing ${input.failedProcessingJobCount === 1 ? "step can" : "steps can"} be retried. Start with Retry sermon steps, then refresh prepared clips.`;
  }

  if (input.failedMediaAssetCount > 0) {
    return `${input.failedMediaAssetCount} clip ${input.failedMediaAssetCount === 1 ? "file needs" : "files need"} to be refreshed before posting.`;
  }

  if (input.issueCount > 0) {
    return `${input.issueCount} ${input.issueCount === 1 ? "item is" : "items are"} marked ready but missing a usable file across ${input.affectedClipCount} ${input.affectedClipCount === 1 ? "clip" : "clips"}.`;
  }

  if (input.outdatedAssetCount > 0) {
    return `${input.outdatedAssetCount} approved ${input.outdatedAssetCount === 1 ? "clip needs" : "clips need"} a fresh final file before posting.`;
  }

  if (input.draftIssueCount > 0) {
    return `${input.draftIssueCount} draft reference(s) can be repaired, but no posting-ready clips are blocked.`;
  }

  return "Everything needed for the current sermon and clip files looks ready.";
}

export function HealthRecoveryPanel({
  issueCount,
  affectedClipCount,
  affectedSermonCount,
  draftIssueCount,
  totalIssueCount,
  missingPosterCount,
  failedOperationCount,
  failedProcessingJobCount,
  failedMediaAssetCount,
  outdatedAssetCount,
}: HealthRecoveryPanelProps) {
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [result, setResult] = useState<HealthActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const recoveryMessage = buildRecoveryMessage({
    failedProcessingJobCount,
    failedMediaAssetCount,
    issueCount,
    affectedClipCount,
    affectedSermonCount,
    outdatedAssetCount,
    draftIssueCount,
  });

  const actions: RecoveryAction[] = [
    {
      label: "Fix everything listed",
      busyLabel: "Fixing listed items...",
      description: "Restore missing clip files, refresh approved posts, and create preview images in one step.",
      disabled: totalIssueCount === 0 && missingPosterCount === 0 && failedOperationCount === 0 && outdatedAssetCount === 0,
      action: repairAndRebuildLibraryAction,
    },
    {
      label: "Fix missing files",
      busyLabel: "Repairing library...",
      description: "Correct clips that appear ready even though their final video, captions, branding, or download is missing.",
      disabled: totalIssueCount === 0,
      action: repairLocalLibraryAction,
    },
    {
      label: "Retry sermon steps",
      busyLabel: "Retrying sermon steps...",
      description: "Try unfinished sermon downloads, transcripts, and clip discovery again.",
      disabled: failedProcessingJobCount === 0,
      action: retryLatestFailedProcessingJobsAction,
    },
    {
      label: "Refresh prepared clips",
      busyLabel: "Refreshing prepared clips...",
      description: "Create fresh final videos, captions, branding, and downloads for approved clips.",
      disabled: failedMediaAssetCount === 0 && outdatedAssetCount === 0,
      action: rebuildPriorityLibraryAssetsAction,
    },
    {
      label: "Prepare clip posters",
      busyLabel: "Preparing posters...",
      description: "Create preview posters so the library and review screens are easier to scan.",
      disabled: missingPosterCount === 0,
      action: prepareMissingPostersAction,
    },
  ];

  function run(action: RecoveryAction) {
    setPendingLabel(action.label);
    setResult(null);
    startTransition(async () => {
      const actionResult = await action.action();
      setResult(actionResult);
      setPendingLabel(null);
    });
  }

  return (
    <section className="card stack-sm">
      <div className="health-recovery-row">
        <div>
          <h2>Recommended next steps</h2>
          <p className="muted">{recoveryMessage}</p>
        </div>
      </div>

      <div className="jobs-list">
        {actions.map((item) => {
          const pending = isPending && pendingLabel === item.label;
          return (
            <article key={item.label} className="stack-sm">
              <div className="health-recovery-row">
                <div>
                  <strong>{item.label}</strong>
                  <p className="muted small">{item.description}</p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => run(item)}
                  disabled={isPending || item.disabled}
                >
                  {pending ? item.busyLabel : item.label}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {result ? (
        <p className={result.success ? "success-banner" : "error-banner"}>{result.message}</p>
      ) : null}
    </section>
  );
}
