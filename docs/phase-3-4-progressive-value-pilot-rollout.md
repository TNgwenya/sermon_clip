# Phases 3 and 4: progressive value and Pastor-first pilot rollout

## Release decision

This implementation is suitable for an isolated pilot verification, not an
unattended broad launch. It makes saved value visible earlier and makes the
default review path smaller, but it does not establish a measured processing
SLA or remove the Phase 1 and Phase 2 deployment gates.

No Phase 3/4 database migration, dependency, environment variable, queue,
connector, or cloud-service change is required. Phase 3 reads the additive
Phase 2 orchestration records when they exist and continues to show saved clip
evidence when later stages fail or are stopped.

## Customer-visible sequence

1. Intake starts with the source URL/upload, permission confirmation, and one
   **Analyze this sermon** action. Saved metadata and advanced source-window
   controls remain available through disclosures.
2. The sermon page reports distinct evidence-backed milestones: early-value
   work, ranked suggestions, first current branded clip, playable priority
   clips, and the requested full content set.
3. Pastor Review defaults to one strongest playable undecided moment, with the
   source sermon, exact time window, duration, short rationale, and optional
   transcript/provenance context.
4. The pastor has three primary decisions: **Approve & use**, **Adjust in Quick
   Finish**, and **Leave out**. Approval retains a clip for the team; it does
   not export, schedule, publish, or send it.
5. Existing filters, grids, scoring, batch work, media recovery, crop, and
   production controls remain under **Manage all moments**.
6. Publishing starts with one sermon and one post. Queue counts, calendar,
   history, batch preparation, and other operational tools remain behind the
   publishing overview/advanced disclosure.

## Safety invariants

- Suggestions are called ready only when durable clip candidates exist.
- “First branded clip” requires playable media plus a completed, current Brand
  Kit overlay. A raw or stale fallback is never labelled branded.
- “Top review clips” uses actual playable-media evidence, not job success
  alone. Quick Review skips candidates with no playable preview and shows an
  explicit incomplete state when none is ready.
- “Full content set” is not ready while requested content work is unfinished.
  Deferred lower-ranked previews remain described as optional/on demand.
- A current successful replay takes precedence over an older failed attempt.
  Dead-letter, cancellation, safety-blocked, partial, and failed states keep
  completed suggestions/media visible without claiming the whole workflow is
  finished.
- No precise ETA is fabricated. The only review estimate is a coarse estimate
  of human decision time, not processing time.
- Transcript safety gates still disable approval. Exact words, source window,
  context, and provenance remain available, and required transcript review is
  never collapsed away.
- The three Quick Review actions reuse the existing approval/rejection and
  Studio routes. No new render, export, approval bypass, publish intent,
  connector call, or automatic send was introduced.
- Intake retains the existing server action, required permission field,
  validations, worship requirements, and source-window semantics.

## Deployment prerequisites

Complete the Phase 1 pilot checklist and Phase 2 orchestration rollout first.
In particular:

1. preserve the exact release SHA and all unrelated work;
2. verify database backup, private media inventory, and isolated restore drill;
3. apply the Phase 1 tenant/RLS migration, then the Phase 2 orchestration
   migration, using the approved migration credential and window;
4. prove cross-tenant denial with the real least-privilege, non-owner runtime
   role in an isolated database;
5. deploy with `ORCHESTRATION_CONTROL_PLANE_ENABLED` absent or false first;
6. verify the existing intake and media worker before starting one staged
   orchestration worker;
7. confirm fresh media and orchestration heartbeats, bounded retries, zero
   unexplained dead letters, and the existing manual publishing default; and
8. only then enable Phase 2 intake for one internal or synthetic sermon.

Phase 3/4 has no additional configuration. Do not add a real queue, enable a
social connector, change Brand Kit defaults, or broaden worker concurrency as
part of this UI rollout.

## Staged pilot verification

### Stage 1 — isolated evidence path

- Process one short synthetic sermon and one representative 60–125 minute
  sermon from both supported source modes.
