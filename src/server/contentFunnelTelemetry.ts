import type {
  ContentFunnelEventType,
  ContentOpportunityType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type ContentFunnelTelemetryMetadata = {
  generationMode?: "GENERATE" | "REGENERATE" | "CONTENT_PACK" | "REGENERATE_TYPE";
  presetId?: string | null;
  opportunityType?: ContentOpportunityType | null;
  assetType?: string | null;
  platform?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  complete?: boolean;
  queueReused?: boolean;
  queueIntentConflict?: boolean;
  repairPasses?: number;
  requestedCount?: number;
  generatedCount?: number;
  archivedCount?: number;
  missingCount?: number;
  shortfallTypes?: ContentOpportunityType[];
  renderedFileCount?: number;
  automationMode?: "MANUAL" | "AUTOMATIC";
  failureCode?: string;
};

export type RecordContentFunnelEventInput = {
  eventType: ContentFunnelEventType;
  sermonId?: string | null;
  opportunityId?: string | null;
  contentAssetId?: string | null;
  scheduledPostId?: string | null;
  processingJobId?: string | null;
  dedupeKey?: string | null;
  durationMs?: number | null;
  metadata?: ContentFunnelTelemetryMetadata;
  occurredAt?: Date;
};

function safeId(value: string | null | undefined): string | null {
  const normalized = value?.trim().slice(0, 200);
  return normalized || null;
}

function safeToken(value: string | null | undefined, maxLength = 80): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, maxLength);
  return normalized || null;
}

function safeCount(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

export function sanitizeContentFunnelMetadata(
  metadata: ContentFunnelTelemetryMetadata | undefined,
): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined;
  const sanitized = {
    generationMode: metadata.generationMode,
    presetId: safeToken(metadata.presetId),
    opportunityType: safeToken(metadata.opportunityType),
    assetType: safeToken(metadata.assetType),
    platform: safeToken(metadata.platform),
    fromStatus: safeToken(metadata.fromStatus),
    toStatus: safeToken(metadata.toStatus),
    complete: metadata.complete,
    queueReused: metadata.queueReused,
    queueIntentConflict: metadata.queueIntentConflict,
    repairPasses: safeCount(metadata.repairPasses),
    requestedCount: safeCount(metadata.requestedCount),
    generatedCount: safeCount(metadata.generatedCount),
    archivedCount: safeCount(metadata.archivedCount),
    missingCount: safeCount(metadata.missingCount),
    shortfallTypes: metadata.shortfallTypes?.map((item) => safeToken(item)).filter(Boolean),
    renderedFileCount: safeCount(metadata.renderedFileCount),
    automationMode: metadata.automationMode,
    failureCode: safeToken(metadata.failureCode),
  };
  const entries = Object.entries(sanitized).filter(([, value]) => value !== undefined && value !== null);
  return entries.length > 0 ? Object.fromEntries(entries) as Prisma.InputJsonObject : undefined;
}

/**
 * Records only allowlisted scalar/count metadata. This function is deliberately
 * best-effort so analytics can never block a pastor's publishing workflow.
 */
