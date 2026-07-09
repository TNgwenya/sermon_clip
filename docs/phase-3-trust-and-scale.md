# Sermon Clip Phase 3 — Trust, publishing fidelity, and workflow scale

## Outcome

Phase 3 turns the premium workflow into a more trustworthy production system. Platform copy now has one canonical source, automatic publishing has an authoritative preflight and live-service signal, Review and Studio avoid expensive first-paint work, Studio preview follows saved crop motion, and the mobile publishing planner is compact enough for real weekly use.

## Implemented

### Canonical platform publishing packets

- One builder now owns TikTok, Instagram, YouTube Shorts, and Facebook title, caption, hashtag, and primary-copy output.
- Ready-to-Post preview, manual handoff, scheduling defaults, saved `ScheduledPost` rows, and publishing workers consume the same payload.
- Platform-specific edits are preserved per clip and per destination instead of being flattened into generic copy.

### Authoritative publishing preflight

- Checks media availability, transcript safety, MP4 output, framing, duration, connected account/provider, platform capability, privacy behavior, and publishing-service health.
- Runs before the user saves a plan and again inside the creation API so direct requests cannot bypass it.
- Automatic schedules are blocked while the publishing service is offline, stale, or in test mode.
- Zernio account readiness now includes exact external-platform matching.

### Publishing heartbeat and safety

- The posting worker sends an authenticated heartbeat with live/test mode and its own platform capabilities.
- Ready-to-Post separates a calm media-team status from expandable technical details.
- A new `WorkerHeartbeat` migration stores durable service signals.
- Status, schedule, cancel, skip, and manual completion mutations are atomically locked while a worker owns a post.
- Worker completion verifies the same claimed post and worker identity.
- Test mode observes due posts without claiming or consuming them.
- Stale worker claims move to a private, verification-required state instead of being retried automatically.
- A successful platform upload and its database receipt are handled separately; receipt persistence retries never repeat the upload.
- Lost or ambiguous provider responses are kept out of the retry queue until a person verifies the platform.
- Private, unpublished, processing, or evidence-free provider responses cannot be recorded as publicly posted.
- Rescheduling, cancelling, and retrying are blocked when a row already contains provider evidence or needs verification.
- High-consequence actions use confirmation dialogs and correction receipts that restore the prior publishing state.

### Faster Review and Studio

- Review removes per-clip filesystem checks from server render and verifies previews only when requested.
- Review video uses `preload="none"` with explicit retry when lazy verification fails.
- Studio parallelizes independent data reads and bounds export-history verification.
- Source-file stat and FFmpeg silence analysis no longer block first paint.
- Exact audio analysis runs through a deferred endpoint only when Audio approaches the viewport.

### More faithful Clip Studio

- Live preview interpolates saved crop keyframes for horizontal position, vertical center, and zoom.
- Automatic crop language distinguishes a representative frame from movement applied during preparation.
- The opaque Creator Readiness percentage is replaced by Required, Recommended, and Optional checks.
- Studio shortcuts now require `Alt`, so typing and browser navigation are safe.
- Intro/outro timing was intentionally not simulated because the current renderer still applies those badges statically.

### Mobile workflow

- Studio has a fixed task navigator for Preview, Words, Edit, Frame, Brand, and Output.
- The publishing calendar uses a seven-day mobile window with horizontally snapping day cards.
- Calendar totals now describe the visible window rather than unrelated future weeks.
- Publishing confirmations and service details remain usable above the application navigation.

## Operational requirement

Deploy `prisma/migrations/20260709210000_worker_heartbeats` before starting the updated posting worker. Until that migration is deployed, existing publishing and manual handoff flows remain available, but the heartbeat correctly reports that automatic publishing has not connected and automatic scheduling stays blocked.

## Verification

- ESLint passed.
- TypeScript passed with `npx tsc --noEmit`.
- Full Vitest suite passed: 1,060 tests, with 1 existing integration test skipped.
- Production build passed.
- `git diff --check` passed.
- Browser checks confirmed the seven-day 390 px planner has no page-level horizontal overflow, platform-specific scheduler copy is distinct, and queue/mark-posted actions open explicit confirmation dialogs.

## Deferred to Phase 4

- Make intro and outro badge timing a true renderer feature, then mirror it exactly in live preview.
- Add first-class cover-frame and thumbnail selection per platform.
- Add post-publish reconciliation that imports the final platform URL/status when a provider callback is delayed.
- Add team roles and approval permissions once workspace membership is introduced.
