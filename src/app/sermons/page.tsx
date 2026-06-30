import Link from "next/link";
import type { Prisma } from "@prisma/client";

import {
  EmptyState,
  StatCard,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  query?: string;
  status?: string;
  attention?: string;
  view?: string;
};

type LibraryView = "all" | "attention" | "processing" | "ready";

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
  updatedAt: Date;
  sermonDate: Date | null;
  intelligence: {
    centralTheme: string | null;
  } | null;
  clipCandidates: {
    id: string;
    status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
    renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
    exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
    qualityLabel: ClipQualityLabel | null;
    postReadyStatus: ClipQualityLabel | null;
  }[];
  processingJobs: {
    id: string;
    status: "FAILED";
  }[];
};

type SermonWithStats = {
  sermon: SermonListItem;
  stats: ReturnType<typeof getSermonStats>;
};

const sermonStatuses: SermonStatus[] = [
  "CREATED",
  "DOWNLOADING",
  "DOWNLOADED",
  "AUDIO_EXTRACTING",
  "AUDIO_EXTRACTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
  "FAILED",
];

function isSermonStatus(value: string | undefined): value is SermonStatus {
  return sermonStatuses.includes(value as SermonStatus);
}

function getLibraryView(value: string | undefined, legacyAttention: string | undefined): LibraryView {
  if (legacyAttention === "needs-attention") return "attention";
  if (value === "attention" || value === "processing" || value === "ready") return value;
  return "all";
}

function sermonStatusLabel(status: SermonStatus): string {
  switch (status) {
    case "CREATED":
      return "Created";
    case "DOWNLOADING":
      return "Downloading video";
    case "DOWNLOADED":
      return "Video downloaded";
    case "AUDIO_EXTRACTING":
      return "Extracting audio";
    case "AUDIO_EXTRACTED":
      return "Audio ready";
    case "TRANSCRIBING":
      return "Transcribing";
    case "TRANSCRIBED":
      return "Ready to find clips";
    case "GENERATING_CLIPS":
      return "Generating clips";
    case "CLIPS_GENERATED":
      return "Ready for review";
    case "REVIEWING":
      return "In review";
    case "EXPORTING":
      return "Exporting";
    case "EXPORTED":
      return "Ready to post";
    case "FAILED":
      return "Needs retry";
  }
}

function sermonStatusTone(status: SermonStatus): string {
  if (status === "FAILED") return "tone-danger";
  if (status === "EXPORTED") return "tone-success";
  if (status === "CLIPS_GENERATED" || status === "REVIEWING" || status === "TRANSCRIBED") return "tone-warning";
  if (status === "GENERATING_CLIPS" || status === "EXPORTING" || status === "TRANSCRIBING" || status === "DOWNLOADING" || status === "AUDIO_EXTRACTING") return "tone-accent";
  return "tone-neutral";
}

function getPrimaryStatusLabel(sermon: SermonListItem, stats: ReturnType<typeof getSermonStats>): string {
  if (stats.needsAttention) return "Needs attention";
  return sermonStatusLabel(sermon.status);
}

function getPrimaryStatusTone(sermon: SermonListItem, stats: ReturnType<typeof getSermonStats>): string {
  if (stats.needsAttention) return "tone-danger";
  return sermonStatusTone(sermon.status);
}

function getSecondaryStatusDetail(stats: ReturnType<typeof getSermonStats>): string {
  if (stats.readyClipCount === 1) return "1 ready clip";
  return `${stats.readyClipCount} ready clips`;
}

