# Church-First Media Platform Plan

## Product Positioning

Sermon Clip should feel like: "Turn sermons into ready-to-post clips."

The target user is a pastor or ministry team member who wants to upload a sermon, review the best moments, approve the clips that feel faithful, prepare them, download them, and post them without learning media pipeline concepts. Technical capabilities such as rendering, caption burning, overlays, and exports remain in the system, but the primary interface should translate them into pastor-facing steps:

1. Add sermon.
2. Find best moments.
3. Review and approve clips.
4. Prepare approved clips.
5. Download and post.

## Architecture Assessment

### App Structure

The app is a Next.js App Router application backed by Prisma and a local SQLite database. Server actions in `src/server/actions/sermons.ts` orchestrate most pastor-facing workflows. UI routes under `src/app/sermons`, `src/app/ready-to-post`, and `src/app/settings/branding` expose the current product surface.

Strengths:

- Clear server/client split using server actions for mutations.
- Prisma schema already models sermons, clips, processing jobs, captions, overlays, exports, review state, and intelligence metadata.
- Existing agents isolate media operations: download, audio extraction, transcription, clip selection, rendering, caption generation, caption burn, branding overlay, and export.
- Tests cover the domain helpers and most workflow-critical services.

Risks:

- Many UI labels still came from implementation details: render, export, overlay, caption burn, assets, pipeline.
- The original workflow required pastors to discover and run several separate technical steps.
- Preview selection could show an older or less polished asset unless the UI consistently asks for the best prepared variant.
- Local file upload needed a first-class path so pastors are not forced into a YouTube-only workflow.

### Clip Studio

Clip Studio is the right place for lightweight editing, but not the primary pastor review surface. It should remain a focused detail editor for timing, transcript trims, captions, format/framing, and brand adjustments.

Current direction:

- Keep transcript-based editing and lightweight trim controls.
- Keep technical repair controls available, but secondary.
- Use pastor language: posting format, download style, pastor framing, prepare again.

### Review Workflow

The review route is now the central pastor surface. It should prioritize video previews and confidence-building context before editing controls.

Current direction:

- Large video preview cards.
- AI score, ministry value, social value, audience, category, and safety notes.
- Approve/Edit/Reject actions.
- Batch actions for approving, preparing, downloading, and caption copying.
- Recommendation shortcuts for top clips.

### Rendering, Captions, Branding, and Export

The media system remains multi-stage internally:

- Source video download or local upload.
- Audio extraction and transcription.
- Clip suggestion and ministry intelligence.
- Clip rendering.
- Caption generation.
- Caption burn.
- Branding overlay.
- Export/download packaging.

Pastors should experience these as one action: Prepare Approved Clips. The one-click action should run the needed stages in dependency order, skip work that is already fresh, and return pastoral progress and recovery messages.

### Ready-To-Post Queue

The ready-to-post route is the destination for finished ministry assets. It should be the mental model for "everything I can post now."

Current direction:

- Finished clip previews.
- Download buttons.
- Platform caption variants.
- Hashtags.
- Caption copy buttons.
- Platform badges.

### Branding System

Branding settings have been repositioned as a Church Brand Kit. This is the right product abstraction because it matches how churches think: logo, watermark, colors, lower thirds, and default caption style.

Current direction:

- Central brand kit settings.
- Caption style presets.
- Preview copy for before/after caption and brand treatment.
- One-click prepare uses the configured defaults.

### Sermon Analysis Pipeline

The AI layer should detect more than "viral" moments. For churches, usefulness depends on ministry intent and context safety.

Current direction:

- Prayer moments.
- Salvation invitations.
- Scripture explanations.
- Encouragement.
- Testimonies.
- Quote-worthy moments.
- Audience labels.
- Theology/context warnings.

## Implementation Plan

### Phase 1: Pastor Review Feed

Status: Implemented.

- Make `/sermons/[id]/review` video-first.
- Add AI score, why this clip matters, audience, category, safety/context signals.
- Add Approve/Edit/Reject.
- Add batch approve, reject, prepare, download, and caption-copy workflows.
- Make mobile selection and batch actions touch-friendly.
- Keep repair/retry controls available behind "Fix..." panels so the default review feed stays decision-first.

