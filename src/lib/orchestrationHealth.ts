import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type OrchestrationHealth = {
  status: "DISABLED" | "ONLINE" | "STALE" | "NOT_SEEN" | "FAILED";
  pending: number;
  leased: number;
  failed: number;
  deadLetters: number;
  oldestPendingAt: Date | null;
  lastSeenAt: Date | null;
  workerId: string | null;
};

const WORKER_TYPE = "ORCHESTRATION";

function enabled(): boolean {
  return process.env.ORCHESTRATION_CONTROL_PLANE_ENABLED?.trim().toLowerCase() === "true";
}

export async function recordOrchestrationWorkerHeartbeat(input: {
  workerId: string;
  details?: Prisma.InputJsonValue;
}): Promise<boolean> {
  try {
    await prisma.workerHeartbeat.upsert({
      where: { workerType_workerId: { workerType: WORKER_TYPE, workerId: input.workerId } },
      create: {
        workerType: WORKER_TYPE,
        workerId: input.workerId,
        status: "ONLINE",
        dryRun: false,
        detailsJson: input.details,
      },
      update: {
        status: "ONLINE",
        dryRun: false,
        detailsJson: input.details,
        heartbeatAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getOrchestrationHealth(
  organizationId: string,
  now = new Date(),
): Promise<OrchestrationHealth> {
  if (!enabled()) {
    return {
      status: "DISABLED", pending: 0, leased: 0, failed: 0, deadLetters: 0,
      oldestPendingAt: null, lastSeenAt: null, workerId: null,
    };
  }
  try {
    const [pending, leased, failed, deadLetters, oldestPending, heartbeat] = await Promise.all([
      prisma.orchestrationJob.count({ where: { organizationId, status: "PENDING" } }),
      prisma.orchestrationJob.count({ where: { organizationId, status: "LEASED" } }),
      prisma.orchestrationJob.count({ where: { organizationId, status: "FAILED" } }),
      prisma.orchestrationJob.count({ where: { organizationId, status: "DEAD_LETTER" } }),
      prisma.orchestrationJob.findFirst({
        where: { organizationId, status: "PENDING" },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      }),
      prisma.workerHeartbeat.findFirst({
        where: { workerType: WORKER_TYPE },
        orderBy: { heartbeatAt: "desc" },
        select: { workerId: true, heartbeatAt: true },
      }),
    ]);
    const staleAfterSeconds = Math.max(60, Number(process.env.ORCHESTRATION_HEARTBEAT_STALE_SECONDS ?? 120));
    const status = !heartbeat
      ? "NOT_SEEN"
      : now.getTime() - heartbeat.heartbeatAt.getTime() > staleAfterSeconds * 1_000
        ? "STALE"
        : "ONLINE";
    return {
      status,
      pending,
      leased,
      failed,
      deadLetters,
      oldestPendingAt: oldestPending?.availableAt ?? null,
      lastSeenAt: heartbeat?.heartbeatAt ?? null,
      workerId: heartbeat?.workerId ?? null,
    };
  } catch {
    return {
      status: "FAILED", pending: 0, leased: 0, failed: 0, deadLetters: 0,
      oldestPendingAt: null, lastSeenAt: null, workerId: null,
    };
  }
}
