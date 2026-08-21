# Phase 2: Durable orchestration and early value

## Decision and safe rollout boundary

Phase 2 is an additive, dark-launchable control plane. Existing `ProcessingJob`
behavior remains the default until `ORCHESTRATION_CONTROL_PLANE_ENABLED=true`.
Do not enable the flag until the Phase 1 tenant migration and the Phase 2
orchestration migration have both succeeded, a dedicated worker is healthy,
and the pilot operator has rehearsed cancellation, dead-letter review, and
replay in an isolated database.

The pilot default is database polling. Postgres is the durable queue of record
and the transactional outbox records delivery. This avoids a new service for a
5–10 church pilot. The queue contract is vendor-neutral; a later SQS adapter
only needs to implement `OrchestrationQueueAdapter.publish`. No AWS SQS SDK,
queue, IAM policy, or cloud configuration is included in this change.

## Service promise encoded by the workflow

The automatic high-priority path is:

1. intake/materialisation and audio extraction;
2. transcription;
3. intelligence and ranked suggestions;
4. the strongest branded review preview, then at most the top three previews.

Remaining previews and Content Week work are deferred/on demand. Final render
and export require an approval reference. Publishing additionally requires an
explicit publish-intent reference and a configured connector handler; the
default staged worker refuses to publish automatically.

The UI reports four separate facts: queued/processing, suggestions ready,
first branded preview ready, and full Content Week complete. It deliberately
does not turn an early preview into a claim that all work has finished.

## Data model and delivery semantics

- `OrchestrationJob` stores a tenant, lane, immutable intent hash,
  deterministic idempotency key, versioned portable JSON payload, priority,
  attempts, cancellation, lease token/expiry, failure, and dead-letter state.
- `OrchestrationOutboxEvent` is append-only per delivery generation. Initial
  enqueue writes the job and first outbox event in one transaction.
- Follow-on enqueue writes the completed parent checkpoint and child job/outbox
  in one transaction.
- Queue delivery is at least once. Lease-token fencing and idempotent stage
  agents make duplicate delivery safe; external side effects still need their
  existing provider/idempotency safeguards.
- Fair claim serves one head job per church before returning to a busy church.
- Retry policy is reason-aware and bounded. Invalid input, authorization,
  pastoral safety, unsupported media, and artifact-integrity failures do not
  spin indefinitely.
- Replay is tenant-scoped, requires the reviewed terminal timestamp and a
  meaningful operator reason, appends a new outbox delivery, and writes an
  audit event.

## Configuration (not applied by this change)

Required to activate:

```text
ORCHESTRATION_CONTROL_PLANE_ENABLED=true
DATABASE_URL=postgresql://...
```

Optional worker tuning:

```text
ORCHESTRATION_WORKER_ID=<stable-host-worker-name>
ORCHESTRATION_POLL_SECONDS=5
ORCHESTRATION_LEASE_MINUTES=3
ORCHESTRATION_HEARTBEAT_SECONDS=30
ORCHESTRATION_HEARTBEAT_STALE_SECONDS=120
```

Keep the lease longer than the heartbeat interval. Long transcription/render
stages renew their lease; a worker that loses its token cannot complete or
overwrite the new owner.

## Migration and deployment checklist

1. Preserve and review all Phase 1 changes. Take a verified metadata backup
   and media inventory using the Phase 1 runbook.
2. Confirm the Phase 1 migration is applied. The Phase 2 RLS policies depend on
   `sermon_clip_tenant_row_visible` from Phase 1.
3. Confirm every pilot sermon has a non-null `organizationId`. Phase 2 rejects
   ownerless sermons instead of guessing a tenant.
4. Run `npx prisma migrate status` against the target in read-only/review mode.
5. Apply `20260821200000_phase2_orchestration_control_plane` in the approved
   maintenance window, then run `npx prisma generate`.
