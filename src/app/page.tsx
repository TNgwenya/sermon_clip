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
    .slice(0, 3);
  const previewableTopClipIds = new Set(
    (await Promise.all(
      topClips.map(async (clip) => (await canPreviewClipVideo(clip) ? clip.id : null)),
    )).filter((clipId): clipId is string => Boolean(clipId)),
  );
  const firstFailedSermon = failedSermons[0] ?? null;
  const firstActionableSermon = sermons.find((sermon) => sermon.status !== "FAILED") ?? sermons[0] ?? null;
  const currentSermon = sermons[0] ?? null;
  const currentSermonTitle = currentSermon?.intelligence?.generatedTitle ?? currentSermon?.title ?? "Your next Sunday message";
  const currentSermonDate = currentSermon?.sermonDate ?? currentSermon?.createdAt ?? null;
  const currentSermonDateLabel = currentSermonDate
    ? new Intl.DateTimeFormat("en-ZA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(currentSermonDate)
    : "This Sunday";
  const currentClips = currentSermon?.clipCandidates ?? [];
  const currentApprovedCount = currentClips.filter((clip) => clip.status === "APPROVED" || clip.status === "EXPORTED").length;
  const currentReadyCount = currentClips.filter((clip) => (
    (clip.qualityLabel ?? clip.postReadyStatus) === "POST_READY"
    || clip.exportStatus === "COMPLETED"
    || clip.status === "EXPORTED"
  )).length;
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
      ? "Share the next prepared clip."
      : priorityState === "resume"
        ? workflowStatusText(firstActionableSermon.status)
        : "Bring in your first sermon.";
  const priorityDetail = priorityState === "attention"
    ? attentionDetail
    : priorityState === "ready"
      ? "Download, copy captions, or schedule the next post."
      : priorityState === "resume"
        ? `Continue ${firstActionableSermon.intelligence?.generatedTitle ?? firstActionableSermon.title} where your team left off.`
        : "Paste a sermon link or upload a service recording to begin.";
  const weekStageIndex = !currentSermon
    ? 0
    : currentClips.length === 0
      ? 1
      : currentApprovedCount === 0
        ? 2
        : 3;
  const weeklyRhythm = [
    {
      day: "Sunday",
      title: "Message",
      detail: currentSermon ? "Sermon received" : "Add this week’s sermon",
      href: currentSermon ? `/sermons/${currentSermon.id}` : "/sermons/new",
    },
    {
      day: "Monday",
      title: "Discover",
      detail: currentClips.length > 0 ? `${currentClips.length} moments surfaced` : "Find faithful moments",
      href: currentSermon ? `/sermons/${currentSermon.id}` : "/sermons/new",
    },
    {
      day: "Tuesday",
      title: "Discern",
      detail: currentApprovedCount > 0 ? `${currentApprovedCount} approved by your team` : "Review with context",
      href: currentSermon ? `/sermons/${currentSermon.id}/review` : "/sermons",
    },
    {
      day: "This week",
      title: "Share",
      detail: currentReadyCount > 0 ? `${currentReadyCount} ready for your channels` : "Prepare the next post",
      href: "/ready-to-post",
    },
  ];

  return (
    <main id="main-content" className="media-workspace home-workspace premium-dashboard stack-lg">
      <header className="home-studio-intro">
        <div>
          <p className="kicker">Church content studio</p>
          <h1>One sermon. A week of faithful content.</h1>
        </div>
        <p>Carry Sunday into the week with clear, on-brand moments your church can share with confidence.</p>
        <Link href="/weekly-plan" className="home-plan-link">Open weekly plan <span aria-hidden="true">&#8599;</span></Link>
      </header>

      <section className="home-focus-grid" aria-label="This week’s sermon and next action">
        <article className={`home-current-message priority-${priorityState}`}>
          <div className="current-message-heading">
            <div className="current-message-label">
              <span className="current-message-mark" aria-hidden="true" />
              <span>Current message</span>
            </div>
            {currentSermonDate ? <time dateTime={currentSermonDate.toISOString()}>{currentSermonDateLabel}</time> : <span>{currentSermonDateLabel}</span>}
          </div>

          <div className="current-message-copy">
            <h2>{currentSermonTitle}</h2>
            {currentSermon ? (
              <>
                <p className="current-message-byline">{currentSermon.speakerName} <span aria-hidden="true">·</span> {currentSermon.churchName}</p>
                {currentSermon.intelligence?.centralTheme ? <p className="current-message-theme">{currentSermon.intelligence.centralTheme}</p> : null}
              </>
            ) : (
              <p className="current-message-theme">Add the service recording and Sermon Clip will help your team find the moments worth carrying forward.</p>
            )}
          </div>

          <div className="current-next-action">
            <div>
              <p className="kicker">Next best action</p>
              <h3>{priorityTitle}</h3>
              <p>{priorityDetail}</p>
            </div>
            <Link href={priorityActionHref} className="button primary current-action-button">
              {priorityActionLabel}
              <span aria-hidden="true">&#8594;</span>
            </Link>
          </div>
        </article>

        <form action="/sermons/new" method="get" className="home-quick-start premium-quick-start stack-md">
          <div className="quick-start-heading">
            <p className="kicker">Fast import</p>
            <span className="quick-start-number" aria-hidden="true">01</span>
          </div>
          <div className="stack-sm">
            <h2>Start with another sermon.</h2>
            <p className="muted">Paste a public video link and review the details before analysis begins.</p>
          </div>
          <label className="link-input-shell premium-link-input" htmlFor="dashboard-sermon-url">
            <span className="input-icon" aria-hidden="true">Link</span>
            <input id="dashboard-sermon-url" name="youtubeUrl" type="url" placeholder="Paste sermon or YouTube link" />
          </label>
          <div className="upload-command-actions">
            <button className="button secondary command-cta" type="submit">Import link</button>
            <Link href="/sermons/new" className="quick-upload-link">or upload a video</Link>
          </div>
          <p className="small muted quick-start-assurance">Nothing is published without your approval.</p>
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

      <section className="home-week-rhythm" aria-labelledby="weekly-rhythm-title">
        <div className="week-rhythm-heading">
          <div>
            <p className="kicker">A simple weekly rhythm</p>
            <h2 id="weekly-rhythm-title">From pulpit to people.</h2>
          </div>
          <p>One message, carried forward with care.</p>
        </div>
        <ol>
          {weeklyRhythm.map((step, index) => {
            const state = index < weekStageIndex ? "complete" : index === weekStageIndex ? "current" : "upcoming";
            return (
              <li key={step.title} className={`is-${state}`} aria-current={state === "current" ? "step" : undefined}>
                <Link href={step.href}>
                  <span className="week-rhythm-day">{step.day}</span>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <SectionCard
        title="Moments worth sharing"
        description="A considered shortlist of recent moments—ready for your team to watch, discern, and shape."
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

      <SectionCard
        title="Recent messages"
        description="Return to a sermon when you need the full message, transcript, or complete set of moments."
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
            {sermons.slice(0, 4).map((sermon) => {
              const clipCount = sermon.clipCandidates.length;
              return (
                <Link href={`/sermons/${sermon.id}`} key={sermon.id} className="dashboard-project-card">
                  <div className="dashboard-project-art">
                    <span>{clipCount}</span>
                    <small>clips</small>
                  </div>
                  <div className="stack-sm">
                    <span className="sermon-library-status">{workflowStatusText(sermon.status)}</span>
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

      <section className="home-operations" aria-labelledby="studio-overview-title">
        <div className="home-operations-heading">
          <div>
            <p className="kicker">Studio overview</p>
            <h2 id="studio-overview-title">The work behind the week.</h2>
          </div>
          {needsAttentionCount > 0 ? <Link href="/health">Review {needsAttentionCount} {needsAttentionCount === 1 ? "issue" : "issues"}</Link> : null}
        </div>
        <div className="home-signal-strip premium-signal-strip" aria-label="Operational studio metrics">
          <StatCard label="Sermons" value={sermons.length} detail="In your studio" />
          <StatCard label="Moments found" value={metrics.clipsGenerated} detail="Across every message" tone="accent" />
          <StatCard label="Post-ready" value={postReadyCount} detail="Approved for sharing" tone="success" />
          <StatCard label="Prepared" value={exportedCount || metrics.clipsExported} detail="Ready to download" tone="success" />
        </div>
      </section>
    </main>
  );
}
