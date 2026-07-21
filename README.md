# Sermon Clip Agent MVP

## What this app does
Sermon Clip Agent MVP is a local-first workflow for turning a sermon video into short clip candidates that a human can review, approve, export, and subtitle.

It supports:
- Sermon record creation
- Local media storage setup
- Video download from YouTube with yt-dlp
- Audio extraction with FFmpeg
- Transcription with OpenAI
- AI-powered clip suggestion generation
- Human review (approve/reject/edit)
- Export of approved clips only
- Subtitle generation and subtitle burn-in for exported clips
- One-click pre-review processing (download, extract, transcribe, generate clips)

## What this MVP does not do yet
- Multi-user authentication, church workspaces, or role-based access control
- Unattended publishing unless a reviewed platform account, required public media staging, and a live posting worker are all configured
- Payments or subscriptions
- Automatic approval of clips
- Publishing without human review of the prepared content

## Tech stack
- Next.js (App Router)
- TypeScript
- Prisma
- Postgres metadata database for Vercel/worker scheduling
- Node.js server actions and backend modules
- Local filesystem storage, with optional Cloudflare R2 staging for remote previews and platform publishing
- FFmpeg
- yt-dlp
- OpenAI API (transcription and clip intelligence)

## Required local dependencies
- Node.js
- npm
- Postgres via Prisma
- FFmpeg
- yt-dlp
- OpenAI API key

## Environment variables
Create a `.env` file:

OPENAI_API_KEY=your_key_here
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_TRANSCRIPTION_ACCURACY_MODEL=gpt-4o-transcribe
OPENAI_TRANSCRIPTION_DIARIZATION_MODEL=gpt-4o-transcribe-diarize
OPENAI_TRANSCRIPTION_HYBRID_ENABLED=auto
OPENAI_TRANSCRIPTION_DIARIZATION_ENABLED=false
OPENAI_TRANSCRIPTION_SPEECH_ENHANCEMENT_ENABLED=false
OPENAI_TRANSCRIPTION_GLOSSARY=
OPENAI_CHAT_MODEL=
OPENAI_REASONING_EFFORT=
OPENAI_CHAT_MAX_ATTEMPTS=3
OPENAI_CHAT_RETRY_BASE_DELAY_MS=1500
OPENAI_VALIDATED_RESPONSE_CACHE_ENABLED=true
OPENAI_VALIDATED_RESPONSE_CACHE_TTL_SECONDS=2592000
OPENAI_CLIP_SELECTION_MAX_WINDOWS=24
OPENAI_TRANSCRIPTION_MAX_ATTEMPTS=4
OPENAI_TRANSCRIPTION_RETRY_BASE_DELAY_MS=2000
# Direct connection for migrations and fallback runtime access.
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
# Pooled Neon connection used by the running app and workers.
DATABASE_POOL_URL=postgresql://USER:PASSWORD@POOLER_HOST/DB?sslmode=require

