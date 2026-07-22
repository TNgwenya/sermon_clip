import type { ContentOpportunityContract } from "@/lib/contentOpportunityContracts";

export type OpportunityWorkflowStatus =
  | "DRAFT"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "USED"
  | "ARCHIVED";

export type WorkflowSignalTone = "ready" | "attention" | "neutral" | "blocked";

export type WorkflowSignal = {
  label: string;
  detail: string;
  tone: WorkflowSignalTone;
};

export type ContentContractPresentation = {
  artworkText: string;
  publishingCaption: string;
  structureLabel: string;
};

export type AssetPublishingRevisionInput = {
  currentRevisionId?: string | null;
  approvedRevisionId?: string | null;
  currentRevisionApprovalState?: "DRAFT" | "APPROVED" | "REAPPROVAL_REQUIRED" | null;
};

type ApprovalSignalInput = {
  status: OpportunityWorkflowStatus;
  approvedRevisionNumber?: number | null;
  approvedAt?: string | Date | null;
};

type EvidenceSignalInput = {
  status: OpportunityWorkflowStatus;
  opportunityType: string;
  sourceTranscriptExcerpt?: string | null;
  sourceSegmentCount?: number;
  sourceStartTimeSeconds?: number | null;
  sourceEndTimeSeconds?: number | null;
  relatedScripture?: string | null;
  scriptureTranslation?: string | null;
  translationReviewState?: "NOT_REQUIRED" | "REVIEW_REQUIRED" | "APPROVED";
};

function compactDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function compactTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

/**
 * A READY-style status is only advisory. Publishing UI must also prove that
 * the asset's current immutable revision is the exact approved revision.
 */
export function hasApprovedAssetPublishingRevision(
  input: AssetPublishingRevisionInput,
): boolean {
  return Boolean(
    input.currentRevisionId
    && input.approvedRevisionId
    && input.currentRevisionId === input.approvedRevisionId
    && input.currentRevisionApprovalState === "APPROVED",
  );
}

export function buildOpportunityApprovalSignal(input: ApprovalSignalInput): WorkflowSignal {
  const versionLabel = input.approvedRevisionNumber
    ? `version ${input.approvedRevisionNumber}`
    : "version";
  const approvedDate = compactDate(input.approvedAt);

  if (input.status === "APPROVED" || input.status === "USED") {
    return {
      label: input.approvedRevisionNumber ? `Approved v${input.approvedRevisionNumber}` : "Approved",
      detail: approvedDate
        ? `The exact ${versionLabel} approved on ${approvedDate} is preserved.`
        : `The exact approved ${versionLabel} is preserved for publishing.`,
      tone: "ready",
    };
  }

  if (input.status === "NEEDS_REVIEW" && input.approvedRevisionNumber) {
    return {
      label: "Reapproval required",
      detail: `This content changed after v${input.approvedRevisionNumber} was approved. Review the current words before preparing it.`,
      tone: "attention",
    };
  }

  if (input.status === "REJECTED" || input.status === "ARCHIVED") {
    return {
      label: input.status === "REJECTED" ? "Not approved" : "Archived",
      detail: "This idea is outside the active publishing flow.",
      tone: "blocked",
    };
  }

  return {
    label: "Review required",
    detail: "No publishing version exists until a person reviews and approves these words.",
    tone: "neutral",
  };
}

