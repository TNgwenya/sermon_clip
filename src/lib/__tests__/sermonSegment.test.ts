import { describe, expect, it } from "vitest";

import {
  formatSecondsForPastorView,
  hasSermonSegmentWindow,
  parseSermonTimestampInput,
  shouldShowLongRecordingWarning,
  toSermonSegmentRelativeRange,
  validateSermonSegmentRange,
} from "@/lib/sermonSegment";

describe("sermon segment timestamp helpers", () => {
  it("parses mm:ss and hh:mm:ss inputs", () => {
    expect(parseSermonTimestampInput("52:30")).toEqual({ seconds: 3150 });
    expect(parseSermonTimestampInput("1:12:45")).toEqual({ seconds: 4365 });
    expect(parseSermonTimestampInput("00:52:30")).toEqual({ seconds: 3150 });
  });

  it("returns friendly parsing errors for invalid input", () => {
    const parsed = parseSermonTimestampInput("bad-value");
    expect(parsed.seconds).toBeNull();
    expect(parsed.error).toContain("Use a format like 52:30 or 1:12:45");
  });

  it("validates start and end ordering", () => {
    const validation = validateSermonSegmentRange({
      sermonStartSeconds: 200,
      sermonEndSeconds: 120,
      knownDurationSeconds: 3600,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.endError).toBe("Sermon end time must be after the start time.");
  });

  it("validates end against known duration", () => {
    const validation = validateSermonSegmentRange({
      sermonStartSeconds: 300,
      sermonEndSeconds: 3900,
      knownDurationSeconds: 3600,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.endError).toBe("Sermon end time is longer than the video duration.");
  });

  it("keeps existing workflow valid when no segment window is provided", () => {
    const validation = validateSermonSegmentRange({
      sermonStartSeconds: null,
      sermonEndSeconds: null,
      knownDurationSeconds: null,
    });

    expect(validation.isValid).toBe(true);
    expect(hasSermonSegmentWindow(null, null, false)).toBe(false);
  });

  it("flags long recordings at sixty minutes or more", () => {
    expect(shouldShowLongRecordingWarning(3599)).toBe(false);
    expect(shouldShowLongRecordingWarning(3600)).toBe(true);
  });

  it("maps clip timing from original video into sermon-relative timing", () => {
    const relative = toSermonSegmentRelativeRange(3510, 3630, 3300);
    expect(relative).toEqual({ startTimeSeconds: 210, endTimeSeconds: 330 });
  });

  it("formats time values for pastor-facing display", () => {
    expect(formatSecondsForPastorView(3150)).toBe("52:30");
    expect(formatSecondsForPastorView(4365)).toBe("1:12:45");
  });
});