The browser smoke suite deliberately uses an isolated local PostgreSQL database instead of the app's configured database. Create `sermon_clip_codex_test`, apply the current schema, and run the suite with:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sermon_clip_codex_test npx prisma db push
npm run test:e2e
```

Set `PLAYWRIGHT_DATABASE_URL` when your local test database uses different credentials. Set `PLAYWRIGHT_BASE_URL` to smoke-test an already deployed app without starting the local server.

Optional:

SERMON_STORAGE_ROOT=/custom/path/if/you/want
OPENAI_CLIP_SELECTION_MODEL=
OPENAI_CLIP_SELECTION_MODEL_REASONING_EFFORT=
OPENAI_CLIP_REPAIR_MODEL=
OPENAI_CLIP_REPAIR_MODEL_REASONING_EFFORT=
OPENAI_SERMON_INTELLIGENCE_MODEL=
OPENAI_SERMON_INTELLIGENCE_MODEL_REASONING_EFFORT=
OPENAI_MINISTRY_MOMENT_MODEL=
OPENAI_MINISTRY_MOMENT_MODEL_REASONING_EFFORT=
OPENAI_CONTENT_MULTIPLICATION_MODEL=
OPENAI_CONTENT_MULTIPLICATION_MODEL_REASONING_EFFORT=
OPENAI_CLIP_QUALITY_MODEL=
OPENAI_CLIP_QUALITY_MODEL_REASONING_EFFORT=
OPENAI_CLIP_COMPLETENESS_MODEL=
OPENAI_CLIP_COMPLETENESS_MODEL_REASONING_EFFORT=
WORKER_API_TOKEN=shared_worker_secret
WORKER_API_BASE_URL=https://your-vercel-app.vercel.app
MEDIA_WORKER_POLL_SECONDS=15
MEDIA_WORKER_HEARTBEAT_SECONDS=30
MEDIA_WORKER_STALE_JOB_MINUTES=60
MEDIA_WORKER_MAX_ATTEMPTS=2
SCHEDULER_ADMIN_PASSWORD=single_user_dashboard_password
CONTROL_PANEL_MODE=true
YOUTUBE_CLIENT_ID=your_google_oauth_client_id
YOUTUBE_CLIENT_SECRET=your_google_oauth_client_secret
YOUTUBE_REFRESH_TOKEN=your_google_refresh_token
YOUTUBE_CHANNEL_ID=your_channel_id
YOUTUBE_DEFAULT_PRIVACY_STATUS=private
YOUTUBE_API_VERIFIED=false
TIKTOK_ACCESS_TOKEN=your_tiktok_access_token_with_video_publish
TIKTOK_DEFAULT_PRIVACY_LEVEL=SELF_ONLY
TIKTOK_DISABLE_DUET=true
TIKTOK_DISABLE_COMMENT=true
TIKTOK_DISABLE_STITCH=true
FACEBOOK_PAGE_ID=your_facebook_page_id
FACEBOOK_PAGE_ACCESS_TOKEN=your_facebook_page_access_token
FACEBOOK_GRAPH_VERSION=v23.0
FACEBOOK_DEFAULT_PUBLISHED=false
POSTING_WORKER_DRY_RUN=true

`OPENAI_TRANSCRIPTION_MODEL` stays on `whisper-1` to provide word timestamps. The higher-accuracy `gpt-4o-transcribe` pass now defaults to `auto` and runs only when timing, confidence, or language evidence indicates that Whisper wording needs help. Diarization defaults off; set `OPENAI_TRANSCRIPTION_DIARIZATION_ENABLED=true` when speaker labels are required. `OPENAI_TRANSCRIPTION_GLOSSARY` accepts comma-, semicolon-, or newline-separated names, scripture terms, places, and local-language spellings. The older FFmpeg speech-enhancement retry is disabled by default because production samples consistently performed worse; it can be re-enabled explicitly for controlled evaluation.
Text AI calls go through the shared Responses API gateway. Clip selection and sermon intelligence default to `gpt-5.6-terra` with `medium` reasoning; routine structured extraction and review tasks default to `gpt-5.6-luna` with `low` reasoning. Use `OPENAI_CHAT_MODEL` and `OPENAI_REASONING_EFFORT` as global overrides, or the task-specific variables for measured exceptions. Validated structured results are cached by model, prompt version, options, and input hash; duplicate in-flight requests are coalesced. `OPENAI_CLIP_SELECTION_MAX_WINDOWS` limits premium semantic review after deterministic pre-ranking while preserving remaining windows for local coverage top-up. AI calls record provider attempt counts, cache hits, cached input tokens, reasoning tokens, audio duration, latency, and estimated text cost; raw prompts are not stored.
`MEDIA_WORKER_HEARTBEAT_SECONDS`, `MEDIA_WORKER_STALE_JOB_MINUTES`, and `MEDIA_WORKER_MAX_ATTEMPTS` control media job leases. A stale `RUNNING` job can be reclaimed by another local worker, then marked failed after the configured claim limit.
`POSTING_WORKER_DRY_RUN` defaults to true unless explicitly set to `false`, so the worker can be tested without posting.
Social Settings OAuth links use the current app host for callback URLs. Register the exact local and live callback URLs with each provider, for example `http://localhost:3000/api/oauth/youtube/callback` and `https://your-vercel-app.vercel.app/api/oauth/youtube/callback`. Keep `WORKER_API_BASE_URL` pointed at the app the worker should poll; it does not need to match the OAuth callback host.

