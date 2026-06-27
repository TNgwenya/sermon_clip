# Sermon Clip vs. Opus Clip for Churches

Last assessed: 2026-06-19

## Current Position

Sermon Clip now has the core church-first loop:

1. Upload or add a sermon.
2. Generate sermon clip candidates.
3. Review clips in a pastor-facing feed.
4. Approve, reject, or edit clip copy.
5. Prepare approved clips through the combined caption, branding, render, and export workflow.
6. Download finished clips and copy platform captions from the Ready To Post queue.

The product direction is now correctly differentiated from generic clipping tools: it speaks in ministry moments, prayer, encouragement, sermon context, audience labels, church branding, and pastoral safety rather than generic virality alone.

## QA Evidence From Current Pass

- Desktop route sweep covered dashboard, new sermon, sermon library, sermon detail, review feed, Clip Studio, sermon intelligence, Ready To Post, brand settings, knowledge base, opportunities, and health.
- Mobile route sweep covered dashboard, upload, sermon detail, review feed, Clip Studio, Ready To Post, and brand settings.
- Browser checks found no horizontal overflow on the upgraded core flow.
- Review feed selection works: Select all selects visible clips and switches to Clear selection.
- Placeholder social/schedule/AI hook/B-Roll/duplicate actions now open pastor-friendly feature preview modals instead of dead disabled controls.
- Ready queue caption copy works and writes platform caption text to the clipboard.
- Clip preview and download routes are requested successfully by the app runtime.
- On-demand clip poster thumbnails are generated at `/api/clips/:id/thumbnail`, cached under sermon storage, and reused by dashboard, sermon detail, review feed, Clip Studio, and Ready To Post videos.
- Browser QA confirmed review thumbnails load as 720x1280 images, all upgraded video surfaces use `preload="none"`, and the dashboard, sermon detail, Clip Studio, review feed, and Ready To Post queue have no mobile horizontal overflow or console errors.
- Ready To Post batch selection works: Select all marks every finished clip, Download selected returns a valid ZIP posting package, and the package includes videos, platform caption text files, hashtags, and `posting-manifest.json`.
- Individual Ready To Post clip downloads now use the best available prepared video asset and return `200 video/mp4` for the current ready queue.
- Upload start now shows a pastor-friendly full-screen progress theater with source-to-clips skeletons and workflow steps while the sermon action is pending.
- Google Drive and Zoom upload buttons now open clear feature preview modals instead of appearing as disabled dead controls.
- Ready To Post now supports real posting drafts: pastors can select finished clips, choose platforms and a posting rhythm, add a media team note, and save a database-backed handoff draft through `/api/ready-to-post/drafts`.
- Posting drafts now automatically create database-backed scheduled post rows, and Ready To Post surfaces a dedicated Scheduled posts queue for media team handoff.
- Browser QA confirmed posting draft creation, persisted draft loading, disabled scheduling before selection, mobile rendering, no horizontal overflow, and no console errors.
- Sermon detail now has a pastor-facing processing theater with progress percentage, current step, seven visible workflow cards, latest useful job status, and mobile-safe layout.
- Browser QA confirmed the processing theater renders on desktop and mobile with no horizontal overflow, no undersized touch targets, and no console errors.
- Secondary pages now use the same dark media shell and pastor-facing language: Knowledge Base, Ministry Patterns, Content Ideas, and Workspace Readiness all have summary strips and direct paths back to Dashboard or Ready Queue.
- Browser QA confirmed those secondary pages render on desktop/mobile with no horizontal overflow, no undersized touch targets, and no console errors.
- Review Feed AI Hook now opens a sermon-aware hook refinement modal with pastoral, question, ministry-value, and safe-current variants.
- Browser QA confirmed AI Hook updates the editable clip draft, shows success feedback, renders four hook variants, has no console errors, and remains mobile-safe with no horizontal overflow or undersized touch targets.
- Review Feed and Ready To Post now include video preview state labels for poster, loading, ready, playing, paused, and unavailable states.
- Review Feed and Ready To Post preview cards now use a poster-first overlay with a large Preview/Pause button, loading sheen, and clearer active-state styling. Browser QA confirmed Review Feed overlays render on desktop/mobile with no console errors or horizontal overflow; a disposable Ready To Post clip confirmed the ready queue overlay renders with no console errors or overflow.
- Review Feed and Ready To Post now support desktop hover preview, focusable clip cards, keyboard preview/select shortcuts, and poster skeleton animation while preview media settles.
- Sermon Intelligence now has subject and speaker tracking: the app stores tracked subjects and main voices in Prisma, refreshes them after intelligence generation, and surfaces them in a pastor-facing Subjects & Speakers panel.
- Clip Studio now has video face/body tracking for clips: tracks are stored in Prisma, pastors can refresh tracking from the framing panel, and Auto pastor tracking uses the saved subject center for Smart Crop exports.
- Review selection checkboxes and Ready Queue selection checkboxes now use larger 32px touch targets. The final browser rerun after this touch-target-only CSS adjustment was blocked by the Codex usage limit, but lint, focused tests, and production build passed afterward.
- Ready To Post packages now show what a pastor/media team is getting: video plus caption files, platform caption count, and estimated media size when the prepared file is available.
- Downloaded posting package manifests now include package contents and estimated video bytes for handoff/audit.
- Sermon detail recovery now translates failed processing job names into pastor language, surfaces the friendly error plus Workspace Readiness link in the main next-step panel, and removes raw job codes from visible recovery lists.
- Sermon detail now has a live progress panel that refreshes the route during active processing, shows last checked time, gives a manual Check now action, and pauses itself when no work is running.
- Browser QA confirmed the live progress panel renders on desktop and mobile with no console errors, no horizontal overflow, no undersized touch targets, and no visible raw job codes.
- Ready To Post now has a live queue status panel that distinguishes finished clips, clips being prepared, approved clips waiting for preparation, and an empty queue.
- Browser QA confirmed Ready To Post queue status renders on desktop/mobile with no console errors, no horizontal overflow, no undersized touch targets, and clearer non-duplicative empty-state copy.
- Ready To Post now records downloaded posting packages in a local package history store and surfaces recent package handoffs in the queue.
- Browser QA confirmed the package history section renders on desktop/mobile empty state with no console errors, no horizontal overflow, and no undersized touch targets. Tests also verified package history uses an isolated store override and does not pollute local app storage.
- Package history items now include a Re-download action that regenerates the same posting package from the stored clip IDs.
- Build validation caught and fixed a client/server boundary issue so package history storage remains server-only while the Ready To Post UI uses a browser-safe re-download URL.
- Ready To Post now has database-backed church channel placeholders: pastors can add a church social account/page, see connected account badges in the posting queue, and use those accounts to guide handoff drafts while direct OAuth publishing is still future work.
- Browser QA confirmed the Add social accounts modal saves a local channel on desktop/mobile, updates the Ready To Post UI, and leaves no console errors, horizontal overflow, or undersized touch targets. QA account records were removed from local storage after validation.
- Clip poster thumbnails are now first-class clip metadata. The thumbnail route and export pipeline use a shared server service, write `thumbnailPath`, `thumbnailGeneratedAt`, and `thumbnailError`, and prefer the stored path before falling back to the conventional thumbnail location.
- A disposable end-to-end thumbnail QA clip generated a real video, requested `/api/clips/:id/thumbnail`, returned `200 image/jpeg`, wrote thumbnail metadata, confirmed the JPEG file existed, then cleaned the test sermon, clip, video, and storage folder.
- Workspace Readiness now includes Clip Poster Readiness with prepared clip count, posters ready, missing posters, optimized variants, and poster errors.
- The Workspace Readiness "Prepare missing posters" action now backfills poster metadata for prepared clips. Browser QA confirmed the button generated a real poster for a disposable prepared clip, wrote metadata, found the JPEG file, and left no browser errors.
- The thumbnail service now attempts a WebP poster variant when ffmpeg supports WebP encoding. The current local ffmpeg build does not include `libwebp`, so WebP remains opportunistic and JPEG remains the reliable poster path.
- Prisma schema drift was corrected for content opportunities and sermon segment windows so regenerated Prisma clients match the current app/database features. Local migration history now reports no pending migrations.
- `npm run lint`, `npm run test`, and `npm run build` pass.

