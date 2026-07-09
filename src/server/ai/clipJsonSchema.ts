import { z } from "zod";

import { CLIP_ARC_TYPES } from "@/server/agents/clipArcDetection";
import { SMART_CLIP_CATEGORIES } from "@/server/ai/ministryMomentSchema";

export const allowedClipTypes = [
  "inspirational",
  "teaching",
  "evangelistic",
  "testimony",
  "leadership",
  "funny",
  "prophetic",
  "pastoral",
] as const;

export const allowedRiskLevels = ["LOW", "MEDIUM", "HIGH"] as const;

type ClipType = (typeof allowedClipTypes)[number];
type SmartClipCategory = (typeof SMART_CLIP_CATEGORIES)[number];
type ClipArcType = (typeof CLIP_ARC_TYPES)[number];

const clipTypeAliases: Record<string, ClipType> = {
  ENCOURAGEMENT: "inspirational",
  ENCOURAGING: "inspirational",
  INSPIRATION: "inspirational",
  INSPIRATIONAL_CLIP: "inspirational",
  TEACHING_INSIGHT: "teaching",
  SCRIPTURE_TEACHING: "teaching",
  BIBLE_TEACHING: "teaching",
  EXPLANATION: "teaching",
  APPLICATION: "teaching",
  PRACTICAL_APPLICATION: "teaching",
  WISDOM: "teaching",
  DISCIPLESHIP: "teaching",
  DISCIPLESHIP_CLIP: "teaching",
  EXHORTATION: "teaching",
  SERMON_APPLICATION: "teaching",
  SCRIPTURE: "teaching",
  EVANGELISM: "evangelistic",
  SALVATION: "evangelistic",
  ALTAR_CALL: "evangelistic",
  TESTIMONY_STORY: "testimony",
  STORY: "testimony",
  LEADERSHIP_CLIP: "leadership",
  HUMOR: "funny",
  PROPHETIC_MOMENT: "prophetic",
  PRAYER: "pastoral",
  PASTORAL_ENCOURAGEMENT: "pastoral",
};

const smartClipCategoryAliases: Record<string, SmartClipCategory> = {
  FAITH: "Best Faith Clip",
  FAITH_CLIP: "Best Faith Clip",
  BEST_FAITH_MOMENT: "Best Faith Clip",
  PRAYER: "Best Prayer Clip",
  PRAYER_MOMENT: "Best Prayer Clip",
  LEADERSHIP: "Best Leadership Clip",
  TESTIMONY: "Best Testimony Clip",
  TESTIMONY_STORY: "Best Testimony Clip",
  EVANGELISM: "Best Evangelism Clip",
  EVANGELISTIC: "Best Evangelism Clip",
  ENCOURAGEMENT: "Best Encouragement Clip",
  ENCOURAGEMENT_MOMENT: "Best Encouragement Clip",
  SCRIPTURE: "Best Scripture Explanation Clip",
  SCRIPTURE_EXPLANATION: "Best Scripture Explanation Clip",
  TEACHING: "Best Scripture Explanation Clip",
  TEACHING_CLIP: "Best Scripture Explanation Clip",
  BEST_TEACHING_CLIP: "Best Scripture Explanation Clip",
  QUOTE: "Best Quote-Worthy Moment Clip",
  QUOTE_WORTHY: "Best Quote-Worthy Moment Clip",
  FAMILY: "Best Family Clip",
  MARRIAGE: "Best Family Clip",
  DISCIPLESHIP: "Best Discipleship Clip",
  SUNDAY_PROMOTION: "Best Sunday Promotion Clip",
  INVITATION: "Best Sunday Promotion Clip",
  SALVATION_INVITATION: "Best Salvation Invitation Clip",
  ALTAR_CALL: "Best Salvation Invitation Clip",
  CALL_TO_ACTION: "Best Call To Action Clip",
  APPLICATION: "Best Call To Action Clip",
  APPLICATION_CLIP: "Best Call To Action Clip",
  BEST_APPLICATION_CLIP: "Best Call To Action Clip",
  PRACTICAL_APPLICATION: "Best Call To Action Clip",
  BEST_PRACTICAL_APPLICATION_CLIP: "Best Call To Action Clip",
};

