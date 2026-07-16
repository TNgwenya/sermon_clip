"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  ConfidenceBadge,
  SectionCard,
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

function formatStatus(status: OpportunityStatus): string {
  return status.replace(/_/g, " ");
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function previewText(item: OpportunityItem): string {
  const source = item.editedContent?.trim() || item.approvedContent?.trim() || item.bodyContent;
  return source.length > 180 ? `${source.slice(0, 180)}...` : source;
}

export function OpportunitiesExperience({ opportunities, activeSermonId, activeSermonTitle, preparedAssets = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");
  const [selectedType, setSelectedType] = useState<"ALL" | ContentOpportunityType>("ALL");
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

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, OpportunityItem[]>();
    for (const item of opportunities) {
      const current = groups.get(item.category) ?? [];
      current.push(item);
      groups.set(item.category, current);
    }
    return groups;
  }, [opportunities]);
  const preparedAssetByOpportunityId = useMemo(() => new Map(
    preparedAssets
      .filter((asset) => Boolean(asset.contentOpportunityId))
      .map((asset) => [asset.contentOpportunityId as string, asset]),
  ), [preparedAssets]);
  const composerOpportunity = composerOpportunityId
    ? opportunities.find((item) => item.id === composerOpportunityId) ?? null
    : null;
  const composerAsset = composerOpportunity
    ? preparedAssetByOpportunityId.get(composerOpportunity.id) ?? null
    : null;

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

  function runAction(action: () => Promise<{ success: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      refresh();
    });
  }

  function updateStatus(sermonId: string, opportunityId: string, status: OpportunityStatus) {
    runAction(() => updateContentOpportunityStatusAction(sermonId, opportunityId, status));
  }

  function saveEdit(opportunity: OpportunityItem) {
    const draft = drafts[opportunity.id];
    if (!draft) {
      return;
    }

    runAction(() => updateContentOpportunityContentAction({
      opportunityId: opportunity.id,
      sermonId: opportunity.sermonId,
      title: draft.title,
      shortDescription: draft.shortDescription,
      content: draft.content,
    }));
  }

  const canRunScopedRegeneration = Boolean(activeSermonId);
  const hasIdeas = opportunities.length > 0;

  return (
    <section className="opportunities-board stack-lg">
      {message ? <p className="status-help">{message}</p> : null}

      <section className="card stack-md">
        <div className="stack-sm">
          <p className="kicker">Sermon content packs</p>
          <h2>One sermon into reviewed ministry content</h2>
          <p className="muted">Generate a coordinated pack, then edit and approve every item before production or publishing.</p>
        </div>
        <div className="opportunities-empty-actions">
          {CONTENT_PACK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === "WEEKLY_CONTENT_PACK" ? "button primary" : "button secondary"}
              disabled={isPending || !activeSermonId}
              title={preset.description}
              onClick={() => {
                if (activeSermonId) runAction(() => generateContentPackAction(activeSermonId, preset.id));
              }}
            >
              {isPending ? "Generating..." : preset.label}
            </button>
          ))}
        </div>
        {activeSermonId ? (
          <div className="actions-row">
            <a className="button tertiary" href={`/api/content-packs/${activeSermonId}/download`}>
              Download approved production pack
            </a>
            <span className="muted small">Includes approved copy, branded SVG quote cards, story cards, and carousel slides.</span>
          </div>
        ) : null}
        {!activeSermonId ? <p className="muted small">Choose a sermon before generating a pack.</p> : null}
      </section>

      {!hasIdeas ? (
        <section className="card opportunities-empty-card">
          <div className="stack-sm">
            <p className="kicker">Idea board</p>
            <h2>No post ideas yet</h2>
            <p className="muted">
              {activeSermonTitle
                ? `${activeSermonTitle} is ready for idea generation. Create captions, devotionals, recaps, invitations, and engagement prompts from this sermon.`
                : "Choose a sermon to create captions, devotionals, recaps, invitations, and engagement prompts."}
            </p>
          </div>
          <div className="opportunities-empty-actions">
            <button
              type="button"
              className="button primary"
              disabled={isPending || !activeSermonId}
              onClick={() => {
                if (!activeSermonId) {
                  return;
                }

                runAction(() => generateContentOpportunitiesAction(activeSermonId));
              }}
            >
              {isPending
                ? "Generating..."
                : activeSermonTitle
                  ? `Generate ideas for ${activeSermonTitle}`
                  : "Choose a sermon first"}
            </button>
          </div>
        </section>
      ) : null}

      <details className="advanced-details opportunities-advanced">
        <summary>Advanced generation tools</summary>
        <div className="advanced-details-body stack-md">
          <p className="muted small">Rerun generation for the currently scoped sermon or a specific opportunity type.</p>
        <div className="actions-row">
          <button
            type="button"
            className="button secondary"
            disabled={isPending || !canRunScopedRegeneration}
            onClick={() => {
              if (!activeSermonId) {
                return;
              }

              runAction(() => regenerateContentOpportunitiesAction(activeSermonId));
            }}
          >
            {isPending ? "Working..." : "Regenerate For Current Sermon View"}
          </button>
          <select
            value={selectedType}
            disabled={isPending}
            onChange={(event) => setSelectedType(event.target.value as "ALL" | ContentOpportunityType)}
            style={{ minWidth: "16rem" }}
          >
            <option value="ALL">Select type to regenerate</option>
            {CONTENT_OPPORTUNITY_TYPES.map((type) => (
              <option key={type} value={type}>{CONTENT_OPPORTUNITY_TYPE_LABELS[type]}</option>
            ))}
          </select>
          <button
            type="button"
            className="button secondary"
            disabled={isPending || selectedType === "ALL" || !canRunScopedRegeneration}
            onClick={() => {
              if (selectedType === "ALL" || !activeSermonId) {
                return;
              }

              runAction(() => regenerateContentOpportunityTypeAction(activeSermonId, selectedType));
            }}
          >
            {isPending ? "Working..." : "Regenerate Selected Type"}
          </button>
        </div>
        {!canRunScopedRegeneration ? (
          <p className="muted small">Select a specific sermon in filters to run regeneration safely.</p>
        ) : null}
        </div>
      </details>

      {hasIdeas ? (
        Array.from(groupedByCategory.entries()).map(([category, items]) => (
          <SectionCard key={category} title={category.toLowerCase()} description={`${items.length} content idea${items.length === 1 ? "" : "s"} in this group.`}>
            <div className="stack-sm">
              {items.map((item) => {
                const draft = drafts[item.id] ?? {
                  title: item.title,
                  shortDescription: item.shortDescription ?? "",
                  content: item.editedContent ?? item.bodyContent,
                };
                const preparedAsset = preparedAssetByOpportunityId.get(item.id);
                const preparedAssetLocked = Boolean(preparedAsset && ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(preparedAsset.status));
                const canPrepareForPublishing = item.status === "APPROVED" || item.status === "USED";

                return (
                  <article key={item.id} className="candidate-card stack-sm">
                    <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div className="stack-sm" style={{ minWidth: "16rem" }}>
                        <strong>{item.title}</strong>
                        <span className="small muted">{CONTENT_OPPORTUNITY_TYPE_LABELS[item.opportunityType]}</span>
                        <span className="small muted">Sermon: {item.sermonTitle}</span>
                      </div>
                      <div className="stack-sm" style={{ alignItems: "flex-end" }}>
                        <StatusBadge tone={item.status === "APPROVED" ? "success" : item.status === "REJECTED" ? "danger" : item.status === "USED" ? "accent" : "neutral"}>
                          {formatStatus(item.status)}
                        </StatusBadge>
                        <ConfidenceBadge score={item.confidenceScore} />
                        <span className="small muted">{formatDate(item.createdAt)}</span>
                      </div>
                    </div>

                    <p className="muted">{item.shortDescription ?? "No short description."}</p>
                    <p>{previewText(item)}</p>

                    <div className="actions-row small muted">
                      <span>Scripture: {item.relatedScripture ?? "-"}</span>
                      <span>Ministry moment type: {item.ministryMomentType ?? "-"}</span>
                      <span>Platform: {item.suggestedPlatform ?? "-"}</span>
                    </div>
                    {item.opportunityType === "QUOTE_GRAPHIC" ? (
                      <div className="stack-sm">
                        <strong className="small">Quote grounding</strong>
                        {item.sourceTranscriptExcerpt ? (
                          <blockquote className="review-feed-transcript">&ldquo;{item.sourceTranscriptExcerpt}&rdquo;</blockquote>
                        ) : (
                          <p className="status-help">No transcript evidence is attached. Do not approve this as a direct pastor quote.</p>
                        )}
                      </div>
                    ) : null}
                    {item.aiReason ? <p className="small muted">Grounding note: {item.aiReason}</p> : null}

                    <div className="actions-row">
                      <button
                        type="button"
                        className="button tertiary"
                        disabled={isPending}
                        onClick={() => setOpenEditorId((current) => (current === item.id ? null : item.id))}
                      >
                        {openEditorId === item.id ? "Close" : "View / Edit"}
                      </button>
                      <button type="button" className="button secondary" disabled={isPending} onClick={() => updateStatus(item.sermonId, item.id, "APPROVED")}>Approve</button>
                      <button type="button" className="button danger" disabled={isPending} onClick={() => updateStatus(item.sermonId, item.id, "REJECTED")}>Reject</button>
                      <button type="button" className="button secondary" disabled={isPending} onClick={() => updateStatus(item.sermonId, item.id, "USED")}>Mark Used</button>
                      <button
                        type="button"
                        className={preparedAsset ? "button secondary" : "button primary"}
                        disabled={isPending || preparedAssetLocked || (!canPrepareForPublishing && !preparedAsset)}
                        title={preparedAssetLocked
                          ? "This version is locked. Cancel its schedule or duplicate it to create another version."
                          : canPrepareForPublishing || preparedAsset
                            ? "Review the post copy and send it to Ready to Post."
                            : "Approve this content before preparing it for publishing."}
                        onClick={() => setComposerOpportunityId(item.id)}
                      >
                        {preparedAssetLocked ? "Locked publishing version" : preparedAsset ? "Open publishing composer" : "Prepare for publishing"}
                      </button>
                      <button
                        type="button"
                        className="button tertiary"
                        onClick={async () => {
                          const content = draft.content || item.approvedContent || item.bodyContent;
                          await navigator.clipboard.writeText(content);
                          setCopiedId(item.id);
                        }}
                      >
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </button>
                      <button type="button" className="button secondary" disabled={isPending} onClick={() => regenerateContentOpportunityTypeAction(item.sermonId, item.opportunityType).then((result) => { setMessage(result.message); refresh(); })}>Regenerate Type</button>
                    </div>

                    {preparedAsset ? (
                      <div className="content-asset-ready-note">
                        <span className="status-pill status-exported">{preparedAsset.status.toLowerCase()}</span>
                        <span className="small muted">
                          {CONTENT_ASSET_TYPE_LABELS[preparedAsset.assetType]} is connected to the Ready to Post workflow.
                          {["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(preparedAsset.status)
                            ? " Duplicate it to create an editable version."
                            : ""}
                        </span>
                        <a className="text-link small" href={`/ready-to-post?contentAssetId=${preparedAsset.id}`}>Open asset</a>
                      </div>
                    ) : null}

                    {openEditorId === item.id ? (
                      <div className="stack-sm">
                        <label className="stack-sm">
                          Title
                          <input
                            value={draft.title}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...draft,
                                title: event.target.value,
                              },
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
                              [item.id]: {
                                ...draft,
                                shortDescription: event.target.value,
                              },
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
                              [item.id]: {
                                ...draft,
                                content: event.target.value,
                              },
                            }))}
                            disabled={isPending}
                            rows={6}
                          />
                        </label>
                        <div className="actions-row">
                          <button type="button" className="button secondary" disabled={isPending} onClick={() => saveEdit(item)}>
                            {isPending ? "Saving..." : "Save Edit"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </SectionCard>
        ))
      ) : null}
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
