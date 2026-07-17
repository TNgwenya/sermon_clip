import { describe, expect, it } from "vitest";

import { buildMediaRetentionDecisions } from "../media-retention-core";

const now = new Date("2026-07-17T12:00:00.000Z");

describe("media retention decisions", () => {
  it("cleans only old, idle projects that have no scheduled post", () => {
    const decisions = buildMediaRetentionDecisions({
      now,
      retentionDays: 7,
      projects: [
        { id: "old", title: "Old", updatedAt: new Date("2026-07-01T12:00:00.000Z"), hasActiveProcessingJob: false, hasScheduledPost: false },
        { id: "recent", title: "Recent", updatedAt: new Date("2026-07-16T12:00:00.000Z"), hasActiveProcessingJob: false, hasScheduledPost: false },
        { id: "working", title: "Working", updatedAt: new Date("2026-07-01T12:00:00.000Z"), hasActiveProcessingJob: true, hasScheduledPost: false },
        { id: "scheduled", title: "Scheduled", updatedAt: new Date("2026-07-01T12:00:00.000Z"), hasActiveProcessingJob: false, hasScheduledPost: true },
      ],
    });

    expect(decisions.map(({ project, eligible, reason }) => [project.id, eligible, reason])).toEqual([
      ["old", true, "eligible"],
      ["recent", false, "recent"],
      ["working", false, "active-processing"],
      ["scheduled", false, "scheduled-post"],
    ]);
  });
});
