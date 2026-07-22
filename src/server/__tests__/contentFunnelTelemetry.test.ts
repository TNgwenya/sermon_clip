import { describe, expect, it } from "vitest";

import {
  aggregateContentFunnelMetrics,
  sanitizeContentFunnelMetadata,
} from "@/server/contentFunnelTelemetry";

describe("content funnel telemetry", () => {
  it("keeps only privacy-safe allowlisted metadata", () => {
    const metadata = sanitizeContentFunnelMetadata({
      generationMode: "CONTENT_PACK",
      requestedCount: 14,
      generatedCount: 12,
      shortfallTypes: ["QUOTE_GRAPHIC"],
      // The runtime guard must ignore extra properties even if a caller evades TypeScript.
      rawSermonText: "This must never be persisted",
      content: "Nor this",
    } as never);

    expect(metadata).toMatchObject({
      generationMode: "CONTENT_PACK",
      requestedCount: 14,
      generatedCount: 12,
      shortfallTypes: ["QUOTE_GRAPHIC"],
    });
    expect(metadata).not.toHaveProperty("rawSermonText");
    expect(metadata).not.toHaveProperty("content");
  });

  it("aggregates completion, scheduling, and available journey times", () => {
    const at = (value: string) => new Date(value);
    const metrics = aggregateContentFunnelMetrics([
      { eventType: "GENERATION_REQUESTED", sermonId: "sermon-1", opportunityId: null, contentAssetId: null, processingJobId: "job-1", occurredAt: at("2026-07-22T08:00:00.000Z") },
      { eventType: "GENERATION_COMPLETED", sermonId: "sermon-1", opportunityId: null, contentAssetId: null, processingJobId: "job-1", occurredAt: at("2026-07-22T08:02:00.000Z") },
      { eventType: "GENERATION_SHORTFALL", sermonId: "sermon-1", opportunityId: null, contentAssetId: null, processingJobId: "job-1", occurredAt: at("2026-07-22T08:02:00.000Z") },
      { eventType: "PREVIEWED", sermonId: "sermon-1", opportunityId: "opportunity-1", contentAssetId: null, processingJobId: null, occurredAt: at("2026-07-22T08:05:00.000Z") },
      { eventType: "EDITED", sermonId: "sermon-1", opportunityId: "opportunity-1", contentAssetId: null, processingJobId: null, occurredAt: at("2026-07-22T08:06:00.000Z") },
      { eventType: "APPROVED", sermonId: "sermon-1", opportunityId: "opportunity-1", contentAssetId: null, processingJobId: null, occurredAt: at("2026-07-22T08:10:00.000Z") },
      { eventType: "SCHEDULE_SUCCEEDED", sermonId: "sermon-1", opportunityId: "opportunity-1", contentAssetId: "asset-1", processingJobId: null, occurredAt: at("2026-07-22T08:30:00.000Z") },
      { eventType: "SCHEDULE_FAILED", sermonId: "sermon-2", opportunityId: "opportunity-2", contentAssetId: "asset-2", processingJobId: null, occurredAt: at("2026-07-22T08:30:00.000Z") },
    ]);

    expect(metrics).toMatchObject({
      generationRequested: 1,
      generationCompleted: 1,
      generationShortfall: 1,
      generationCompletionRate: 1,
      previews: 1,
      edits: 1,
      approvals: 1,
      schedulesSucceeded: 1,
      schedulesFailed: 1,
      scheduleSuccessRate: 0.5,
      averageTimeToApprovedMs: 10 * 60_000,
      averageTimeToScheduledMs: 30 * 60_000,
    });
  });
});
