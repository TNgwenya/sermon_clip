# Pilot Sunday operations runbook

**Purpose:** get a church from an authorized sermon recording to a safely
reviewable result while preserving context, privacy, and recoverability<br>
**Scope:** invite-only pilot; not a 24/7 or unattended-publishing promise

## Operating rule

Protect people and meaning before speed. A delayed clip is recoverable; an
unapproved, misleading, or private disclosure may not be.

Each Sunday has one named operator, technical responder, pilot owner, church
approver, backup approver, church publisher, and urgent contact. Record their
names and contact channels before processing starts. Do not rely solely on
in-app or email notifications until they have been proven in the deployed
environment.

## T-24 hours: pilot readiness

- [ ] Confirm the churches and expected sermon windows; reject surprise volume
      beyond the agreed allowance unless the pilot owner accepts the capacity
      risk.
- [ ] Confirm direct-upload originals will be available after each service.
- [ ] Confirm each church's rights/consent reference, approver, publisher, and
      escalation contact.
- [ ] Review unresolved incidents and deletion requests. Do not process material
      subject to a privacy/safeguarding hold.
- [ ] Confirm the latest verified backup/inventory and restore-drill status. A
      failed or unknown recovery gate is an explicit pilot-owner decision, not
      an operator assumption.
- [ ] Confirm no planned migration, credential rotation, storage pruning, or
      deployment overlaps the Sunday window.
- [ ] Verify third-party quota/billing alerts and provider status through the
      approved dashboards without exposing credentials.
- [ ] Keep automatic publishing in dry-run/private mode. Manual handoff is the
      standard pilot route.

## T-60 minutes: environment preflight

Record every check as pass, warning, or fail with a timestamp.

- [ ] Sign in using the operator's own least-privileged account; do not share an
      owner login.
- [ ] Open `/health` for the intended workspace. Confirm the application and
      database checks, processing/media failures, data/file consistency, and
      publishing-service state. The health page is tenant-scoped, and local
      media checks are available only where media processing can run.
- [ ] Confirm the media worker/service is online by the approved heartbeat or
      process check for the deployed environment. A running host process alone
      is not proof that jobs can be claimed.
- [ ] Confirm the posting worker state separately. If it is stale or absent,
      automatic posts should remain queued; use manual downloads.
- [ ] Confirm available worker disk exceeds the configured reserve and expected
      uploads. Do not lower the reserve during Sunday operations.
- [ ] Confirm FFmpeg, source ingestion, private object access, AI provider, and
      preview access with a non-sensitive canary/synthetic asset if the approved
      monitoring procedure supports it.
- [ ] Confirm recent archive/inventory completion before any retention task.
- [ ] Open one known pilot sermon in each pilot workspace and prove the operator
      can see only the selected church. Any cross-tenant result is SEV-1: stop.

**Go:** all critical checks pass; warnings have a named owner and workaround.<br>
**No-go:** cross-tenant access, unknown backup state, storage below reserve,
database unavailable, missing media worker, compromised credential, unresolved
SEV-1, or no church approver.

## Intake procedure

1. Confirm the selected workspace/church before choosing a file.
2. Confirm the title, speaker, church, date, language, sermon start/end, and the
   church's rights/consent reference.
3. Prefer direct upload from the church's retained original. Use a source URL
   only when rights are documented and direct upload is unavailable.
4. Use the selected sermon window. Do not process an entire long service merely
   because the file contains it.
5. Start one intake. Record sermon ID, source type, source duration, selected
   window, upload completion time, and processing start time.
6. If upload/download appears stalled, inspect status before retrying. Never
   create several copies to “make one work.”

If URL ingestion fails, obtain the original file; repeated source-download
retries are not the fallback. If upload fails, keep the church's source file,
record the error category/request ID, and follow the incident threshold below.

## Processing supervision

Capture five distinct times; do not collapse them into one “processing time”:

1. intake accepted;
2. processing job claimed (queue delay);
3. transcript/suggestions ready (first useful result);
4. first branded preview ready;
5. all agreed outputs ready (content-week completion, if included, is separate).

### While work is active

- Refresh using the product status/health views; do not repeatedly submit the
  same action.