const arcTypeAliases: Record<string, ClipArcType> = {
  PROBLEM_TO_TRUTH_TO_APPLICATION: "PROBLEM_TRUTH_APPLICATION",
  PROBLEM_SOLUTION_APPLICATION: "PROBLEM_TRUTH_APPLICATION",
  PROBLEM_APPLICATION: "PROBLEM_TRUTH_APPLICATION",
  TEACHING_APPLICATION: "PROBLEM_TRUTH_APPLICATION",
  EXHORTATION_APPLICATION: "PROBLEM_TRUTH_APPLICATION",
  QUESTION_ANSWER: "QUESTION_SCRIPTURE_ANSWER",
  SCRIPTURE_ANSWER: "QUESTION_SCRIPTURE_ANSWER",
  STORY_APPLICATION: "STORY_LESSON_PUNCHLINE",
  TESTIMONY_APPLICATION: "TESTIMONY_TO_APPLICATION",
  PAIN_TO_HOPE: "PAIN_HOPE_DECLARATION",
  CORRECTION_CALL: "CORRECTION_EXPLANATION_CALL",
  SCRIPTURE_TEACHING: "SCRIPTURE_EXPLANATION_APPLICATION",
  SCRIPTURE_APPLICATION: "SCRIPTURE_EXPLANATION_APPLICATION",
  QUOTE: "QUOTE_WITH_CONTEXT",
  ALTAR_CALL: "ALTAR_CALL_INVITATION",
  SALVATION_INVITATION: "ALTAR_CALL_INVITATION",
};

function normalizeEnumKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

function normalizeClipType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const direct = allowedClipTypes.find((item) => item === trimmed.toLowerCase());
  if (direct) return direct;
  return clipTypeAliases[normalizeEnumKey(trimmed)] ?? value;
}

function normalizeRiskLevel(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = normalizeEnumKey(value);
  if (key === "LOW" || key === "LOW_RISK") return "LOW";
  if (key === "MEDIUM" || key === "MODERATE" || key === "MEDIUM_RISK" || key === "MODERATE_RISK") return "MEDIUM";
  if (key === "HIGH" || key === "HIGH_RISK") return "HIGH";
  return value;
}

