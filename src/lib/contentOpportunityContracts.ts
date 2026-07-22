import { z } from "zod";

import {
  extractQuoteTextFromContent,
  validateScriptureReference,
} from "@/lib/contentIntegrity";
import {
  CONTENT_OPPORTUNITY_TYPES,
  type ContentOpportunityType,
} from "@/server/ai/contentOpportunitySchema";

export const CONTENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const CONTENT_CONTRACT_FAMILIES = [
  "QUOTE_GRAPHIC",
  "SCRIPTURE_GRAPHIC",
  "VIDEO_CLIP_BRIEF",
  "CAROUSEL",
  "PLATFORM_CAPTION_PACK",
  "STORY_SET",
  "MULTI_DAY_GUIDE",
  "TEXT_POST",
] as const;

export type ContentContractFamily = (typeof CONTENT_CONTRACT_FAMILIES)[number];

export const CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE = {
  SHORT_FORM_CLIP_IDEA: "VIDEO_CLIP_BRIEF",
  QUOTE_GRAPHIC: "QUOTE_GRAPHIC",
  SCRIPTURE_GRAPHIC: "SCRIPTURE_GRAPHIC",
  CAROUSEL_IDEA: "CAROUSEL",
  CAPTION: "TEXT_POST",
  REEL_HOOK: "VIDEO_CLIP_BRIEF",
  YOUTUBE_SHORTS_IDEA: "VIDEO_CLIP_BRIEF",
  TIKTOK_IDEA: "VIDEO_CLIP_BRIEF",
  FACEBOOK_POST_IDEA: "TEXT_POST",
  INSTAGRAM_POST_IDEA: "TEXT_POST",
  SERMON_SUMMARY: "TEXT_POST",
  DEVOTIONAL_SUMMARY: "TEXT_POST",
  NEWSLETTER_SUMMARY: "TEXT_POST",
  BLOG_DRAFT_OUTLINE: "TEXT_POST",
  ARTICLE_OUTLINE: "TEXT_POST",
  EMAIL_RECAP: "TEXT_POST",
  DISCUSSION_QUESTIONS: "TEXT_POST",
  SMALL_GROUP_QUESTIONS: "TEXT_POST",
  REFLECTION_QUESTIONS: "TEXT_POST",
  FAMILY_DISCUSSION_QUESTIONS: "TEXT_POST",
  YOUTH_DISCUSSION_QUESTIONS: "TEXT_POST",
  SUNDAY_RECAP: "TEXT_POST",
  NEXT_SERVICE_PROMOTION: "TEXT_POST",
  INVITATION_CONTENT: "TEXT_POST",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "TEXT_POST",
  EVENT_FOLLOW_UP_CONTENT: "TEXT_POST",
  PLATFORM_CAPTION_PACK: "PLATFORM_CAPTION_PACK",
  ENGAGEMENT_STORY_SET: "STORY_SET",
  PRAYER_GUIDE: "MULTI_DAY_GUIDE",
  DEVOTIONAL_GUIDE: "MULTI_DAY_GUIDE",
  SMALL_GROUP_GUIDE: "MULTI_DAY_GUIDE",
  FAMILY_DISCUSSION_GUIDE: "MULTI_DAY_GUIDE",
  YOUTH_DISCUSSION_GUIDE: "MULTI_DAY_GUIDE",
  SERMON_CONTENT_MAP: "TEXT_POST",
  CONTENT_CALENDAR_PLAN: "TEXT_POST",
} as const satisfies Record<ContentOpportunityType, ContentContractFamily>;

export const evidenceVerificationSchema = z.object({
  status: z.enum(["UNVERIFIED", "VERIFIED", "MISMATCH"]),
  method: z.enum(["NONE", "TRANSCRIPT_MATCH", "MANUAL_REVIEW", "TRUSTED_SOURCE"]),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  verifiedBy: z.string().trim().min(1).max(200).nullable(),
  note: z.string().trim().min(1).max(500).nullable(),
}).strict().superRefine((verification, context) => {
  if (verification.status !== "VERIFIED") return;
  if (verification.method === "NONE") {
    context.addIssue({
      code: "custom",
      path: ["method"],
      message: "Verified evidence must record a verification method.",
    });
  }
  if (!verification.verifiedAt) {
    context.addIssue({
      code: "custom",
      path: ["verifiedAt"],
      message: "Verified evidence must record when verification happened.",
    });
  }
  if (!verification.verifiedBy) {
    context.addIssue({
      code: "custom",
      path: ["verifiedBy"],
      message: "Verified evidence must identify the reviewer or trusted source.",
    });
  }
});

