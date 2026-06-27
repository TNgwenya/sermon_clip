import { z } from "zod";

import {
  parseSermonTimestampInput,
  validateSermonSegmentRange,
} from "@/lib/sermonSegment";

export const createSermonSchema = z
  .object({
    youtubeUrl: z.string().trim(),
    title: z.string().min(1, "Sermon title is required."),
    speakerName: z.string().min(1, "Speaker name is required."),
    churchName: z.string().min(1, "Church name is required."),
    language: z.string().min(1, "Language is required."),
    sermonStartTimestamp: z.string().trim().optional().default(""),
    sermonEndTimestamp: z.string().trim().optional().default(""),
    sermonDate: z
      .string()
      .trim()
      .optional()
      .transform((value) => {
        if (!value) {
          return null;
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      }),
    rightsConfirmed: z.boolean().refine((value) => value, {
      message: "You must confirm rights before saving.",
    }),
    hasUploadedVideo: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.youtubeUrl && !value.hasUploadedVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["youtubeUrl"],
        message: "Paste a sermon video link or upload a sermon video file.",
      });
      return;
    }

    if (value.youtubeUrl) {
      const parsed = z.string().url("Please enter a valid sermon video link.").safeParse(value.youtubeUrl);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["youtubeUrl"],
          message: "Please enter a valid sermon video link.",
        });
      }
    }

    const parsedStart = parseSermonTimestampInput(value.sermonStartTimestamp);
    const parsedEnd = parseSermonTimestampInput(value.sermonEndTimestamp);

    if (parsedStart.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sermonStartTimestamp"],
        message: parsedStart.error,
      });
    }

    if (parsedEnd.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sermonEndTimestamp"],
        message: parsedEnd.error,
      });
    }

    if (!parsedStart.error && !parsedEnd.error) {
      const rangeValidation = validateSermonSegmentRange({
        sermonStartSeconds: parsedStart.seconds,
        sermonEndSeconds: parsedEnd.seconds,
      });

      if (rangeValidation.startError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sermonStartTimestamp"],
          message: rangeValidation.startError,
        });
      }

      if (rangeValidation.endError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sermonEndTimestamp"],
          message: rangeValidation.endError,
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    sermonStartSeconds: parseSermonTimestampInput(value.sermonStartTimestamp).seconds,
    sermonEndSeconds: parseSermonTimestampInput(value.sermonEndTimestamp).seconds,
  }));

export function isUploadedVideoFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0
  );
}

export function buildLocalUploadSourceUrl(fileName: string): string {
  const normalizedName = fileName.trim() || "sermon-video";
  return `local-upload://${encodeURIComponent(normalizedName)}`;
}

