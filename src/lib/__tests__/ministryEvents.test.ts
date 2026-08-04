import { describe, expect, it } from "vitest";

import {
  createEventSessionSchema,
  createMinistryEventSchema,
  eventDayNumber,
  eventSessionInstant,
  initialMinistryEventStatus,
  resolveEventSessionStatus,
} from "@/lib/ministryEvents";

describe("ministry event validation", () => {
  it("accepts a seven-day conference", () => {
    const result = createMinistryEventSchema.safeParse({
      name: "Kingdom Conference",
      eventType: "CONFERENCE",
      theme: "Lifted Eyes",
      description: "",
      venue: "Main auditorium",
      timezone: "Africa/Johannesburg",
      startDate: "2026-08-10",
      endDate: "2026-08-16",
      primaryBrandColor: "#204A3B",
      secondaryBrandColor: "",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an event whose end date precedes its start date", () => {
    const result = createMinistryEventSchema.safeParse({
      name: "Kingdom Conference",
      eventType: "CONFERENCE",
      theme: "",
      description: "",
      venue: "",
      timezone: "Africa/Johannesburg",
      startDate: "2026-08-10",
      endDate: "2026-08-09",
      primaryBrandColor: "",
      secondaryBrandColor: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.endDate?.[0]).toContain("end");
  });

  it("rejects calendar rollovers and out-of-range session times", () => {
    const event = createMinistryEventSchema.safeParse({
      name: "Kingdom Conference",
      eventType: "CONFERENCE",
      theme: "",
      description: "",
      venue: "",
      timezone: "Africa/Johannesburg",
      startDate: "2026-02-30",
      endDate: "2026-03-02",
      primaryBrandColor: "",
      secondaryBrandColor: "",
    });
    const session = createEventSessionSchema.safeParse({
      eventId: "event-1",
      title: "Evening celebration",
      sessionType: "PREACHING",
      speakerName: "",
      language: "English",
      sessionDate: "2026-08-10",
      startTime: "29:15",
      endTime: "",
      priority: "50",
      notes: "",
    });

    expect(event.success).toBe(false);
    expect(session.success).toBe(false);
  });

  it("validates session scheduling and resolves local time to UTC", () => {
    const result = createEventSessionSchema.safeParse({
      eventId: "event-1",
      title: "Evening celebration",
      sessionType: "PREACHING",
      speakerName: "Pastor Jane",
      language: "English",
      sessionDate: "2026-08-10",
      startTime: "18:30",
      endTime: "20:00",
      priority: "80",
      notes: "",
    });

    expect(result.success).toBe(true);
    expect(eventSessionInstant({
      sessionDate: "2026-08-10",
      time: "18:30",
      timezone: "Africa/Johannesburg",
    })?.toISOString()).toBe("2026-08-10T16:30:00.000Z");
    expect(eventDayNumber(
      new Date("2026-08-10T00:00:00.000Z"),
      new Date("2026-08-12T00:00:00.000Z"),
    )).toBe(3);
  });
});

describe("ministry event status", () => {
  it("derives upcoming, active, and completed from event dates", () => {
    const now = new Date("2026-08-12T08:00:00.000Z");
    expect(initialMinistryEventStatus({
      startDate: "2026-08-13",
      endDate: "2026-08-15",
      timezone: "Africa/Johannesburg",
      now,
    })).toBe("UPCOMING");
    expect(initialMinistryEventStatus({
      startDate: "2026-08-10",
      endDate: "2026-08-15",
      timezone: "Africa/Johannesburg",
      now,
    })).toBe("ACTIVE");
    expect(initialMinistryEventStatus({
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      timezone: "Africa/Johannesburg",
      now,
    })).toBe("COMPLETED");
  });

  it("distinguishes missing, uploading, failed, review, and ready sessions", () => {
    expect(resolveEventSessionStatus({ sessionStatus: "PLANNED", sermon: null }).code)
      .toBe("AWAITING_RECORDING");
    expect(resolveEventSessionStatus({
      sessionStatus: "PLANNED",
      sermon: { status: "CREATED", sourceAsset: { status: "UPLOADING" } },
    }).code).toBe("UPLOADING");
    expect(resolveEventSessionStatus({
      sessionStatus: "PLANNED",
      sermon: { status: "FAILED" },
    }).code).toBe("NEEDS_ATTENTION");
    expect(resolveEventSessionStatus({
      sessionStatus: "PLANNED",
      sermon: { status: "CLIPS_GENERATED", clipCount: 3 },
    }).code).toBe("READY_FOR_REVIEW");
    expect(resolveEventSessionStatus({
      sessionStatus: "PLANNED",
      sermon: { status: "EXPORTED", readyContentAssetCount: 1 },
    }).code).toBe("CONTENT_READY");
  });
});
