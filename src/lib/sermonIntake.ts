import { z } from "zod";

import {
  parseSermonTimestampInput,
  validateSermonSegmentRange,
} from "@/lib/sermonSegment";

export const MAX_UPLOADED_MEDIA_BYTES = Math.floor(2.5 * 1024 * 1024 * 1024);
export const MAX_UPLOADED_MEDIA_LABEL = "2.5 GB";
export const UPLOADED_MEDIA_TOO_LARGE_MESSAGE = `This recording is too large to upload from this form. The current mobile upload limit is ${MAX_UPLOADED_MEDIA_LABEL}. Compress the video, trim the recording, or use a YouTube link instead.`;
export const HOSTED_MEDIA_UPLOAD_UNAVAILABLE_MESSAGE = "Direct video uploads from this website are temporarily unavailable because the hosted app cannot safely receive and store large recordings. No file was uploaded. Use a public or unlisted YouTube link instead.";
export const MOBILE_UPLOAD_FAILURE_HELP = `If a mobile upload fails before this page can show a server response, the phone may have interrupted the upload, the file may still be in cloud storage, or the recording may be larger than ${MAX_UPLOADED_MEDIA_LABEL}. Keep the app open on Wi-Fi, choose a file stored on the device, or use a YouTube link.`;
export const SERMON_UPLOAD_ATTEMPT_STORAGE_KEY = "sermon-clip:upload-attempt";

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
        message: "Paste a sermon video link or upload a sermon media file.",
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

export function isUploadedMediaFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0
  );
}

export const isUploadedVideoFile = isUploadedMediaFile;

export function uploadedMediaExceedsSizeLimit(file: Pick<File, "size">): boolean {
  return file.size > MAX_UPLOADED_MEDIA_BYTES;
}

export function buildUploadedMediaCheckFailureMessage(reason: string): string {
  const normalizedReason = reason.trim() || "The media check did not return a reason.";
  return `The upload reached Sermon Clip, but the recording could not be processed. Reason: ${normalizedReason}`;
}

export function buildLocalUploadSourceUrl(fileName: string): string {
  const normalizedName = fileName.trim() || "sermon-video";
  return `local-upload://${encodeURIComponent(normalizedName)}`;
}
