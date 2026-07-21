"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  ConfidenceBadge,
  StatusBadge,
} from "@/components/ui";
import {
  generateContentOpportunitiesAction,
  generateContentPackAction,
  regenerateContentOpportunitiesAction,
  regenerateContentOpportunityTypeAction,
  updateContentOpportunityContentAction,
  updateContentOpportunityStatusAction,
} from "@/server/actions/contentOpportunities";
import { CONTENT_PACK_PRESETS } from "@/lib/contentPackPresets";
import {
  CONTENT_ASSET_TYPE_LABELS,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
  type ContentAssetTypeValue,
  type ContentPublishingPlatform,
} from "@/lib/contentPublishing";
import { isDesignableContentAssetType } from "@/lib/contentGraphicTemplates";
import {
  getOpportunityOutcome,
  OPPORTUNITY_OUTCOME_LABELS,
  OPPORTUNITY_OUTCOMES,
  rankOpportunitiesForValue,
  selectNextOpportunity,
  summarizeOpportunityValue,
  type OpportunityOutcome,
} from "@/lib/opportunityValue";
import {
  ContentAssetComposer,
  type ContentAssetComposerInitialValue,
} from "@/app/opportunities/content-asset-composer";
import {
  CONTENT_OPPORTUNITY_TYPE_LABELS,
  CONTENT_OPPORTUNITY_TYPES,
  type ContentOpportunityType,
} from "@/server/ai/contentOpportunitySchema";

type OpportunityStatus = "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "USED" | "ARCHIVED";

type OpportunityItem = {
  id: string;
  sermonId: string;
  sermonTitle: string;
  category: string;
  opportunityType: ContentOpportunityType;
  title: string;
  shortDescription: string | null;
  bodyContent: string;
  editedContent: string | null;
  approvedContent: string | null;
  confidenceScore: number | null;
  suggestedPlatform: string | null;
  relatedScripture: string | null;
  sourceTranscriptExcerpt: string | null;
  aiReason: string | null;
  ministryMomentType: string | null;
  status: OpportunityStatus;
  createdAt: string;
};

type Props = {
  opportunities: OpportunityItem[];
  activeSermonId: string | null;
  activeSermonTitle: string | null;
  preparedAssets?: PreparedAssetSummary[];
  hasActiveFilters?: boolean;
  clearFiltersHref?: string;
  includeInactive?: boolean;
  filterControls?: ReactNode;
};

export type PreparedAssetSummary = {
  id: string;
  contentOpportunityId: string | null;
  assetType: ContentAssetTypeValue;
  status: string;
  platform: ContentPublishingPlatform | null;
  title: string;
  bodyContent: string | null;
  caption: string | null;
  hashtags: string[];
  callToAction: string | null;
};

type EditDraft = {
  title: string;
  shortDescription: string;
  content: string;
};

type Feedback = {
  message: string;
  tone: "success" | "danger";
};

const OUTCOME_DESCRIPTIONS: Record<OpportunityOutcome, string> = {
  POST_NOW: "Captions, graphics, hooks, and short-form ideas you can use quickly.",
  EXTEND_MESSAGE: "Recaps and written pieces that carry the sermon beyond Sunday.",
  EQUIP_PEOPLE: "Prayer, reflection, family, youth, and small-group resources.",
  INVITE_PEOPLE: "Invitations, next-service promotion, and follow-up content.",
  PLAN_CONTENT: "Maps and calendars that help your team plan the week.",
};

function formatStatus(status: OpportunityStatus): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function statusTone(status: OpportunityStatus): "success" | "danger" | "accent" | "warning" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "USED") return "accent";
  if (status === "NEEDS_REVIEW") return "warning";
  return "neutral";
}

function sourceText(item: OpportunityItem, asset?: PreparedAssetSummary | null): string {
  return asset?.caption?.trim()
    || asset?.bodyContent?.trim()
    || item.approvedContent?.trim()
    || item.editedContent?.trim()
    || item.bodyContent;
}

function previewText(item: OpportunityItem, asset?: PreparedAssetSummary | null, length = 260): string {
  const source = sourceText(item, asset);
  return source.length > length ? `${source.slice(0, length).trimEnd()}…` : source;
}