## Setup instructions

Run from your workspace:

cd /Users/thabangngwenya/Development/Projects/sermon_clip
npm install
brew install ffmpeg
brew install yt-dlp
npx prisma generate
npx prisma generate
npx prisma db push

## Run instructions

Development server:

npm run dev

Open:
- Dashboard: http://localhost:3000/
- New sermon: http://localhost:3000/sermons/new
- Health checks: http://localhost:3000/health

## Best Posting Automation MVP
The automation architecture keeps Vercel Hobby lightweight:
- Vercel hosts the scheduling dashboard and small JSON APIs.
- Neon Free Postgres stores metadata and scheduled post state.
- Clip video files stay on the Mac in local storage.
- The Mac worker polls Vercel, claims due posts, uploads from local files, and reports status.
- The posting worker handles verified clip-video adapters plus Facebook and Instagram generated-image publishing.

Run the local worker:

```bash
npm run worker:media
npm run worker:posting
```

Media paths stored beneath `SERMON_STORAGE_ROOT` are persisted as portable
`sermon-storage://...` references and resolved against the current machine's
storage root when read. Legacy absolute paths remain readable. Before moving
the media root to another machine, preview the database-only conversion:

```bash
npm run storage:migrate-portable-paths -- --from-root "/absolute/path/to/current/storage"
```

Review the counts, then apply it explicitly:

```bash
npm run storage:migrate-portable-paths -- --from-root "/absolute/path/to/current/storage" --apply
```

The command never moves, copies, or deletes media files.

### Private media archive

Use a separate private Cloudflare R2 Standard bucket for durable source videos,
extracted audio, transcript JSON, final exports, subtitle and thumbnail files,
the sermon-folder manifest, content assets, and branding files. Rendered,
captioned, overlay, debug, and other regenerable intermediates are excluded.
Archive blobs are content-addressed by SHA-256, so identical source recordings
are uploaded only once.

Archive uploads are additive: they never delete local files or remote blobs.
Remote pruning must remain a separate, reviewed retention operation so an
ordinary deployment cannot remove media that an existing or scheduled post
still needs.

For a fresh deployment that intentionally leaves old projects behind, skip
both the seed upload and hydration commands. Leave the private bucket empty,
then begin archiving only media created on the new host.

Preview the local archive inventory without contacting R2:

```bash
npm run storage:archive -- plan
```

For installations created before branding files moved into durable storage,
stage the active logo without changing the live database. The original is kept:

```bash
npm run storage:migrate-branding-logo -- --stage-only
```

Run the same command with `--apply` during the coordinated deployment cutover,
after the portable-path code is active.

Preview and then apply an upload:

```bash
npm run storage:archive -- upload
npm run storage:archive -- upload --apply
npm run storage:archive -- verify
```

On a new EC2 host, preview and hydrate the configured `SERMON_STORAGE_ROOT`:

```bash
npm run storage:archive -- hydrate
npm run storage:archive -- hydrate --apply
```

Hydration verifies every downloaded file by SHA-256 and refuses to overwrite a
different local file unless `--overwrite` is explicitly supplied with
`hydrate --apply`.

### EC2 retention and backup policy

For new EC2 projects, keep durable media locally: the original source,
extracted audio, `transcript.json`, final exports, subtitles, thumbnails,
content assets, branding, and the sermon-folder manifest. The daily retention
task deliberately removes only reproducible working material: rendered,
captioned, and overlay clips; pipeline logs; temporary transcription audio;
and transcription chunk caches. It never touches a project that is processing
or has any scheduled post, regardless of the post's current status.

Preview the next cleanup first, then apply it:

```bash
npm run storage:retention
npm run storage:retention -- --apply
```

