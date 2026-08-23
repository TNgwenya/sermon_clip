import { prisma } from "@/lib/prisma";

import { listReadyCloudflareRecordings } from "./cloudflareStream";
import { materializeCloudflareRecording, type CloudflareMaterializationResult } from "./materializeCloudflareRecording";
import { receiveCompletedLiveRecording } from "./service";

const FOUR_HOURS_SECONDS = 4 * 60 * 60;

export type LiveIntakeWorkerInput = { providerInputId: string };
export type LiveIntakeWorkerRecording = {
  id: string;
  providerRecordingId: string;
  organizationId: string;
  durationSeconds: number | null;
  materializationAttemptCount: number;
};

export type LiveIntakeWorkerDependencies = {
  listActiveInputs: () => Promise<LiveIntakeWorkerInput[]>;
  listReadyRecordings: (providerInputId: string) => ReturnType<typeof listReadyCloudflareRecordings>;
  receive: (input: {
    providerInputId: string;
    providerRecordingId: string;
    title: string;
    durationSeconds: number;
  }) => Promise<unknown>;
  recoverStalled: (cutoff: Date, now: Date) => Promise<number>;
  listCandidates: (now: Date, limit: number) => Promise<LiveIntakeWorkerRecording[]>;
  claim: (recording: LiveIntakeWorkerRecording, now: Date) => Promise<LiveIntakeWorkerRecording | null>;
  markPending: (recordingId: string, nextAttemptAt: Date) => Promise<void>;
  markFailed: (recordingId: string, nextAttemptAt: Date) => Promise<void>;
  markIgnored: (recordingId: string, reason: string) => Promise<void>;
  materialize: (recording: LiveIntakeWorkerRecording) => Promise<CloudflareMaterializationResult>;
};

export type LiveIntakeWorkerOptions = {
  now?: () => Date;
  candidateLimit?: number;
  staleAfterMs?: number;
  pendingRetryMs?: number;
  failureRetryMs?: number;
  maxFailureRetryMs?: number;
};

