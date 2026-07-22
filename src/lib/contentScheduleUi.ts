import { isValidIanaTimeZone, resolveScheduledInstant } from "@/lib/postingSchedule";

export const CONTENT_ASSET_SCHEDULED_EVENT = "sermon-clip:content-asset-scheduled";

export type ContentAssetScheduleCreatedDetail = {
  scheduledPostId: string;
  scheduledFor: string;
  timezone: string;
  automationMode: "MANUAL" | "AUTOMATIC";
  title: string;
  platformLabel: string;
};

export type ContentScheduleRequiredValues = {
  scheduledFor: string;
  timezone: string;
  title: string;
  caption: string;
};

export function getContentScheduleValidationMessage(
  values: ContentScheduleRequiredValues,
  now = new Date(),
): string | null {
  if (!values.scheduledFor.trim()) return "Choose a date and time.";
  if (!values.timezone.trim()) return "Enter the timezone for this post.";
  if (!isValidIanaTimeZone(values.timezone.trim())) {
    return "Enter a valid timezone, such as Africa/Johannesburg.";
  }

  const scheduledInstant = resolveScheduledInstant(values.scheduledFor, values.timezone.trim());
  if (!scheduledInstant) return "Choose a valid date and time in this timezone.";
  if (scheduledInstant.getTime() < now.getTime() - 60_000) return "Choose a future date and time.";
  if (!values.title.trim()) return "Enter a post title.";
  if (!values.caption.trim()) return "Enter the post copy.";
  return null;
}

export function resolveWrappedDialogFocusIndex(
  currentIndex: number,
  focusableCount: number,
  shiftKey: boolean,
): number | null {
  if (focusableCount <= 0) return null;
  if (currentIndex < 0) return shiftKey ? focusableCount - 1 : 0;
  if (shiftKey && currentIndex === 0) return focusableCount - 1;
  if (!shiftKey && currentIndex === focusableCount - 1) return 0;
  return null;
}

export function scheduledPostElementId(scheduledPostId: string): string {
  return `scheduled-post-${scheduledPostId.trim()}`;
}

export function isContentAssetScheduleCreatedDetail(
  value: unknown,
): value is ContentAssetScheduleCreatedDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<ContentAssetScheduleCreatedDetail>;
  return typeof detail.scheduledPostId === "string"
    && detail.scheduledPostId.trim().length > 0
    && typeof detail.scheduledFor === "string"
    && detail.scheduledFor.trim().length > 0
    && typeof detail.timezone === "string"
    && detail.timezone.trim().length > 0
    && (detail.automationMode === "MANUAL" || detail.automationMode === "AUTOMATIC")
    && typeof detail.title === "string"
    && detail.title.trim().length > 0
    && typeof detail.platformLabel === "string"
    && detail.platformLabel.trim().length > 0;
}

export function buildContentScheduleSuccessCopy(
  detail: ContentAssetScheduleCreatedDetail,
): { heading: string; description: string; scheduledTime: string } {
  const instant = resolveScheduledInstant(detail.scheduledFor, detail.timezone);
  const scheduledTime = instant
    ? new Intl.DateTimeFormat("en", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: detail.timezone,
      }).format(instant)
    : detail.scheduledFor.replace("T", " at ");

  return detail.automationMode === "AUTOMATIC"
    ? {
        heading: "Automatic post scheduled",
        description: `${detail.title} is queued for Sermon Clip to publish to ${detail.platformLabel}.`,
        scheduledTime,
      }
    : {
        heading: "Manual handoff scheduled",
        description: `${detail.title} is on the ${detail.platformLabel} calendar for your media team to publish.`,
        scheduledTime,
      };
}