export async function recordContentFunnelEvent(input: RecordContentFunnelEventInput): Promise<void> {
  try {
    const delegate = (prisma as unknown as {
      contentFunnelEvent?: { createMany: typeof prisma.contentFunnelEvent.createMany };
    }).contentFunnelEvent;
    // Lightweight action tests intentionally mock only the domain delegates
    // under test. Missing analytics support must behave like telemetry being
    // unavailable, not like a product-flow failure.
    if (!delegate) return;
    await delegate.createMany({
      data: [{
        eventType: input.eventType,
        sermonId: safeId(input.sermonId),
        opportunityId: safeId(input.opportunityId),
        contentAssetId: safeId(input.contentAssetId),
        scheduledPostId: safeId(input.scheduledPostId),
        processingJobId: safeId(input.processingJobId),
        dedupeKey: safeId(input.dedupeKey),
        durationMs: safeCount(input.durationMs),
        metadataJson: sanitizeContentFunnelMetadata(input.metadata),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      }],
      // Repeated previews and idempotent worker checkpoints are expected.
      // Avoid raising/logging a unique-key exception for those normal paths.
      skipDuplicates: true,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code !== "P2002") {
      console.warn("Content funnel telemetry could not be recorded.", {
        eventType: input.eventType,
        code: code || "UNKNOWN",
      });
    }
  }
}

export type ContentFunnelMetricEvent = {
  eventType: ContentFunnelEventType;
  sermonId: string | null;
  opportunityId: string | null;
  contentAssetId: string | null;
  processingJobId: string | null;
  occurredAt: Date;
};

export type ContentFunnelReviewMetrics = {
  generationRequested: number;
  generationCompleted: number;
  generationShortfall: number;
  generationCompletionRate: number | null;
  previews: number;
  edits: number;
  approvals: number;
  reapprovalsRequired: number;
  designsSaved: number;
  designsRendered: number;
  schedulesSucceeded: number;
  schedulesFailed: number;
  scheduleSuccessRate: number | null;
  averageTimeToApprovedMs: number | null;
  averageTimeToScheduledMs: number | null;
  approvedJourneyCount: number;
  scheduledJourneyCount: number;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function aggregateContentFunnelMetrics(
  events: ContentFunnelMetricEvent[],
): ContentFunnelReviewMetrics {
  const count = (type: ContentFunnelEventType) => events.filter((event) => event.eventType === type).length;
  const generationRequested = count("GENERATION_REQUESTED");
  const generationCompleted = count("GENERATION_COMPLETED");
  const schedulesSucceeded = count("SCHEDULE_SUCCEEDED");
  const schedulesFailed = count("SCHEDULE_FAILED");
  const firstGenerationBySermon = new Map<string, number>();
  const firstApprovalBySermon = new Map<string, number>();
  const firstScheduleBySermon = new Map<string, number>();

  for (const event of [...events].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())) {
    if (!event.sermonId) continue;
    const timestamp = event.occurredAt.getTime();
    if (event.eventType === "GENERATION_REQUESTED" && !firstGenerationBySermon.has(event.sermonId)) {
      firstGenerationBySermon.set(event.sermonId, timestamp);
    } else if (event.eventType === "APPROVED" && !firstApprovalBySermon.has(event.sermonId)) {
      firstApprovalBySermon.set(event.sermonId, timestamp);
    } else if (event.eventType === "SCHEDULE_SUCCEEDED" && !firstScheduleBySermon.has(event.sermonId)) {
      firstScheduleBySermon.set(event.sermonId, timestamp);
    }
  }

  const approvedDurations = Array.from(firstApprovalBySermon, ([sermonId, approvedAt]) => {
    const requestedAt = firstGenerationBySermon.get(sermonId);
    return requestedAt === undefined || approvedAt < requestedAt ? null : approvedAt - requestedAt;
  }).filter((duration): duration is number => duration !== null);
  const scheduledDurations = Array.from(firstScheduleBySermon, ([sermonId, scheduledAt]) => {
    const requestedAt = firstGenerationBySermon.get(sermonId);
    return requestedAt === undefined || scheduledAt < requestedAt ? null : scheduledAt - requestedAt;
  }).filter((duration): duration is number => duration !== null);

  return {
    generationRequested,
    generationCompleted,
    generationShortfall: count("GENERATION_SHORTFALL"),
    generationCompletionRate: generationRequested > 0
      ? Math.min(1, generationCompleted / generationRequested)
      : null,
    previews: count("PREVIEWED"),
    edits: count("EDITED"),
    approvals: count("APPROVED"),
    reapprovalsRequired: count("REAPPROVAL_REQUIRED"),
    designsSaved: count("DESIGN_SAVED"),
    designsRendered: count("DESIGN_RENDERED"),
    schedulesSucceeded,
    schedulesFailed,
    scheduleSuccessRate: schedulesSucceeded + schedulesFailed > 0
      ? schedulesSucceeded / (schedulesSucceeded + schedulesFailed)
      : null,
    averageTimeToApprovedMs: average(approvedDurations),
    averageTimeToScheduledMs: average(scheduledDurations),
    approvedJourneyCount: approvedDurations.length,
    scheduledJourneyCount: scheduledDurations.length,
  };
}

export async function getContentFunnelReviewMetrics(input: {
  from?: Date;
  to?: Date;
  sermonId?: string;
} = {}): Promise<ContentFunnelReviewMetrics> {
  const events = await prisma.contentFunnelEvent.findMany({
    where: {
      ...(input.sermonId ? { sermonId: input.sermonId } : {}),
      ...(input.from || input.to
        ? {
            occurredAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { occurredAt: "asc" },
    select: {
      eventType: true,
      sermonId: true,
      opportunityId: true,
      contentAssetId: true,
      processingJobId: true,
      occurredAt: true,
    },
  });
  return aggregateContentFunnelMetrics(events);
}
