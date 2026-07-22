"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  ConfidenceBadge,
  StatusBadge,
} from "@/components/ui";
import {
  generateContentOpportunitiesAction,
  generateContentPackAction,
  recordContentOpportunityPreviewAction,
  regenerateContentOpportunitiesAction,
  regenerateContentOpportunityTypeAction,
  updateContentOpportunityContentAction,
  updateContentOpportunityStatusAction,
} from "@/server/actions/contentOpportunities";
import { requestGuidedContentRewriteAction } from "@/server/actions/contentGuidedRewrite";
import { CONTENT_PACK_PRESETS } from "@/lib/contentPackPresets";
import { type GuidedRewriteVariant } from "@/lib/contentGuidedRewriteOptions";
import {
  CONTENT_ASSET_TYPE_LABELS,
  isVideoClipOpportunityType,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
  resolveVideoClipOpportunityWorkflow,
  type ContentAssetTypeValue,
  type ContentPublishingPlatform,
  type LinkedClipWorkflowSummary,
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
import { GuidedRewriteControl } from "@/app/opportunities/guided-rewrite-control";
import { ContentIdeasPostingGuide } from "@/components/content-ideas-posting-guide";
import {
  buildOpportunityApprovalSignal,
  buildOpportunityEvidenceSignal,
  buildReadyAssetHref,
  hasApprovedAssetPublishingRevision,
  type WorkflowSignal,
} from "@/lib/contentWorkflowUi";
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
  artworkText: string;
  publishingCaption: string;
  contentStructureLabel: string;
  contentRequiresReview: boolean;
  confidenceScore: number | null;
  suggestedPlatform: string | null;
  relatedScripture: string | null;
  scriptureTranslation: string | null;
  translationReviewState: "NOT_REQUIRED" | "REVIEW_REQUIRED" | "APPROVED";
  sourceTranscriptExcerpt: string | null;
  sourceTranscriptSegmentIds: string[];
  sourceStartTimeSeconds: number | null;
  sourceEndTimeSeconds: number | null;
  aiReason: string | null;
  ministryMomentType: string | null;
  relatedClip: LinkedClipWorkflowSummary | null;
  approvedRevisionId: string | null;
  approvedRevision: {
    revisionNumber: number;
    approvedAt: string | null;
  } | null;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    approvalState: "DRAFT" | "APPROVED" | "REAPPROVAL_REQUIRED";
    createdBy: string | null;
    approvedAt: string | null;
    createdAt: string;
  }>;
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
  initialOpportunityId?: string | null;
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
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  currentRevisionApprovalState: "DRAFT" | "APPROVED" | "REAPPROVAL_REQUIRED" | null;
  sourceOpportunityRevisionId: string | null;
};

type EditDraft = {
  title: string;
  shortDescription: string;
  content: string;
  relatedScripture: string;
  scriptureTranslation: string;
  translationConfirmed: boolean;
};

type Feedback = {
  message: string;
  tone: "success" | "danger";
};

type DraftSaveState = "SAVED" | "UNSAVED" | "SAVING" | "ERROR";

function initialDraft(item: OpportunityItem): EditDraft {
  return {
    title: item.title,
    shortDescription: item.shortDescription ?? "",
    content: item.artworkText,
    relatedScripture: item.relatedScripture ?? "",
    scriptureTranslation: item.scriptureTranslation ?? "",
    translationConfirmed: item.translationReviewState === "APPROVED",
  };
}

function draftSignature(draft: EditDraft): string {
  return JSON.stringify([
    draft.title.trim(),
    draft.shortDescription.trim(),
    draft.content.trim(),
    draft.relatedScripture.trim(),
    draft.scriptureTranslation.trim().toUpperCase(),
    draft.translationConfirmed,
  ]);
}

function revisionStateLabel(state: OpportunityItem["revisions"][number]["approvalState"]): string {
  if (state === "APPROVED") return "Approved";
  if (state === "REAPPROVAL_REQUIRED") return "Review version";
  return "Draft";
}

