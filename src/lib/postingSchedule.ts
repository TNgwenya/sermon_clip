const MIN_SCHEDULE_INTERVAL_MINUTES = 15;
const MAX_SCHEDULE_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_CALENDAR_DAY_COUNT = 14;
const DEFAULT_CALENDAR_POST_SPACING_MINUTES = 2 * 60;

export type PostingCalendarPost = {
  scheduledFor: string | null;
  createdAt: string;
  status: string;
};

export type PostingCalendarDay<TPost extends PostingCalendarPost> = {
  key: string;
  date: Date;
  posts: TPost[];
  plannedCount: number;
  postedCount: number;
  failedCount: number;
  isToday: boolean;
  isPast: boolean;
};

export function suggestScheduleIntervalMinutes(clipCount: number): number {
  if (clipCount <= 1) {
    return 0;
  }

  if (clipCount <= 5) {
    return 4 * 60;
  }

  if (clipCount <= 10) {
    return 3 * 60;
  }

  return 2 * 60;
}

export function normalizeScheduleIntervalMinutes(value: unknown, clipCount: number): number {
  const fallback = suggestScheduleIntervalMinutes(clipCount);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded <= 0) {
    return fallback;
  }

  return Math.min(MAX_SCHEDULE_INTERVAL_MINUTES, Math.max(MIN_SCHEDULE_INTERVAL_MINUTES, rounded));
}

export function buildClipSchedulePlan(
  clipIds: string[],
  scheduledFor: Date | null,
  intervalMinutes: number,
): Array<{ clipId: string; scheduledFor: Date | null }> {
  return clipIds.map((clipId, index) => ({
    clipId,
    scheduledFor: scheduledFor
      ? new Date(scheduledFor.getTime() + index * intervalMinutes * 60_000)
      : null,
  }));
}

export function formatScheduleInterval(minutes: number): string {
  if (minutes <= 0) {
    return "same time";
  }

  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${minutes} minutes`;
}

export function resolveCalendarDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Cannot build a calendar key for an invalid date.");
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfCalendarDay(date: Date): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Cannot build a calendar day from an invalid date.");
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function toDateTimeLocalInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

export function buildPostingCalendarDays<TPost extends PostingCalendarPost>(
  posts: TPost[],
  options: {
    startDate?: Date;
    dayCount?: number;
    now?: Date;
  } = {},
): Array<PostingCalendarDay<TPost>> {
  const now = options.now ?? new Date();
  const todayKey = resolveCalendarDayKey(now);
  const startDate = startOfCalendarDay(options.startDate ?? now);
  const dayCount = Math.max(1, Math.min(45, Math.round(options.dayCount ?? DEFAULT_CALENDAR_DAY_COUNT)));
  const postsByDay = new Map<string, TPost[]>();

  posts.forEach((post) => {
    if (!post.scheduledFor) {
      return;
    }

    const scheduledFor = new Date(post.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      return;
    }

    const key = resolveCalendarDayKey(scheduledFor);
    postsByDay.set(key, [...(postsByDay.get(key) ?? []), post]);
  });

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const key = resolveCalendarDayKey(date);
    const dayPosts = (postsByDay.get(key) ?? []).sort((left, right) => {
      const leftTime = left.scheduledFor ? new Date(left.scheduledFor).getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.scheduledFor ? new Date(right.scheduledFor).getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.createdAt.localeCompare(right.createdAt);
    });

    return {
      key,
      date,
      posts: dayPosts,
      plannedCount: dayPosts.filter((post) => post.status === "PLANNED" || post.status === "READY_FOR_MEDIA_TEAM").length,
      postedCount: dayPosts.filter((post) => post.status === "POSTED").length,
      failedCount: dayPosts.filter((post) => post.status === "FAILED" || post.status === "PRIVATE_ONLY_UNVERIFIED").length,
      isToday: key === todayKey,
      isPast: key < todayKey,
    };
  });
}

export function suggestNextCalendarSlot(input: {
  day: Date;
  existingPosts?: PostingCalendarPost[];
  now?: Date;
  preferredHour?: number;
  spacingMinutes?: number;
}): Date {
  const now = input.now ?? new Date();
  const preferredHour = Number.isFinite(input.preferredHour)
    ? Math.min(23, Math.max(0, Math.round(input.preferredHour ?? 18)))
    : 18;
  const spacingMinutes = Math.max(15, Math.round(input.spacingMinutes ?? DEFAULT_CALENDAR_POST_SPACING_MINUTES));
  const candidate = startOfCalendarDay(input.day);
  candidate.setHours(preferredHour, 0, 0, 0);

  const latestExistingPostTime = (input.existingPosts ?? [])
    .map((post) => post.scheduledFor ? new Date(post.scheduledFor).getTime() : Number.NaN)
    .filter((time) => Number.isFinite(time))
    .sort((left, right) => right - left)[0];

  if (latestExistingPostTime) {
    candidate.setTime(latestExistingPostTime + spacingMinutes * 60_000);
  }

  const minimumFutureTime = now.getTime() + 30 * 60_000;
  if (candidate.getTime() < minimumFutureTime) {
    candidate.setTime(minimumFutureTime);
    const remainder = candidate.getMinutes() % 15;
    if (remainder !== 0) {
      candidate.setMinutes(candidate.getMinutes() + (15 - remainder), 0, 0);
    } else {
      candidate.setSeconds(0, 0);
    }
  }

  return candidate;
}
