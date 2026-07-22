import type { ContentOpportunityType as PrismaContentOpportunityType, Prisma } from "@prisma/client";
import { ZodError } from "zod";

import {
  deriveTranslationReviewState,
  extractQuoteTextFromContent,
  normalizeIntegrityText,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
} from "@/lib/contentIntegrity";
import {
  EDITORIAL_QUALITY_THRESHOLDS,
  assessContentEditorialQuality,
  buildMinistryVoicePromptContext,
  deriveMinistryVoiceProfile,
  type AcceptedEditorialItem,
  type EditorialQualityAssessment,
  type MinistryVoiceProfile,
} from "@/lib/contentEditorialQuality";
import {
  CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE,
  convertLegacyBodyContent,
  parseContentOpportunityContractForType,
  resolveContentOpportunityContract,
  type ContentContractFamily,
  type ContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";
import {
  completeContentOpportunityJobSummary,
  type ContentOpportunityJobPhase,
  type ContentOpportunityJobSummary,
} from "@/lib/contentOpportunityJobs";
import { prisma } from "@/lib/prisma";
import { appendPipelineLog } from "@/server/agents/storage";
import {
  CONTENT_OPPORTUNITY_JSON_SHAPE,
  CONTENT_OPPORTUNITY_TYPES,
  CONTENT_OPPORTUNITY_TYPE_LABELS,
  DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES,
  contentOpportunitySchema,
  type ContentOpportunityCategory,
  type ContentOpportunityRecord,
  type ContentOpportunityType,
} from "@/server/ai/contentOpportunitySchema";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel, resolveOpenAIReasoningEffort } from "@/server/ai/modelConfig";

type SermonContext = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
  sermonDate: Date | null;
};

type IntelligenceContext = {
  generatedTitle: string | null;
  summary: string | null;
  centralTheme: string | null;
  shortOverview: string | null;
  keyTakeaways: unknown;
  isManuallyReviewed: boolean;
  manualTitle: string | null;
  manualSummary: string | null;
  manualCentralTheme: string | null;
};

type OpportunitySourceContext = SermonContext & {
  branding?: {
    churchName: string;
    primaryBrandColor: string;
    secondaryBrandColor: string;
    defaultFontFamily: string;
    defaultCaptionStyleName: string;
  } | null;
  transcriptId: string | null;
  transcriptFullText: string;
  transcriptSegments: Array<{
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>;
  intelligence: IntelligenceContext | null;
  scriptures: Array<{
    reference: string;
    usageType: string;
    isPrimary: boolean;
    transcriptEvidence: string | null;
    isManuallyAdded: boolean;
  }>;
  topics: Array<{
    topic: string;
    confidenceScore: number;
    evidence: string | null;
    isManuallyAdded: boolean;
  }>;
  structureSections: Array<{ sectionType: string; title: string | null; description: string | null }>;
  ministryMoments: Array<{
    id: string;
    momentType: string;
    title: string;
    description: string;
    transcriptExcerpt: string | null;
    suggestedAudience: string | null;
    suggestedUsage: string | null;
    reviewStatus: string;
  }>;
  smartClips: Array<{ id: string; title: string; smartClipCategory: string | null; transcriptText: string }>;
};

type OpportunityPromptContext = Omit<OpportunitySourceContext, "transcriptId" | "transcriptSegments">;

export type OpportunityGenerationOptions = {
  force?: boolean;
  targetType?: PrismaContentOpportunityType;
  quantities?: Partial<Record<PrismaContentOpportunityType, number>>;
  replaceDefaultQuantities?: boolean;
  processingJob?: {
    id: string;
    summary: ContentOpportunityJobSummary;
  };
  onProgress?: (progress: {
    phase: ContentOpportunityJobPhase;
    percent: number;
  }) => Promise<void>;
};

export type OpportunityGenerationResult = {
  opportunityCount: number;
  archivedCount: number;
  reusedExistingOpportunities: boolean;
  complete: boolean;
  repairPasses: number;
  requestedQuantities: Partial<Record<PrismaContentOpportunityType, number>>;
  generatedQuantities: Partial<Record<PrismaContentOpportunityType, number>>;
  shortfalls: OpportunityGenerationShortfall[];
};

export type OpportunityGenerationShortfall = {
  opportunityType: PrismaContentOpportunityType;
  requested: number;
  fulfilled: number;
  missing: number;
  reasons: Array<{
    code: OpportunityCurationRejectionReason | "MODEL_OUTPUT_SHORTFALL" | "REPAIR_FAILED";
    count: number;
  }>;
};

type OpportunityCurationRejectionReason =
  | "DUPLICATE"
  | "QUOTE_EVIDENCE_MISSING"
  | "QUOTE_EVIDENCE_MISMATCH"
  | "SCRIPTURE_EVIDENCE_INVALID"
  | "EDITORIAL_BLOCKER"
  | "EDITORIAL_QUALITY_LOW";

type CuratedGeneratedOpportunity = ContentOpportunityRecord & {
  structuredContentJson: Prisma.InputJsonValue;
  editorialContract: ContentOpportunityContract;
  sourceTranscriptSegmentIds: string[] | null;
  sourceStartTimeSeconds: number | null;
  sourceEndTimeSeconds: number | null;
  scriptureTranslation: string | null;
  scriptureVerifiedAt: Date | null;
  translationReviewState: "NOT_REQUIRED" | "REVIEW_REQUIRED";
};

type OpportunityDedupeRecord = {
  id?: string;
  opportunityType: PrismaContentOpportunityType;
  title: string;
  bodyContent: string;
  contract?: ContentOpportunityContract;
};

type OpportunityRepairFeedback = {
  opportunityType: PrismaContentOpportunityType;
  reasonCode: OpportunityCurationRejectionReason;
  critique: string[];
  repairInstructions: string[];
};

type OpportunityCurationResult = {
  opportunities: CuratedGeneratedOpportunity[];
  rejectionCounts: Partial<
    Record<PrismaContentOpportunityType, Partial<Record<OpportunityCurationRejectionReason, number>>>
  >;
  repairFeedback: OpportunityRepairFeedback[];
};

const MAX_GENERATION_REPAIR_PASSES = 2;
const MAX_OPPORTUNITIES_PER_MODEL_BATCH = 6;

const TYPE_TO_CATEGORY: Record<PrismaContentOpportunityType, ContentOpportunityCategory> = {
  SHORT_FORM_CLIP_IDEA: "SOCIAL",
  QUOTE_GRAPHIC: "SOCIAL",
  SCRIPTURE_GRAPHIC: "SOCIAL",
  CAROUSEL_IDEA: "SOCIAL",
  CAPTION: "SOCIAL",
  REEL_HOOK: "SOCIAL",
  YOUTUBE_SHORTS_IDEA: "SOCIAL",
  TIKTOK_IDEA: "SOCIAL",
  FACEBOOK_POST_IDEA: "SOCIAL",
  INSTAGRAM_POST_IDEA: "SOCIAL",
  SERMON_SUMMARY: "WRITTEN",
  DEVOTIONAL_SUMMARY: "DEVOTIONAL",
  NEWSLETTER_SUMMARY: "WRITTEN",
  BLOG_DRAFT_OUTLINE: "WRITTEN",
  ARTICLE_OUTLINE: "WRITTEN",
  EMAIL_RECAP: "WRITTEN",
  DISCUSSION_QUESTIONS: "ENGAGEMENT",
  SMALL_GROUP_QUESTIONS: "DISCIPLESHIP",
  REFLECTION_QUESTIONS: "DISCIPLESHIP",
  FAMILY_DISCUSSION_QUESTIONS: "DISCIPLESHIP",
  YOUTH_DISCUSSION_QUESTIONS: "DISCIPLESHIP",
  SUNDAY_RECAP: "RECAP",
  NEXT_SERVICE_PROMOTION: "PROMOTION",
  INVITATION_CONTENT: "PROMOTION",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "PROMOTION",
  EVENT_FOLLOW_UP_CONTENT: "PROMOTION",
  PLATFORM_CAPTION_PACK: "SOCIAL",
  ENGAGEMENT_STORY_SET: "ENGAGEMENT",
  PRAYER_GUIDE: "DEVOTIONAL",
  DEVOTIONAL_GUIDE: "DEVOTIONAL",
  SMALL_GROUP_GUIDE: "DISCIPLESHIP",
  FAMILY_DISCUSSION_GUIDE: "DISCIPLESHIP",
  YOUTH_DISCUSSION_GUIDE: "DISCIPLESHIP",
  SERMON_CONTENT_MAP: "RECAP",
  CONTENT_CALENDAR_PLAN: "PROMOTION",
};

const CONTENT_OPPORTUNITY_TYPE_SET = new Set<string>(CONTENT_OPPORTUNITY_TYPES);
const OPPORTUNITY_TYPE_PREFIXES = [
  "CONTENTOPPORTUNITYTYPE.",
  "CONTENTOPPORTUNITYTYPE:",
  "CONTENT_OPPORTUNITY_TYPE.",
  "CONTENT_OPPORTUNITY_TYPE:",
  "OPPORTUNITYTYPE.",
  "OPPORTUNITY_TYPE.",
  "OPPORTUNITY_TYPE:",
] as const;

type ParsedGeneratedOpportunityBatch = {
  opportunities: ContentOpportunityRecord[];
  rejectedCount: number;
};

function unwrapScalarFormatting(value: string): string {
  let unwrapped = value.trim();
  const wrapperPairs = [
    ['\\\"', '\\\"'],
    ["\\'", "\\'"],
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
  ] as const;

  for (let layer = 0; layer < 3; layer += 1) {
    const pair = wrapperPairs.find(([open, close]) => (
      unwrapped.length >= open.length + close.length &&
      unwrapped.startsWith(open) &&
      unwrapped.endsWith(close)
    ));
    if (!pair) {
      break;
    }
    unwrapped = unwrapped.slice(pair[0].length, -pair[1].length).trim();
  }

  return unwrapped;
}

function canonicalizeOpportunityType(value: unknown): PrismaContentOpportunityType | null {
  if (typeof value !== "string") {
    return null;
  }

  let token = unwrapScalarFormatting(value)
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  const prefix = OPPORTUNITY_TYPE_PREFIXES.find((candidate) => token.startsWith(candidate));
  if (prefix) {
    token = unwrapScalarFormatting(token.slice(prefix.length)).replace(/^_+/, "");
  }

  return CONTENT_OPPORTUNITY_TYPE_SET.has(token)
    ? token as PrismaContentOpportunityType
    : null;
}

function describeReceivedEnumValue(value: unknown): string {
  if (typeof value !== "string") {
    return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  }

  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (/^[A-Za-z0-9_ .:'"`\\-]{1,64}$/.test(normalized)) {
    return JSON.stringify(normalized);
  }

  return `string(length=${value.length})`;
}

function summarizeReceivedEnumValues(records: unknown[], field: "category" | "opportunityType"): string {
  const samples = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      samples.add(describeReceivedEnumValue(record));
    } else {
      samples.add(describeReceivedEnumValue((record as Record<string, unknown>)[field]));
    }
    if (samples.size >= 5) {
      break;
    }
  }
  return Array.from(samples).join(", ") || "none";
}

