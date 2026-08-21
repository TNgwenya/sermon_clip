# Phase 7: pilot measurement and decision support

## Release boundary

Phase 7 is an operational measurement system for a controlled pilot. It is
not proof of launch readiness, a production service-level agreement, or a
broad-market benchmark. A green observation means only that no configured
breach was observed in the stated window and denominator. Unknown and
insufficient evidence never become a passing launch claim.

This phase adds no database migration, dependency, environment variable,
provider integration, external send, or retention action. It reads the
existing tenant-scoped operational records introduced or used by Phases 2,
5, and 6, and stores operator effort in the existing `AuditEvent` table.

## Measurement contract

The sermon journey begins at the saved sermon admission time. Milestones use
durable evidence, not optimistic status copy:

- **Queue delay:** `ProcessingJob.createdAt` to `ProcessingJob.startedAt`.
  `updatedAt` and completion time are never substituted for a missing start.
- **Ranked suggestions:** admission to the earliest persisted clip candidate.
- **First playable branded clip:** admission to the earliest current, ready,
  playable overlay with a Brand Kit plan hash. A raw, stale, or incomplete
  preview is not branded-ready evidence.
- **Full requested content:** the observed Content Week request to a durable,
  non-draft Week Draft with at least one item. If no request is observed, the
  measure is `NOT_REQUESTED`, not a failure or a zero duration.

Each duration carries its sample size and minimum sample. With no sample it is
`UNKNOWN`; below the minimum it is `INSUFFICIENT`; only a sufficient sample
receives P50 and P90 values. Individual sermon rows remain distinct from
cohort percentiles.

The journey summary also records stage attempts and outcomes, bounded retries,
dead letters, fallback use, rework evidence, safety corrections, provenance
checks/failures, approval/export/handoff/publish evidence, and explicit-intent
violations. Existing orchestration jobs, artefacts, approval records,
publishing audit events, and funnel events are reused; Phase 7 does not create
a second event stream.

## Data-quality and denominator rules

Every rate states its denominator. Examples include all observed sermons,
sermons with retained quality evidence, provenance checks, and publish
attempts. A missing denominator yields `UNKNOWN`, never 0% or 100%.

The telemetry contract rejects fields that could contain transcript, title,
caption, prompt, payload, URL, path, email, log, message, or person-name data.
Inputs use bounded pseudonymous keys. Dashboard labels are generated and do
not expose sermon titles, church names, user identities, post IDs, object keys,
or private notes. Links on the authenticated church dashboard retain the raw
route ID only inside the tenant-scoped application route; exports omit it.

Known data-quality gaps are surfaced per sermon and in the cohort total. Older
records may lack a Phase 5 quality contract, a trustworthy job start, current
overlay metadata, a Content Week request, or complete storage size. Those
records remain useful for limited operational evidence but cannot silently
support a readiness claim.

## Per-church dashboard

The authenticated `/health/pilot` view is restricted by the existing billing
read capability and exact organization/campus scope. It shows:

- explicit stop, watch, pass, and unknown gates;
- sample-aware queue, suggestion, first-preview, and requested-content timing;
- individual pseudonymous sermon journeys;
- retries, dead letters, fallback, rework, safety, and provenance outcomes;
- queue and worker heartbeat evidence;
- approval, handoff, export, publishing, and support-effort totals; and
- measured application usage, stored AI estimates, allowance indicators, and
  metadata-derived storage coverage.

Application usage and stored estimates are not provider invoices. Vendor
billing reconciliation is therefore an explicit unknown gate until an
authorised operator compares the pilot period to provider statements.

The main Workspace Health page shows the Pilot evidence link only when the
persisted actor has `billing.read`. CSV and JSON downloads independently
require `analytics.export`; they do not accept client-supplied tenant scope.
Onboarding remains `UNKNOWN` in board evidence because no durable onboarding
completion event exists.

## Operator support capture

Support-effort capture stores only allowlisted operational fields:

- category, severity, status, outcome;
- an explicit allowlisted board class: operational, pastoral accuracy, or
  privacy/security;
- whole minutes from 0 to 1,440; and
- a real ISO calendar date.

There is deliberately no free-text field, customer or sermon identifier,
private note, transcript excerpt, email address, or actor identity in the
sanitised read/export model. The underlying audit event retains the authorised
actor for security accountability, but that identity is never returned in
pilot metrics.

Recording requires an authorised owner, organization administrator, campus
administrator, or content lead in the exact tenant/campus. Review/export uses
the existing analytics/audit capabilities and exact scope. Cross-tenant,
cross-campus, viewer, and forged client-role access must fail closed.
The embedded form is currently reached through the more restrictive
`billing.read` dashboard, so default role templates expose it only to owners
and organization administrators. The service boundary remains safe for a
future separately authorised campus-operator surface.

