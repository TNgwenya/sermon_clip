const MIN_SCHEDULE_INTERVAL_MINUTES = 15;
const MAX_SCHEDULE_INTERVAL_MINUTES = 24 * 60;

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