function copyText(item: OpportunityItem, draft: EditDraft, asset?: PreparedAssetSummary | null): string {
  if (asset) {
    return [
      asset.caption?.trim() || asset.bodyContent?.trim() || sourceText(item),
      asset.hashtags.join(" "),
      asset.callToAction?.trim(),
    ].filter(Boolean).join("\n\n");
  }

  return draft.content.trim() || sourceText(item);
}

function previewActionLabel(item: OpportunityItem, asset?: PreparedAssetSummary | null): string {
  if (asset) {
    return isDesignableContentAssetType(asset.assetType)
      ? "Preview design"
      : "Preview ready post";
  }

  return item.status === "APPROVED" || item.status === "USED"
    ? "Preview & prepare"
    : "Preview & review";
}

function ContentIdeaPreview({
  item,
  asset,
  full = false,
}: {
  item: OpportunityItem;
  asset?: PreparedAssetSummary | null;
  full?: boolean;
}) {
  const assetType = asset?.assetType ?? mapOpportunityTypeToContentAssetType(item.opportunityType);
  const isGraphic = assetType === "QUOTE_GRAPHIC" || assetType === "SCRIPTURE_GRAPHIC";
  const isCarousel = assetType === "CAROUSEL";
  const isArtwork = isDesignableContentAssetType(assetType);
  const content = (asset && isArtwork
    ? asset.bodyContent?.trim() || asset.caption?.trim() || sourceText(item, asset)
    : sourceText(item, asset)).trim();
  const previewLength = isGraphic ? 280 : 520;
  const visibleContent = full || content.length <= previewLength
    ? content
    : `${content.slice(0, previewLength).trimEnd()}…`;
  const showFullContent = !full && visibleContent !== content;

  return (
    <div className={`opportunities-content-preview${isGraphic ? " is-graphic" : isCarousel ? " is-carousel" : " is-copy"}`}>
      <div className="opportunities-preview-canvas">
        <div className="opportunities-preview-brandline">
          <span>{CONTENT_ASSET_TYPE_LABELS[assetType]}</span>
          <span>{item.sermonTitle}</span>
        </div>
        {isGraphic ? (
          <blockquote>{visibleContent}</blockquote>
        ) : (
          <p>{visibleContent}</p>
        )}
        <div className="opportunities-preview-footer">
          <span>{item.relatedScripture || OPPORTUNITY_OUTCOME_LABELS[getOpportunityOutcome(item)]}</span>
          <span>{isCarousel ? "Swipe to continue" : item.suggestedPlatform || "Publishing copy"}</span>
        </div>
      </div>
      <div className="opportunities-preview-caption">
        <span className="muted small">
          {isArtwork
            ? "Copy preview · choose the final template and format in Design Studio"
            : "Full content preview · edit the wording before it reaches the calendar"}
        </span>
        {showFullContent ? (
          <details>
            <summary>Read full content</summary>
            <p>{content}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function OpportunitiesExperience({
  opportunities,
  activeSermonId,
  activeSermonTitle,
  preparedAssets = [],
  hasActiveFilters = false,
  clearFiltersHref = "/opportunities",
  includeInactive = false,
  filterControls,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"ALL" | ContentOpportunityType>("ALL");
  const [selectedOutcome, setSelectedOutcome] = useState<"ALL" | OpportunityOutcome>("ALL");
  const [visibleIdeaCount, setVisibleIdeaCount] = useState(4);
  const [openEditorId, setOpenEditorId] = useState<string | null>(null);
  const [previewOpportunityId, setPreviewOpportunityId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [composerOpportunityId, setComposerOpportunityId] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, EditDraft>>(() => {
    const entries: Record<string, EditDraft> = {};
    for (const item of opportunities) {
      entries[item.id] = {
        title: item.title,
        shortDescription: item.shortDescription ?? "",
        content: item.editedContent ?? item.bodyContent,
      };
    }
    return entries;
  });

  const preparedAssetByOpportunityId = useMemo(() => new Map(
    preparedAssets
      .filter((asset) => Boolean(asset.contentOpportunityId))
      .map((asset) => [asset.contentOpportunityId as string, asset]),
  ), [preparedAssets]);
  const preparedOpportunityIds = useMemo(
    () => Array.from(preparedAssetByOpportunityId.keys()),
    [preparedAssetByOpportunityId],
  );
  const rankedOpportunities = useMemo(
    () => rankOpportunitiesForValue(opportunities, preparedOpportunityIds),
    [opportunities, preparedOpportunityIds],
  );
  const visibleLibrary = useMemo(
    () => includeInactive ? opportunities : rankedOpportunities,
    [includeInactive, opportunities, rankedOpportunities],
  );
  const featuredOpportunity = useMemo(
    () => selectNextOpportunity(opportunities, preparedOpportunityIds),
    [opportunities, preparedOpportunityIds],
  );
  const browsableLibrary = useMemo(
    () => visibleLibrary.filter((item) => item.id !== featuredOpportunity?.id),
    [featuredOpportunity?.id, visibleLibrary],
  );
  const outcomeFilteredLibrary = useMemo(
    () => selectedOutcome === "ALL"
      ? browsableLibrary
      : browsableLibrary.filter((item) => getOpportunityOutcome(item) === selectedOutcome),
    [browsableLibrary, selectedOutcome],
  );
  const visibleIdeas = outcomeFilteredLibrary.slice(0, visibleIdeaCount);
  const hiddenIdeaCount = Math.max(0, outcomeFilteredLibrary.length - visibleIdeas.length);
  const valueSummary = useMemo(
    () => summarizeOpportunityValue(opportunities, preparedOpportunityIds),
    [opportunities, preparedOpportunityIds],
  );
  const featuredAsset = featuredOpportunity
    ? preparedAssetByOpportunityId.get(featuredOpportunity.id) ?? null
    : null;
  const journeyStep = featuredAsset
    ? 3
    : featuredOpportunity && (featuredOpportunity.status === "APPROVED" || featuredOpportunity.status === "USED")
      ? 2
      : 1;
  const composerOpportunity = composerOpportunityId
    ? opportunities.find((item) => item.id === composerOpportunityId) ?? null
    : null;
  const composerAsset = composerOpportunity
    ? preparedAssetByOpportunityId.get(composerOpportunity.id) ?? null
    : null;
  const downloadEligibleCount = opportunities.filter((item) => item.status === "APPROVED" || item.status === "USED").length;

  useEffect(() => {
    if (!openEditorId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`opportunity-editor-title-${openEditorId}`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [openEditorId]);

  function buildComposerInitialValue(item: OpportunityItem): ContentAssetComposerInitialValue {
    const asset = preparedAssetByOpportunityId.get(item.id);
    const draft = drafts[item.id];
    const bodyContent = asset?.bodyContent?.trim()
      || item.approvedContent?.trim()
      || draft?.content?.trim()
      || item.editedContent?.trim()
      || item.bodyContent;
    const assetType = asset?.assetType ?? mapOpportunityTypeToContentAssetType(item.opportunityType);

    return {
      assetId: asset?.id ?? null,
      sermonId: item.sermonId,
      sermonTitle: item.sermonTitle,
      opportunityId: item.id,
      assetType,
      assetTypeLabel: CONTENT_ASSET_TYPE_LABELS[assetType],
      status: asset?.status ?? null,
      title: asset?.title ?? draft?.title ?? item.title,
      bodyContent,
      caption: asset?.caption ?? bodyContent,
      hashtags: normalizeContentHashtags(asset?.hashtags),
      callToAction: asset?.callToAction ?? null,
      platform: asset?.platform ?? normalizeSuggestedPostingPlatform(item.suggestedPlatform),
    };
  }

  function refresh() {
    router.refresh();
  }

  function runAction(
    key: string,
    action: () => Promise<{ success: boolean; message: string }>,
  ) {
    setFeedback(null);
    setPendingAction(key);
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback({ message: result.message, tone: result.success ? "success" : "danger" });
        if (result.success) refresh();
      } catch {
        setFeedback({ message: "That action could not be completed. Please try again.", tone: "danger" });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function updateStatus(item: OpportunityItem, status: OpportunityStatus) {
    runAction(
      `status:${item.id}:${status}`,
      () => updateContentOpportunityStatusAction(item.sermonId, item.id, status),
    );
  }

  function saveEdit(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (!draft) return;

    runAction(`save:${item.id}`, () => updateContentOpportunityContentAction({
      opportunityId: item.id,
      sermonId: item.sermonId,
      title: draft.title,
      shortDescription: draft.shortDescription,
      content: draft.content,
    }));
  }

  function approveEdit(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (!draft) return;

    runAction(`status:${item.id}:APPROVED`, async () => {
      const saveResult = await updateContentOpportunityContentAction({
        opportunityId: item.id,
        sermonId: item.sermonId,
        title: draft.title,
        shortDescription: draft.shortDescription,
        content: draft.content,
      });
      if (!saveResult.success) return saveResult;

      return updateContentOpportunityStatusAction(item.sermonId, item.id, "APPROVED");
    });
  }

  function openReview(itemId: string) {
    setPreviewOpportunityId(itemId);
    setOpenEditorId(itemId);
    requestAnimationFrame(() => {
      document.getElementById(`opportunity-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function closeReview(itemId: string) {
    setOpenEditorId(null);
    requestAnimationFrame(() => {
      document.getElementById(`opportunity-primary-action-${itemId}`)?.focus();
    });
  }

  async function copyOpportunity(item: OpportunityItem) {
    const draft = drafts[item.id] ?? {
      title: item.title,
      shortDescription: item.shortDescription ?? "",
      content: item.editedContent ?? item.bodyContent,
    };

    try {
      await navigator.clipboard.writeText(copyText(item, draft, preparedAssetByOpportunityId.get(item.id)));
      setCopiedId(item.id);
      setFeedback({
        message: preparedAssetByOpportunityId.has(item.id) ? "Ready caption copied." : "Content copied.",
        tone: "success",
      });
    } catch {
      setFeedback({ message: "Copy failed. Open the idea and copy the text manually.", tone: "danger" });
    }
  }

  function renderPrimaryAction(item: OpportunityItem, className = "button primary") {
    const asset = preparedAssetByOpportunityId.get(item.id);
    const assetLocked = Boolean(asset && ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(asset.status));

    if (asset) {
      const isDesignable = isDesignableContentAssetType(asset.assetType);
      return (
        <a
          className={className}
          href={isDesignable
            ? `/ready-to-post/content-assets/${asset.id}/studio`
            : `/ready-to-post?contentAssetId=${asset.id}`}
          aria-label={`${isDesignable ? "Preview and edit design" : "Open Ready to Post asset"} for ${item.title}`}
        >
          {isDesignable
            ? assetLocked ? "View final design" : "Preview & edit design"
            : assetLocked ? "Open publishing version" : "Continue to scheduling"}
        </a>
      );
    }

    if (item.status === "APPROVED" || item.status === "USED") {
      return (
        <button
          type="button"
          id={`opportunity-primary-action-${item.id}`}
          className={className}
          disabled={isPending}
          onClick={() => setComposerOpportunityId(item.id)}
          aria-label={`Prepare ${item.title} for publishing`}
        >
          Prepare for publishing
        </button>
      );
    }

    return (
      <button
        type="button"
        id={`opportunity-primary-action-${item.id}`}
        className={className}
        disabled={isPending}
        onClick={() => openReview(item.id)}
        aria-label={`Review idea: ${item.title}`}
      >
        Review this idea
      </button>
    );
  }

  function renderReviewEditor(item: OpportunityItem) {
    if (openEditorId !== item.id) return null;

    const draft = drafts[item.id] ?? {
      title: item.title,
      shortDescription: item.shortDescription ?? "",
      content: item.editedContent ?? item.bodyContent,
    };

    return (
      <section className="opportunity-review-editor stack-md" aria-labelledby={`opportunity-editor-heading-${item.id}`}>
        <div className="stack-sm">
          <p className="kicker">Review</p>
          <h4 id={`opportunity-editor-heading-${item.id}`}>Shape the idea, then approve it</h4>
          <p className="muted small">Check the meaning and wording. Approval records the exact content your team reviewed.</p>
        </div>
        <label className="stack-sm" htmlFor={`opportunity-editor-title-${item.id}`}>
          Title
          <input
            id={`opportunity-editor-title-${item.id}`}
            value={draft.title}
            onChange={(event) => setDrafts((current) => ({
              ...current,
              [item.id]: { ...draft, title: event.target.value },
            }))}
            disabled={isPending}
          />
        </label>
        <label className="stack-sm">
          Short description
          <input
            value={draft.shortDescription}
            onChange={(event) => setDrafts((current) => ({
              ...current,
              [item.id]: { ...draft, shortDescription: event.target.value },
            }))}
            disabled={isPending}
          />
        </label>
        <label className="stack-sm">
          Content
          <textarea
            value={draft.content}
            onChange={(event) => setDrafts((current) => ({
              ...current,
              [item.id]: { ...draft, content: event.target.value },
            }))}
            disabled={isPending}
            rows={8}
          />
        </label>
        <div className="opportunity-review-actions">
          <button type="button" className="button secondary" disabled={isPending} onClick={() => saveEdit(item)}>
            {pendingAction === `save:${item.id}` ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="button primary" disabled={isPending} onClick={() => approveEdit(item)}>
            {pendingAction === `status:${item.id}:APPROVED` ? "Approving…" : "Approve idea"}
          </button>
          <button type="button" className="button danger" disabled={isPending} onClick={() => updateStatus(item, "REJECTED")}>
            Reject
          </button>
          <button type="button" className="button tertiary" disabled={isPending} onClick={() => closeReview(item.id)}>
            Close
          </button>
        </div>
      </section>
    );
  }

  if (!activeSermonId) {
    return null;
  }

  if (opportunities.length === 0 && hasActiveFilters) {
    return (
      <section className="opportunities-board stack-lg">
        <section className="card opportunities-empty-card">
          <div className="stack-sm">
            <p className="kicker">No matches</p>
            <h2>No ideas match these filters</h2>
            <p className="muted">The sermon may still have useful content. Clear the filters to return to its active idea library.</p>
          </div>
          <div className="opportunities-empty-actions">
            <a className="button primary" href={clearFiltersHref}>Clear filters</a>
          </div>
        </section>
      </section>
    );
  }

  if (opportunities.length === 0) {
    return (
      <section className="opportunities-board stack-lg">
        {feedback ? (
          <div className={feedback.tone === "danger" ? "error-banner" : "success-banner"} role={feedback.tone === "danger" ? "alert" : "status"} aria-live="polite">
            {feedback.message}
          </div>
        ) : null}
        <section className="card opportunities-empty-card">
          <div className="stack-sm">
            <p className="kicker">Start here</p>
            <h2>Create a useful week from this sermon</h2>
            <p className="muted">
              Create quote posts, captions, a recap, a prayer resource, an invitation, and engagement ideas for {activeSermonTitle ?? "this sermon"}. Every draft waits for your review.
            </p>
          </div>
          <div className="opportunities-empty-cta stack-sm">
            <button
              type="button"
              className="button primary"
              disabled={isPending}
              onClick={() => runAction(
                "pack:WEEKLY_CONTENT_PACK",
                () => generateContentPackAction(activeSermonId, "WEEKLY_CONTENT_PACK"),
              )}
            >
              {pendingAction === "pack:WEEKLY_CONTENT_PACK" ? "Creating the week…" : "Create weekly content pack"}
            </button>
            <button
              type="button"
              className="button tertiary"
              disabled={isPending}
              onClick={() => runAction("ideas:default", () => generateContentOpportunitiesAction(activeSermonId))}
            >
              {pendingAction === "ideas:default" ? "Creating ideas…" : "Create standard idea set"}
            </button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="opportunities-board stack-lg">
      {feedback ? (
        <div className={feedback.tone === "danger" ? "error-banner" : "success-banner"} role={feedback.tone === "danger" ? "alert" : "status"} aria-live="polite">
          {feedback.message}
        </div>
      ) : null}

      <ol className="opportunities-journey" aria-label="Content planning steps">
        <li className={journeyStep === 1 ? "is-active" : "is-complete"} aria-current={journeyStep === 1 ? "step" : undefined}><strong>1</strong> Preview & approve</li>
        <li className={journeyStep === 2 ? "is-active" : journeyStep > 2 ? "is-complete" : ""} aria-current={journeyStep === 2 ? "step" : undefined}><strong>2</strong> Prepare content</li>
        <li className={journeyStep === 3 ? "is-active" : ""} aria-current={journeyStep === 3 ? "step" : undefined}><strong>3</strong> Design & schedule</li>
      </ol>

      {featuredOpportunity ? (
        <section className="opportunities-focus-grid">
          <article id={`opportunity-${featuredOpportunity.id}`} className="opportunities-value-hero">
            <div className="opportunities-value-copy stack-sm">
              <div className="opportunities-focus-label">
                <p className="kicker">Recommended next</p>
                <StatusBadge tone={statusTone(featuredOpportunity.status)}>{formatStatus(featuredOpportunity.status)}</StatusBadge>
              </div>
              <span className="muted small">{CONTENT_OPPORTUNITY_TYPE_LABELS[featuredOpportunity.opportunityType]}</span>
              <h2>{featuredOpportunity.title}</h2>
              <ContentIdeaPreview item={featuredOpportunity} asset={featuredAsset} />
              <div className="opportunities-featured-meta">
                <span>{OPPORTUNITY_OUTCOME_LABELS[getOpportunityOutcome(featuredOpportunity)]}</span>
                {featuredOpportunity.relatedScripture ? <span>{featuredOpportunity.relatedScripture}</span> : null}
                {featuredOpportunity.suggestedPlatform ? <span>{featuredOpportunity.suggestedPlatform}</span> : null}
              </div>
            </div>
            <div className="opportunities-next-action">
              <span className="muted small">Recommended next step</span>
              {renderPrimaryAction(featuredOpportunity)}
              <button
                type="button"
                className="button tertiary"
                onClick={() => copyOpportunity(featuredOpportunity)}
                aria-label={`Copy ${featuredAsset ? "ready caption" : "content"} for ${featuredOpportunity.title}`}
              >
                {copiedId === featuredOpportunity.id ? "Copied" : "Copy content"}
              </button>
            </div>
            {renderReviewEditor(featuredOpportunity)}
          </article>

          <aside className="opportunities-queue-card" aria-label="Content workflow summary">
            <div className="stack-sm">
              <p className="kicker">Your workflow</p>
              <h2>Keep the week moving</h2>
            </div>
            <div className="opportunities-queue-list">
              <div><strong>{valueSummary.needsReview}</strong><span>to review</span></div>
              <div><strong>{valueSummary.approvedToPrepare}</strong><span>approved</span></div>
              <div><strong>{valueSummary.readyAssets}</strong><span>ready to post</span></div>
            </div>
            <p className="muted small">
              {valueSummary.approvedToPrepare > 0
                ? "Prepare approved ideas first, then continue reviewing."
                : valueSummary.needsReview > 0
                  ? "Review one useful idea at a time. Nothing publishes without approval."
                  : "Your current ideas have been handled."}
            </p>
            {valueSummary.readyAssets > 0 ? <a className="text-link small" href="/ready-to-post">Open Ready to Post</a> : null}
          </aside>
        </section>
      ) : null}

      <section className="opportunities-library stack-md" aria-labelledby="opportunities-library-title">
        <div className="opportunities-library-heading">
          <div className="stack-sm">
            <p className="kicker">More ideas</p>
            <h2 id="opportunities-library-title">What do you want to create?</h2>
            <p className="muted">Choose a goal. We’ll keep the list short and put the most useful ideas first.</p>
          </div>
          <span className="muted small">{browsableLibrary.length} more {browsableLibrary.length === 1 ? "idea" : "ideas"}</span>
        </div>
        <div className="opportunities-outcome-filters" role="group" aria-label="Filter ideas by outcome">
          <button
            type="button"
            className={selectedOutcome === "ALL" ? "is-active" : ""}
            aria-pressed={selectedOutcome === "ALL"}
            onClick={() => {
              setSelectedOutcome("ALL");
              setVisibleIdeaCount(4);
            }}
          >
            All <span>{browsableLibrary.length}</span>
          </button>
          {OPPORTUNITY_OUTCOMES.map((outcome) => {
            const count = browsableLibrary.filter((item) => getOpportunityOutcome(item) === outcome).length;
            if (count === 0) return null;
            return (
              <button
                type="button"
                key={outcome}
                className={selectedOutcome === outcome ? "is-active" : ""}
                aria-pressed={selectedOutcome === outcome}
                title={OUTCOME_DESCRIPTIONS[outcome]}
                onClick={() => {
                  setSelectedOutcome(outcome);
                  setVisibleIdeaCount(4);
                }}
              >
                {OPPORTUNITY_OUTCOME_LABELS[outcome]} <span>{count}</span>
              </button>
            );
          })}
        </div>

        {filterControls}

        {visibleIdeas.length > 0 ? (
          <div className="opportunities-library-list">
              {visibleIdeas.map((item) => {
                const preparedAsset = preparedAssetByOpportunityId.get(item.id);
                const isPreviewOpen = previewOpportunityId === item.id;

                return (
                  <article id={`opportunity-${item.id}`} key={item.id} className={`opportunities-library-card stack-sm${isPreviewOpen ? " is-previewing" : ""}`}>
                    <div className="opportunities-library-card-head">
                      <div className="stack-sm">
                        <div className="opportunities-featured-labels">
                          <StatusBadge tone={statusTone(item.status)}>{formatStatus(item.status)}</StatusBadge>
                          <span>{CONTENT_OPPORTUNITY_TYPE_LABELS[item.opportunityType]}</span>
                          {preparedAsset ? <span>Prepared</span> : item.suggestedPlatform ? <span>{item.suggestedPlatform}</span> : null}
                        </div>
                        <h3>{item.title}</h3>
                      </div>
                      {item.relatedScripture ? <span className="opportunities-scripture">{item.relatedScripture}</span> : null}
                    </div>

                    <p className="opportunities-library-preview">
                      {item.shortDescription?.trim() || previewText(item, preparedAsset, 180)}
                    </p>

                    <div className="opportunities-card-actions">
                      <button
                        type="button"
                        id={`opportunity-preview-toggle-${item.id}`}
                        className="button secondary"
                        aria-expanded={isPreviewOpen}
                        aria-controls={`opportunity-preview-${item.id}`}
                        onClick={() => {
                          setPreviewOpportunityId((current) => current === item.id ? null : item.id);
                          if (isPreviewOpen) setOpenEditorId(null);
                        }}
                      >
                        {isPreviewOpen ? "Close preview" : previewActionLabel(item, preparedAsset)}
                      </button>
                    </div>

                    {isPreviewOpen ? (
                      <div
                        id={`opportunity-preview-${item.id}`}
                        className="opportunities-inline-preview"
                        role="region"
                        aria-label={`Preview of ${item.title}`}
                      >
                        <ContentIdeaPreview item={item} asset={preparedAsset} full />
                        <div className="opportunities-inline-preview-actions">
                          <div className="stack-sm">
                            <p className="kicker">Next step</p>
                            <strong>{preparedAsset
                              ? isDesignableContentAssetType(preparedAsset.assetType) ? "Refine the design" : "Choose when to publish"
                              : item.status === "APPROVED" || item.status === "USED" ? "Prepare the post package" : "Edit and approve the idea"}</strong>
                            <span className="muted small">Nothing is published until you schedule and confirm it.</span>
                          </div>
                          <div className="actions-row">
                            {renderPrimaryAction(item)}
                            <button
                              type="button"
                              className="button tertiary"
                              onClick={() => copyOpportunity(item)}
                              aria-label={`Copy content for ${item.title}`}
                            >
                              {copiedId === item.id ? "Copied" : "Copy content"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {renderReviewEditor(item)}

                    <details className="opportunities-more-details">
                      <summary>Details & more actions</summary>
                      <div className="stack-md">
                        <div className="opportunities-grounding-grid">
                          <div>
                            <span className="muted small">Editorial signal</span>
                            <ConfidenceBadge score={item.confidenceScore} />
                          </div>
                          {item.ministryMomentType ? (
                            <div>
                              <span className="muted small">Ministry moment</span>
                              <strong>{formatEnumLabel(item.ministryMomentType)}</strong>
                            </div>
                          ) : null}
                          {item.relatedScripture ? (
                            <div>
                              <span className="muted small">Scripture</span>
                              <strong>{item.relatedScripture}</strong>
                            </div>
                          ) : null}
                        </div>
                        {item.sourceTranscriptExcerpt ? (
                          <blockquote className="review-feed-transcript">“{item.sourceTranscriptExcerpt}”</blockquote>
                        ) : item.opportunityType === "QUOTE_GRAPHIC" ? (
                          <p className="status-help">No transcript evidence is attached. Do not approve this as a direct pastor quote.</p>
                        ) : null}
                        {item.aiReason ? <p className="small muted">Why it was suggested: {item.aiReason}</p> : null}
                        <div className="actions-row">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={isPending}
                            onClick={() => {
                              if (openEditorId === item.id) closeReview(item.id);
                              else openReview(item.id);
                            }}
                          >
                            {openEditorId === item.id ? "Close editor" : "View or edit full content"}
                          </button>
                          {item.status === "APPROVED" ? (
                            <button type="button" className="button secondary" disabled={isPending} onClick={() => updateStatus(item, "USED")}>
                              Mark used
                            </button>
                          ) : null}
                          <button type="button" className="button secondary" disabled={isPending} onClick={() => updateStatus(item, "REJECTED")}>
                            Reject
                          </button>
                          <button
                            type="button"
                            className="button tertiary"
                            disabled={isPending}
                            onClick={() => runAction(
                              `regenerate:${item.id}`,
                              () => regenerateContentOpportunityTypeAction(item.sermonId, item.opportunityType),
                            )}
                          >
                            {pendingAction === `regenerate:${item.id}` ? "Regenerating…" : "Regenerate this type"}
                          </button>
                        </div>
                      </div>
                    </details>
                  </article>
                );
              })}
          </div>
        ) : (
          <div className="opportunities-library-empty">
            <strong>No more ideas in this view</strong>
            <span className="muted small">Try another goal or clear the filters.</span>
          </div>
        )}

        {hiddenIdeaCount > 0 ? (
          <button
            type="button"
            className="button tertiary opportunities-show-more"
            onClick={() => setVisibleIdeaCount((count) => count + 4)}
          >
            Show 4 more <span className="muted">({hiddenIdeaCount} remaining)</span>
          </button>
        ) : null}
      </section>

      <details className="opportunities-create-more">
        <summary>
          <span>
            <strong>Create more content</strong>
            <small>Generate a focused pack only when this sermon needs more options.</small>
          </span>
        </summary>
        <div className="stack-md opportunities-create-more-body">
          <div className="opportunities-pack-grid">
            {CONTENT_PACK_PRESETS.map((preset) => (
              <article key={preset.id} className="stack-sm">
                <h3>{preset.label}</h3>
                <p className="muted small">{preset.description}</p>
                <button
                  type="button"
                  className={preset.id === "WEEKLY_CONTENT_PACK" ? "button primary" : "button secondary"}
                  disabled={isPending}
                  onClick={() => runAction(`pack:${preset.id}`, () => generateContentPackAction(activeSermonId, preset.id))}
                >
                  {pendingAction === `pack:${preset.id}` ? "Creating drafts…" : `Create ${preset.label.toLowerCase()}`}
                </button>
              </article>
            ))}
          </div>
          {downloadEligibleCount > 0 ? (
            <div className="actions-row">
              <a className="button tertiary" href={`/api/content-packs/${activeSermonId}/download`}>
                Download approved production pack
              </a>
              <span className="muted small">Only approved or used content is included.</span>
            </div>
          ) : (
            <p className="muted small">Approve at least one idea to unlock the production-pack download.</p>
          )}

          <details className="advanced-details opportunities-advanced">
            <summary>Advanced generation tools</summary>
            <div className="advanced-details-body stack-md">
              <p className="muted small">Regenerate every active draft for this sermon, or choose one specific content type.</p>
              <div className="actions-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={isPending}
                  onClick={() => runAction("regenerate:all", () => regenerateContentOpportunitiesAction(activeSermonId))}
                >
                  {pendingAction === "regenerate:all" ? "Regenerating…" : "Regenerate current sermon"}
                </button>
                <select
                  value={selectedType}
                  disabled={isPending}
                  onChange={(event) => setSelectedType(event.target.value as "ALL" | ContentOpportunityType)}
                  aria-label="Opportunity type to regenerate"
                >
                  <option value="ALL">Choose a content type</option>
                  {CONTENT_OPPORTUNITY_TYPES.map((type) => (
                    <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button secondary"
                  disabled={isPending || selectedType === "ALL"}
                  onClick={() => {
                    if (selectedType !== "ALL") {
                      runAction(
                        `regenerate-type:${selectedType}`,
                        () => regenerateContentOpportunityTypeAction(activeSermonId, selectedType),
                      );
                    }
                  }}
                >
                  {selectedType !== "ALL" && pendingAction === `regenerate-type:${selectedType}` ? "Regenerating…" : "Regenerate selected type"}
                </button>
              </div>
            </div>
          </details>
        </div>
      </details>

      {composerOpportunity ? (
        <ContentAssetComposer
          key={`${composerOpportunity.id}:${composerAsset?.id ?? "new"}`}
          open
          initialValue={buildComposerInitialValue(composerOpportunity)}
          navigateToReadyOnSave
          onClose={() => setComposerOpportunityId(null)}
        />
      ) : null}
    </section>
  );
}
