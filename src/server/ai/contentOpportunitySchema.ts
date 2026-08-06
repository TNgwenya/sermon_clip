import { z } from "zod";

export const CONTENT_OPPORTUNITY_CATEGORIES = [
  "SOCIAL",
  "DEVOTIONAL",
  "DISCIPLESHIP",
  "PROMOTION",
  "WRITTEN",
  "ENGAGEMENT",
  "RECAP",
] as const;

export type ContentOpportunityCategory = (typeof CONTENT_OPPORTUNITY_CATEGORIES)[number];

function normalizeEnumValue(value: unknown): unknown {
  return typeof value === "string"
    ? value.trim().replace(/[\s-]+/g, "_").toUpperCase()
    : value;
}

export const CONTENT_OPPORTUNITY_TYPES = [
  "SHORT_FORM_CLIP_IDEA",
  "QUOTE_GRAPHIC",
  "SCRIPTURE_GRAPHIC",
  "CAROUSEL_IDEA",
  "CAPTION",
  "REEL_HOOK",
  "YOUTUBE_SHORTS_IDEA",
  "TIKTOK_IDEA",
  "FACEBOOK_POST_IDEA",
  "INSTAGRAM_POST_IDEA",
  "SERMON_SUMMARY",
  "DEVOTIONAL_SUMMARY",
  "NEWSLETTER_SUMMARY",
  "BLOG_DRAFT_OUTLINE",
  "ARTICLE_OUTLINE",
  "EMAIL_RECAP",
  "DISCUSSION_QUESTIONS",
  "SMALL_GROUP_QUESTIONS",
  "REFLECTION_QUESTIONS",
  "FAMILY_DISCUSSION_QUESTIONS",
  "YOUTH_DISCUSSION_QUESTIONS",
  "SUNDAY_RECAP",
  "NEXT_SERVICE_PROMOTION",
  "INVITATION_CONTENT",
  "ALTAR_CALL_FOLLOW_UP_CONTENT",
  "EVENT_FOLLOW_UP_CONTENT",
  "PLATFORM_CAPTION_PACK",
  "ENGAGEMENT_STORY_SET",
  "PRAYER_GUIDE",
  "DEVOTIONAL_GUIDE",
  "SMALL_GROUP_GUIDE",
  "FAMILY_DISCUSSION_GUIDE",
  "YOUTH_DISCUSSION_GUIDE",
  "SERMON_CONTENT_MAP",
  "CONTENT_CALENDAR_PLAN",
] as const;

export type ContentOpportunityType = (typeof CONTENT_OPPORTUNITY_TYPES)[number];

export const CONTENT_OPPORTUNITY_TYPE_LABELS: Record<ContentOpportunityType, string> = {
  SHORT_FORM_CLIP_IDEA: "Short-form clip idea",
  QUOTE_GRAPHIC: "Quote graphic",
  SCRIPTURE_GRAPHIC: "Scripture graphic",
  CAROUSEL_IDEA: "Carousel idea",
  CAPTION: "Caption",
  REEL_HOOK: "Reel hook",
  YOUTUBE_SHORTS_IDEA: "YouTube Shorts idea",
  TIKTOK_IDEA: "TikTok idea",
  FACEBOOK_POST_IDEA: "Facebook post idea",
  INSTAGRAM_POST_IDEA: "Instagram post idea",
  SERMON_SUMMARY: "Sermon summary",
  DEVOTIONAL_SUMMARY: "Devotional summary",
  NEWSLETTER_SUMMARY: "Newsletter summary",
  BLOG_DRAFT_OUTLINE: "Blog draft outline",
  ARTICLE_OUTLINE: "Article outline",
  EMAIL_RECAP: "Email recap",
  DISCUSSION_QUESTIONS: "Discussion questions",
  SMALL_GROUP_QUESTIONS: "Small-group questions",
  REFLECTION_QUESTIONS: "Reflection questions",
  FAMILY_DISCUSSION_QUESTIONS: "Family discussion questions",
  YOUTH_DISCUSSION_QUESTIONS: "Youth discussion questions",
  SUNDAY_RECAP: "Sunday recap",
  NEXT_SERVICE_PROMOTION: "Next-service promotion",
  INVITATION_CONTENT: "Invitation content",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "Altar call follow-up content",
  EVENT_FOLLOW_UP_CONTENT: "Event follow-up content",
  PLATFORM_CAPTION_PACK: "Platform caption pack",
  ENGAGEMENT_STORY_SET: "Engagement story set",
  PRAYER_GUIDE: "Prayer guide",
  DEVOTIONAL_GUIDE: "Devotional guide",
  SMALL_GROUP_GUIDE: "Small-group guide",
  FAMILY_DISCUSSION_GUIDE: "Family discussion guide",
  YOUTH_DISCUSSION_GUIDE: "Youth discussion guide",
  SERMON_CONTENT_MAP: "Sermon content map",
  CONTENT_CALENDAR_PLAN: "Content calendar plan",
};