export const scriptureVerificationSchema = z.object({
  referenceStatus: z.enum(["MISSING", "INVALID", "SYNTAX_VALID", "VERIFIED", "MISMATCH"]),
  verseTextStatus: z.enum(["MISSING", "UNVERIFIED", "VERIFIED", "MISMATCH"]),
  translationStatus: z.enum(["MISSING", "UNRECOGNIZED", "UNVERIFIED", "VERIFIED", "MISMATCH"]),
  method: z.enum(["NONE", "MANUAL_REVIEW", "BIBLE_API", "TRUSTED_SOURCE"]),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  verifiedBy: z.string().trim().min(1).max(200).nullable(),
  note: z.string().trim().min(1).max(500).nullable(),
}).strict().superRefine((verification, context) => {
  const hasVerifiedClaim = verification.referenceStatus === "VERIFIED"
    || verification.verseTextStatus === "VERIFIED"
    || verification.translationStatus === "VERIFIED";
  if (!hasVerifiedClaim) return;
  if (verification.method === "NONE") {
    context.addIssue({
      code: "custom",
      path: ["method"],
      message: "Verified Scripture data must record a verification method.",
    });
  }
  if (!verification.verifiedAt) {
    context.addIssue({
      code: "custom",
      path: ["verifiedAt"],
      message: "Verified Scripture data must record when verification happened.",
    });
  }
  if (!verification.verifiedBy) {
    context.addIssue({
      code: "custom",
      path: ["verifiedBy"],
      message: "Verified Scripture data must identify the reviewer or trusted source.",
    });
  }
});

export const scriptureCitationSchema = z.object({
  reference: z.string().trim().min(1).max(200).nullable(),
  verseText: z.string().trim().min(1).max(2000).nullable(),
  translation: z.string().trim().min(1).max(30).nullable(),
  verification: scriptureVerificationSchema,
}).strict().superRefine((scripture, context) => {
  const valueStates = [
    {
      value: scripture.reference,
      status: scripture.verification.referenceStatus,
      missingStatus: "MISSING",
      path: "reference",
    },
    {
      value: scripture.verseText,
      status: scripture.verification.verseTextStatus,
      missingStatus: "MISSING",
      path: "verseText",
    },
    {
      value: scripture.translation,
      status: scripture.verification.translationStatus,
      missingStatus: "MISSING",
      path: "translation",
    },
  ];
  for (const item of valueStates) {
    if (!item.value && item.status !== item.missingStatus) {
      context.addIssue({
        code: "custom",
        path: [item.path],
        message: `${item.path} cannot have a non-missing verification state without a value.`,
      });
    }
    if (item.value && item.status === item.missingStatus) {
      context.addIssue({
        code: "custom",
        path: ["verification", `${item.path}Status`],
        message: `${item.path} is present and cannot be marked missing.`,
      });
    }
  }
});

export const transcriptSourceEvidenceSchema = z.object({
  kind: z.literal("TRANSCRIPT_SPAN"),
  transcriptId: z.string().trim().min(1).max(200).nullable(),
  segmentIds: z.array(z.string().trim().min(1).max(200)).max(100),
  startMs: z.number().int().min(0).nullable(),
  endMs: z.number().int().positive().nullable(),
  excerpt: z.string().trim().min(1).max(2400),
  speaker: z.string().trim().min(1).max(200).nullable(),
  verification: evidenceVerificationSchema,
}).strict();

export const scriptureSourceEvidenceSchema = z.object({
  kind: z.literal("SCRIPTURE"),
  scripture: scriptureCitationSchema,
}).strict();

export const ministryMomentSourceEvidenceSchema = z.object({
  kind: z.literal("MINISTRY_MOMENT"),
  ministryMomentId: z.string().trim().min(1).max(200).nullable(),
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().min(1).max(1200).nullable(),
  verification: evidenceVerificationSchema,
}).strict();

export const clipSourceEvidenceSchema = z.object({
  kind: z.literal("CLIP"),
  clipId: z.string().trim().min(1).max(200).nullable(),
  title: z.string().trim().min(1).max(200),
  startMs: z.number().int().min(0).nullable(),
  endMs: z.number().int().positive().nullable(),
  verification: evidenceVerificationSchema,
}).strict();

export const sourceEvidenceSchema = z.discriminatedUnion("kind", [
  transcriptSourceEvidenceSchema,
  scriptureSourceEvidenceSchema,
  ministryMomentSourceEvidenceSchema,
  clipSourceEvidenceSchema,
]).superRefine((evidence, context) => {
  if (evidence.kind !== "TRANSCRIPT_SPAN" && evidence.kind !== "CLIP") return;
  const hasStart = evidence.startMs !== null;
  const hasEnd = evidence.endMs !== null;
  if (hasStart !== hasEnd) {
    context.addIssue({
      code: "custom",
      path: hasStart ? ["endMs"] : ["startMs"],
      message: "Source timecodes must include both a start and end.",
    });
  }
  if (evidence.startMs !== null && evidence.endMs !== null && evidence.endMs <= evidence.startMs) {
    context.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "Source end time must be after its start time.",
    });
  }
});

