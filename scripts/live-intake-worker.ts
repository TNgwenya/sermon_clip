import os from "node:os";

import nextEnv from "@next/env";

import { createWorkerLogger, errorFields } from "./worker-log.ts";

process.env.LIVE_INTAKE_WORKER_RUNTIME = "true";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  throw new Error("LIVE INTAKE WORKER DATABASE_URL must point to the production Postgres database.");
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pollIntervalMs = positiveNumber(process.env.LIVE_INTAKE_POLL_SECONDS, 60) * 1000;
const workerId = process.env.LIVE_INTAKE_WORKER_ID?.trim() || `${os.hostname()}-live-intake-01`;
const logger = createWorkerLogger("live-intake");
let running = false;

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { liveIntakeWorkerEnabled, runLiveIntakeWorkerCycle } = await import("../src/server/liveIntake/liveIntakeWorker");
    if (!liveIntakeWorkerEnabled()) {
      logger.info("live intake worker remains disabled by runtime flag", { workerId });
      return;
    }
    const result = await runLiveIntakeWorkerCycle();
    logger.info("live intake worker cycle completed", { workerId, ...result });
  } catch (error) {
    logger.warn("live intake worker cycle failed; it will retry", errorFields(error));
  } finally {
    running = false;
  }
}

async function main(): Promise<void> {
  logger.banner("live intake worker started", { workerId, pollEvery: `${pollIntervalMs / 1000}s` });
  await runCycle();
  setInterval(() => void runCycle(), pollIntervalMs);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

void main().catch((error) => {
  logger.error("live intake worker fatal startup failure", errorFields(error));
  process.exit(1);
});
