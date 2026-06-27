import Link from "next/link";
import Image from "next/image";

import {
  EmptyState,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { getOperationalMetrics } from "@/server/workflow/operationsDiagnostics";

type SermonStatus =
  | "CREATED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "AUDIO_EXTRACTING"
  | "AUDIO_EXTRACTED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "GENERATING_CLIPS"
  | "CLIPS_GENERATED"
  | "REVIEWING"
  | "EXPORTING"
  | "EXPORTED"
  | "FAILED";

type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";

type SermonListItem = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  status: SermonStatus;
  createdAt: Date;
  sermonDate: Date | null;
  intelligence: {
    generatedTitle: string | null;
    centralTheme: string | null;
  } | null;
  clipCandidates: Array<{
    id: string;
    title: string;
    status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
    renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
    exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
    qualityLabel: ClipQualityLabel | null;
    postReadyStatus: ClipQualityLabel | null;
    finalQualityScore: number | null;
    score: number;
  }>;
};

type SearchParams = {
  query?: string;
};

const processingStatuses: SermonStatus[] = [
  "DOWNLOADING",
  "AUDIO_EXTRACTING",
  "TRANSCRIBING",
  "GENERATING_CLIPS",
  "EXPORTING",
];

function qualityLabelText(value: ClipQualityLabel | null | undefined): string {
  if (value === "POST_READY") return "Post-ready";
  if (value === "GOOD_NEEDS_REVIEW") return "Review first";
  if (value === "NEEDS_EDITING") return "Needs editing";
  if (value === "REJECT") return "Not recommended";
  return "Needs review";
}

function qualityTone(value: ClipQualityLabel | null | undefined): string {
  if (value === "POST_READY") return "quality-post-ready";
  if (value === "GOOD_NEEDS_REVIEW") return "quality-good-needs-review";
  if (value === "NEEDS_EDITING") return "quality-needs-editing";
  if (value === "REJECT") return "quality-reject";
  return "";
}