The defaults are a 7-day idle period, at most 20 projects per run, and an
8 GiB free-space reserve. Configure `MEDIA_RETENTION_DAYS`,
`MEDIA_RETENTION_MAX_PROJECTS_PER_RUN`, and `MEDIA_STORAGE_MIN_FREE_GIB` only
if the EC2 disk size or ministry workflow warrants it. Direct uploads are
rejected before writing when the incoming file plus the reserve will not fit.

On EC2, schedule the archive upload before retention. Both commands are safe
to run daily: archival is additive and content-addressed, while retention only
removes the regenerable local paths above.

```bash
npm run storage:archive -- upload --apply
npm run storage:retention -- --apply
```

Step 6 will install these as locked-down systemd services and timers. Keep the
archive bucket private and use the archive-only R2 credentials for that timer.

Useful worker settings:
- `WORKER_API_BASE_URL`: Vercel or local app URL.
- `WORKER_API_TOKEN`: bearer token shared with the app.
- `MEDIA_WORKER_POLL_SECONDS`: defaults to `15`.
- `MEDIA_WORKER_HEARTBEAT_SECONDS`: defaults to `30`.
- `MEDIA_WORKER_STALE_JOB_MINUTES`: defaults to `60`.
- `MEDIA_WORKER_MAX_ATTEMPTS`: defaults to `2`.
- `POSTING_WORKER_SYNC_SECONDS`: defaults to `60`.
- `POSTING_WORKER_DUE_CHECK_SECONDS`: defaults to `30`.
- `POSTING_WORKER_UPCOMING_WINDOW_MINUTES`: defaults to `10080` (7 days).
- `POSTING_WORKER_DRY_RUN`: defaults to dry-run unless set to `false`.
- `TIKTOK_POSTING_PROVIDER`: defaults to `zernio` for reviewed automatic publishing. `direct` is accepted only for explicit development testing.
- `TIKTOK_DIRECT_POST_EXPERIMENTAL`: keep `false` in production. Direct Post remains gated until Sermon Clip implements TikTok's required live creator-info, manual privacy/interaction choices, commercial-content disclosure, music consent, and status experience.
- `TIKTOK_ACCESS_TOKEN`: experimental fallback for Direct Post testing when no stored TikTok OAuth account is selected. The token must include TikTok's `video.publish` permission.
- `TIKTOK_DEFAULT_PRIVACY_LEVEL`: defaults to `SELF_ONLY` so early tests do not publish publicly.
- `FACEBOOK_PAGE_ID`: Facebook Page id to upload videos to.
- `FACEBOOK_PAGE_ACCESS_TOKEN`: Page access token for Graph API video publishing.
- `FACEBOOK_DEFAULT_PUBLISHED`: defaults to `false`, so early tests upload videos as unpublished. Set to `true` only when you are ready for automatic public Page posts.
- `R2_PUBLIC_BASE_URL`: HTTPS public bucket URL or custom domain used for Meta-fetchable image media.
- `R2_CONTENT_ASSET_UPLOAD_DISABLED`: optional emergency switch; set to `true` to disable automatic content-image staging.

Automatic YouTube Shorts, Zernio-backed TikTok, and Facebook video posts can upload from Mac-local files. A selected account is authoritative, so Sermon Clip never falls back to another account's token. TikTok Direct Post code is retained behind `TIKTOK_DIRECT_POST_EXPERIMENTAL=true` for controlled development only; use Zernio or a reviewed manual handoff in production until the required TikTok review experience is complete. Approved generated images can also publish directly to Facebook Pages or professional Instagram accounts: Sermon Clip renders JPEG publishing variants, stages them at the configured public R2 URL, validates the connected Meta permission and live worker, and then publishes a single image or ordered carousel. Facebook remains unpublished by default until `FACEBOOK_DEFAULT_PUBLISHED=true` is deliberately enabled.
After connecting YouTube in Social Settings, stored OAuth credentials are preferred. `YOUTUBE_REFRESH_TOKEN` is only a legacy fallback; remove or replace it if Google reports that the token was expired or revoked.

