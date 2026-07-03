import { describe, expect, it } from "vitest";

import {
  buildPostingCalendarDays,
  buildClipSchedulePlan,
  formatScheduleInterval,
  normalizeScheduleIntervalMinutes,
  resolveCalendarDayKey,
  suggestNextCalendarSlot,
  suggestScheduleIntervalMinutes,
  toDateTimeLocalInputValue,
} from "@/lib/postingSchedule";

describe("posting schedule helpers", () => {
  it("suggests wider spacing for small batches", () => {
    expect(suggestScheduleIntervalMinutes(1)).toBe(0);
    expect(suggestScheduleIntervalMinutes(5)).toBe(240);
    expect(suggestScheduleIntervalMinutes(8)).toBe(180);
    expect(suggestScheduleIntervalMinutes(12)).toBe(120);
  });

  it("normalizes custom spacing while keeping a useful fallback", () => {
    expect(normalizeScheduleIntervalMinutes(undefined, 5)).toBe(240);
    expect(normalizeScheduleIntervalMinutes(5, 5)).toBe(15);
    expect(normalizeScheduleIntervalMinutes(180, 5)).toBe(180);
    expect(normalizeScheduleIntervalMinutes(99999, 5)).toBe(1440);
  });

  it("stagger schedules by clip while preserving the same time across platforms later", () => {
    const start = new Date("2026-06-29T12:00:00.000Z");

    expect(buildClipSchedulePlan(["clip-1", "clip-2", "clip-3"], start, 240)).toEqual([
      { clipId: "clip-1", scheduledFor: new Date("2026-06-29T12:00:00.000Z") },
      { clipId: "clip-2", scheduledFor: new Date("2026-06-29T16:00:00.000Z") },
      { clipId: "clip-3", scheduledFor: new Date("2026-06-29T20:00:00.000Z") },
    ]);
  });

  it("formats spacing for the scheduling UI", () => {
    expect(formatScheduleInterval(240)).toBe("4 hours");
    expect(formatScheduleInterval(1440)).toBe("1 day");
    expect(formatScheduleInterval(45)).toBe("45 minutes");
  });

  it("groups scheduled posts into calendar days", () => {
    const days = buildPostingCalendarDays([
      {
        scheduledFor: "2026-07-03T16:00:00.000Z",
        createdAt: "2026-07-01T08:00:00.000Z",
        status: "PLANNED",
      },
      {
        scheduledFor: "2026-07-04T08:00:00.000Z",
        createdAt: "2026-07-01T09:00:00.000Z",
        status: "POSTED",
      },
      {
        scheduledFor: null,
        createdAt: "2026-07-01T10:00:00.000Z",
        status: "READY_FOR_MEDIA_TEAM",
      },
    ], {
      startDate: new Date("2026-07-03T10:00:00.000Z"),
      dayCount: 2,
      now: new Date("2026-07-03T11:00:00.000Z"),
    });

    expect(days).toHaveLength(2);
    expect(days[0].key).toBe(resolveCalendarDayKey(new Date("2026-07-03T10:00:00.000Z")));
    expect(days[0].plannedCount).toBe(1);
    expect(days[0].postedCount).toBe(0);
    expect(days[0].isToday).toBe(true);
    expect(days[1].postedCount).toBe(1);
  });

  it("suggests the next open calendar slot after existing posts", () => {
    const slot = suggestNextCalendarSlot({
      day: new Date("2026-07-05T00:00:00.000Z"),
      now: new Date("2026-07-03T10:00:00.000Z"),
      existingPosts: [
        {
          scheduledFor: "2026-07-05T16:00:00.000Z",
          createdAt: "2026-07-01T08:00:00.000Z",
          status: "PLANNED",
        },
      ],
      spacingMinutes: 120,
    });

    expect(slot.toISOString()).toBe("2026-07-05T18:00:00.000Z");
  });

  it("rounds calendar slots forward when the preferred time has passed", () => {
    const slot = suggestNextCalendarSlot({
      day: new Date("2026-07-03T00:00:00.000Z"),
      now: new Date("2026-07-03T17:49:00.000Z"),
      preferredHour: 12,
    });

    expect(slot.toISOString()).toBe("2026-07-03T18:30:00.000Z");
  });

  it("formats dates for datetime-local inputs", () => {
    expect(toDateTimeLocalInputValue(new Date("2026-07-03T18:30:00.000Z"))).toMatch(/2026-07-03T/);
  });
});