function workflowStatusText(status: SermonStatus): string {
  if (processingStatuses.includes(status)) return "Processing now";
  if (status === "CLIPS_GENERATED" || status === "REVIEWING") return "Clips ready for review";
  if (status === "EXPORTED") return "Ready to post";
  if (status === "FAILED") return "Needs attention";
  if (status === "TRANSCRIBED") return "Ready to find clips";
  return "Ready to start";
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams;
  const query = filters.query?.trim();

  const [sermons, metrics] = await Promise.all([
    prisma.sermon.findMany({
      where: query
        ? {
            OR: [
              { title: { contains: query } },
              { speakerName: { contains: query } },
              { churchName: { contains: query } },
              { intelligence: { generatedTitle: { contains: query } } },
              { intelligence: { centralTheme: { contains: query } } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        speakerName: true,
        churchName: true,
        status: true,
        createdAt: true,
        sermonDate: true,
        intelligence: {
          select: {
            generatedTitle: true,
            centralTheme: true,
          },
        },
        clipCandidates: {
          select: {
            id: true,
            title: true,
            status: true,
            renderStatus: true,
            exportStatus: true,
            qualityLabel: true,
            postReadyStatus: true,
            finalQualityScore: true,
            score: true,
          },
          orderBy: [
            { finalQualityScore: "desc" },
            { score: "desc" },
          ],
          take: 12,
        },
      },
      take: 24,
    }) as Promise<SermonListItem[]>,
    getOperationalMetrics(),
  ]);

  const allClips = sermons.flatMap((sermon) => sermon.clipCandidates.map((clip) => ({ ...clip, sermon })));
  const postReadyCount = allClips.filter((clip) => (clip.qualityLabel ?? clip.postReadyStatus) === "POST_READY").length;
  const reviewFirstCount = allClips.filter((clip) => (clip.qualityLabel ?? clip.postReadyStatus) === "GOOD_NEEDS_REVIEW").length;
  const needsEditingCount = allClips.filter((clip) => (clip.qualityLabel ?? clip.postReadyStatus) === "NEEDS_EDITING").length;
  const exportedCount = allClips.filter((clip) => clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED").length;
  const processingCount = sermons.filter((sermon) => processingStatuses.includes(sermon.status)).length + metrics.runningOperations;
  const needsAttentionCount = sermons.filter((sermon) => sermon.status === "FAILED").length + metrics.failedOperations + metrics.outdatedAssets;
  const topClips = allClips
    .filter((clip) => clip.status !== "REJECTED")
    .sort((a, b) => (b.finalQualityScore ?? b.score) - (a.finalQualityScore ?? a.score))
    .slice(0, 4);
  const firstActionableSermon = sermons.find((sermon) => sermon.status !== "FAILED") ?? sermons[0] ?? null;
  const priorityState = needsAttentionCount > 0
    ? "attention"
    : exportedCount > 0 || metrics.clipsExported > 0
      ? "ready"
      : firstActionableSermon
        ? "resume"
        : "empty";
  const priorityActionHref = priorityState === "ready"
    ? "/ready-to-post"
    : firstActionableSermon
      ? `/sermons/${firstActionableSermon.id}`
      : "/sermons/new";
  const priorityActionLabel = priorityState === "attention"
    ? "Open sermon"
    : priorityState === "ready"
      ? "Open publishing desk"
      : priorityState === "resume"
        ? "Continue sermon"
        : "Create clips";
  const priorityTitle = priorityState === "attention"
    ? "Some clips need a fresh preview or retry."
    : priorityState === "ready"
      ? "Your publishing desk has prepared clips."
      : priorityState === "resume"
        ? workflowStatusText(firstActionableSermon.status)
        : "Create your first sermon clips.";
  const priorityDetail = priorityState === "attention"
    ? "Resolve failed or stale items before sending clips to the publishing desk."
    : priorityState === "ready"
      ? "Download the video, copy the caption, and mark each clip posted."
      : priorityState === "resume"
        ? firstActionableSermon.title
        : "Paste a sermon link or upload a service video to begin.";

  return (
    <main className="media-workspace home-workspace stack-lg">
      <header className="workspace-topbar home-hero">
        <div className="stack-sm">
          <p className="kicker">Sermon Clip</p>
          <h1>Sermon command center.</h1>
          <p className="muted">Start a sermon, recover failed work, review ranked clips, and move finished videos to the publishing desk.</p>
        </div>
        <div className="topbar-actions">
          <Link href="/sermons/new" className="button primary">Create clips</Link>
          <Link href="/ready-to-post" className="button secondary">Ready to post</Link>
        </div>
      </header>

      <section className="home-command-grid" aria-label="Workspace command center">
        <article className={`home-priority-card priority-${priorityState}`}>
          <div className="stack-sm">
            <p className="kicker">
              {priorityState === "attention"
                ? "Needs attention"
                : priorityState === "ready"
                  ? "Ready to post"
                  : priorityState === "resume"
                    ? "Resume"
                    : "Start here"}
            </p>
            <h2>{priorityTitle}</h2>
            <p className="muted">{priorityDetail}</p>
          </div>
          <div className="home-priority-footer">
            <div className="home-priority-metrics">
              <span>
                <strong>{needsAttentionCount}</strong>
                <small>need attention</small>
              </span>
              <span>
                <strong>{processingCount}</strong>
                <small>processing</small>
              </span>
              <span>
                <strong>{exportedCount || metrics.clipsExported}</strong>
                <small>downloads</small>
              </span>
            </div>
            <Link href={priorityActionHref} className="button primary">{priorityActionLabel}</Link>
          </div>
        </article>

        <form action="/sermons/new" method="get" className="home-quick-start stack-md">
          <div className="stack-sm">
            <p className="kicker">Quick start</p>
            <h2>Paste a sermon video link</h2>
            <p className="muted">Create a transcript, find ministry moments, rank clips, and prepare pastor-friendly next steps.</p>
          </div>
          <div className="link-input-shell">
            <span className="input-icon">Link</span>
            <input name="youtubeUrl" type="url" placeholder="Paste YouTube or sermon video link" />
          </div>
          <div className="upload-command-actions">
            <button className="button primary command-cta" type="submit">Get sermon clips</button>
            <Link href="/sermons/new" className="button tertiary">Upload video</Link>
          </div>
        </form>
      </section>

      <section className="home-workflow-strip" aria-label="Sermon Clip workflow">
          <div className="tool-tile">
            <span className="tool-orb">1</span>
            <strong>Long sermon</strong>
          </div>
          <div className="tool-tile">
            <span className="tool-orb">AI</span>
            <strong>Find moments</strong>
          </div>
          <div className="tool-tile">
            <span className="tool-orb">CC</span>
            <strong>Captions</strong>
          </div>
          <div className="tool-tile">
            <span className="tool-orb">9:16</span>
            <strong>Auto framing</strong>
          </div>
          <div className="tool-tile">
            <span className="tool-orb">✓</span>
            <strong>Post-ready</strong>
          </div>
      </section>

      <section className="dashboard-command-strip home-signal-strip" aria-label="Workspace summary">
        <StatCard label="Sermons" value={sermons.length} detail="In this workspace" />
        <StatCard label="Clips found" value={metrics.clipsGenerated} detail="Suggested moments" tone="accent" />
        <StatCard label="Post-ready" value={postReadyCount} detail="Passed quality checks" tone="success" />
        <StatCard label="Review first" value={reviewFirstCount} detail="Good clips with notes" tone="warning" />
        <StatCard label="Needs editing" value={needsEditingCount} detail="Fix before posting" tone="warning" />
        <StatCard label="Downloads" value={exportedCount || metrics.clipsExported} detail="Ready files" tone="success" />
      </section>

      <section className="home-queue-band">
        <SectionCard title="Processing queue" description="Automatic work currently happening in the background.">
          <div className={processingCount > 0 ? "live-refresh-panel is-live" : "live-refresh-panel is-paused"}>
            <div>
              <p className="kicker">{processingCount > 0 ? "Working now" : "Quiet queue"}</p>
              <strong>{processingCount > 0 ? `${processingCount} item(s) in progress` : "No active processing"}</strong>
              <p className="muted small">The app will guide you to review clips when processing finishes.</p>
            </div>
            <Link href="/sermons" className="button secondary">View sermons</Link>
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Top clips to review" description="The best available clips appear first. Post-ready is different from merely having a preview.">
        {topClips.length === 0 ? (
          <EmptyState
            title="No ranked clips yet"
            description="Create or process a sermon to see ranked clip cards here."
            action={{ label: "Create clips", href: "/sermons/new", variant: "primary" }}
          />
        ) : (
          <div className="dashboard-clip-grid">
            {topClips.map((clip, index) => {
              const label = clip.qualityLabel ?? clip.postReadyStatus;
              const score = clip.finalQualityScore ?? clip.score;
              return (
                <Link key={clip.id} href={`/sermons/${clip.sermon.id}/review`} className="dashboard-clip-card">
                  <div className="dashboard-clip-poster">
                    <Image
                      src={`/api/clips/${clip.id}/thumbnail`}
                      alt=""
                      fill
                      sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 25vw"
                      priority={index === 0}
                      unoptimized
                    />
                    <span className={`status-pill ${qualityTone(label)}`}>{qualityLabelText(label)}</span>
                    <strong>{score.toFixed(1)}</strong>
                  </div>
                  <div className="stack-sm">
                    <h3>{clip.title}</h3>
                    <p className="muted small">{clip.sermon.title}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent sermons" description="Open a sermon to review ranked clips, prepare previews, captions, and downloads.">
        {sermons.length === 0 ? (
          <EmptyState
            title="No sermons found"
            description="Once you create clips, your sermons will appear here."
          />
        ) : (
          <div className="dashboard-project-grid">
            {sermons.slice(0, 6).map((sermon) => {
              const clipCount = sermon.clipCandidates.length;
              const bestClip = sermon.clipCandidates[0];
              const bestLabel = bestClip?.qualityLabel ?? bestClip?.postReadyStatus ?? null;
              return (
                <Link href={`/sermons/${sermon.id}`} key={sermon.id} className="dashboard-project-card">
                  <div className="dashboard-project-art">
                    <span>{clipCount}</span>
                    <small>clips</small>
                  </div>
                  <div className="stack-sm">
                    <div className="clip-badge-row">
                      <span className="status-pill">{workflowStatusText(sermon.status)}</span>
                      {bestClip ? <span className={`status-pill ${qualityTone(bestLabel)}`}>{qualityLabelText(bestLabel)}</span> : null}
                    </div>
                    <h3>{sermon.intelligence?.generatedTitle ?? sermon.title}</h3>
                    <p className="muted small">{sermon.speakerName} at {sermon.churchName}</p>
                    {sermon.intelligence?.centralTheme ? <p className="small muted">{sermon.intelligence.centralTheme}</p> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