## What Now Feels Competitive

- Clear one-click upload language: "Turn sermons into ready-to-post clips."
- Video-first review feed with large previews, AI score, audience, category, and safety context.
- Pastor-friendly Prepare Approved Clips action that hides render/export/caption details.
- Ready To Post queue with individual downloads, batch posting packages, caption variants, hashtags, and platform badges.
- Church Brand Kit foundation for logo, watermark, colors, and caption defaults.
- Transcript-based Clip Studio editing exists without turning into a full editor.
- Sermon detail now starts with a media command center instead of technical pipeline controls.
- Clip grids now feel faster and more intentional because cards show cached poster images before video playback and expose a large preview overlay instead of relying on small native controls.
- The new-sermon flow now feels closer to an Opus-style creation moment because pending submission has a dedicated visual progress state.
- Scheduling is no longer only a preview: the app can now create database-backed posting drafts and scheduled post rows for a church media team, even before direct social publishing exists.
- Sermon detail now explains processing status in pastor-facing workflow language instead of only exposing raw jobs and recovery controls.
- Secondary support pages now feel like part of the same sermon media platform instead of separate admin utilities.
- Review Feed AI Hook now gives pastors one-click sermon-aware opening lines without asking them to understand prompt engineering.
- Review Feed and Ready To Post now give clearer media feedback with visible preview states and pastor-friendly Preview/Pause overlays, so pastors are not left guessing whether a clip is loading, ready, playing, or unavailable.
- Review Feed and Ready To Post now feel quicker to scan on desktop because hovering a clip can start a muted preview, and keyboard users can focus a card to preview or select without hunting through small controls.
- Ready To Post now feels more like a media handoff queue because each clip explains the package contents and likely download size before a pastor clicks Download.
- Failed sermons now give pastors clearer recovery guidance without exposing raw workflow codes like `TRANSCRIBE_AUDIO` in the primary experience.
- Sermon detail now feels less static during processing because pastors can see whether live updates are on, when the page last checked progress, and manually check again.
- Ready To Post now feels less like a dead end before exports exist because it explains whether clips are being prepared, waiting for preparation, or ready to download.
- Ready To Post now has a memory of recent posting-package handoffs, which is closer to how a church media team tracks what was already downloaded.
- Recent package handoffs can now be re-downloaded from the Ready To Post queue when the underlying clips are still ready.
- Ready To Post can now remember church social channels in the database, making the handoff workflow feel more concrete even before true direct publishing is connected.
- Clip grids no longer depend only on anonymous on-demand poster extraction: prepared/exported clips can now carry stored thumbnail metadata for faster, more reliable poster reuse.
- Workspace Readiness now gives the media team a clear way to repair missing clip posters without understanding ffmpeg or storage folders.
- Sermon Intelligence now understands recurring subjects and main voices well enough to support future speaker-aware reframing, subject-aware captions, and safer clip context checks.
- Clip Studio can now use saved face/body tracking to keep the pastor closer to center in vertical exports, which moves Smart Crop from placeholder language into the working media pipeline.

