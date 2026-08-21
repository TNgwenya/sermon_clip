import Link from "next/link";

import {
  formatBytesCompact,
  formatEstimatedUsdMicros,
} from "@/lib/costObservability";
import type { PercentileEvidence } from "@/lib/pilotTelemetry/journey";
import type { PilotDashboardReadModel, PilotGateState } from "@/server/pilotTelemetry/readModel";

import styles from "./pilot-dashboard.module.css";
import { SupportEffortForm } from "./support-effort-form";

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "Unknown";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function percentile(evidence: PercentileEvidence): string {
  if (evidence.state !== "KNOWN") {
    return `${evidence.state === "INSUFFICIENT" ? "Insufficient sample" : "Unknown"} · n=${evidence.sampleSize}/${evidence.minimumSampleSize}`;
  }
  return `P50 ${duration(evidence.p50Milliseconds)} · P90 ${duration(evidence.p90Milliseconds)} · n=${evidence.sampleSize}`;
}

function gateClass(state: PilotGateState): string {
  if (state === "PASS") return styles.pass;
  if (state === "STOP") return styles.stop;
  if (state === "WATCH") return styles.watch;
  return styles.unknown;
}

function allowanceValue(value: bigint, unit: string): string {
  if (unit === "bytes") return formatBytesCompact(value);
  if (unit === "seconds") return `${Math.round(Number(value) / 60).toLocaleString("en")} min`;
  return value.toLocaleString("en");
}