export function buildOpportunityEvidenceSignal(input: EvidenceSignalInput): WorkflowSignal {
  const isApproved = input.status === "APPROVED" || input.status === "USED";

  if (input.opportunityType === "SCRIPTURE_GRAPHIC") {
    if (
      input.translationReviewState === "APPROVED"
      && input.relatedScripture?.trim()
      && input.scriptureTranslation?.trim()
    ) {
      return {
        label: "Scripture checked",
        detail: `${input.relatedScripture.trim()} · ${input.scriptureTranslation.trim()} wording confirmed.`,
        tone: "ready",
      };
    }

    return {
      label: "Scripture check required",
      detail: "Confirm the reference, translation, and verse wording before approval.",
      tone: "attention",
    };
  }

  if (input.opportunityType === "QUOTE_GRAPHIC") {
    if (!input.sourceTranscriptExcerpt?.trim()) {
      return {
        label: "Quote evidence missing",
        detail: "Do not approve this as a direct pastor quote until transcript evidence is attached.",
        tone: "blocked",
      };
    }

    const hasTimeRange = typeof input.sourceStartTimeSeconds === "number"
      && typeof input.sourceEndTimeSeconds === "number";
    const location = hasTimeRange
      ? ` at ${compactTime(input.sourceStartTimeSeconds as number)}–${compactTime(input.sourceEndTimeSeconds as number)}`
      : "";
    const segmentDetail = (input.sourceSegmentCount ?? 0) > 0
      ? `${input.sourceSegmentCount} transcript segment${input.sourceSegmentCount === 1 ? "" : "s"}`
      : "a transcript excerpt";

    return isApproved
      ? {
          label: "Transcript match approved",
          detail: `The approved quote is grounded in ${segmentDetail}${location}.`,
          tone: "ready",
        }
      : {
          label: "Transcript source attached",
          detail: `Compare the current wording with ${segmentDetail}${location} during approval.`,
          tone: "neutral",
        };
  }

  if (input.sourceTranscriptExcerpt?.trim()) {
    return {
      label: "Sermon source attached",
      detail: "Open the supporting excerpt under Details when you need to check context.",
      tone: "neutral",
    };
  }

  return {
    label: "Editorial review",
    detail: "Check this idea against the sermon before approving it for ministry use.",
    tone: "neutral",
  };
}

export function buildOpportunityHref(sermonId: string, opportunityId: string): string {
  const params = new URLSearchParams({ sermonId, opportunityId });
  return `/opportunities?${params.toString()}#opportunity-${encodeURIComponent(opportunityId)}`;
}

export function buildReadyAssetHref(assetId: string): string {
  return `/ready-to-post?contentAssetId=${encodeURIComponent(assetId)}#generated-content-assets`;
}

export function buildScheduledPostHref(scheduledPostId: string): string {
  return `/ready-to-post?scheduledPostId=${encodeURIComponent(scheduledPostId)}#posting-calendar`;
}

export function buildContentContractPresentation(
  contract: ContentOpportunityContract,
): ContentContractPresentation {
  const publishingCaption = contract.publishingCopy.caption;

  switch (contract.family) {
    case "QUOTE_GRAPHIC":
      return {
        artworkText: contract.quote.text,
        publishingCaption,
        structureLabel: "Quote artwork + publishing caption",
      };
    case "SCRIPTURE_GRAPHIC":
      return {
        artworkText: [
          contract.artwork.headline,
          contract.artwork.primaryText,
          contract.artwork.footer,
        ].filter(Boolean).join("\n\n"),
        publishingCaption,
        structureLabel: "Scripture artwork + publishing caption",
      };
    case "VIDEO_CLIP_BRIEF":
      return {
        artworkText: [contract.creative.hook, contract.creative.spokenFocus].filter(Boolean).join("\n\n"),
        publishingCaption,
        structureLabel: "Creative brief + publishing caption",
      };
    case "CAROUSEL":
      return {
        artworkText: contract.slides.map((slide) => (
          `${slide.position}. ${slide.headline}\n${slide.body}`
        )).join("\n\n"),
        publishingCaption,
        structureLabel: `${contract.slides.length}-slide carousel + publishing caption`,
      };
    case "PLATFORM_CAPTION_PACK":
      return {
        artworkText: contract.captions.map((caption) => (
          `${caption.platform === "OTHER" ? caption.otherPlatform ?? "Other" : caption.platform}\n${caption.caption}`
        )).join("\n\n"),
        publishingCaption,
        structureLabel: `${contract.captions.length}-platform caption pack`,
      };
    case "STORY_SET":
      return {
        artworkText: contract.frames.map((frame) => (
          `${frame.position}. ${frame.headline}\n${frame.body}`
        )).join("\n\n"),
        publishingCaption,
        structureLabel: `${contract.frames.length}-frame Story set + publishing caption`,
      };
    case "MULTI_DAY_GUIDE":
      return {
        artworkText: contract.days.map((day) => (
          `Day ${day.day}: ${day.title}\n${day.teaching}`
        )).join("\n\n"),
        publishingCaption,
        structureLabel: `${contract.days.length}-day guide + publishing caption`,
      };
    case "TEXT_POST":
      return {
        artworkText: contract.body,
        publishingCaption,
        structureLabel: "Editorial content + publishing caption",
      };
  }
}
