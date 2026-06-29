import { describe, expect, it } from "vitest";

import {
  buildClipSchedulePlan,
  formatScheduleInterval,
  normalizeScheduleIntervalMinutes,
  suggestScheduleIntervalMinutes,
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
});
