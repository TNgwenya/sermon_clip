import { prisma } from "@/lib/prisma";
import {
  MINISTRY_MOMENT_JSON_SHAPE,
  MINISTRY_MOMENT_TYPES,
  SMART_CLIP_CATEGORIES,
  ministryMomentResponseSchema,
  type MinistryMomentRecord,
} from "@/server/ai/ministryMomentSchema";
import { getOpenAiClient } from "@/server/ai/openaiClient";
import { appendPipelineLog } from "@/server/agents/storage";
import {
  applyInferredSermonWindowToSegments,
  inferSermonWindowFromTranscript,
} from "@/server/agents/sermonWindowInference";

export type MinistryMomentOptions = {
  force?: boolean;
};

export type MinistryMomentResult = {
  momentCount: number;
  reusedExistingMoments: boolean;
};

type SermonContext = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
  sermonDate: Date | null;
};

type IntelligenceContext = {
  title: string | null;
  summary: string | null;
  centralTheme: string | null;
  shortOverview: string | null;
  keyTakeaways: unknown;
};

type SermonContextPayload = SermonContext & {
  transcriptFullText: string;
  intelligence: IntelligenceContext | null;
  scriptures: Array<{ reference: string; usageType: string; isPrimary: boolean }>;
  structureSections: Array<{ sectionType: string; title: string | null; description: string | null }>;
  topicTags: Array<{ topic: string }>;
  segments: Array<{ startTimeSeconds: number; endTimeSeconds: number; text: string }>;
};

type MinistryMomentCreateInput = {
  sermonId: string;
  momentType: MinistryMomentRecord["momentType"];
  title: string;
  description: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  confidenceScore: number;
  transcriptExcerpt: string;
  whyDetected: string;
  suggestedAudience: string;
  suggestedUsage: string;
  clipCategory: string | null;
  reviewStatus: "PENDING";
  isAiGenerated: true;
  isManuallyAdjusted: false;
};

const MOMENT_TYPE_ALIASES: Record<string, MinistryMomentRecord["momentType"]> = {
  APPLICATION_MOMENT: "CALL_TO_ACTION",
  BEST_APPLICATION_MOMENT: "CALL_TO_ACTION",
  SCRIPTURE_EXPLANATION: "OTHER",
  SCRIPTURE_EXPLANATION_MOMENT: "OTHER",
  QUOTE_WORTHY_MOMENT: "OTHER",
  QUOTE_MOMENT: "OTHER",
  STEWARDSHIP_MOMENT: "GIVING_STEWARDSHIP_MOMENT",
  GIVING_MOMENT: "GIVING_STEWARDSHIP_MOMENT",
  SUNDAY_PROMOTION_MOMENT: "SUNDAY_INVITATION_PROMOTION_MOMENT",
};

const CLIP_CATEGORY_ALIASES: Record<string, (typeof SMART_CLIP_CATEGORIES)[number]> = {
  "Best Application Clip": "Best Call To Action Clip",
  "Best Stewardship Clip": "Best Faith Clip",
  "Best Giving Clip": "Best Faith Clip",
  "Best Worship Clip": "Best Faith Clip",
  "Best Prophetic Clip": "Best Faith Clip",
  "Best Healing Clip": "Best Encouragement Clip",
  "Best Church Vision Clip": "Best Leadership Clip",
};

function normalizeEnumKey(value: string): string {
  return value.trim().replace(/[\s-]+/g, "_").replace(/[^A-Za-z0-9_]/g, "").toUpperCase();
}

function normalizeMomentType(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const direct = MINISTRY_MOMENT_TYPES.find((type) => type === value);
  if (direct) {
    return direct;
  }

  return MOMENT_TYPE_ALIASES[normalizeEnumKey(value)] ?? "OTHER";
}

function normalizeClipCategory(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== "string") {
    return value;
  }

  const direct = SMART_CLIP_CATEGORIES.find((category) => category === value);
  if (direct) {
    return direct;
  }

  return CLIP_CATEGORY_ALIASES[value.trim()] ?? null;
}

function normalizeMinistryMomentResponsePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || !("moments" in payload)) {
    return payload;
  }

  const moments = (payload as { moments?: unknown }).moments;
  if (!Array.isArray(moments)) {
    return payload;
  }

  return {
    ...payload,
    moments: moments.map((moment) => {
      if (!moment || typeof moment !== "object") {
        return moment;
      }

      return {
        ...moment,
        momentType: normalizeMomentType((moment as { momentType?: unknown }).momentType),
        clipCategory: normalizeClipCategory((moment as { clipCategory?: unknown }).clipCategory),
      };
    }),
  };
}

