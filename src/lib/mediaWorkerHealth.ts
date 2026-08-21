import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type MediaWorkerStatus = "ONLINE" | "STALE" | "NOT_SEEN";

export type MediaWorkerHealth = {
  status: MediaWorkerStatus;
  lastSeenAt: string | null;
  workerId: string | null;
  ageSeconds: number | null;
  details: Record<string, unknown> | null;
  summary: string;
};

type MediaHeartbeatRecord = {
  workerId: string;
  heartbeatAt: Date;
  detailsJson?: unknown;
};

type WorkerHeartbeatStore = {
  upsert(input: {
    where: { workerType_workerId: { workerType: string; workerId: string } };
    create: {
      workerType: string;
      workerId: string;
      status: string;
      dryRun: boolean;
      detailsJson?: Prisma.InputJsonValue;
      heartbeatAt: Date;
    };
    update: {
      status: string;
      dryRun: boolean;
      detailsJson?: Prisma.InputJsonValue;
      heartbeatAt: Date;
    };
  }): Promise<unknown>;
  findFirst(input: {
    where: { workerType: string };
    orderBy: { heartbeatAt: "desc" };
    select: { workerId: true; heartbeatAt: true; detailsJson: true };
  }): Promise<MediaHeartbeatRecord | null>;
};

type PrismaWithOptionalWorkerHeartbeat = typeof prisma & {
  workerHeartbeat?: WorkerHeartbeatStore;
};

function getWorkerHeartbeatStore(): WorkerHeartbeatStore | null {
  return (prisma as PrismaWithOptionalWorkerHeartbeat).workerHeartbeat ?? null;
}

function resolveStaleAfterMs(): number {
  const configuredSeconds = Number(process.env.MEDIA_WORKER_HEARTBEAT_STALE_SECONDS ?? 120);
  return Number.isFinite(configuredSeconds) && configuredSeconds > 0
    ? configuredSeconds * 1000
    : 120_000;
}

function normalizeDetails(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function summarizeMediaWorkerHealth(input: {
  heartbeat: MediaHeartbeatRecord | null;
  now?: Date;
  staleAfterMs?: number;
}): MediaWorkerHealth {
  if (!input.heartbeat) {
    return {
      status: "NOT_SEEN",
      lastSeenAt: null,
      workerId: null,
      ageSeconds: null,
      details: null,
      summary: "No media worker signal has been received. New sermon processing will remain queued.",
    };
  }

  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? resolveStaleAfterMs();
  const ageMs = Math.max(0, now.getTime() - input.heartbeat.heartbeatAt.getTime());
  const ageSeconds = Math.round(ageMs / 1000);
  const stale = ageMs > staleAfterMs;

  return {
    status: stale ? "STALE" : "ONLINE",
    lastSeenAt: input.heartbeat.heartbeatAt.toISOString(),
    workerId: input.heartbeat.workerId,
    ageSeconds,
    details: normalizeDetails(input.heartbeat.detailsJson),
    summary: stale
      ? "The media worker has not checked in recently. New sermon processing will remain queued until it reconnects."
      : "The media worker is online and checking the sermon processing queue.",
  };
}

export async function recordMediaWorkerHeartbeat(input: {
  workerId: string;
  details?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const heartbeatStore = getWorkerHeartbeatStore();
  if (!heartbeatStore) {
    return false;
  }

  const now = new Date();
  try {
    await heartbeatStore.upsert({
      where: {
        workerType_workerId: {
          workerType: "MEDIA",
          workerId: input.workerId,
        },
      },
      create: {
        workerType: "MEDIA",
        workerId: input.workerId,
        status: "ONLINE",
        dryRun: false,
        detailsJson: input.details,
        heartbeatAt: now,
      },
      update: {
        status: "ONLINE",
        dryRun: false,
        detailsJson: input.details,
        heartbeatAt: now,
      },
    });
    return true;
  } catch {
    // Monitoring must never interrupt sermon processing. This also preserves
    // availability while heartbeat storage is being rolled out.
    return false;
  }
}

export async function getMediaWorkerHealth(now = new Date()): Promise<MediaWorkerHealth> {
  const heartbeatStore = getWorkerHeartbeatStore();
  if (!heartbeatStore) {
    return summarizeMediaWorkerHealth({ heartbeat: null, now });
  }

  const heartbeat = await heartbeatStore.findFirst({
    where: { workerType: "MEDIA" },
    orderBy: { heartbeatAt: "desc" },
    select: { workerId: true, heartbeatAt: true, detailsJson: true },
  }).catch(() => null);

  return summarizeMediaWorkerHealth({ heartbeat, now });
}
