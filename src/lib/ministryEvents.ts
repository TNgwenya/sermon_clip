import { z } from "zod";

import { localDateTimeToUtcInstant } from "@/lib/weeklyPlan";

export const MINISTRY_EVENT_TYPES = [
  "CONFERENCE",
  "REVIVAL",
  "SUMMIT",
  "RETREAT",
  "CAMP",
  "CRUSADE",
  "OTHER",
] as const;

export const EVENT_SESSION_TYPES = [
  "PREACHING",
  "WORSHIP",
  "PANEL",
  "WORKSHOP",
  "PRAYER",
  "OTHER",
] as const;

export const MINISTRY_EVENT_STATUS_LABELS = {
  DRAFT: "Draft",
  UPCOMING: "Upcoming",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
} as const;

export const MINISTRY_EVENT_TYPE_LABELS: Record<(typeof MINISTRY_EVENT_TYPES)[number], string> = {
  CONFERENCE: "Conference",
  REVIVAL: "Revival",
  SUMMIT: "Summit",
  RETREAT: "Retreat",
  CAMP: "Camp",
  CRUSADE: "Crusade",
  OTHER: "Other event",
};

export const EVENT_SESSION_TYPE_LABELS: Record<(typeof EVENT_SESSION_TYPES)[number], string> = {
  PREACHING: "Preaching",
  WORSHIP: "Worship",
  PANEL: "Panel",
  WORKSHOP: "Workshop",
  PRAYER: "Prayer",
  OTHER: "Other session",
};

const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.")
  .refine((value) => utcDateFromInput(value) !== null, "Choose a valid date.");
const timeInput = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, "Choose a valid time.")
  .refine((value) => localParts(value) !== null, "Choose a valid time.");
const optionalColor = z.string().trim().refine(
  (value) => !value || /^#[0-9a-f]{6}$/i.test(value),
  "Use a six-digit colour such as #2A6F4E.",
);

function validIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return Boolean(value.trim());
  } catch {
    return false;
  }
}

function utcDateFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  )
    ? date
    : null;
}

export const createMinistryEventSchema = z
  .object({
    name: z.string().trim().min(2, "Event name is required.").max(120, "Keep the event name under 120 characters."),
    eventType: z.enum(MINISTRY_EVENT_TYPES),
    theme: z.string().trim().max(160, "Keep the theme under 160 characters."),
    description: z.string().trim().max(1_000, "Keep the description under 1,000 characters."),
    venue: z.string().trim().max(160, "Keep the venue under 160 characters."),
    timezone: z.string().trim().refine(validIanaTimezone, "Choose a valid timezone."),
    startDate: dateInput,
    endDate: dateInput,
    primaryBrandColor: optionalColor,
    secondaryBrandColor: optionalColor,
  })
  .superRefine((value, ctx) => {
    const start = utcDateFromInput(value.startDate);
    const end = utcDateFromInput(value.endDate);
    if (!start || !end) return;
    if (end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "The event must end on or after its start date.",
      });
      return;
    }
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 31) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "The first Events release supports programmes up to 31 days.",
      });
    }
  });

export const createEventSessionSchema = z
  .object({
    eventId: z.string().trim().min(1, "Event is required."),
    title: z.string().trim().min(2, "Session title is required.").max(140, "Keep the session title under 140 characters."),
    sessionType: z.enum(EVENT_SESSION_TYPES),
    speakerName: z.string().trim().max(120, "Keep the speaker name under 120 characters."),
    language: z.string().trim().max(80, "Keep the language under 80 characters."),
    sessionDate: dateInput,
    startTime: timeInput,
    endTime: z.string().trim(),
    priority: z.coerce.number().int().min(0).max(100),
    notes: z.string().trim().max(1_000, "Keep session notes under 1,000 characters."),
  })
  .superRefine((value, ctx) => {
    if (value.endTime && !localParts(value.endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Choose a valid end time.",
      });
    }
    if (value.endTime && value.endTime <= value.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "The end time must be after the start time.",
      });
    }
  });

export type CreateMinistryEventInput = z.infer<typeof createMinistryEventSchema>;
export type CreateEventSessionInput = z.infer<typeof createEventSessionSchema>;

export function parseDateInput(value: string): Date | null {
  return utcDateFromInput(value.trim());
}

