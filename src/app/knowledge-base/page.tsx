import Link from "next/link";
import type {
  ContentOpportunityCategory,
  ContentOpportunityType,
  MinistryMomentType,
  ScriptureUsageType,
} from "@prisma/client";

import {
  EmptyState,
  PageHeader,
  SectionCard,
} from "@/components/ui";
import { MINISTRY_TOPICS } from "@/server/ai/sermonIntelligenceSchema";
import { MINISTRY_MOMENT_TYPES } from "@/server/ai/ministryMomentSchema";
import {
  CONTENT_OPPORTUNITY_CATEGORIES,
  CONTENT_OPPORTUNITY_TYPES,
  CONTENT_OPPORTUNITY_TYPE_LABELS,
} from "@/server/ai/contentOpportunitySchema";
import {
  getKnowledgeBaseScopeAvailability,
  searchSermonKnowledgeBase,
} from "@/server/workflow/knowledgeIntelligence";

type SearchParams = {
  query?: string;
  churchName?: string;
  preacher?: string;
  sermonDate?: string;
  scripture?: string;
  bibleBook?: string;
  scriptureUsageType?: string;
  primaryScriptureOnly?: string;
  topics?: string;
  ministryMomentType?: string;
  clipCategory?: string;
  contentCategory?: string;
  contentType?: string;
};

const SCRIPTURE_USAGE_TYPES: ScriptureUsageType[] = ["READ", "QUOTED", "REFERENCED", "IMPLIED"];

function asScriptureUsageType(value?: string): ScriptureUsageType | undefined {
  if (!value) {
    return undefined;
  }

  return SCRIPTURE_USAGE_TYPES.includes(value as ScriptureUsageType)
    ? (value as ScriptureUsageType)
    : undefined;
}

function asMinistryMomentType(value?: string): MinistryMomentType | undefined {
  if (!value) {
    return undefined;
  }

  return MINISTRY_MOMENT_TYPES.includes(value as MinistryMomentType)
    ? (value as MinistryMomentType)
    : undefined;
}

function asContentCategory(value?: string): ContentOpportunityCategory | undefined {
  if (!value) {
    return undefined;
  }

  return CONTENT_OPPORTUNITY_CATEGORIES.includes(value as ContentOpportunityCategory)
    ? (value as ContentOpportunityCategory)
    : undefined;
}

function asContentType(value?: string): ContentOpportunityType | undefined {
  if (!value) {
    return undefined;
  }

  return CONTENT_OPPORTUNITY_TYPES.includes(value as ContentOpportunityType)
    ? (value as ContentOpportunityType)
    : undefined;
}

