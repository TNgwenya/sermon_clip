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

  return (
    <main className="media-workspace home-workspace stack-lg">
      <header className="workspace-topbar home-hero">
        <div className="stack-sm">
          <p className="kicker">Sermon Clip</p>
          <h1>Sermon command center.</h1>
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
          </div>
          <div className="link-input-shell">
            <span className="input-icon">Link</span>
            <input name="youtubeUrl" type="url" placeholder="Paste sermon video link" />
          </div>
          <div className="upload-command-actions">
            <button className="button primary command-cta" type="submit">Get sermon clips</button>
            <Link href="/sermons/new" className="button tertiary">Upload video</Link>
          </div>
        </form>
      </section>

      <section className="dashboard-command-strip home-signal-strip" aria-label="Workspace summary">
        <StatCard label="Sermons" value={sermons.length} detail="In workspace" />
        <StatCard label="Suggested clips" value={metrics.clipsGenerated} detail="Found moments" tone="accent" />
        <StatCard label="Post-ready" value={postReadyCount} detail="Passed checks" tone="success" />
        <StatCard label="Prepared files" value={exportedCount || metrics.clipsExported} detail="Downloads" tone="success" />
      </section>

      {processingCount > 0 ? (
      <section className="home-queue-band">
        <SectionCard title="Background work">
          <div className={processingCount > 0 ? "live-refresh-panel is-live" : "live-refresh-panel is-paused"}>
            <div>
              <p className="kicker">{processingCount > 0 ? "Working now" : "Quiet queue"}</p>
              <strong>{processingCount > 0 ? `${processingCount} item(s) in progress` : "No active processing"}</strong>
            </div>
            <Link href="/sermons" className="button secondary">View sermons</Link>
          </div>
        </SectionCard>
      </section>
      ) : null}

      <SectionCard title="Top clips to review">
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
                  hookLine={hookLine}
                  canPreviewVideo={previewableTopClipIds.has(clip.id)}
                  priority={index === 0}
                />
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent sermons">
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
