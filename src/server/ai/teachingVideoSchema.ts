import { z } from "zod";

export const teachingVideoTypes = [
  "SCRIPTURE_EXPOSITION",
  "DOCTRINAL_EXPLANATION",
  "PRACTICAL_APPLICATION",
  "PASTORAL_COUNSEL",
  "LEADERSHIP_TEACHING",
  "OTHER",
] as const;

const completenessSchema = z.object({
  standaloneScore: z.number().min(0).max(1),
  boundaryConfidence: z.number().min(0).max(1),
  topicIntroduced: z.boolean(),
  argumentResolved: z.boolean(),
  scriptureComplete: z.boolean(),
  illustrationComplete: z.boolean(),
  prayerOrConclusionComplete: z.boolean(),
}).strict();

const titleOptionsSchema = z.array(
  z.string().trim().min(12).max(100),
)
  .min(3)
  .max(5)
  .superRefine((options, context) => {
    const unique = new Set(options.map((option) => option.toLocaleLowerCase()));
    if (unique.size !== options.length) {
      context.addIssue({
        code: "custom",
        message: "Teaching-video title options must be distinct.",
      });
    }
  });

export const teachingVideoCandidateSchema = z.object({
  startAnchorId: z.string().trim().min(1),
  endAnchorId: z.string().trim().min(1),
  recommendedStartSeconds: z.number().min(0),
  recommendedEndSeconds: z.number().positive(),
  titleOptions: titleOptionsSchema,
  titleEvidence: z.string().trim().min(2).max(240),
  teachingType: z.enum(teachingVideoTypes),
  completeness: completenessSchema,
  startReason: z.string().trim().min(5).max(600),
  endReason: z.string().trim().min(5).max(600),
  contextDependencies: z.array(z.string().trim().min(1).max(300)).max(8),
  riskFlags: z.array(z.string().trim().min(1).max(80)).max(12),
  durationExceptionReason: z.string().trim().min(5).max(500).nullable(),
}).strict();

export const teachingVideoWindowResponseSchema = z.object({
  schemaVersion: z.literal(2),
  windowId: z.string().trim().min(1),
  candidates: z.array(teachingVideoCandidateSchema).max(4),
}).strict();

export type TeachingVideoAiCandidate = z.infer<typeof teachingVideoCandidateSchema>;
export type TeachingVideoWindowResponse = z.infer<typeof teachingVideoWindowResponseSchema>;