function parseGeneratedOpportunityPayload(payload: unknown): ParsedGeneratedOpportunityBatch {
  const rawOpportunities = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { opportunities?: unknown }).opportunities
    : undefined;
  if (!Array.isArray(rawOpportunities) || rawOpportunities.length > 120) {
    throw new Error("AI output failed validation: opportunities must be an array with at most 120 records.");
  }

  const opportunities: ContentOpportunityRecord[] = [];
  const rejectedIssueKeys = new Set<string>();

  for (const record of rawOpportunities) {
    const canonicalType = record && typeof record === "object" && !Array.isArray(record)
      ? canonicalizeOpportunityType((record as Record<string, unknown>).opportunityType)
      : null;
    const candidate = canonicalType && record && typeof record === "object" && !Array.isArray(record)
      ? {
          ...record,
          opportunityType: canonicalType,
          category: TYPE_TO_CATEGORY[canonicalType],
        }
      : record;
    const parsed = contentOpportunitySchema.safeParse(candidate);
    if (parsed.success) {
      opportunities.push(parsed.data);
      continue;
    }

    for (const issue of parsed.error.issues) {
      rejectedIssueKeys.add(`${issue.path.join(".") || "record"}:${issue.code}`);
      if (rejectedIssueKeys.size >= 8) {
        break;
      }
    }
  }

  const rejectedCount = rawOpportunities.length - opportunities.length;
  if (rejectedCount > 0) {
    const categories = summarizeReceivedEnumValues(rawOpportunities, "category");
    const types = summarizeReceivedEnumValues(rawOpportunities, "opportunityType");
    const issues = Array.from(rejectedIssueKeys).join(", ") || "record:invalid";
    throw new Error(
      `AI output contained ${rejectedCount || rawOpportunities.length} invalid content opportunity record(s) ` +
      `(${rawOpportunities.length} received); no partial batch was saved. ` +
      `Received category samples: ${categories}. Received opportunityType samples: ${types}. ` +
      `Validation issue kinds: ${issues}.`,
    );
  }

  return { opportunities, rejectedCount };
}

function isModelOutputQualityError(error: unknown): boolean {
  const message = formatContentGenerationError(error);
  return message.startsWith("AI output") || message.startsWith("AI returned invalid JSON");
}

function shouldPreserveOpportunityDuringRegeneration(opportunity: {
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "USED" | "ARCHIVED";
  isManuallyEdited: boolean;
  isManuallyCreated: boolean;
  editedContent: string | null;
  approvedContent: string | null;
}): boolean {
  if (opportunity.isManuallyCreated) {
    return true;
  }

  if (opportunity.status === "APPROVED" || opportunity.status === "USED") {
    return true;
  }

  if (opportunity.isManuallyEdited || Boolean(opportunity.editedContent) || Boolean(opportunity.approvedContent)) {
    return true;
  }

  return false;
}

function shouldReuseExistingOpportunities(existingCount: number, force?: boolean): boolean {
  return existingCount > 0 && !force;
}

function buildRequestedQuantities(options?: OpportunityGenerationOptions): Record<PrismaContentOpportunityType, number> {
  const overrides = options?.quantities ?? {};
  const requested: Record<PrismaContentOpportunityType, number> = options?.replaceDefaultQuantities
    ? Object.fromEntries(
        Object.keys(DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES).map((type) => [type, 0]),
      ) as Record<PrismaContentOpportunityType, number>
    : { ...DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES };

  for (const [type, qty] of Object.entries(overrides) as Array<[PrismaContentOpportunityType, number]>) {
    requested[type] = Math.max(0, Math.floor(qty));
  }

  if (options?.targetType) {
    for (const type of Object.keys(requested) as PrismaContentOpportunityType[]) {
      requested[type] = type === options.targetType
        ? Math.max(1, requested[type] || 1)
        : 0;
    }
  }

  return requested;
}

type FamilyGenerationBatch = {
  family: ContentContractFamily;
  quantities: Record<PrismaContentOpportunityType, number>;
};

function requestedContentFamily(
  quantities: Partial<Record<PrismaContentOpportunityType, number>>,
): ContentContractFamily | "MIXED" | null {
  const families = new Set<ContentContractFamily>();
  for (const [rawType, quantity] of Object.entries(quantities)) {
    if ((quantity ?? 0) <= 0) continue;
    families.add(
      CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE[rawType as PrismaContentOpportunityType],
    );
  }
  if (families.size === 0) return null;
  return families.size === 1 ? Array.from(families)[0] ?? null : "MIXED";
}

/**
 * Keeps each model call within one typed-contract family and a small record
 * budget. A malformed rich family therefore cannot invalidate otherwise good
 * quote, caption, or written-content output.
 */
function buildFamilyCoherentGenerationBatches(
  quantities: Partial<Record<PrismaContentOpportunityType, number>>,
): FamilyGenerationBatch[] {
  const byFamily = new Map<ContentContractFamily, Array<{
    type: PrismaContentOpportunityType;
    quantity: number;
  }>>();

  for (const type of Object.keys(DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES) as PrismaContentOpportunityType[]) {
    const quantity = Math.max(0, Math.floor(quantities[type] ?? 0));
    if (quantity === 0) continue;
    const family = CONTENT_CONTRACT_FAMILY_BY_OPPORTUNITY_TYPE[type];
    const entries = byFamily.get(family) ?? [];
    entries.push({ type, quantity });
    byFamily.set(family, entries);
  }

  const batches: FamilyGenerationBatch[] = [];
  for (const [family, entries] of byFamily) {
    let batch = emptyOpportunityQuantities();
    let batchSize = 0;
    for (const entry of entries) {
      let remaining = entry.quantity;
      while (remaining > 0) {
        const available = MAX_OPPORTUNITIES_PER_MODEL_BATCH - batchSize;
        const selected = Math.min(remaining, available);
        batch[entry.type] += selected;
        batchSize += selected;
        remaining -= selected;
        if (batchSize === MAX_OPPORTUNITIES_PER_MODEL_BATCH) {
          batches.push({ family, quantities: batch });
          batch = emptyOpportunityQuantities();
          batchSize = 0;
        }
      }
    }
    if (batchSize > 0) batches.push({ family, quantities: batch });
  }

  return batches;
}

