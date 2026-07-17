const MIN_SCHEDULE_INTERVAL_MINUTES = 15;
const MAX_SCHEDULE_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_CALENDAR_DAY_COUNT = 14;
const DEFAULT_CALENDAR_POST_SPACING_MINUTES = 2 * 60;

type LocalCalendarDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInTimeZone(instant: Date, timezone: string): LocalCalendarDateTime | null {
  const values = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const result = {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function matchesLocalCalendarDateTime(
  actual: LocalCalendarDateTime | null,
  expected: LocalCalendarDateTime,
): boolean {
  return Boolean(actual && Object.entries(expected).every(([key, value]) => (
    actual[key as keyof LocalCalendarDateTime] === value
  )));
}

export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return Boolean(timezone.trim());
  } catch {
    return false;
  }
}

/**
 * Resolves a datetime-local value as wall-clock time in the selected IANA
 * timezone. ISO strings with an explicit offset remain supported for API
 * clients that already send an absolute instant.
 */
export function resolveScheduledInstant(value: unknown, timezone: string): Date | null {
  if (typeof value !== "string" || value.trim().length === 0 || !isValidIanaTimeZone(timezone)) {
    return null;
  }

  const normalized = value.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) {
    const instant = new Date(normalized);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) return null;
  const local: LocalCalendarDateTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const desiredUtcShape = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const desiredShape = new Date(desiredUtcShape);
  if (
    desiredShape.getUTCFullYear() !== local.year
    || desiredShape.getUTCMonth() + 1 !== local.month
    || desiredShape.getUTCDate() !== local.day
    || desiredShape.getUTCHours() !== local.hour
    || desiredShape.getUTCMinutes() !== local.minute
    || desiredShape.getUTCSeconds() !== local.second
  ) {
    return null;
  }

  let instantMs = desiredUtcShape;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const formatted = partsInTimeZone(new Date(instantMs), timezone);
    if (!formatted) return null;
    const formattedUtcShape = Date.UTC(
      formatted.year,
      formatted.month - 1,
      formatted.day,
      formatted.hour,
      formatted.minute,
      formatted.second,
    );
    const adjustment = desiredUtcShape - formattedUtcShape;
    if (adjustment === 0) break;
    instantMs += adjustment;
  }

  const resolved = new Date(instantMs);
  if (!matchesLocalCalendarDateTime(partsInTimeZone(resolved, timezone), local)) return null;

  // A repeated wall-clock time during a DST fallback identifies two real
  // instants. Reject it instead of silently choosing the earlier/later post.
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    if (offsetMinutes === 0) continue;
    const alternative = new Date(instantMs + offsetMinutes * 60_000);
    if (matchesLocalCalendarDateTime(partsInTimeZone(alternative, timezone), local)) return null;
  }

  return resolved;
}

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

export function toDateTimeInputValueInTimeZone(date: Date, timezone: string): string {
  if (Number.isNaN(date.getTime()) || !isValidIanaTimeZone(timezone)) return "";
  const parts = partsInTimeZone(date, timezone);
  if (!parts) return "";
  return [
    String(parts.year).padStart(4, "0"),
    "-",
    String(parts.month).padStart(2, "0"),
    "-",
    String(parts.day).padStart(2, "0"),
    "T",
    String(parts.hour).padStart(2, "0"),
    ":",
    String(parts.minute).padStart(2, "0"),
  ].join("");
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
