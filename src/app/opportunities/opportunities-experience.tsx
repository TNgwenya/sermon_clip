"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
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
import {
  getOpportunityOutcome,
  OPPORTUNITY_OUTCOME_LABELS,
  OPPORTUNITY_OUTCOMES,
  rankOpportunitiesForValue,
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

const CATEGORY_LABELS: Record<string, string> = {
  SOCIAL: "Social posts",
  DEVOTIONAL: "Devotionals",
  DISCIPLESHIP: "Discipleship resources",
  PROMOTION: "Invitations & promotion",
  WRITTEN: "Long-form content",
  ENGAGEMENT: "Conversation starters",
  RECAP: "Sermon recaps",
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
  const [openEditorId, setOpenEditorId] = useState<string | null>(null);
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
  const outcomeFilteredLibrary = useMemo(
    () => selectedOutcome === "ALL"
      ? visibleLibrary
      : visibleLibrary.filter((item) => getOpportunityOutcome(item) === selectedOutcome),
    [selectedOutcome, visibleLibrary],
  );
  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, OpportunityItem[]>();
    for (const item of outcomeFilteredLibrary) {
      const current = groups.get(item.category) ?? [];
      current.push(item);
      groups.set(item.category, current);
    }
    return groups;
  }, [outcomeFilteredLibrary]);
  const valueSummary = useMemo(
    () => summarizeOpportunityValue(opportunities, preparedOpportunityIds),
    [opportunities, preparedOpportunityIds],
  );
  const recommendations = rankedOpportunities.slice(0, 3);
  const featuredOpportunity = recommendations[0] ?? null;
  const featuredAsset = featuredOpportunity
    ? preparedAssetByOpportunityId.get(featuredOpportunity.id) ?? null
    : null;
  const composerOpportunity = composerOpportunityId
    ? opportunities.find((item) => item.id === composerOpportunityId) ?? null
    : null;
  const composerAsset = composerOpportunity
    ? preparedAssetByOpportunityId.get(composerOpportunity.id) ?? null
    : null;
  const downloadEligibleCount = opportunities.filter((item) => item.status === "APPROVED" || item.status === "USED").length;

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
    setOpenEditorId(itemId);
    requestAnimationFrame(() => {
      document.getElementById(`opportunity-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      return (
        <a
          className={className}
          href={`/ready-to-post?contentAssetId=${asset.id}`}
          aria-label={`Open Ready to Post asset for ${item.title}`}
        >
          {assetLocked ? "Open publishing version" : "Open Ready to Post"}
        </a>
      );
    }

    if (item.status === "APPROVED" || item.status === "USED") {
      return (
        <button
          type="button"
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
        className={className}
        disabled={isPending}
        onClick={() => openReview(item.id)}
        aria-label={`Review idea: ${item.title}`}
      >
        Review this idea
      </button>
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

      {featuredOpportunity ? (
        <section className="opportunities-value-hero">
          <div className="opportunities-value-copy stack-sm">
            <p className="kicker">Best next step</p>
            <div className="opportunities-featured-labels">
              <StatusBadge tone={statusTone(featuredOpportunity.status)}>{formatStatus(featuredOpportunity.status)}</StatusBadge>
              <span>{CONTENT_OPPORTUNITY_TYPE_LABELS[featuredOpportunity.opportunityType]}</span>
              {featuredOpportunity.suggestedPlatform ? <span>{featuredOpportunity.suggestedPlatform}</span> : null}
            </div>
            <h2>{featuredAsset
              ? "A publishing version is ready to open"
              : featuredOpportunity.status === "APPROVED" || featuredOpportunity.status === "USED"
                ? "Turn this approved idea into your next post"
                : "Review the strongest idea first"}</h2>
            <h3>{featuredOpportunity.title}</h3>
            <p className="opportunities-featured-preview">{previewText(featuredOpportunity, featuredAsset, 360)}</p>
            <div className="opportunities-featured-meta">
              {featuredOpportunity.relatedScripture ? <span>Scripture: {featuredOpportunity.relatedScripture}</span> : null}
              <span>{OPPORTUNITY_OUTCOME_LABELS[getOpportunityOutcome(featuredOpportunity)]}</span>
            </div>
          </div>
          <div className="opportunities-next-action stack-sm">
            {renderPrimaryAction(featuredOpportunity)}
            <button
              type="button"
              className="button tertiary"
              onClick={() => copyOpportunity(featuredOpportunity)}
              aria-label={`Copy ${featuredAsset ? "ready caption" : "content"} for ${featuredOpportunity.title}`}
            >
              {copiedId === featuredOpportunity.id
                ? "Copied"
                : featuredAsset
                  ? "Copy ready caption"
                  : featuredOpportunity.status === "APPROVED"
                    ? "Copy approved copy"
                    : "Copy draft"}
            </button>
            <span className="muted small">
              {featuredAsset
                ? "A prepared version already exists in Ready to Post."
                : featuredOpportunity.status === "APPROVED" || featuredOpportunity.status === "USED"
                  ? "The human review gate is complete."
                  : "Nothing publishes until you approve it."}
            </span>
          </div>
        </section>
      ) : null}

      <section className="opportunities-value-stats" aria-label="Content workflow summary">
        <article>
          <span>Needs your review</span>
          <strong>{valueSummary.needsReview}</strong>
          <small>Draft ideas waiting for a decision</small>
        </article>
        <article>
          <span>Approved to prepare</span>
          <strong>{valueSummary.approvedToPrepare}</strong>
          <small>Ready to turn into publishing assets</small>
        </article>
        <article>
          <span>In Ready to Post</span>
          <strong>{valueSummary.readyAssets}</strong>
          <small>Prepared versions your team can open</small>
        </article>
      </section>

      {filterControls}

      {recommendations.length > 1 ? (
        <section className="opportunities-recommendations stack-md" aria-labelledby="opportunities-recommendations-title">
          <div className="opportunities-section-heading stack-sm">
            <p className="kicker">Use these next</p>
            <h2 id="opportunities-recommendations-title">Strongest opportunities from this sermon</h2>
            <p className="muted">The most actionable ideas rise to the top; the complete library stays below.</p>
          </div>
          <div className="opportunities-quick-grid">
            {recommendations.map((item) => {
              const asset = preparedAssetByOpportunityId.get(item.id);
              return (
                <article className="opportunities-quick-card" key={item.id}>
                  <div className="opportunities-quick-card-topline">
                    <StatusBadge tone={statusTone(item.status)}>{formatStatus(item.status)}</StatusBadge>
                    <span>{OPPORTUNITY_OUTCOME_LABELS[getOpportunityOutcome(item)]}</span>
                  </div>
                  <div className="stack-sm">
                    <span className="muted small">{CONTENT_OPPORTUNITY_TYPE_LABELS[item.opportunityType]}</span>
                    <h3>{item.title}</h3>
                    <p>{previewText(item, asset, 190)}</p>
                  </div>
                  <div className="opportunities-quick-actions">
                    {renderPrimaryAction(item, "button secondary")}
                    <button
                      type="button"
                      className="button tertiary"
                      onClick={() => copyOpportunity(item)}
                      aria-label={`Copy content for ${item.title}`}
                    >
                      {copiedId === item.id ? "Copied" : asset ? "Copy caption" : "Copy"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="opportunities-library stack-md" aria-labelledby="opportunities-library-title">
        <div className="opportunities-section-heading stack-sm">
          <p className="kicker">Idea library</p>
          <h2 id="opportunities-library-title">Find content by what you want to do</h2>
          <p className="muted">Choose an outcome, then review or use the idea that fits today.</p>
        </div>
        <div className="opportunities-outcome-filters" role="group" aria-label="Filter ideas by outcome">
          <button
            type="button"
            className={selectedOutcome === "ALL" ? "is-active" : ""}
            aria-pressed={selectedOutcome === "ALL"}
            onClick={() => setSelectedOutcome("ALL")}
          >
            All useful ideas <span>{visibleLibrary.length}</span>
          </button>
          {OPPORTUNITY_OUTCOMES.map((outcome) => {
            const count = visibleLibrary.filter((item) => getOpportunityOutcome(item) === outcome).length;
            if (count === 0) return null;
            return (
              <button
                type="button"
                key={outcome}
                className={selectedOutcome === outcome ? "is-active" : ""}
                aria-pressed={selectedOutcome === outcome}
                title={OUTCOME_DESCRIPTIONS[outcome]}
                onClick={() => setSelectedOutcome(outcome)}
              >
                {OPPORTUNITY_OUTCOME_LABELS[outcome]} <span>{count}</span>
              </button>
            );
          })}
        </div>

        {Array.from(groupedByCategory.entries()).map(([category, items]) => (
          <section className="opportunities-category-group stack-md" key={category}>
            <div className="opportunities-category-heading">
              <h3>{CATEGORY_LABELS[category] ?? formatEnumLabel(category)}</h3>
              <span>{items.length} {items.length === 1 ? "idea" : "ideas"}</span>
            </div>
            <div className="opportunities-library-list">
              {items.map((item) => {
                const draft = drafts[item.id] ?? {
                  title: item.title,
                  shortDescription: item.shortDescription ?? "",
                  content: item.editedContent ?? item.bodyContent,
                };
                const preparedAsset = preparedAssetByOpportunityId.get(item.id);

                return (
                  <article id={`opportunity-${item.id}`} key={item.id} className="opportunities-library-card stack-sm">
                    <div className="opportunities-library-card-head">
                      <div className="stack-sm">
                        <div className="opportunities-featured-labels">
                          <StatusBadge tone={statusTone(item.status)}>{formatStatus(item.status)}</StatusBadge>
                          <span>{CONTENT_OPPORTUNITY_TYPE_LABELS[item.opportunityType]}</span>
                          {item.suggestedPlatform ? <span>{item.suggestedPlatform}</span> : null}
                        </div>
                        <h3>{item.title}</h3>
                      </div>
                      {item.relatedScripture ? <span className="opportunities-scripture">{item.relatedScripture}</span> : null}
                    </div>

                    {item.shortDescription ? <p className="muted">{item.shortDescription}</p> : null}
                    <p className="opportunities-library-preview">{previewText(item, preparedAsset)}</p>

                    <div className="opportunities-card-actions">
                      {renderPrimaryAction(item)}
                      <button
                        type="button"
                        className="button tertiary"
                        onClick={() => copyOpportunity(item)}
                        aria-label={`Copy content for ${item.title}`}
                      >
                        {copiedId === item.id ? "Copied" : preparedAsset ? "Copy caption" : item.status === "APPROVED" ? "Copy approved copy" : "Copy draft"}
                      </button>
                    </div>

                    {preparedAsset ? (
                      <div className="content-asset-ready-note">
                        <span className="status-pill status-exported">{preparedAsset.status.toLowerCase()}</span>
                        <span className="small muted">
                          A prepared {CONTENT_ASSET_TYPE_LABELS[preparedAsset.assetType].toLowerCase()} version is connected to Ready to Post.
                        </span>
                        <a className="text-link small" href={`/ready-to-post?contentAssetId=${preparedAsset.id}`}>Open asset</a>
                      </div>
                    ) : null}

                    {openEditorId === item.id ? (
                      <div className="opportunity-review-editor stack-md">
                        <div className="stack-sm">
                          <p className="kicker">Human review</p>
                          <h4>Check the meaning, edit the wording, then decide</h4>
                          <p className="muted small">Saving changes sends the item back to review. Approval records the exact content you checked.</p>
                        </div>
                        <label className="stack-sm">
                          Title
                          <input
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
                            {pendingAction === `status:${item.id}:APPROVED` ? "Approving…" : "Approve this idea"}
                          </button>
                          <button type="button" className="button danger" disabled={isPending} onClick={() => updateStatus(item, "REJECTED")}>
                            Reject
                          </button>
                          <button type="button" className="button tertiary" disabled={isPending} onClick={() => setOpenEditorId(null)}>
                            Close review
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <details className="opportunities-more-details">
                      <summary>Why this fits the sermon & more actions</summary>
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
                            onClick={() => setOpenEditorId((current) => current === item.id ? null : item.id)}
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
          </section>
        ))}
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
        </div>
      </details>

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
