import os from "node:os";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (process.env.ORCHESTRATION_CONTROL_PLANE_ENABLED?.trim().toLowerCase() !== "true") {
  throw new Error("Set ORCHESTRATION_CONTROL_PLANE_ENABLED=true to start the staged orchestration worker.");
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  throw new Error("The orchestration worker requires a PostgreSQL DATABASE_URL.");
}

const [{ createPrismaSchedulerStore }, { createDefaultSermonLaneExecutor }, runtime, repository, adapterModule, healthModule] = await Promise.all([
  import("../src/server/orchestration/prismaSchedulerStore.ts"),
  import("../src/server/orchestration/sermonLaneExecutor.ts"),
  import("../src/server/orchestration/orchestrationWorkerRuntime.ts"),
  import("../src/server/orchestration/repository.ts"),
  import("../src/server/orchestration/databasePollingQueueAdapter.ts"),
  import("../src/lib/orchestrationHealth.ts"),
]);

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const workerId = process.env.ORCHESTRATION_WORKER_ID?.trim() || `${os.hostname()}-orchestration-worker`;
const pollMs = positiveNumber(process.env.ORCHESTRATION_POLL_SECONDS, 5) * 1_000;
const leaseMs = positiveNumber(process.env.ORCHESTRATION_LEASE_MINUTES, 3) * 60_000;
const heartbeatMs = Math.min(leaseMs / 3, positiveNumber(process.env.ORCHESTRATION_HEARTBEAT_SECONDS, 30) * 1_000);
const store = createPrismaSchedulerStore();
const execute = await createDefaultSermonLaneExecutor();
const queueAdapter = new adapterModule.DatabasePollingQueueAdapter();
let stopping = false;

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function dispatchAvailableOutbox(): Promise<void> {
  for (let count = 0; count < 25; count += 1) {
    const result = await repository.dispatchNextOutboxEvent({
      adapter: queueAdapter,
      dispatcherId: `${workerId}:database-signal`,
    });
    if (result === "IDLE") return;
  }
}

async function processOne(): Promise<boolean> {
  const claimed = await store.claimFair({ workerId, leaseDurationMs: leaseMs });
  if (!claimed) return false;

  let renewalError: unknown = null;
  const renewTimer = setInterval(() => {
    void store.renew({
      organizationId: claimed.job.organizationId,
      jobId: claimed.job.id,
      lease: claimed.lease,
      leaseDurationMs: leaseMs,
    }).catch((error: unknown) => {
      renewalError = error;
    });
  }, heartbeatMs);

  try {
    await runtime.runClaimedOrchestrationJob({
      ...claimed,
      store,
      execute: async (input) => {
        if (renewalError) throw renewalError;
        const result = await execute(input);
        if (renewalError) throw renewalError;
        return result;
      },
    });
  } finally {
    clearInterval(renewTimer);
  }
  return true;
}

async function main(): Promise<void> {
  console.info(`[orchestration-worker] started as ${workerId}; database-polling adapter; no cloud queue configured`);
  const heartbeat = () => healthModule.recordOrchestrationWorkerHeartbeat({
    workerId,
    details: {
      adapter: queueAdapter.adapterName,
      leaseSeconds: leaseMs / 1_000,
      heartbeatSeconds: heartbeatMs / 1_000,
    },
  });
  await heartbeat();
  const heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, heartbeatMs);

  while (!stopping) {
    try {
      await dispatchAvailableOutbox();
      await store.recoverExpired();
      const processed = await processOne();
      if (!processed) await wait(pollMs);
    } catch (error) {
      // A lost lease is expected during recovery races and must not take the
      // worker offline. Fenced transitions prevent the old owner from writing.
      console.error("[orchestration-worker] cycle failed", error);
      await wait(pollMs);
    }
  }
  clearInterval(heartbeatTimer);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void main().catch((error) => {
  console.error("[orchestration-worker] fatal", error);
  process.exitCode = 1;
});
