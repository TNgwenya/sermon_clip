# Phase 5 cost and media-safety observability

## Purpose

Workspace Health now provides a read-only, organization-scoped view of cost and media workload evidence. It is intended for pilot operations and allowance calibration, not customer billing.

The surface keeps three evidence classes separate:

- **Measured application telemetry:** sermons added in the current UTC month, known source duration, AI-reported tokens and audio duration, provider request attempts, cache hits, sermon-attribution coverage, processing-job wall time/queue delay by stage, and file-size metadata already stored in the database.
- **Stored estimates:** the existing `AiInvocation.estimatedCostMicros` values and potential media seconds outside complete preaching windows. These are estimates only; they are never described as provider invoices, charges, or realised savings.
- **Configured allowances:** active `OrganizationEntitlement` limits compared with current-month `UsageEvent` records. If related activity exists without matching meter events, the UI says that coverage is missing instead of reporting zero usage.

No prompts, transcripts, sermon titles, media URLs, object keys, credentials, or customer content are exposed by this report. Workload attribution is grouped by operation, provider, and model; tenant filtering happens in every database query.

Processing-stage time comes from existing job timestamps. It is wall time, not CPU time or billed compute, and incomplete jobs are called out as timing-coverage gaps.

## Media workload policy

The policy module records the pilot-safe defaults already established by staged orchestration:

- prepare the top three ranked review previews first;
- leave remaining previews and Content Week on demand;
- require an approval reference for final render/export;
- require explicit publish intent for publishing;
- reuse a matching fresh artefact before rerendering;
- keep lifecycle enforcement observe-only;
- do not automatically delete media.

The source-window signal is advisory. A complete start and end time can quantify recording time outside the preaching section, but the report calls this a potential workload reduction rather than compute savings.

## Inventory limitations

The inventory total is a lower bound assembled from database size metadata for uploaded sources, ready clip artefacts, content asset files, and completed teaching-video exports. It is not a provider bucket listing and does not include every local file, remote object version, incomplete multipart upload, CDN copy, or record without size metadata. The report displays metadata coverage and emits a warning when sizes are missing.

No storage provider, queue, billing API, or object-store API is called. No lifecycle or retention action is executed.

## Pilot setup and interpretation

No migration, dependency, or new environment variable is required. Existing entitlement keys are used:

- `ai.tokens.monthly` with metric `ai.tokens`
- `ai.audio_seconds.monthly` with metric `ai.audio_seconds`
- `media.seconds.monthly` with metric `media.seconds`
- `storage.bytes` with metric `storage.bytes`

Only AI token reservations are currently known to be wired broadly in application flow. Operators must treat other zero-event meters as incomplete until their producing paths have been verified. Use pilot data to set allowances only after meter coverage and provider invoices have been reconciled.

Before making pricing or capacity decisions, verify:

1. AI invocation estimate coverage and sermon attribution coverage are acceptably high.
2. Provider request attempts do not show excessive retry amplification.
3. Source duration and preaching-window coverage are improving.
4. File-size metadata coverage is understood and periodically reconciled with a separately authorised provider inventory.
5. UsageEvent totals reconcile with the corresponding application telemetry and vendor invoice.
