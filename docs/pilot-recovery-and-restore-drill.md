# Pilot recovery and restore drill

## What this provides

Phase 1 recovery uses two portable layers:

1. PostgreSQL is exported in PostgreSQL custom format with `pg_dump`. The
   resulting file is checked with `pg_restore --list` and protected by a
   SHA-256 checksum.
2. Durable media continues to use the existing private, content-addressed R2
   archive. The backup bundle contains a checksummed **media inventory**, not
   the media bytes. Archive upload, remote verification, and isolated
   hydration are separate required steps.

The scripts do not require a new SaaS provider or a repository-specific backup
format. They use PostgreSQL tools, JSON manifests, SHA-256, and the existing
S3-compatible archive.

The backup command is read-only against PostgreSQL and local media. The restore
drill refuses remote database targets, refuses a source/target match, requires
an empty target, and never drops or cleans a database. Both commands are
dry-run by default.

## Recovery boundary and current service level

For the pilot, use these internal objectives until two successful drills prove
better numbers:

- Database recovery point objective (RPO): 24 hours with daily exports. A
  managed PostgreSQL point-in-time recovery feature may reduce this, but does
  not replace the independent export.
- Durable-media RPO: 24 hours with a daily archive upload after Sunday
  processing. A source uploaded to private S3 remains an additional source
  copy, but it is not a substitute for the complete archive.
- Recovery time objective (RTO): four hours for one church's current sermon.
  This is a target, not a promise, until measured with a representative media
  set and a production-sized database snapshot.

The database backup bundle must be copied to an approved encrypted off-host
backup destination. A bundle left only on the media worker does not count as a
backup. Restrict the bundle directory to the backup operator and never place
it in the repository, the public preview bucket, or `SERMON_STORAGE_ROOT`.

## Prerequisites

- `pg_dump`, `pg_restore`, and `psql` must be installed. `pg_dump` must be at
  least the major version of the PostgreSQL server.
- `DATABASE_URL` must be the direct PostgreSQL connection, not the pooled URL.
- `SERMON_STORAGE_ROOT` must identify the worker's active media root.
- `PILOT_BACKUP_ROOT` must be an absolute directory outside
  `SERMON_STORAGE_ROOT`, for example `/var/lib/sermonclip-recovery`.
- The archive bucket must be private and use archive-only credentials.
- The backup destination and R2 bucket must have provider-side encryption,
  access logging where available, and credentials separate from the web app.

Do not put database URLs or archive credentials in shell history. On a deployed
worker, provide them through its root-readable environment file or secret
manager. The scripts do not print passwords.

## Daily backup sequence

Run the sequence on the persistent media worker after routine processing has
settled. First inspect every plan; enable automation only after one supervised
run succeeds.

### 1. Upload and verify durable media

The archive upload is additive and never deletes source files or remote blobs.

```bash
npm run storage:archive -- upload
npm run storage:archive -- upload --apply
npm run storage:archive -- verify
```

`verify` must succeed before the run is recorded as a successful media backup.

### 2. Plan the database backup and media inventory

```bash
node --experimental-strip-types --loader ./scripts/ts-path-loader.mjs scripts/pilot-backup.ts
```

The dry run parses the database target, verifies the PostgreSQL tools, and
hashes the local durable-media inventory. It does not connect to PostgreSQL,
create files, or contact R2.

### 3. Create the recovery bundle

Set the exact confirmation only in the protected timer environment, then run:

```bash
export PILOT_BACKUP_CONFIRM='CREATE READ ONLY PILOT BACKUP'
node --experimental-strip-types --loader ./scripts/ts-path-loader.mjs scripts/pilot-backup.ts --apply
```

Each `pilot-backup-<timestamp>` directory contains:

- `database.dump`: PostgreSQL custom-format database export;
- `media-manifest.json`: paths, sizes, object keys, and SHA-256 hashes for
  durable local media; and
- `backup-manifest.json`: version, tool versions, sizes, and checksums for both
  artifacts.

