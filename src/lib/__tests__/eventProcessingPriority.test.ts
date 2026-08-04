import { describe, expect, it } from "vitest";

import { sortEventAwareProcessingCandidates } from "@/lib/eventProcessingPriority";

describe("event processing priority", () => {
  it("places active same-day sessions before normal and upcoming jobs", () => {
    const candidates = sortEventAwareProcessingCandidates([
      { id: "normal", createdAt: new Date("2026-08-01T08:00:00Z") },
      {
        id: "upcoming",
        createdAt: new Date("2026-08-01T09:00:00Z"),
        sermon: {
          eventSession: {
            priority: 80,
            scheduledStartAt: new Date("2026-08-03T08:00:00Z"),
            status: "PLANNED",
            event: { status: "UPCOMING" },
          },
        },
      },
      {
        id: "active",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        sermon: {
          eventSession: {
            priority: 80,
            scheduledStartAt: new Date("2026-08-01T10:00:00Z"),
            status: "PLANNED",
            event: { status: "ACTIVE" },
          },
        },
      },
    ]);

    expect(candidates.map((candidate) => candidate.id)).toEqual(["active", "upcoming", "normal"]);
  });

  it("keeps FIFO order when no event priority applies", () => {
    const candidates = sortEventAwareProcessingCandidates([
      { id: "later", createdAt: new Date("2026-08-01T10:00:00Z") },
      { id: "earlier", createdAt: new Date("2026-08-01T08:00:00Z") },
    ]);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["earlier", "later"]);
  });
});