function normalizeSmartClipCategory(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const direct = SMART_CLIP_CATEGORIES.find((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (direct) return direct;
  return smartClipCategoryAliases[normalizeEnumKey(trimmed)] ?? value;
}

function normalizeArcType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = normalizeEnumKey(value);
  const direct = CLIP_ARC_TYPES.find((item) => item === key);
  if (direct) return direct;
  return arcTypeAliases[key] ?? "PROBLEM_TRUTH_APPLICATION";
}

export const rawClipJsonCandidateSchema = z
  .object({
    windowId: z.string().trim().min(1).optional(),
    startSegmentIndex: z.number().int().min(0).optional(),
    endSegmentIndex: z.number().int().min(0).optional(),
    hookSegmentIndex: z.number().int().min(0).optional(),
    landingSegmentIndex: z.number().int().min(0).optional(),
    startTimeSeconds: z.number().min(0).optional(),
    endTimeSeconds: z.number().optional(),
    durationSeconds: z.number().min(20).max(150).optional(),
    transcriptText: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    hook: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    suggestedHook: z.string().trim().min(1).optional(),
    suggestedCaption: z.string().trim().min(1).optional(),
    hashtags: z.array(z.string().trim().min(1)),
    score: z.number().min(1).max(10),
    reasonSelected: z.string().trim().min(1),
    landingSentence: z.string().trim().min(1),
    clipType: z.preprocess(normalizeClipType, z.enum(allowedClipTypes)),
    smartClipCategory: z.preprocess(normalizeSmartClipCategory, z.enum(SMART_CLIP_CATEGORIES)),
    intendedAudience: z.string().trim().min(1),
    ministryValue: z.string().trim().min(1),
    socialValue: z.string().trim().min(1),
    ministryMomentType: z.string().trim().min(1).optional(),
    ministryMomentTitle: z.string().trim().min(1).optional(),
    riskLevel: z.preprocess(normalizeRiskLevel, z.enum(allowedRiskLevels)),
    riskReasons: z.array(z.string().trim()),
    contextWarning: z.boolean(),
    arcType: z.preprocess(normalizeArcType, z.enum(CLIP_ARC_TYPES)).default("PROBLEM_TRUTH_APPLICATION"),
    arcSummary: z.string().trim().min(1).default("Arc metadata was repaired with a fallback summary."),
    setupStartTime: z.number().min(0).nullable().default(null),
    mainPointTime: z.number().min(0).nullable().default(null),
    payoffTime: z.number().min(0).nullable().default(null),
    applicationTime: z.number().min(0).nullable().default(null),
    whyThisClipFeelsComplete: z.string().trim().min(1).default("The clip was accepted after schema repair and will be rechecked by deterministic arc scoring."),
    whatContextMightBeMissing: z.string().trim().min(1).nullable().default(null),
    languageHints: z
      .object({
        detectedLanguage: z.string().trim().min(1),
        mixedLanguage: z.boolean().optional(),
        translatedFrom: z.string().trim().min(1).nullable().optional(),
        originalPhrase: z.string().trim().min(1).nullable().optional(),
        englishMeaning: z.string().trim().min(1).nullable().optional(),
        translationConfidence: z.number().min(0).max(1).nullable().optional(),
        translationUncertaintyNote: z.string().trim().min(1).nullable().optional(),
      })
      .optional(),
    captionPackage: z
      .object({
        primaryCaption: z.string().trim().min(1),
        shortCaption: z.string().trim().min(1),
        platformCaption: z.string().trim().min(1),
        optionalHashtags: z.array(z.string().trim().min(1)).optional(),
        titleOptions: z.array(z.string().trim().min(1)).min(2).max(3).optional(),
        hookOptions: z.array(z.string().trim().min(1)).min(2).max(3).optional(),
        ctaOptions: z.array(z.string().trim().min(1)).max(3).optional(),
        captionQualityScore: z.number().min(0).max(10),
        captionReason: z.string().trim().min(1),
        captionWarnings: z.array(
          z.enum(["TOO_LONG", "TOO_GENERIC", "TOO_DRAMATIC", "UNSUPPORTED_BY_SERMON"]),
        ),
      })
      .optional(),
    socialPotential: z
      .object({
        ministryValueScore: z.number().min(0).max(10),
        socialMediaPotentialScore: z.number().min(0).max(10),
        hookStrength: z.number().min(0).max(10),
        clarityScore: z.number().min(0).max(10),
        emotionalImpactScore: z.number().min(0).max(10),
        shareabilityScore: z.number().min(0).max(10),
        standaloneUsefulnessScore: z.number().min(0).max(10),
        whyMayPerformWell: z.string().trim().min(1),
        whyMayNotPerformWell: z.string().trim().min(1),
        recommendedPlatforms: z.array(z.string().trim().min(1)),
      })
      .optional(),
    selectionReasoning: z
      .object({
        clipSummary: z.string().trim().min(1),
        whySelected: z.string().trim().min(1),
        usefulForAudience: z.string().trim().min(1),
        ministryCategory: z.string().trim().min(1),
        shortFormSuitability: z.string().trim().min(1),
        needsCaptionOrContextSupport: z.boolean(),
        captionOrContextSupportReason: z.string().trim().min(1),
      })
      .optional(),
  })
  .superRefine((candidate, ctx) => {
    const hasIndexedBoundary =
      candidate.windowId !== undefined &&
      candidate.startSegmentIndex !== undefined &&
      candidate.endSegmentIndex !== undefined;
    const hasLegacyTimestampBoundary =
      candidate.startTimeSeconds !== undefined &&
      candidate.endTimeSeconds !== undefined &&
      candidate.durationSeconds !== undefined &&
      candidate.transcriptText !== undefined;

    if (!hasIndexedBoundary && !hasLegacyTimestampBoundary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate must include either windowId/startSegmentIndex/endSegmentIndex or legacy startTimeSeconds/endTimeSeconds/durationSeconds/transcriptText.",
        path: ["windowId"],
      });
    }

    if (candidate.windowId !== undefined && (candidate.startSegmentIndex === undefined || candidate.endSegmentIndex === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indexed candidates must include both startSegmentIndex and endSegmentIndex.",
        path: ["startSegmentIndex"],
      });
    }

    if (
      candidate.landingSegmentIndex !== undefined &&
      candidate.startSegmentIndex !== undefined &&
      candidate.endSegmentIndex !== undefined &&
      (candidate.landingSegmentIndex < candidate.startSegmentIndex || candidate.landingSegmentIndex > candidate.endSegmentIndex)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LANDING_SEGMENT_OUTSIDE_RANGE: landingSegmentIndex must be inside the selected start/end segment range.",
        path: ["landingSegmentIndex"],
      });
    }

    if (
      candidate.hookSegmentIndex !== undefined &&
      candidate.startSegmentIndex !== undefined &&
      candidate.endSegmentIndex !== undefined &&
      (candidate.hookSegmentIndex < candidate.startSegmentIndex || candidate.hookSegmentIndex > candidate.endSegmentIndex)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HOOK_SEGMENT_OUTSIDE_RANGE: hookSegmentIndex must be inside the selected start/end segment range.",
        path: ["hookSegmentIndex"],
      });
    }

    if (candidate.endTimeSeconds !== undefined && candidate.startTimeSeconds !== undefined && candidate.endTimeSeconds <= candidate.startTimeSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endTimeSeconds must be greater than startTimeSeconds.",
        path: ["endTimeSeconds"],
      });
    }

    if (
      candidate.startSegmentIndex !== undefined &&
      candidate.endSegmentIndex !== undefined &&
      candidate.endSegmentIndex < candidate.startSegmentIndex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endSegmentIndex must be greater than or equal to startSegmentIndex.",
        path: ["endSegmentIndex"],
      });
    }

    if (
      candidate.endTimeSeconds !== undefined &&
      candidate.startTimeSeconds !== undefined &&
      candidate.durationSeconds !== undefined
    ) {
      const actualDuration = candidate.endTimeSeconds - candidate.startTimeSeconds;
      if (actualDuration < 20 || actualDuration > 150) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Clip duration derived from timestamps must be between 20 and 150 seconds.",
          path: ["startTimeSeconds"],
        });
      }

      if (Math.abs(actualDuration - candidate.durationSeconds) > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "durationSeconds must roughly match endTimeSeconds - startTimeSeconds.",
          path: ["durationSeconds"],
        });
      }
    } else if (hasLegacyTimestampBoundary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Legacy timestamp candidates must include startTimeSeconds, endTimeSeconds, durationSeconds, and transcriptText.",
        path: ["startTimeSeconds"],
      });
    }
  });

export type RawClipJsonCandidate = z.infer<typeof rawClipJsonCandidateSchema>;
export type ClipJsonCandidate = Omit<RawClipJsonCandidate, "startTimeSeconds" | "endTimeSeconds" | "durationSeconds" | "transcriptText"> & {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
};

export const clipJsonCandidateSchema = rawClipJsonCandidateSchema as unknown as z.ZodType<ClipJsonCandidate>;

export const rawClipJsonResponseSchema = z.object({
  clips: z.array(rawClipJsonCandidateSchema),
});

export const clipJsonResponseSchema = rawClipJsonResponseSchema as unknown as z.ZodType<{ clips: ClipJsonCandidate[] }>;
export type ClipJsonResponse = z.infer<typeof clipJsonResponseSchema>;

export const __clipJsonSchemaTestUtils = {
  normalizeArcType,
  normalizeClipType,
  normalizeRiskLevel,
  normalizeSmartClipCategory,
};