The script writes to a private partial directory, validates the dump contents,
then atomically renames the completed bundle. A lock prevents overlapping runs.
It never modifies the source database or source media.

### 4. Copy the bundle off the worker

Use an approved encrypted backup repository or encrypted volume snapshot. The
copy process is deployment-specific and is deliberately not embedded in the
application, keeping the recovery bundle portable. After copying, compare the
two artifact checksums with `backup-manifest.json` at the destination.

Keep at least 14 daily database bundles and 8 weekly bundles during the pilot.
Use the destination provider's versioned lifecycle policy for pruning. Do not
automate R2 blob deletion in Phase 1. Review removal separately against sermon,
publishing, consent, legal-hold, and customer-deletion state.

### 5. Run regenerable-media retention

Only after media archive verification and database backup succeed:

```bash
npm run storage:retention
npm run storage:retention -- --apply
```

This existing command removes only regenerable render intermediates, logs, and
transcription caches for old, idle projects. It excludes active processing and
any project referenced by a scheduled post. It does not delete durable source,
audio, transcript, final export, subtitle, thumbnail, content asset, branding,
or archive objects.

## Safe automation

Use three separate least-privilege services rather than one compound shell
command. This makes each result observable and prevents retention from running
when an earlier unit fails:

1. 01:00 daily: archive upload, followed by archive verify.
2. 02:00 daily: pilot backup bundle, configured with `After=` and `Requires=`
   on the successful archive service.
3. 03:00 daily: regenerable-media retention, configured with `After=` and
   `Requires=` on the successful backup service.

For each service:

- set the repository as `WorkingDirectory`;
- run as a dedicated non-login user;
- load secrets from a root-readable environment file with mode `0600`;
- set `UMask=0077`, `PrivateTmp=true`, and `NoNewPrivileges=true`;
- use `Type=oneshot` and reject overlapping runs;
- retain stdout/stderr in the system journal; and
- alert if the unit fails or if no completed bundle is newer than 26 hours.

Do not install or enable timers until the deployment checklist has been
reviewed. Timer installation changes host configuration and is outside this
local Phase 1 implementation.

## Executable isolated restore drill

The full drill has a database part and a media part. A database-only result is
useful diagnostics but does not prove media recovery.

### 1. Choose and verify a bundle

Run the restore command without `--apply`:

```bash
node --experimental-strip-types --loader ./scripts/ts-path-loader.mjs scripts/pilot-restore-drill.ts \
  /absolute/path/to/pilot-backup-YYYY-MM-DDTHH-MM-SS-Z
```

This checks the bundle schema, artifact sizes, SHA-256 hashes, PostgreSQL dump
catalog, and media manifest. It does not connect to a database or write media.

### 2. Create a fresh isolated database

Create a new local database whose name contains `restore`, `drill`, or `test`,
for example `sermon_clip_restore_20260821`. Never reuse a developer database.
The drill checks that it has zero public tables and refuses to clean it.

Set:

```text
NODE_ENV=test
PILOT_RESTORE_DATABASE_URL=postgresql://...@127.0.0.1:5432/sermon_clip_restore_20260821
PILOT_RESTORE_CONFIRM=RESTORE INTO ISOLATED EMPTY DATABASE
```

The target must be loopback-only. It must not match `DATABASE_URL`, even if the
password differs. A partial or failed restore leaves the isolated database in
place for diagnosis; create another empty database before retrying.

### 3. Hydrate media into an isolated root

Choose a new empty directory outside the live `SERMON_STORAGE_ROOT`, set that
directory as both `SERMON_STORAGE_ROOT` for archive hydration and
`PILOT_RESTORE_MEDIA_ROOT` for verification, then preview and apply hydration:

```bash
npm run storage:archive -- hydrate
npm run storage:archive -- hydrate --apply
```

Hydration downloads from the private archive, checks each SHA-256, refuses
symbolic-link traversal, and does not overwrite a different file unless an
operator separately supplies `--overwrite`. Do not use `--overwrite` in the
pilot drill; use a fresh directory instead.