function buildSystemPrompt(): string {
  return [
    "You are a church content strategist creating reusable content opportunities from one sermon.",
    "Do not invent facts, scripture references, names, events, or claims not supported by the transcript or sermon intelligence context.",
    "Every opportunity must be grounded in transcript evidence and ministry context.",
    "Prefer practical, publish-ready drafts with clear ministry value.",
    "Support multilingual sermons including South African language mixing (Zulu, Sotho, Xhosa, Tswana, and English mixed with local phrases).",
    "When local-language phrases appear, provide English-friendly wording and translation hints. If uncertain, explicitly note uncertainty.",
    "Keep tone pastor-friendly, faithful to doctrine, and free from exaggeration or clickbait.",
    "A QUOTE_GRAPHIC must use the pastor's exact or near-verbatim transcript wording. Put the exact evidence in sourceTranscriptExcerpt. Never present an AI-written paraphrase as a pastor quote.",
    "For CAROUSEL_IDEA, write complete numbered slide copy, keep each slide concise, and include a final reflection or ministry CTA.",
    "For PLATFORM_CAPTION_PACK, include clearly labelled TikTok, Instagram, Facebook, YouTube Shorts, WhatsApp Status, and WhatsApp Group variants. Include LinkedIn only when grounded in a leadership, work, integrity, stewardship, or resilience theme.",
    "For ENGAGEMENT_STORY_SET, include one poll with answer choices, one quiz with answer and explanation, one slider, one question-box prompt, and one ministry-response prompt. Do not claim native platform interactivity.",
    "For DEVOTIONAL_GUIDE, produce five connected days. Every day needs a title, sermon-grounded reflection, Scripture, reflection question, prayer, and action step. Do not pad a sermon into unsupported teaching.",
    "For PRAYER_GUIDE, produce five sermon-grounded days with Scripture, prayer focus, personal prayer, and action. Clearly distinguish an extracted prayer from a generated prayer.",
    "For SMALL_GROUP_GUIDE, include an icebreaker, summary, main Scripture, 3-5 discussion questions, personal reflection, group prayer, and weekly challenge.",
    "FAMILY_DISCUSSION_GUIDE and YOUTH_DISCUSSION_GUIDE are audience adaptations, not new doctrine. Avoid unsafe counselling claims and label broader interpretation through lower confidence and aiReason.",
    "For SERMON_CONTENT_MAP, identify the main theme, subthemes, best grounded quote, best clip, carousel direction, engagement prompt, devotional, prayer, follow-up, and review warnings.",
    "For CONTENT_CALENDAR_PLAN, create a seven-day suggested plan that balances formats, avoids repeating the same sermon point, and never implies content is automatically published.",
    "When generating questions, provide concise but meaningful prompts suitable for ministry use.",
    "Ensure the generated set includes useful sermon recaps, captions, quote ideas, reflection questions, small-group questions, and invitation posts when requested.",
    "Use only allowed opportunity categories and opportunity types.",
    "Return category and opportunityType using the exact UPPER_SNAKE_CASE enum values from the JSON example.",
    "Confidence scores must be between 0.0 and 1.0.",
    "Return structured JSON only. Do not include markdown or text outside JSON.",
    "Exact JSON shape required:",
    CONTENT_OPPORTUNITY_JSON_SHAPE,
  ].join("\n");
}