function revisionAuthorLabel(createdBy: string | null): string {
  if (createdBy === "opportunity-editor") return "Edited in Content Ideas";
  if (createdBy === "opportunity-review") return "Approved in Content Ideas";
  if (createdBy === "migration-backfill") return "Imported version";
  return "Saved version";
}

function formatRevisionTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

const OUTCOME_DESCRIPTIONS: Record<OpportunityOutcome, string> = {
  POST_NOW: "Captions, graphics, hooks, and short-form ideas you can use quickly.",
  EXTEND_MESSAGE: "Recaps and written pieces that carry the sermon beyond Sunday.",
  EQUIP_PEOPLE: "Prayer, reflection, family, youth, and small-group resources.",
  INVITE_PEOPLE: "Invitations, next-service promotion, and follow-up content.",
  PLAN_CONTENT: "Maps and calendars that help your team plan the week.",
};

const SCRIPTURE_TRANSLATIONS = [
  "AMP",
  "CSB",
  "ESV",
  "KJV",
  "MSG",
  "NET",
  "NIV",
  "NKJV",
  "NLT",
  "NRSVUE",
] as const;

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
    || item.artworkText.trim()
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

  const currentArtwork = draft.content.trim() || sourceText(item);
  return currentArtwork === item.artworkText.trim()
    ? item.publishingCaption.trim() || currentArtwork
    : currentArtwork;
}

function previewActionLabel(item: OpportunityItem, asset?: PreparedAssetSummary | null): string {
  if (isVideoClipOpportunityType(item.opportunityType)) {
    return item.status === "APPROVED" || item.status === "USED"
      ? "Preview clip workflow"
      : "Preview & review";
  }

  if (asset) {
    return isDesignableContentAssetType(asset.assetType)
      ? "Preview design"
      : "Preview ready post";
  }

  return item.status === "APPROVED" || item.status === "USED"
    ? "Preview & prepare"
    : "Preview & review";
}

function opportunitySignals(item: OpportunityItem): {
  approval: WorkflowSignal;
  evidence: WorkflowSignal;
} {
  return {
    approval: buildOpportunityApprovalSignal({
      status: item.status,
      approvedRevisionNumber: item.approvedRevision?.revisionNumber,
      approvedAt: item.approvedRevision?.approvedAt,
    }),
    evidence: buildOpportunityEvidenceSignal({
      status: item.status,
      opportunityType: item.opportunityType,
      sourceTranscriptExcerpt: item.sourceTranscriptExcerpt,
      sourceSegmentCount: item.sourceTranscriptSegmentIds.length,
      sourceStartTimeSeconds: item.sourceStartTimeSeconds,
      sourceEndTimeSeconds: item.sourceEndTimeSeconds,
      relatedScripture: item.relatedScripture,
      scriptureTranslation: item.scriptureTranslation,
      translationReviewState: item.translationReviewState,
    }),
  };
}

