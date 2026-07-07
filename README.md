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
- Cloud storage or S3 uploads
- Authentication or user roles
- Full multi-platform social posting integrations beyond the first YouTube Shorts worker adapter
- Payments or subscriptions
- Automatic approval of clips
- Automatic export or automatic subtitle generation

## Tech stack
- Next.js (App Router)
- TypeScript
- Prisma
- Postgres metadata database for Vercel/worker scheduling
- Node.js server actions and backend modules
- Local filesystem storage
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
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require

Optional:

SERMON_STORAGE_ROOT=/custom/path/if/you/want
WORKER_API_TOKEN=shared_worker_secret
WORKER_API_BASE_URL=https://your-vercel-app.vercel.app
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

`OPENAI_TRANSCRIPTION_MODEL` defaults to `whisper-1` because the clipping pipeline requires segment timestamps for accurate video boundaries.
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
- YouTube Shorts is the first automatic posting adapter.

Run the local worker:

```bash
npm run worker:posting
```

Useful worker settings:
- `WORKER_API_BASE_URL`: Vercel or local app URL.
- `WORKER_API_TOKEN`: bearer token shared with the app.
- `POSTING_WORKER_SYNC_SECONDS`: defaults to `60`.
- `POSTING_WORKER_DUE_CHECK_SECONDS`: defaults to `30`.
- `POSTING_WORKER_UPCOMING_WINDOW_MINUTES`: defaults to `10080` (7 days).
- `POSTING_WORKER_DRY_RUN`: defaults to dry-run unless set to `false`.
- `TIKTOK_ACCESS_TOKEN`: enables automatic TikTok Direct Post uploads from the Mac worker. The token must include TikTok's `video.publish` permission.
- `TIKTOK_DEFAULT_PRIVACY_LEVEL`: defaults to `SELF_ONLY` so early tests do not publish publicly.
- `FACEBOOK_PAGE_ID`: Facebook Page id to upload videos to.
- `FACEBOOK_PAGE_ACCESS_TOKEN`: Page access token for Graph API video publishing.
- `FACEBOOK_DEFAULT_PUBLISHED`: defaults to `false`, so early tests upload videos as unpublished. Set to `true` only when you are ready for automatic public Page posts.

Automatic YouTube Shorts, TikTok, and Facebook posts can upload directly from Mac-local files. Instagram automatic posting still needs a public video URL or temporary media hosting.

For Neon/Vercel setup, create the Neon database, set `DATABASE_URL` in Vercel and locally, then run `npx prisma db push` once against Neon. To copy existing local SQLite rows into Neon, run:

```bash
SQLITE_DATABASE_PATH=prisma/dev.db npm run import:sqlite-to-postgres
```

The older migration folders were created for the original SQLite MVP, so use `db push` or create a Postgres baseline before relying on `prisma migrate deploy`.

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
  - Result: only approved clips progress to render/export paths.
4. Approved clip rendering
  - Service: `src/server/agents/clipRenderService.ts`
  - Actions: `renderClipCandidateAction` / `rerenderClipCandidateAction`
  - Result: rendered source clip artifact + render status metadata.
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
  - Result: final vertical MP4 suitable for manual posting.
8. Operational diagnostics and reliability visibility
  - Dashboard metrics/checklist: `src/app/page.tsx`
  - Sermon-level operation visibility: `src/app/sermons/[id]/page.tsx`
  - Health consistency diagnostics: `src/server/workflow/operationsDiagnostics.ts`, `src/app/health/page.tsx`
  - Result: running/failed operation visibility and data/file consistency checks.

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
- No background worker queue yet; actions run in-process.

## Safety and rights reminder
- This app is local-first.
- Files are stored under `storage/sermons/{sermonId}` by default.
- It does not upload files to S3.
- It does not auto-post to social platforms.
- You must have rights/permission to process sermon media.
- Human approval is required before export.