- Confirm suggestions become usable before preview completion.
- Confirm the strongest eligible clip receives the first branded preview, then
  at most the priority review set; lower-ranked preview and Content Week work
  must not delay that path.
- Force an isolated preview failure. Suggestions must remain reviewable; the
  UI must not label raw/stale media branded or the sermon fully complete.
- Exercise cancellation, a bounded retry, worker lease loss, dead-letter
  review, and safe replay. Completed evidence must remain visible and an old
  failure must not replace the latest success.

### Stage 2 — pastoral workflow

- At 390×844 and desktop widths, test YouTube, upload, validation errors,
  resumed/event intake, browser text zoom, keyboard-only navigation, and visible
  focus.
- Confirm source input, permission, and primary action are usable in the first
  intake viewport; validate the optional sermon window for a full service.
- In Pastor Review, confirm exactly one playable undecided clip is shown, the
  source/time context is correct, and the three decisions advance focus to the
  next playable clip.
- Confirm transcript-review-required clips cannot be approved. Confirm Adjust
  opens the existing Studio without changing approval and Leave out uses the
  existing rejected state.
- Confirm Manage all moments exposes every previous advanced capability.
- Confirm Quick Finish leads the workflow language, while Studio remains fully
  available as the advanced editor.

### Stage 3 — publishing and recovery

- Open publishing unscoped, scoped to a sermon, clip, unapproved post, and
  approved post. Each first screen should identify one next object/action.
- Confirm approving a clip or content revision does not export, schedule,
  publish, or send without the existing explicit follow-on intent.
- Test an interrupted upload, an unknown page error, an old/private share link,
  and a real public `/s/[slug]` page. Confirm safe recovery copy, support
  reference, tenant-safe 404 language, and compiled public-page layout.
- Verify the Sunday operator can distinguish queue delay, suggestions ready,
  first branded clip ready, top clips ready, and full requested content ready.

## Validation commands

Use a loopback or explicitly dedicated test database. The repository guard
must reject production-looking test targets.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sermon_clip_phase2_test \
  npx vitest run \
  src/lib/__tests__/orchestrationProgress.test.ts \
  'src/app/sermons/[id]/review/clip-review-card.test.tsx' \
  src/lib/__tests__/publishingFocus.test.ts \
  src/app/ready-to-post/__tests__/sermon-publishing-library.test.tsx

npx eslint \
  src/lib/orchestrationProgress.ts \
  'src/app/sermons/[id]/progress-milestones.tsx' \
  'src/app/sermons/[id]/review/review-experience.tsx' \
  'src/app/sermons/[id]/review/clip-review-card.tsx' \
  src/app/sermons/new/page.tsx \
  src/app/sermons/new/new-sermon-form.tsx \
  src/app/error.tsx src/app/not-found.tsx \
  src/app/ready-to-post/page.tsx src/lib/publishingFocus.ts

npx tsc --noEmit
npm run build
git diff --check
```

## Rollback

Phase 3/4 can be rolled back at the application-release level because it adds
no schema or configuration. Do not drop Phase 1/2 tables during a UI rollback;
retain orchestration, outbox, audit, approval, and media evidence. If Phase 2
must also be operationally disabled, set its feature flag false and stop only
the staged worker as documented in the Phase 2 rollout.

## Known limitations and pilot stop conditions

- Processing and queue ETAs remain qualitative until pilot percentiles exist.
  Do not promise “clips in minutes.”
- Review props do not currently include authenticated role data, so Quick
  Review versus advanced communications tools is explicit but not
  role-personalized.
- Responsive behavior has compile/CSS coverage, not a signed-in real-device
  evidence run. Complete the Stage 2 checks before admitting churches.
- Phase 3 visibility depends on honest artifact metadata. A pilot must verify
  overlay freshness, playable object access, and cross-machine media
  materialisation in the deployed topology.
- Stop the rollout if any user can see another church’s rows/media, a stale or
  raw preview is labelled branded, a transcript safety gate can be bypassed,
  an approval triggers publish/send, the UI reports full completion with
  deferred requested work, or the operator cannot identify a failed lane.
