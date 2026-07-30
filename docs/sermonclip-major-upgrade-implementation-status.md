# SermonClip Major Upgrade — Implementation Status

**Implementation date:** 29 July 2026
**Roadmap:** [SermonClip Major Upgrade Strategy](./sermonclip-2026-major-upgrade-strategy.md)

## Release outcome

This implementation establishes the first integrated version of the church
content operating system:

> A completed sermon can automatically become one tenant-isolated Week Draft,
> a pastor can review it one item at a time, the team can manage accountable
> handoffs, and only approved, composition-locked content can move into
> publishing and evidence-bound learning.

The automatic **5–7 setting controls the total number of pieces in a Week
Draft**. It does not change how many clips the existing clip engine generates.
The default is six total pieces, selected from existing review-safe clips,
graphics, written ideas, devotionals, prayers, recaps, and communication
assets. Manual Week Drafts remain unlimited.

## Phase delivery

### Phase 0 — Stabilization

- Repaired the Brand Kit client/server boundary.
- Updated the browser smoke path and mobile navigation coverage.
- Added safe PostgreSQL deployment assertions and clean-database rehearsal.
- Preserved the existing unit, lint, TypeScript, build, and browser gates.

External trademark clearance and pilot-church recruitment remain CEO/legal and
customer-development work; they cannot be completed in source code.

### Phase 1 — SaaS trust foundation

- Added organizations, campuses, users, profiles, memberships, roles,
  invitations, entitlements, usage events, audit events, and ownership
  transfers.
- Added password credentials, provider identity links, secure revocable
  sessions, enforced TOTP/recovery-code sign-in, and one-time security tokens.
- Added login, logout, invitation acceptance, lockout, session expiry, session
  revocation, invitation administration, offboarding/reassignment, and
  ownership-transfer services.
- Added `/settings/account` for profile management, password rotation,
  authenticator enrollment, one-time recovery codes, MFA removal, device
  review, per-session revocation, and password-confirmed sign-out everywhere.
- Disabled the shared Basic-authentication bridge in production; it remains
  available only for local development and browser smoke.
- Replaced client-asserted identity with proxy-attached trusted request context
  and persisted role/capability checks.
- Scoped the primary sermon, content, Week Draft, collaboration, publishing,
  growth, archive, export, preview, and administrative paths to the active
  organization/campus.
- Added default entitlements and AI usage enforcement.
- Added `/settings/team` for roles, campus scope, invitations, revocation, and
  safe staff handover.

Defense-in-depth row-level security, managed private object storage, managed
queues, SSO/SCIM, and completed backup/incident drills remain production
platform gates.

### Phase 2 — Week Draft autopilot

- Added canonical `WeekDraft`, `WeekDraftItem`, and immutable item revisions.
- Added an idempotent, advisory-locked, serializable automatic assembler.
- Automatic assembly runs after content generation completes and can safely
  retry if five review-safe sources are not available yet.
- Added configurable 5/6/7 total-piece mixes with balanced, social,
  discipleship, and church-communications preferences.
- Added source ranking, lineage deduplication, preview readiness, content
  safety checks, and at least three formats when the available source set
  supports them.
- Added `/week-drafts` and mobile-first one-card review with exact provenance,
  timestamps, revision identity, progress, and only three pastor decisions:
  approve, request wording changes, or leave out.
- Kept Advanced Studio as a secondary path.

Church glossary administration, multilingual output, and measured 99%
preview/under-eight-minute pilot results remain follow-on launch experiments.

### Phase 3 — Collaboration and handover

- Added assignments, assignees, due dates, comments, mentions, approval
  policies, approval requests, decisions, and immutable policy snapshots.
- Added `/inbox` for approvals, urgent assignments, and mentions.
- Added exact target authorization, required change reasons, revision locking,
  audit events, and mobile approval.
- Staff offboarding reassigns or cancels open collaboration work and revokes
  active sessions.

Notification delivery/read receipts and expiring public review links remain
future delivery work. The implemented review flow is authenticated
workspace-only.

### Phase 4 — Reliable publishing and growth

- Added approval-gated publishing, immutable composition checksums, canonical
  payload verification, tenant binding, idempotent claims, duplicate
  protection, and last-moment revalidation.
- Added tenant-scoped publishing desk, drafts, downloads, preflight,
  scheduling, worker validation, completion receipts, and recovery paths.