export function liveIntakeWorkerEnabled(): boolean {
  return process.env.LIVE_INTAKE_WORKER_ENABLED?.trim().toLowerCase() === "true";
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function retryDelayMs(attempt: number, base: number, max: number): number {
  const exponent = Math.min(10, Math.max(0, attempt - 1));
  return Math.min(max, base * (2 ** exponent));
}

function safeFailureReason(): string {
  // Provider bodies and signed download URLs must never enter tenant-visible
  // records. Detailed diagnostics belong to restricted worker logs only.
  return "Live recording transfer did not complete; it will retry automatically.";
}

/** One bounded, idempotent worker cycle. It is safe to run from the existing media worker. */
export function createLiveIntakeWorker(dependencies: LiveIntakeWorkerDependencies, options: LiveIntakeWorkerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const candidateLimit = positiveInt(options.candidateLimit, 10);
  const staleAfterMs = positiveInt(options.staleAfterMs, 30 * 60_000);
  const pendingRetryMs = positiveInt(options.pendingRetryMs, 60_000);
  const failureRetryMs = positiveInt(options.failureRetryMs, 5 * 60_000);
  const maxFailureRetryMs = positiveInt(options.maxFailureRetryMs, 60 * 60_000);

  return async function runCycle(): Promise<{
    discovered: number;
    received: number;
    materialized: number;
    pending: number;
    failed: number;
    ignored: number;
    recovered: number;
  }> {
    const cycleNow = now();
    const result = { discovered: 0, received: 0, materialized: 0, pending: 0, failed: 0, ignored: 0, recovered: 0 };
    result.recovered = await dependencies.recoverStalled(new Date(cycleNow.getTime() - staleAfterMs), cycleNow);

    for (const intake of await dependencies.listActiveInputs()) {
      try {
        const ready = await dependencies.listReadyRecordings(intake.providerInputId);
        result.discovered += ready.length;
        for (const recording of ready) {
          const receipt = await dependencies.receive({
            providerInputId: intake.providerInputId,
            providerRecordingId: recording.providerRecordingId,
            title: recording.title,
            durationSeconds: recording.durationSeconds,
          });
          // Receipt is unique by input+provider recording ID; its exact return
          // shape is intentionally not trusted for state transitions.
          if (receipt) result.received += 1;
        }
      } catch {
        // One provider input must not stop other churches' queued recordings.
      }
    }

    for (const candidate of await dependencies.listCandidates(cycleNow, candidateLimit)) {
      if (candidate.durationSeconds !== null && candidate.durationSeconds > FOUR_HOURS_SECONDS) {
        await dependencies.markIgnored(candidate.id, "Live recordings longer than four hours are not supported for MP4 transfer.");
        result.ignored += 1;
        continue;
      }
      const claimed = await dependencies.claim(candidate, cycleNow);
      if (!claimed) continue;
      try {
        const materialized = await dependencies.materialize(claimed);
        if (materialized.state === "pending") {
          await dependencies.markPending(claimed.id, new Date(cycleNow.getTime() + pendingRetryMs));
          result.pending += 1;
        } else {
          result.materialized += 1;
        }
      } catch {
        const nextAttempt = new Date(cycleNow.getTime() + retryDelayMs(claimed.materializationAttemptCount + 1, failureRetryMs, maxFailureRetryMs));
        await dependencies.markFailed(claimed.id, nextAttempt);
        result.failed += 1;
      }
    }
    return result;
  };
}

function databaseDependencies(): LiveIntakeWorkerDependencies {
  return {
    listActiveInputs: () => prisma.liveIntake.findMany({
      where: { status: "READY", provider: "CLOUDFLARE_STREAM" },
      select: { providerInputId: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    listReadyRecordings: listReadyCloudflareRecordings,
    receive: receiveCompletedLiveRecording,
    recoverStalled: async (cutoff, now) => {
      const recovered = await prisma.liveRecording.updateMany({
        where: { status: "MATERIALIZING", lastMaterializationAttemptAt: { lt: cutoff } },
        data: { status: "FAILED", failureReason: safeFailureReason(), nextMaterializationAttemptAt: now },
      });
      return recovered.count;
    },
    listCandidates: (now, limit) => prisma.liveRecording.findMany({
      where: {
        status: { in: ["RECEIVED", "FAILED"] },
        OR: [{ nextMaterializationAttemptAt: null }, { nextMaterializationAttemptAt: { lte: now } }],
        liveIntake: { status: "READY", provider: "CLOUDFLARE_STREAM" },
      },
      select: { id: true, providerRecordingId: true, organizationId: true, durationSeconds: true, materializationAttemptCount: true },
      orderBy: { receivedAt: "asc" },
      take: limit,
    }),
    claim: async (recording, now) => {
      const claimed = await prisma.liveRecording.updateMany({
        where: {
          id: recording.id,
          status: { in: ["RECEIVED", "FAILED"] },
          OR: [{ nextMaterializationAttemptAt: null }, { nextMaterializationAttemptAt: { lte: now } }],
        },
        data: {
          status: "MATERIALIZING",
          lastMaterializationAttemptAt: now,
          materializationAttemptCount: { increment: 1 },
          nextMaterializationAttemptAt: null,
          failureReason: null,
        },
      });
      return claimed.count === 1 ? recording : null;
    },
    markPending: async (recordingId, nextAttemptAt) => {
      await prisma.liveRecording.updateMany({
        where: { id: recordingId, status: "MATERIALIZING" },
        data: { status: "RECEIVED", nextMaterializationAttemptAt: nextAttemptAt },
      });
    },
    markFailed: async (recordingId, nextAttemptAt) => {
      await prisma.liveRecording.updateMany({
        where: { id: recordingId, status: "MATERIALIZING" },
        data: { status: "FAILED", failureReason: safeFailureReason(), nextMaterializationAttemptAt: nextAttemptAt },
      });
    },
    markIgnored: async (recordingId, reason) => {
      await prisma.liveRecording.updateMany({
        where: { id: recordingId, status: { in: ["RECEIVED", "FAILED"] } },
        data: { status: "IGNORED", failureReason: reason, nextMaterializationAttemptAt: null },
      });
    },
    materialize: materializeCloudflareRecording,
  };
}

export async function runLiveIntakeWorkerCycle(options?: LiveIntakeWorkerOptions) {
  return createLiveIntakeWorker(databaseDependencies(), options)();
}

export const __liveIntakeWorkerTestUtils = { retryDelayMs, safeFailureReason, FOUR_HOURS_SECONDS };