function buildSystemPrompt(): string {
  return [
    "You are a church media analyst detecting ministry moments in sermons.",
    "Use only evidence from the transcript and sermon intelligence context.",
    "Do not invent moments, timestamps, or scripture references that are not present.",
    "Handle multilingual sermons (including Zulu, Sotho, Xhosa, Tswana, and mixed English/local-language phrases) without forcing uncertain translations.",
    "If confidence is low, explicitly reflect uncertainty in whyDetected instead of guessing.",
    "Detect prayer, altar call, salvation invitation, scripture explanation, quote-worthy statement, prophetic, faith declaration, encouragement, testimony, call to action, discipleship, leadership, family/marriage, healing, worship, giving/stewardship, church vision, and Sunday invitation/promotion moments.",
    "When a scripture explanation or quote-worthy moment does not fit the available momentType enum, use OTHER and make the specific category clear in title, description, suggestedUsage, and clipCategory.",
    "Use transcript timestamps when available. If an exact timestamp is unclear, set the timestamp field to null rather than guessing.",
    "Confidence scores must be between 0.0 and 1.0.",
    "Return structured JSON only. Do not include markdown or commentary.",
    "Exact JSON shape required:",
    MINISTRY_MOMENT_JSON_SHAPE,
  ].join("\n");
}

function buildUserPrompt(context: SermonContextPayload): string {
  const lines: string[] = [
    `Sermon Title: ${context.title}`,
    `Speaker: ${context.speakerName}`,
    `Church: ${context.churchName}`,
    `Language: ${context.language}`,
  ];

  if (context.sermonDate) {
    lines.push(`Date: ${context.sermonDate.toISOString().split("T")[0]}`);
  }

  if (context.intelligence) {
    lines.push(
      "",
      "Sermon intelligence context:",
      `Title: ${context.intelligence.title ?? context.title}`,
      `Summary: ${context.intelligence.summary ?? ""}`,
      `Central theme: ${context.intelligence.centralTheme ?? ""}`,
      `Short overview: ${context.intelligence.shortOverview ?? ""}`,
      `Key takeaways: ${Array.isArray(context.intelligence.keyTakeaways) ? context.intelligence.keyTakeaways.join(" | ") : ""}`,
    );
  }

  if (context.scriptures.length > 0) {
    lines.push(
      "",
      "Detected scriptures:",
      ...context.scriptures.map((scripture) => `${scripture.reference} (${scripture.usageType}${scripture.isPrimary ? ", primary" : ""})`),
    );
  }

  if (context.topicTags.length > 0) {
    lines.push("", `Topics: ${context.topicTags.map((topic) => topic.topic).join(", ")}`);
  }

  if (context.structureSections.length > 0) {
    lines.push(
      "",
      "Sermon structure sections:",
      ...context.structureSections.map((section) => {
        return [
          `Type: ${section.sectionType}`,
          `Title: ${section.title ?? ""}`,
          `Description: ${section.description ?? ""}`,
        ].join(" | ");
      }),
    );
  }

  lines.push(
    "",
    "Transcript segments with timestamps:",
    ...context.segments.map((segment) => `[${segment.startTimeSeconds.toFixed(1)} - ${segment.endTimeSeconds.toFixed(1)}] ${segment.text.trim()}`),
  );

  return lines.join("\n");
}

export function buildMinistryMomentCreateInput(
  sermonId: string,
  _transcriptFullText: string,
  moment: MinistryMomentRecord,
): MinistryMomentCreateInput {
  return {
    sermonId,
    momentType: moment.momentType,
    title: moment.title,
    description: moment.description,
    startTimeSeconds: moment.startTimeSeconds,
    endTimeSeconds: moment.endTimeSeconds,
    confidenceScore: moment.confidenceScore,
    transcriptExcerpt: moment.transcriptExcerpt,
    whyDetected: moment.whyDetected,
    suggestedAudience: moment.suggestedAudience,
    suggestedUsage: moment.suggestedUsage,
    clipCategory: moment.clipCategory ?? null,
    reviewStatus: "PENDING",
    isAiGenerated: true,
    isManuallyAdjusted: false,
  };
}