The generated-content desk also includes a reusable Design Studio, an operational mixed-content weekly planner at `/weekly-plan`, WhatsApp/Story/HTML-email handoff packs, and branded ministry-guide PDFs. Weekly-plan bulk scheduling remains a reviewed manual handoff by design.

For Neon/Vercel setup, create the Neon database and set both connection URLs in Vercel and locally: keep `DATABASE_URL` on Neon's direct endpoint for migrations, and set `DATABASE_POOL_URL` to the matching `-pooler` endpoint for the running app and workers. If `DATABASE_POOL_URL` is absent, the runtime safely falls back to `DATABASE_URL`. Vercel uses `npm run deploy:build`, which safely baselines an empty database from the current PostgreSQL schema and uses `prisma migrate deploy` for databases that already have migration history. The migration preflight retries transient Neon connection and cold-start failures with bounded exponential backoff; authentication, schema, and migration errors still fail immediately, and an unreachable database never causes migrations to be skipped. The defaults can be tuned with `PRISMA_DEPLOY_MAX_ATTEMPTS`, `PRISMA_DEPLOY_RETRY_BASE_DELAY_MS`, and `PRISMA_DEPLOY_RETRY_MAX_DELAY_MS`. To copy existing local SQLite rows into Neon, run:

```bash
SQLITE_DATABASE_PATH=prisma/dev.db npm run import:sqlite-to-postgres
```

The older migration folders were created for the original SQLite MVP. Do not replace the configured Vercel build command with raw `prisma migrate deploy`; use `npm run prisma:deploy:safe` so a fresh database is baselined before normal migrations continue.

## Full MVP 2 workflow
1. Create sermon record from the dashboard.
2. Run Process Sermon for one-click pre-review processing:
  - download video
  - extract audio
  - transcribe audio
  - generate clip candidates
3. Review clip candidates on the sermon detail screen.
4. Approve/reject/edit clips.
5. Render approved clips.
6. Generate captions for approved clips.
7. Burn captions into rendered clips when needed.
8. Generate overlay output when needed.
9. Export vertical 9:16 clips.
10. Download the exported clip and post manually.

### Workflow implementation map
Use this section as the source of truth for how each workflow stage is wired.

1. Sermon creation and processing trigger
  - UI: dashboard + sermon detail controls.
  - Action/pipeline: `src/server/pipeline/processSermonPipeline.ts`
  - Result: sermon moves through download, extract, transcription, and clip suggestion generation.
2. Clip suggestion and boundary quality refinement
  - Agent: `src/server/agents/clipIntelligenceAgent.ts`
  - Boundary refinement: `src/server/agents/clipBoundaryRefinement.ts`
  - Result: adjusted boundaries and quality metadata are persisted on each clip candidate.
3. Human review and approval workflow
  - UI: `src/app/sermons/[id]/clip-review-card.tsx`
  - Actions: approve/reject/edit in `src/server/actions/sermons.ts`
  - Shared edit plan: `src/server/agents/clipEditPlanService.ts`
  - Result: only approved clips progress to render/export paths; Studio edits, cleanup cuts, captions, framing, branding, and export settings are snapshotted into active `ClipEditPlan` records.
4. Approved clip rendering
  - Service: `src/server/agents/clipRenderService.ts`
  - Actions: `renderClipCandidateAction` / `rerenderClipCandidateAction`
  - Result: rendered source clip artifact + render status metadata; `ClipArtifact` rows are tied back to the active `ClipEditPlan`.
5. Caption generation and burn-in
  - Services: `src/server/agents/captionService.ts`, `src/server/agents/captionBurnService.ts`
  - Actions: `generateClipCaptionsAction`, `burnClipCaptionsAction`, `reburnClipCaptionsAction`
  - Result: SRT subtitle output and optional burned-caption video output.
6. Branding and overlay rendering
  - Branding config: `src/server/branding/settings.ts`, settings UI under `/settings/branding`
  - Overlay service: `src/server/agents/clipOverlayService.ts`
  - Actions: `renderClipOverlayAction`, `rerenderClipOverlayAction`
  - Result: branded overlay artifact + overlay status metadata.