export function PilotDashboard({ model }: { model: PilotDashboardReadModel }) {
  const timing = [
    ["Queue delay", model.summary.durations.queueDelay],
    ["Ranked suggestions", model.summary.durations.suggestionsReady],
    ["First branded preview", model.summary.durations.firstPlayableBrandedClip],
    ["Requested Content Week", model.summary.durations.fullRequestedContent],
  ] as const;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Pilot operations · last 30 days</p>
          <h1>Pilot evidence dashboard</h1>
          <p className={styles.lead}>{model.evidenceNotice}</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/api/pilot/board-export?format=csv">Download board CSV</Link>
          <Link href="/api/pilot/board-export?format=json">Download board JSON</Link>
          <Link className={styles.backLink} href="/health">System health</Link>
        </div>
      </header>

      <section className={`${styles.decision} ${model.stopRecommended ? styles.stop : styles.unknown}`} aria-live="polite">
        <div>
          <span className={styles.statusLabel}>{model.stopRecommended ? "STOP / PAUSE" : "NO STOP TRIGGER OBSERVED"}</span>
          <h2>{model.stopRecommended ? "Do not expand the pilot yet" : "Continue only within the current pilot boundary"}</h2>
        </div>
        <p>{model.stopRecommended
          ? model.stopReasons.join(" ") || "A configured operational stop condition was breached."
          : "Unknown gates still block a broad-launch conclusion. Passing observations are not launch proof."}</p>
      </section>

      <section aria-labelledby="gates-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Decision controls</p><h2 id="gates-heading">Pilot launch gates</h2></div>
          <p>{model.gates.filter((item) => item.state === "UNKNOWN").length} gate(s) remain unknown.</p>
        </div>
        <div className={styles.gateGrid}>
          {model.gates.map((item) => (
            <article className={`${styles.card} ${gateClass(item.state)}`} key={item.key}>
              <span className={styles.statusLabel}>{item.state}</span>
              <h3>{item.label}</h3>
              <p>{item.evidence}</p>
              <p className={styles.action}>{item.action}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="timing-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Cohort view</p><h2 id="timing-heading">Time to useful outcomes</h2></div>
          <p>{model.summary.denominators.sermons} sermon(s); percentile minimum {model.summary.durations.suggestionsReady.minimumSampleSize}.</p>
        </div>
        <div className={styles.metricGrid}>
          {timing.map(([label, evidence]) => (
            <article className={styles.metric} key={label}>
              <span>{label}</span>
              <strong>{percentile(evidence)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="reliability-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Reliability</p><h2 id="reliability-heading">Failures, retries and rework</h2></div>
        </div>
        <div className={styles.metricGrid}>
          <article className={styles.metric}><span>Retries</span><strong>{model.summary.totals.retries}</strong></article>
          <article className={styles.metric}><span>Dead letters</span><strong>{model.summary.totals.deadLetters}</strong></article>
          <article className={styles.metric}><span>Fallback sermons</span><strong>{model.summary.totals.fallbackSermons}</strong></article>
          <article className={styles.metric}><span>Rework actions</span><strong>{model.summary.totals.reworkActions}</strong></article>
          <article className={styles.metric}><span>Safety corrections</span><strong>{model.summary.totals.safetyCorrections}</strong></article>
          <article className={styles.metric}><span>Provenance failures</span><strong>{model.summary.totals.provenanceFailures}/{model.summary.totals.provenanceChecks}</strong></article>
        </div>
      </section>

      <section aria-labelledby="journeys-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Journey view</p><h2 id="journeys-heading">Individual sermon journeys</h2></div>
          <p>Generated labels protect sermon and church identity.</p>
        </div>
        {model.sermons.length === 0 ? <div className={styles.empty}>No scoped sermon journeys were observed in this window.</div> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Sermon</th><th>Suggestions</th><th>Branded preview</th><th>Full set</th><th>Reliability</th><th>Handoff</th></tr></thead>
              <tbody>{model.sermons.map((sermon) => (
                <tr key={sermon.routeId}>
                  <td data-label="Sermon">
                    <Link href={`/sermons/${sermon.routeId}`}>{sermon.label}</Link>
                    <small>{sermon.admittedAt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} · {sermon.workflowStatus}</small>
                  </td>
                  <td data-label="Suggestions">{duration(sermon.suggestionsMilliseconds)}</td>
                  <td data-label="Branded preview">{duration(sermon.brandedPreviewMilliseconds)}</td>
                  <td data-label="Full set">{duration(sermon.fullContentMilliseconds)}</td>
                  <td data-label="Reliability">
                    {sermon.retryCount} retry · {sermon.deadLetterCount} dead · {sermon.reworkCount} rework
                    <small>{sermon.fallbackUsed ? "Fallback used" : "No fallback observed"}</small>
                  </td>
                  <td data-label="Handoff">
                    {sermon.approvedClipCount} approved · {sermon.exportedClipCount} export · {sermon.publishedPostCount} published
                    <small>{sermon.pendingApprovalCount} approval pending · {sermon.blockedHandoffCount} blocked</small>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel} aria-labelledby="workers-heading">
          <p className={styles.eyebrow}>Capacity</p><h2 id="workers-heading">Queues and workers</h2>
          <dl className={styles.list}>
            <div><dt>Media worker</dt><dd>{model.queue.mediaWorker.status}</dd></div>
            <div><dt>Orchestration</dt><dd>{model.queue.orchestration.status}</dd></div>
            <div><dt>Queued / active</dt><dd>{model.queue.orchestration.pending} / {model.queue.orchestration.leased}</dd></div>
            <div><dt>Failed / dead</dt><dd>{model.queue.orchestration.failed} / {model.queue.orchestration.deadLetters}</dd></div>
            <div><dt>Publishing worker</dt><dd>{model.queue.publishingWorker.status}{model.queue.publishingWorker.dryRun ? " · dry run" : ""}</dd></div>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="handoff-heading">
          <p className={styles.eyebrow}>Governance</p><h2 id="handoff-heading">Approval and publishing evidence</h2>
          <dl className={styles.list}>
            <div><dt>Approval requests</dt><dd>{model.workflow.approvalRequests}</dd></div>
            <div><dt>Pending / resolved</dt><dd>{model.workflow.approvalsPending} / {model.workflow.approvalsResolved}</dd></div>
            <div><dt>Approved / exported clips</dt><dd>{model.workflow.approvedClips} / {model.workflow.exportedClips}</dd></div>
            <div><dt>Governed / blocked handoffs</dt><dd>{model.workflow.governedHandoffs} / {model.workflow.blockedHandoffs}</dd></div>
            <div><dt>Scheduled / published</dt><dd>{model.workflow.scheduledPosts} / {model.workflow.publishedPosts}</dd></div>
            <div><dt>Support incidents / minutes</dt><dd>{model.workflow.supportIncidents} / {model.workflow.supportMinutes}</dd></div>
            <div><dt>Critical / unresolved</dt><dd>{model.workflow.criticalSupportIncidents} / {model.workflow.unresolvedSupportIncidents}</dd></div>
          </dl>
        </section>
      </div>

      <SupportEffortForm today={model.generatedAt.toISOString().slice(0, 10)} />

      <section aria-labelledby="cost-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Financial control</p><h2 id="cost-heading">Cost, allowance and storage</h2></div>
          <p>Current calendar month; organisation-wide.</p>
        </div>
        {model.cost.status === "UNAVAILABLE" ? <div className={`${styles.empty} ${styles.stop}`}>{model.cost.message}</div> : (
          <>
            <div className={styles.metricGrid}>
              <article className={styles.metric}><span>AI estimate coverage</span><strong>{model.cost.report.estimated.aiInvocationsWithCostEstimate}/{model.cost.report.measured.aiInvocationCount}</strong></article>
              <article className={styles.metric}><span>Estimated AI cash cost</span><strong>{formatEstimatedUsdMicros(model.cost.report.estimated.aiCostMicros)}</strong></article>
              <article className={styles.metric}><span>Known stored media</span><strong>{formatBytesCompact(model.cost.report.measured.inventory.knownBytes)}</strong></article>
              <article className={styles.metric}><span>Storage size coverage</span><strong>{model.cost.report.measured.inventory.coveragePercent === null ? "Unknown" : `${model.cost.report.measured.inventory.coveragePercent}%`}</strong></article>
            </div>
            <div className={styles.allowanceGrid}>{model.cost.report.allowances.map((item) => (
              <article className={styles.allowance} key={item.entitlementKey}>
                <span>{item.label} · {item.status}</span>
                <strong>{allowanceValue(item.used, item.unit)}{item.limit === null ? "" : ` / ${allowanceValue(item.limit, item.unit)}`}</strong>
                <p>{item.message}</p>
              </article>
            ))}</div>
          </>
        )}
      </section>

      <section className={styles.limitations} aria-labelledby="limits-heading">
        <p className={styles.eyebrow}>Evidence discipline</p><h2 id="limits-heading">What this dashboard cannot prove</h2>
        <ul>{model.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        {model.summary.dataQualityFlags.length > 0 && <p><strong>{model.summary.dataQualityFlags.length} journey data-quality flag(s)</strong> remain in this window. Review sermon rows before making timing claims.</p>}
      </section>
    </main>
  );
}