function buildUserPrompt(
  context: OpportunityPromptContext,
  requestedQuantities: Record<PrismaContentOpportunityType, number>,
  options?: {
    repairAttempt?: number;
    avoidDuplicates?: OpportunityDedupeRecord[];
    repairFeedback?: OpportunityRepairFeedback[];
    voiceProfile?: MinistryVoiceProfile;
  },
): string {
  const requestedLines = (Object.keys(requestedQuantities) as PrismaContentOpportunityType[])
    .filter((type) => requestedQuantities[type] > 0)
    .map((type) => `${type} (${CONTENT_OPPORTUNITY_TYPE_LABELS[type as ContentOpportunityType]}): ${requestedQuantities[type]}`);

  const intelligenceReviewed = Boolean(context.intelligence?.isManuallyReviewed);
  const keyTakeaways = intelligenceReviewed && Array.isArray(context.intelligence?.keyTakeaways)
    ? context.intelligence.keyTakeaways.filter((item): item is string => typeof item === "string")
    : [];
  const groundedScriptures = context.scriptures.filter((item) => (
    item.isManuallyAdded || Boolean(item.transcriptEvidence?.trim())
  ));
  const groundedTopics = context.topics.filter((item) => (
    item.isManuallyAdded || Boolean(item.evidence?.trim())
  ));
  const reviewedMoments = context.ministryMoments.filter((moment) => (
    moment.reviewStatus === "APPROVED" && Boolean(moment.transcriptExcerpt?.trim())
  ));
  const groundingEvidence = buildGroundingEvidence(context);

  const sections = [
    `Sermon title: ${context.title}`,
    `Speaker: ${context.speakerName}`,
    `Church: ${context.churchName}`,
    `Language: ${context.language}`,
    context.sermonDate ? `Date: ${context.sermonDate.toISOString().split("T")[0]}` : "",
    "",
    "Requested content opportunity counts:",
    requestedLines.join("\n"),
    "",
    "Translation and grounding rules:",
    "- If a local-language phrase is used, keep the original phrase and provide plain English meaning where possible.",
    "- If translation confidence is low, set translationUncertaintyNote with a brief caution.",
    "- Never add unsupported claims, scriptures, altar calls, or testimonies.",
    "- Only use a relatedScripture that appears in the supplied sermon Scripture list. Include a translation/version only when the source context identifies it; otherwise leave the version unstated for human review.",
    "",
    "Reviewed sermon intelligence context:",
    `Title: ${intelligenceReviewed ? context.intelligence?.manualTitle ?? context.title : context.title}`,
    `Summary: ${intelligenceReviewed ? context.intelligence?.manualSummary ?? "" : ""}`,
    `Central theme: ${intelligenceReviewed ? context.intelligence?.manualCentralTheme ?? "" : ""}`,
    `Short overview: ${intelligenceReviewed ? context.intelligence?.shortOverview ?? "" : ""}`,
    `Key takeaways: ${keyTakeaways.join(" | ")}`,
    "",
    `Grounded Scriptures: ${groundedScriptures.map((item) => item.reference).join(", ")}`,
    `Grounded topics: ${groundedTopics.map((item) => item.topic).join(", ")}`,
    `Structure: ${context.structureSections.map((item) => item.sectionType).join(", ")}`,
    "",
    "Reviewed ministry moments:",
    reviewedMoments.length > 0
      ? reviewedMoments
          .slice(0, 20)
          .map((moment) => `${moment.momentType}: ${moment.title} | ${moment.description}`)
          .join("\n")
      : "None",
    "",
    "Available smart clips:",
    context.smartClips.length > 0
      ? context.smartClips
          .slice(0, 20)
          .map((clip) => `${clip.title} (${clip.smartClipCategory ?? "uncategorized"})`)
          .join("\n")
      : "None",
    "",
    "Transcript-grounded evidence excerpts:",
    groundingEvidence,
    ...(options?.voiceProfile
      ? [
          "",
          "Reviewed ministry voice and personalization context:",
          buildMinistryVoicePromptContext(options.voiceProfile),
        ]
      : []),
    ...(options?.repairAttempt && options.repairAttempt > 0
      ? [
          "",
          `Quality repair pass ${options.repairAttempt}: generate only the still-missing quantities above.`,
          "Previous candidates were rejected by deterministic evidence and editorial checks. Return fresh, distinct candidates, apply the repair instructions below, and do not pad the response.",
          options.repairFeedback?.length
            ? `Deterministic editorial feedback:\n${options.repairFeedback
                .slice(0, 24)
                .map((feedback) => [
                  `- ${feedback.opportunityType} [${feedback.reasonCode}]`,
                  ...feedback.critique.slice(0, 3).map((item) => `  Critique: ${item}`),
                  ...feedback.repairInstructions.slice(0, 4).map((item) => `  Repair: ${item}`),
                ].join("\n"))
                .join("\n")}`
            : "",
          options.avoidDuplicates?.length
            ? `Do not repeat these existing or already accepted ideas:\n${options.avoidDuplicates
                .slice(0, 40)
                .map((item) => `- ${item.opportunityType}: ${item.title} | ${item.bodyContent.slice(0, 180)}`)
                .join("\n")}`
            : "",
        ]
      : []),
  ].filter(Boolean);

  return sections.join("\n");
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildGroundingEvidence(context: OpportunityPromptContext): string {
  const evidence = [
    ...context.ministryMoments.map((moment) => moment.transcriptExcerpt ?? ""),
    ...context.smartClips.map((clip) => clip.transcriptText),
  ]
    .map(normalizeEvidenceText)
    .filter(Boolean);
  const uniqueEvidence = Array.from(new Set(evidence));
  if (uniqueEvidence.length > 0) {
    return uniqueEvidence
      .slice(0, 24)
      .map((excerpt, index) => `[Evidence ${index + 1}] ${excerpt.slice(0, 1_200)}`)
      .join("\n")
      .slice(0, 18_000);
  }

  // New sermons may not have clips or moments yet. Preserve broad coverage
  // without resending the entire transcript by sampling its opening, middle,
  // and closing regions.
  const transcript = normalizeEvidenceText(context.transcriptFullText);
  const excerptLength = 4_000;
  const middleStart = Math.max(0, Math.floor((transcript.length - excerptLength) / 2));
  return [
    `[Opening] ${transcript.slice(0, excerptLength)}`,
    `[Middle] ${transcript.slice(middleStart, middleStart + excerptLength)}`,
    `[Closing] ${transcript.slice(-excerptLength)}`,
  ].join("\n");
}

function deriveGenerationVoiceProfile(context: OpportunitySourceContext): MinistryVoiceProfile {
  return deriveMinistryVoiceProfile({
    branding: context.branding,
    sermon: {
      title: context.title,
      speakerName: context.speakerName,
      churchName: context.churchName,
      language: context.language,
      sermonDate: context.sermonDate,
      intelligence: context.intelligence
        ? {
            isManuallyReviewed: context.intelligence.isManuallyReviewed,
            manualTitle: context.intelligence.manualTitle,
            manualSummary: context.intelligence.manualSummary,
            manualCentralTheme: context.intelligence.manualCentralTheme,
          }
        : null,
      topicTags: context.topics.map((topic) => ({
        topic: topic.topic,
        evidence: topic.evidence,
        isManuallyAdded: topic.isManuallyAdded,
      })),
      scriptureRefs: context.scriptures.map((scripture) => ({
        reference: scripture.reference,
        transcriptEvidence: scripture.transcriptEvidence,
        isManuallyAdded: scripture.isManuallyAdded,
      })),
      ministryMoments: context.ministryMoments.map((moment) => ({
        title: moment.title,
        description: moment.description,
        transcriptExcerpt: moment.transcriptExcerpt,
        suggestedAudience: moment.suggestedAudience,
        reviewStatus: moment.reviewStatus,
      })),
    },
  });
}

function buildLanguageHintSummary(item: ContentOpportunityRecord): string | null {
  const parts: string[] = [];

  if (item.detectedLanguage) {
    parts.push(`Detected language: ${item.detectedLanguage}.`);
  }

  if (item.translatedFromLanguage) {
    parts.push(`Translated from: ${item.translatedFromLanguage}.`);
  }

  if (item.originalPhrase) {
    parts.push(`Original phrase: ${item.originalPhrase}.`);
  }

  if (item.englishMeaning) {
    parts.push(`English meaning: ${item.englishMeaning}.`);
  }

  if (typeof item.translationConfidence === "number") {
    parts.push(`Translation confidence: ${item.translationConfidence.toFixed(2)}.`);
  }

  if (item.translationUncertaintyNote) {
    parts.push(`Translation uncertainty: ${item.translationUncertaintyNote}.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

async function callOpportunityModel(
  context: OpportunitySourceContext,
  requestedQuantities: Record<PrismaContentOpportunityType, number>,
  options?: {
    bypassCache?: boolean;
    repairAttempt?: number;
    avoidDuplicates?: OpportunityDedupeRecord[];
    repairFeedback?: OpportunityRepairFeedback[];
    voiceProfile?: MinistryVoiceProfile;
  },
): Promise<ContentOpportunityRecord[]> {
  const model = resolveOpenAIChatModel("contentMultiplication");
  const reasoningEffort = resolveOpenAIReasoningEffort("contentMultiplication", model);

  return createLoggedChatCompletion({
    operation: "content_opportunity_generation",
    sermonId: context.id,
    model,
    reasoningEffort,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserPrompt(context, requestedQuantities, {
          repairAttempt: options?.repairAttempt,
          avoidDuplicates: options?.avoidDuplicates,
          repairFeedback: options?.repairFeedback,
          voiceProfile: options?.voiceProfile,
        }),
      },
    ],
    promptVersion: "content-opportunities-v5-quality-repair",
    metadata: {
      requestedQuantities,
      repairAttempt: options?.repairAttempt ?? 0,
      contentFamily: requestedContentFamily(requestedQuantities),
      voiceProfileApplied: Boolean(options?.voiceProfile),
      sourceTranscriptCharacters: context.transcriptFullText.length,
      promptEvidenceCharacters: buildGroundingEvidence(context).length,
      language: context.language,
    },
    missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before generating content opportunities.",
    bypassCache: options?.bypassCache,
    validateResponse: async (completion) => {
      const raw = completion.choices[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`AI returned invalid JSON: ${raw.slice(0, 200)}`);
      }
      return parseGeneratedOpportunityPayload(parsed).opportunities;
    },
  });
}

function emptyOpportunityQuantities(): Record<PrismaContentOpportunityType, number> {
  return Object.keys(DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES).reduce((acc, key) => {
    acc[key as PrismaContentOpportunityType] = 0;
    return acc;
  }, {} as Record<PrismaContentOpportunityType, number>);
}

function countOpportunityTypes(
  opportunities: Array<{ opportunityType: PrismaContentOpportunityType | ContentOpportunityType }>,
): Record<PrismaContentOpportunityType, number> {
  const counts = emptyOpportunityQuantities();
  for (const opportunity of opportunities) {
    const type = opportunity.opportunityType as PrismaContentOpportunityType;
    counts[type] += 1;
  }
  return counts;
}

function computeMissingQuantities(
  requested: Partial<Record<PrismaContentOpportunityType, number>>,
  fulfilled: Partial<Record<PrismaContentOpportunityType, number>>,
): Record<PrismaContentOpportunityType, number> {
  const missing = emptyOpportunityQuantities();
  for (const type of Object.keys(missing) as PrismaContentOpportunityType[]) {
    missing[type] = Math.max(0, (requested[type] ?? 0) - (fulfilled[type] ?? 0));
  }
  return missing;
}

function hasRequestedQuantities(quantities: Partial<Record<PrismaContentOpportunityType, number>>): boolean {
  return (Object.values(quantities) as number[]).some((quantity) => quantity > 0);
}

const DEDUPE_NOISE_WORDS = new Set([
  "a",
  "an",
  "and",
  "card",
  "content",
  "for",
  "graphic",
  "idea",
  "of",
  "post",
  "quote",
  "social",
  "the",
  "to",
]);

function semanticTokens(value: string): string[] {
  return normalizeIntegrityText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !DEDUPE_NOISE_WORDS.has(token));
}

function tokenJaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(semanticTokens(left));
  const rightTokens = new Set(semanticTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return normalizeIntegrityText(left) === normalizeIntegrityText(right) ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function areNearDuplicateOpportunities(
  left: OpportunityDedupeRecord,
  right: OpportunityDedupeRecord,
): boolean {
  if (left.opportunityType !== right.opportunityType) return false;

  const normalizedLeftTitle = normalizeIntegrityText(left.title);
  const normalizedRightTitle = normalizeIntegrityText(right.title);
  const normalizedLeftBody = normalizeIntegrityText(left.bodyContent);
  const normalizedRightBody = normalizeIntegrityText(right.bodyContent);
  if (
    (normalizedLeftTitle && normalizedLeftTitle === normalizedRightTitle)
    || (normalizedLeftBody && normalizedLeftBody === normalizedRightBody)
  ) {
    return true;
  }

  const titleSimilarity = tokenJaccardSimilarity(left.title, right.title);
  const bodySimilarity = tokenJaccardSimilarity(left.bodyContent, right.bodyContent);
  return titleSimilarity >= 0.9
    || bodySimilarity >= 0.93
    || (titleSimilarity >= 0.8 && bodySimilarity >= 0.82);
}

type TranscriptEvidenceMatch = {
  segmentIds: string[];
  startTimeSeconds: number;
  endTimeSeconds: number;
};

type IndexedTranscriptWord = {
  value: string;
  segmentIndex: number;
};

function findWordSequence(
  transcriptWords: IndexedTranscriptWord[],
  targetWords: string[],
  startAt: number,
): number {
  if (targetWords.length === 0 || targetWords.length > transcriptWords.length) return -1;
  for (let index = Math.max(0, startAt); index <= transcriptWords.length - targetWords.length; index += 1) {
    if (targetWords.every((word, offset) => transcriptWords[index + offset]?.value === word)) {
      return index;
    }
  }
  return -1;
}

function locateTranscriptEvidence(
  value: string | null | undefined,
  segments: OpportunitySourceContext["transcriptSegments"],
): TranscriptEvidenceMatch | null {
  const trimmed = value?.trim();
  if (!trimmed || segments.length === 0) return null;

  const transcriptWords = segments.flatMap((segment, segmentIndex) => (
    semanticTranscriptWords(segment.text).map((word) => ({ value: word, segmentIndex }))
  ));
  const quoteParts = trimmed
    .split(/(?:…|\.{3,})/gu)
    .map(semanticTranscriptWords)
    .filter((part) => part.length > 0);
  if (quoteParts.length === 0) return null;

  let firstPartStart = findWordSequence(transcriptWords, quoteParts[0] ?? [], 0);
  while (firstPartStart >= 0) {
    let partStart = firstPartStart;
    let firstWordIndex = firstPartStart;
    let lastWordIndex = firstPartStart + (quoteParts[0]?.length ?? 0) - 1;
    let matched = true;

    for (let partIndex = 1; partIndex < quoteParts.length; partIndex += 1) {
      const previousEndExclusive = lastWordIndex + 1;
      const nextPart = quoteParts[partIndex] ?? [];
      partStart = findWordSequence(transcriptWords, nextPart, previousEndExclusive);
      if (partStart < 0 || partStart - previousEndExclusive > 80) {
        matched = false;
        break;
      }
      lastWordIndex = partStart + nextPart.length - 1;
    }

    if (matched) {
      const firstSegmentIndex = transcriptWords[firstWordIndex]?.segmentIndex;
      const lastSegmentIndex = transcriptWords[lastWordIndex]?.segmentIndex;
      if (firstSegmentIndex !== undefined && lastSegmentIndex !== undefined) {
        return {
          segmentIds: segments
            .slice(firstSegmentIndex, lastSegmentIndex + 1)
            .map((segment) => segment.id),
          startTimeSeconds: segments[firstSegmentIndex]?.startTimeSeconds ?? 0,
          endTimeSeconds: segments[lastSegmentIndex]?.endTimeSeconds ?? 0,
        };
      }
    }

    firstPartStart = findWordSequence(transcriptWords, quoteParts[0] ?? [], firstPartStart + 1);
    firstWordIndex = firstPartStart;
  }

  return null;
}

function semanticTranscriptWords(value: string): string[] {
  const normalized = normalizeIntegrityText(value);
  return normalized ? normalized.split(" ") : [];
}

function transcriptContainsEvidence(transcriptFullText: string, value: string | null | undefined): boolean {
  const targetWords = semanticTranscriptWords(value ?? "");
  const transcriptWords = semanticTranscriptWords(transcriptFullText)
    .map((word) => ({ value: word, segmentIndex: 0 }));
  return findWordSequence(transcriptWords, targetWords, 0) >= 0;
}

function buildKnownScriptureReferences(
  scriptures: OpportunitySourceContext["scriptures"],
): Set<string> {
  const references = new Set<string>();
  for (const scripture of scriptures) {
    if (!scripture.isManuallyAdded && !scripture.transcriptEvidence?.trim()) continue;
    const validated = validateScriptureReference(scripture.reference);
    for (const reference of validated.normalizedReference?.split(";") ?? []) {
      const normalized = reference.trim();
      if (normalized) references.add(normalized);
    }
  }
  return references;
}

function scriptureIsGrounded(normalizedReference: string, knownReferences: Set<string>): boolean {
  const passages = normalizedReference.split(";").map((reference) => reference.trim()).filter(Boolean);
  return passages.length > 0 && passages.every((reference) => knownReferences.has(reference));
}

function buildStructuredContentJson(input: {
  item: ContentOpportunityRecord;
  type: PrismaContentOpportunityType;
  context: OpportunitySourceContext;
  sourceTranscriptExcerpt: string | null;
  evidenceMatch: TranscriptEvidenceMatch | null;
  relatedScripture: string | null;
  verifiedAt: Date;
}): ContentOpportunityContract {
  const converted = convertLegacyBodyContent({
    opportunityType: input.type,
    title: input.item.title,
    bodyContent: input.item.bodyContent,
    sourceTranscriptExcerpt: input.sourceTranscriptExcerpt,
    relatedScripture: input.relatedScripture,
    relatedMinistryMomentTitle: input.item.relatedMinistryMomentTitle,
    relatedClipTitle: input.item.relatedClipTitle,
    suggestedPlatform: input.item.suggestedPlatform,
  }).contract;
  const sourceEvidence = converted.sourceEvidence.map((evidence) => {
    if (evidence.kind !== "TRANSCRIPT_SPAN" || !input.sourceTranscriptExcerpt) return evidence;
    return {
      ...evidence,
      transcriptId: input.context.transcriptId,
      segmentIds: input.evidenceMatch?.segmentIds ?? [],
      startMs: input.evidenceMatch
        ? Math.round(input.evidenceMatch.startTimeSeconds * 1_000)
        : null,
      endMs: input.evidenceMatch
        ? Math.round(input.evidenceMatch.endTimeSeconds * 1_000)
        : null,
      excerpt: input.sourceTranscriptExcerpt,
      verification: {
        status: "VERIFIED" as const,
        method: "TRANSCRIPT_MATCH" as const,
        verifiedAt: input.verifiedAt.toISOString(),
        verifiedBy: "system:content-integrity",
        note: "Matched deterministically against the stored sermon transcript.",
      },
    };
  });

  return parseContentOpportunityContractForType(input.type, {
    ...converted,
    sourceEvidence,
  });
}

function buildEditorialAssessmentContract(
  type: PrismaContentOpportunityType,
  contract: ContentOpportunityContract,
): ContentOpportunityContract {
  // `legacyConversion` is a lifecycle marker added because today's model shape
  // is adapted into the typed contract. The deterministic assessor should
  // judge the resulting fields themselves; persisted output retains the marker
  // so human approval is still mandatory.
  const candidate = { ...contract };
  delete candidate.legacyConversion;
  return parseContentOpportunityContractForType(type, candidate);
}

function enrichGeneratedOpportunity(
  item: ContentOpportunityRecord,
  context: OpportunitySourceContext,
  now: Date,
): {
  opportunity: CuratedGeneratedOpportunity | null;
  rejectionReason: OpportunityCurationRejectionReason | null;
} {
  const type = item.opportunityType as PrismaContentOpportunityType;
  let evidenceMatch: TranscriptEvidenceMatch | null = null;
  let sourceTranscriptExcerpt: string | null = null;

  if (type === "QUOTE_GRAPHIC") {
    const quoteText = extractQuoteTextFromContent(item.bodyContent);
    const verification = verifyQuoteTextAgainstTranscript({
      quoteText,
      // This is the stored transcript, not the model-supplied excerpt.
      sourceTranscriptExcerpt: context.transcriptFullText,
      transcriptSegments: context.transcriptSegments,
    });
    if (!verification.verified) {
      return {
        opportunity: null,
        rejectionReason: verification.status === "QUOTE_MISSING" || verification.status === "EVIDENCE_MISSING"
          ? "QUOTE_EVIDENCE_MISSING"
          : "QUOTE_EVIDENCE_MISMATCH",
      };
    }

    evidenceMatch = locateTranscriptEvidence(quoteText, context.transcriptSegments);
    if (context.transcriptSegments.length > 0 && !evidenceMatch) {
      return { opportunity: null, rejectionReason: "QUOTE_EVIDENCE_MISMATCH" };
    }
    sourceTranscriptExcerpt = quoteText;
  } else if (item.sourceTranscriptExcerpt?.trim()) {
    evidenceMatch = locateTranscriptEvidence(item.sourceTranscriptExcerpt, context.transcriptSegments);
    if (evidenceMatch || transcriptContainsEvidence(context.transcriptFullText, item.sourceTranscriptExcerpt)) {
      sourceTranscriptExcerpt = item.sourceTranscriptExcerpt.trim();
    }
  }

  const knownScriptureReferences = buildKnownScriptureReferences(context.scriptures);
  const scriptureValidation = validateScriptureReference(item.relatedScripture);
  const hasGroundedScripture = Boolean(
    scriptureValidation.valid
    && scriptureValidation.normalizedReference
    && scriptureIsGrounded(scriptureValidation.normalizedReference, knownScriptureReferences),
  );
  if (type === "SCRIPTURE_GRAPHIC" && !hasGroundedScripture) {
    return { opportunity: null, rejectionReason: "SCRIPTURE_EVIDENCE_INVALID" };
  }

  const relatedScripture = hasGroundedScripture ? scriptureValidation.normalizedReference : null;
  const scriptureTranslation = hasGroundedScripture ? scriptureValidation.version : null;
  const translationReview = deriveTranslationReviewState({
    translationNeedsReview: hasGroundedScripture && scriptureValidation.versionStatus === "UNRECOGNIZED",
    translatedFromLanguage: item.translatedFromLanguage,
    originalLanguageText: item.originalPhrase,
    translatedText: item.englishMeaning,
    translationConfidence: item.translationConfidence,
    translationUncertaintyNote: item.translationUncertaintyNote,
    humanTranslationApproved: false,
    scriptureVersion: scriptureTranslation,
    scriptureVersionRequired: type === "SCRIPTURE_GRAPHIC",
    scriptureVersionApproved: false,
  });
  const structuredContent = buildStructuredContentJson({
    item,
    type,
    context,
    sourceTranscriptExcerpt,
    evidenceMatch,
    relatedScripture,
    verifiedAt: now,
  });
  const editorialContract = buildEditorialAssessmentContract(type, structuredContent);

  return {
    opportunity: {
      ...item,
      category: TYPE_TO_CATEGORY[type],
      structuredContentJson: structuredContent as unknown as Prisma.InputJsonValue,
      editorialContract,
      sourceTranscriptExcerpt,
      sourceTranscriptSegmentIds: evidenceMatch?.segmentIds ?? null,
      sourceStartTimeSeconds: evidenceMatch?.startTimeSeconds ?? null,
      sourceEndTimeSeconds: evidenceMatch?.endTimeSeconds ?? null,
      relatedScripture,
      scriptureTranslation,
      scriptureVerifiedAt: hasGroundedScripture ? now : null,
      translationReviewState: translationReview.blocking ? "REVIEW_REQUIRED" : "NOT_REQUIRED",
    },
    rejectionReason: null,
  };
}

function incrementCurationRejection(
  rejectionCounts: OpportunityCurationResult["rejectionCounts"],
  type: PrismaContentOpportunityType,
  reason: OpportunityCurationRejectionReason,
): void {
  const typeCounts = rejectionCounts[type] ?? {};
  typeCounts[reason] = (typeCounts[reason] ?? 0) + 1;
  rejectionCounts[type] = typeCounts;
}

function resolveDedupeContract(record: OpportunityDedupeRecord): ContentOpportunityContract {
  if (record.contract) return record.contract;
  return buildEditorialAssessmentContract(
    record.opportunityType,
    resolveContentOpportunityContract({
      opportunityType: record.opportunityType as ContentOpportunityType,
      title: record.title,
      bodyContent: record.bodyContent,
      structuredContent: null,
      sourceTranscriptExcerpt: null,
      relatedScripture: null,
      relatedMinistryMomentTitle: null,
      relatedClipTitle: null,
      suggestedPlatform: null,
    }).contract,
  );
}

function buildAcceptedEditorialItems(
  records: readonly OpportunityDedupeRecord[],
): AcceptedEditorialItem[] {
  return records.map((record, index) => ({
    id: record.id ?? `accepted-${index + 1}`,
    contract: resolveDedupeContract(record),
  }));
}

function evidenceRepairFeedback(
  opportunityType: PrismaContentOpportunityType,
  reasonCode: OpportunityCurationRejectionReason,
): OpportunityRepairFeedback {
  const details: Partial<Record<OpportunityCurationRejectionReason, {
    critique: string;
    repair: string;
  }>> = {
    QUOTE_EVIDENCE_MISSING: {
      critique: "The proposed direct quote did not provide usable sermon wording.",
      repair: "Use an exact, reviewable phrase from the supplied transcript evidence and place that same phrase in the quote body.",
    },
    QUOTE_EVIDENCE_MISMATCH: {
      critique: "The proposed pastor quote could not be matched to the stored transcript segments.",
      repair: "Restore the exact contiguous transcript wording; use a controlled ellipsis only when every retained phrase occurs in order.",
    },
    SCRIPTURE_EVIDENCE_INVALID: {
      critique: "The Scripture reference is absent from grounded sermon metadata or is not a valid canonical reference.",
      repair: "Use only a Scripture reference explicitly supplied in the grounded sermon context, or omit it when no verified reference is available.",
    },
  };
  const detail = details[reasonCode] ?? {
    critique: "The candidate did not pass deterministic curation.",
    repair: "Return a distinct, complete, source-grounded candidate.",
  };
  return {
    opportunityType,
    reasonCode,
    critique: [detail.critique],
    repairInstructions: [detail.repair],
  };
}

function editorialRepairFeedback(
  opportunityType: PrismaContentOpportunityType,
  reasonCode: "DUPLICATE" | "EDITORIAL_BLOCKER" | "EDITORIAL_QUALITY_LOW",
  assessment: EditorialQualityAssessment,
): OpportunityRepairFeedback {
  return {
    opportunityType,
    reasonCode,
    critique: [
      `Deterministic editorial score: ${assessment.overallScore}/100.`,
      ...assessment.findings.map((finding) => `[${finding.code}] ${finding.message}`),
    ],
    repairInstructions: assessment.repairInstructions.length > 0
      ? assessment.repairInstructions
      : ["Use a materially different grounded hook and complete every required content-family field."],
  };
}

function curateGeneratedOpportunityBatch(
  generated: ContentOpportunityRecord[],
  requestedQuantities: Partial<Record<PrismaContentOpportunityType, number>>,
  options: {
    context: OpportunitySourceContext;
    dedupeAgainst?: OpportunityDedupeRecord[];
    now?: Date;
    voiceProfile?: MinistryVoiceProfile;
  },
): OpportunityCurationResult {
  const counters = emptyOpportunityQuantities();
  const selected: CuratedGeneratedOpportunity[] = [];
  const rejectionCounts: OpportunityCurationResult["rejectionCounts"] = {};
  const dedupeRecords: OpportunityDedupeRecord[] = [...(options.dedupeAgainst ?? [])];
  const acceptedEditorialItems = buildAcceptedEditorialItems(dedupeRecords);
  const repairFeedback: OpportunityRepairFeedback[] = [];
  const now = options.now ?? new Date();
  const voiceProfile = options.voiceProfile ?? deriveGenerationVoiceProfile(options.context);

  for (const item of generated) {
    const type = item.opportunityType as PrismaContentOpportunityType;
    const requestedCount = requestedQuantities[type] ?? 0;
    if (requestedCount === 0 || counters[type] >= requestedCount) continue;

    const enrichment = enrichGeneratedOpportunity(item, options.context, now);
    if (!enrichment.opportunity || enrichment.rejectionReason) {
      const rejectionReason = enrichment.rejectionReason ?? "QUOTE_EVIDENCE_MISSING";
      incrementCurationRejection(
        rejectionCounts,
        type,
        rejectionReason,
      );
      repairFeedback.push(evidenceRepairFeedback(type, rejectionReason));
      continue;
    }

    const assessment = assessContentEditorialQuality({
      contract: enrichment.opportunity.editorialContract,
      voiceProfile,
      acceptedBatch: acceptedEditorialItems,
    });
    if (assessment.repetition.matches.length > 0) {
      incrementCurationRejection(rejectionCounts, type, "DUPLICATE");
      repairFeedback.push(editorialRepairFeedback(type, "DUPLICATE", assessment));
      continue;
    }
    if (assessment.blockers.length > 0) {
      incrementCurationRejection(rejectionCounts, type, "EDITORIAL_BLOCKER");
      repairFeedback.push(editorialRepairFeedback(type, "EDITORIAL_BLOCKER", assessment));
      continue;
    }
    if (assessment.overallScore < EDITORIAL_QUALITY_THRESHOLDS.highPriorityReview) {
      incrementCurationRejection(rejectionCounts, type, "EDITORIAL_QUALITY_LOW");
      repairFeedback.push(editorialRepairFeedback(type, "EDITORIAL_QUALITY_LOW", assessment));
      continue;
    }

    counters[type] += 1;
    selected.push(enrichment.opportunity);
    const acceptedId = `candidate-${selected.length}`;
    dedupeRecords.push({
      id: acceptedId,
      opportunityType: type,
      title: enrichment.opportunity.title,
      bodyContent: enrichment.opportunity.bodyContent,
      contract: enrichment.opportunity.editorialContract,
    });
    acceptedEditorialItems.push({
      id: acceptedId,
      contract: enrichment.opportunity.editorialContract,
    });
  }

  return { opportunities: selected, rejectionCounts, repairFeedback };
}

function curateGeneratedOpportunities(
  generated: ContentOpportunityRecord[],
  requestedQuantities: Partial<Record<PrismaContentOpportunityType, number>>,
  options?: Parameters<typeof curateGeneratedOpportunityBatch>[2],
): CuratedGeneratedOpportunity[] {
  if (options) {
    return curateGeneratedOpportunityBatch(generated, requestedQuantities, options).opportunities;
  }

  // Backwards-compatible utility path for schema-focused tests. Production
  // generation always uses curateGeneratedOpportunityBatch with real context.
  const counters = emptyOpportunityQuantities();
  const selected: CuratedGeneratedOpportunity[] = [];
  for (const item of generated) {
    const type = item.opportunityType as PrismaContentOpportunityType;
    if ((requestedQuantities[type] ?? 0) <= counters[type]) continue;
    const legacyContract = convertLegacyBodyContent({
      opportunityType: type,
      title: item.title,
      bodyContent: item.bodyContent,
      sourceTranscriptExcerpt: item.sourceTranscriptExcerpt,
      relatedScripture: item.relatedScripture,
      relatedMinistryMomentTitle: item.relatedMinistryMomentTitle,
      relatedClipTitle: item.relatedClipTitle,
      suggestedPlatform: item.suggestedPlatform,
    }).contract;
    const candidate: CuratedGeneratedOpportunity = {
      ...item,
      category: TYPE_TO_CATEGORY[type],
      structuredContentJson: legacyContract as unknown as Prisma.InputJsonValue,
      editorialContract: buildEditorialAssessmentContract(type, legacyContract),
      sourceTranscriptSegmentIds: null,
      sourceStartTimeSeconds: null,
      sourceEndTimeSeconds: null,
      scriptureTranslation: null,
      scriptureVerifiedAt: null,
      translationReviewState: "NOT_REQUIRED",
    };
    if (selected.some((existing) => areNearDuplicateOpportunities(candidate, existing))) continue;
    if (type === "QUOTE_GRAPHIC" && !item.sourceTranscriptExcerpt?.trim()) continue;
    counters[type] += 1;
    selected.push(candidate);
  }
  return selected;
}

function findMinistryMomentId(
  title: string | null | undefined,
  moments: OpportunitySourceContext["ministryMoments"],
): string | null {
  const normalized = title?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const exact = moments.find((item) => item.title.trim().toLowerCase() === normalized);
  if (exact) {
    return exact.id;
  }

  const partial = moments.find((item) => normalized.includes(item.title.trim().toLowerCase()));
  return partial?.id ?? null;
}

function findRelatedClipId(
  title: string | null | undefined,
  clips: OpportunitySourceContext["smartClips"],
): string | null {
  const normalized = title?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const exact = clips.find((item) => item.title.trim().toLowerCase() === normalized);
  if (exact) {
    return exact.id;
  }

  const partial = clips.find((item) => normalized.includes(item.title.trim().toLowerCase()));
  return partial?.id ?? null;
}

function buildArchiveWhere(
  sermonId: string,
  targetType?: PrismaContentOpportunityType,
  requestedTypes?: PrismaContentOpportunityType[],
): Prisma.ContentOpportunityWhereInput {
  return {
    sermonId,
    isAiGenerated: true,
    isManuallyCreated: false,
    status: {
      in: ["DRAFT", "NEEDS_REVIEW", "REJECTED"],
    },
    approvedContent: null,
    editedContent: null,
    isManuallyEdited: false,
    ...(targetType
      ? { opportunityType: targetType }
      : requestedTypes && requestedTypes.length > 0
        ? { opportunityType: { in: requestedTypes } }
        : {}),
  };
}

function mergeCurationRejectionCounts(
  target: OpportunityCurationResult["rejectionCounts"],
  source: OpportunityCurationResult["rejectionCounts"],
): void {
  for (const [rawType, reasons] of Object.entries(source)) {
    const type = rawType as PrismaContentOpportunityType;
    for (const [rawReason, count] of Object.entries(reasons ?? {})) {
      const reason = rawReason as OpportunityCurationRejectionReason;
      const targetReasons = target[type] ?? {};
      targetReasons[reason] = (targetReasons[reason] ?? 0) + (count ?? 0);
      target[type] = targetReasons;
    }
  }
}

function buildGenerationShortfalls(
  requestedQuantities: Partial<Record<PrismaContentOpportunityType, number>>,
  fulfilledQuantities: Partial<Record<PrismaContentOpportunityType, number>>,
  rejectionCounts: OpportunityCurationResult["rejectionCounts"],
  repairFailedTypes: Set<PrismaContentOpportunityType>,
): OpportunityGenerationShortfall[] {
  const missing = computeMissingQuantities(requestedQuantities, fulfilledQuantities);
  return (Object.keys(missing) as PrismaContentOpportunityType[])
    .filter((type) => missing[type] > 0)
    .map((type) => {
      const rejectionReasons = Object.entries(rejectionCounts[type] ?? {})
        .filter((entry): entry is [OpportunityCurationRejectionReason, number] => (entry[1] ?? 0) > 0)
        .map(([code, count]) => ({ code, count }));
      return {
        opportunityType: type,
        requested: requestedQuantities[type] ?? 0,
        fulfilled: fulfilledQuantities[type] ?? 0,
        missing: missing[type],
        reasons: [
          ...rejectionReasons,
          ...(repairFailedTypes.has(type)
            ? [{ code: "REPAIR_FAILED" as const, count: missing[type] }]
            : []),
          { code: "MODEL_OUTPUT_SHORTFALL" as const, count: missing[type] },
        ],
      };
    });
}

async function loadContext(sermonId: string): Promise<OpportunitySourceContext | null> {
  const [sermon, branding] = await Promise.all([
    prisma.sermon.findUnique({
      where: { id: sermonId },
      select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sermonDate: true,
      transcript: {
        select: { id: true, fullText: true },
      },
      transcriptSegments: {
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
        },
        orderBy: { startTimeSeconds: "asc" },
      },
      intelligence: {
        select: {
          generatedTitle: true,
          summary: true,
          centralTheme: true,
          shortOverview: true,
          keyTakeaways: true,
          isManuallyReviewed: true,
          manualTitle: true,
          manualSummary: true,
          manualCentralTheme: true,
        },
      },
      scriptureRefs: {
        select: {
          reference: true,
          usageType: true,
          isPrimary: true,
          transcriptEvidence: true,
          isManuallyAdded: true,
        },
      },
      topicTags: {
        select: {
          topic: true,
          confidenceScore: true,
          evidence: true,
          isManuallyAdded: true,
        },
        orderBy: { confidenceScore: "desc" },
      },
      structureSections: {
        select: {
          sectionType: true,
          title: true,
          description: true,
        },
        orderBy: { orderIndex: "asc" },
      },
      ministryMoments: {
        select: {
          id: true,
          momentType: true,
          title: true,
          description: true,
          transcriptExcerpt: true,
          suggestedAudience: true,
          suggestedUsage: true,
          reviewStatus: true,
        },
        orderBy: { confidenceScore: "desc" },
      },
      clipCandidates: {
        where: {
          status: { in: ["SUGGESTED", "APPROVED", "EXPORTED"] },
        },
        select: {
          id: true,
          title: true,
          smartClipCategory: true,
          transcriptText: true,
        },
        orderBy: { score: "desc" },
        take: 25,
      },
      },
    }),
    prisma.brandingSettings.findUnique({
      where: { id: "local" },
      select: {
        churchName: true,
        primaryBrandColor: true,
        secondaryBrandColor: true,
        defaultFontFamily: true,
        defaultCaptionStyleName: true,
      },
    }),
  ]);

  if (!sermon) {
    return null;
  }

  const transcriptFullText = sermon.transcript?.fullText?.trim()
    ? sermon.transcript.fullText
    : sermon.transcriptSegments.map((segment) => segment.text).join(" ");

  return {
    id: sermon.id,
    title: sermon.title,
    speakerName: sermon.speakerName,
    churchName: sermon.churchName,
    language: sermon.language,
    sermonDate: sermon.sermonDate,
    branding,
    transcriptId: sermon.transcript?.id ?? null,
    transcriptFullText,
    transcriptSegments: sermon.transcriptSegments,
    intelligence: sermon.intelligence,
    scriptures: sermon.scriptureRefs,
    topics: sermon.topicTags,
    structureSections: sermon.structureSections,
    ministryMoments: sermon.ministryMoments,
    smartClips: sermon.clipCandidates,
  };
}

export async function generateContentOpportunities(
  sermonId: string,
  options?: OpportunityGenerationOptions,
): Promise<OpportunityGenerationResult> {
  const context = await loadContext(sermonId);
  if (!context) {
    throw new Error(`Sermon ${sermonId} not found.`);
  }

  if (!context.transcriptFullText.trim()) {
    throw new Error("Transcript is required before generating content opportunities.");
  }
  await options?.onProgress?.({ phase: "CHECKING_EXISTING", percent: 20 });

  const requestedQuantities = buildRequestedQuantities(options);
  const requestedTypes = (Object.entries(requestedQuantities) as Array<[PrismaContentOpportunityType, number]>)
    .filter(([, quantity]) => quantity > 0)
    .map(([type]) => type);
  const requestedTypeSet = new Set(requestedTypes);
  const activeExistingOpportunities = await prisma.contentOpportunity.findMany({
    where: {
      sermonId,
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      opportunityType: true,
      title: true,
      bodyContent: true,
      structuredContentJson: true,
      sourceTranscriptExcerpt: true,
      relatedScripture: true,
      suggestedPlatform: true,
      status: true,
      isAiGenerated: true,
      isManuallyEdited: true,
      isManuallyCreated: true,
      editedContent: true,
      approvedContent: true,
    },
  });
  const existingCount = activeExistingOpportunities.length;
  const existingCounts = countOpportunityTypes(activeExistingOpportunities);
  const generationRequestedQuantities = options?.force
    ? requestedQuantities
    : computeMissingQuantities(requestedQuantities, existingCounts);
  await options?.onProgress?.({ phase: "CHECKING_EXISTING", percent: 30 });

  if (
    shouldReuseExistingOpportunities(existingCount, options?.force)
    && !hasRequestedQuantities(generationRequestedQuantities)
  ) {
    await options?.onProgress?.({ phase: "PERSISTING", percent: 90 });
    const result: OpportunityGenerationResult = {
      opportunityCount: existingCount,
      archivedCount: 0,
      reusedExistingOpportunities: true,
      complete: true,
      repairPasses: 0,
      requestedQuantities,
      generatedQuantities: emptyOpportunityQuantities(),
      shortfalls: [],
    };
    if (options?.processingJob) {
      const completedSummary = completeContentOpportunityJobSummary(
        options.processingJob.summary,
        result,
      );
      const updated = await prisma.processingJob.updateMany({
        where: {
          id: options.processingJob.id,
          sermonId,
          type: "GENERATE_CONTENT_OPPORTUNITIES",
          status: "RUNNING",
        },
        data: {
          generationSummary: completedSummary as unknown as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) {
        throw new Error("The content generation job is no longer active.");
      }
    }
    return result;
  }

  const potentialArchiveIds = options?.force
    ? activeExistingOpportunities
        .filter((opportunity) => (
          requestedTypeSet.has(opportunity.opportunityType)
          && opportunity.isAiGenerated
          && !shouldPreserveOpportunityDuringRegeneration(opportunity)
        ))
        .map((opportunity) => opportunity.id)
    : [];
  const potentialArchiveIdSet = new Set(potentialArchiveIds);
  const dedupeBaseline: OpportunityDedupeRecord[] = activeExistingOpportunities
    .filter((opportunity) => !potentialArchiveIdSet.has(opportunity.id))
    .map((opportunity) => {
      const resolved = resolveContentOpportunityContract({
        opportunityType: opportunity.opportunityType as ContentOpportunityType,
        title: opportunity.title,
        bodyContent: opportunity.bodyContent,
        structuredContent: opportunity.structuredContentJson,
        sourceTranscriptExcerpt: opportunity.sourceTranscriptExcerpt,
        relatedScripture: opportunity.relatedScripture,
        relatedMinistryMomentTitle: null,
        relatedClipTitle: null,
        suggestedPlatform: opportunity.suggestedPlatform,
      });
      return {
        id: opportunity.id,
        opportunityType: opportunity.opportunityType,
        title: opportunity.title,
        bodyContent: opportunity.bodyContent,
        contract: buildEditorialAssessmentContract(opportunity.opportunityType, resolved.contract),
      };
    });

  const curated: CuratedGeneratedOpportunity[] = [];
  const rejectionCounts: OpportunityCurationResult["rejectionCounts"] = {};
  const repairFailedTypes = new Set<PrismaContentOpportunityType>();
  const voiceProfile = deriveGenerationVoiceProfile(context);
  const generationBatches = buildFamilyCoherentGenerationBatches(generationRequestedQuantities);
  let repairPasses = 0;
  let repairPhaseStarted = false;

  for (const [batchIndex, familyBatch] of generationBatches.entries()) {
    const acceptedForBatch: CuratedGeneratedOpportunity[] = [];
    let batchRemaining = { ...familyBatch.quantities };
    let repairFeedback: OpportunityRepairFeedback[] = [];

    for (let attempt = 0; attempt <= MAX_GENERATION_REPAIR_PASSES; attempt += 1) {
      if (!hasRequestedQuantities(batchRemaining)) break;
      if (attempt > 0) {
        repairPasses = Math.max(repairPasses, attempt);
        repairPhaseStarted = true;
      }
      const progressFraction = generationBatches.length > 0
        ? (batchIndex + attempt / (MAX_GENERATION_REPAIR_PASSES + 1)) / generationBatches.length
        : 0;
      await options?.onProgress?.({
        phase: repairPhaseStarted ? "REPAIRING" : "GENERATING",
        percent: Math.min(80, 36 + Math.floor(progressFraction * 44)),
      });

      const curatedDedupeRecords: OpportunityDedupeRecord[] = curated.map((opportunity, index) => ({
        id: `generated-${index + 1}`,
        opportunityType: opportunity.opportunityType,
        title: opportunity.title,
        bodyContent: opportunity.bodyContent,
        contract: opportunity.editorialContract,
      }));
      const dedupeAgainst = [...dedupeBaseline, ...curatedDedupeRecords];

      let generated: ContentOpportunityRecord[];
      try {
        generated = await callOpportunityModel(context, batchRemaining, {
          bypassCache: Boolean(options?.force || attempt > 0),
          repairAttempt: attempt,
          avoidDuplicates: dedupeAgainst,
          repairFeedback,
          voiceProfile,
        });
      } catch (error) {
        const outputQualityError = isModelOutputQualityError(error);
        if (attempt === 0 && !outputQualityError) throw error;
        for (const type of Object.keys(batchRemaining) as PrismaContentOpportunityType[]) {
          if (batchRemaining[type] > 0) repairFailedTypes.add(type);
        }
        await appendPipelineLog(
          sermonId,
          `Content opportunity ${familyBatch.family} batch quality repair ${attempt} failed: ${formatContentGenerationError(error)}`,
        );
        if (!outputQualityError || attempt >= MAX_GENERATION_REPAIR_PASSES) break;
        continue;
      }

      const batch = curateGeneratedOpportunityBatch(generated, batchRemaining, {
        context,
        dedupeAgainst,
        voiceProfile,
      });
      curated.push(...batch.opportunities);
      acceptedForBatch.push(...batch.opportunities);
      mergeCurationRejectionCounts(rejectionCounts, batch.rejectionCounts);
      repairFeedback = batch.repairFeedback;
      batchRemaining = computeMissingQuantities(
        familyBatch.quantities,
        countOpportunityTypes(acceptedForBatch),
      );
    }
  }

  await options?.onProgress?.({ phase: "PERSISTING", percent: 90 });

  const generatedCounts = countOpportunityTypes(curated);
  const quotaFulfilledCounts = emptyOpportunityQuantities();
  for (const type of Object.keys(quotaFulfilledCounts) as PrismaContentOpportunityType[]) {
    quotaFulfilledCounts[type] = options?.force
      ? generatedCounts[type]
      : existingCounts[type] + generatedCounts[type];
  }
  const shortfalls = buildGenerationShortfalls(
    requestedQuantities,
    quotaFulfilledCounts,
    rejectionCounts,
    repairFailedTypes,
  );
  const complete = shortfalls.length === 0;
  const result: OpportunityGenerationResult = {
    opportunityCount: curated.length,
    archivedCount: 0,
    reusedExistingOpportunities: false,
    complete,
    repairPasses,
    requestedQuantities,
    generatedQuantities: generatedCounts,
    shortfalls,
  };

  // If a type produced no valid replacement, keep its previous drafts instead
  // of deleting useful work while reporting a shortfall.
  const archiveIds = potentialArchiveIds.filter((id) => {
    const opportunity = activeExistingOpportunities.find((item) => item.id === id);
    return opportunity ? generatedCounts[opportunity.opportunityType] > 0 : false;
  });
  result.archivedCount = archiveIds.length;

  if (curated.length > 0 || options?.processingJob) {
    await prisma.$transaction(async (tx) => {
      if (archiveIds.length > 0) {
        await tx.contentOpportunity.updateMany({
          where: { id: { in: archiveIds } },
          data: { status: "ARCHIVED" },
        });
      }

      if (curated.length > 0) {
        await tx.contentOpportunity.createMany({
          data: curated.map((item) => {
          const languageSummary = buildLanguageHintSummary(item);
          return {
            sermonId,
            churchName: context.churchName,
            category: item.category,
            opportunityType: item.opportunityType,
            title: item.title,
            bodyContent: item.bodyContent,
            structuredContentJson: item.structuredContentJson,
            shortDescription: item.shortDescription,
            sourceTranscriptExcerpt: item.sourceTranscriptExcerpt,
            ...(item.sourceTranscriptSegmentIds
              ? { sourceTranscriptSegmentIds: item.sourceTranscriptSegmentIds }
              : {}),
            sourceStartTimeSeconds: item.sourceStartTimeSeconds,
            sourceEndTimeSeconds: item.sourceEndTimeSeconds,
            relatedScripture: item.relatedScripture ?? null,
            scriptureTranslation: item.scriptureTranslation,
            scriptureVerifiedAt: item.scriptureVerifiedAt,
            translationReviewState: item.translationReviewState,
            ministryMomentId: findMinistryMomentId(item.relatedMinistryMomentTitle, context.ministryMoments),
            relatedClipId: findRelatedClipId(item.relatedClipTitle, context.smartClips),
            suggestedPlatform: item.suggestedPlatform ?? null,
            confidenceScore: item.confidenceScore,
            aiReason: languageSummary ? `${item.aiReason} ${languageSummary}` : item.aiReason,
            status: "NEEDS_REVIEW",
            isAiGenerated: true,
            isManuallyCreated: false,
            isManuallyEdited: false,
          };
          }),
        });
      }

      if (options?.processingJob) {
        const completedSummary = completeContentOpportunityJobSummary(
          options.processingJob.summary,
          result,
        );
        const updated = await tx.processingJob.updateMany({
          where: {
            id: options.processingJob.id,
            sermonId,
            type: "GENERATE_CONTENT_OPPORTUNITIES",
            status: "RUNNING",
          },
          data: {
            generationSummary: completedSummary as unknown as Prisma.InputJsonObject,
          },
        });
        if (updated.count !== 1) {
          throw new Error("The content generation job is no longer active.");
        }
      }
    });
  }

  await appendPipelineLog(
    sermonId,
    complete
      ? `Generated ${curated.length} validated content opportunities${options?.targetType ? ` for ${options.targetType}` : ""}.`
      : `Generated ${curated.length} validated content opportunities with ${shortfalls.reduce((sum, item) => sum + item.missing, 0)} explicit shortfall(s) after ${repairPasses} repair pass(es).`,
  );

  return result;
}

export async function regenerateContentOpportunities(
  sermonId: string,
  options?: Omit<OpportunityGenerationOptions, "force">,
): Promise<OpportunityGenerationResult> {
  return generateContentOpportunities(sermonId, {
    ...options,
    force: true,
  });
}

export const __contentMultiplicationTestUtils = {
  TYPE_TO_CATEGORY,
  canonicalizeOpportunityType,
  parseGeneratedOpportunityPayload,
  buildGroundingEvidence,
  buildUserPrompt,
  deriveGenerationVoiceProfile,
  buildRequestedQuantities,
  buildFamilyCoherentGenerationBatches,
  requestedContentFamily,
  curateGeneratedOpportunities,
  curateGeneratedOpportunityBatch,
  computeMissingQuantities,
  countOpportunityTypes,
  areNearDuplicateOpportunities,
  locateTranscriptEvidence,
  buildGenerationShortfalls,
  shouldReuseExistingOpportunities,
  shouldPreserveOpportunityDuringRegeneration,
  buildArchiveWhere,
};

export function formatContentGenerationError(error: unknown): string {
  if (error instanceof ZodError) {
    return `AI output failed validation: ${error.issues.map((issue) => issue.message).join("; ")}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown content opportunity generation error.";
}
