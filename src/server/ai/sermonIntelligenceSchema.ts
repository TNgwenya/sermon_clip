import { z } from "zod";

// ─── Controlled topic list ─────────────────────────────────────────────────────

export const MINISTRY_TOPICS = [
  "faith",
  "prayer",
  "leadership",
  "discipleship",
  "marriage",
  "parenting",
  "healing",
  "evangelism",
  "stewardship",
  "revival",
  "purpose",
  "Holy Spirit",
  "salvation",
  "identity",
  "worship",
  "obedience",
  "spiritual growth",
  "church growth",
  "service",
  "forgiveness",
  "grace",
  "holiness",
] as const;

export type MinistryTopic = (typeof MINISTRY_TOPICS)[number];

// ─── Scripture usage types ─────────────────────────────────────────────────────

export const scriptureUsageTypes = ["READ", "QUOTED", "REFERENCED", "IMPLIED"] as const;
export type ScriptureUsageType = (typeof scriptureUsageTypes)[number];

const scriptureUsageTypeSet = new Set<ScriptureUsageType>(scriptureUsageTypes);

const scriptureUsageTypeAliases: Record<string, ScriptureUsageType> = {
  SPOKEN: "QUOTED",
  SAID: "QUOTED",
  VERBAL_QUOTE: "QUOTED",
  DIRECT_QUOTE: "QUOTED",
  CITED: "REFERENCED",
  MENTIONED: "REFERENCED",
  REFERENCE: "REFERENCED",
  ALLUDED: "IMPLIED",
  ALLUSION: "IMPLIED",
  THEME: "IMPLIED",
};

function normalizeEnumKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

export function normalizeScriptureUsageType(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = normalizeEnumKey(value);
  if (scriptureUsageTypeSet.has(normalized as ScriptureUsageType)) {
    return normalized;
  }

  return scriptureUsageTypeAliases[normalized] ?? value;
}

// ─── Sermon structure section types ────────────────────────────────────────────

export const structureSectionTypes = [
  "INTRODUCTION",
  "SCRIPTURE_READING",
  "EXPLANATION",
  "STORY",
  "TESTIMONY",
  "ILLUSTRATION",
  "APPLICATION",
  "PRAYER",
  "ALTAR_CALL",
  "CLOSING",
  "ANNOUNCEMENT",
  "OTHER",
] as const;

export type StructureSectionType = (typeof structureSectionTypes)[number];

const structureSectionTypeSet = new Set<StructureSectionType>(structureSectionTypes);

const structureSectionTypeAliases: Record<string, StructureSectionType> = {
  OPENING: "INTRODUCTION",
  GREETING: "INTRODUCTION",
  WELCOME: "INTRODUCTION",
  OPENING_REMARKS: "INTRODUCTION",
  SCRIPTURE: "SCRIPTURE_READING",
  SCRIPTURE_REFERENCE: "SCRIPTURE_READING",
  SCRIPTURE_EXPLANATION: "EXPLANATION",
  BIBLE_READING: "SCRIPTURE_READING",
  BIBLE_TEACHING: "EXPLANATION",
  TEACHING: "EXPLANATION",
  PREACHING: "EXPLANATION",
  MAIN_TEACHING: "EXPLANATION",
  MAIN_POINT: "EXPLANATION",
  MAIN_MESSAGE: "EXPLANATION",
  SERMON_BODY: "EXPLANATION",
  BODY: "EXPLANATION",
  MESSAGE: "EXPLANATION",
  PERSONAL_STORY: "STORY",
  TESTIMONY_STORY: "TESTIMONY",
  EXAMPLE: "ILLUSTRATION",
  SERMON_ILLUSTRATION: "ILLUSTRATION",
  CALL_TO_ACTION: "APPLICATION",
  PRACTICAL_APPLICATION: "APPLICATION",
  LIFE_APPLICATION: "APPLICATION",
  RESPONSE: "APPLICATION",
  INVITATION: "ALTAR_CALL",
  SALVATION_INVITATION: "ALTAR_CALL",
  MINISTRY_CALL: "ALTAR_CALL",
  CLOSING_PRAYER: "PRAYER",
  PRAYER_TIME: "PRAYER",
  BENEDICTION: "CLOSING",
  CONCLUSION: "CLOSING",
  WRAP_UP: "CLOSING",
  ANNOUNCEMENTS: "ANNOUNCEMENT",
};

