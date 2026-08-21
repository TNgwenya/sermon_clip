# Phase 1 pilot deployment and verification checklist

**Status:** implementation handoff; no step in this document has been applied
to production.
**Scope:** tenant/media isolation, recoverability, pilot operations, and the
minimum media-worker heartbeat needed for a 5–10 church pilot.

This is a controlled rollout, not a one-command deployment. Keep migration,
web-runtime, media-worker, archive, and restore-drill credentials separate.
Never paste credentials into tickets, chat, screenshots, or command output.

## 1. Stop conditions

Do not admit an unrelated pilot church if any of these is true:

- the web database role owns tenant tables, is a superuser, or has
  `BYPASSRLS`, while RLS is being counted as a control;
- source-object keys have not been checked for the new tenant prefix;
- the cross-tenant route tests or isolated PostgreSQL proof fail;
- a full database-and-media restore has not produced
  `database-and-media-ok`;
- the media worker has no fresh heartbeat or no alert on heartbeat age;
- pilot roles, Sunday contacts, incident contacts, and church approvers are
  unnamed;
- the deployed privacy/data map differs from the church agreement; or
- tests are pointed at a production-style remote database.

## 2. Protect the current environment first

- [ ] Record the exact release SHA and preserve unrelated worktree changes.
- [ ] Take the approved database snapshot/export and verify the current media
      archive before applying a schema migration.
- [ ] Run all tests against loopback PostgreSQL or a dedicated remote database
      whose host/database name clearly contains `test`, `ci`, or `sandbox`.
- [ ] For a dedicated remote test database only, set the exact guard:

```text
TEST_DATABASE_CONFIRM=USE DEDICATED REMOTE TEST DATABASE
```

The Vitest setup now loads repository environment configuration and refuses a
production-style remote `DATABASE_URL`. Do not bypass this by renaming a
production database.

### Known test-residue follow-up

A read-only audit on 21 August 2026 found 19 historical `org_trust_*`
organization/audit pairs in the configured remote database; three were created
during the integration-suite validation that led to the test guard. No cleanup
was performed. A separately approved, exact-ID cleanup and audit review is
required before calling the environment clean. Do not use a prefix-wide delete.

## 3. Tenant and source-media preflight

Run these as read-only queries and retain counts, not customer content.

```sql
SELECT count(*) AS source_parent_tenant_mismatches
FROM "SermonSourceAsset" AS asset
JOIN "Sermon" AS sermon ON sermon.id = asset."sermonId"
WHERE asset."organizationId" IS DISTINCT FROM sermon."organizationId";

SELECT count(*) AS legacy_or_mismatched_source_keys
FROM "SermonSourceAsset" AS asset
WHERE position(
  '/organizations/' || asset."organizationId" ||
  '/sermons/' || asset."sermonId" || '/'
  IN '/' || asset."objectKey"
) = 0;
```

- [ ] Both counts are zero, or every exact mismatch has a reviewed migration
      plan and backup.
- [ ] Confirm `SOURCE_MEDIA_S3_KEY_PREFIX` matches the deployed key layout.
- [ ] Verify one same-tenant upload, resume, complete, preview, and worker
      materialization in the isolated pilot environment.
- [ ] Verify an altered organization/sermon owner is denied before S3 signing
      or `GetObject`.

Read-only preflight evidence on 21 August 2026: 6 source-asset rows, 0 parent
tenant mismatches, and 0 legacy/mismatched object keys. Re-run immediately
before rollout because this count can change.

Legacy non-prefixed objects now fail closed. Do not add a broad compatibility
exception; re-key exact approved objects or retain the old release until a
reviewed migration is ready.

## 4. Apply and activate the RLS layer

Migration:

```text
prisma/migrations/20260821160000_phase1_pilot_tenant_rls/migration.sql
```

- [ ] Rehearse the repository's safe migration path against a disposable clone.
- [ ] Review lock time and the `NOT VALID` source-asset foreign key.
- [ ] Apply using the migration-owner credential during the approved window.
- [ ] Confirm the migration exists in schema history and all policies/functions
      are present.
- [ ] Provision a separate web runtime role that is non-owner, non-superuser,
      and explicitly `NOBYPASSRLS`; grant only required schema, table, sequence,
      and function privileges.
- [ ] Keep migration credentials out of the web and worker runtime.
- [ ] Point the web runtime to the non-owner role and run same-tenant smoke
      checks before cross-tenant denial checks.

The policies intentionally allow existing background-worker operations when no
transaction-local tenant is present. Pilot-critical source preview, clip
preview/download, and content-pack reads establish transaction-local tenant
context. Other operations still depend on their existing application
predicates. Do not describe the database as comprehensively RLS-enforced yet.

On a migrated disposable database with `CREATE ROLE` permission, execute:

```bash
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-tenant-rls.sql
```

The script creates temporary fixtures and a `NOBYPASSRLS` role inside a
transaction, proves direct Sermon and inherited ProcessingJob isolation, and
rolls back. It must never target the live database.

After the parent-tenant mismatch count is zero, validate the new constraint in
a separately reviewed low-traffic window:

```sql
ALTER TABLE "SermonSourceAsset"
  VALIDATE CONSTRAINT "SermonSourceAsset_sermon_tenant_fkey";
```

Do not enable `FORCE ROW LEVEL SECURITY` or move the media worker to the web
runtime role until every worker query has been audited; doing so now can reduce
availability.

## 5. Media-worker heartbeat

No new heartbeat migration is required; the repository already has the
`WorkerHeartbeat` table. The media worker now upserts a `MEDIA` service signal
and the health page reports online, stale, or never seen.

- [ ] Confirm the existing WorkerHeartbeat migration is applied.
- [ ] Set a stable, non-secret `MEDIA_WORKER_ID` per worker.
- [ ] Keep `MEDIA_WORKER_HEARTBEAT_SECONDS` at 30 seconds initially.
- [ ] Optionally set `MEDIA_WORKER_HEARTBEAT_STALE_SECONDS`; default is 120
      seconds and should be longer than two heartbeat intervals.
- [ ] Start the worker and confirm `/health` shows **Sermon processing worker —
      OK**.
- [ ] Stop the isolated worker and verify the health view becomes stale and the
      operator alert fires without losing queued work.

Heartbeat writes are best-effort and deliberately cannot stop processing.
Alerting therefore needs both heartbeat age and queue/job-age checks.

## 6. Backup, archive, retention, and restore

Follow [Pilot recovery and restore drill](./pilot-recovery-and-restore-drill.md).
At minimum:

- [ ] Choose an encrypted absolute `PILOT_BACKUP_ROOT` outside the repository
      and `SERMON_STORAGE_ROOT`.
- [ ] Install compatible `pg_dump`, `pg_restore`, and `psql` tools.
- [ ] Use a direct database URL for backup and archive-only private R2
      credentials.
- [ ] Preview and apply archive upload, then verify it.
- [ ] Preview the backup, then create it only with:

```text
PILOT_BACKUP_CONFIRM=CREATE READ ONLY PILOT BACKUP
```

- [ ] Copy the bundle to an approved encrypted off-host destination and compare
      checksums there.
- [ ] Hydrate into a fresh isolated media root.
- [ ] Restore only to a fresh, empty, loopback database in development/test
      using:

```text
PILOT_RESTORE_CONFIRM=RESTORE INTO ISOLATED EMPTY DATABASE
```

- [ ] Require `database-and-media-ok`, record measured RPO/RTO, and have a
      second operator review the evidence.
- [ ] Install archive, backup, then regenerable-retention timers only after two
      supervised successful runs. Alert when no valid bundle is newer than 26
      hours.

The local bundle contains the database dump and a media inventory, not media
bytes. It is not disaster recovery until the private archive, off-host copy,
and full hydration verification pass.

## 7. Pilot operations activation

Approve and assign the documents linked from
[Pilot operations](./pilot-operations-index.md):

- [ ] church authorization, recording/publication rights, and named pastoral
      approver;
- [ ] deployed data-flow, subprocessor, cross-border, retention, and deletion
      schedule reviewed by the privacy lead/Information Officer and counsel;
- [ ] Sunday operator, backup operator, technical responder, privacy lead, and
      customer contacts;
- [ ] SEV-1–4 response targets and message templates;
- [ ] private/manual publishing default and connector-specific release gate;
- [ ] deletion inventory that covers PostgreSQL, private S3, worker-local
      media, public/private R2, providers, backups, downloads, and social posts;
      and
- [ ] a synthetic incident exercise and failed-backup alert exercise.

## 8. Validation commands

Run in an isolated test environment, never against the configured production
database:

```bash
npx prisma validate
npm run test:worker-runtime
npx vitest run
npx tsc --noEmit
npm run build
```

Also run the rollback-only RLS SQL proof and the full recovery drill described
above. Record command, environment identity without credentials, result,
duration, and reviewer.

## 9. Residual risk and approval owners

| Risk | Current control | Decision needed before pilot |
| --- | --- | --- |
| Owner/superuser bypasses RLS | app predicates plus opt-in policies | approve and provision non-owner web role |
| Unscoped operations have fail-open RLS | existing application scoping | inventory remaining routes before broad launch |
| Legacy S3 key fails closed | strict tenant prefix | zero-count proof or exact re-key plan |
| Backup bundle remains on worker | checksum and atomic bundle | encrypted off-host destination and copy owner |
| Media inventory is not media | private content-addressed archive | successful hydrate and byte verification |
| Public R2 preview URL can be forwarded | short-lived staging policy and church approval | deploy lifecycle/inventory and avoid sensitive clips |
| Heartbeat is best-effort | health page plus job heartbeats | external alert path and named responder |
| Deletion spans many copies/providers | inventory-based procedure | approve retention and customer response language |
| Test-prefixed remote residue exists | test DB guard now blocks recurrence | authorize exact-ID review/cleanup separately |

The pilot owner, technical lead, privacy lead, and Sunday operator should sign
the completed checklist. Expand from five to ten churches only after two
consecutive Sunday cycles meet the reliability, isolation, recovery, support,
and pastoral-safety gates.