export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

export const publishingPlatformSchema = z.enum([
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "EMAIL",
  "WEBSITE",
  "OTHER",
]);

export const callToActionSchema = z.object({
  type: z.enum(["COMMENT", "SHARE", "SAVE", "PRAY", "ATTEND", "VISIT_LINK", "WATCH", "CUSTOM"]),
  text: z.string().trim().min(1).max(240),
  url: z.string().url().max(2000).nullable(),
}).strict().superRefine((callToAction, context) => {
  if (callToAction.type === "VISIT_LINK" && !callToAction.url) {
    context.addIssue({
      code: "custom",
      path: ["url"],
      message: "A visit-link call to action requires a valid URL.",
    });
  }
});

export const publishingCopySchema = z.object({
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().regex(/^#[\p{L}\p{N}_]+$/u).max(100)).max(30),
  callToAction: callToActionSchema.nullable(),
  platforms: z.array(publishingPlatformSchema).min(1).max(7),
}).strict().superRefine((copy, context) => {
  if (new Set(copy.hashtags).size !== copy.hashtags.length) {
    context.addIssue({ code: "custom", path: ["hashtags"], message: "Hashtags must be unique." });
  }
  if (new Set(copy.platforms).size !== copy.platforms.length) {
    context.addIssue({ code: "custom", path: ["platforms"], message: "Platforms must be unique." });
  }
});

export const legacyConversionMetadataSchema = z.object({
  origin: z.literal("LEGACY_BODY_CONTENT"),
  rawBodyContent: z.string().max(8000),
  requiresReview: z.literal(true),
  warnings: z.array(z.enum([
    "LEGACY_BODY_UNSTRUCTURED",
    "SOURCE_EVIDENCE_UNVERIFIED",
    "SCRIPTURE_REVIEW_REQUIRED",
    "MEDIA_LINK_REQUIRED",
    "PLATFORM_COPY_REVIEW_REQUIRED",
    "CONTENT_INCOMPLETE",
  ])).min(1).max(10),
}).strict();

const contractBaseShape = {
  schemaVersion: z.literal(CONTENT_CONTRACT_SCHEMA_VERSION),
  sourceEvidence: z.array(sourceEvidenceSchema).max(30),
  publishingCopy: publishingCopySchema,
  legacyConversion: legacyConversionMetadataSchema.optional(),
};

export const quoteGraphicContractSchema = z.object({
  family: z.literal("QUOTE_GRAPHIC"),
  ...contractBaseShape,
  quote: z.object({
    text: z.string().trim().min(1).max(600),
    kind: z.enum(["VERBATIM_SERMON", "PARAPHRASE", "DECLARATION"]),
    attribution: z.string().trim().min(1).max(200).nullable(),
    supportingText: z.string().trim().min(1).max(1200).nullable(),
  }).strict(),
  designBrief: z.object({
    visualMood: z.string().trim().min(1).max(200).nullable(),
    imageDirection: z.string().trim().min(1).max(800).nullable(),
    emphasisWords: z.array(z.string().trim().min(1).max(80)).max(12),
  }).strict(),
}).strict();

export const scriptureGraphicContractSchema = z.object({
  family: z.literal("SCRIPTURE_GRAPHIC"),
  ...contractBaseShape,
  scripture: scriptureCitationSchema,
  artwork: z.object({
    headline: z.string().trim().min(1).max(160).nullable(),
    primaryText: z.string().trim().min(1).max(1200),
    footer: z.string().trim().min(1).max(240).nullable(),
  }).strict(),
  designBrief: z.object({
    visualMood: z.string().trim().min(1).max(200).nullable(),
    imageDirection: z.string().trim().min(1).max(800).nullable(),
    emphasisWords: z.array(z.string().trim().min(1).max(80)).max(12),
  }).strict(),
}).strict();

export const videoClipProductionBriefSchema = z.object({
  mediaStatus: z.enum(["MISSING", "LINKED", "REVIEWED"]),
  sermonMediaId: z.string().trim().min(1).max(200).nullable(),
  clipId: z.string().trim().min(1).max(200).nullable(),
  startMs: z.number().int().min(0).nullable(),
  endMs: z.number().int().positive().nullable(),
  targetDurationSeconds: z.number().int().min(5).max(600).nullable(),
  aspectRatio: z.enum(["9:16", "1:1", "4:5", "16:9"]),
  captionsRequired: z.boolean(),
  onScreenText: z.array(z.string().trim().min(1).max(240)).max(20),
  bRollDirections: z.array(z.string().trim().min(1).max(500)).max(20),
  editNotes: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict().superRefine((brief, context) => {
  const hasLinkedMedia = Boolean(brief.sermonMediaId || brief.clipId);
  if (brief.mediaStatus !== "MISSING" && !hasLinkedMedia) {
    context.addIssue({
      code: "custom",
      path: ["mediaStatus"],
      message: "Linked or reviewed media must reference a sermon media item or clip.",
    });
  }
  const hasStart = brief.startMs !== null;
  const hasEnd = brief.endMs !== null;
  if (hasStart !== hasEnd) {
    context.addIssue({
      code: "custom",
      path: hasStart ? ["endMs"] : ["startMs"],
      message: "A clip range must include both start and end timecodes.",
    });
  }
  if (brief.startMs !== null && brief.endMs !== null && brief.endMs <= brief.startMs) {
    context.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "Clip end time must be after its start time.",
    });
  }
  if (brief.mediaStatus === "REVIEWED" && (!hasStart || !hasEnd)) {
    context.addIssue({
      code: "custom",
      path: ["mediaStatus"],
      message: "Reviewed clip media must include its approved timecode range.",
    });
  }
});

export const videoClipProductionBriefContractSchema = z.object({
  family: z.literal("VIDEO_CLIP_BRIEF"),
  ...contractBaseShape,
  creative: z.object({
    hook: z.string().trim().min(1).max(240),
    spokenFocus: z.string().trim().min(1).max(2400),
    onScreenTitle: z.string().trim().min(1).max(160).nullable(),
    audience: z.string().trim().min(1).max(200).nullable(),
    desiredResponse: z.string().trim().min(1).max(400).nullable(),
  }).strict(),
  productionBrief: videoClipProductionBriefSchema,
}).strict();

export const carouselSlideSchema = z.object({
  position: z.number().int().positive().max(20),
  role: z.enum(["COVER", "CONTENT", "SCRIPTURE", "APPLICATION", "CTA"]),
  headline: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(900),
  scripture: scriptureCitationSchema.nullable(),
  imageDirection: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const carouselContractSchema = z.object({
  family: z.literal("CAROUSEL"),
  ...contractBaseShape,
  title: z.string().trim().min(1).max(200),
  slides: z.array(carouselSlideSchema).min(2).max(20),
  designBrief: z.object({
    visualMood: z.string().trim().min(1).max(200).nullable(),
    layoutDirection: z.string().trim().min(1).max(800).nullable(),
  }).strict(),
}).strict();

export const platformCaptionSchema = z.object({
  platform: publishingPlatformSchema,
  otherPlatform: z.string().trim().min(1).max(80).nullable(),
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().regex(/^#[\p{L}\p{N}_]+$/u).max(100)).max(30),
  callToAction: callToActionSchema.nullable(),
  adaptationNote: z.string().trim().min(1).max(400).nullable(),
}).strict().superRefine((caption, context) => {
  if (caption.platform === "OTHER" && !caption.otherPlatform) {
    context.addIssue({
      code: "custom",
      path: ["otherPlatform"],
      message: "Name the platform when using OTHER.",
    });
  }
  if (caption.platform !== "OTHER" && caption.otherPlatform) {
    context.addIssue({
      code: "custom",
      path: ["otherPlatform"],
      message: "otherPlatform is only valid when platform is OTHER.",
    });
  }
});

export const platformCaptionPackContractSchema = z.object({
  family: z.literal("PLATFORM_CAPTION_PACK"),
  ...contractBaseShape,
  campaignMessage: z.string().trim().min(1).max(500),
  captions: z.array(platformCaptionSchema).min(1).max(12),
}).strict();

export const storyFrameSchema = z.object({
  position: z.number().int().positive().max(20),
  role: z.enum(["HOOK", "TEACHING", "SCRIPTURE", "REFLECTION", "POLL", "QUESTION", "CTA"]),
  headline: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(700),
  scripture: scriptureCitationSchema.nullable(),
  interaction: z.object({
    kind: z.enum(["POLL", "QUESTION", "QUIZ", "SLIDER"]),
    prompt: z.string().trim().min(1).max(240),
    options: z.array(z.string().trim().min(1).max(120)).max(4),
  }).strict().nullable(),
  imageDirection: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const storySetContractSchema = z.object({
  family: z.literal("STORY_SET"),
  ...contractBaseShape,
  title: z.string().trim().min(1).max(200),
  frames: z.array(storyFrameSchema).min(1).max(20),
}).strict();

export const guideDaySchema = z.object({
  day: z.number().int().positive().max(31),
  title: z.string().trim().min(1).max(200),
  scripture: scriptureCitationSchema.nullable(),
  teaching: z.string().trim().min(1).max(3000),
  reflectionQuestions: z.array(z.string().trim().min(1).max(500)).max(12),
  prayer: z.string().trim().min(1).max(2000).nullable(),
  actionStep: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const multiDayGuideContractSchema = z.object({
  family: z.literal("MULTI_DAY_GUIDE"),
  ...contractBaseShape,
  guideKind: z.enum(["DEVOTIONAL", "PRAYER", "SMALL_GROUP", "FAMILY", "YOUTH", "GENERAL"]),
  title: z.string().trim().min(1).max(200),
  introduction: z.string().trim().min(1).max(1500).nullable(),
  days: z.array(guideDaySchema).min(1).max(31),
}).strict();

export const genericTextPostContractSchema = z.object({
  family: z.literal("TEXT_POST"),
  ...contractBaseShape,
  postKind: z.enum([
    "CAPTION",
    "SOCIAL_POST",
    "SUMMARY",
    "OUTLINE",
    "EMAIL",
    "QUESTIONS",
    "RECAP",
    "PROMOTION",
    "INVITATION",
    "FOLLOW_UP",
    "CONTENT_PLAN",
    "GENERIC",
  ]),
  headline: z.string().trim().min(1).max(200).nullable(),
  body: z.string().trim().min(1).max(8000),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2400),
  }).strict()).max(30),
}).strict();

export const contentOpportunityContractSchema = z.discriminatedUnion("family", [
  quoteGraphicContractSchema,
  scriptureGraphicContractSchema,
  videoClipProductionBriefContractSchema,
  carouselContractSchema,
  platformCaptionPackContractSchema,
  storySetContractSchema,
  multiDayGuideContractSchema,
  genericTextPostContractSchema,
]).superRefine((contract, context) => {
  if (
    contract.family === "QUOTE_GRAPHIC"
    && contract.quote.kind === "VERBATIM_SERMON"
    && !contract.sourceEvidence.some((evidence) => evidence.kind === "TRANSCRIPT_SPAN")
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceEvidence"],
      message: "A verbatim sermon quote requires transcript-span evidence.",
    });
  }

  const positions = contract.family === "CAROUSEL"
    ? contract.slides.map((slide) => slide.position)
    : contract.family === "STORY_SET"
      ? contract.frames.map((frame) => frame.position)
      : null;
  if (positions && positions.some((position, index) => position !== index + 1)) {
    context.addIssue({
      code: "custom",
      path: [contract.family === "CAROUSEL" ? "slides" : "frames"],
      message: "Content positions must be unique and sequential, starting at 1.",
    });
  }

  if (
    contract.family === "MULTI_DAY_GUIDE"
    && contract.days.some((day, index) => day.day !== index + 1)
  ) {
    context.addIssue({
      code: "custom",
      path: ["days"],
      message: "Guide days must be unique and sequential, starting at 1.",
    });
  }
});

export type ContentOpportunityContract = z.infer<typeof contentOpportunityContractSchema>;
export type QuoteGraphicContract = z.infer<typeof quoteGraphicContractSchema>;
export type ScriptureGraphicContract = z.infer<typeof scriptureGraphicContractSchema>;
export type VideoClipProductionBriefContract = z.infer<typeof videoClipProductionBriefContractSchema>;
export type CarouselContract = z.infer<typeof carouselContractSchema>;
export type PlatformCaptionPackContract = z.infer<typeof platformCaptionPackContractSchema>;
export type StorySetContract = z.infer<typeof storySetContractSchema>;
export type MultiDayGuideContract = z.infer<typeof multiDayGuideContractSchema>;
export type GenericTextPostContract = z.infer<typeof genericTextPostContractSchema>;

export class ContentContractFamilyMismatchError extends Error {
  readonly expectedFamily: ContentContractFamily;
  readonly receivedFamily: ContentContractFamily;

  constructor(expectedFamily: ContentContractFamily, receivedFamily: ContentContractFamily) {
    super(`Expected ${expectedFamily} content for this opportunity, received ${receivedFamily}.`);
    this.name = "ContentContractFamilyMismatchError";
    this.expectedFamily = expectedFamily;
    this.receivedFamily = receivedFamily;
  }
}

export function getContentContractFamily(
  opportunityType: ContentOpportunityType,
): ContentContractFamily {
  return CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE[opportunityType];
}

export function isContentOpportunityType(value: unknown): value is ContentOpportunityType {
  return typeof value === "string"
    && (CONTENT_OPPORTUNITY_TYPES as readonly string[]).includes(value);
}

export function parseContentOpportunityContract(value: unknown): ContentOpportunityContract {
  return contentOpportunityContractSchema.parse(value);
}

export function safeParseContentOpportunityContract(value: unknown) {
  return contentOpportunityContractSchema.safeParse(value);
}

export function parseContentOpportunityContractJson(value: string): ContentOpportunityContract {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Structured content is not valid JSON: ${error instanceof Error ? error.message : "Unknown JSON error"}`,
    );
  }
  return parseContentOpportunityContract(decoded);
}

export function parseContentOpportunityContractForType(
  opportunityType: ContentOpportunityType,
  value: unknown,
): ContentOpportunityContract {
  const contract = typeof value === "string"
    ? parseContentOpportunityContractJson(value)
    : parseContentOpportunityContract(value);
  const expectedFamily = getContentContractFamily(opportunityType);
  if (contract.family !== expectedFamily) {
    throw new ContentContractFamilyMismatchError(expectedFamily, contract.family);
  }
  return contract;
}

export type LegacyContentOpportunityInput = {
  opportunityType: ContentOpportunityType;
  bodyContent?: string | null;
  title?: string | null;
  sourceTranscriptExcerpt?: string | null;
  relatedScripture?: string | null;
  relatedMinistryMomentTitle?: string | null;
  relatedClipTitle?: string | null;
  suggestedPlatform?: string | null;
};

export type LegacyContentOpportunityConversion = {
  source: "LEGACY_CONVERTED";
  contract: ContentOpportunityContract;
  warnings: NonNullable<ContentOpportunityContract["legacyConversion"]>["warnings"];
};

const FALLBACK_REVIEW_COPY = "Content needs editorial review.";

function cleanText(value: string | null | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function extractHashtags(value: string): string[] {
  return uniqueValues(value.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 30);
}

function platformsFromLegacy(value: string | null | undefined) {
  const normalized = (value ?? "").toLocaleLowerCase("en");
  const platforms: Array<z.infer<typeof publishingPlatformSchema>> = [];
  if (normalized.includes("instagram")) platforms.push("INSTAGRAM");
  if (normalized.includes("facebook")) platforms.push("FACEBOOK");
  if (normalized.includes("tiktok")) platforms.push("TIKTOK");
  if (normalized.includes("youtube")) platforms.push("YOUTUBE");
  if (normalized.includes("email") || normalized.includes("newsletter")) platforms.push("EMAIL");
  if (normalized.includes("website") || normalized.includes("blog")) platforms.push("WEBSITE");
  return uniqueValues(platforms.length > 0 ? platforms : ["OTHER"]);
}

function unverifiedEvidence(note: string) {
  return {
    status: "UNVERIFIED" as const,
    method: "NONE" as const,
    verifiedAt: null,
    verifiedBy: null,
    note,
  };
}

function scriptureFromLegacy(value: string | null | undefined) {
  const originalReference = cleanText(value, 200);
  const validation = validateScriptureReference(originalReference);
  const reference = validation.normalizedReference ?? (originalReference || null);
  const translation = validation.version;
  const referenceStatus = !originalReference
    ? "MISSING" as const
    : validation.valid
      ? "SYNTAX_VALID" as const
      : "INVALID" as const;
  const translationStatus = validation.versionStatus === "MISSING"
    ? "MISSING" as const
    : validation.versionStatus === "RECOGNIZED"
      ? "UNVERIFIED" as const
      : "UNRECOGNIZED" as const;

  return {
    reference,
    verseText: null,
    translation,
    verification: {
      referenceStatus,
      verseTextStatus: "MISSING" as const,
      translationStatus,
      method: "NONE" as const,
      verifiedAt: null,
      verifiedBy: null,
      note: "Converted from legacy metadata; confirm the reference, verse wording, and translation.",
    },
  };
}

function buildLegacyEvidence(input: LegacyContentOpportunityInput): SourceEvidence[] {
  const evidence: SourceEvidence[] = [];
  const excerpt = cleanText(input.sourceTranscriptExcerpt, 2400);
  if (excerpt) {
    evidence.push({
      kind: "TRANSCRIPT_SPAN",
      transcriptId: null,
      segmentIds: [],
      startMs: null,
      endMs: null,
      excerpt,
      speaker: null,
      verification: unverifiedEvidence("Legacy excerpt has not been matched to stored transcript segments."),
    });
  }

  const scripture = scriptureFromLegacy(input.relatedScripture);
  if (scripture.reference) {
    evidence.push({ kind: "SCRIPTURE", scripture });
  }

  const momentTitle = cleanText(input.relatedMinistryMomentTitle, 200);
  if (momentTitle) {
    evidence.push({
      kind: "MINISTRY_MOMENT",
      ministryMomentId: null,
      title: momentTitle,
      excerpt: null,
      verification: unverifiedEvidence("Legacy ministry-moment title has no linked source identifier."),
    });
  }

  const clipTitle = cleanText(input.relatedClipTitle, 200);
  if (clipTitle) {
    evidence.push({
      kind: "CLIP",
      clipId: null,
      title: clipTitle,
      startMs: null,
      endMs: null,
      verification: unverifiedEvidence("Legacy clip title has no linked reviewed media or timecodes."),
    });
  }

  return evidence;
}

function baseLegacyContract(
  input: LegacyContentOpportunityInput,
  warnings: LegacyContentOpportunityConversion["warnings"],
) {
  const rawBodyContent = cleanText(input.bodyContent, 8000);
  const caption = cleanText(rawBodyContent, 5000) || FALLBACK_REVIEW_COPY;
  return {
    schemaVersion: CONTENT_CONTRACT_SCHEMA_VERSION,
    sourceEvidence: buildLegacyEvidence(input),
    publishingCopy: {
      caption,
      hashtags: extractHashtags(caption),
      callToAction: null,
      platforms: platformsFromLegacy(input.suggestedPlatform),
    },
    legacyConversion: {
      origin: "LEGACY_BODY_CONTENT" as const,
      rawBodyContent,
      requiresReview: true as const,
      warnings: uniqueValues(warnings),
    },
  };
}

function legacyWarnings(
  input: LegacyContentOpportunityInput,
  extras: LegacyContentOpportunityConversion["warnings"] = [],
): LegacyContentOpportunityConversion["warnings"] {
  const warnings: LegacyContentOpportunityConversion["warnings"] = ["LEGACY_BODY_UNSTRUCTURED"];
  if (cleanText(input.sourceTranscriptExcerpt, 1) || cleanText(input.relatedScripture, 1)) {
    warnings.push("SOURCE_EVIDENCE_UNVERIFIED");
  }
  if (!cleanText(input.bodyContent, 1)) warnings.push("CONTENT_INCOMPLETE");
  warnings.push(...extras);
  return uniqueValues(warnings);
}

function extractLegacySections(body: string) {
  return body
    .split(/\n{2,}/u)
    .map((section) => section.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((section, index) => ({
      heading: `Section ${index + 1}`,
      body: cleanText(section, 2400),
    }));
}

function textPostKind(type: ContentOpportunityType): z.infer<typeof genericTextPostContractSchema>["postKind"] {
  if (type === "CAPTION") return "CAPTION";
  if (type === "FACEBOOK_POST_IDEA" || type === "INSTAGRAM_POST_IDEA") return "SOCIAL_POST";
  if (type.endsWith("SUMMARY")) return "SUMMARY";
  if (type.endsWith("OUTLINE")) return "OUTLINE";
  if (type === "EMAIL_RECAP" || type === "NEWSLETTER_SUMMARY") return "EMAIL";
  if (type.endsWith("QUESTIONS")) return "QUESTIONS";
  if (type === "SUNDAY_RECAP") return "RECAP";
  if (type === "NEXT_SERVICE_PROMOTION") return "PROMOTION";
  if (type === "INVITATION_CONTENT") return "INVITATION";
  if (type.endsWith("FOLLOW_UP_CONTENT")) return "FOLLOW_UP";
  if (type === "SERMON_CONTENT_MAP" || type === "CONTENT_CALENDAR_PLAN") return "CONTENT_PLAN";
  return "GENERIC";
}

function guideKind(type: ContentOpportunityType): z.infer<typeof multiDayGuideContractSchema>["guideKind"] {
  if (type === "PRAYER_GUIDE") return "PRAYER";
  if (type === "DEVOTIONAL_GUIDE") return "DEVOTIONAL";
  if (type === "SMALL_GROUP_GUIDE") return "SMALL_GROUP";
  if (type === "FAMILY_DISCUSSION_GUIDE") return "FAMILY";
  if (type === "YOUTH_DISCUSSION_GUIDE") return "YOUTH";
  return "GENERAL";
}

function buildLegacyContract(input: LegacyContentOpportunityInput): ContentOpportunityContract {
  const body = cleanText(input.bodyContent, 8000) || FALLBACK_REVIEW_COPY;
  const title = cleanText(input.title, 200) || "Content draft";
  const family = getContentContractFamily(input.opportunityType);

  if (family === "QUOTE_GRAPHIC") {
    const warnings = legacyWarnings(input);
    const evidence = buildLegacyEvidence(input);
    const quoteCandidate = extractQuoteTextFromContent(body);
    const hasTranscriptEvidence = evidence.some((item) => item.kind === "TRANSCRIPT_SPAN");
    return quoteGraphicContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      quote: {
        text: cleanText(quoteCandidate ?? body, 600) || FALLBACK_REVIEW_COPY,
        kind: hasTranscriptEvidence ? "VERBATIM_SERMON" : "PARAPHRASE",
        attribution: null,
        supportingText: null,
      },
      designBrief: { visualMood: null, imageDirection: null, emphasisWords: [] },
    });
  }

  if (family === "SCRIPTURE_GRAPHIC") {
    const warnings = legacyWarnings(input, ["SCRIPTURE_REVIEW_REQUIRED"]);
    const scripture = scriptureFromLegacy(input.relatedScripture);
    return scriptureGraphicContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      scripture,
      artwork: { headline: title, primaryText: cleanText(body, 1200), footer: null },
      designBrief: { visualMood: null, imageDirection: null, emphasisWords: [] },
    });
  }

  if (family === "VIDEO_CLIP_BRIEF") {
    const warnings = legacyWarnings(input, ["MEDIA_LINK_REQUIRED"]);
    return videoClipProductionBriefContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      creative: {
        hook: cleanText(extractQuoteTextFromContent(body) ?? title, 240),
        spokenFocus: cleanText(body, 2400),
        onScreenTitle: title,
        audience: null,
        desiredResponse: null,
      },
      productionBrief: {
        mediaStatus: "MISSING",
        sermonMediaId: null,
        clipId: null,
        startMs: null,
        endMs: null,
        targetDurationSeconds: null,
        aspectRatio: "9:16",
        captionsRequired: true,
        onScreenText: [],
        bRollDirections: [],
        editNotes: [],
      },
    });
  }

  if (family === "CAROUSEL") {
    const warnings = legacyWarnings(input, ["CONTENT_INCOMPLETE"]);
    const sections = extractLegacySections(body).slice(0, 20);
    const slideBodies = sections.length >= 2
      ? sections.map((section) => section.body)
      : [body, "Closing slide needs editorial review."];
    return carouselContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      title,
      slides: slideBodies.map((slideBody, index) => ({
        position: index + 1,
        role: index === 0 ? "COVER" : index === slideBodies.length - 1 ? "CTA" : "CONTENT",
        headline: index === 0 ? title : `Slide ${index + 1}`,
        body: cleanText(slideBody, 900),
        scripture: null,
        imageDirection: null,
      })),
      designBrief: { visualMood: null, layoutDirection: null },
    });
  }

  if (family === "PLATFORM_CAPTION_PACK") {
    const warnings = legacyWarnings(input, ["PLATFORM_COPY_REVIEW_REQUIRED"]);
    const base = baseLegacyContract(input, warnings);
    return platformCaptionPackContractSchema.parse({
      family,
      ...base,
      campaignMessage: cleanText(body, 500),
      captions: [{
        platform: "OTHER",
        otherPlatform: "Legacy draft",
        caption: base.publishingCopy.caption,
        hashtags: base.publishingCopy.hashtags,
        callToAction: null,
        adaptationNote: "Choose a platform and review this copy before publishing.",
      }],
    });
  }

  if (family === "STORY_SET") {
    const warnings = legacyWarnings(input, ["CONTENT_INCOMPLETE"]);
    const sections = extractLegacySections(body).slice(0, 20);
    const frameBodies = sections.length > 0 ? sections.map((section) => section.body) : [body];
    return storySetContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      title,
      frames: frameBodies.map((frameBody, index) => ({
        position: index + 1,
        role: index === 0 ? "HOOK" : "TEACHING",
        headline: index === 0 ? title : `Story ${index + 1}`,
        body: cleanText(frameBody, 700),
        scripture: null,
        interaction: null,
        imageDirection: null,
      })),
    });
  }

  if (family === "MULTI_DAY_GUIDE") {
    const warnings = legacyWarnings(input, ["CONTENT_INCOMPLETE"]);
    const scripture = scriptureFromLegacy(input.relatedScripture);
    return multiDayGuideContractSchema.parse({
      family,
      ...baseLegacyContract(input, warnings),
      guideKind: guideKind(input.opportunityType),
      title,
      introduction: null,
      days: [{
        day: 1,
        title: "Day 1",
        scripture: scripture.reference ? scripture : null,
        teaching: cleanText(body, 3000),
        reflectionQuestions: [],
        prayer: null,
        actionStep: null,
      }],
    });
  }

  const warnings = legacyWarnings(input);
  return genericTextPostContractSchema.parse({
    family: "TEXT_POST",
    ...baseLegacyContract(input, warnings),
    postKind: textPostKind(input.opportunityType),
    headline: title,
    body,
    sections: extractLegacySections(body),
  });
}

export function convertLegacyBodyContent(
  input: LegacyContentOpportunityInput,
): LegacyContentOpportunityConversion {
  const contract = buildLegacyContract(input);
  return {
    source: "LEGACY_CONVERTED",
    contract,
    warnings: contract.legacyConversion?.warnings ?? ["LEGACY_BODY_UNSTRUCTURED"],
  };
}

export type ResolveContentOpportunityContractInput = LegacyContentOpportunityInput & {
  structuredContent?: unknown;
};

export type ResolvedContentOpportunityContract =
  | {
      source: "STRUCTURED";
      contract: ContentOpportunityContract;
      warnings: [];
    }
  | LegacyContentOpportunityConversion;

export function resolveContentOpportunityContract(
  input: ResolveContentOpportunityContractInput,
): ResolvedContentOpportunityContract {
  if (input.structuredContent !== null && input.structuredContent !== undefined) {
    try {
      return {
        source: "STRUCTURED",
        contract: parseContentOpportunityContractForType(input.opportunityType, input.structuredContent),
        warnings: [],
      };
    } catch {
      // Invalid or mismatched structured data must never block access to a
      // legacy record. The conversion remains explicitly review-required.
    }
  }

  return convertLegacyBodyContent(input);
}