### 4. Restore and verify

Run:

```bash
node --experimental-strip-types --loader ./scripts/ts-path-loader.mjs scripts/pilot-restore-drill.ts \
  /absolute/path/to/pilot-backup-YYYY-MM-DDTHH-MM-SS-Z --apply
```

The script restores with `--exit-on-error`, verifies the Organization, Sermon,
and ProcessingJob tables, reports row counts, tolerates a legitimate
historyless database with no `_prisma_migrations` table, and checks every
hydrated media file against the saved inventory. The full success status is
`database-and-media-ok`.

If `PILOT_RESTORE_MEDIA_ROOT` is absent, the result is explicitly
`database-ok-media-not-exercised`; this must not be recorded as a completed
recovery drill.

### 5. Record evidence

Record without customer names, URLs, transcript text, or credentials:

- bundle creation time and age;
- archive manifest generation time;
- database and media verification status;
- start time, finish time, and measured RTO;
- restored table counts and media file count;
- operator and reviewer;
- every warning/failure and corrective action; and
- the next drill date.

Do not delete the isolated database or hydrated media as part of the script.
Cleanup is a separate, reviewed action against exact isolated targets.

## Pilot acceptance gates

Recovery is pilot-ready only when all are true:

- one supervised database backup and full database-and-media restore succeeds;
- the restored church can open one representative sermon, transcript, approved
  clip, final export, content asset, and Brand Kit item without using live
  storage;
- SHA-256 verification reports no missing or mismatched media;
- two consecutive daily automated runs complete and alerting detects a forced
  non-destructive failure such as an unavailable test destination;
- an operator other than the author can complete the runbook;
- the measured current-sermon RTO is at most four hours; and
- the off-host copy and managed PostgreSQL recovery windows meet the stated
  24-hour RPO.

Run a small database-only drill monthly and a full media hydration drill at
least quarterly during the pilot. Also run a full drill before any destructive
migration, storage move, or broad launch.

## Deployment and configuration checklist

No item below has been applied by this implementation.

1. Choose an absolute `PILOT_BACKUP_ROOT` on encrypted storage outside the
   repository and `SERMON_STORAGE_ROOT`; create it with owner-only access.
2. Install compatible PostgreSQL client tools and record their versions.
3. Confirm `DATABASE_URL` is direct and grants only the permissions required
   for a consistent dump; do not use `DATABASE_POOL_URL` for backup.
4. Provision and test archive-only R2 credentials against the private Standard
   bucket; do not reuse public-preview credentials if separation is available.
5. Confirm the backup destination's encryption, versioning, retention,
   access-log, and restore-access settings.
6. Supervise archive upload/verify and one backup creation.
7. Copy the bundle off-host and independently compare checksums.
8. Complete the full isolated restore drill and record measured RPO/RTO.
9. Install services/timers in archive, backup, retention order; enable alerts
   for failure and backup age over 26 hours.
10. Re-run the drill after PostgreSQL major upgrades, archive format changes,
    media path migrations, or credential rotation.

## Remaining risks and decisions

- The repository cannot prove Neon point-in-time recovery, provider backup
  retention, R2 versioning, or cloud encryption settings; verify these in the
  vendor consoles and contracts.
- A local recovery bundle is not off-host protection until the deployment adds
  the encrypted copy step.
- The media inventory records local durable files. Direct-upload source objects
  in AWS S3 are referenced by PostgreSQL and are not copied into the R2 archive
  until local materialization/archive runs. Pilot operations must verify that
  current sermons appear in the R2 manifest before retention or host changes.
- R2 archive pruning remains intentionally absent. A wrong automatic delete is
  higher risk than the modest pilot storage cost.
- Recovery of third-party social tokens proves database recovery, not that a
  platform token is still valid. Connector reauthorization is a separate
  incident procedure.
- The four-hour RTO and 24-hour RPO are internal pilot targets, not contractual
  claims, until repeated drills establish them.
