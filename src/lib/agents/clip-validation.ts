import {
  clipJsonCandidateSchema,
  clipJsonResponseSchema,
  rawClipJsonResponseSchema,
  type ClipJsonCandidate,
} from "@/server/ai/clipJsonSchema";

export const aiClipCandidateSchema = clipJsonCandidateSchema;
export const aiClipCandidateListSchema = rawClipJsonResponseSchema.shape.clips;

export type ValidatedAiClipCandidate = ClipJsonCandidate;

export function validateAiClipCandidates(payload: unknown): ValidatedAiClipCandidate[] {
  return clipJsonResponseSchema.parse(payload).clips;
}
