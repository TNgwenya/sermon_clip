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

const OPPORTUNITY_ASSET_TYPE: Partial<Record<ContentOpportunityType, ContentAssetTypeValue>> = {
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