export const CONTENT_OPPORTUNITY_CATEGORY_LABELS: Record<ContentOpportunityCategory, string> = {
  SOCIAL: "social",
  DEVOTIONAL: "devotional",
  DISCIPLESHIP: "discipleship",
  PROMOTION: "promotion",
  WRITTEN: "written",
  ENGAGEMENT: "engagement",
  RECAP: "recap",
};

export const DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES: Record<ContentOpportunityType, number> = {
  SHORT_FORM_CLIP_IDEA: 1,
  QUOTE_GRAPHIC: 1,
  SCRIPTURE_GRAPHIC: 1,
  CAROUSEL_IDEA: 0,
  CAPTION: 1,
  REEL_HOOK: 0,
  YOUTUBE_SHORTS_IDEA: 0,
  TIKTOK_IDEA: 0,
  FACEBOOK_POST_IDEA: 0,
  INSTAGRAM_POST_IDEA: 0,
  SERMON_SUMMARY: 0,
  DEVOTIONAL_SUMMARY: 0,
  NEWSLETTER_SUMMARY: 0,
  BLOG_DRAFT_OUTLINE: 0,
  ARTICLE_OUTLINE: 0,
  EMAIL_RECAP: 0,
  DISCUSSION_QUESTIONS: 0,
  SMALL_GROUP_QUESTIONS: 1,
  REFLECTION_QUESTIONS: 1,
  FAMILY_DISCUSSION_QUESTIONS: 0,
  YOUTH_DISCUSSION_QUESTIONS: 0,
  SUNDAY_RECAP: 1,
  NEXT_SERVICE_PROMOTION: 0,
  INVITATION_CONTENT: 0,
  ALTAR_CALL_FOLLOW_UP_CONTENT: 0,
  EVENT_FOLLOW_UP_CONTENT: 0,
  PLATFORM_CAPTION_PACK: 0,
  ENGAGEMENT_STORY_SET: 0,
  PRAYER_GUIDE: 0,
  DEVOTIONAL_GUIDE: 0,
  SMALL_GROUP_GUIDE: 0,
  FAMILY_DISCUSSION_GUIDE: 0,
  YOUTH_DISCUSSION_GUIDE: 0,
  SERMON_CONTENT_MAP: 0,
  CONTENT_CALENDAR_PLAN: 0,
};

