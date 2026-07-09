# Sermon Clip Phase 2 Product-Experience Audit

Date: 2026-07-09

## Executive assessment

Phase 1 established a strong premium studio language. Phase 2 found that the main remaining risk is workflow truth: the interface does not always distinguish clearly between selected, saved, approved, prepared, scheduled, and published states. Those gaps are more likely to erode confidence than visual polish.

The experience should behave like a calm guided production workflow:

1. Choose one supported sermon source.
2. Confirm the sermon and its boundaries.
3. Watch four honest automated analysis stages.
4. Make clear human decisions in Review.
5. Edit an explicitly unsaved draft in Clip Studio.
6. Prepare a final video with a truthful state.
7. Complete a clear manual handoff or verified publishing workflow.

## Top 10 workflow friction points

1. Import copy promises broader public-link support than the YouTube-only downloader provides, and link and file sources can both be populated.
2. Upload success and partial failure do not provide a decisive handoff to the already-created sermon workspace.
3. Processing progress includes human review and post-production steps, making completed analysis appear incomplete.
4. Review emphasizes approval while hiding the negative decision, preview recovery, and a useful completion handoff.
5. AI scores and recommendations are precise-looking without a sufficiently clear scale, rationale, or separation from workflow status.
6. Studio edits remain client-side until preparation, although several labels imply they have been saved.
7. Output-shape and manual-crop controls can produce a prepared result that differs from the user's visible selection.
8. Preparation stages advance on a timer rather than verified backend state.
9. Ready-to-Post platform previews are not guaranteed to be the canonical scheduled or published payload, and automatic publishing is offered too confidently.
10. Mobile workflows are structurally long; Studio exceeds 7,600 document pixels at 390px wide, and publishing overlays/actions can conflict with fixed navigation.

## Top 10 opportunities

1. Make source selection explicitly exclusive: YouTube link or uploaded recording.
2. Ask whether the source is a sermon-only recording or a full service and explain why boundaries matter.
3. Redirect successful intake directly to live processing.
4. Use four automated stages, exact progress only when known, and plain queued/working/delayed/failed states.
5. Make Review a guided sequence: Approve, Edit in Studio, Not this clip, then the next undecided moment.
6. Present AI evidence as clip potential, why it was selected, context check, and recommended action.
7. Establish a clear Studio contract: unsaved draft, prepared final video, publishing desk.
8. Make preview claims match actual format, crop, caption, and branding behavior.
9. Turn Ready-to-Post into an ordered handoff: download, copy, open the correct platform upload surface.
10. Put recovery beside the affected item and move raw worker/vendor details into technical disclosures.

## Developer-made language and behavior

- Legacy score, Curate feed, FFmpeg estimate, local worker, Mac worker, raw job enums, file paths, and raw publishing errors.
- A second opaque Creator readiness percentage beside the AI score.
- Pixel-based Safe offset and overlapping platform, shape, and final-format controls.
- Configured channel without a verified publishing account.
- Post now for an action that only queues a worker job.
- Green ready states that can still be blocked by media, safety, or validation gates.

## Unclear next steps

- After successful or partially successful intake.
- While a job is queued rather than running.
- When analysis is complete but overall progress appears incomplete.
- When a suggested clip has no playable preview.
- After the last Review decision, particularly when all suggestions were rejected.
- After Studio edits, when save, approve, prepare, and render are conflated.
- In Ready-to-Post, where download, copy, schedule, and platform upload compete.
- After a failed publishing attempt that is not part of the default desk view.

## Guidance, preview, and confirmation needs

- Confirm the chosen source and supported provider before analysis.
- Explain the benefit of sermon boundaries for full services.
- Put transcript/context acknowledgement next to approval.
- Give missing or stale previews a direct recovery action.
- Confirm curation before it changes unseen suggestion statuses.
- Warn before leaving Studio with an unsaved draft.
- Show a preparation preflight covering shape, formats, captions, branding, and approval.
- Label platform copy as suggested until it becomes canonical.
- Confirm destructive or externally meaningful publishing actions.
- Show platform compatibility and verified connection readiness before scheduling.

## Persona implications

- Senior pastors need ministry-context confidence and plain decisions rather than production terminology.
- Media volunteers need one obvious next action and recovery beside the failed item.
- Social media managers need exact platform payloads, compatibility checks, and consistent saved copy.
- A pre-launch founder needs customer guidance separated from worker, storage, and vendor diagnostics.

## Priority plan

### P0 — Truth and continuity

- Exclusive, accurate source selection and direct processing handoff.
- Four honest automated analysis stages.
- Visible Review decisions and a completion handoff.

### P0 — Studio correctness

- Preserve crop axes and guarantee that the primary shape is prepared.
- Expose unsaved draft state and protect accidental navigation.
- Replace simulated preparation stages with an honest pending state.

### P1 — Publishing clarity

- Label platform copy honestly and make the manual handoff sequence explicit.
- Default scheduling conservatively when automatic publishing is not verified.
- Preserve saved scheduled copy and fix mobile overlay/action conflicts.

### Phase 3

- Canonical per-platform publishing payloads.
- Publishing-service preflight and heartbeat.
- Accurate animated/keyframed preview behavior.
- Role-aware customer and technical diagnostics.
- Compact mobile week planning and publishing receipts.

## Primary implementation areas

- `src/app/sermons/new/new-sermon-form.tsx`
- `src/app/sermons/[id]/page.tsx`
- `src/app/sermons/[id]/review/review-experience.tsx`
- `src/app/sermons/[id]/clips/[clipId]/studio/*`
- `src/app/ready-to-post/*`
- `src/app/styles/premium-workflows.css`
- `src/app/styles/premium-studio.css`
- `src/app/styles/premium-review-ready.css`

