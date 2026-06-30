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
} from "@/components/ui";
import {
  CONTENT_OPPORTUNITY_CATEGORIES,
  CONTENT_OPPORTUNITY_CATEGORY_LABELS,
  CONTENT_OPPORTUNITY_TYPES,
  CONTENT_OPPORTUNITY_TYPE_LABELS,
} from "@/server/ai/contentOpportunitySchema";
import { MINISTRY_MOMENT_TYPES } from "@/server/ai/ministryMomentSchema";
import { MINISTRY_TOPICS } from "@/server/ai/sermonIntelligenceSchema";
import {
  type KnowledgeBaseResult,
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

const SCRIPTURE_USAGE_LABELS: Record<ScriptureUsageType, string> = {
  READ: "Read aloud",
  QUOTED: "Quoted",
  REFERENCED: "Referenced",
  IMPLIED: "Implied theme",
};

const MINISTRY_MOMENT_LABELS: Record<MinistryMomentType, string> = {
  PRAYER_MOMENT: "Prayer moment",
  ALTAR_CALL: "Altar call",
  SALVATION_INVITATION: "Salvation invitation",
  PROPHETIC_MOMENT: "Prophetic moment",
  FAITH_DECLARATION: "Faith declaration",
  ENCOURAGEMENT_MOMENT: "Encouragement moment",
  TESTIMONY: "Testimony",
  CALL_TO_ACTION: "Call to action",
  DISCIPLESHIP_MOMENT: "Discipleship moment",
  LEADERSHIP_MOMENT: "Leadership moment",
  FAMILY_MARRIAGE_MOMENT: "Family or marriage moment",
  HEALING_MOMENT: "Healing moment",
  WORSHIP_MOMENT: "Worship moment",
  GIVING_STEWARDSHIP_MOMENT: "Giving or stewardship moment",
  CHURCH_VISION_MOMENT: "Church vision moment",
  SUNDAY_INVITATION_PROMOTION_MOMENT: "Sunday invitation",
  OTHER: "Other",
};

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

function formatList(items: string[], fallback = "Not indexed yet"): string {
  return items.length > 0 ? items.join(", ") : fallback;
}

function humanizeUnknownLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatMomentLabel(value: string): string {
  return MINISTRY_MOMENT_LABELS[value as MinistryMomentType] ?? humanizeUnknownLabel(value);
}

function buildMatchReason(
  sermon: KnowledgeBaseResult,
  filters: {
    query?: string;
    scripture?: string;
    bibleBook?: string;
    topics?: string[];
    ministryMomentType?: MinistryMomentType;
    contentType?: ContentOpportunityType;
    clipCategory?: string;
  },
): string {
  const query = filters.query?.toLowerCase();

  if (query) {
    if (sermon.centralTheme?.toLowerCase().includes(query)) {
      return `Theme match: ${sermon.centralTheme}`;
    }

    const scripture = sermon.scriptures.find((item) => item.toLowerCase().includes(query));
    if (scripture) {
      return `Scripture match: ${scripture}`;
    }

    const topic = sermon.topTopics.find((item) => item.toLowerCase().includes(query));
    if (topic) {
      return `Topic match: ${topic}`;
    }

    const clip = sermon.clipLinks.find((item) => item.title.toLowerCase().includes(query));
    if (clip) {
      return `Clip match: ${clip.title}`;
    }

    const content = sermon.contentLinks.find((item) => item.title.toLowerCase().includes(query));
    if (content) {
      return `Content idea match: ${content.title}`;
    }

    if (sermon.title.toLowerCase().includes(query)) {
      return "Title match";
    }
  }

  if (filters.scripture && sermon.scriptures.length > 0) {
    return `Scripture match: ${sermon.scriptures[0]}`;
  }

  if (filters.bibleBook && sermon.scriptures.length > 0) {
    return `Bible book match: ${sermon.scriptures[0]}`;
  }

  if (filters.topics && filters.topics.length > 0 && sermon.topTopics.length > 0) {
    return `Topic match: ${sermon.topTopics[0]}`;
  }

  if (filters.ministryMomentType) {
    return `Ministry moment: ${formatMomentLabel(filters.ministryMomentType)}`;
  }

  if (filters.contentType && sermon.contentLinks.length > 0) {
    return `Content idea: ${CONTENT_OPPORTUNITY_TYPE_LABELS[filters.contentType]}`;
  }

  if (filters.clipCategory && sermon.clipLinks.length > 0) {
    return `Clip category: ${sermon.clipLinks[0].category ?? filters.clipCategory}`;
  }

  return sermon.centralTheme
    ? `Theme: ${sermon.centralTheme}`
    : sermon.primaryScripture
      ? `Scripture: ${sermon.primaryScripture}`
      : "Reusable sermon record";
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
  const hasAdvancedFilters = Boolean(
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
      ? "No sermons matched the current search."
      : scopeAvailability.sermonsWithIntelligence === 0
        ? "Sermons are processed, but sermon intelligence has not been generated yet for this scope."
        : "No indexed sermon intelligence is available yet.";
  const intelligenceNote = scopeAvailability.sermonsProcessed > 0 && scopeAvailability.sermonsWithIntelligence === 0
    ? "Basic sermon search is available. Generate sermon intelligence to unlock stronger theme, scripture, and moment matching."
    : null;

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Knowledge Base"
        title="Search your sermon knowledge"
        description="Find reusable sermons, scriptures, themes, clips, and content ideas."
      />

      <nav className="knowledge-quiet-links" aria-label="Knowledge Base links">
        <Link href="/">Dashboard</Link>
        <Link href="/sermons">Sermon Library</Link>
        <Link href="/opportunities">Content Ideas</Link>
        <Link href="/intelligence-dashboard">Ministry Patterns</Link>
        <Link href="/ready-to-post">Ready Queue</Link>
      </nav>

      <form method="get" className="knowledge-search-panel">
        <div className="knowledge-search-row">
          <label className="knowledge-search-field">
            <span className="small muted">Search knowledge base</span>
            <input name="query" defaultValue={filters.query ?? ""} placeholder="Search sermons, scriptures, themes, or clips" />
          </label>
          <button type="submit" className="button primary">Search</button>
          {hasActiveFilters ? <Link href="/knowledge-base" className="button tertiary">Clear</Link> : null}
        </div>

        <details className="knowledge-advanced-filters" open={hasAdvancedFilters}>
          <summary>
            <span>
              <strong>Advanced filters</strong>
              <small className="muted">{hasAdvancedFilters ? "Filtered results" : "Preacher, church, date, scripture, topics, clips, and content"}</small>
            </span>
          </summary>

          <div className="knowledge-filter-grid">
            <label>
              <span>Preacher</span>
              <input name="preacher" defaultValue={filters.preacher ?? ""} placeholder="Any preacher" />
            </label>
            <label>
              <span>Church</span>
              <input name="churchName" defaultValue={filters.churchName ?? ""} placeholder="Any church" />
            </label>
            <label>
              <span>Date</span>
              <input name="sermonDate" type="date" defaultValue={filters.sermonDate ?? ""} />
            </label>
            <label>
              <span>Scripture</span>
              <input name="scripture" defaultValue={filters.scripture ?? ""} placeholder="John 3:16" />
            </label>
            <label>
              <span>Bible book</span>
              <input name="bibleBook" defaultValue={filters.bibleBook ?? ""} placeholder="Romans" />
            </label>
            <label>
              <span>Scripture use</span>
              <select name="scriptureUsageType" defaultValue={filters.scriptureUsageType ?? ""}>
                <option value="">Any scripture use</option>
                {SCRIPTURE_USAGE_TYPES.map((usageType) => (
                  <option key={usageType} value={usageType}>{SCRIPTURE_USAGE_LABELS[usageType]}</option>
                ))}
              </select>
            </label>
            <label className="knowledge-checkbox-label">
              <input name="primaryScriptureOnly" type="checkbox" value="true" defaultChecked={filters.primaryScriptureOnly === "true"} />
              <span>Primary scripture only</span>
            </label>
            <label>
              <span>Topics</span>
              <input
                name="topics"
                defaultValue={filters.topics ?? ""}
                placeholder="prayer, faith"
                list="knowledge-topic-options"
              />
            </label>
            <datalist id="knowledge-topic-options">
              {MINISTRY_TOPICS.map((topic) => (
                <option key={topic} value={topic} />
              ))}
            </datalist>
            <label>
              <span>Ministry moment</span>
              <select name="ministryMomentType" defaultValue={filters.ministryMomentType ?? ""}>
                <option value="">Any ministry moment</option>
                {MINISTRY_MOMENT_TYPES.map((momentType) => (
                  <option key={momentType} value={momentType}>{MINISTRY_MOMENT_LABELS[momentType]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Clip category</span>
              <input name="clipCategory" defaultValue={filters.clipCategory ?? ""} placeholder="Best Prayer Clip" />
            </label>
            <label>
              <span>Content category</span>
              <select name="contentCategory" defaultValue={filters.contentCategory ?? ""}>
                <option value="">Any content category</option>
                {CONTENT_OPPORTUNITY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CONTENT_OPPORTUNITY_CATEGORY_LABELS[category]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Content type</span>
              <select name="contentType" defaultValue={filters.contentType ?? ""}>
                <option value="">Any content type</option>
                {CONTENT_OPPORTUNITY_TYPES.map((type) => (
                  <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
          </div>
        </details>
      </form>

      <section className="knowledge-result-summary">
        <article>
          <span className="muted small">Processed sermons</span>
          <strong>{scopeAvailability.sermonsProcessed}</strong>
        </article>
        <article>
          <span className="muted small">Search results</span>
          <strong>{result.total}</strong>
        </article>
        {intelligenceNote ? <p className="muted small">{intelligenceNote}</p> : null}
      </section>

      <section className="knowledge-results-section" aria-label="Sermon Results">
        {result.results.length === 0 ? (
          <EmptyState title="No matches found" description={emptyReason} action={hasActiveFilters ? { label: "Clear filters", href: "/knowledge-base", variant: "secondary" } : undefined} />
        ) : (
          <ul className="knowledge-result-list">
            {result.results.map((sermon) => {
              const matchReason = buildMatchReason(sermon, payload);
              const topScriptureOrTheme = sermon.primaryScripture ?? sermon.scriptures[0] ?? sermon.centralTheme;

              return (
                <li key={sermon.id} className="knowledge-result-card">
                  <div className="knowledge-result-main">
                    <div className="stack-sm">
                      <p className="kicker">{matchReason}</p>
                      <h3>{sermon.title}</h3>
                      <p className="muted small">
                        {sermon.speakerName} at {sermon.churchName}
                        {sermon.sermonDate ? ` | ${new Date(sermon.sermonDate).toLocaleDateString()}` : ""}
                      </p>
                    </div>

                    {topScriptureOrTheme ? (
                      <p className="knowledge-result-highlight">{topScriptureOrTheme}</p>
                    ) : null}

                    {sermon.summary ? <p className="muted">{sermon.summary}</p> : null}

                    <div className="knowledge-signal-row">
                      <span><strong>Scriptures</strong>{formatList(sermon.scriptures.slice(0, 3))}</span>
                      <span><strong>Themes</strong>{formatList(sermon.topTopics.slice(0, 4))}</span>
                      <span><strong>Moments</strong>{formatList(sermon.ministryMoments.slice(0, 3).map(formatMomentLabel))}</span>
                    </div>
                  </div>

                  <div className="knowledge-result-side">
                    <div className="knowledge-readiness-pills">
                      <span>Clips {sermon.approvedClipCount}/{sermon.clipCount}</span>
                      <span>Content {sermon.approvedContentOpportunityCount}/{sermon.contentOpportunityCount}</span>
                    </div>

                    {sermon.clipLinks.length > 0 ? (
                      <div className="knowledge-related-list">
                        <strong>Relevant clips</strong>
                        {sermon.clipLinks.slice(0, 3).map((clip) => (
                          <Link key={clip.id} href={`/sermons/${sermon.id}/review`} className="text-link">
                            {clip.title}
                          </Link>
                        ))}
                      </div>
                    ) : null}

                    {sermon.contentLinks.length > 0 ? (
                      <div className="knowledge-related-list">
                        <strong>Content ideas</strong>
                        {sermon.contentLinks.slice(0, 2).map((item) => (
                          <Link key={item.id} href={`/opportunities?sermonId=${sermon.id}`} className="text-link">
                            {item.title}
                          </Link>
                        ))}
                      </div>
                    ) : null}

                    <div className="knowledge-result-actions">
                      <Link href={`/sermons/${sermon.id}`} className="button primary">Open sermon</Link>
                      {sermon.clipCount > 0 ? <Link href={`/sermons/${sermon.id}/review`} className="button tertiary">Review clips</Link> : null}
                      <Link href={`/opportunities?sermonId=${sermon.id}`} className="button tertiary">Use this sermon</Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
