import type { ContentOpportunityType } from "@/server/ai/contentOpportunitySchema";

export const CONTENT_ASSET_TYPES = [
  "QUOTE_GRAPHIC",
  "SCRIPTURE_GRAPHIC",
  "CAROUSEL",
  "TEXT_POST",
  "DEVOTIONAL",
  "PRAYER",
  "INVITATION",
  "DISCUSSION",
  "SERMON_RECAP",
  "STORY",
  "GUIDE",
  "EMAIL",
  "NEWSLETTER",
  "BLOG",
  "OTHER",
] as const;

export type ContentAssetTypeValue = (typeof CONTENT_ASSET_TYPES)[number];
export type ContentPublishingPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE_SHORTS" | "FACEBOOK";

export const VIDEO_CLIP_OPPORTUNITY_TYPES = [
  "SHORT_FORM_CLIP_IDEA",
  "REEL_HOOK",
  "YOUTUBE_SHORTS_IDEA",
  "TIKTOK_IDEA",
] as const satisfies readonly ContentOpportunityType[];

export type VideoClipOpportunityType = (typeof VIDEO_CLIP_OPPORTUNITY_TYPES)[number];

const VIDEO_CLIP_OPPORTUNITY_TYPE_SET = new Set<ContentOpportunityType>(VIDEO_CLIP_OPPORTUNITY_TYPES);

export type LinkedClipWorkflowSummary = {
  id: string;
  sermonId: string;
  title: string;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  startTimeSeconds: number;
  endTimeSeconds: number;
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
};

export type VideoClipOpportunityWorkflow = {
  state: "NEEDS_CLIP" | "REVIEW_CLIP" | "EDIT_CLIP" | "READY_CLIP";
  href: string;
  actionLabel: string;
  title: string;
  message: string;
};

const OPPORTUNITY_ASSET_TYPE: Partial<Record<ContentOpportunityType, ContentAssetTypeValue>> = {
  // These are production briefs for real sermon video, not text posts. The
  // publishing actions reject them as ContentAssets and route the user through
  // the ClipCandidate workflow instead. OTHER prevents any UI that only needs
  // a display classification from silently presenting them as TEXT_POST.
  SHORT_FORM_CLIP_IDEA: "OTHER",
  REEL_HOOK: "OTHER",
  YOUTUBE_SHORTS_IDEA: "OTHER",
  TIKTOK_IDEA: "OTHER",
  QUOTE_GRAPHIC: "QUOTE_GRAPHIC",
  SCRIPTURE_GRAPHIC: "SCRIPTURE_GRAPHIC",
  CAROUSEL_IDEA: "CAROUSEL",
  DEVOTIONAL_SUMMARY: "DEVOTIONAL",
  DEVOTIONAL_GUIDE: "DEVOTIONAL",
  PRAYER_GUIDE: "PRAYER",
  NEXT_SERVICE_PROMOTION: "INVITATION",
  INVITATION_CONTENT: "INVITATION",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "INVITATION",
  EVENT_FOLLOW_UP_CONTENT: "INVITATION",
  DISCUSSION_QUESTIONS: "DISCUSSION",
  SMALL_GROUP_QUESTIONS: "DISCUSSION",
  REFLECTION_QUESTIONS: "DISCUSSION",
  FAMILY_DISCUSSION_QUESTIONS: "DISCUSSION",
  YOUTH_DISCUSSION_QUESTIONS: "DISCUSSION",
  SUNDAY_RECAP: "SERMON_RECAP",
  SERMON_SUMMARY: "SERMON_RECAP",
  ENGAGEMENT_STORY_SET: "STORY",
  SMALL_GROUP_GUIDE: "GUIDE",
  FAMILY_DISCUSSION_GUIDE: "GUIDE",
  YOUTH_DISCUSSION_GUIDE: "GUIDE",
  SERMON_CONTENT_MAP: "GUIDE",
  CONTENT_CALENDAR_PLAN: "GUIDE",
  EMAIL_RECAP: "EMAIL",
  NEWSLETTER_SUMMARY: "NEWSLETTER",
  BLOG_DRAFT_OUTLINE: "BLOG",
  ARTICLE_OUTLINE: "BLOG",
};

export const CONTENT_ASSET_TYPE_LABELS: Record<ContentAssetTypeValue, string> = {
  QUOTE_GRAPHIC: "Quote graphic",
  SCRIPTURE_GRAPHIC: "Scripture graphic",
  CAROUSEL: "Carousel",
  TEXT_POST: "Text post",
  DEVOTIONAL: "Devotional",
  PRAYER: "Prayer",
  INVITATION: "Invitation",
  DISCUSSION: "Discussion",
  SERMON_RECAP: "Sermon recap",
  STORY: "Story set",
  GUIDE: "Ministry guide",
  EMAIL: "Email",
  NEWSLETTER: "Newsletter",
  BLOG: "Blog",
  OTHER: "Content asset",
};

export function mapOpportunityTypeToContentAssetType(
  opportunityType: ContentOpportunityType,
): ContentAssetTypeValue {
  return OPPORTUNITY_ASSET_TYPE[opportunityType] ?? "TEXT_POST";
}