function WorkflowSignalCard({ signal }: { signal: WorkflowSignal }) {
  return (
    <div className={`opportunity-workflow-signal is-${signal.tone}`}>
      <strong>{signal.label}</strong>
      <span>{signal.detail}</span>
    </div>
  );
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
  const videoWorkflow = resolveVideoClipOpportunityWorkflow({
    sermonId: item.sermonId,
    opportunityType: item.opportunityType,
    relatedClip: item.relatedClip,
  });
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
    <div className={`opportunities-content-preview${videoWorkflow ? " is-video-brief" : isGraphic ? " is-graphic" : isCarousel ? " is-carousel" : " is-copy"}`}>
      <div className="opportunities-preview-canvas">
        <div className="opportunities-preview-brandline">
          <span>{videoWorkflow ? "Video clip brief" : CONTENT_ASSET_TYPE_LABELS[assetType]}</span>
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
          {videoWorkflow
            ? "Production brief only · publishing requires a real, timestamped sermon clip"
            : isArtwork
            ? "Copy preview · choose the final template and format in Design Studio"
            : `Full content preview · ${item.contentStructureLabel}`}
        </span>
        {showFullContent ? (
          <details>
            <summary>Read full content</summary>
            <p>{content}</p>
          </details>
        ) : null}
      </div>
      {videoWorkflow ? (
        <div className="content-asset-manual-notice opportunities-video-brief-notice">
          <strong>{videoWorkflow.title}</strong>
          <p className="muted small">{videoWorkflow.message}</p>
          <a className="text-link small" href={videoWorkflow.href}>{videoWorkflow.actionLabel}</a>
        </div>
      ) : null}
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
  initialOpportunityId = null,
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
  const [draftSaveStates, setDraftSaveStates] = useState<Record<string, DraftSaveState>>({});
  const [guidedRewriteSelections, setGuidedRewriteSelections] = useState<Record<string, GuidedRewriteVariant>>({});
  const [guidedRewriteNotices, setGuidedRewriteNotices] = useState<Record<string, string>>({});

  const [drafts, setDrafts] = useState<Record<string, EditDraft>>(() => {
    const entries: Record<string, EditDraft> = {};
    for (const item of opportunities) {
      entries[item.id] = initialDraft(item);
    }
    return entries;
  });
  const lastSavedDraftSignatures = useRef<Record<string, string>>(
    Object.fromEntries(opportunities.map((item) => [item.id, draftSignature(initialDraft(item))])),
  );
  const latestDraftSignatures = useRef<Record<string, string>>({});
  const autosaveEpochs = useRef<Record<string, number>>({});

  const preparedAssetByOpportunityId = useMemo(() => {
    const opportunityById = new Map(opportunities.map((item) => [item.id, item]));
    return new Map(preparedAssets
      .filter((asset) => {
        if (!asset.contentOpportunityId) return false;
        const opportunity = opportunityById.get(asset.contentOpportunityId);
        return Boolean(
          opportunity
          && !isVideoClipOpportunityType(opportunity.opportunityType)
          && (opportunity.status === "APPROVED" || opportunity.status === "USED")
          && opportunity.approvedRevisionId
          && asset.sourceOpportunityRevisionId === opportunity.approvedRevisionId,
        );
      })
      .map((asset) => [asset.contentOpportunityId as string, asset]));
  }, [opportunities, preparedAssets]);
  const readyOpportunityIds = useMemo(
    () => Array.from(preparedAssetByOpportunityId.entries())
      .filter(([, asset]) => (
        ["READY", "SCHEDULED", "PUBLISHED"].includes(asset.status)
        && hasApprovedAssetPublishingRevision({
          currentRevisionId: asset.currentRevisionId,
          approvedRevisionId: asset.approvedRevisionId,
          currentRevisionApprovalState: asset.currentRevisionApprovalState,
        })
      ))
      .map(([opportunityId]) => opportunityId),
    [preparedAssetByOpportunityId],
  );
  const rankedOpportunities = useMemo(
    () => rankOpportunitiesForValue(opportunities, readyOpportunityIds),
    [opportunities, readyOpportunityIds],
  );
  const visibleLibrary = useMemo(
    () => includeInactive ? opportunities : rankedOpportunities,
    [includeInactive, opportunities, rankedOpportunities],
  );
  const featuredOpportunity = useMemo(
    () => opportunities.find((item) => item.id === initialOpportunityId)
      ?? selectNextOpportunity(opportunities, readyOpportunityIds),
    [initialOpportunityId, opportunities, readyOpportunityIds],
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
    () => summarizeOpportunityValue(opportunities, readyOpportunityIds),
    [opportunities, readyOpportunityIds],
  );
  const featuredAsset = featuredOpportunity
    ? preparedAssetByOpportunityId.get(featuredOpportunity.id) ?? null
    : null;
  const featuredSignals = featuredOpportunity ? opportunitySignals(featuredOpportunity) : null;
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

  useEffect(() => {
    if (!initialOpportunityId || !opportunities.some((item) => item.id === initialOpportunityId)) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`opportunity-${initialOpportunityId}`);
      target?.scrollIntoView({ block: "center" });
      target?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialOpportunityId, opportunities]);

  useEffect(() => {
    latestDraftSignatures.current = Object.fromEntries(
      Object.entries(drafts).map(([id, draft]) => [id, draftSignature(draft)]),
    );
  }, [drafts]);

  useEffect(() => {
    if (!openEditorId) return;
    const item = opportunities.find((opportunity) => opportunity.id === openEditorId);
    const draft = drafts[openEditorId];
    if (!item || !draft) return;
    const signature = draftSignature(draft);
    if (signature === lastSavedDraftSignatures.current[item.id]) {
      setDraftSaveStates((current) => current[item.id] === "SAVED"
        ? current
        : { ...current, [item.id]: "SAVED" });
      return;
    }

    const epoch = (autosaveEpochs.current[item.id] ?? 0) + 1;
    autosaveEpochs.current[item.id] = epoch;
    setDraftSaveStates((current) => current[item.id] === "UNSAVED"
      ? current
      : { ...current, [item.id]: "UNSAVED" });
    const timer = window.setTimeout(async () => {
      if (autosaveEpochs.current[item.id] !== epoch) return;
      setDraftSaveStates((current) => ({ ...current, [item.id]: "SAVING" }));
      try {
        const result = await updateContentOpportunityContentAction({
          opportunityId: item.id,
          sermonId: item.sermonId,
          title: draft.title,
          shortDescription: draft.shortDescription,
          content: draft.content,
          relatedScripture: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.relatedScripture : undefined,
          scriptureTranslation: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.scriptureTranslation : undefined,
          translationConfirmed: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.translationConfirmed : undefined,
        });
        if (!result.success) throw new Error(result.message);
        lastSavedDraftSignatures.current[item.id] = signature;
        setDraftSaveStates((current) => ({
          ...current,
          [item.id]: latestDraftSignatures.current[item.id] === signature ? "SAVED" : "UNSAVED",
        }));
      } catch {
        setDraftSaveStates((current) => ({ ...current, [item.id]: "ERROR" }));
      }
    }, 1_500);

    return () => window.clearTimeout(timer);
  }, [drafts, openEditorId, opportunities]);

  function buildComposerInitialValue(item: OpportunityItem): ContentAssetComposerInitialValue {
    const asset = preparedAssetByOpportunityId.get(item.id);
    const draft = drafts[item.id];
    const bodyContent = asset?.bodyContent?.trim()
      || draft?.content?.trim()
      || item.artworkText.trim()
      || item.approvedContent?.trim()
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
      caption: asset?.caption ?? (item.publishingCaption.trim() || bodyContent),
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
    autosaveEpochs.current[item.id] = (autosaveEpochs.current[item.id] ?? 0) + 1;
    runAction(
      `status:${item.id}:${status}`,
      () => updateContentOpportunityStatusAction(item.sermonId, item.id, status),
    );
  }

  function saveEdit(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (!draft) return;

    autosaveEpochs.current[item.id] = (autosaveEpochs.current[item.id] ?? 0) + 1;
    runAction(`save:${item.id}`, async () => {
      const result = await updateContentOpportunityContentAction({
        opportunityId: item.id,
        sermonId: item.sermonId,
        title: draft.title,
        shortDescription: draft.shortDescription,
        content: draft.content,
        relatedScripture: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.relatedScripture : undefined,
        scriptureTranslation: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.scriptureTranslation : undefined,
        translationConfirmed: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.translationConfirmed : undefined,
      });
      if (result.success) {
        lastSavedDraftSignatures.current[item.id] = draftSignature(draft);
        setDraftSaveStates((current) => ({ ...current, [item.id]: "SAVED" }));
      }
      return result;
    });
  }

  function approveEdit(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (!draft) return;

    autosaveEpochs.current[item.id] = (autosaveEpochs.current[item.id] ?? 0) + 1;
    runAction(`status:${item.id}:APPROVED`, async () => {
      const signature = draftSignature(draft);
      if (signature !== lastSavedDraftSignatures.current[item.id]) {
        const saveResult = await updateContentOpportunityContentAction({
          opportunityId: item.id,
          sermonId: item.sermonId,
          title: draft.title,
          shortDescription: draft.shortDescription,
          content: draft.content,
          relatedScripture: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.relatedScripture : undefined,
          scriptureTranslation: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.scriptureTranslation : undefined,
          translationConfirmed: item.opportunityType === "SCRIPTURE_GRAPHIC" ? draft.translationConfirmed : undefined,
        });
        if (!saveResult.success) return saveResult;
        lastSavedDraftSignatures.current[item.id] = signature;
      }

      return updateContentOpportunityStatusAction(item.sermonId, item.id, "APPROVED");
    });
  }

  function requestGuidedRewrite(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (!draft) return;
    const variant = guidedRewriteSelections[item.id] ?? "SHORTER";
    const actionKey = `guided-rewrite:${item.id}`;
    setFeedback(null);
    setGuidedRewriteNotices((current) => ({ ...current, [item.id]: "" }));
    setPendingAction(actionKey);
    startTransition(async () => {
      try {
        const result = await requestGuidedContentRewriteAction({
          sermonId: item.sermonId,
          opportunityId: item.id,
          variant,
          currentDraft: {
            title: draft.title,
            shortDescription: draft.shortDescription,
            content: draft.content,
          },
        });
        if (!result.success || !result.suggestion) {
          setFeedback({ message: result.message, tone: "danger" });
          return;
        }
        const suggestion = result.suggestion;

        autosaveEpochs.current[item.id] = (autosaveEpochs.current[item.id] ?? 0) + 1;
        setDrafts((current) => ({
          ...current,
          [item.id]: {
            ...(current[item.id] ?? draft),
            title: suggestion.title,
            shortDescription: suggestion.shortDescription,
            content: suggestion.content,
          },
        }));
        setDraftSaveStates((current) => ({ ...current, [item.id]: "UNSAVED" }));
        setGuidedRewriteNotices((current) => ({
          ...current,
          [item.id]: `Suggestion applied · editorial check ${suggestion.editorialScore}/100. Review every word before approval; autosave will record a review version.`,
        }));
      } catch {
        setFeedback({
          message: "The guided rewrite could not be completed. Your current draft was not changed.",
          tone: "danger",
        });
      } finally {
        setPendingAction(null);
      }
    });
  }

  function openReview(itemId: string) {
    const item = opportunities.find((opportunity) => opportunity.id === itemId);
    if (item) {
      void recordContentOpportunityPreviewAction(item.sermonId, item.id).catch(() => undefined);
    }
    setPreviewOpportunityId(itemId);
    setOpenEditorId(itemId);
    requestAnimationFrame(() => {
      document.getElementById(`opportunity-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function closeReview(item: OpportunityItem) {
    const draft = drafts[item.id];
    if (draft && draftSignature(draft) !== lastSavedDraftSignatures.current[item.id]) {
      saveEdit(item);
    }
    setOpenEditorId(null);
    requestAnimationFrame(() => {
      document.getElementById(`opportunity-primary-action-${item.id}`)?.focus();
    });
  }

  async function copyOpportunity(item: OpportunityItem) {
    const draft = drafts[item.id] ?? initialDraft(item);

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
    const videoWorkflow = resolveVideoClipOpportunityWorkflow({
      sermonId: item.sermonId,
      opportunityType: item.opportunityType,
      relatedClip: item.relatedClip,
    });
    const asset = preparedAssetByOpportunityId.get(item.id);
    const assetLocked = Boolean(asset && ["SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(asset.status));

    if (videoWorkflow && (item.status === "APPROVED" || item.status === "USED")) {
      return (
        <a
          id={`opportunity-primary-action-${item.id}`}
          className={className}
          href={videoWorkflow.href}
          aria-label={`${videoWorkflow.actionLabel} for ${item.title}`}
        >
          {videoWorkflow.actionLabel}
        </a>
      );
    }

    if (item.status !== "APPROVED" && item.status !== "USED") {
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

    if (asset) {
      const isDesignable = isDesignableContentAssetType(asset.assetType);
      return (
        <a
          id={`opportunity-primary-action-${item.id}`}
          className={className}
          href={isDesignable
            ? `/ready-to-post/content-assets/${asset.id}/studio`
            : buildReadyAssetHref(asset.id)}
          aria-label={`${isDesignable ? "Preview and edit design" : "Open Ready to Post asset"} for ${item.title}`}
        >
          {isDesignable
            ? assetLocked ? "View final design" : "Preview & edit design"
            : assetLocked ? "Open publishing version" : "Continue to scheduling"}
        </a>
      );
    }

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

  function renderReviewEditor(item: OpportunityItem) {
    if (openEditorId !== item.id) return null;

    const draft = drafts[item.id] ?? initialDraft(item);

    const signals = opportunitySignals(item);
    const isReapproval = signals.approval.label === "Reapproval required";
    const draftSaveState = draftSaveStates[item.id] ?? "SAVED";
    const draftSaveMessage = draftSaveState === "SAVING"
      ? "Saving a review version…"
      : draftSaveState === "UNSAVED"
        ? "Changes will save automatically."
        : draftSaveState === "ERROR"
          ? "Autosave paused. Use Save changes to retry."
          : "All changes saved.";
    const draftIsSaving = draftSaveState === "SAVING";

    return (
      <section className="opportunity-review-editor stack-md" aria-labelledby={`opportunity-editor-heading-${item.id}`}>
        <div className="stack-sm">
          <p className="kicker">{isReapproval ? "Reapproval" : "Review"}</p>
          <h4 id={`opportunity-editor-heading-${item.id}`}>{isReapproval ? "Review the changed version" : "Shape the idea, then approve it"}</h4>
          <p className="muted small">{signals.approval.detail}</p>
          <div className="opportunity-editor-save-row">
            <span
              className={`muted small opportunity-autosave-status is-${draftSaveState.toLowerCase()}`}
              role="status"
              aria-live="polite"
            >
              {draftSaveMessage}
            </span>
            {item.revisions.length > 0 ? (
              <details className="opportunity-version-history">
                <summary>Version history ({item.revisions.length}{item.revisions.length === 5 ? "+" : ""})</summary>
                <ol>
                  {item.revisions.map((revision) => (
                    <li key={revision.id}>
                      <span>
                        <strong>Version {revision.revisionNumber}</strong>
                        <span>{revisionStateLabel(revision.approvalState)}</span>
                      </span>
                      <small>
                        {revisionAuthorLabel(revision.createdBy)} · {formatRevisionTimestamp(revision.createdAt)} SAST
                      </small>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        </div>
        <WorkflowSignalCard signal={signals.evidence} />
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
              [item.id]: {
                ...draft,
                content: event.target.value,
                ...(item.opportunityType === "SCRIPTURE_GRAPHIC" ? { translationConfirmed: false } : {}),
              },
            }))}
            disabled={isPending}
            rows={8}
          />
        </label>
        <GuidedRewriteControl
          opportunityId={item.id}
          opportunityType={item.opportunityType}
          selectedVariant={guidedRewriteSelections[item.id] ?? "SHORTER"}
          disabled={isPending || draftIsSaving || !draft.title.trim() || !draft.content.trim()}
          pending={pendingAction === `guided-rewrite:${item.id}`}
          notice={guidedRewriteNotices[item.id]}
          onVariantChange={(variant) => setGuidedRewriteSelections((current) => ({
            ...current,
            [item.id]: variant,
          }))}
          onRequest={() => requestGuidedRewrite(item)}
        />
        {item.opportunityType === "SCRIPTURE_GRAPHIC" ? (
          <fieldset className="opportunity-scripture-review stack-md">
            <legend>Scripture accuracy</legend>
            <div className="opportunity-scripture-fields">
              <label className="stack-sm">
                Bible reference
                <input
                  value={draft.relatedScripture}
                  placeholder="John 3:16"
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [item.id]: {
                      ...draft,
                      relatedScripture: event.target.value,
                      translationConfirmed: false,
                    },
                  }))}
                  disabled={isPending}
                />
              </label>
              <label className="stack-sm">
                Translation
                <select
                  value={draft.scriptureTranslation}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [item.id]: {
                      ...draft,
                      scriptureTranslation: event.target.value,
                      translationConfirmed: false,
                    },
                  }))}
                  disabled={isPending}
                >
                  <option value="">Choose translation</option>
                  {SCRIPTURE_TRANSLATIONS.map((version) => (
                    <option key={version} value={version}>{version}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="opportunity-accuracy-confirmation">
              <input
                type="checkbox"
                checked={draft.translationConfirmed}
                onChange={(event) => setDrafts((current) => ({
                  ...current,
                  [item.id]: { ...draft, translationConfirmed: event.target.checked },
                }))}
                disabled={isPending || !draft.relatedScripture.trim() || !draft.scriptureTranslation}
              />
              <span>I checked that the verse wording matches this translation.</span>
            </label>
            <p className="muted small">The idea cannot be approved or scheduled until the reference, version, and verse wording are confirmed.</p>
          </fieldset>
        ) : null}
        <div className="opportunity-review-actions">
          <button type="button" className="button secondary" disabled={isPending || draftIsSaving} onClick={() => saveEdit(item)}>
            {pendingAction === `save:${item.id}` ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="button primary" disabled={isPending || draftIsSaving} onClick={() => approveEdit(item)}>
            {pendingAction === `status:${item.id}:APPROVED` ? "Approving…" : "Approve idea"}
          </button>
          <button type="button" className="button danger" disabled={isPending || draftIsSaving} onClick={() => updateStatus(item, "REJECTED")}>
            Reject
          </button>
          <button type="button" className="button tertiary" disabled={isPending || draftIsSaving} onClick={() => closeReview(item)}>
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
        <ContentIdeasPostingGuide defaultOpen startingWithoutIdeas />
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
                <StatusBadge tone={featuredSignals?.approval.tone === "attention" ? "warning" : statusTone(featuredOpportunity.status)}>
                  {featuredSignals?.approval.label ?? formatStatus(featuredOpportunity.status)}
                </StatusBadge>
              </div>
              <span className="muted small">{CONTENT_OPPORTUNITY_TYPE_LABELS[featuredOpportunity.opportunityType]}</span>
              <h2>{featuredOpportunity.title}</h2>
              <ContentIdeaPreview item={featuredOpportunity} asset={featuredAsset} />
              <div className="opportunities-featured-meta">
                <span>{OPPORTUNITY_OUTCOME_LABELS[getOpportunityOutcome(featuredOpportunity)]}</span>
                {featuredOpportunity.relatedScripture ? <span>{featuredOpportunity.relatedScripture}</span> : null}
                {featuredOpportunity.suggestedPlatform ? <span>{featuredOpportunity.suggestedPlatform}</span> : null}
              </div>
              {featuredSignals ? (
                <div className="opportunity-workflow-signals" aria-label="Approval and source checks">
                  <WorkflowSignalCard signal={featuredSignals.approval} />
                  <WorkflowSignalCard signal={featuredSignals.evidence} />
                </div>
              ) : null}
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
            <div className="opportunities-queue-links">
              {valueSummary.readyAssets > 0 ? <a className="text-link small" href="/ready-to-post">Open Ready to Post</a> : null}
              {valueSummary.readyAssets > 0 && activeSermonId ? (
                <a className="text-link small" href={`/weekly-plan?sermonId=${encodeURIComponent(activeSermonId)}`}>Build the weekly plan</a>
              ) : null}
            </div>
          </aside>
        </section>
      ) : null}

      <ContentIdeasPostingGuide />

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

        {filterControls ? <div className="opportunities-server-filters">{filterControls}</div> : null}

        {visibleIdeas.length > 0 ? (
          <div className="opportunities-library-list">
              {visibleIdeas.map((item) => {
                const preparedAsset = preparedAssetByOpportunityId.get(item.id);
                const isPreviewOpen = previewOpportunityId === item.id;
                const signals = opportunitySignals(item);
                const videoWorkflow = resolveVideoClipOpportunityWorkflow({
                  sermonId: item.sermonId,
                  opportunityType: item.opportunityType,
                  relatedClip: item.relatedClip,
                });

                return (
                  <article id={`opportunity-${item.id}`} key={item.id} className={`opportunities-library-card stack-sm${isPreviewOpen ? " is-previewing" : ""}`}>
                    <div className="opportunities-library-card-head">
                      <div className="stack-sm">
                        <div className="opportunities-featured-labels">
                          <StatusBadge tone={signals.approval.tone === "attention" ? "warning" : statusTone(item.status)}>{signals.approval.label}</StatusBadge>
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
                          if (!isPreviewOpen) {
                            void recordContentOpportunityPreviewAction(item.sermonId, item.id).catch(() => undefined);
                          }
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
                          <div className="opportunity-workflow-signals" aria-label="Approval and source checks">
                            <WorkflowSignalCard signal={signals.approval} />
                            <WorkflowSignalCard signal={signals.evidence} />
                          </div>
                          <div className="stack-sm">
                            <p className="kicker">Next step</p>
                            <strong>{videoWorkflow
                              ? item.status === "APPROVED" || item.status === "USED"
                                ? videoWorkflow.title
                                : "Review the clip brief, then use a real sermon clip"
                              : preparedAsset
                              ? isDesignableContentAssetType(preparedAsset.assetType) ? "Refine the design" : "Choose when to publish"
                              : item.status === "APPROVED" || item.status === "USED" ? "Prepare the post package" : "Edit and approve the idea"}</strong>
                            <span className="muted small">
                              {videoWorkflow
                                ? "The idea itself never becomes video. Only an approved sermon clip can move to publishing."
                                : "Nothing is published until you schedule and confirm it."}
                            </span>
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
                        <WorkflowSignalCard signal={signals.evidence} />
                        {item.aiReason ? <p className="small muted">Why it was suggested: {item.aiReason}</p> : null}
                        {item.contentRequiresReview ? (
                          <p className="status-help">This older idea was safely separated into artwork and publishing copy. Review both before approval.</p>
                        ) : null}
                        <div className="actions-row">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={isPending || draftSaveStates[item.id] === "SAVING"}
                            onClick={() => {
                              if (openEditorId === item.id) closeReview(item);
                              else openReview(item.id);
                            }}
                          >
                            {openEditorId === item.id ? "Close editor" : "View or edit full content"}
                          </button>
                          {item.status === "APPROVED" ? (
                            <button type="button" className="button secondary" disabled={isPending || draftSaveStates[item.id] === "SAVING"} onClick={() => updateStatus(item, "USED")}>
                              Mark used
                            </button>
                          ) : null}
                          <button type="button" className="button secondary" disabled={isPending || draftSaveStates[item.id] === "SAVING"} onClick={() => updateStatus(item, "REJECTED")}>
                            Reject
                          </button>
                          <button
                            type="button"
                            className="button tertiary"
                            disabled={isPending}
                            title="Create fresh alternatives in this content format from the same sermon. Approved and manually edited versions stay protected."
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
