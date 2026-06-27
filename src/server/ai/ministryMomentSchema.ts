import { z } from "zod";

export const MINISTRY_MOMENT_TYPES = [
  "PRAYER_MOMENT",
  "ALTAR_CALL",
  "SALVATION_INVITATION",
  "PROPHETIC_MOMENT",
  "FAITH_DECLARATION",
  "ENCOURAGEMENT_MOMENT",
  "TESTIMONY",
  "CALL_TO_ACTION",
  "DISCIPLESHIP_MOMENT",
  "LEADERSHIP_MOMENT",
  "FAMILY_MARRIAGE_MOMENT",
  "HEALING_MOMENT",
  "WORSHIP_MOMENT",
  "GIVING_STEWARDSHIP_MOMENT",
  "CHURCH_VISION_MOMENT",
  "SUNDAY_INVITATION_PROMOTION_MOMENT",
  "OTHER",
] as const;

export type MinistryMomentType = (typeof MINISTRY_MOMENT_TYPES)[number];

export const SMART_CLIP_CATEGORIES = [
  "Best Faith Clip",
  "Best Prayer Clip",
  "Best Leadership Clip",
  "Best Testimony Clip",
  "Best Evangelism Clip",
  "Best Encouragement Clip",
  "Best Scripture Explanation Clip",
  "Best Quote-Worthy Moment Clip",
  "Best Family Clip",
  "Best Discipleship Clip",
  "Best Sunday Promotion Clip",
  "Best Salvation Invitation Clip",
  "Best Call To Action Clip",
] as const;

export type SmartClipCategory = (typeof SMART_CLIP_CATEGORIES)[number];

export const ministryMomentSchema = z.object({
  momentType: z.enum(MINISTRY_MOMENT_TYPES),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  startTimeSeconds: z.number().min(0).nullable(),
  endTimeSeconds: z.number().min(0).nullable(),
  confidenceScore: z.number().min(0).max(1),
  transcriptExcerpt: z.string().trim().min(1),
  whyDetected: z.string().trim().min(1),
  suggestedAudience: z.string().trim().min(1),
  suggestedUsage: z.string().trim().min(1),
  clipCategory: z.enum(SMART_CLIP_CATEGORIES).nullable().optional(),
});

export const ministryMomentResponseSchema = z.object({
  moments: z.array(ministryMomentSchema).max(30),
});

export type MinistryMomentRecord = z.infer<typeof ministryMomentSchema>;
export type MinistryMomentResponse = z.infer<typeof ministryMomentResponseSchema>;

export const MINISTRY_MOMENT_JSON_SHAPE = `{
  "moments": [
    {
      "momentType": "PRAYER_MOMENT",
      "title": "Prayer for the congregation",
      "description": "A brief description of the ministry moment.",
      "startTimeSeconds": 0,
      "endTimeSeconds": 45,
      "confidenceScore": 0.93,
      "transcriptExcerpt": "Let's pray together...",
      "whyDetected": "The preacher explicitly led the congregation in prayer.",
      "suggestedAudience": "People needing prayer support.",
      "suggestedUsage": "Use as a short prayer clip or devotional social post.",
      "clipCategory": "Best Prayer Clip"
    }
  ]
}`;
