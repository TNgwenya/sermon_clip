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
    return `${input.failedProcessingJobCount} failed pipeline job(s) can be retried. Start with Retry failed jobs, then rebuild posting clips.`;
  }

  if (input.failedMediaAssetCount > 0) {
    return `${input.failedMediaAssetCount} failed clip media asset(s) should be rebuilt before posting.`;
  }

  if (input.issueCount > 0) {
    return `${input.issueCount} ready-looking media file(s) are missing across ${input.affectedClipCount} clip(s) and ${input.affectedSermonCount} sermon(s).`;
  }

  if (input.outdatedAssetCount > 0) {
    return `${input.outdatedAssetCount} approved posting asset(s) are stale and should be rebuilt before posting.`;
  }

  if (input.draftIssueCount > 0) {
    return `${input.draftIssueCount} draft reference(s) can be repaired, but no posting-ready clips are blocked.`;
  }

  return "No broken local references were detected.";
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
      label: "Repair and rebuild all",
      busyLabel: "Repairing and rebuilding...",
      description: "Fix missing local media references, rebuild approved posting clips, and prepare scan-friendly posters.",
      disabled: totalIssueCount === 0 && missingPosterCount === 0 && failedOperationCount === 0 && outdatedAssetCount === 0,
      action: repairAndRebuildLibraryAction,
    },
    {
      label: "Fix missing files",
      busyLabel: "Repairing library...",
      description: "Stop clips from appearing ready when the rendered video, captions, branding, or export file is missing.",
      disabled: totalIssueCount === 0,
      action: repairLocalLibraryAction,
    },
    {
      label: "Retry failed jobs",
      busyLabel: "Retrying failed jobs...",
      description: "Retry failed sermon pipeline jobs such as download, transcription, and clip discovery.",
      disabled: failedProcessingJobCount === 0,
      action: retryLatestFailedProcessingJobsAction,
    },
    {
      label: "Rebuild posting clips",
      busyLabel: "Rebuilding clips...",
      description: "Regenerate failed or stale render, caption, branding, and export files for approved clips.",
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
          <h2>Recommended Recovery</h2>
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