Validation:

- Lint, tests, and build pass.
- Source check confirms review uses best-preview videos through `/api/clips/:id/preview?variant=best`.
- Browser smoke on a local sermon confirms large previews, pastor intelligence, Approve/Edit/Reject, prepare, download, and caption-copy actions render without technical pipeline language.

### Phase 2: One-Click Prepare Approved Clips

Status: Implemented.

- Add `prepareApprovedClipsAction`.
- Combine render, captions, caption burn, Church Brand Kit overlay, and final download creation.
- Make review batch action call this workflow.
- Recreate downloads when prepared assets change.
- Return pastor-friendly summary messages.

Validation:

- Existing media service tests pass.
- Production build passes.
- Guarded real-media integration smoke passes with `RUN_MEDIA_INTEGRATION=1 npx vitest run src/server/workflow/__tests__/prepareApprovedMedia.integration.test.ts`.
- The media smoke creates a synthetic local sermon video, creates transcript segments and an approved clip, runs one-click prepare, verifies rendered/captioned/branded/exported files, and verifies the download API returns an MP4.
- Caption burning now falls back to image overlays when the local FFmpeg build does not include the `subtitles` filter, preserving the pastor-facing prepare workflow on lean FFmpeg installs.

### Phase 3: Ready-To-Post Queue

Status: Implemented.

- Add `/ready-to-post`.
- Show finished clips with best available preview.
- Add download buttons.
- Add copy-caption buttons.
- Add platform-specific caption variants and hashtags.

Validation:

- Lint, tests, and build pass.
- Route is dynamic so it reflects newly prepared clips.

### Phase 4: Dashboard and Product Language

Status: Implemented.

- Reposition homepage around "Turn sermons into ready-to-post clips."
- Add weekly workflow visibility.
- Add clip thumbnails and next recommended actions.
- Move recovery tooling behind advanced areas.
- Replace implementation terms in primary UI with pastor language.

Validation:

- Lint, tests, and build pass.

### Phase 5: Caption and Branding Previews

Status: Implemented.

- Add caption style presets.
- Surface caption preview language in review and brand settings.
- Add Church Brand Kit defaults for caption style, watermark, colors, and lower thirds.

Validation:

- Brand settings tests pass.
- Caption burn service tests pass.

### Phase 6: Transcript-Based Editing

Status: Implemented.

- Clip Studio accepts transcript segments.
- Pastors can choose start/end spoken lines instead of hand-entering timestamps.
- Manual timestamp controls remain available for precision.

Validation:

- Clip Studio editing tests pass.

### Phase 7: Ministry Intelligence

Status: Implemented.

- Broaden AI prompts/schema toward prayer, salvation, scripture explanation, encouragement, testimony, quote-worthy moments, audience labels, and context warnings.
- Surface ministry reasoning in review and Clip Studio.

Validation:

- Ministry moment and sermon intelligence tests pass.

### Phase 8: Sermon Intake and Mobile Workflow

Status: Implemented.

- Allow pastors to upload a local sermon video or provide a video link.
- Store local uploads as source videos and start later steps from the existing workflow.
- Use larger review actions and mobile sticky selection controls.

Validation:

- Lint, tests, and build pass.
- Browser smoke confirms the review feed works at mobile width with large video previews, touch-ready primary actions, safety/audience signals, and closed repair panels.
- Upload action integration verifies a real `File` submitted to `createSermonAction` is stored as `source/source.mp4`, marks the sermon ready for the next guided step, and creates the expected local storage paths.
- Browser smoke verifies `/sermons/new` exposes a video file input, weekly workflow, rights confirmation, pastor-facing copy, guided success message, and a "Start sermon workflow" link after submission.
- Browser automation could not attach a native OS file to the file picker because the current in-app browser API does not expose file attachment, but the visible UI contract and the real `File` server-action path are both verified.

## Future Enhancements

1. Add real progress events for long-running prepare workflows if the app moves beyond synchronous server actions.
2. Add thumbnail extraction for uploaded sermons if source videos do not already have prepared clip previews.
3. Add richer publish-platform organization, such as per-platform download bundles, when churches need more than copy/download support.
