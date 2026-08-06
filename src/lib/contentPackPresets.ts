import type { ContentOpportunityType } from "@prisma/client";

export const CONTENT_PACK_PRESET_IDS = [
  "SAME_DAY_EVENT_PACK",
  "WEEKLY_CONTENT_PACK",
  "MINISTRY_DEPTH_PACK",
  "PRODUCTION_PACK",
] as const;

export type ContentPackPresetId = typeof CONTENT_PACK_PRESET_IDS[number];

export type ContentPackPreset = {
  id: ContentPackPresetId;
  label: string;
  description: string;
  quantities: Partial<Record<ContentOpportunityType, number>>;
};

export const CONTENT_PACK_PRESETS: ContentPackPreset[] = [
  {
    id: "SAME_DAY_EVENT_PACK",
    label: "Same-day event pack",
    description: "Fast-turnaround clips, quotes, recap copy, stories, and next-session promotion for a conference day.",
    quantities: {
      SHORT_FORM_CLIP_IDEA: 3,
      QUOTE_GRAPHIC: 2,
      SCRIPTURE_GRAPHIC: 1,
      SERMON_SUMMARY: 1,
      PLATFORM_CAPTION_PACK: 1,
      ENGAGEMENT_STORY_SET: 1,
      NEXT_SERVICE_PROMOTION: 1,
    },
  },
  {
    id: "WEEKLY_CONTENT_PACK",
    label: "Content Week",
    description: "Seven distinct, sermon-grounded pieces for a balanced ministry week—without creating a review backlog.",
    quantities: {
      SUNDAY_RECAP: 1,
      QUOTE_GRAPHIC: 1,
      SCRIPTURE_GRAPHIC: 1,
      REEL_HOOK: 1,
      PLATFORM_CAPTION_PACK: 1,
      CAROUSEL_IDEA: 1,
      INVITATION_CONTENT: 1,
    },
  },
  {
    id: "MINISTRY_DEPTH_PACK",
    label: "Ministry depth pack",
    description: "Five-day discipleship drafts plus small-group, family, youth, and sermon-map resources ready for review.",
    quantities: {
      DEVOTIONAL_GUIDE: 1,
      PRAYER_GUIDE: 1,
      SMALL_GROUP_GUIDE: 1,
      FAMILY_DISCUSSION_GUIDE: 1,
      YOUTH_DISCUSSION_GUIDE: 1,
      SERMON_CONTENT_MAP: 1,
      CONTENT_CALENDAR_PLAN: 1,
    },
  },
  {
    id: "PRODUCTION_PACK",
    label: "Production pack",
    description: "Graphic, carousel, and publishing-handoff drafts arranged for your team to review and approve.",
    quantities: {
      QUOTE_GRAPHIC: 3,
      SCRIPTURE_GRAPHIC: 2,
      CAROUSEL_IDEA: 2,
      PLATFORM_CAPTION_PACK: 1,
      CONTENT_CALENDAR_PLAN: 1,
    },
  },
];

export function getContentPackPreset(id: string): ContentPackPreset | null {
  return CONTENT_PACK_PRESETS.find((preset) => preset.id === id) ?? null;
}