## Weekly pilot operating rhythm

Run one evidence review at a consistent time each week:

1. Confirm the evidence window, tenant/campus, sample sizes, missing data, and
   worker heartbeat freshness before reading percentages.
2. Reconcile every dead letter, critical support incident, safety correction,
   approval block, stale artefact, and publishing reconciliation failure.
3. Review individual sermon journeys before interpreting cohort percentiles;
   separate queue delay, first useful result, first branded preview, full
   requested content, and later rework.
4. Record operator minutes immediately after support work using only the
   allowlisted categories. Never paste customer content into telemetry.
5. Compare application usage and estimates with authorised provider invoices
   and storage inventory outside the product. Record the result in the weekly
   operating decision, not as invented Phase 7 cost data.
6. Export the privacy-safe aggregate for the board packet. State the sample,
   evidence label, stop state, limitations, and unresolved decisions.
7. Decide `continue within boundary`, `continue with limits`, `watch`, `pause`,
   or `stop`. Do not expand the cohort merely because no stop event occurred.

Current downloads contain one tenant's anonymous church-week aggregates. A
cross-church board cohort must be assembled only through a separately approved
privacy-safe operations process; the product does not bypass tenant isolation
to produce it.

## Stop and expansion conditions

Stop the pilot or the affected workflow immediately for:

- any confirmed cross-tenant, privacy, credential, or security exposure;
- an approved/exported clip that still requires transcript review;
- an automatic post reaching `POSTED` in the manual pilot;
- an automatic published post without governed explicit-intent evidence;
- stale provenance used for export/handoff;
- an unexplained or uncontained dead letter on the customer critical path; or
- an unresolved critical support incident.

Pause expansion for a material pastoral-accuracy incident, critical support
event, or a sufficient sample in which fewer than 70% of started sermons
produce a first branded preview. Watch operator load above two hours per active
church-week. These thresholds are pilot controls, not permanent SLAs; changing
them requires a recorded product/operations decision.

The following remain unknown until separately verified: tenant-isolation drill
completion, restore-drill completion, real provider billing reconciliation,
real-device/mobile evidence, real connector reconciliation, customer outcome,
and broad-launch capacity.

## Local verification and pilot setup

Use a loopback or explicitly dedicated test database. Never point the test
runner at the production-configured `.env` database.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sermon_clip_phase2_test \
  npx vitest run \
  src/lib/pilotTelemetry/__tests__/journey.test.ts \
  src/lib/pilotTelemetry/boardExport.test.ts \
  src/server/pilotTelemetry/supportEffort.test.ts \
  src/server/pilotTelemetry/readModel.test.ts

npx eslint src/lib/pilotTelemetry src/server/pilotTelemetry src/app/health/pilot
npx tsc --noEmit
npm run build
git diff --check
```

Before enabling the view for a pilot:

1. complete the Phase 1 isolation and restore drills;
2. apply and verify Phase 1 and Phase 2 migrations in their documented order;
3. deploy application code with real queues, connectors, automatic publishing,
   and automatic deletion still off;
4. verify role/campus behavior with an owner/admin, content lead, analyst, and
   denied viewer in an isolated environment;
5. run synthetic journey fixtures and force missing-start, retry, dead-letter,
   stale-preview, safety-review, publishing-block, and unavailable-read cases;
6. verify no export contains raw IDs, identities, text, URLs, object keys, or
   private notes;
7. name the Sunday operator and incident lead, establish the weekly review
   time, and record the pilot cohort boundary; and
8. admit churches one at a time, preserving the ability to stop intake while
   leaving completed evidence and media available.

## Deployment, rollback, and unresolved decisions

Phase 7 has no migration or configuration step. Deploy it only after the Phase
1–6 release gates pass. Rollback is an application-release rollback; retain
orchestration, usage, audit, support, approval, and publishing evidence.

Decisions still required before live pilot activation:

- which roles may see the pilot health page and download board aggregates;
- the named operator and incident escalation rota;
- the authorised process for provider-invoice and object-inventory
  reconciliation;
- the minimum sermon/church-week sample and thresholds the pilot board will
  approve before expansion;
- the retention period for operational support events and aggregate exports;
  and
- whether a future privacy-reviewed, cross-tenant operations aggregate is
  needed. Current product requests remain tenant scoped and must not silently
  combine churches.

## Claims that must not be made yet

Do not claim “clips in minutes,” a processing SLA, broad-launch readiness,
provider cost accuracy, connector reliability, complete storage inventory,
pastoral-accuracy performance, or scalable customer support from Phase 7
fixtures or a small pilot. Valid future claims require representative live
cohort evidence, sufficient denominators, reconciled billing, documented
incidents/rework, real-device verification, and completed isolation/recovery
drills.