## Gaps Before It Feels Opus-Level

### 1. Thumbnail Polish

Current previews have on-demand poster thumbnails, exports prepare/store poster metadata, and Workspace Readiness can backfill missing posters. Opus-level polish still needs richer poster variants and more visible generation states.

Needed:
- Add guaranteed WebP/AVIF poster variants by bundling or documenting a compatible encoder.
- Add poster generation skeleton/status states directly inside clip grids.
- Add richer fallback artwork when media is unavailable.

### 2. Faster Preview Interaction

Cards now use posters first, lazy video loading, explicit media state labels, loading sheen, large Preview/Pause overlays, desktop hover preview, card focus states, keyboard preview/select shortcuts, and poster skeleton animation in the Review Feed and Ready To Post queue. The remaining work is deeper interaction polish.

Needed:
- Add richer poster-generation status from the backend when a thumbnail is still being prepared or has failed.
- Add optional user-facing shortcut help in a non-intrusive command palette once the broader keyboard model is stable.

### 3. Direct Social Account Publishing

Posting drafts, scheduled post rows, and church social channel placeholders now exist in the database for media team handoff. Direct account connection and publishing still need a full integration layer.

Needed:
- OAuth-backed social account connection model.
- Platform profile badges.
- Export/share handoff for churches that do not want direct publishing.
- Package history in a database-backed model rather than local JSON storage when multi-user accounts are introduced.

### 4. Posting Package Polish

Ready To Post now supports selected/all ZIP packages, package content summaries, platform caption counts, estimated media size, manifest metadata, and a local package history. The remaining work is deeper package management.

Needed:
- Add per-platform filename conventions.
- Add estimated download time before download.
- Move package history from local JSON into a database-backed model when multi-user accounts are introduced.

### 5. Deeper AI Hook Intelligence

The Review Feed now has a sermon-aware hook chooser, but it is still deterministic and draft-local. Opus-level polish needs deeper AI generation, persistence, and safety scoring.

Needed:
- Model-backed hook generation using transcript, audience, category, and sermon context.
- Persisted hook variant history and selected hook metadata.
- A/B hook variants for different platforms.
- Safety scoring before final save, especially for theology/context warnings.
- Matching hook refinement inside Clip Studio.

### 6. Live Processing Progress

Upload start, sermon detail, and Ready To Post now have polished processing visibility. Sermon detail and the ready queue can auto-refresh while work is active. The remaining gap is richer progress data from the processing backend.

Needed:
- Estimated completion based on actual media duration and queue status.
- Per-step progress percentages from transcription, analysis, clip generation, preparation, and ready queue work.
- Push/server-sent updates instead of route refresh polling.

### 7. Secondary Page Depth Polish

The major secondary pages now share the upgraded shell. The remaining work is deeper interaction polish inside dense tables/forms and less-common nested views.

Needed:
- Replace remaining dense table/list areas with more scannable cards where useful.
- Add saved views for recurring searches and weekly content planning.
- Add direct jump links from intelligence results into specific clips, drafts, and posting packages.

## Recommended Next Upgrade Order

1. Guaranteed optimized poster variants and poster skeleton states.
2. Hover preview, keyboard shortcuts, and poster-generation skeletons.
3. Posting package polish.
4. OAuth social account connections and direct platform publishing.
5. Model-backed hook intelligence and persisted hook history.
6. Live processing polling and estimated completion.
7. Secondary page polish.