export function isVideoClipOpportunityType(
  opportunityType: ContentOpportunityType | string,
): opportunityType is VideoClipOpportunityType {
  return VIDEO_CLIP_OPPORTUNITY_TYPE_SET.has(opportunityType as ContentOpportunityType);
}

export function resolveVideoClipOpportunityWorkflow(input: {
  sermonId: string;
  opportunityType: ContentOpportunityType | string;
  relatedClip: LinkedClipWorkflowSummary | null | undefined;
}): VideoClipOpportunityWorkflow | null {
  if (!isVideoClipOpportunityType(input.opportunityType)) return null;

  const sermonHref = `/sermons/${encodeURIComponent(input.sermonId)}#up-next`;
  const clip = input.relatedClip;
  if (!clip) {
    return {
      state: "NEEDS_CLIP",
      href: sermonHref,
      actionLabel: "Find or create a sermon clip",
      title: "A real sermon clip is required",
      message: "This is a video production brief, not a text post. Open the sermon workflow to find a timestamped clip before preparing or scheduling it.",
    };
  }

  if (clip.sermonId !== input.sermonId) {
    return {
      state: "NEEDS_CLIP",
      href: sermonHref,
      actionLabel: "Find or create a sermon clip",
      title: "Choose a clip from this sermon",
      message: "The previously linked clip belongs to a different sermon. Choose a real, timestamped clip from this sermon before publishing.",
    };
  }

  const reviewHref = `/sermons/${encodeURIComponent(input.sermonId)}/review#clip-${encodeURIComponent(clip.id)}`;
  const hasValidTimecode = Number.isFinite(clip.startTimeSeconds)
    && Number.isFinite(clip.endTimeSeconds)
    && clip.startTimeSeconds >= 0
    && clip.endTimeSeconds > clip.startTimeSeconds;

  if (!hasValidTimecode || clip.transcriptSafetyStatus === "REVIEW_REQUIRED") {
    return {
      state: "REVIEW_CLIP",
      href: reviewHref,
      actionLabel: "Review linked sermon clip",
      title: "Verify the linked sermon moment",
      message: !hasValidTimecode
        ? "The linked clip needs a valid sermon time range before it can become publishing media."
        : "The linked clip needs transcript review before it can be approved or prepared for publishing.",
    };
  }

  if (clip.status === "EXPORTED") {
    return {
      state: "READY_CLIP",
      href: `/ready-to-post?sermonId=${encodeURIComponent(input.sermonId)}&clipId=${encodeURIComponent(clip.id)}`,
      actionLabel: "Open finished sermon clip",
      title: "Finished sermon clip linked",
      message: `“${clip.title}” is the real video source for this idea. Review its final media and posting copy before scheduling.`,
    };
  }

  if (clip.status === "APPROVED") {
    return {
      state: "EDIT_CLIP",
      href: `/sermons/${encodeURIComponent(input.sermonId)}/clips/${encodeURIComponent(clip.id)}/studio`,
      actionLabel: "Finish linked clip in Studio",
      title: "Approved sermon clip linked",
      message: `“${clip.title}” has approved sermon boundaries. Finish the actual video, captions, and framing in Clip Studio.`,
    };
  }

  return {
    state: "REVIEW_CLIP",
    href: reviewHref,
    actionLabel: clip.status === "REJECTED" ? "Reconsider linked clip" : "Review linked sermon clip",
    title: clip.status === "REJECTED" ? "The linked clip was not selected" : "Review the linked sermon moment",
    message: clip.status === "REJECTED"
      ? "Choose a different sermon clip or return this linked moment to review before using the idea."
      : `Review the exact words and time range for “${clip.title}” before approving the video.`,
  };
}

export function normalizeSuggestedPostingPlatform(
  value: string | null | undefined,
): ContentPublishingPlatform | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes("instagram")) return "INSTAGRAM";
  if (normalized.includes("facebook")) return "FACEBOOK";
  if (normalized.includes("youtube")) return "YOUTUBE_SHORTS";
  if (normalized.includes("tiktok") || normalized.includes("tik tok")) return "TIKTOK";
  return null;
}

export function formatContentPublishingPlatform(
  platform: ContentPublishingPlatform | null | undefined,
): string {
  if (platform === "YOUTUBE_SHORTS") return "YouTube Shorts";
  if (!platform) return "Choose during scheduling";
  return platform.charAt(0) + platform.slice(1).toLowerCase();
}

export function normalizeContentHashtags(value: string | string[] | null | undefined): string[] {
  const source = Array.isArray(value) ? value : value?.split(/[\s,]+/) ?? [];
  return Array.from(new Set(source
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `#${item.replace(/^#+/, "")}`)
    .filter((item) => item.length > 1)))
    .slice(0, 30);
}

export function buildContentAssetHandoffText(input: {
  bodyContent?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  callToAction?: string | null;
}): string {
  const sections = [
    input.caption?.trim() || input.bodyContent?.trim() || "",
    normalizeContentHashtags(input.hashtags).join(" "),
    input.callToAction?.trim() || "",
  ].filter(Boolean);

  return sections.join("\n\n");
}
