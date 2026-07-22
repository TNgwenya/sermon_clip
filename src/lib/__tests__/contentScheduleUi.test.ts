import { describe, expect, it } from "vitest";

import {
  buildContentScheduleSuccessCopy,
  getContentScheduleValidationMessage,
  isContentAssetScheduleCreatedDetail,
  resolveWrappedDialogFocusIndex,
  scheduledPostElementId,
  type ContentAssetScheduleCreatedDetail,
} from "@/lib/contentScheduleUi";

const futureSchedule = {
  scheduledFor: "2099-07-20T10:00",
  timezone: "Africa/Johannesburg",
  title: "Grace for today",
  caption: "Grace meets us here.",
};

function detail(
  automationMode: ContentAssetScheduleCreatedDetail["automationMode"],
): ContentAssetScheduleCreatedDetail {
  return {
    scheduledPostId: "scheduled-1",
    scheduledFor: futureSchedule.scheduledFor,
    timezone: futureSchedule.timezone,
    automationMode,
    title: futureSchedule.title,
    platformLabel: "Instagram",
  };
}

describe("generated-content scheduling UI", () => {
  it("returns clear client validation messages for required scheduling fields", () => {
    const now = new Date("2026-07-22T08:00:00.000Z");

    expect(getContentScheduleValidationMessage(futureSchedule, now)).toBeNull();
    expect(getContentScheduleValidationMessage({ ...futureSchedule, scheduledFor: "" }, now)).toBe("Choose a date and time.");
    expect(getContentScheduleValidationMessage({ ...futureSchedule, timezone: "not-a-timezone" }, now)).toBe(
      "Enter a valid timezone, such as Africa/Johannesburg.",
    );
    expect(getContentScheduleValidationMessage({ ...futureSchedule, title: "  " }, now)).toBe("Enter a post title.");
    expect(getContentScheduleValidationMessage({ ...futureSchedule, caption: "  " }, now)).toBe("Enter the post copy.");
  });

  it("wraps keyboard focus only when Tab reaches a dialog boundary", () => {
    expect(resolveWrappedDialogFocusIndex(0, 4, true)).toBe(3);
    expect(resolveWrappedDialogFocusIndex(3, 4, false)).toBe(0);
    expect(resolveWrappedDialogFocusIndex(1, 4, false)).toBeNull();
    expect(resolveWrappedDialogFocusIndex(-1, 4, false)).toBe(0);
    expect(resolveWrappedDialogFocusIndex(-1, 4, true)).toBe(3);
    expect(resolveWrappedDialogFocusIndex(0, 0, false)).toBeNull();
  });

  it("keeps manual and automatic success confirmations explicit", () => {
    const manual = buildContentScheduleSuccessCopy(detail("MANUAL"));
    const automatic = buildContentScheduleSuccessCopy(detail("AUTOMATIC"));

    expect(manual).toMatchObject({
      heading: "Manual handoff scheduled",
      description: "Grace for today is on the Instagram calendar for your media team to publish.",
    });
    expect(automatic).toMatchObject({
      heading: "Automatic post scheduled",
      description: "Grace for today is queued for Sermon Clip to publish to Instagram.",
    });
    expect(manual.scheduledTime).not.toBe("");
    expect(automatic.scheduledTime).toBe(manual.scheduledTime);
  });

  it("validates and targets a specific created calendar entry", () => {
    const created = detail("MANUAL");

    expect(isContentAssetScheduleCreatedDetail(created)).toBe(true);
    expect(isContentAssetScheduleCreatedDetail({ ...created, scheduledPostId: "" })).toBe(false);
    expect(scheduledPostElementId(created.scheduledPostId)).toBe("scheduled-post-scheduled-1");
  });
});
