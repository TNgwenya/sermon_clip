# MVP 3 Technical Debt Review

Date: 2026-06-18

## Known Shortcuts

- Local schema sync may rely on `prisma db push` when migration history is drifted.
- Some operation logs are still emitted ad hoc by individual agents instead of a shared structured logger.
- Clip actions prioritize incremental safety checks over deeper orchestration workflows.

## Refactor Targets

1. Migration integrity
- Establish a clean migration baseline and enforce no-edit policy for applied migrations.
- Add CI guard that runs `prisma migrate status` and fails on drift.

2. Workflow orchestration
- Introduce a typed workflow state machine for clip-level transitions.
- Centralize preflight validation policies for all asset stages.

3. Logging and observability
- Add a unified operation logger used by all agents.
- Persist operation durations and correlation IDs for troubleshooting.

4. Storage lifecycle
- Add cleanup for stale partial render/export files.
- Add archival policy for obsolete outputs after regeneration.

5. Test depth
- Add integration tests for weekly path, retries, and concurrent action contention.
- Add tests for regeneration batch outcomes under mixed success/failure.

## Current Limitations

- MVP currently assumes single-operator local usage patterns.
- No queue-backed execution model for long-running media workloads.
- Limited proactive remediation for pending/outdated assets.

## Priority Order

1. Migration integrity and deployment parity
2. Shared operation telemetry and diagnostics
3. End-to-end workflow integration tests
4. Storage cleanup and retention controls
5. Queue-backed execution model
