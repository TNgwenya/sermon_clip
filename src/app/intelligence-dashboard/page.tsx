import Link from "next/link";

import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { getIntelligenceDashboardData } from "@/server/workflow/knowledgeIntelligence";

type SearchParams = {
  churchName?: string;
};

function dashboardEmptyMessage(
  options: {
    hasProcessedSermons: boolean;
    hasGeneratedIntelligence: boolean;
    hasChurchFilter: boolean;
  },
): string {
  if (!options.hasProcessedSermons) {
    return "No sermons have been processed yet. Process at least one sermon to populate this section.";
  }

  if (!options.hasGeneratedIntelligence) {
    return "Sermons are processed, but sermon intelligence has not been generated yet.";
  }

  if (options.hasChurchFilter) {
    return "No data matched the current church filter.";
  }

  return "No data is available for this section yet.";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPercent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

function ReadinessMetric({
  label,
  approved,
  generated,
  emptyLabel,
}: {
  label: string;
  approved: number;
  generated: number;
  emptyLabel: string;
}) {
  const percent = formatPercent(approved, generated);

  return (
    <article className="intelligence-readiness-card">
      <div className="intelligence-readiness-heading">
        <div>
          <p className="small muted">{label}</p>
          <strong>{generated > 0 ? `${approved}/${generated} approved` : emptyLabel}</strong>
        </div>
        <span className={generated > 0 ? undefined : "is-empty"}>{generated > 0 ? `${percent}%` : "Not started"}</span>
      </div>
      <div className="intelligence-readiness-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </article>
  );
}

function PatternList({
  items,
  limit = 5,
}: {
  items: Array<{ label: string; count: number }>;
  limit?: number;
}) {
  return (
    <ul className="intelligence-pattern-list">
      {items.slice(0, limit).map((item) => (
        <li key={item.label}>
          <span>{item.label}</span>
          <strong>{item.count}</strong>
        </li>
      ))}
    </ul>
  );
}

export default async function IntelligenceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;
  const dashboard = await getIntelligenceDashboardData({
    churchName: filters.churchName,
  });
  const hasChurchFilter = Boolean(filters.churchName?.trim());
  const hasProcessedSermons = dashboard.totals.sermonsProcessed > 0;
  const hasGeneratedIntelligence =
    dashboard.pastorLearning.recurringThemes.length > 0 ||
    dashboard.pastorLearning.mostUsedScriptures.length > 0 ||
    dashboard.pastorLearning.mostPreachedTopics.length > 0;
  const hasAnyTeachingPattern =
    hasGeneratedIntelligence ||
    dashboard.pastorLearning.recurringMinistryMoments.length > 0 ||
    dashboard.pastorLearning.mostReferencedBooks.length > 0;
  const hasAnyContentPattern =
    dashboard.churchLearning.contentCategoriesProduced.length > 0 ||
    dashboard.churchLearning.scriptureUsageDistribution.length > 0 ||
    dashboard.churchLearning.clipCategoryDistribution.length > 0;
  const approvedClipSummary = `${pluralize(dashboard.totals.clipsApproved, "approved clip")} from ${pluralize(dashboard.totals.sermonsProcessed, "sermon")}.`;
  const intelligenceSummary = hasGeneratedIntelligence
    ? `${pluralize(dashboard.totals.sermonsWithIntelligence, "sermon")} with sermon intelligence.`
    : "Sermon intelligence has not been generated yet.";
  const nextAction = hasGeneratedIntelligence
    ? { label: "Open Knowledge Base", href: "/knowledge-base" }
    : dashboard.recentActivity[0]
      ? { label: "Review sermon patterns", href: `/sermons/${dashboard.recentActivity[0].sermonId}/intelligence` }
      : { label: "Open Sermon Library", href: "/sermons" };
  const supportingStats = [
    { label: "Sermons with intelligence", value: dashboard.totals.sermonsWithIntelligence },
    { label: "Ministry moments", value: dashboard.totals.ministryMomentsDetected },
    { label: "Content ready", value: dashboard.totals.contentOpportunitiesApproved },
  ].filter((item) => item.value > 0);
  const operationalChecks = [
    {
      label: "Content ideas per sermon",
      value: dashboard.pastorLearning.averageContentOpportunitiesPerSermon,
      detail: "Useful for checking whether sermons are producing reusable next steps.",
      tone: "accent" as const,
    },
    {
      label: "Sermons without generated clips",
      value: dashboard.pastorLearning.sermonsWithNoGeneratedClips,
      detail: "Run clip generation where this is higher than expected.",
      tone: dashboard.pastorLearning.sermonsWithNoGeneratedClips > 0 ? "warning" as const : "success" as const,
    },
    {
      label: "Sermons without approved output",
      value: dashboard.pastorLearning.sermonsWithNoApprovedContent,
      detail: "Review clips or content ideas for sermons still waiting on approval.",
      tone: dashboard.pastorLearning.sermonsWithNoApprovedContent > 0 ? "warning" as const : "success" as const,
    },
  ];

  const getEmptyMessage = () => dashboardEmptyMessage({
    hasProcessedSermons,
    hasGeneratedIntelligence,
    hasChurchFilter,
  });

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Ministry Intelligence"
        title="What your sermons are teaching"
        description="See the clearest patterns from recent sermons and the next useful action."
        actions={[
          { label: "Dashboard", href: "/", variant: "tertiary" },
        ]}
      />

      <section className="intelligence-summary-panel">
        <div className="stack-sm">
          <p className="kicker">What we know</p>
          <h2>{approvedClipSummary}</h2>
          <p className="muted">{intelligenceSummary}</p>
        </div>
        <div className="intelligence-next-action">
          <span className="small muted">Next best action</span>
          <Link href={nextAction.href} className="button primary">{nextAction.label}</Link>
        </div>
      </section>

      {supportingStats.length > 0 ? (
        <section className="intelligence-signal-strip">
          {supportingStats.map((item) => (
            <article key={item.label}>
              <span className="muted small">{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>
      ) : null}

      <SectionCard title="Pastor Teaching Patterns" description="The strongest reusable themes, scriptures, and ministry moments.">
        {hasAnyTeachingPattern ? (
          <div className="intelligence-pattern-grid">
            {dashboard.pastorLearning.recurringThemes.length > 0 ? (
              <article className="intelligence-pattern-card featured">
                <p className="small muted">Most repeated theme</p>
                <h3>{dashboard.pastorLearning.recurringThemes[0].label}</h3>
                <p className="muted small">{pluralize(dashboard.pastorLearning.recurringThemes[0].count, "sermon")}</p>
              </article>
            ) : null}
            {dashboard.pastorLearning.mostPreachedTopics.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Topics</h3>
                <PatternList items={dashboard.pastorLearning.mostPreachedTopics} />
              </article>
            ) : null}
            {dashboard.pastorLearning.mostUsedScriptures.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Scriptures</h3>
                <PatternList items={dashboard.pastorLearning.mostUsedScriptures} />
              </article>
            ) : null}
            {dashboard.pastorLearning.recurringMinistryMoments.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Ministry moments</h3>
                <PatternList items={dashboard.pastorLearning.recurringMinistryMoments} />
              </article>
            ) : null}
            {dashboard.pastorLearning.mostReferencedBooks.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Bible books</h3>
                <PatternList items={dashboard.pastorLearning.mostReferencedBooks} />
              </article>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title={hasProcessedSermons ? "Teaching patterns are waiting on sermon intelligence" : "Process a sermon to start learning patterns"}
            description={getEmptyMessage()}
            action={dashboard.recentActivity[0] ? { label: "Open sermon intelligence", href: `/sermons/${dashboard.recentActivity[0].sermonId}/intelligence`, variant: "primary" } : { label: "Open Sermon Library", href: "/sermons", variant: "secondary" }}
          />
        )}
      </SectionCard>

      <SectionCard title="Content Readiness" description="How much generated material is ready for ministry use.">
        <div className="intelligence-readiness-grid">
          <ReadinessMetric
            label="Clip readiness"
            approved={dashboard.churchLearning.approvedVsGeneratedClips.approved}
            generated={dashboard.churchLearning.approvedVsGeneratedClips.generated}
            emptyLabel="No clips generated"
          />
          <ReadinessMetric
            label="Content readiness"
            approved={dashboard.churchLearning.approvedVsGeneratedContent.approved}
            generated={dashboard.churchLearning.approvedVsGeneratedContent.generated}
            emptyLabel="No content generated"
          />
        </div>

        {hasAnyContentPattern ? (
          <div className="intelligence-pattern-grid compact">
            {dashboard.churchLearning.contentCategoriesProduced.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Produced content</h3>
                <PatternList items={dashboard.churchLearning.contentCategoriesProduced.map((item) => ({ ...item, label: item.label.toLowerCase() }))} />
              </article>
            ) : null}
            {dashboard.churchLearning.clipCategoryDistribution.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Clip categories</h3>
                <PatternList items={dashboard.churchLearning.clipCategoryDistribution} />
              </article>
            ) : null}
            {dashboard.churchLearning.scriptureUsageDistribution.length > 0 ? (
              <article className="intelligence-pattern-card">
                <h3>Scripture use</h3>
                <PatternList items={dashboard.churchLearning.scriptureUsageDistribution} />
              </article>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Recent Sermon Activity" description="The next step for each sermon, based on the signals available now.">
        {dashboard.recentActivity.length === 0 ? (
          <EmptyState title="No recent activity" description={getEmptyMessage()} />
        ) : (
          <ul className="intelligence-activity-list">
            {dashboard.recentActivity.map((item) => {
              const activityAction = item.centralTheme
                ? item.clipCount > 0
                  ? { label: "Review clips", href: `/sermons/${item.sermonId}/review` }
                  : { label: "Generate clips", href: `/sermons/${item.sermonId}` }
                : { label: "Generate intelligence", href: `/sermons/${item.sermonId}/intelligence` };

              return (
                <li key={item.sermonId}>
                  <div className="stack-sm">
                    <Link href={`/sermons/${item.sermonId}`} className="text-link">{item.title}</Link>
                    <p className="muted small">{item.centralTheme ? `Theme: ${item.centralTheme}` : "Sermon intelligence has not been generated yet."}</p>
                    <p className="small muted">{pluralize(item.clipCount, "clip")} | {pluralize(item.opportunityCount, "content idea")} | Updated {new Date(item.updatedAt).toLocaleString()}</p>
                  </div>
                  <Link href={activityAction.href} className="button tertiary">{activityAction.label}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <details className="intelligence-filter-details" open={hasChurchFilter}>
        <summary>
          <span>
            <strong>Focus this view</strong>
            <small className="muted">{hasChurchFilter ? `Filtered to ${filters.churchName}` : "Optional church or campus filter"}</small>
          </span>
        </summary>
        <form method="get" className="intelligence-filter-form">
          <input name="churchName" placeholder="Church scope" defaultValue={filters.churchName ?? ""} />
          <button type="submit" className="button primary">Apply</button>
          <Link href="/intelligence-dashboard" className="button tertiary">Clear</Link>
        </form>
      </details>

      <details className="intelligence-filter-details">
        <summary>
          <span>
            <strong>Operational health checks</strong>
            <small className="muted">Clip generation and approval diagnostics</small>
          </span>
        </summary>
        <div className="stat-grid intelligence-health-grid">
          {operationalChecks.map((item) => (
            <StatCard key={item.label} label={item.label} value={item.value} detail={item.detail} tone={item.tone} />
          ))}
        </div>
      </details>
    </main>
  );
}