export function normalizeStructureSectionType(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = normalizeEnumKey(value);
  if (structureSectionTypeSet.has(normalized as StructureSectionType)) {
    return normalized;
  }

  return structureSectionTypeAliases[normalized] ?? value;
}

// ─── AI output schemas (validated before persistence) ─────────────────────────

export const aiScriptureRefSchema = z.object({
  reference: z.string().trim().min(1),
  book: z.string().trim().optional(),
  chapter: z.number().int().positive().optional(),
  verseStart: z.number().int().positive().optional(),
  verseEnd: z.number().int().positive().optional(),
  usageType: z.preprocess(normalizeScriptureUsageType, z.enum(scriptureUsageTypes)),
  isPrimary: z.boolean().default(false),
  frequencyCount: z.number().int().min(1).default(1),
  confidenceScore: z.number().min(0).max(1),
  transcriptEvidence: z.string().trim().optional(),
});

export const aiStructureSectionSchema = z.object({
  sectionType: z.preprocess(normalizeStructureSectionType, z.enum(structureSectionTypes)),
  title: z.string().trim().optional(),
  description: z.string().trim().optional(),
  orderIndex: z.number().int().min(0),
  startTimeSeconds: z.number().min(0).optional(),
  endTimeSeconds: z.number().min(0).optional(),
  confidenceScore: z.number().min(0).max(1),
  transcriptExcerpt: z.string().trim().optional(),
});

export const aiTopicTagSchema = z.object({
  topic: z.string().trim().min(1),
  confidenceScore: z.number().min(0).max(1),
  evidence: z.string().trim().optional(),
});

export const aiSermonIntelligenceSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  centralTheme: z.string().trim().min(1),
  shortOverview: z.string().trim().min(1),
  keyTakeaways: z.array(z.string().trim().min(1)).min(1).max(10),
  confidenceScore: z.number().min(0).max(1),
  scriptures: z.array(aiScriptureRefSchema).max(30),
  structureSections: z.array(aiStructureSectionSchema).max(20),
  topics: z.array(aiTopicTagSchema).min(1).max(10),
});

export type AiScriptureRef = z.infer<typeof aiScriptureRefSchema>;
export type AiStructureSection = z.infer<typeof aiStructureSectionSchema>;
export type AiTopicTag = z.infer<typeof aiTopicTagSchema>;
export type AiSermonIntelligence = z.infer<typeof aiSermonIntelligenceSchema>;

// ─── JSON shape sent to the AI (for the system prompt) ────────────────────────

export const INTELLIGENCE_JSON_SHAPE = `{
  "title": "Sermon title (may differ from original if AI determines a better one)",
  "summary": "2-4 sentence summary of the sermon",
  "centralTheme": "One sentence capturing the central message",
  "shortOverview": "1-2 sentence overview suitable for pastors and church leadership",
  "keyTakeaways": ["takeaway 1", "takeaway 2"],
  "confidenceScore": 0.85,
  "scriptures": [
    {
      "reference": "John 3:16",
      "book": "John",
      "chapter": 3,
      "verseStart": 16,
      "usageType": "READ",
      "isPrimary": true,
      "frequencyCount": 2,
      "confidenceScore": 0.95,
      "transcriptEvidence": "The preacher read the verse directly..."
    }
  ],
  "structureSections": [
    {
      "sectionType": "INTRODUCTION",
      "title": "Opening greeting",
      "orderIndex": 0,
      "startTimeSeconds": 0,
      "endTimeSeconds": 120,
      "confidenceScore": 0.9,
      "transcriptExcerpt": "Good morning, today we look at..."
    }
  ],
  "topics": [
    {
      "topic": "faith",
      "confidenceScore": 0.9,
      "evidence": "The sermon repeatedly emphasized trusting God..."
    }
  ]
}`;
