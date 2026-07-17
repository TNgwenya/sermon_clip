import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { prisma } from "@/lib/prisma";
import {
  ensureLocalStorageDirs,
  ensureSermonFolders,
  getSermonStoragePath,
  getStorageRoot,
} from "@/server/agents/storage";
import { getClipThumbnailReadiness, type ClipThumbnailReadiness } from "@/server/agents/clipThumbnailService";
import { checkYtDlpInstalled } from "@/server/agents/videoDownloadAgent";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import { getDataConsistencySummary, getOperationalMetrics } from "@/server/workflow/operationsDiagnostics";
import { HealthRecoveryPanel } from "@/app/health/health-recovery-panel";
import { buildWorkspaceHealthIssueBreakdown } from "@/lib/healthRecovery";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";

export const dynamic = "force-dynamic";

type HealthStatus = "OK" | "Missing" | "Failed";

type HealthCheckResult = {
  name: string;
  status: HealthStatus;
  message: string;
  fix?: string;
};

function statusClass(status: HealthStatus): string {
  if (status === "OK") {
    return "status-approved";
  }

  if (status === "Missing") {
    return "status-rejected";
  }

  return "risk-high";
}

async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const checks: HealthCheckResult[] = [];
  const localMediaAvailable = canRunLocalMediaProcessing();

  checks.push({
    name: "Node app",
    status: "OK",
    message: "Next.js app is serving this health page.",
  });

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.push({
      name: "Database connection",
      status: "OK",
      message: "Database connection is healthy.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error.";
    checks.push({
      name: "Database connection",
      status: "Failed",
      message,
      fix: "Set DATABASE_URL to Neon/Postgres, then run npx prisma generate && npx prisma db push",
    });
  }

  checks.push({
    name: "Prisma client",
    status: typeof prisma.$connect === "function" ? "OK" : "Failed",
    message:
      typeof prisma.$connect === "function"
        ? "Prisma client is initialized."
        : "Prisma client initialization failed.",
    fix: typeof prisma.$connect === "function" ? undefined : "npx prisma generate",
  });

  const storageRoot = getStorageRoot();

  if (!localMediaAvailable) {
    checks.push({
      name: "Local media worker",
      status: "Missing",
      message: "This deployment is web-only. Run media checks from the local Mac app or worker.",
      fix: "Run the local app or worker on your laptop for ffmpeg, yt-dlp, storage, and clip rendering.",
    });
  } else {
    try {
      await access(storageRoot);
      checks.push({
        name: "Storage root exists",
        status: "OK",
        message: `Storage root is available at ${storageRoot}.`,
      });
    } catch {
      checks.push({
        name: "Storage root exists",
        status: "Missing",
        message: `Storage root is missing at ${storageRoot}.`,
        fix: "mkdir -p storage/sermons",
      });
    }

    const writeProbePath = path.join(storageRoot, ".health-write-test");
    try {
      await mkdir(storageRoot, { recursive: true });
      await writeFile(writeProbePath, "ok", "utf8");
      await rm(writeProbePath, { force: true });

      checks.push({
        name: "Storage root writable",
        status: "OK",
        message: "Storage root accepts write operations.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown storage write error.";
      checks.push({
        name: "Storage root writable",
        status: "Failed",
        message,
        fix: "chmod -R u+rw storage",
      });
    }

    const ffmpegInstalled = await checkFfmpegInstalled();
    checks.push({
      name: "FFmpeg",
      status: ffmpegInstalled ? "OK" : "Missing",
      message: ffmpegInstalled ? "FFmpeg is installed." : "FFmpeg command not found.",
      fix: ffmpegInstalled ? undefined : "brew install ffmpeg",
    });

    const healthSermonId = `health-${Date.now()}`;
    const healthSermonPath = getSermonStoragePath(healthSermonId);
    try {
      await ensureLocalStorageDirs();
      await ensureSermonFolders(healthSermonId);
      await rm(healthSermonPath, { recursive: true, force: true });

      checks.push({
        name: "Sermon folder creation",
        status: "OK",
        message: "Per-sermon local folders can be created and cleaned up.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown folder creation error.";
      checks.push({
        name: "Sermon folder creation",
        status: "Failed",
        message,
        fix: "mkdir -p storage/sermons && chmod -R u+rw storage",
      });
    }

    try {
      await checkYtDlpInstalled();
      checks.push({
        name: "yt-dlp",
        status: "OK",
        message: "yt-dlp is installed.",
      });
    } catch {
      checks.push({
        name: "yt-dlp",
        status: "Missing",
        message: "yt-dlp command not found.",
        fix: "brew install yt-dlp",
      });
    }
  }

  const apiKeyExists = Boolean(process.env.OPENAI_API_KEY?.trim());
  checks.push({
    name: "OPENAI_API_KEY",
    status: apiKeyExists ? "OK" : "Missing",
    message: apiKeyExists ? "OPENAI_API_KEY is configured." : "OPENAI_API_KEY is not set.",
    fix: apiKeyExists ? undefined : "Add OPENAI_API_KEY to .env",
  });

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const isPostgresUrl = databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
  checks.push({
    name: "Configured metadata database",
    status: isPostgresUrl ? "OK" : "Failed",
    message: isPostgresUrl
      ? "DATABASE_URL is configured for Postgres/Neon metadata storage."
      : "DATABASE_URL must point to Postgres/Neon for posting automation.",
    fix: isPostgresUrl ? undefined : "Set DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require",
  });

  return checks;
}

async function getHealthThumbnailReadiness(): Promise<ClipThumbnailReadiness> {
  if (!canRunLocalMediaProcessing()) {
    return {
      preparedClipCount: 0,
      readyPosterCount: 0,
      optimizedPosterCount: 0,
      missingPosterCount: 0,
      failedPosterCount: 0,
    };
  }

  return getClipThumbnailReadiness();
}

export default async function HealthPage() {
  const [environmentChecks, consistency, thumbnailReadiness, operationalMetrics, publishingServiceHealth] = await Promise.all([
    runHealthChecks(),
    getDataConsistencySummary(),
    getHealthThumbnailReadiness(),
    getOperationalMetrics(),
    getPublishingServiceHealth(),
  ]);
  const publishingWorkerCheck: HealthCheckResult = publishingServiceHealth.status === "ONLINE"
    ? {
      name: "Automatic publishing worker",
      status: "OK",
      message: publishingServiceHealth.dryRun
        ? "The publishing worker is checking in and is safely running in test mode."
        : "The publishing worker is online and checking the posting queue.",
    }
    : publishingServiceHealth.status === "STALE"
      ? {
        name: "Automatic publishing worker",
        status: "Missing",
        message: `The publishing worker is stale${publishingServiceHealth.ageSeconds === null ? "" : `; its last signal was ${Math.max(1, Math.round(publishingServiceHealth.ageSeconds / 60))} minutes ago`}. Scheduled automatic posts will remain queued.`,
        fix: "Run npm run worker:posting and confirm a fresh heartbeat before relying on automatic publishing.",
      }
      : {
        name: "Automatic publishing worker",
        status: "Missing",
        message: "No publishing worker heartbeat has been recorded. Scheduled automatic posts will remain queued.",
        fix: "Run npm run worker:posting and confirm a heartbeat before relying on automatic publishing.",
      };
  const operationalWorkflowCheck: HealthCheckResult = operationalMetrics.failedOperations > 0
    ? {
      name: "Processing and media jobs",
      status: "Failed",
      message: `${operationalMetrics.failedProcessingJobs} failed processing ${operationalMetrics.failedProcessingJobs === 1 ? "job" : "jobs"} and ${operationalMetrics.failedClipAssets} failed media ${operationalMetrics.failedClipAssets === 1 ? "asset" : "assets"} need review.`,
      fix: "Use Recommended Recovery below to retry or repair the affected work.",
    }
    : {
      name: "Processing and media jobs",
      status: "OK",
      message: "No unresolved processing-job or prepared-media failures were detected.",
    };
  const checks = [...environmentChecks, publishingWorkerCheck, operationalWorkflowCheck];
  const okCount = checks.filter((check) => check.status === "OK").length;
  const healthBreakdown = buildWorkspaceHealthIssueBreakdown({
    failedHealthChecks:
      environmentChecks.filter((check) => check.status !== "OK").length
      + (publishingWorkerCheck.status === "OK" ? 0 : 1),
    missingReadyFiles: consistency.issueCount,
    failedOperations: operationalMetrics.failedOperations,
    outdatedAssets: operationalMetrics.outdatedAssets,
    missingPosters: thumbnailReadiness.missingPosterCount,
    failedPosters: thumbnailReadiness.failedPosterCount,
  });
  const canProcessSermons = environmentChecks.every((check) => check.status === "OK");
  const postingNeedsRecovery =
    healthBreakdown.postingBlockers +
    healthBreakdown.retryableFailures +
    healthBreakdown.assetRegeneration > 0
    || publishingServiceHealth.status !== "ONLINE";
  const workspaceNeedsAttention = healthBreakdown.actionRequired > 0;

  return (
    <main className="secondary-media-shell stack-lg">
      <header className="page-header stack-sm">
        <p className="kicker">Workspace Readiness</p>
        <h1>{workspaceNeedsAttention ? "Workspace needs attention" : "Sermon Clip is operational"}</h1>
        <p className="muted">
          Video tools, storage, AI, clip media, and the publishing worker are checked together. {okCount}/{checks.length} system checks are passing; {healthBreakdown.actionRequired} issue{healthBreakdown.actionRequired === 1 ? "" : "s"} currently require action.
        </p>
        <div className="page-header-actions">
          <Link href="/" className="button secondary">Dashboard</Link>
          <Link href="/sermons/new" className="button primary">Add sermon</Link>
          <Link href="/ready-to-post" className="button tertiary">Ready queue</Link>
        </div>
      </header>

      {workspaceNeedsAttention ? (
        <div className="error-banner stack-sm" role="status">
          <strong>The workspace is not fully healthy yet.</strong>
          <span>
            {operationalMetrics.failedProcessingJobs > 0
              ? `${operationalMetrics.failedProcessingJobs} failed processing ${operationalMetrics.failedProcessingJobs === 1 ? "job needs" : "jobs need"} review. `
              : ""}
            {publishingServiceHealth.status !== "ONLINE"
              ? "Automatic publishing is paused until the posting worker sends a fresh heartbeat."
              : "Review the recovery items below."}
          </span>
        </div>
      ) : null}

      <section className="secondary-command-strip">
        <article>
          <span className="muted small">Overall workspace</span>
          <strong>{workspaceNeedsAttention ? "Needs attention" : "Ready"}</strong>
          <span className="muted small">{okCount}/{checks.length} system checks passing</span>
        </article>
        <article>
          <span className="muted small">New sermons</span>
          <strong>{canProcessSermons ? "Ready" : "Blocked"}</strong>
          <span className="muted small">{healthBreakdown.environmentBlockers} environment blocker(s)</span>
        </article>
        <article>
          <span className="muted small">Posting recovery</span>
          <strong>{postingNeedsRecovery ? healthBreakdown.actionRequired : "Ready"}</strong>
          <span className="muted small">
            {publishingServiceHealth.status === "ONLINE"
              ? `${operationalMetrics.failedClipAssets} failed media asset(s)`
              : "Publishing worker offline or stale"}
          </span>
        </article>
        <article>
          <span className="muted small">Failed jobs needing retry</span>
          <strong>{operationalMetrics.failedProcessingJobs}</strong>
          <span className="muted small">Pipeline jobs and media preparation</span>
        </article>
        <article>
          <span className="muted small">Poster cleanup</span>
          <strong>{healthBreakdown.optionalCleanup}</strong>
          <span className="muted small">{thumbnailReadiness.readyPosterCount}/{thumbnailReadiness.preparedClipCount} ready</span>
        </article>
      </section>

      <section className="card stack-sm">
        <h2>System checks</h2>
        <ul className="jobs-list">
          {checks.map((check) => (
            <li key={check.name} className="stack-sm">
              <p>
                <strong>{check.name}</strong> {" "}
                <span className={`status-pill ${statusClass(check.status)}`}>{check.status}</span>
              </p>
              <p className="muted">{check.message}</p>
              {check.fix ? (
                <p>
                  <strong>Suggested fix:</strong> <code>{check.fix}</code>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack-sm">
        <h2>Clip Poster Readiness</h2>
        <p className="muted">
          Posters help pastors scan sermon clips quickly without waiting for video previews to load.
        </p>
        <div className="secondary-command-strip">
          <article>
            <span className="muted small">Prepared clips</span>
            <strong>{thumbnailReadiness.preparedClipCount}</strong>
          </article>
          <article>
            <span className="muted small">Posters ready</span>
            <strong>{thumbnailReadiness.readyPosterCount}</strong>
          </article>
          <article>
            <span className="muted small">Need posters</span>
            <strong>{thumbnailReadiness.missingPosterCount}</strong>
          </article>
          <article>
            <span className="muted small">Optimized variants</span>
            <strong>{thumbnailReadiness.optimizedPosterCount}</strong>
          </article>
          <article>
            <span className="muted small">Poster errors</span>
            <strong>{thumbnailReadiness.failedPosterCount}</strong>
          </article>
        </div>
      </section>

      <HealthRecoveryPanel
        issueCount={consistency.issueCount}
        affectedClipCount={consistency.affectedClipIds.length}
        affectedSermonCount={consistency.affectedSermonIds.length}
        draftIssueCount={consistency.draftIssueCount}
        totalIssueCount={consistency.totalIssueCount}
        missingPosterCount={thumbnailReadiness.missingPosterCount}
        failedOperationCount={operationalMetrics.failedOperations}
        failedProcessingJobCount={operationalMetrics.failedProcessingJobs}
        failedMediaAssetCount={operationalMetrics.failedClipAssets}
        outdatedAssetCount={operationalMetrics.outdatedAssets}
      />

      <section className="card stack-sm">
        <h2>Sermon Data Readiness</h2>
        {consistency.totalIssueCount === 0 ? (
          <p className="muted">No broken references or missing workflow files were detected.</p>
        ) : (
          <>
            {consistency.issueCount > 0 ? (
              <p className="error-banner">
                Found {consistency.issueCount} ready-looking media file reference(s) that are missing or empty across {consistency.affectedClipIds.length} clip(s).
              </p>
            ) : (
              <p className="success-banner">
                No posting-ready clips have broken local references.
              </p>
            )}
            <p className="muted small">
              Use Recommended Recovery above first. Draft clip issues are listed separately so the workspace does not look blocked by unapproved suggestions.
            </p>
            {consistency.issueDetails.length > 0 ? (
              <ul className="jobs-list">
                {consistency.issueDetails.map((issue) => (
                  <li key={`${issue.clipId}-${issue.assetLabel}-${issue.problem}`} className="stack-xs">
                    <p>
                      <strong>{issue.clipTitle}</strong>{" "}
                      <span className="status-pill risk-high">{issue.assetLabel}</span>
                    </p>
                    <p className="muted small">
                      {issue.sermonTitle ? `${issue.sermonTitle}: ` : null}{issue.problem}
                    </p>
                    <p className="muted small">{issue.recoveryAction}</p>
                    <Link href={`/sermons/${issue.sermonId}/clips/${issue.clipId}/studio`} className="button tertiary">
                      Open clip
                    </Link>
                  </li>
                ))}
              </ul>
            ) : consistency.issues.length > 0 ? (
              <ul className="jobs-list">
                {consistency.issues.map((issue) => (
                  <li key={issue} className="muted">{issue}</li>
                ))}
              </ul>
            ) : null}
            {consistency.draftIssues.length > 0 ? (
              <details className="stack-sm">
                <summary className="muted">Draft clip references needing cleanup ({consistency.draftIssueCount})</summary>
                <ul className="jobs-list">
                  {consistency.draftIssueDetails.length > 0
                    ? consistency.draftIssueDetails.map((issue) => (
                      <li key={`${issue.clipId}-${issue.assetLabel}-${issue.problem}`} className="muted">
                        {issue.clipTitle}: {issue.assetLabel} - {issue.problem}
                      </li>
                    ))
                    : consistency.draftIssues.map((issue) => (
                      <li key={issue} className="muted">{issue}</li>
                    ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>

      <div className="actions-row">
        <Link href="/" className="button secondary">
          Back to Dashboard
        </Link>
        <Link href="/sermons" className="button tertiary">
          Sermon Library
        </Link>
      </div>
    </main>
  );
}