async function loadContext(sermonId: string): Promise<SermonContextPayload | null> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sermonDate: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      sourceDurationSeconds: true,
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
        select: { reference: true, usageType: true, isPrimary: true },
      },
      structureSections: {
        select: { sectionType: true, title: true, description: true },
        orderBy: { orderIndex: "asc" },
      },
      topicTags: {
        select: { topic: true },
      },
      transcriptSegments: {
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
        },
        orderBy: { startTimeSeconds: "asc" },
      },
      transcript: {
        select: { id: true, fullText: true },
      },
    },
  });

  if (!sermon) {
    return null;
  }
  const inferredSermonWindow = inferSermonWindowFromTranscript(sermon.transcriptSegments, {
    sermonStartSeconds: sermon.sermonStartSeconds,
    sermonEndSeconds: sermon.sermonEndSeconds,
    analyzeFullRecording: sermon.analyzeFullRecording,
    knownDurationSeconds: sermon.sourceDurationSeconds,
  });
  const transcriptSegments = applyInferredSermonWindowToSegments(sermon.transcriptSegments, inferredSermonWindow);
  const transcriptFullText = transcriptSegments.map((segment) => segment.text).join(" ");

  return {
    id: sermon.id,
    title: sermon.title,
    speakerName: sermon.speakerName,
    churchName: sermon.churchName,
    language: sermon.language,
    sermonDate: sermon.sermonDate,
    transcriptFullText: inferredSermonWindow
      ? transcriptFullText
      : sermon.transcript?.fullText ?? transcriptFullText,
    intelligence: sermon.intelligence
      ? {
          title: sermon.intelligence.generatedTitle,
          summary: sermon.intelligence.summary,
          centralTheme: sermon.intelligence.centralTheme,
          shortOverview: sermon.intelligence.shortOverview,
          keyTakeaways: sermon.intelligence.keyTakeaways,
        }
      : null,
    scriptures: sermon.scriptureRefs,
    structureSections: sermon.structureSections,
    topicTags: sermon.topicTags,
    segments: transcriptSegments,
  };
}

async function parseMomentResponse(context: SermonContextPayload): Promise<MinistryMomentRecord[]> {
  const client = getOpenAiClient(
    "OPENAI_API_KEY is missing. Add it to your environment before detecting ministry moments.",
  );
  const transcriptPrompt = buildUserPrompt(context);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: transcriptPrompt },
    ],
  });

  const rawContent = response.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`AI returned invalid JSON: ${rawContent.slice(0, 200)}`);
  }

  return ministryMomentResponseSchema.parse(normalizeMinistryMomentResponsePayload(parsed)).moments;
}

export function shouldReuseExistingMoments(momentCount: number, force?: boolean): boolean {
  return momentCount > 0 && !force;
}

export async function generateMinistryMoments(
  sermonId: string,
  options?: MinistryMomentOptions,
): Promise<MinistryMomentResult> {
  const context = await loadContext(sermonId);
  if (!context) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  const existingMomentCount = await prisma.ministryMoment.count({
    where: { sermonId, isAiGenerated: true },
  });

  if (shouldReuseExistingMoments(existingMomentCount, options?.force)) {
    return { momentCount: existingMomentCount, reusedExistingMoments: true };
  }

  const moments = await parseMomentResponse(context);

  if (moments.length === 0) {
    await appendPipelineLog(sermonId, "Ministry moment detection returned no moments.");
    return { momentCount: 0, reusedExistingMoments: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.ministryMoment.deleteMany({
      where: {
        sermonId,
        isAiGenerated: true,
        isManuallyAdjusted: false,
      },
    });

    await tx.ministryMoment.createMany({
      data: moments.map((moment) =>
        buildMinistryMomentCreateInput(sermonId, context.transcriptFullText, moment),
      ),
    });
  });

  await appendPipelineLog(sermonId, `Detected ${moments.length} ministry moment(s).`);
  return { momentCount: moments.length, reusedExistingMoments: false };
}

export async function regenerateMinistryMoments(sermonId: string): Promise<MinistryMomentResult> {
  return generateMinistryMoments(sermonId, { force: true });
}

export const __ministryMomentTestUtils = {
  buildMinistryMomentCreateInput,
  shouldReuseExistingMoments,
  normalizeMinistryMomentResponsePayload,
};
