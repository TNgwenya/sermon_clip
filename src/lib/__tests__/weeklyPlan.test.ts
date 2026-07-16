import { describe, expect, it } from "vitest";

import {
  buildWeeklyPlan,
  deriveSermonPointKey,
  findExactScheduleDuplicateWarning,
  findRepeatedSermonPointWarnings,
  isValidIanaTimeZone,
  localDateTimeToUtcInstant,
  nextMondayDateInput,
  normalizeWeeklyPlanFrequency,
  resolveWeeklyPlanPlatform,
  type WeeklyPlanCandidate,
} from "@/lib/weeklyPlan";

function candidate(input: Partial<WeeklyPlanCandidate> & Pick<WeeklyPlanCandidate, "id" | "sourceKind" | "title">): WeeklyPlanCandidate {
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    sermonId: input.sermonId ?? "sermon-1",
    title: input.title,
    caption: input.caption ?? `${input.title} caption`,
    contentType: input.contentType ?? (input.sourceKind === "CLIP" ? "VIDEO_CLIP" : "DEVOTIONAL"),
    pointKey: input.pointKey ?? deriveSermonPointKey({ title: input.title }),
    relatedScripture: input.relatedScripture,
    suggestedPlatform: input.suggestedPlatform,
    qualityScore: input.qualityScore ?? 75,
    alreadyScheduled: input.alreadyScheduled ?? [],
  };
}

describe("weekly plan", () => {
  it("builds a mixed plan across the requested week", () => {
    const result = buildWeeklyPlan({
      sermonId: "sermon-1",
      weekStart: "2026-07-20",
      platforms: ["INSTAGRAM", "FACEBOOK"],
      frequency: 5,
      objective: "DISCIPLESHIP",
      candidates: [
        candidate({ id: "asset-1", sourceKind: "CONTENT_ASSET", title: "Five-day devotional", contentType: "DEVOTIONAL" }),
        candidate({ id: "clip-1", sourceKind: "CLIP", title: "Walk in faith" }),
        candidate({ id: "asset-2", sourceKind: "CONTENT_ASSET", title: "Small-group discussion", contentType: "DISCUSSION" }),
        candidate({ id: "clip-2", sourceKind: "CLIP", title: "Grace changes us" }),
        candidate({ id: "asset-3", sourceKind: "CONTENT_ASSET", title: "Prayer for the week", contentType: "PRAYER" }),
      ],
    });

    expect(result).toHaveLength(5);
    expect(result.some((item) => item.sourceKind === "CLIP")).toBe(true);
    expect(result.some((item) => item.sourceKind === "CONTENT_ASSET")).toBe(true);
    expect(new Set(result.map((item) => item.platform))).toEqual(new Set(["INSTAGRAM", "FACEBOOK"]));
    expect(result.every((item) => item.scheduledFor.startsWith("2026-07"))).toBe(true);
  });

  it("warns when an exact asset already has the same platform nearby", () => {
    const result = buildWeeklyPlan({
      sermonId: "sermon-1",
      weekStart: "2026-07-20",
      platforms: ["INSTAGRAM"],
      frequency: 1,
      objective: "REACH",
      candidates: [candidate({
        id: "asset-1",
        sourceKind: "CONTENT_ASSET",
        title: "Quote card",
        suggestedPlatform: "INSTAGRAM",
        alreadyScheduled: [{
          platform: "INSTAGRAM",
          scheduledFor: "2026-07-21T16:00:00.000Z",
          status: "READY_FOR_MEDIA_TEAM",
        }],
      })],
    });

    expect(result[0].duplicateWarnings.join(" ")).toContain("exact item");
  });

  it("derives stable point keys and detects repeated points", () => {
    const pointKey = deriveSermonPointKey({
      title: "Faith in the middle of the storm",
      relatedScripture: "Mark 4:35-41",
    });
    expect(pointKey).toBe("scripture:mark 4 35 41");
    expect(findRepeatedSermonPointWarnings([
      { sourceId: "a", title: "Faith in storms", pointKey },
      { sourceId: "b", title: "Jesus calms storms", pointKey },
    ])).toHaveLength(1);
    expect(normalizeWeeklyPlanFrequency(99)).toBe(7);
    expect(nextMondayDateInput(new Date(2026, 6, 16, 10, 0, 0))).toBe("2026-07-20");
    expect(resolveWeeklyPlanPlatform({
      planned: "INSTAGRAM",
      override: "FACEBOOK",
      selectedPlatforms: ["INSTAGRAM"],
    })).toBe("INSTAGRAM");
    const scheduledCandidate = candidate({
      id: "scheduled",
      sourceKind: "CONTENT_ASSET",
      title: "Scheduled asset",
      alreadyScheduled: [{
        platform: "FACEBOOK",
        scheduledFor: "2026-07-21T16:00:00.000Z",
        status: "READY_FOR_MEDIA_TEAM",
      }],
    });
    expect(findExactScheduleDuplicateWarning({
      candidate: scheduledCandidate,
      platform: "INSTAGRAM",
      scheduledFor: "2026-07-21T16:00:00.000Z",
    })).toBeNull();
    expect(findExactScheduleDuplicateWarning({
      candidate: scheduledCandidate,
      platform: "FACEBOOK",
      scheduledFor: "2026-07-21T16:00:00.000Z",
    })).toContain("exact item");
  });

  it("converts weekly wall-clock slots into real instants in the selected IANA timezone", () => {
    const johannesburg = buildWeeklyPlan({
      sermonId: "sermon-1",
      weekStart: "2026-07-20",
      platforms: ["FACEBOOK"],
      frequency: 1,
      objective: "DISCIPLESHIP",
      timezone: "Africa/Johannesburg",
      candidates: [candidate({ id: "guide-jhb", sourceKind: "CONTENT_ASSET", title: "Wednesday guide", contentType: "GUIDE" })],
    });
    const newYork = buildWeeklyPlan({
      sermonId: "sermon-1",
      weekStart: "2026-07-20",
      platforms: ["FACEBOOK"],
      frequency: 1,
      objective: "DISCIPLESHIP",
      timezone: "America/New_York",
      candidates: [candidate({ id: "guide-ny", sourceKind: "CONTENT_ASSET", title: "Wednesday guide", contentType: "GUIDE" })],
    });

    expect(johannesburg[0].scheduledFor).toBe("2026-07-22T16:00:00.000Z");
    expect(newYork[0].scheduledFor).toBe("2026-07-22T22:00:00.000Z");
    expect(isValidIanaTimeZone("Africa/Johannesburg")).toBe(true);
    expect(isValidIanaTimeZone("Africa/Not_A_Zone")).toBe(false);
  });

  it("uses the offset in effect on the requested local date across daylight-saving changes", () => {
    expect(localDateTimeToUtcInstant({
      year: 2026,
      month: 10,
      day: 21,
      hour: 18,
      minute: 0,
    }, "Europe/London")?.toISOString()).toBe("2026-10-21T17:00:00.000Z");
    expect(localDateTimeToUtcInstant({
      year: 2026,
      month: 10,
      day: 28,
      hour: 18,
      minute: 0,
    }, "Europe/London")?.toISOString()).toBe("2026-10-28T18:00:00.000Z");
  });
});
