import { describe, expect, it } from "vitest";

import {
  buildContentOpportunityJobIntentKey,
  buildContentOpportunityJobStatusView,
  buildQueuedContentOpportunityJobSummary,
  completeContentOpportunityJobSummary,
  formatContentOpportunityGenerationResult,
  parseContentOpportunityJobSummary,
} from "@/lib/contentOpportunityJobs";

describe("content opportunity processing job contract", () => {
  it("builds a stable intent key regardless of quantity insertion order", () => {
    const first = buildContentOpportunityJobIntentKey({
      mode: "CONTENT_PACK",
      presetId: "WEEKLY_CONTENT_PACK",
      replaceDefaultQuantities: true,
      quantities: { QUOTE_GRAPHIC: 3, SERMON_SUMMARY: 1 },
    });
    const second = buildContentOpportunityJobIntentKey({
      mode: "CONTENT_PACK",
      presetId: "WEEKLY_CONTENT_PACK",
      replaceDefaultQuantities: true,
      quantities: { SERMON_SUMMARY: 1, QUOTE_GRAPHIC: 3 },
    });

    expect(first).toBe(second);
    expect(first).not.toContain("sermon wording");
  });

  it("checkpoints completion and reports repair passes and each shortfall honestly", () => {
    const queued = buildQueuedContentOpportunityJobSummary({ mode: "REGENERATE" }, new Date("2026-07-22T08:00:00.000Z"));
    const completed = completeContentOpportunityJobSummary(queued, {
      opportunityCount: 4,
      archivedCount: 2,
      reusedExistingOpportunities: false,
      complete: false,
      repairPasses: 2,
      requestedQuantities: { QUOTE_GRAPHIC: 3, SCRIPTURE_GRAPHIC: 2 },
      generatedQuantities: { QUOTE_GRAPHIC: 2, SCRIPTURE_GRAPHIC: 1 },
      shortfalls: [
        { opportunityType: "QUOTE_GRAPHIC", requested: 3, fulfilled: 2, missing: 1, reasons: [] },
        { opportunityType: "SCRIPTURE_GRAPHIC", requested: 2, fulfilled: 1, missing: 1, reasons: [] },
      ],
    }, new Date("2026-07-22T08:01:00.000Z"));

    expect(parseContentOpportunityJobSummary(completed)).toEqual(completed);
    expect(completed.progress).toMatchObject({ stage: "COMPLETED", percent: 100 });
    const message = formatContentOpportunityGenerationResult(completed.result!);
    expect(message).toMatch(/incomplete/i);
    expect(message).toMatch(/quote graphic: 1 missing/i);
    expect(message).toMatch(/scripture graphic: 1 missing/i);
    expect(message).toMatch(/repair ran 2 times/i);
  });

  it("never presents a pending job as completed", () => {
    const view = buildContentOpportunityJobStatusView({
      status: "PENDING",
      generationSummary: buildQueuedContentOpportunityJobSummary({ mode: "GENERATE" }),
    });

    expect(view.title).toMatch(/queued/i);
    expect(view.message).toMatch(/no drafts.*complete/i);
    expect(view.progressPercent).toBe(0);
  });
});
