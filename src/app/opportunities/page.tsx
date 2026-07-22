import Link from "next/link";
import { Suspense } from "react";
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
import { databaseReadBatch, prisma } from "@/lib/prisma";
import { normalizeContentHashtags } from "@/lib/contentPublishing";
import { resolveContentOpportunityContract } from "@/lib/contentOpportunityContracts";
import { buildContentContractPresentation } from "@/lib/contentWorkflowUi";
import { OpportunitiesExperience } from "@/app/opportunities/opportunities-experience";
import { ContentGenerationStatus } from "@/app/opportunities/content-generation-status";
import { buildContentOpportunityJobStatusView } from "@/lib/contentOpportunityJobs";
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
  opportunityId?: string;
};

const STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED", "REJECTED", "USED", "ARCHIVED"] as const;
const CATEGORIES = ["SOCIAL", "DEVOTIONAL", "DISCIPLESHIP", "PROMOTION", "WRITTEN", "ENGAGEMENT", "RECAP"] as const;

function findRecentContentOpportunityGenerationJob(sermonId: string) {
  const recentWindowStart = new Date(Date.now() - 12 * 60 * 60_000);

  return prisma.processingJob.findFirst({
    where: {
      sermonId,
      type: "GENERATE_CONTENT_OPPORTUNITIES",
      createdAt: { gte: recentWindowStart },
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      generationSummary: true,
    },
  });
}

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

