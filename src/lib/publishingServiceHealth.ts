import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type PublishingServiceStatus = "ONLINE" | "STALE" | "NOT_SEEN";

export type PublishingWorkerCapabilities = {
  zernioConfigured: boolean;
  youtubeConfigured: boolean;
  youtubeOAuthClientConfigured: boolean;
  facebookConfigured: boolean;
  youtubePrivacy: string;
  youtubeApiVerified: boolean;
  facebookPublishesImmediately: boolean;
  tiktokPrivacy: string | null;
};

export type PublishingServiceHealth = {
  status: PublishingServiceStatus;
  lastSeenAt: string | null;
  workerId: string | null;
  dryRun: boolean;
  ageSeconds: number | null;
  capabilities: PublishingWorkerCapabilities | null;
  summary: string;
};

type PublishingHeartbeatRecord = {
  workerId: string;
  dryRun: boolean;
  heartbeatAt: Date;
  detailsJson?: unknown;
};

function resolveStaleAfterMs(): number {
  const configuredSeconds = Number(process.env.POSTING_WORKER_HEARTBEAT_STALE_SECONDS ?? 120);
  return Number.isFinite(configuredSeconds) && configuredSeconds > 0
    ? configuredSeconds * 1000
    : 120_000;
}

async function workerHeartbeatStorageAvailable(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public."WorkerHeartbeat"') IS NOT NULL AS "exists"
    `;
    return rows[0]?.exists === true;
  } catch {
    return false;
  }
}

function normalizeWorkerCapabilities(value: unknown): PublishingWorkerCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const capabilities = (value as { capabilities?: unknown }).capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return null;
  }

  const record = capabilities as Record<string, unknown>;
  return {
    zernioConfigured: record.zernioConfigured === true,
    youtubeConfigured: record.youtubeConfigured === true,
    youtubeOAuthClientConfigured: record.youtubeOAuthClientConfigured === true,
    facebookConfigured: record.facebookConfigured === true,
    youtubePrivacy: typeof record.youtubePrivacy === "string" && record.youtubePrivacy.trim()
      ? record.youtubePrivacy.trim()
      : "private",
    youtubeApiVerified: record.youtubeApiVerified === true,
    facebookPublishesImmediately: record.facebookPublishesImmediately === true,
    tiktokPrivacy: typeof record.tiktokPrivacy === "string" && record.tiktokPrivacy.trim()
      ? record.tiktokPrivacy.trim()
      : null,
  };
}

export function summarizePublishingServiceHealth(input: {
  heartbeat: PublishingHeartbeatRecord | null;
  now?: Date;
  staleAfterMs?: number;
}): PublishingServiceHealth {
  if (!input.heartbeat) {
    return {
      status: "NOT_SEEN",
      lastSeenAt: null,
      workerId: null,
      dryRun: false,
      ageSeconds: null,
      capabilities: null,
      summary: "No publishing service signal has been received yet. Automatic posts will wait; manual downloads still work.",
    };
  }

  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? resolveStaleAfterMs();
  const ageMs = Math.max(0, now.getTime() - input.heartbeat.heartbeatAt.getTime());
  const ageSeconds = Math.round(ageMs / 1000);
  const stale = ageMs > staleAfterMs;

  if (stale) {
    return {
      status: "STALE",
      lastSeenAt: input.heartbeat.heartbeatAt.toISOString(),
      workerId: input.heartbeat.workerId,
      dryRun: input.heartbeat.dryRun,
      ageSeconds,
      capabilities: normalizeWorkerCapabilities(input.heartbeat.detailsJson),
      summary: "The publishing service has not checked in recently. Automatic posts will stay safely queued until it reconnects.",
    };
  }

  return {
    status: "ONLINE",
    lastSeenAt: input.heartbeat.heartbeatAt.toISOString(),
    workerId: input.heartbeat.workerId,
    dryRun: input.heartbeat.dryRun,
    ageSeconds,
    capabilities: normalizeWorkerCapabilities(input.heartbeat.detailsJson),
    summary: input.heartbeat.dryRun
      ? "The publishing service is online in test mode. It will validate the queue without sending posts live."
      : "The publishing service is online and checking the posting queue.",
  };
}

export async function recordPublishingServiceHeartbeat(input: {
  workerId: string;
  dryRun: boolean;
  details?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const now = new Date();
  const heartbeatStore = prisma.workerHeartbeat;
  if (!heartbeatStore || !(await workerHeartbeatStorageAvailable())) {
    return false;
  }

  try {
    await heartbeatStore.upsert({
      where: {
        workerType_workerId: {
          workerType: "POSTING",
          workerId: input.workerId,
        },
      },
      create: {
        workerType: "POSTING",
        workerId: input.workerId,
        status: "ONLINE",
        dryRun: input.dryRun,
        detailsJson: input.details,
        heartbeatAt: now,
      },
      update: {
        status: "ONLINE",
        dryRun: input.dryRun,
        detailsJson: input.details,
        heartbeatAt: now,
      },
    });
    return true;
  } catch {
    // A pending database migration must not interrupt the existing posting queue.
    return false;
  }
}

export async function getPublishingServiceHealth(now = new Date()): Promise<PublishingServiceHealth> {
  const heartbeatStore = prisma.workerHeartbeat;
  if (!heartbeatStore || !(await workerHeartbeatStorageAvailable())) {
    return summarizePublishingServiceHealth({ heartbeat: null, now });
  }

  const heartbeat = await heartbeatStore.findFirst({
    where: { workerType: "POSTING" },
    orderBy: { heartbeatAt: "desc" },
    select: {
      workerId: true,
      dryRun: true,
      heartbeatAt: true,
      detailsJson: true,
    },
  }).catch(() => null);

  return summarizePublishingServiceHealth({ heartbeat, now });
}
