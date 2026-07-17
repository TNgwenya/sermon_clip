import type { ContentOpportunityType as PrismaContentOpportunityType, Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { appendPipelineLog } from "@/server/agents/storage";
import {
  CONTENT_OPPORTUNITY_JSON_SHAPE,
  CONTENT_OPPORTUNITY_TYPE_LABELS,
  DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES,
  contentOpportunityResponseSchema,
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
};

type OpportunitySourceContext = SermonContext & {
  transcriptFullText: string;
  intelligence: IntelligenceContext | null;
  scriptures: Array<{ reference: string; usageType: string; isPrimary: boolean }>;
  topics: Array<{ topic: string; confidenceScore: number }>;
  structureSections: Array<{ sectionType: string; title: string | null; description: string | null }>;
  ministryMoments: Array<{
    id: string;
    momentType: string;
    title: string;
    description: string;
    transcriptExcerpt: string | null;
    suggestedAudience: string | null;
    suggestedUsage: string | null;
  }>;
  smartClips: Array<{ id: string; title: string; smartClipCategory: string | null; transcriptText: string }>;
};

export type OpportunityGenerationOptions = {
  force?: boolean;
  targetType?: PrismaContentOpportunityType;
  quantities?: Partial<Record<PrismaContentOpportunityType, number>>;
  replaceDefaultQuantities?: boolean;
};

export type OpportunityGenerationResult = {
  opportunityCount: number;
  archivedCount: number;
  reusedExistingOpportunities: boolean;
};

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
    "Confidence scores must be between 0.0 and 1.0.",
    "Return structured JSON only. Do not include markdown or text outside JSON.",
    "Exact JSON shape required:",
    CONTENT_OPPORTUNITY_JSON_SHAPE,
  ].join("\n");
}

function buildUserPrompt(
  context: OpportunitySourceContext,
  requestedQuantities: Record<PrismaContentOpportunityType, number>,
): string {
  const requestedLines = (Object.keys(requestedQuantities) as PrismaContentOpportunityType[])
    .filter((type) => requestedQuantities[type] > 0)
    .map((type) => `${CONTENT_OPPORTUNITY_TYPE_LABELS[type as ContentOpportunityType]}: ${requestedQuantities[type]}`);

  const keyTakeaways = Array.isArray(context.intelligence?.keyTakeaways)
    ? context.intelligence?.keyTakeaways.filter((item): item is string => typeof item === "string")
    : [];
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
    "",
    "Sermon intelligence context:",
    `Generated title: ${context.intelligence?.generatedTitle ?? context.title}`,
    `Summary: ${context.intelligence?.summary ?? ""}`,
    `Central theme: ${context.intelligence?.centralTheme ?? ""}`,
    `Short overview: ${context.intelligence?.shortOverview ?? ""}`,
    `Key takeaways: ${keyTakeaways.join(" | ")}`,
    "",
    `Scriptures: ${context.scriptures.map((item) => item.reference).join(", ")}`,
    `Topics: ${context.topics.map((item) => item.topic).join(", ")}`,
    `Structure: ${context.structureSections.map((item) => item.sectionType).join(", ")}`,
    "",
    "Detected ministry moments:",
    context.ministryMoments.length > 0
      ? context.ministryMoments
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
  ].filter(Boolean);

  return sections.join("\n");
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildGroundingEvidence(context: OpportunitySourceContext): string {
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
  options?: { bypassCache?: boolean },
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
      { role: "user", content: buildUserPrompt(context, requestedQuantities) },
    ],
    promptVersion: "content-opportunities-v3-grounded-excerpts",
    metadata: {
      requestedQuantities,
      sourceTranscriptCharacters: context.transcriptFullText.length,
      promptEvidenceCharacters: buildGroundingEvidence(context).length,
      language: context.language,
    },
    missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before generating content opportunities.",
    bypassCache: options?.bypassCache,
    validateResponse: (completion) => {
      const raw = completion.choices[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`AI returned invalid JSON: ${raw.slice(0, 200)}`);
      }
      return contentOpportunityResponseSchema.parse(parsed).opportunities;
    },
  });
}