async function OpportunityResults({
  filters,
  activeSermonId,
  activeSermonTitle,
}: {
  filters: SearchParams;
  activeSermonId: string | null;
  activeSermonTitle: string | null;
}) {
  const category = asCategory(filters.category);
  const status = asStatus(filters.status);
  const opportunityType = asType(filters.type);
  const ministryMomentType = asMinistryMomentType(filters.ministryMomentType);
  const focusedOpportunityId = filters.opportunityId?.trim() || null;
  const scopedSermonId = activeSermonId ?? "__no_sermon__";

  const where: Prisma.ContentOpportunityWhereInput = {
    AND: [
      { sermonId: scopedSermonId },
      category ? { category } : {},
      opportunityType ? { opportunityType } : {},
      status
        ? { status }
        : focusedOpportunityId
          ? {
              OR: [
                { status: { notIn: ["REJECTED", "ARCHIVED"] } },
                { id: focusedOpportunityId },
              ],
            }
          : { status: { notIn: ["REJECTED", "ARCHIVED"] } },
      filters.scripture
        ? { relatedScripture: { contains: filters.scripture, mode: "insensitive" } }
        : {},
      ministryMomentType ? { ministryMoment: { momentType: ministryMomentType } } : {},
      filters.topic
        ? { sermon: { topicTags: { some: { topic: { contains: filters.topic, mode: "insensitive" } } } } }
        : {},
    ],
  };

  // A pooled runtime can run these reads concurrently. The direct fallback
  // keeps them on one transaction to avoid opening several remote connections.
  const [opportunities, momentTypes, preparedAssets, topicSuggestions, generationJob] = await databaseReadBatch([
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
        structuredContentJson: true,
        editedContent: true,
        approvedContent: true,
        confidenceScore: true,
        suggestedPlatform: true,
        relatedScripture: true,
        scriptureTranslation: true,
        translationReviewState: true,
        sourceTranscriptExcerpt: true,
        sourceTranscriptSegmentIds: true,
        sourceStartTimeSeconds: true,
        sourceEndTimeSeconds: true,
        aiReason: true,
        status: true,
        approvedRevisionId: true,
        createdAt: true,
        approvedRevision: {
          select: {
            revisionNumber: true,
            approvedAt: true,
          },
        },
        revisions: {
          orderBy: { revisionNumber: "desc" },
          take: 5,
          select: {
            id: true,
            revisionNumber: true,
            approvalState: true,
            createdBy: true,
            approvedAt: true,
            createdAt: true,
          },
        },
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
        relatedClip: {
          select: {
            id: true,
            sermonId: true,
            title: true,
            status: true,
            startTimeSeconds: true,
            endTimeSeconds: true,
            transcriptSafetyStatus: true,
          },
        },
      },
      take: 150,
    }),
    prisma.ministryMoment.findMany({
      where: { sermonId: scopedSermonId },
      select: { momentType: true },
      distinct: ["momentType"],
      take: 100,
    }),
    prisma.contentAsset.findMany({
      where: {
        status: { not: "ARCHIVED" },
        sermonId: scopedSermonId,
        contentOpportunityId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      distinct: ["contentOpportunityId"],
      select: {
        id: true,
        contentOpportunityId: true,
        assetType: true,
        status: true,
        platform: true,
        title: true,
        bodyContent: true,
        caption: true,
        hashtagsJson: true,
        callToAction: true,
        currentRevisionId: true,
        approvedRevisionId: true,
        currentRevision: {
          select: {
            approvalState: true,
            sourceOpportunityRevisionId: true,
          },
        },
      },
      take: 150,
    }),
    prisma.sermonTopicTag.findMany({
      where: { sermonId: scopedSermonId },
      select: { topic: true },
      distinct: ["topic"],
      orderBy: { topic: "asc" },
      take: 100,
    }),
    findRecentContentOpportunityGenerationJob(scopedSermonId),
  ]);

  const normalized = opportunities.map((item) => {
    const resolvedContent = resolveContentOpportunityContract({
      opportunityType: item.opportunityType,
      structuredContent: item.structuredContentJson,
      bodyContent: item.editedContent ?? item.bodyContent,
      title: item.title,
      sourceTranscriptExcerpt: item.sourceTranscriptExcerpt,
      relatedScripture: [item.relatedScripture, item.scriptureTranslation].filter(Boolean).join(" "),
      relatedClipTitle: item.relatedClip?.title,
      suggestedPlatform: item.suggestedPlatform,
    });
    const presentation = buildContentContractPresentation(resolvedContent.contract);

    return {
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
      artworkText: presentation.artworkText,
      publishingCaption: presentation.publishingCaption,
      contentStructureLabel: presentation.structureLabel,
      contentRequiresReview: resolvedContent.source === "LEGACY_CONVERTED",
      confidenceScore: item.confidenceScore,
      suggestedPlatform: item.suggestedPlatform,
      relatedScripture: item.relatedScripture,
      scriptureTranslation: item.scriptureTranslation,
      translationReviewState: item.translationReviewState,
      sourceTranscriptExcerpt: item.sourceTranscriptExcerpt,
      sourceTranscriptSegmentIds: Array.isArray(item.sourceTranscriptSegmentIds)
        ? item.sourceTranscriptSegmentIds.filter((segmentId): segmentId is string => typeof segmentId === "string" && Boolean(segmentId.trim()))
        : [],
      sourceStartTimeSeconds: item.sourceStartTimeSeconds,
      sourceEndTimeSeconds: item.sourceEndTimeSeconds,
      aiReason: item.aiReason,
      ministryMomentType: item.ministryMoment?.momentType ?? null,
      relatedClip: item.relatedClip,
      approvedRevisionId: item.approvedRevisionId,
      approvedRevision: item.approvedRevision ? {
        revisionNumber: item.approvedRevision.revisionNumber,
        approvedAt: item.approvedRevision.approvedAt?.toISOString() ?? null,
      } : null,
      revisions: item.revisions.map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        approvalState: revision.approvalState,
        createdBy: revision.createdBy,
        approvedAt: revision.approvedAt?.toISOString() ?? null,
        createdAt: revision.createdAt.toISOString(),
      })),
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    };
  });
  const hasActiveFilters = Boolean(
    filters.category ||
    filters.type ||
    filters.status ||
    filters.topic ||
    filters.scripture ||
    filters.ministryMomentType,
  );
  const clearFiltersHref = activeSermonId
    ? `/opportunities?sermonId=${encodeURIComponent(activeSermonId)}`
    : "/opportunities";
  const filterControls = activeSermonId ? (
    <details className="opportunities-filter-details" open={hasActiveFilters}>
      <summary>
        <span>
          <strong>{hasActiveFilters ? "Filters applied" : "More filters"}</strong>
          <span className="muted small">Type, status, scripture, topic, or ministry moment</span>
        </span>
      </summary>
      <form method="get" className="actions-row opportunities-filter-form">
        <input type="hidden" name="sermonId" value={activeSermonId ?? ""} />

        <select name="category" defaultValue={filters.category ?? ""} aria-label="Content category">
          <option value="">All categories</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>{item.toLowerCase()}</option>
          ))}
        </select>

        <select name="type" defaultValue={filters.type ?? ""} aria-label="Content type">
          <option value="">All types</option>
          {CONTENT_OPPORTUNITY_TYPES.map((type) => (
            <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
          ))}
        </select>

        <select name="status" defaultValue={filters.status ?? ""} aria-label="Review status">
          <option value="">Active ideas</option>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{formatStatusLabel(item)}</option>
          ))}
        </select>

        <input name="topic" defaultValue={filters.topic ?? ""} placeholder="Topic" list="opportunity-topic-options" aria-label="Topic" />
        <datalist id="opportunity-topic-options">
          {topicSuggestions.map((topic) => (
            <option key={topic.topic} value={topic.topic} />
          ))}
        </datalist>

        <input name="scripture" defaultValue={filters.scripture ?? ""} placeholder="Scripture" aria-label="Scripture" />

        <select name="ministryMomentType" defaultValue={filters.ministryMomentType ?? ""} aria-label="Ministry moment">
          <option value="">All ministry moments</option>
          {momentTypes.map((item) => (
            <option key={item.momentType} value={item.momentType}>{item.momentType.replace(/_/g, " ").toLowerCase()}</option>
          ))}
        </select>

        <button type="submit" className="button primary">Apply filters</button>
        <Link href={clearFiltersHref} className="button tertiary">Clear filters</Link>
      </form>
    </details>
  ) : null;

  return (
    <>
      <ContentGenerationStatus
        view={generationJob ? buildContentOpportunityJobStatusView(generationJob) : null}
      />
      <OpportunitiesExperience
      opportunities={normalized}
      activeSermonId={activeSermonId}
      activeSermonTitle={activeSermonTitle}
      hasActiveFilters={hasActiveFilters}
      clearFiltersHref={clearFiltersHref}
      includeInactive={status === "REJECTED" || status === "ARCHIVED"}
      initialOpportunityId={focusedOpportunityId}
      filterControls={filterControls}
      preparedAssets={preparedAssets.map((asset) => ({
        id: asset.id,
        contentOpportunityId: asset.contentOpportunityId,
        assetType: asset.assetType,
        status: asset.status,
        platform: asset.platform,
        title: asset.title,
        bodyContent: asset.bodyContent,
        caption: asset.caption,
        hashtags: normalizeContentHashtags(Array.isArray(asset.hashtagsJson) ? asset.hashtagsJson.filter((item): item is string => typeof item === "string") : []),
        callToAction: asset.callToAction,
        currentRevisionId: asset.currentRevisionId,
        approvedRevisionId: asset.approvedRevisionId,
        currentRevisionApprovalState: asset.currentRevision?.approvalState ?? null,
        sourceOpportunityRevisionId: asset.currentRevision?.sourceOpportunityRevisionId ?? null,
      }))}
      />
    </>
  );
}

