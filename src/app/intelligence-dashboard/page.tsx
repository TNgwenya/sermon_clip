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

  const getEmptyMessage = () => dashboardEmptyMessage({
    hasProcessedSermons,
    hasGeneratedIntelligence,
    hasChurchFilter,
  });

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Ministry Intelligence"
        title="See what your sermons are teaching over time"
        description="A pastor-friendly view of recurring themes, scriptures, ministry moments, clips, and content opportunities."
        actions={[
          { label: "Dashboard", href: "/", variant: "secondary" },
          { label: "Ready Queue", href: "/ready-to-post", variant: "primary" },
          { label: "Sermon Library", href: "/sermons" },
          { label: "Knowledge Base", href: "/knowledge-base" },
          { label: "Content Ideas", href: "/opportunities" },
        ]}
      />

      <section className="secondary-command-strip">
        <article>
          <span className="muted small">Sermons processed</span>
          <strong>{dashboard.totals.sermonsProcessed}</strong>
        </article>
        <article>
          <span className="muted small">Ministry moments</span>
          <strong>{dashboard.totals.ministryMomentsDetected}</strong>
        </article>
        <article>
          <span className="muted small">Approved clips</span>
          <strong>{dashboard.totals.clipsApproved}</strong>
        </article>
        <article>
          <span className="muted small">Content ready</span>
          <strong>{dashboard.totals.contentOpportunitiesApproved}</strong>
        </article>
      </section>

      <SectionCard title="Focus This View" description="Filter patterns to a specific church when you are managing more than one congregation or campus.">
        <form method="get" className="actions-row">
          <input name="churchName" placeholder="Church scope (optional)" defaultValue={filters.churchName ?? ""} style={{ minWidth: "14rem" }} />
          <button type="submit" className="button primary">Apply</button>
          <Link href="/intelligence-dashboard" className="button tertiary">Clear</Link>
        </form>
      </SectionCard>

      <SectionCard title="Weekly Multiplication Snapshot" description="A quick read on sermon clips, ministry moments, and content ideas.">
        <div className="stat-grid">
          <StatCard label="Sermons processed" value={dashboard.totals.sermonsProcessed} tone="accent" />
          <StatCard label="Ministry moments" value={dashboard.totals.ministryMomentsDetected} />
          <StatCard label="Clips suggested" value={dashboard.totals.clipsSuggested} />
          <StatCard label="Clips approved" value={dashboard.totals.clipsApproved} tone="success" />
          <StatCard label="Clips rendered" value={dashboard.totals.clipsRendered} />
          <StatCard label="Content generated" value={dashboard.totals.contentOpportunitiesGenerated} />
          <StatCard label="Content approved" value={dashboard.totals.contentOpportunitiesApproved} tone="success" />
          <StatCard label="Content used" value={dashboard.totals.contentOpportunitiesUsed} tone="success" />
        </div>
      </SectionCard>

      <SectionCard title="Pastor Teaching Patterns" description="Themes and scriptures that keep showing up across sermons.">
        <div className="stat-grid">
          <StatCard label="Average opportunities per sermon" value={dashboard.pastorLearning.averageContentOpportunitiesPerSermon} tone="accent" />
          <StatCard label="No generated clips" value={dashboard.pastorLearning.sermonsWithNoGeneratedClips} tone="warning" />
          <StatCard label="No approved content" value={dashboard.pastorLearning.sermonsWithNoApprovedContent} tone="warning" />
        </div>

        <h3>Most Preached Topics</h3>
        {dashboard.pastorLearning.mostPreachedTopics.length === 0 ? (
          <EmptyState title="No topic data yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.pastorLearning.mostPreachedTopics.slice(0, 10).map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot done" />
                <span>{item.label}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}

        <h3>Most Used Scriptures</h3>
        {dashboard.pastorLearning.mostUsedScriptures.length === 0 ? (
          <EmptyState title="No scripture data yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.pastorLearning.mostUsedScriptures.slice(0, 10).map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot done" />
                <span>{item.label}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}

        <h3>Most Referenced Bible Books</h3>
        {dashboard.pastorLearning.mostReferencedBooks.length === 0 ? (
          <EmptyState title="No book data yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.pastorLearning.mostReferencedBooks.slice(0, 10).map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot done" />
                <span>{item.label}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Church Content Patterns" description="How sermon teaching is being multiplied into clips, captions, devotionals, and invitations.">
        <h3>Content Categories Produced</h3>
        {dashboard.churchLearning.contentCategoriesProduced.length === 0 ? (
          <EmptyState title="No category data yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.churchLearning.contentCategoriesProduced.map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot pending" />
                <span>{item.label.toLowerCase()}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}

        <h3>Scripture Usage Distribution</h3>
        {dashboard.churchLearning.scriptureUsageDistribution.length === 0 ? (
          <EmptyState title="No scripture distribution yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.churchLearning.scriptureUsageDistribution.map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot pending" />
                <span>{item.label}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}

        <h3>Clip Category Distribution</h3>
        {dashboard.churchLearning.clipCategoryDistribution.length === 0 ? (
          <EmptyState title="No clip category data yet" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.churchLearning.clipCategoryDistribution.map((item) => (
              <li key={item.label} className="status-item">
                <span className="status-dot pending" />
                <span>{item.label}</span>
                <span className="muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}

        <p><strong>Approved vs generated clips:</strong> {dashboard.churchLearning.approvedVsGeneratedClips.approved}/{dashboard.churchLearning.approvedVsGeneratedClips.generated}</p>
        <p><strong>Approved vs generated content:</strong> {dashboard.churchLearning.approvedVsGeneratedContent.approved}/{dashboard.churchLearning.approvedVsGeneratedContent.generated}</p>
      </SectionCard>

      <SectionCard title="Recent Sermon Activity" description="Open recent sermons and keep moving them toward review, preparation, and posting.">
        {dashboard.recentActivity.length === 0 ? (
          <EmptyState title="No recent activity" description={getEmptyMessage()} />
        ) : (
          <ul className="status-list">
            {dashboard.recentActivity.map((item) => (
              <li key={item.sermonId} className="status-item">
                <span className="status-dot done" />
                <Link href={`/sermons/${item.sermonId}`} className="text-link">{item.title}</Link>
                <span className="muted">Theme: {item.centralTheme ?? "-"}</span>
                <span className="muted">Clips: {item.clipCount}, Content: {item.opportunityCount}</span>
                <Link href={`/sermons/${item.sermonId}/review`} className="button tertiary">Review clips</Link>
                <span className="small muted">{new Date(item.updatedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
