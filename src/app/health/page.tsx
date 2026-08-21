import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { prisma } from "@/lib/prisma";
import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";
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
import { getMediaWorkerHealth } from "@/lib/mediaWorkerHealth";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";
import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import { tenantScope } from "@/server/tenancy/scope";
import { getCompetitiveQualityReport } from "@/server/quality/competitiveQualityReport";
import { getOrchestrationHealth } from "@/lib/orchestrationHealth";
import {
  formatBytesCompact,
  formatDurationCompact,
  formatEstimatedUsdMicros,
} from "@/lib/costObservability";
import { MEDIA_COST_SAFETY_POLICY } from "@/lib/mediaCostPolicy";
import { getWorkspaceCostSafety } from "@/lib/workspaceCostSafety";

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

async function getHealthThumbnailReadiness(
  requestContext: TenantRequestContext,
): Promise<ClipThumbnailReadiness> {
  if (!canRunLocalMediaProcessing()) {
    return {
      preparedClipCount: 0,
      readyPosterCount: 0,
      optimizedPosterCount: 0,
      missingPosterCount: 0,
      failedPosterCount: 0,
    };
  }

  return getClipThumbnailReadiness(tenantScope(requestContext));
}

function qualityGateClass(status: "PASS" | "NEEDS_WORK" | "NEEDS_SAMPLE"): string {
  if (status === "PASS") return "status-approved";
  if (status === "NEEDS_WORK") return "risk-high";
  return "status-pending";
}

function formatAllowanceValue(value: bigint, unit: string): string {
  if (unit === "bytes") return formatBytesCompact(value);
  if (unit === "seconds") return formatDurationCompact(Number(value));
  return value.toLocaleString("en");
}

function allowanceStatusClass(status: string): string {
  if (status === "OK" || status === "TRACKING") return "status-approved";
  if (status === "WARNING" || status === "NO_METER_EVENTS") return "status-pending";
  if (status === "EXCEEDED" || status === "DISABLED") return "risk-high";
  return "status-pending";
}