export const contentOpportunitySchema = z.object({
  // Models occasionally return human-friendly lowercase values despite the
  // JSON example. Normalize formatting before validating the strict enum.
  category: z.preprocess(normalizeEnumValue, z.enum(CONTENT_OPPORTUNITY_CATEGORIES)),
  opportunityType: z.preprocess(normalizeEnumValue, z.enum(CONTENT_OPPORTUNITY_TYPES)),
  title: z.string().trim().min(1).max(200),
  shortDescription: z.string().trim().min(1).max(400),
  bodyContent: z.string().trim().min(1).max(8000),
  sourceTranscriptExcerpt: z.string().trim().max(1200).nullable().optional(),
  relatedScripture: z.string().trim().max(200).nullable().optional(),
  relatedMinistryMomentTitle: z.string().trim().max(200).nullable().optional(),
  relatedClipTitle: z.string().trim().max(200).nullable().optional(),
  suggestedPlatform: z.string().trim().max(120).nullable().optional(),
  detectedLanguage: z.string().trim().max(80).nullable().optional(),
  translatedFromLanguage: z.string().trim().max(80).nullable().optional(),
  originalPhrase: z.string().trim().max(300).nullable().optional(),
  englishMeaning: z.string().trim().max(500).nullable().optional(),
  translationConfidence: z.number().min(0).max(1).nullable().optional(),
  translationUncertaintyNote: z.string().trim().max(400).nullable().optional(),
  publishingCopy: z.object({
    caption: z.string().trim().min(1).max(5000),
    hashtags: z.array(z.string().trim().regex(/^#[\p{L}\p{N}_]+$/u).max(100)).max(12),
    callToAction: z.object({
      type: z.enum(["COMMENT", "SHARE", "SAVE", "PRAY", "ATTEND", "VISIT_LINK", "WATCH", "CUSTOM"]),
      text: z.string().trim().min(1).max(240),
      url: z.string().url().max(2000).nullable(),
    }).strict().superRefine((callToAction, context) => {
      if (callToAction.type === "VISIT_LINK" && !callToAction.url) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "A visit-link call to action requires a URL.",
        });
      }
    }).nullable(),
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "EMAIL", "WEBSITE", "OTHER"])).min(1).max(7),
  }).strict().optional(),
  creativeDirection: z.object({
    visualMood: z.string().trim().min(1).max(200).nullable(),
    imageDirection: z.string().trim().min(1).max(800).nullable(),
    emphasisWords: z.array(z.string().trim().min(1).max(80)).max(8),
  }).strict().optional(),
  confidenceScore: z.number().min(0).max(1),
  aiReason: z.string().trim().min(1).max(1200),
});

export const contentOpportunityResponseSchema = z.object({
  opportunities: z.array(contentOpportunitySchema).max(120),
});

export type ContentOpportunityRecord = z.infer<typeof contentOpportunitySchema>;
export type ContentOpportunityResponse = z.infer<typeof contentOpportunityResponseSchema>;

export const CONTENT_OPPORTUNITY_JSON_SHAPE = `{
  "opportunities": [
    {
      "category": "SOCIAL",
      "opportunityType": "QUOTE_GRAPHIC",
      "title": "Faith over fear quote card",
      "shortDescription": "A bold quote from the sermon for social sharing.",
      "bodyContent": "\"God has not given us a spirit of fear...\" with supporting caption copy.",
      "sourceTranscriptExcerpt": "God has not given us a spirit of fear...",
      "relatedScripture": "2 Timothy 1:7",
      "relatedMinistryMomentTitle": "Faith declaration over anxiety",
      "relatedClipTitle": "Faith declaration clip",
      "suggestedPlatform": "Instagram, Facebook",
      "detectedLanguage": "English + Zulu",
      "translatedFromLanguage": "Zulu",
      "originalPhrase": "Nkulunkulu unathi",
      "englishMeaning": "God is with us",
      "translationConfidence": 0.78,
      "translationUncertaintyNote": null,
      "publishingCopy": {
        "caption": "Fear does not get the final word. God is with us, and faith can take the next step.",
        "hashtags": ["#Faith", "#SermonClip", "#Church"],
        "callToAction": {
          "type": "WATCH",
          "text": "Watch the full message",
          "url": null
        },
        "platforms": ["INSTAGRAM", "FACEBOOK"]
      },
      "creativeDirection": {
        "visualMood": "Hopeful, calm, and confident",
        "imageDirection": "Warm sunrise light with generous negative space for the quote",
        "emphasisWords": ["faith", "fear"]
      },
      "confidenceScore": 0.92,
      "aiReason": "Strong direct quote and scripture anchor that aligns with the sermon theme."
    }
  ]
}`;
