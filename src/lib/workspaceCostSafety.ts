import { prisma } from "@/lib/prisma";
import {
  buildWorkspaceCostObservability,
  calendarMonthWindow,
  type WorkspaceCostObservability,
} from "@/lib/costObservability";

export type WorkspaceCostSafetyResult =
  | { status: "AVAILABLE"; report: WorkspaceCostObservability }
  | { status: "UNAVAILABLE"; message: string };

export async function getWorkspaceCostSafety(
  organizationId: string,
  now = new Date(),
): Promise<WorkspaceCostSafetyResult> {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    return { status: "UNAVAILABLE", message: "A church workspace is required for cost observability." };
  }
  const window = calendarMonthWindow(now);
  const organizationWhere = { organizationId: normalizedOrganizationId };

  try {
    const [
      sources,
      aiInvocations,
      processingJobs,
      entitlements,
      usageEvents,
      sourceInventory,
      clipInventory,
      contentInventory,
      teachingInventory,
    ] = await Promise.all([
      prisma.sermon.findMany({
        where: {
          ...organizationWhere,
          createdAt: { gte: window.from, lt: window.until },
        },
        select: {
          sourceDurationSeconds: true,
          sermonStartSeconds: true,
          sermonEndSeconds: true,
          analyzeFullRecording: true,
        },
      }),
      prisma.aiInvocation.findMany({
        where: {
          ...organizationWhere,
          createdAt: { gte: window.from, lt: window.until },
        },
        select: {
          provider: true,
          model: true,
          operation: true,
          sermonId: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          totalTokens: true,
          audioDurationSeconds: true,
          estimatedCostMicros: true,
          providerRequestCount: true,
          cacheHit: true,
        },
      }),
      prisma.processingJob.findMany({
        where: {
          sermon: organizationWhere,
          createdAt: { gte: window.from, lt: window.until },
        },
        select: {
          sermonId: true,
          type: true,
          status: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          attemptCount: true,
        },
      }),
      prisma.organizationEntitlement.findMany({
        where: {
          ...organizationWhere,
          effectiveAt: { lt: window.until },
          OR: [{ expiresAt: null }, { expiresAt: { gt: window.from } }],
        },
        select: { key: true, enabled: true, limitValue: true },
      }),
      prisma.usageEvent.findMany({
        where: {
          ...organizationWhere,
          occurredAt: { gte: window.from, lt: window.until },
        },
        select: { metric: true, quantity: true },
      }),
      prisma.sermonSourceAsset.aggregate({
        where: organizationWhere,
        _count: { _all: true, sizeBytes: true },
        _sum: { sizeBytes: true },
      }),
      prisma.clipArtifact.aggregate({
        where: {
          status: "READY",
          sermon: organizationWhere,
        },
        _count: { _all: true, sizeBytes: true },
        _sum: { sizeBytes: true },
      }),
      prisma.contentAssetFile.aggregate({
        where: { contentAsset: organizationWhere },
        _count: { _all: true, sizeBytes: true },
        _sum: { sizeBytes: true },
      }),
      prisma.teachingVideoExport.aggregate({
        where: { ...organizationWhere, status: "COMPLETED" },
        _count: { _all: true, sizeBytes: true },
        _sum: { sizeBytes: true },
      }),
    ]);

    return {
      status: "AVAILABLE",
      report: buildWorkspaceCostObservability({
        now,
        sources,
        aiInvocations,
        processingJobs: processingJobs.map((job) => ({
          ...job,
          jobType: job.type,
        })),
        entitlements,
        usageEvents,
        inventory: [
          {
            label: "Uploaded source metadata",
            recordCount: sourceInventory._count._all,
            recordsWithSize: sourceInventory._count.sizeBytes,
            knownBytes: sourceInventory._sum.sizeBytes ?? BigInt(0),
          },
          {
            label: "Ready clip artefacts",
            recordCount: clipInventory._count._all,
            recordsWithSize: clipInventory._count.sizeBytes,
            knownBytes: BigInt(clipInventory._sum.sizeBytes ?? 0),
          },
          {
            label: "Content asset files",
            recordCount: contentInventory._count._all,
            recordsWithSize: contentInventory._count.sizeBytes,
            knownBytes: contentInventory._sum.sizeBytes ?? BigInt(0),
          },
          {
            label: "Completed teaching exports",
            recordCount: teachingInventory._count._all,
            recordsWithSize: teachingInventory._count.sizeBytes,
            knownBytes: teachingInventory._sum.sizeBytes ?? BigInt(0),
          },
        ],
      }),
    };
  } catch {
    return {
      status: "UNAVAILABLE",
      message: "Cost and media inventory telemetry could not be read. Processing remains available, but operators should not infer zero usage.",
    };
  }
}
