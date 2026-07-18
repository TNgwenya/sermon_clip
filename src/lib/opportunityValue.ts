export const OPPORTUNITY_OUTCOMES = [
  "POST_NOW",
  "EXTEND_MESSAGE",
  "EQUIP_PEOPLE",
  "INVITE_PEOPLE",
  "PLAN_CONTENT",
] as const;

export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];

export const OPPORTUNITY_OUTCOME_LABELS: Record<OpportunityOutcome, string> = {
  POST_NOW: "Post now",
  EXTEND_MESSAGE: "Extend the message",
  EQUIP_PEOPLE: "Equip people",
  INVITE_PEOPLE: "Invite & follow up",
  PLAN_CONTENT: "Plan the week",
};

export type OpportunityOutcomeInput = {
  category: string;
  opportunityType: string;
};

export type OpportunityValueItem = {
  id: string;
  status: string;
  confidenceScore?: number | null;
  createdAt: string | Date;
};

export type OpportunityValueSummary = {
  needsReview: number;
  approvedToPrepare: number;
  readyAssets: number;
};

const TYPE_OUTCOMES: Record<string, OpportunityOutcome> = {
  SHORT_FORM_CLIP_IDEA: "POST_NOW",
  QUOTE_GRAPHIC: "POST_NOW",
  SCRIPTURE_GRAPHIC: "POST_NOW",
  CAROUSEL_IDEA: "POST_NOW",
  CAPTION: "POST_NOW",
  REEL_HOOK: "POST_NOW",
  YOUTUBE_SHORTS_IDEA: "POST_NOW",
  TIKTOK_IDEA: "POST_NOW",
  FACEBOOK_POST_IDEA: "POST_NOW",
  INSTAGRAM_POST_IDEA: "POST_NOW",
  PLATFORM_CAPTION_PACK: "POST_NOW",
  ENGAGEMENT_STORY_SET: "POST_NOW",

  SERMON_SUMMARY: "EXTEND_MESSAGE",
  DEVOTIONAL_SUMMARY: "EXTEND_MESSAGE",
  NEWSLETTER_SUMMARY: "EXTEND_MESSAGE",
  BLOG_DRAFT_OUTLINE: "EXTEND_MESSAGE",
  ARTICLE_OUTLINE: "EXTEND_MESSAGE",
  EMAIL_RECAP: "EXTEND_MESSAGE",
  SUNDAY_RECAP: "EXTEND_MESSAGE",

  DISCUSSION_QUESTIONS: "EQUIP_PEOPLE",
  SMALL_GROUP_QUESTIONS: "EQUIP_PEOPLE",
  REFLECTION_QUESTIONS: "EQUIP_PEOPLE",
  FAMILY_DISCUSSION_QUESTIONS: "EQUIP_PEOPLE",
  YOUTH_DISCUSSION_QUESTIONS: "EQUIP_PEOPLE",
  PRAYER_GUIDE: "EQUIP_PEOPLE",
  DEVOTIONAL_GUIDE: "EQUIP_PEOPLE",
  SMALL_GROUP_GUIDE: "EQUIP_PEOPLE",
  FAMILY_DISCUSSION_GUIDE: "EQUIP_PEOPLE",
  YOUTH_DISCUSSION_GUIDE: "EQUIP_PEOPLE",

  NEXT_SERVICE_PROMOTION: "INVITE_PEOPLE",
  INVITATION_CONTENT: "INVITE_PEOPLE",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "INVITE_PEOPLE",
  EVENT_FOLLOW_UP_CONTENT: "INVITE_PEOPLE",

  SERMON_CONTENT_MAP: "PLAN_CONTENT",
  CONTENT_CALENDAR_PLAN: "PLAN_CONTENT",
};

const CATEGORY_OUTCOMES: Record<string, OpportunityOutcome> = {
  SOCIAL: "POST_NOW",
  ENGAGEMENT: "POST_NOW",
  DEVOTIONAL: "EXTEND_MESSAGE",
  WRITTEN: "EXTEND_MESSAGE",
  RECAP: "EXTEND_MESSAGE",
  DISCIPLESHIP: "EQUIP_PEOPLE",
  PROMOTION: "INVITE_PEOPLE",
};

const STATUS_VALUE_ORDER: Record<string, number> = {
  APPROVED: 0,
  NEEDS_REVIEW: 1,
  DRAFT: 2,
  USED: 3,
};

const EXCLUDED_STATUSES = new Set(["REJECTED", "ARCHIVED"]);

/**
 * Maps internal content categories and types to the outcome a ministry user
 * is trying to achieve. Specific opportunity types win over broad categories.
 */
export function getOpportunityOutcome(input: OpportunityOutcomeInput): OpportunityOutcome {
  return TYPE_OUTCOMES[input.opportunityType]
    ?? CATEGORY_OUTCOMES[input.category]
    ?? "EXTEND_MESSAGE";
}

function finiteConfidence(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.NEGATIVE_INFINITY;
}

function createdAtTimestamp(value: string | Date): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/**
 * Returns a new, stable value-first queue. Prepared opportunities are always
 * first, followed by the editorial workflow, confidence, recency, and ID.
 */
export function rankOpportunitiesForValue<T extends OpportunityValueItem>(
  items: readonly T[],
  preparedAssetOpportunityIds: Iterable<string>,
): T[] {
  const preparedIds = new Set(preparedAssetOpportunityIds);

  return items
    .filter((item) => !EXCLUDED_STATUSES.has(item.status))
    .slice()
    .sort((left, right) => {
      const preparedDifference = Number(preparedIds.has(right.id)) - Number(preparedIds.has(left.id));
      if (preparedDifference !== 0) return preparedDifference;

      const statusDifference = (STATUS_VALUE_ORDER[left.status] ?? 4) - (STATUS_VALUE_ORDER[right.status] ?? 4);
      if (statusDifference !== 0) return statusDifference;

      const leftConfidence = finiteConfidence(left.confidenceScore);
      const rightConfidence = finiteConfidence(right.confidenceScore);
      if (leftConfidence !== rightConfidence) return leftConfidence > rightConfidence ? -1 : 1;

      const leftCreatedAt = createdAtTimestamp(left.createdAt);
      const rightCreatedAt = createdAtTimestamp(right.createdAt);
      if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt > rightCreatedAt ? -1 : 1;

      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
}

/**
 * Summarizes mutually exclusive workflow value for the visible opportunity
 * set. Duplicate item and prepared-asset IDs are counted once.
 */
export function summarizeOpportunityValue(
  items: readonly OpportunityValueItem[],
  preparedAssetOpportunityIds: Iterable<string>,
): OpportunityValueSummary {
  const preparedIds = new Set(preparedAssetOpportunityIds);
  const seenIds = new Set<string>();
  const summary: OpportunityValueSummary = {
    needsReview: 0,
    approvedToPrepare: 0,
    readyAssets: 0,
  };

  for (const item of items) {
    if (seenIds.has(item.id) || EXCLUDED_STATUSES.has(item.status)) continue;
    seenIds.add(item.id);

    if (preparedIds.has(item.id)) {
      summary.readyAssets += 1;
    } else if (item.status === "APPROVED") {
      summary.approvedToPrepare += 1;
    } else if (item.status === "NEEDS_REVIEW" || item.status === "DRAFT") {
      summary.needsReview += 1;
    }
  }

  return summary;
}