function OpportunityResultsLoading({ sermonTitle }: { sermonTitle: string | null }) {
  return (
    <section className="panel stack-md" aria-busy="true" aria-live="polite">
      <div className="stack-sm">
        <p className="kicker">Finding the strongest ideas</p>
        <h2>{sermonTitle ? `Shaping content from ${sermonTitle}` : "Preparing your content ideas"}</h2>
        <p className="muted">The page is ready. Sermon Clip is bringing in the ideas, prepared graphics, and filters next.</p>
      </div>
      <div className="route-loading-grid" aria-hidden="true">
        <span className="route-loading-panel" />
        <span className="route-loading-panel" />
      </div>
    </section>
  );
}

function OpportunityWorkspaceLoading() {
  return (
    <section className="opportunities-sermon-context" aria-busy="true" aria-live="polite">
      <div className="stack-sm">
        <span className="route-loading-line" aria-hidden="true" />
        <span className="route-loading-line short" aria-hidden="true" />
        <span className="sr-only">Loading your latest sermon.</span>
      </div>
    </section>
  );
}

async function OpportunityWorkspace({ filters }: { filters: SearchParams }) {
  const sermons = await prisma.sermon.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const requestedSermonId = filters.sermonId?.trim();
  const activeSermon = sermons.find((sermon) => sermon.id === requestedSermonId) ?? sermons[0] ?? null;
  const activeSermonId = activeSermon?.id ?? null;
  const activeSermonTitle = activeSermon?.title ?? null;

  return (
    <>
      <section className={`opportunities-sermon-context${activeSermon ? "" : " is-empty"}`}>
        <div className="opportunities-sermon-title">
          <span className="muted small">Planning from</span>
          <h2>{activeSermonTitle ?? "Add your first sermon"}</h2>
          {!activeSermon ? (
            <p className="muted small">Upload or import a sermon to create clips, posts, devotionals, and follow-up resources.</p>
          ) : null}
        </div>
        {activeSermon ? (
          <details className="opportunities-sermon-change">
            <summary>Change sermon</summary>
            <form method="get" className="opportunities-sermon-picker">
              <label className="sr-only" htmlFor="opportunities-sermon-select">Choose a sermon</label>
              <div className="actions-row">
                <select id="opportunities-sermon-select" name="sermonId" defaultValue={activeSermonId ?? ""}>
                  {sermons.map((sermon) => (
                    <option key={sermon.id} value={sermon.id}>{sermon.title}</option>
                  ))}
                </select>
                <button type="submit" className="button secondary">Show content</button>
              </div>
            </form>
          </details>
        ) : (
          <Link href="/sermons/new" className="button primary">Add a sermon</Link>
        )}
      </section>

      <Suspense fallback={<OpportunityResultsLoading sermonTitle={activeSermonTitle} />}>
        <OpportunityResults
          filters={filters}
          activeSermonId={activeSermonId}
          activeSermonTitle={activeSermonTitle}
        />
      </Suspense>
    </>
  );
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;

  return (
    <main className="secondary-media-shell stack-lg">
      <PageHeader
        eyebrow="Content ideas"
        title="Plan, preview, then publish"
        description="Choose one idea at a time. Preview the content, edit the wording, and only move it to Design Studio or the calendar when it is ready."
        className="opportunities-page-header"
      />

      <Suspense fallback={<OpportunityWorkspaceLoading />}>
        <OpportunityWorkspace filters={filters} />
      </Suspense>
    </main>
  );
}
