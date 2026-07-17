import { stat } from "node:fs/promises";

import Link from "next/link";

import {
  EmptyState,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { HomeTopClipCard } from "@/app/home-top-clip-card";
import { isFreshRemotePreview, listBestPreviewCandidates } from "@/lib/clipPreview";
import { prisma } from "@/lib/prisma";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
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
    startTimeSeconds: number;
    durationSeconds: number;
    clipType: string;
    bestPlatform: string | null;
    hook: string;
    suggestedHook: string | null;
    reasonSelected: string;
    renderedFilePath: string | null;
    renderedAt: Date | null;
    exportedFilePath: string | null;
    captionedVideoPath: string | null;
    overlayVideoPath: string | null;
    remotePreviewUrl: string | null;
    remotePreviewUploadedAt: Date | null;
    renderFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    captionBurnFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    overlayFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    exportFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  }>;
};

type SearchParams = {
  query?: string;
};

type HomeClip = SermonListItem["clipCandidates"][number];

const processingStatuses: SermonStatus[] = [
  "DOWNLOADING",
  "AUDIO_EXTRACTING",
  "TRANSCRIBING",
  "GENERATING_CLIPS",
  "EXPORTING",
];

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function canPreviewClipVideo(clip: Pick<
  HomeClip,
  | "remotePreviewUrl"
  | "remotePreviewUploadedAt"
  | "renderedAt"
  | "renderFreshness"
  | "exportedFilePath"
  | "captionedVideoPath"
  | "overlayVideoPath"
  | "renderedFilePath"
  | "exportFreshness"
  | "captionBurnFreshness"
  | "overlayFreshness"
>): Promise<boolean> {
  if (isFreshRemotePreview(clip)) {
    return true;
  }

  const candidates = listBestPreviewCandidates(clip);
  if (candidates.length === 0) {
    return false;
  }

  const candidateReadiness = await Promise.all(candidates.map((candidate) => fileHasBytes(candidate)));
  return candidateReadiness.some(Boolean);
}

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

function workflowStageForStatus(status: SermonStatus): number {
  if (status === "CLIPS_GENERATED" || status === "REVIEWING" || status === "FAILED") return 2;
  if (status === "EXPORTING") return 3;
  if (status === "EXPORTED") return 4;
  return 1;
}

function clipTypeText(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || "Clip";
}

function platformLabelText(value: string | null | undefined): string | null {
  const label = value?.trim();
  if (!label) return null;

  return label
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/Youtube/g, "YouTube")
    .replace(/Tiktok/g, "TikTok");
}