export function dateInputInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function initialMinistryEventStatus(input: {
  startDate: string;
  endDate: string;
  timezone: string;
  now?: Date;
}): "UPCOMING" | "ACTIVE" | "COMPLETED" {
  const today = dateInputInTimezone(input.now ?? new Date(), input.timezone);
  if (input.endDate < today) return "COMPLETED";
  if (input.startDate > today) return "UPCOMING";
  return "ACTIVE";
}

export function eventDayNumber(eventStartDate: Date, sessionDate: Date): number {
  return Math.floor((sessionDate.getTime() - eventStartDate.getTime()) / 86_400_000) + 1;
}

function localParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
}

export function eventSessionInstant(input: {
  sessionDate: string;
  time: string;
  timezone: string;
}): Date | null {
  const date = utcDateFromInput(input.sessionDate);
  const time = localParts(input.time);
  if (!date || !time) return null;
  return localDateTimeToUtcInstant({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: time.hour,
    minute: time.minute,
  }, input.timezone);
}

export type EventSessionOperationalStatus =
  | "AWAITING_RECORDING"
  | "UPLOADING"
  | "PROCESSING"
  | "NEEDS_ATTENTION"
  | "READY_FOR_REVIEW"
  | "CONTENT_READY"
  | "CANCELLED";

export type EventSessionStatusView = {
  code: EventSessionOperationalStatus;
  label: string;
  detail: string;
  progress: number;
  tone: "neutral" | "info" | "warning" | "success";
};

export type EventSessionSermonView = {
  status: string;
  youtubeUrl?: string | null;
  sourceAsset?: { status: string } | null;
  processingJobs?: Array<{ status: string }>;
  clipCount?: number;
  contentOpportunityCount?: number;
  readyContentAssetCount?: number;
};

export function resolveEventSessionStatus(input: {
  sessionStatus: string;
  sermon: EventSessionSermonView | null;
}): EventSessionStatusView {
  if (input.sessionStatus === "CANCELLED") {
    return {
      code: "CANCELLED",
      label: "Cancelled",
      detail: "This session is no longer part of the active programme.",
      progress: 0,
      tone: "neutral",
    };
  }

  if (!input.sermon) {
    return {
      code: "AWAITING_RECORDING",
      label: "Recording needed",
      detail: "Add the session recording when it becomes available.",
      progress: 0,
      tone: "warning",
    };
  }

  if (input.sermon.sourceAsset?.status === "INITIATED" || input.sermon.sourceAsset?.status === "UPLOADING") {
    return {
      code: "UPLOADING",
      label: "Uploading",
      detail: "Keep the source device online until the recording is safely stored.",
      progress: 15,
      tone: "info",
    };
  }

  if (input.sermon.status === "FAILED" || input.sermon.sourceAsset?.status === "FAILED") {
    return {
      code: "NEEDS_ATTENTION",
      label: "Needs attention",
      detail: "Open the session to recover the source or retry the failed processing step.",
      progress: 20,
      tone: "warning",
    };
  }

  if ((input.sermon.readyContentAssetCount ?? 0) > 0 || input.sermon.status === "EXPORTED") {
    return {
      code: "CONTENT_READY",
      label: "Content ready",
      detail: "Reviewed output is ready for the publishing workflow.",
      progress: 100,
      tone: "success",
    };
  }

  if (
    (input.sermon.clipCount ?? 0) > 0
    || (input.sermon.contentOpportunityCount ?? 0) > 0
    || ["CLIPS_GENERATED", "REVIEWING", "EXPORTING"].includes(input.sermon.status)
  ) {
    return {
      code: "READY_FOR_REVIEW",
      label: "Ready for review",
      detail: "Clips or content ideas are waiting for your team.",
      progress: 75,
      tone: "success",
    };
  }

  const activeJob = input.sermon.processingJobs?.some(
    (job) => job.status === "PENDING" || job.status === "RUNNING",
  );
  const localUploadPending = input.sermon.youtubeUrl?.startsWith("local-upload://")
    && input.sermon.status === "CREATED";
  if (localUploadPending) {
    return {
      code: "UPLOADING",
      label: "Uploading",
      detail: "The mobile upload can resume with the same recording if interrupted.",
      progress: 10,
      tone: "info",
    };
  }

  return {
    code: "PROCESSING",
    label: activeJob ? "Processing" : "Preparing",
    detail: "Simonclip is preparing the transcript, moments and content.",
    progress: input.sermon.status === "TRANSCRIBED" ? 55 : 35,
    tone: "info",
  };
}