export default async function HealthPage() {
  const requestContext = await requireRequestCapability("organization.read");
  const [environmentChecks, consistency, thumbnailReadiness, operationalMetrics, publishingServiceHealth, mediaWorkerHealth, competitiveQuality, orchestrationHealth, costSafety, canViewPilotEvidence] = await Promise.all([
    runHealthChecks(),
    getDataConsistencySummary(
      requestContext.organizationId,
      requestContext.campusId,
    ),
    getHealthThumbnailReadiness(requestContext),
    getOperationalMetrics(
      requestContext.organizationId,
      requestContext.campusId,
    ),
    getPublishingServiceHealth(),
    getMediaWorkerHealth(),
    getCompetitiveQualityReport({
      organizationId: requestContext.organizationId,
      campusId: requestContext.campusId,
    }),
    getOrchestrationHealth(requestContext.organizationId),
    getWorkspaceCostSafety(requestContext.organizationId),
    canPersistedTenantCapability(requestContext, "billing.read"),
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
  const mediaWorkerCheck: HealthCheckResult = mediaWorkerHealth.status === "ONLINE"
    ? {
      name: "Sermon processing worker",
      status: "OK",
      message: "The media worker is online and checking the sermon processing queue.",
    }
    : mediaWorkerHealth.status === "STALE"
      ? {
        name: "Sermon processing worker",
        status: "Missing",
        message: `The media worker is stale${mediaWorkerHealth.ageSeconds === null ? "" : `; its last signal was ${Math.max(1, Math.round(mediaWorkerHealth.ageSeconds / 60))} minutes ago`}. New sermon work will remain queued.`,
        fix: "Run npm run worker:media and confirm a fresh heartbeat before accepting new sermon processing.",
      }
      : {
        name: "Sermon processing worker",
        status: "Missing",
        message: "No media worker heartbeat has been recorded. New sermon work will remain queued.",
        fix: "Run npm run worker:media and confirm a heartbeat before accepting new sermon processing.",
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
  const orchestrationCheck: HealthCheckResult = orchestrationHealth.status === "DISABLED"
    ? {
      name: "Staged orchestration worker",
      status: "OK",
      message: "The Phase 2 control plane is disabled; existing processing remains active.",
    }
    : orchestrationHealth.status === "ONLINE"
      ? {
        name: "Staged orchestration worker",
        status: orchestrationHealth.deadLetters > 0 ? "Failed" : "OK",
        message: `${orchestrationHealth.pending} queued, ${orchestrationHealth.leased} active, ${orchestrationHealth.deadLetters} dead-lettered job(s).`,
        fix: orchestrationHealth.deadLetters > 0
          ? "Review tenant-scoped dead letters and replay only after recording the reason and verifying the failed stage."
          : undefined,
      }
      : {
        name: "Staged orchestration worker",
        status: "Missing",
        message: orchestrationHealth.status === "FAILED"
          ? "Orchestration health could not be read. Confirm the Phase 2 migration and database role."
          : "The staged worker has not checked in recently; durable work remains queued.",
        fix: "Run npm run worker:orchestration and confirm a fresh heartbeat before enabling Phase 2 intake.",
      };
  const checks = [...environmentChecks, mediaWorkerCheck, orchestrationCheck, publishingWorkerCheck, operationalWorkflowCheck];
  const okCount = checks.filter((check) => check.status === "OK").length;
  const healthBreakdown = buildWorkspaceHealthIssueBreakdown({
    failedHealthChecks:
      environmentChecks.filter((check) => check.status !== "OK").length
      + (mediaWorkerCheck.status === "OK" ? 0 : 1)
      + (orchestrationCheck.status === "OK" ? 0 : 1)
      + (publishingWorkerCheck.status === "OK" ? 0 : 1),
    missingReadyFiles: consistency.issueCount,
    failedOperations: operationalMetrics.failedOperations,
    outdatedAssets: operationalMetrics.outdatedAssets,
    missingPosters: thumbnailReadiness.missingPosterCount,
    failedPosters: thumbnailReadiness.failedPosterCount,
  });
  const canProcessSermons =
    environmentChecks.every((check) => check.status === "OK")
    && mediaWorkerCheck.status === "OK"
    && orchestrationCheck.status === "OK";
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
          {canViewPilotEvidence ? <Link href="/health/pilot" className="button tertiary">Pilot evidence</Link> : null}
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
          <strong>{operationalMetrics.failedProcessingJobs + orchestrationHealth.failed + orchestrationHealth.deadLetters}</strong>
          <span className="muted small">Pipeline, staged, and dead-lettered work</span>
        </article>
        <article>
          <span className="muted small">Poster cleanup</span>
          <strong>{healthBreakdown.optionalCleanup}</strong>
          <span className="muted small">{thumbnailReadiness.readyPosterCount}/{thumbnailReadiness.preparedClipCount} ready</span>
        </article>
      </section>

      <section className="card stack-md" aria-labelledby="cost-safety-title">
        <div className="stack-xs">
          <p className="kicker">Pilot cost and media safety</p>
          <h2 id="cost-safety-title">Usage evidence, allowance coverage, and on-demand safeguards</h2>
          <p className="muted">
            This view uses tenant-scoped application records only. Measured usage, stored estimates, and configured allowances are kept separate; no value below is a provider invoice or charged amount.
          </p>
        </div>

        {costSafety.status === "UNAVAILABLE" ? (
          <p className="error-banner" role="status">{costSafety.message}</p>
        ) : (
          <>
            <div className="secondary-command-strip">
              <article>
                <span className="muted small">Sermons added this month</span>
                <strong>{costSafety.report.measured.sermonCount}</strong>
                <span className="muted small">
                  {costSafety.report.measured.sourcesWithKnownDuration} with measured source duration
                </span>
              </article>
              <article>
                <span className="muted small">Recorded source duration</span>
                <strong>{formatDurationCompact(costSafety.report.measured.sourceDurationSeconds)}</strong>
                <span className="muted small">
                  {costSafety.report.measured.boundedSourceCount} bounded preaching window(s)
                </span>
              </article>
              <article>
                <span className="muted small">AI tokens reported</span>
                <strong>{costSafety.report.measured.totalTokens.toLocaleString("en")}</strong>
                <span className="muted small">
                  {costSafety.report.measured.aiInvocationsWithTokenUsage}/{costSafety.report.measured.aiInvocationCount} invocation(s) reported tokens
                </span>
              </article>
              <article>
                <span className="muted small">Recorded media inventory</span>
                <strong>{formatBytesCompact(costSafety.report.measured.inventory.knownBytes)}</strong>
                <span className="muted small">
                  {costSafety.report.measured.inventory.coveragePercent === null
                    ? "No sized artefact records"
                    : `${costSafety.report.measured.inventory.coveragePercent}% of artefact records have size metadata`}
                </span>
              </article>
              <article>
                <span className="muted small">Stored AI cost estimate</span>
                <strong>
                  {costSafety.report.estimated.aiInvocationsWithCostEstimate === 0
                    ? "No estimate"
                    : formatEstimatedUsdMicros(costSafety.report.estimated.aiCostMicros)}
                </strong>
                <span className="muted small">
                  Estimate coverage {costSafety.report.estimated.aiInvocationsWithCostEstimate}/{costSafety.report.measured.aiInvocationCount}; never an invoice
                </span>
              </article>
              <article>
                <span className="muted small">Sermon attribution</span>
                <strong>
                  {costSafety.report.measured.sermonAttributionCoveragePercent === null
                    ? "No AI activity"
                    : `${costSafety.report.measured.sermonAttributionCoveragePercent}%`}
                </strong>
                <span className="muted small">Invocation counts only; no sermon content is shown</span>
              </article>
              <article>
                <span className="muted small">Measured processing wall time</span>
                <strong>{formatDurationCompact(costSafety.report.measured.processingRunSeconds)}</strong>
                <span className="muted small">
                  {costSafety.report.measured.processingJobsWithRunDuration}/{costSafety.report.measured.processingJobCount} job(s) have complete timing
                </span>
              </article>
            </div>

            <div className="stack-sm">
              <h3>Configured allowances and meter coverage</h3>
              <ul className="jobs-list">
                {costSafety.report.allowances.map((allowance) => (
                  <li key={allowance.metric} className="stack-xs">
                    <p>
                      <strong>{allowance.label}</strong>{" "}
                      <span className={`status-pill ${allowanceStatusClass(allowance.status)}`}>
                        {allowance.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </p>
                    <p className="muted small">
                      Recorded meter usage: {formatAllowanceValue(allowance.used, allowance.unit)}
                      {allowance.limit === null ? " · no configured limit" : ` of ${formatAllowanceValue(allowance.limit, allowance.unit)}`}
                      {` · ${allowance.eventCount} meter event(s)`}
                    </p>
                    <p className="muted small">{allowance.message}</p>
                  </li>
                ))}
              </ul>
            </div>

            <details className="stack-sm">
              <summary>AI workload attribution ({costSafety.report.workloadBreakdown.length} stage/model group(s))</summary>
              {costSafety.report.workloadBreakdown.length === 0 ? (
                <p className="muted">No AI invocation telemetry was recorded this month.</p>
              ) : (
                <ul className="jobs-list">
                  {costSafety.report.workloadBreakdown.map((workload) => (
                    <li key={workload.key} className="stack-xs">
                      <p><strong>{workload.operation}</strong> <span className="muted small">{workload.provider} · {workload.model}</span></p>
                      <p className="muted small">
                        {workload.invocationCount} invocation(s) · {workload.totalTokens.toLocaleString("en")} token(s) · {formatDurationCompact(workload.audioDurationSeconds)} audio · {workload.providerRequestCount} provider request attempt(s) · {workload.cacheHitCount} cache reuse(s)
                      </p>
                      <p className="muted small">
                        Stored estimate coverage {workload.costEstimateCoverageCount}/{workload.invocationCount}
                        {workload.costEstimateCoverageCount > 0 ? ` · ${formatEstimatedUsdMicros(workload.costEstimateMicros)} estimated, not charged` : " · no cost estimate"}
                        {` · ${workload.sermonAttributionCount}/${workload.invocationCount} attributed to a sermon`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details className="stack-sm">
              <summary>Media stage workload ({costSafety.report.processingStageBreakdown.length} job type(s))</summary>
              {costSafety.report.processingStageBreakdown.length === 0 ? (
                <p className="muted">No processing jobs were created this month.</p>
              ) : (
                <ul className="jobs-list">
                  {costSafety.report.processingStageBreakdown.map((stage) => (
                    <li key={stage.jobType} className="stack-xs">
                      <p><strong>{stage.jobType.replace(/_/g, " ").toLowerCase()}</strong></p>
                      <p className="muted small">
                        {stage.jobCount} job(s) · {stage.succeededCount} succeeded · {stage.failedCount} failed · {stage.attemptCount} recorded attempt(s)
                      </p>
                      <p className="muted small">
                        {formatDurationCompact(stage.runDurationSeconds)} measured run wall time across {stage.jobsWithRunDuration}/{stage.jobCount} timed job(s) · {formatDurationCompact(stage.queueDurationSeconds)} measured queue delay
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">Wall time and queue delay come from job timestamps. They are not CPU time, provider duration, or billed compute.</p>
            </details>

            <div className="stack-sm">
              <h3>Media workload policy</h3>
              <p className="muted">
                The first {MEDIA_COST_SAFETY_POLICY.eagerPreviewLimit} ranked previews are the eager review path. Remaining previews and Content Week stay on demand; final renders remain approval-gated and publishing requires explicit intent.
              </p>
              <p className="muted small">
                Matching fresh artefacts should be reused before rerendering. Lifecycle enforcement is observe-only and automatic deletion is {MEDIA_COST_SAFETY_POLICY.automaticDeletionEnabled ? "enabled" : "off"}. Recorded inventory is metadata-derived and may omit local files, provider versions, or objects without size metadata.
              </p>
              {costSafety.report.estimated.potentialAvoidedMediaSeconds > 0 ? (
                <p className="muted small">
                  Complete source windows indicate up to {formatDurationCompact(costSafety.report.estimated.potentialAvoidedMediaSeconds)} outside the preaching sections. This is a potential workload reduction, not measured compute savings.
                </p>
              ) : null}
            </div>

            {costSafety.report.warnings.length > 0 ? (
              <ul className="jobs-list" aria-label="Cost and media telemetry warnings">
                {costSafety.report.warnings.map((warning) => (
                  <li key={warning.code} className="stack-xs">
                    <p><strong>{warning.severity === "WARNING" ? "Coverage warning" : "Operator note"}</strong></p>
                    <p className="muted small">{warning.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="success-banner">No usage-coverage warnings were detected for the current reporting window.</p>
            )}
          </>
        )}
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

      <section className="card stack-md" aria-labelledby="competitive-quality-title">
        <div className="stack-xs">
          <p className="kicker">Competitive quality gates</p>
          <h2 id="competitive-quality-title">Prove the output, not only the interface</h2>
          <p className="muted">
            Measured from {competitiveQuality.clipCount} clip candidate{competitiveQuality.clipCount === 1 ? "" : "s"} created in the last {competitiveQuality.sampleWindowDays} days. Small samples stay explicitly inconclusive.
          </p>
        </div>
        <div className="secondary-command-strip">
          <article>
            <span className="muted small">Reviewed</span>
            <strong>{competitiveQuality.reviewedClipCount}</strong>
          </article>
          <article>
            <span className="muted small">Approved</span>
            <strong>{competitiveQuality.approvedClipCount}</strong>
          </article>
          {competitiveQuality.gates.map((gate) => (
            <article key={gate.id}>
              <span className="muted small">{gate.label}</span>
              <strong>{gate.value === null ? "—" : `${gate.value}%`}</strong>
              <span className={`status-pill ${qualityGateClass(gate.status)}`}>
                {gate.status === "PASS"
                  ? `Target ${gate.target}% met`
                  : gate.status === "NEEDS_SAMPLE"
                    ? "More reviewed clips needed"
                    : `Target ${gate.target}%`}
              </span>
              <span className="muted small">{gate.detail}</span>
            </article>
          ))}
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