function shortHookLine(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length > 118 ? `${text.slice(0, 115).trim()}...` : text;
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
            startTimeSeconds: true,
            durationSeconds: true,
            clipType: true,
            bestPlatform: true,
            hook: true,
            suggestedHook: true,
            reasonSelected: true,
            renderedFilePath: true,
            renderedAt: true,
            exportedFilePath: true,
            captionedVideoPath: true,
            overlayVideoPath: true,
            remotePreviewUrl: true,
            remotePreviewUploadedAt: true,
            renderFreshness: true,
            captionBurnFreshness: true,
            overlayFreshness: true,
            exportFreshness: true,
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
  const exportedCount = allClips.filter((clip) => clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED").length;
  const processingCount = sermons.filter((sermon) => processingStatuses.includes(sermon.status)).length + metrics.runningOperations;
  const failedSermons = sermons.filter((sermon) => sermon.status === "FAILED");
  const failedSermonCount = failedSermons.length;
  const failedOperationCount = metrics.failedOperations;
  const outdatedAssetCount = metrics.outdatedAssets;
  const needsAttentionCount = failedSermonCount + failedOperationCount + outdatedAssetCount;
  const topClips = allClips
    .filter((clip) => clip.status !== "REJECTED")
    .sort((a, b) => (b.finalQualityScore ?? b.score) - (a.finalQualityScore ?? a.score))
    .slice(0, 4);
  const previewableTopClipIds = new Set(
    (await Promise.all(
      topClips.map(async (clip) => (await canPreviewClipVideo(clip) ? clip.id : null)),
    )).filter((clipId): clipId is string => Boolean(clipId)),
  );
  const firstFailedSermon = failedSermons[0] ?? null;
  const firstActionableSermon = sermons.find((sermon) => sermon.status !== "FAILED") ?? sermons[0] ?? null;
  const priorityState = needsAttentionCount > 0
    ? "attention"
    : exportedCount > 0 || metrics.clipsExported > 0
      ? "ready"
      : firstActionableSermon
        ? "resume"
        : "empty";
  const priorityActionHref = priorityState === "attention"
    ? failedSermonCount > 0 && firstFailedSermon
      ? `/sermons/${firstFailedSermon.id}`
      : "/health"
    : priorityState === "ready"
    ? "/ready-to-post"
    : firstActionableSermon
      ? `/sermons/${firstActionableSermon.id}`
      : "/sermons/new";
  const priorityActionLabel = priorityState === "attention"
    ? failedSermonCount > 0
      ? "Open sermon"
      : "Review recovery steps"
    : priorityState === "ready"
      ? "Open publishing desk"
      : priorityState === "resume"
        ? "Continue sermon"
        : "Create clips";
  const attentionDetail = failedOperationCount > 0
    ? outdatedAssetCount > 0
      ? "A failed job and stale clip media need recovery before posting."
      : "A background job or clip file failed. Open the recovery view to inspect and retry it."
    : outdatedAssetCount > 0
      ? "Some approved clip media is stale. Refresh it before posting."
      : "A sermon failed while processing. Open it to retry the failed step.";
  const priorityTitle = priorityState === "attention"
    ? `${needsAttentionCount} ${needsAttentionCount === 1 ? "item needs" : "items need"} attention.`
    : priorityState === "ready"
      ? "Prepared clips are ready."
      : priorityState === "resume"
        ? workflowStatusText(firstActionableSermon.status)
        : "Create sermon clips.";
  const priorityDetail = priorityState === "attention"
    ? attentionDetail
    : priorityState === "ready"
      ? "Download, copy captions, or schedule the next post."
      : priorityState === "resume"
        ? firstActionableSermon.title
        : "Paste a sermon link or upload a service video to begin.";
  const workflowStageIndex = priorityState === "empty"
    ? 0
    : priorityState === "resume"
      ? firstActionableSermon
        ? workflowStageForStatus(firstActionableSermon.status)
        : 0
      : priorityState === "attention"
        ? 2
        : 4;
  const workflowStages = [
    { label: "Add sermon", href: "/sermons/new" },
    { label: "Analyze", href: "/sermons" },
    { label: "Review clips", href: "/sermons" },
    { label: "Edit & brand", href: "/sermons" },
    { label: "Prepare & post", href: "/ready-to-post" },
  ];

  return (
    <main id="main-content" className="media-workspace home-workspace premium-dashboard stack-lg">
      <header className="home-hero premium-home-hero">
        <div className="stack-sm">
          <p className="kicker">Sermon content studio</p>
          <h1>Your message.<br />Ready to move.</h1>
          <p className="muted">
            Turn one sermon into a thoughtful week of clips, captions, and conversations—without losing the heart of the message.
          </p>
        </div>
        <div className="home-hero-actions">
          <Link href="/sermons/new" className="button primary home-create-action">Create from a sermon</Link>
          <Link href="/weekly-plan" className="button tertiary home-plan-action">Plan this week</Link>
        </div>
      </header>

      <nav className="workflow-spine" aria-label="Sermon Clip workflow">
        <ol>
          {workflowStages.map((stage, index) => (
            <li key={stage.label}>
              <Link
                href={stage.href}
                className={index === workflowStageIndex ? "is-current" : undefined}
                aria-current={index === workflowStageIndex ? "step" : undefined}
              >
                <strong>{String(index + 1).padStart(2, "0")}</strong>
                <span>{stage.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <section className="home-command-grid premium-command-grid" aria-label="Your next step">
        <article className={`home-priority-card premium-priority-card priority-${priorityState}`}>
          <div className="stack-md">
            <div className="priority-heading-row">
              <p className="kicker">
                {priorityState === "attention"
                  ? "Needs your attention"
                  : priorityState === "ready"
                    ? "Ready when you are"
                    : priorityState === "resume"
                      ? "Continue your work"
                      : "Begin here"}
              </p>
              <span className="priority-context">Next best action</span>
            </div>
            <h2>{priorityTitle}</h2>
            <p className="muted priority-detail">{priorityDetail}</p>
          </div>
          <div className="home-priority-footer">
            <Link href={priorityActionHref} className="button primary">{priorityActionLabel}</Link>
            <div className="home-priority-metrics" aria-label="Workspace signals">
              <span>
                <strong>{needsAttentionCount}</strong>
                <small>need attention</small>
              </span>
              <span>
                <strong>{processingCount}</strong>
                <small>in progress</small>
              </span>
              <span>
                <strong>{exportedCount || metrics.clipsExported}</strong>
                <small>prepared</small>
              </span>
            </div>
          </div>
        </article>

        <form action="/sermons/new" method="get" className="home-quick-start premium-quick-start stack-md">
          <div className="stack-sm">
            <p className="kicker">Fast import</p>
            <h2>Bring in Sunday’s sermon.</h2>
            <p className="muted">Paste a public video link, or upload the recording from your team.</p>
          </div>
          <label className="link-input-shell premium-link-input" htmlFor="dashboard-sermon-url">
            <span className="input-icon" aria-hidden="true">URL</span>
            <input id="dashboard-sermon-url" name="youtubeUrl" type="url" placeholder="Paste sermon or YouTube link" />
          </label>
          <div className="upload-command-actions">
            <button className="button primary command-cta" type="submit">Continue with link</button>
            <Link href="/sermons/new" className="button tertiary">Upload a video</Link>
          </div>
          <p className="small muted quick-start-assurance">You will review the sermon details before analysis begins.</p>
        </form>
      </section>

      {processingCount > 0 ? (
        <section className="home-processing-note" aria-live="polite">
          <span className="processing-pulse" aria-hidden="true" />
          <div>
            <strong>{processingCount} {processingCount === 1 ? "task is" : "tasks are"} in progress</strong>
            <p className="muted small">You can leave this page. Sermon Clip will keep the work moving.</p>
          </div>
          <Link href="/sermons" className="button tertiary">See progress</Link>
        </section>
      ) : null}

      <SectionCard
        title="Moments worth sharing"
        description="Your strongest recent clips, ranked to help your team review with confidence."
        className="home-featured-clips"
        headerAction={{ label: "Browse library", href: "/sermons" }}
      >
        {topClips.length === 0 ? (
          <EmptyState
            title="Your strongest moments will appear here"
            description="Add a sermon and Sermon Clip will surface the moments most likely to stand on their own."
            action={{ label: "Add your first sermon", href: "/sermons/new", variant: "primary" }}
          />
        ) : (
          <div className="dashboard-clip-grid">
            {topClips.map((clip, index) => {
              const label = clip.qualityLabel ?? clip.postReadyStatus;
              const score = clip.finalQualityScore ?? clip.score;
              const hookLine = shortHookLine(clip.suggestedHook ?? clip.hook ?? clip.reasonSelected);
              return (
                <HomeTopClipCard
                  key={clip.id}
                  clipId={clip.id}
                  href={`/sermons/${clip.sermon.id}/review`}
                  title={clip.title}
                  sermonTitle={clip.sermon.title}
                  statusLabel={qualityLabelText(label)}
                  statusTone={qualityTone(label)}
                  scoreLabel={score.toFixed(1)}
                  durationLabel={formatSecondsForPastorView(clip.durationSeconds)}
                  timecodeLabel={`Starts ${formatSecondsForPastorView(clip.startTimeSeconds)}`}
                  clipTypeLabel={clipTypeText(clip.clipType)}
                  platformLabel={platformLabelText(clip.bestPlatform)}
                  hookLine={hookLine}
                  canPreviewVideo={previewableTopClipIds.has(clip.id)}
                  priority={index === 0}
                />
              );
            })}
          </div>
        )}
      </SectionCard>

      <section className="home-signal-strip premium-signal-strip" aria-label="Studio overview">
        <StatCard label="Sermons" value={sermons.length} detail="In your studio" />
        <StatCard label="Moments found" value={metrics.clipsGenerated} detail="Suggested by Sermon Clip" tone="accent" />
        <StatCard label="Post-ready" value={postReadyCount} detail="Passed review" tone="success" />
        <StatCard label="Prepared" value={exportedCount || metrics.clipsExported} detail="Ready to download" tone="success" />
      </section>

      <SectionCard
        title="Sermon library"
        description="Return to recent messages, continue review, or prepare the next post."
        className="home-sermon-library"
        headerAction={{ label: "View all sermons", href: "/sermons" }}
      >
        {sermons.length === 0 ? (
          <EmptyState
            title="Your sermon library is ready"
            description="Add a sermon to begin building a reusable library of messages and clips."
            action={{ label: "Add a sermon", href: "/sermons/new", variant: "primary" }}
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
