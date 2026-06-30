import Link from "next/link";
import type {
  ContentOpportunityCategory,
  ContentOpportunityStatus,
  ContentOpportunityType,
  MinistryMomentType,
  Prisma,
} from "@prisma/client";

import {
  PageHeader,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { OpportunitiesExperience } from "@/app/opportunities/opportunities-experience";
import {
  CONTENT_OPPORTUNITY_TYPES,
  CONTENT_OPPORTUNITY_TYPE_LABELS,
} from "@/server/ai/contentOpportunitySchema";

type SearchParams = {
  sermonId?: string;
  category?: string;
  type?: string;
  status?: string;
  topic?: string;
  scripture?: string;
  ministryMomentType?: string;
};

const STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED", "REJECTED", "USED", "ARCHIVED"] as const;
const CATEGORIES = ["SOCIAL", "DEVOTIONAL", "DISCIPLESHIP", "PROMOTION", "WRITTEN", "ENGAGEMENT", "RECAP"] as const;

function formatStatusLabel(status: (typeof STATUSES)[number]): string {
  return status.replace(/_/g, " ").toLowerCase();
}

function asCategory(value?: string): ContentOpportunityCategory | null {
  if (!value) {
    return null;
  }

  return CATEGORIES.includes(value as ContentOpportunityCategory)
    ? (value as ContentOpportunityCategory)
    : null;
}

function asStatus(value?: string): ContentOpportunityStatus | null {
  if (!value) {
    return null;
  }

  return STATUSES.includes(value as ContentOpportunityStatus)
    ? (value as ContentOpportunityStatus)
    : null;
}

function asType(value?: string): ContentOpportunityType | null {
  if (!value) {
    return null;
  }

  return CONTENT_OPPORTUNITY_TYPES.includes(value as ContentOpportunityType)
    ? (value as ContentOpportunityType)
    : null;
}

function asMinistryMomentType(value?: string): MinistryMomentType | null {
  if (!value) {
    return null;
  }

  const allowed: MinistryMomentType[] = [
    "PRAYER_MOMENT",
    "ALTAR_CALL",
    "SALVATION_INVITATION",
    "PROPHETIC_MOMENT",
    "FAITH_DECLARATION",
    "ENCOURAGEMENT_MOMENT",
    "TESTIMONY",
    "CALL_TO_ACTION",
    "DISCIPLESHIP_MOMENT",
    "LEADERSHIP_MOMENT",
    "FAMILY_MARRIAGE_MOMENT",
    "HEALING_MOMENT",
    "WORSHIP_MOMENT",
    "GIVING_STEWARDSHIP_MOMENT",
    "CHURCH_VISION_MOMENT",
    "SUNDAY_INVITATION_PROMOTION_MOMENT",
    "OTHER",
  ];

  return allowed.includes(value as MinistryMomentType)
    ? (value as MinistryMomentType)
    : null;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;

  const category = asCategory(filters.category);
  const status = asStatus(filters.status);
  const opportunityType = asType(filters.type);
  const ministryMomentType = asMinistryMomentType(filters.ministryMomentType);

  const where: Prisma.ContentOpportunityWhereInput = {
    AND: [
      filters.sermonId ? { sermonId: filters.sermonId } : {},
      category ? { category } : {},
      opportunityType ? { opportunityType } : {},
      status ? { status } : {},
      filters.scripture ? { relatedScripture: { contains: filters.scripture } } : {},
      ministryMomentType ? { ministryMoment: { momentType: ministryMomentType } } : {},
      filters.topic ? { sermon: { topicTags: { some: { topic: { contains: filters.topic } } } } } : {},
    ],
  };

  const [opportunities, sermons, momentTypes] = await Promise.all([
    prisma.contentOpportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sermonId: true,
        category: true,
        opportunityType: true,
        title: true,
        shortDescription: true,
        bodyContent: true,
        editedContent: true,
        approvedContent: true,
        confidenceScore: true,
        suggestedPlatform: true,
        relatedScripture: true,
        status: true,
        createdAt: true,
        sermon: {
          select: {
            title: true,
          },
        },
        ministryMoment: {
          select: {
            momentType: true,
          },
        },
      },
      take: 300,
    }),
    prisma.sermon.findMany({
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.ministryMoment.findMany({
      select: { momentType: true },
      distinct: ["momentType"],
      take: 100,
    }),
  ]);

  const topicSuggestions = await prisma.sermonTopicTag.findMany({
    select: { topic: true },
    distinct: ["topic"],
    orderBy: { topic: "asc" },
    take: 100,
  });

  const normalized = opportunities.map((item) => ({
    id: item.id,
    sermonId: item.sermonId,
    sermonTitle: item.sermon.title,
    category: item.category,
    opportunityType: item.opportunityType,
    title: item.title,
    shortDescription: item.shortDescription,
    bodyContent: item.bodyContent,
    editedContent: item.editedContent,
    approvedContent: item.approvedContent,
    confidenceScore: item.confidenceScore,
    suggestedPlatform: item.suggestedPlatform,
    relatedScripture: item.relatedScripture,
    ministryMomentType: item.ministryMoment?.momentType ?? null,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  }));
  const activeSermonId = filters.sermonId?.trim() || sermons[0]?.id || null;
  const activeSermonTitle = sermons.find((sermon) => sermon.id === activeSermonId)?.title ?? null;
  const hasIdeas = normalized.length > 0;
  const hasActiveFilters = Boolean(
    filters.sermonId ||
    filters.category ||
    filters.type ||
    filters.status ||
    filters.topic ||
    filters.scripture ||
    filters.ministryMomentType,
  );
  const opportunityStats = hasIdeas
    ? [
        { label: "Ideas shown", value: normalized.length },
        ...(sermons.length > 0 ? [{ label: "Sermons available", value: sermons.length }] : []),
        ...(momentTypes.length > 0 ? [{ label: "Moment types", value: momentTypes.length }] : []),
      ]
    : [];

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Publishing Ideas"
        title="Create post ideas from sermons"
        description="Generate sermon-based captions, devotionals, invitations, recaps, and prompts."
        meta={(
          <nav className="opportunities-quiet-links" aria-label="Ideas support links">
            <Link href="/sermons">Sermon Library</Link>
            <Link href="/knowledge-base">Knowledge Base</Link>
          </nav>
        )}
      />

      <OpportunitiesExperience
        opportunities={normalized}
        activeSermonId={activeSermonId}
        activeSermonTitle={activeSermonTitle}
      />

      {opportunityStats.length > 0 ? (
        <section className="secondary-command-strip opportunities-stat-strip">
          {opportunityStats.map((stat) => (
            <article key={stat.label}>
              <span className="muted small">{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </section>
      ) : null}

      <details className="opportunities-filter-details" open={hasIdeas || hasActiveFilters}>
        <summary>
          <span>
            <strong>{hasIdeas ? "Filter ideas" : "Choose a different sermon"}</strong>
            <span className="muted small">Sermon, category, status, scripture, or ministry moment.</span>
          </span>
        </summary>
        <form method="get" className="actions-row opportunities-filter-form">
          <select name="sermonId" defaultValue={filters.sermonId ?? ""} style={{ minWidth: "14rem" }}>
            <option value="">All sermons</option>
            {sermons.map((sermon) => (
              <option key={sermon.id} value={sermon.id}>{sermon.title}</option>
            ))}
          </select>

          <select name="category" defaultValue={filters.category ?? ""} style={{ minWidth: "11rem" }}>
            <option value="">All categories</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{category.toLowerCase()}</option>
            ))}
          </select>

          <select name="type" defaultValue={filters.type ?? ""} style={{ minWidth: "16rem" }}>
            <option value="">All types</option>
            {CONTENT_OPPORTUNITY_TYPES.map((type) => (
              <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
            ))}
          </select>

          <select name="status" defaultValue={filters.status ?? ""} style={{ minWidth: "12rem" }}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>{formatStatusLabel(status)}</option>
            ))}
          </select>

          <input name="topic" defaultValue={filters.topic ?? ""} placeholder="Topic" list="opportunity-topic-options" style={{ minWidth: "10rem" }} />
          <datalist id="opportunity-topic-options">
            {topicSuggestions.map((topic) => (
              <option key={topic.topic} value={topic.topic} />
            ))}
          </datalist>

          <input name="scripture" defaultValue={filters.scripture ?? ""} placeholder="Scripture" style={{ minWidth: "10rem" }} />

          <select name="ministryMomentType" defaultValue={filters.ministryMomentType ?? ""} style={{ minWidth: "14rem" }}>
            <option value="">All ministry moment types</option>
            {momentTypes.map((item) => (
              <option key={item.momentType} value={item.momentType}>{item.momentType}</option>
            ))}
          </select>

          <button type="submit" className="button primary">Apply</button>
          <Link href="/opportunities" className="button tertiary">Clear</Link>
        </form>
      </details>
    </main>
  );
}
