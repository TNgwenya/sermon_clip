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
  regenerateContentOpportunitiesAction,
  regenerateContentOpportunityTypeAction,
  updateContentOpportunityContentAction,
  updateContentOpportunityStatusAction,
} from "@/server/actions/contentOpportunities";
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
  ministryMomentType: string | null;
  status: OpportunityStatus;
  createdAt: string;
};

type Props = {
  opportunities: OpportunityItem[];
  activeSermonId: string | null;
  activeSermonTitle: string | null;
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

export function OpportunitiesExperience({ opportunities, activeSermonId, activeSermonTitle }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");
  const [selectedType, setSelectedType] = useState<"ALL" | ContentOpportunityType>("ALL");
  const [openEditorId, setOpenEditorId] = useState<string | null>(null);

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
                      <button type="button" className="button secondary" disabled={isPending} onClick={() => regenerateContentOpportunityTypeAction(item.sermonId, item.opportunityType).then((result) => { setMessage(result.message); refresh(); })}>Regenerate Type</button>
                    </div>

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
    </section>
  );
}