function parseTopics(value?: string): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const topics = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return topics.length > 0 ? topics : undefined;
}

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;

  const payload = {
    query: filters.query?.trim() || undefined,
    churchName: filters.churchName?.trim() || undefined,
    preacher: filters.preacher?.trim() || undefined,
    sermonDate: filters.sermonDate?.trim() || undefined,
    scripture: filters.scripture?.trim() || undefined,
    bibleBook: filters.bibleBook?.trim() || undefined,
    scriptureUsageType: asScriptureUsageType(filters.scriptureUsageType),
    primaryScriptureOnly: filters.primaryScriptureOnly === "true",
    topics: parseTopics(filters.topics),
    ministryMomentType: asMinistryMomentType(filters.ministryMomentType),
    clipCategory: filters.clipCategory?.trim() || undefined,
    contentCategory: asContentCategory(filters.contentCategory),
    contentType: asContentType(filters.contentType),
  };

  const [result, scopeAvailability] = await Promise.all([
    searchSermonKnowledgeBase(payload, { take: 150 }),
    getKnowledgeBaseScopeAvailability({ churchName: payload.churchName }),
  ]);

  const hasActiveFilters = Boolean(
    payload.query ||
    payload.preacher ||
    payload.churchName ||
    payload.sermonDate ||
    payload.scripture ||
    payload.bibleBook ||
    payload.scriptureUsageType ||
    payload.primaryScriptureOnly ||
    (payload.topics && payload.topics.length > 0) ||
    payload.ministryMomentType ||
    payload.clipCategory ||
    payload.contentCategory ||
    payload.contentType,
  );

  const emptyReason = scopeAvailability.sermonsProcessed === 0
    ? "No sermons have been processed yet for this scope. Process at least one sermon to populate the knowledge base."
    : hasActiveFilters
      ? "No sermons matched the current filters."
      : scopeAvailability.sermonsWithIntelligence === 0
        ? "Sermons are processed, but sermon intelligence has not been generated yet for this scope."
        : "No indexed sermon intelligence is available yet.";

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Sermon Library"
        title="Find the moments your church should reuse"
        description="Search sermon themes, scriptures, ministry moments, suggested clips, and content ideas from saved sermons."
        actions={[
          { label: "Dashboard", href: "/", variant: "secondary" },
          { label: "Ready Queue", href: "/ready-to-post", variant: "primary" },
          { label: "Sermon Library", href: "/sermons" },
          { label: "Content Ideas", href: "/opportunities" },
          { label: "Ministry Patterns", href: "/intelligence-dashboard" },
        ]}
      />

      <section className="secondary-command-strip">
        <article>
          <span className="muted small">Processed sermons</span>
          <strong>{scopeAvailability.sermonsProcessed}</strong>
        </article>
        <article>
          <span className="muted small">With intelligence</span>
          <strong>{scopeAvailability.sermonsWithIntelligence}</strong>
        </article>
        <article>
          <span className="muted small">Search results</span>
          <strong>{result.total}</strong>
        </article>
      </section>

      <SectionCard title="Search Sermons" description="Find a sermon by theme, scripture, pastor, ministry moment, or reusable content idea.">
        <form method="get" className="actions-row">
          <input name="query" defaultValue={filters.query ?? ""} placeholder="Title, summary, theme" style={{ minWidth: "14rem" }} />
          <input name="preacher" defaultValue={filters.preacher ?? ""} placeholder="Preacher" style={{ minWidth: "10rem" }} />
          <input name="churchName" defaultValue={filters.churchName ?? ""} placeholder="Church" style={{ minWidth: "10rem" }} />
          <input name="sermonDate" type="date" defaultValue={filters.sermonDate ?? ""} style={{ minWidth: "10.5rem" }} />
          <input name="scripture" defaultValue={filters.scripture ?? ""} placeholder="Scripture (John 3:16)" style={{ minWidth: "11rem" }} />
          <input name="bibleBook" defaultValue={filters.bibleBook ?? ""} placeholder="Bible book (Romans)" style={{ minWidth: "11rem" }} />
          <select name="scriptureUsageType" defaultValue={filters.scriptureUsageType ?? ""} style={{ minWidth: "11rem" }}>
            <option value="">All scripture usage</option>
            {SCRIPTURE_USAGE_TYPES.map((usageType) => (
              <option key={usageType} value={usageType}>{usageType}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontWeight: "normal" }}>
            <input name="primaryScriptureOnly" type="checkbox" value="true" defaultChecked={filters.primaryScriptureOnly === "true"} />
            Primary scripture only
          </label>
          <input
            name="topics"
            defaultValue={filters.topics ?? ""}
            placeholder="Topics (comma-separated)"
            list="knowledge-topic-options"
            style={{ minWidth: "14rem" }}
          />
          <datalist id="knowledge-topic-options">
            {MINISTRY_TOPICS.map((topic) => (
              <option key={topic} value={topic} />
            ))}
          </datalist>
          <select name="ministryMomentType" defaultValue={filters.ministryMomentType ?? ""} style={{ minWidth: "15rem" }}>
            <option value="">All ministry moments</option>
            {MINISTRY_MOMENT_TYPES.map((momentType) => (
              <option key={momentType} value={momentType}>{momentType}</option>
            ))}
          </select>
          <input name="clipCategory" defaultValue={filters.clipCategory ?? ""} placeholder="Clip category" style={{ minWidth: "12rem" }} />
          <select name="contentCategory" defaultValue={filters.contentCategory ?? ""} style={{ minWidth: "12rem" }}>
            <option value="">All content categories</option>
            {CONTENT_OPPORTUNITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category.toLowerCase()}</option>
            ))}
          </select>
          <select name="contentType" defaultValue={filters.contentType ?? ""} style={{ minWidth: "15rem" }}>
            <option value="">All content types</option>
            {CONTENT_OPPORTUNITY_TYPES.map((type) => (
              <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
            ))}
          </select>
          <button type="submit" className="button primary">Search</button>
          <Link href="/knowledge-base" className="button tertiary">Clear</Link>
        </form>
      </SectionCard>

      <SectionCard title="Reusable Sermon Results" description="Open a sermon, review its clips, or turn it into more content for the week.">
        <p className="muted">{result.total} sermon{result.total === 1 ? "" : "s"} found.</p>

        {result.results.length === 0 ? (
          <EmptyState title="No matches found" description={emptyReason} action={hasActiveFilters ? { label: "Clear filters", href: "/knowledge-base", variant: "secondary" } : undefined} />
        ) : (
          <ul className="sermon-list">
            {result.results.map((sermon) => (
              <li key={sermon.id} className="candidate-card stack-sm">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <div className="stack-sm" style={{ minWidth: "16rem" }}>
                    <h3>{sermon.title}</h3>
                  <p className="muted small">{sermon.speakerName} · {sermon.churchName}</p>
                    <p className="small muted">Date: {sermon.sermonDate ? new Date(sermon.sermonDate).toLocaleDateString() : "-"}</p>
                  </div>
                  <div className="stack-sm" style={{ alignItems: "flex-end" }}>
                    <span className="status-pill">Clips {sermon.approvedClipCount}/{sermon.clipCount}</span>
                    <span className="status-pill">Content {sermon.approvedContentOpportunityCount}/{sermon.contentOpportunityCount}</span>
                  </div>
                </div>

                {sermon.centralTheme ? <p><strong>Theme:</strong> {sermon.centralTheme}</p> : null}
                {sermon.primaryScripture ? <p><strong>Primary Scripture:</strong> {sermon.primaryScripture}</p> : null}
                {sermon.summary ? <p className="muted">{sermon.summary}</p> : null}

                <div className="actions-row small muted">
                  <span><strong>Scriptures:</strong> {sermon.scriptures.slice(0, 4).join(", ") || "-"}</span>
                  <span><strong>Topics:</strong> {sermon.topTopics.slice(0, 6).join(", ") || "-"}</span>
                  <span><strong>Moments:</strong> {sermon.ministryMoments.slice(0, 4).join(", ") || "-"}</span>
                </div>

                {sermon.clipLinks.length > 0 ? (
                  <div className="actions-row small">
                    <strong>Relevant clips:</strong>
                    {sermon.clipLinks.slice(0, 3).map((clip) => (
                      <Link key={clip.id} href={`/sermons/${sermon.id}/review`} className="text-link">
                        {clip.title}
                      </Link>
                    ))}
                  </div>
                ) : null}

                {sermon.contentLinks.length > 0 ? (
                  <div className="actions-row small">
                    <strong>Relevant content ideas:</strong>
                    {sermon.contentLinks.slice(0, 3).map((item) => (
                      <Link key={item.id} href={`/opportunities?sermonId=${sermon.id}`} className="text-link">
                        {item.title}
                      </Link>
                    ))}
                  </div>
                ) : null}

                <div className="actions-row">
                  <Link href={`/sermons/${sermon.id}`} className="button secondary">Open sermon</Link>
                  <Link href={`/sermons/${sermon.id}/review`} className="button primary">Review clips</Link>
                  <Link href={`/opportunities?sermonId=${sermon.id}`} className="button tertiary">Content ideas</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