7. Vertical 9:16 export and download
  - Export service: `src/server/agents/clipExportService.ts`
  - Actions: `exportVerticalClipAction`, `reexportVerticalClipAction`
  - Download route: `src/app/api/clips/[id]/download/route.ts`
  - Result: final vertical MP4 suitable for manual posting. Preview selection and export source selection both prefer exported, overlay, captioned, then rendered files so Studio preview and final output use the same prepared plan path.
8. Operational diagnostics and reliability visibility
  - Dashboard metrics/checklist: `src/app/page.tsx`
  - Sermon-level operation visibility: `src/app/sermons/[id]/page.tsx`
  - Health consistency diagnostics: `src/server/workflow/operationsDiagnostics.ts`, `src/app/health/page.tsx`
  - Worker queue: `scripts/media-worker.ts`
  - Result: running/failed/stale operation visibility, media worker heartbeats, stale job reclaim, and data/file consistency checks.

### Retry actions
Failures can be retried directly from clip review cards:
- Render failures: use Rerender.
- Caption failures: use Regenerate Captions / Re-burn Captions.
- Overlay failures: use Regenerate Overlay.
- Export failures: use Re-export Vertical.

## One-click workflow
1. Create sermon
2. Click Process Sermon
3. Review generated clips
4. Approve clips
5. Render approved clips
6. Export approved clips
7. Generate captions and burn captions as needed
8. Export vertical 9:16 clips

Note:
- Process Sermon runs only the pre-review pipeline:
  - download video
  - extract audio
  - transcribe sermon
  - generate clip suggestions
- Review, export, and subtitle actions remain manual.

## Troubleshooting

### Health page
Use http://localhost:3000/health to quickly validate local dependencies and environment setup.

### Common issues
- FFmpeg missing:
  - brew install ffmpeg
- yt-dlp missing:
  - brew install yt-dlp
- OpenAI key missing:
  - Add OPENAI_API_KEY to `.env`
- Prisma/database issues:
  - npx prisma generate && npx prisma migrate dev

### Inspect database content
- Prisma Studio:
  - npx prisma studio

### Useful verification commands
- npm run lint
- npm run build
- ffmpeg -version
- yt-dlp --version

## Testing checklist
1. npm run lint
2. npm run build
3. ffmpeg -version
4. yt-dlp --version
5. Open `/`
6. Open `/health`
7. Open `/sermons/new`
8. Open an existing sermon detail page
9. Confirm controls render:
   - Process Sermon
   - Download Video
   - Extract Audio
   - Transcribe Sermon
   - Generate Clip Suggestions
   - Approve/Reject/Edit
  - Render / Rerender
  - Export Vertical / Re-export Vertical
  - Generate Captions / Burn Captions / Re-burn
  - Generate Overlay / Regenerate Overlay
10. Confirm clip cards show status and errors for:
  - render
  - caption generation
  - caption burn
  - overlay
  - export
11. Confirm downloadable export links work

## MVP 2 production readiness checklist
- Pastor can upload sermon.
- Pastor can process sermon.
- Pastor can generate clips.
- Pastor can review clips.
- Pastor can render clips.
- Pastor can generate captions.
- Pastor can generate overlays.
- Pastor can export clips.
- Pastor can post clips manually.

## Known limitations
- Processing duration depends on local machine performance and network speed.
- Very short sermons can fail clip generation if transcript windows are too short for clip constraints.
- Subtitle burn-in relies on local FFmpeg capabilities and fallback rendering behavior.
- Media and posting queues require their respective Mac workers to remain online; some interactive actions still run in the web process.
- The current access gate is intended for a single trusted workspace, not isolated multi-church tenancy.

## Safety and rights reminder
- This app is local-first.
- Files are stored under `storage/sermons/{sermonId}` by default.
- When R2 is configured, the app uploads remote clip previews and temporary or generated publishing media to the configured bucket and public base URL.
- Automatic posting is available only through explicitly configured accounts and a live posting worker; keep dry-run and private defaults enabled while validating a connection.
- You must have rights and permission to process and publish sermon media, including music, congregation footage, and images of minors.
- Human approval is required before preparing content for publication.