function formatDate(date: Date | null): string {
  if (!date) return "No sermon date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMonth(date: Date | null): string {
  if (!date) return "Undated sermons";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function getSermonStats(sermon: SermonListItem) {
  const clipCount = sermon.clipCandidates.length;
  const failedClipCount = sermon.clipCandidates.filter((clip) => clip.renderStatus === "FAILED" || clip.exportStatus === "FAILED").length;
  const processingClipCount = sermon.clipCandidates.filter((clip) => (
    clip.renderStatus === "QUEUED"
    || clip.renderStatus === "RENDERING"
    || clip.exportStatus === "QUEUED"
    || clip.exportStatus === "EXPORTING"
  )).length;
  const readyClipCount = sermon.clipCandidates.filter((clip) => (
    clip.status === "EXPORTED"
    || clip.exportStatus === "COMPLETED"
    || (clip.qualityLabel ?? clip.postReadyStatus) === "POST_READY"
  )).length;
  const reviewClipCount = sermon.clipCandidates.filter((clip) => (
    (clip.qualityLabel ?? clip.postReadyStatus) === "GOOD_NEEDS_REVIEW"
    || (clip.qualityLabel ?? clip.postReadyStatus) === "NEEDS_EDITING"
  )).length;
  const failedJobCount = sermon.processingJobs.length;
  const needsAttention = sermon.status === "FAILED" || failedClipCount > 0 || failedJobCount > 0;

  return {
    clipCount,
    failedClipCount,
    failedJobCount,
    needsAttention,
    processingClipCount,
    readyClipCount,
    reviewClipCount,
  };
}

function isProcessing(sermon: SermonListItem, stats: ReturnType<typeof getSermonStats>): boolean {
  return stats.processingClipCount > 0
    || sermon.status === "DOWNLOADING"
    || sermon.status === "AUDIO_EXTRACTING"
    || sermon.status === "TRANSCRIBING"
    || sermon.status === "GENERATING_CLIPS"
    || sermon.status === "EXPORTING";
}

function getNextAction(sermon: SermonListItem, stats: ReturnType<typeof getSermonStats>): string {
  if (stats.needsAttention) return "Open sermon";
  if (sermon.status === "EXPORTED" || stats.readyClipCount > 0) return "Prepare post";
  if (sermon.status === "CLIPS_GENERATED" || sermon.status === "REVIEWING") return "Review clips";
  if (sermon.status === "TRANSCRIBED") return "Generate clips";
  if (isProcessing(sermon, stats)) return "Monitor progress";
  return "Open sermon";
}

function matchesLibraryView(item: SermonWithStats, view: LibraryView): boolean {
  if (view === "attention") return item.stats.needsAttention;
  if (view === "processing") return isProcessing(item.sermon, item.stats);
  if (view === "ready") return item.stats.readyClipCount > 0 || item.sermon.status === "EXPORTED";
  return true;
}

function buildLibraryHref(params: { query?: string; status?: SermonStatus; view?: LibraryView }): string {
  const search = new URLSearchParams();
  if (params.query) search.set("query", params.query);
  if (params.status) search.set("status", params.status);
  if (params.view && params.view !== "all") search.set("view", params.view);
  const queryString = search.toString();
  return queryString ? `/sermons?${queryString}` : "/sermons";
}

function groupByMonth(items: SermonWithStats[]): { label: string; items: SermonWithStats[] }[] {
  const groups = new Map<string, SermonWithStats[]>();

  for (const item of items) {
    const label = formatMonth(item.sermon.sermonDate ?? item.sermon.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  return [...groups].map(([label, groupItems]) => ({ label, items: groupItems }));
}

export default async function SermonsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams;
  const query = filters.query?.trim();
  const status = isSermonStatus(filters.status) ? filters.status : undefined;
  const activeView = getLibraryView(filters.view, filters.attention);

  const where: Prisma.SermonWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query } },
            { speakerName: { contains: query } },
            { churchName: { contains: query } },
            { intelligence: { centralTheme: { contains: query } } },
          ],
        }
      : {}),
  };

  const sermons = await prisma.sermon.findMany({
    where,
    orderBy: [
      { sermonDate: "desc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      sermonDate: true,
      intelligence: {
        select: {
          centralTheme: true,
        },
      },
      clipCandidates: {
        select: {
          id: true,
          status: true,
          renderStatus: true,
          exportStatus: true,
          qualityLabel: true,
          postReadyStatus: true,
        },
      },
      processingJobs: {
        where: { status: "FAILED" },
        select: {
          id: true,
          status: true,
        },
      },
    },
    take: 200,
  }) as SermonListItem[];

  const sortedSermons = [...sermons].sort((left, right) => {
    const leftDate = left.sermonDate ?? left.createdAt;
    const rightDate = right.sermonDate ?? right.createdAt;
    const dateDiff = rightDate.getTime() - leftDate.getTime();
    return dateDiff !== 0 ? dateDiff : right.updatedAt.getTime() - left.updatedAt.getTime();
  });
  const allStats = sortedSermons.map((sermon) => ({ sermon, stats: getSermonStats(sermon) }));
  const visibleStats = allStats.filter((item) => matchesLibraryView(item, activeView));
  const needsAttentionCount = visibleStats.filter((item) => item.stats.needsAttention).length;
  const readyClipCount = visibleStats.reduce((total, item) => total + item.stats.readyClipCount, 0);
  const processingCount = visibleStats.filter((item) => isProcessing(item.sermon, item.stats)).length;
  const hasSingleVisibleSermon = visibleStats.length === 1;
  const featured = visibleStats.find((item) => item.stats.needsAttention)
    ?? visibleStats.find((item) => isProcessing(item.sermon, item.stats))
    ?? visibleStats.find((item) => item.stats.readyClipCount > 0)
    ?? visibleStats[0]
    ?? null;
  const groupedSermons = groupByMonth(visibleStats);
  const viewOptions: { label: string; value: LibraryView }[] = [
    { label: "All", value: "all" },
    { label: "Needs attention", value: "attention" },
    { label: "Processing", value: "processing" },
    { label: "Ready", value: "ready" },
  ];

  return (
    <main className="media-workspace library-workspace stack-lg">
      <header className="workspace-topbar library-hero">
        <div className="stack-sm">
          <p className="kicker">Library</p>
          <h1>Sermon Library</h1>
          <p className="muted">Find sermons, fix issues, and continue publishing.</p>
        </div>
        <div className="topbar-actions">
          <Link href="/sermons/new" className="button primary">New Sermon</Link>
        </div>
      </header>

      <section className="library-command-panel">
        <div className="library-control-stack">
          <form className="library-filter-form" action="/sermons">
            <input type="hidden" name="view" value={activeView} />
            <label className="library-search-field">
              <span className="muted small">Search</span>
              <input type="search" name="query" placeholder="Title, pastor, church, theme" defaultValue={query ?? ""} />
            </label>
            <label>
              <span className="muted small">Status</span>
              <select name="status" defaultValue={status ?? ""}>
                <option value="">All statuses</option>
                {sermonStatuses.map((item) => (
                  <option key={item} value={item}>{sermonStatusLabel(item)}</option>
                ))}
              </select>
            </label>
            <button className="button primary" type="submit">Apply</button>
          </form>

          <nav className="library-view-tabs" aria-label="Library views">
            {viewOptions.map((option) => (
              <Link
                key={option.value}
                href={buildLibraryHref({ query, status, view: option.value })}
                className={option.value === activeView ? "active" : ""}
              >
                {option.label}
              </Link>
            ))}
            {(query || status || activeView !== "all") ? <Link href="/sermons">Clear</Link> : null}
          </nav>

          <div className="library-vitals" aria-label="Sermon library summary">
            <StatCard
              label="Needs attention"
              value={needsAttentionCount}
              detail={needsAttentionCount === 1 ? "Sermon to resolve" : "Sermons to resolve"}
              tone={needsAttentionCount > 0 ? "danger" : "neutral"}
            />
            <StatCard
              label="Ready clips"
              value={readyClipCount}
              detail="Prepared for posting"
              tone="success"
            />
            {processingCount > 0 ? (
              <StatCard
                label="Processing"
                value={processingCount}
                detail={processingCount === 1 ? "Sermon moving" : "Sermons moving"}
                tone="warning"
              />
            ) : null}
          </div>
        </div>

        <article className={`library-featured-card${featured?.stats.needsAttention ? " needs-attention" : ""}`}>
          {featured ? (
            <>
              <div className="library-featured-copy stack-sm">
                <div className="clip-badge-row">
                  <span className={`status-pill ${getPrimaryStatusTone(featured.sermon, featured.stats)}`}>
                    {getPrimaryStatusLabel(featured.sermon, featured.stats)}
                  </span>
                  <span className="status-pill tone-neutral">{getSecondaryStatusDetail(featured.stats)}</span>
                </div>
                <p className="kicker">Continue</p>
                <h2>{featured.sermon.title}</h2>
                <p className="muted">{featured.sermon.speakerName} at {featured.sermon.churchName}</p>
              </div>
              <div className="library-featured-side">
                <div className="library-inline-metrics">
                  <span><strong>{featured.stats.clipCount}</strong> clips</span>
                  <span><strong>{featured.stats.readyClipCount}</strong> ready</span>
                  <span><strong>{featured.stats.failedClipCount + featured.stats.failedJobCount}</strong> issues</span>
                </div>
                <Link href={`/sermons/${featured.sermon.id}`} className="button primary">{getNextAction(featured.sermon, featured.stats)}</Link>
              </div>
            </>
          ) : (
            <div className="library-featured-copy stack-sm">
              <p className="kicker">Start</p>
              <h2>No sermons match this view</h2>
              <p className="muted">Clear the filters or add a sermon to begin processing clips.</p>
            </div>
          )}
        </article>
      </section>

      {hasSingleVisibleSermon && featured ? null : (
        <section className="library-list-panel stack-md">
        <div className="library-section-heading">
          <div className="stack-xs">
            <h2>All sermons</h2>
            <p className="muted">Grouped by sermon month, sorted by date and latest activity.</p>
          </div>
          <Link href="/ready-to-post" className="text-link">Publishing desk</Link>
        </div>

        {visibleStats.length === 0 ? (
          <EmptyState
            title="No sermons match this view"
            description="Clear the filters or add a sermon to begin processing transcripts, clips, and publishing assets."
            action={{ label: "Add Sermon", href: "/sermons/new", variant: "primary" }}
          />
        ) : (
          <div className="library-month-groups">
            {groupedSermons.map((group) => (
              <section key={group.label} className="library-month-group">
                <div className="library-month-heading">
                  <h3>{group.label}</h3>
                  <span>{group.items.length} sermons</span>
                </div>
                <ul className="library-sermon-list">
                  {group.items.map(({ sermon, stats }) => {
                    const nextAction = getNextAction(sermon, stats);
                    const issueCount = stats.failedClipCount + stats.failedJobCount;

                    return (
                      <li key={sermon.id}>
                        <Link href={`/sermons/${sermon.id}`} className={`library-sermon-card${stats.needsAttention ? " needs-attention" : ""}`}>
                          <span className={`library-status-rail ${getPrimaryStatusTone(sermon, stats)}`} />
                          <div className="library-sermon-main stack-sm">
                            <div className="clip-badge-row">
                              <span className={`status-pill ${getPrimaryStatusTone(sermon, stats)}`}>
                                {getPrimaryStatusLabel(sermon, stats)}
                              </span>
                              <span className="status-pill tone-neutral">{getSecondaryStatusDetail(stats)}</span>
                            </div>
                            <div>
                              <h3>{sermon.title}</h3>
                              <p className="muted">{sermon.speakerName} at {sermon.churchName}</p>
                            </div>
                            {sermon.intelligence?.centralTheme ? <p className="small muted">{sermon.intelligence.centralTheme}</p> : null}
                          </div>

                          <div className="library-sermon-facts" aria-label={`${sermon.title} metrics`}>
                            <span>{formatDate(sermon.sermonDate ?? sermon.createdAt)}</span>
                            <span>{stats.clipCount} clips</span>
                            <span>{stats.readyClipCount} ready</span>
                            {issueCount > 0 ? <span className="attention">{issueCount} issues</span> : <span>{stats.reviewClipCount} review</span>}
                          </div>

                          <div className="library-sermon-meta">
                            <span className="button secondary">{nextAction}</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        </section>
      )}
    </main>
  );
}