6. Verify composite sermon/organization foreign keys and RLS policies. RLS is
   defense in depth only when the application uses a least-privilege non-owner
   runtime role; table owners can bypass ordinary RLS. In a disposable
   database, run `psql "$ISOLATED_DATABASE_URL" -f
   scripts/verify-orchestration-rls.sql`; the script rolls back its temporary
   role and fixtures.
7. Deploy application code with the feature flag absent/false. Verify existing
   intake and the existing media worker remain healthy.
8. Start `npm run worker:orchestration` with the flag enabled on one pilot
   worker. Confirm `/health` shows a fresh staged-worker heartbeat and zero
   unexplained dead letters.
9. Enable the flag for the web process only after the worker is healthy. Submit
   one isolated test sermon and verify each distinct customer milestone.
10. Pilot with one church, then widen gradually. Do not enable a real broker
    until an adapter, IAM boundary, queue alarms, and redrive drill are reviewed.

## Verification commands

Use a disposable local Postgres URL. The test guard intentionally rejects a
remote or production-looking database.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sermon_clip_phase2_test \
  npx vitest run src/server/orchestration \
  src/server/agents/__tests__/clipReviewAssetService.test.ts \
  src/server/pipeline/__tests__/processSermonPipeline.test.ts

npx eslint src/server/orchestration scripts/orchestration-worker.ts
npx tsc --noEmit
```

At handoff, TypeScript has one known unrelated baseline failure in
`src/app/ready-to-post/__tests__/sermon-publishing-library.test.tsx`: its
fixture allows `mediaReadiness` to be undefined while the production type does
not. Resolve that separately before treating a full build as green.

## Operator recovery

- Pending: confirm worker heartbeat and `availableAt`; do not replay a job whose
  backoff has not elapsed.
- Leased too long: the worker periodically calls `recoverExpired`; recovery is
  fenced and creates a new outbox delivery if another attempt is permitted.
- Cancellation: request cancellation with an explicit reason. A pending job is
  cancelled immediately; a leased media job stops at the next safe stage
  boundary so partially written files are not promoted.
- Failed/dead-letter: filter by the church tenant, inspect failure code and
  preserved artifacts, fix the cause, then replay with the reviewed terminal
  timestamp and written operator reason. Never bulk-replay across tenants.
- Preview failure: suggestions and raw review media remain preserved. Retry the
  preview lane; do not rerun transcription or intelligence unless their
  durable evidence is invalid.
- Publishing: the staged worker has no default publishing handler. Continue to
  use the existing approval/governance workflow until a connector-specific,
  idempotent handler is explicitly reviewed.

## Rollback

Set `ORCHESTRATION_CONTROL_PLANE_ENABLED=false` in web and worker processes and
stop the staged worker. Existing `ProcessingJob` intake remains available.
Do not drop the new tables during operational rollback; retain jobs, outbox
deliveries, and audit evidence for diagnosis. A schema rollback requires a
separate approved retention/export decision.

## Pilot gates and remaining decisions

- Run the migration and restore/replay drill on an isolated environment.
- Prove tenant RLS using the actual least-privilege runtime role.
- Prove one worker-loss recovery during transcription and one during render.
- Establish lane concurrency limits from pilot measurements; the current
  worker is deliberately serial and safe, not yet a capacity claim.
- Use durable private source storage for uploaded sermons before allowing jobs
  to move between machines. Each media lane can re-materialise the source on a
  new worker, but a legacy `local-upload://` recording without a durable source
  object remains tied to its original persistent volume and is failed safely
  if that file disappears.
- Add an authenticated operator surface or tightly controlled CLI before
  support staff perform cancellation/replay; the store API exists, but no new
  public admin endpoint is exposed.
- Choose SQS only when measured queue delay or multi-worker fan-out justifies
  it. A vendor adapter, queue URL mapping, IAM, DLQ alarms, and cost limits are
  still vendor-specific work.
- Do not promise “clips in minutes” yet. Instrument and measure queue delay,
  suggestions-ready time, first-branded-preview time, full-content time,
  retries, dead letters, and per-church fairness through the pilot.