- Added exact export authorization for content downloads and guide generation,
  plus capability- and tenant-scoped scheduled-post reads and mutations.
- Added evidence-bound growth recommendations using fresh tenant aggregates,
  minimum sample sizes, immutable approved copy, and theological rewrite
  prohibitions.
- Added tenant-scoped analytics, campaigns, outcomes, forecasts, credentials,
  and connector status.
- Added a weekly Publishing Board with explicit Needs work, Ready, Scheduled,
  and Check result states, plus honest manual-download fallbacks.
- Added a public sermon growth hub with approved-only resources, a privacy-safe
  next-step CTA, aggregate outcome tracking, and a narrowly isolated public
  route boundary.

Provider app approval, Planning Center, webhook reconciliation, and verified
third-party ingest partnerships remain external integration programs.

### Phase 5 — Intelligence safety foundation

- Tenant-scoped the Knowledge Base and ministry-intelligence dashboard.
- Added an archive-answer release gate that requires exact citations, valid
  source identities, tenant match, review/privacy eligibility, quote
  grounding, and Scripture evidence.
- Added cross-tenant, uncited, stale, ambiguous, and sensitive-evidence tests.

The interactive archive Q&A product, knowledge graph, multilingual review,
peer benchmarks, enterprise federation, public API, and compliance programs
remain later product increments. The safety boundary is implemented before
those surfaces are exposed.

### Competitive activation and Studio upgrade

- Added a persisted five-step `/onboarding` checklist for church identity,
  Brand Kit, owned channels, weekly cadence, and pastor approval.
- Simplified sermon intake into a source-first flow with saved church and
  preacher defaults.
- Added `/settings/intake` for explicit future-recording consent, selected
  YouTube channel, workflow defaults, recent scan/import evidence, and
  fail-closed automatic-import readiness.
- Added a persistent media-worker sweep that discovers eligible new public
  YouTube sermons, deduplicates them, and queues the normal sermon workflow.
- Added secure, non-enumerating password reset with single-use hashed tokens,
  session revocation, audit events, and configurable HTTPS delivery.
- Split Clip Studio into **Quick Finish** and an intentional **Advanced
  Studio**, with an editor rail, live project status, readiness summary,
  undo/redo, keyboard discovery, and diagnostics hidden from ordinary users.
- Added competitive quality gates for preview availability, review coverage,
  keeper rate, render success, context safety, and visual readiness. Small
  samples are reported as needing evidence instead of being presented as
  performance conclusions.

Automatic YouTube intake requires a connected, tenant-owned YouTube credential
and a continuously running media worker. Password-reset email requires the
configured transactional HTTPS delivery webhook. Those deployment settings are
launch configuration gates, not simulated product capabilities.

## Release gates

The code is suitable for continued pilot validation only after all of the
following pass in the target environment:

1. Prisma format, validate, client generation, and safe-deploy rehearsal.
2. Full unit/integration suite, ESLint, TypeScript, and production build.
3. Desktop and 390 px browser smoke for login, Week Draft review, Inbox, Team,
   publishing, Growth, Brand Kit, Knowledge Base, and logout.
4. Two-organization isolation tests for enumerate, read, mutate, export,
   publish, analytics, credentials, AI cache, collaboration, and recovery.
5. Real-media preview and publishing receipt tests.
6. Backup restore, worker-loss, credential-revocation, and duplicate-publish
   drills.

General multi-tenant production launch must stay closed until the remaining
Phase 1 platform gates and the three-pilot-church isolation exercise pass.

## Final local verification

The combined implementation passed the following gates on 29 July 2026:

- all 54 Prisma migrations on a clean PostgreSQL database, followed by a
  no-pending-migrations idempotency pass;
- a populated, historyless-schema recovery rehearsal;
- rollback-only database probes proving cross-organization and cross-campus
  revision writes are rejected;
- Prisma format, schema validation, and client generation;
- repository-wide ESLint, TypeScript, and whitespace validation;
- 263 test files and 2,502 tests, with three explicitly skipped real-media or
  fixture-dependent integration cases retained as launch gates;
- the optimized Next.js production build; and
- four passing Playwright journeys covering the pastor workflow, Brand Kit,
  health, and 390 px mobile navigation. The secure sign-in journey remains
  explicitly skipped unless the release environment supplies the bootstrap
  owner password.

The isolated rehearsal database is retained only for the local product demo;
it is not a production data source.