- Check job status and heartbeat before restarting a worker. A restart may cause
  rework even when leases/idempotency protections exist.
- Do not run retention, pruning, production restore, schema changes, dependency
  upgrades, or bulk retry during the Sunday window.
- Treat provider error messages and signed URLs as sensitive operational data.
  Record an error category and request ID, not secrets or sermon content.
- If another church is waiting, report queue delay honestly. Do not imply its
  sermon is actively processing until the job is claimed.

### Safe failure decisions

| Failure | Safe response | Do not do |
| --- | --- | --- |
| URL download | switch once to the church's original direct upload | keep retrying a blocked platform URL |
| Source upload/object access | preserve original; verify workspace, object status, disk reserve, and private-storage health; escalate after one controlled retry | request credentials or copy media to personal storage |
| Transcription | keep the result unpublished; inspect quota/provider/chunk status; one controlled retry after the cause is addressed | present time-window fallback clips as safe recommendations |
| Intelligence/clip selection | let the church use a human-selected sermon moment with full context, or defer | invent claims, shorten away qualifications, or publish an unreviewed suggestion |
| Preview/render/captions | prioritize one top approved clip; retry only the failed stage through the product's recovery action | rerun the entire sermon or approve text without watching the rendered revision |
| Publishing connection/worker | download the approved package and hand it to the named church publisher; verify channel and privacy on-platform | enable public/autopost as a quick fix |
| Suspected tenant/privacy leak | stop affected intake/access, preserve minimal evidence, invoke SEV-1 procedure | explore other tenants to determine the size |

## Church review and release

For the pilot, offer the church the top three candidates first. The approver
must check:

- the opening and ending have enough context;
- wording matches the recording and captions;
- Scripture reference/version, names, places, dates, and translations;
- no private prayer, counselling, testimony, health, financial, child, or
  safeguarding information is exposed;
- people and copyrighted music/visuals are permitted;
- branding, crop, subtitles, and final frame are appropriate;
- the exact exported revision is the approved revision.

Record approve/reject, approver, revision, and time. A publisher then separately
checks the destination account, copy, media, audience/privacy, and scheduled
time. During pilot, prefer download/manual posting. A platform “accepted” result
is not proof of public visibility; verify the platform result.

## Communication cadence

- At intake: confirm receipt and the next checkpoint; do not promise “minutes.”
- If no first useful result by the agreed internal threshold: tell the church
  what stage is delayed, what remains safe, the next update time, and the manual
  alternative.
- For a material delay: update at least hourly until a usable result or a
  mutually agreed deferral.
- For privacy, cross-tenant, unapproved publishing, data loss, or credential
  exposure: use the incident plan immediately rather than ordinary support.

Suggested delay message:

> Your sermon is safely received, but **[stage]** is taking longer than our
> pilot target. Nothing has been published. We are **[action]** and will update
> you by **[time and timezone]**. If needed, we can provide **[manual option]**.

## End-of-day closure

- [ ] Every sermon has an owner and final state: delivered, still processing,
      failed with next action, or deferred with church agreement.
- [ ] Every output has an approval revision; anything else remains unpublished.
- [ ] Verify automatic publishing is still at the approved pilot setting and
      inspect provider-side results for any attempted posts.
- [ ] Review `/health`, unresolved failures, queue/running state, worker
      heartbeat, storage reserve, and archive/inventory state.
- [ ] Open or update incident tickets. Link only non-sensitive IDs and redacted
      evidence.
- [ ] Send church closures/delay updates from the approved contact channel.
- [ ] Record intake, queue, first useful result, first preview, completion,
      retry, operator time, and support time for unit economics.
- [ ] Hand over work still running; do not leave a job with no named owner.

## Escalation thresholds

Invoke [incident response](./pilot-incident-response-and-customer-communications.md)
immediately for any cross-tenant access, sensitive/unapproved publication,
credential exposure, destructive data loss, or suspected compromise.

Escalate as a service incident when one church cannot receive the agreed core
result, two churches hit the same failure, queue delay exceeds the internal
pilot target, a worker remains stale after one controlled restart, storage is
near reserve, or a provider quota blocks work. Repeatedly retrying is not an
incident strategy.