function curateGeneratedOpportunities(
  generated: ContentOpportunityRecord[],
  requestedQuantities: Partial<Record<PrismaContentOpportunityType, number>>,
): ContentOpportunityRecord[] {
  const counters: Record<PrismaContentOpportunityType, number> = Object.keys(DEFAULT_CONTENT_OPPORTUNITY_QUANTITIES)
    .reduce((acc, key) => {
      acc[key as PrismaContentOpportunityType] = 0;
      return acc;
    }, {} as Record<PrismaContentOpportunityType, number>);

  const dedupe = new Set<string>();
  const selected: ContentOpportunityRecord[] = [];

  for (const item of generated) {
    const type = item.opportunityType as PrismaContentOpportunityType;
    const requestedCount = requestedQuantities[type] ?? 0;
    if (requestedCount === 0) {
      continue;
    }

    if (type === "QUOTE_GRAPHIC" && !item.sourceTranscriptExcerpt?.trim()) {
      continue;
    }

    const dedupeKey = `${type}:${item.title.toLowerCase().trim()}:${item.shortDescription.toLowerCase().trim()}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    if (counters[type] >= requestedCount) {
      continue;
    }

    dedupe.add(dedupeKey);
    counters[type] += 1;
    selected.push({
      ...item,
      category: TYPE_TO_CATEGORY[type],
    });
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

async function loadContext(sermonId: string): Promise<OpportunitySourceContext | null> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sermonDate: true,
      transcript: {
        select: { fullText: true },
      },
      transcriptSegments: {
        select: { text: true },
        orderBy: { startTimeSeconds: "asc" },
      },
      intelligence: {
        select: {
          generatedTitle: true,
          summary: true,
          centralTheme: true,
          shortOverview: true,
          keyTakeaways: true,
        },
      },
      scriptureRefs: {
        select: {
          reference: true,
          usageType: true,
          isPrimary: true,
        },
      },
      topicTags: {
        select: {
          topic: true,
          confidenceScore: true,
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
  });

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
    transcriptFullText,
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

  const existingCount = await prisma.contentOpportunity.count({
    where: {
      sermonId,
      status: { not: "ARCHIVED" },
      ...(options?.targetType ? { opportunityType: options.targetType } : {}),
    },
  });

  if (shouldReuseExistingOpportunities(existingCount, options?.force)) {
    return {
      opportunityCount: existingCount,
      archivedCount: 0,
      reusedExistingOpportunities: true,
    };
  }

  const requestedQuantities = buildRequestedQuantities(options);
  const generated = await callOpportunityModel(context, requestedQuantities, {
    bypassCache: options?.force,
  });
  const curated = curateGeneratedOpportunities(generated, requestedQuantities);

  if (curated.length === 0) {
    await appendPipelineLog(sermonId, "Content opportunity generation returned no valid records.");
    return {
      opportunityCount: 0,
      archivedCount: 0,
      reusedExistingOpportunities: false,
    };
  }

  const requestedTypes = (Object.entries(requestedQuantities) as Array<[PrismaContentOpportunityType, number]>)
    .filter(([, quantity]) => quantity > 0)
    .map(([type]) => type);
  const opportunitiesToArchive = await prisma.contentOpportunity.findMany({
    where: buildArchiveWhere(sermonId, options?.targetType, requestedTypes),
    select: {
      id: true,
      status: true,
      isManuallyEdited: true,
      isManuallyCreated: true,
      editedContent: true,
      approvedContent: true,
    },
  });

  const archiveIds = opportunitiesToArchive
    .filter((opportunity) => !shouldPreserveOpportunityDuringRegeneration(opportunity))
    .map((opportunity) => opportunity.id);

  await prisma.$transaction(async (tx) => {
    if (archiveIds.length > 0) {
      await tx.contentOpportunity.updateMany({
        where: { id: { in: archiveIds } },
        data: { status: "ARCHIVED" },
      });
    }

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
          shortDescription: item.shortDescription,
          sourceTranscriptExcerpt: item.sourceTranscriptExcerpt ?? null,
          relatedScripture: item.relatedScripture ?? null,
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
  });

  await appendPipelineLog(
    sermonId,
    `Generated ${curated.length} content opportunities${options?.targetType ? ` for ${options.targetType}` : ""}.`,
  );

  return {
    opportunityCount: curated.length,
    archivedCount: archiveIds.length,
    reusedExistingOpportunities: false,
  };
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
  buildGroundingEvidence,
  buildUserPrompt,
  buildRequestedQuantities,
  curateGeneratedOpportunities,
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
