# Phases 5 and 6: quality, cost, and governed publishing rollout

## Release boundary

This release is safe for isolated pilot verification after the Phase 1–4
prerequisites pass. It does not enable a provider, queue, automatic post,
retention action, or budget hard stop. Phases 5 and 6 add no migration,
dependency, or environment variable.

## Quality contract

The canonical transcript remains the timestamped `Transcript` and
`TranscriptSegment` evidence. The quality policy does not rewrite those words
or timestamps. It records a versioned decision and SHA-256 fingerprint in the
saved transcript JSON.

The decision uses available evidence rather than applying an unconditional
premium-model retry:

- existing clipping-readiness and expected-window coverage;
- unexplained gaps, timing density, repetition, and word density;
- provider-confidence coverage and low-confidence regions;
- detected language/code switching;
- uncertain known preacher/church names and reference-shaped Scripture terms;
- context-boundary risk when supplied by the caller.

Audio evidence can receive at most one speech-enhanced retry. Pure language,
entity, Scripture, grounding, or safety concerns do not trigger a cosmetic
repair. They require human review. Missing usable timestamp evidence fails
closed.

`MANUAL_REVIEW_ONLY` transcripts are returned as unreliable for automatic
intelligence. The existing fallback path may create basic time cuts, but those
remain explicitly review-only and do not become ranked safe recommendations.
Saved transcript reuse validates the quality contract first; malformed
provenance fails closed. Legacy transcript files without a contract retain
legacy behavior until they are retranscribed.

Structured clip intelligence now accepts exactly one JSON object, optionally
inside one exact JSON fence. Prose wrappers, oversized responses, invalid JSON,
and schema mismatches are classified separately. Only one schema repair is
allowed. Safety and grounding failures are never syntactically repaired.
Model, prompt version, schema version, input fingerprint, and cache boundary
are recorded without logging sermon content.

## Cost and media evidence

Workspace Health separates:

1. measured application telemetry;
2. stored cost estimates;
3. configured allowances and recorded meter events; and
4. missing or partial evidence.

The view is tenant scoped and contains counts, timings, token/audio totals,
cache/provider-attempt counts, per-stage/model groups, sermon-attribution
coverage, and metadata-derived storage totals. It never renders prompts,
transcripts, sermon titles, object keys, URLs, credentials, or private notes.

Stored `estimatedCostMicros` is always labelled an estimate, never a charge or
invoice. Processing duration is wall time, not billed compute. Storage is a
database-metadata lower bound, not a bucket inventory. A missing usage event is
reported as missing meter coverage when related activity exists; it is not
reported as zero usage.

Media policy remains:

- top three review previews first;
- remaining previews and Content Week on demand;
- reuse a matching fresh artefact;
- final render/export approval gated;
- publishing requires explicit intent;
- lifecycle enforcement observe only; and
- automatic deletion off.

## Governed publishing contract

The Phase 6 connector boundary cannot send externally. A governed intent is
created only when all of these are true:

- a publisher explicitly confirms the exact post;
- actor and post share the same organization and campus;
- the handoff role is authorised for the requested action;
- the approved preview/revision and media checksum still match the scheduled
  payload;
- a connector is selected; and
- its deterministic idempotency key matches that approved payload and
  destination.

Every accepted foundation intent requests `PRIVATE`, records
`autoPublish: false`, and can only use an adapter whose
`externalSendEnabled` is false. The included no-op adapter creates a manual
handoff, supports idempotent replay, and exposes `NOT_SENT`, `FAILED`, and
`UNKNOWN` reconciliation states without contacting a provider.

Governed events use the existing tenant-scoped `AuditEvent` table. Scheduled
posts remain the durable execution receipt. The publishing desk shows workflow
responsibilities—not claims about the signed-in person’s role—plus source and
approval evidence, missing owner/assignee, account, audience, privacy,
schedule, exact next action, and verify-before-retry recovery. A revision ID by
itself is not approval; changed or reapproval-required content fails closed.

## Pilot verification gates

### Quality

- Run English and representative local/code-switched fixtures with evaluated
  speaker names, Scripture references, confidence gaps, silence, coarse timing,
  truncated coverage, and boundary risks.
- Confirm the single enhancement retry is conditional and cannot loop.
- Confirm manual-review-only or malformed saved contracts never enter automatic
  intelligence.
- Confirm every basic time cut says it is recovery material requiring manual
  review.
- Record fallback/manual-review rate by language and provider. Stop widening if
  any cohort is disproportionately routed to unsafe automation or unusable
  recovery.

### Cost and media

- Reconcile AI invocation counts/tokens/audio and stored estimates against a
  separately authorised provider invoice. Do not calibrate pricing from the
  estimate alone.
- Verify UsageEvent production coverage for each allowance metric before using
  it as an enforcement or pricing input.
- Reconcile metadata-derived storage against an authorised provider inventory.
- Measure cache hits, retry amplification, source-window coverage, queue/run
  wall time, and artefact reuse.
- Do not enable hard budget stops until the policy explicitly preserves safety
  escalation and handles allowance exhaustion without hiding pastoral risk.

### Publishing

- In an isolated database, prove changed-after-approval, cross-tenant/campus,
  unauthorised role, missing intent, wrong connector, and wrong idempotency key
  are blocked before adapter execution.
- Stage twice through the no-op adapter and confirm one logical handoff plus an
  idempotent replay event.
- Force `FAILED` and `UNKNOWN` reconciliation and confirm the operator must
  inspect the platform before retrying.
- Verify the handoff panel marks unapproved/reapproval-required content as
  needing pastor attention and exposes missing real owner/assignee.
- Do not configure a live connector until provider terms, required scopes,
  privacy/audience controls, deletion, reconciliation, duplicate prevention,
  rate limits, incident response, and rollback have approved evidence.

## Stop conditions

Stop the pilot or keep the affected path manual if:

- a quality contract permits automatic recommendations despite a manual-review
  disposition;
- a degraded/basic cut is presented as a safe recommendation;
- a repair bypasses grounding, safety, or transcript approval;
- cost estimates are displayed or communicated as charged amounts;
- allowance or storage coverage gaps appear as zero/healthy;
- a lifecycle/retention action can delete media without a separate approved
  operation;
- changed-after-approval content can be staged;
- a connector can request public visibility or send without exact explicit
  intent;
- retry can create a duplicate post; or
- audit/history results can cross church or campus scope.

## Deployment and rollback

1. Complete all Phase 1–4 deployment, RLS, backup/restore, worker-health, and
   dark-launch gates.
2. Deploy application code with real connectors and automatic deletion still
   disabled. No Phase 5/6 database migration is applied.
3. Run provider-free fixtures, no-op connector tests, and the quality/cost
   dashboard against an isolated pilot database.
4. Admit one internal/synthetic sermon, then one named pilot church only after
   the stop conditions remain clear.
5. Roll back at the application-release level if needed. Preserve transcripts,
   quality contracts, usage events, scheduled posts, and audit evidence.

## Known limitations

- Entity/Scripture detection currently covers known preacher/church names and
  English-form Bible-book references; multilingual evaluated lexicons remain
  pilot work.
- Conservative missing-confidence handling may increase manual fallback. This
  is intentional until cohort evidence exists.
- Only AI-token reservations are known to be broadly metered. Other allowance
  metrics need verified producer coverage.
- Inventory omits objects without recorded size and is not a provider listing.
- The no-op connector is a foundation, not a live connector or provider proof.
- Real owner/assignee identity is not present in the current scheduled-post
  read model, so the UI truthfully reports assignment gaps.
