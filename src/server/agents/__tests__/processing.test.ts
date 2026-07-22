import type { ProcessingJob } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
    processingJob: {
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/server/agents/storage", () => ({ appendPipelineLog: vi.fn() }));
vi.mock("@/server/status/sermonStatus", () => ({ updateSermonStatus: vi.fn() }));

import {
  ActiveProcessingJobError,
  createProcessingJob,
  markJobAwaitingClipPreviewPreparation,
  queueSermonProcessingJob,
} from "@/server/agents/processing";

function processingJob(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: "job-winner",
    sermonId: "sermon-1",
    type: "PROCESS_SERMON",
    status: "RUNNING",
    startedAt: new Date("2026-07-16T10:00:00.000Z"),
    completedAt: null,
    errorMessage: null,
    logs: null,
    generationSummary: null,
    workerId: "worker-1",
    heartbeatAt: new Date("2026-07-16T10:01:00.000Z"),
    attemptCount: 1,
    createdAt: new Date("2026-07-16T10:00:00.000Z"),
    updatedAt: new Date("2026-07-16T10:01:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback({
    $queryRaw: mocks.queryRaw,
    processingJob: {
      create: mocks.create,
      findMany: mocks.findMany,
    },
  }));
});

describe("createProcessingJob", () => {
  it("rejects the losing caller without handing it the active worker's job", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    mocks.findFirst.mockResolvedValue(processingJob());

    const result = createProcessingJob("sermon-1", "PROCESS_SERMON");

    await expect(result).rejects.toBeInstanceOf(ActiveProcessingJobError);
    await expect(result).rejects.toMatchObject({
      code: "PROCESSING_JOB_ALREADY_ACTIVE",
      existingJobId: "job-winner",
      sermonId: "sermon-1",
      jobType: "PROCESS_SERMON",
      activeStatus: "RUNNING",
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sermonId: "sermon-1",
        type: "PROCESS_SERMON",
        status: { in: ["PENDING", "RUNNING"] },
      },
    }));
  });

  it("returns only a job created by the current caller", async () => {
    const created = processingJob({ id: "job-created", status: "PENDING", workerId: null });
    mocks.create.mockResolvedValue(created);

    await expect(createProcessingJob("sermon-1", "PROCESS_SERMON")).resolves.toBe(created);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("stores queued retry instructions atomically with the job", async () => {
    const created = processingJob({ id: "job-repair", status: "PENDING", workerId: null });
    mocks.create.mockResolvedValue(created);

    await createProcessingJob("sermon-1", "GENERATE_CLIPS", {
      execution: "QUEUED",
      generationSummary: {
        mode: "repair_previews",
        existingActiveSuggestionCount: 5,
      },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        sermonId: "sermon-1",
        type: "GENERATE_CLIPS",
        status: "PENDING",
        generationSummary: {
          mode: "repair_previews",
          existingActiveSuggestionCount: 5,
        },
      },
    });
  });
});

describe("queueSermonProcessingJob", () => {
  it("creates a pending successor when an asset worker may already have snapshotted its work", async () => {
    const created = processingJob({
      id: "job-successor",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
    });
    mocks.findMany.mockResolvedValueOnce([]);
    mocks.create.mockResolvedValueOnce(created);

    await expect(queueSermonProcessingJob("sermon-1", "EXPORT_CLIPS")).resolves.toEqual({
      id: "job-successor",
      reusedExisting: false,
      intentConflict: false,
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        sermonId: "sermon-1",
        type: "EXPORT_CLIPS",
        status: "PENDING",
        workerId: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, generationSummary: true },
    });
  });

  it("queues a separate targeted asset successor when a pending intent differs", async () => {
    const pending = processingJob({
      id: "job-pending-a",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a" },
    });
    const successor = processingJob({
      id: "job-pending-b",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-b" },
    });
    mocks.findMany.mockResolvedValueOnce([pending]);
    mocks.create.mockResolvedValueOnce(successor);

    await expect(queueSermonProcessingJob("sermon-1", "EXPORT_CLIPS", {
      intentKey: "media-assets:EXPORT_CLIPS:normal:clip-b",
      mediaAssetClipIds: ["clip-b"],
    })).resolves.toEqual({
      id: "job-pending-b",
      reusedExisting: false,
      intentConflict: false,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a targeted pending asset job for a later broad request", async () => {
    const pending = processingJob({
      id: "job-pending-targeted",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a" },
    });
    const successor = processingJob({
      id: "job-pending-broad",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: null,
    });
    mocks.findMany.mockResolvedValueOnce([pending]);
    mocks.create.mockResolvedValueOnce(successor);

    await expect(queueSermonProcessingJob("sermon-1", "EXPORT_CLIPS")).resolves.toEqual({
      id: "job-pending-broad",
      reusedExisting: false,
      intentConflict: false,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a broad pending asset job for a later targeted request", async () => {
    const pending = processingJob({
      id: "job-pending-broad",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: null,
    });
    const successor = processingJob({
      id: "job-pending-targeted",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a" },
    });
    mocks.findMany.mockResolvedValueOnce([pending]);
    mocks.create.mockResolvedValueOnce(successor);

    await expect(queueSermonProcessingJob("sermon-1", "EXPORT_CLIPS", {
      intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a",
      mediaAssetClipIds: ["clip-a"],
    })).resolves.toEqual({
      id: "job-pending-targeted",
      reusedExisting: false,
      intentConflict: false,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("reuses the matching media intent even when a newer different successor exists", async () => {
    const pendingA = processingJob({
      id: "job-pending-a",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a" },
    });
    const pendingB = processingJob({
      id: "job-pending-b",
      type: "EXPORT_CLIPS",
      status: "PENDING",
      workerId: null,
      generationSummary: { intentKey: "media-assets:EXPORT_CLIPS:normal:clip-b" },
    });
    mocks.findMany.mockResolvedValueOnce([pendingB, pendingA]);

    await expect(queueSermonProcessingJob("sermon-1", "EXPORT_CLIPS", {
      intentKey: "media-assets:EXPORT_CLIPS:normal:clip-a",
      mediaAssetClipIds: ["clip-a"],
    })).resolves.toEqual({
      id: "job-pending-a",
      reusedExisting: true,
      intentConflict: false,
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("reuses an active job only when its clip-generation intent is compatible", async () => {
    mocks.findFirst.mockResolvedValueOnce(processingJob({
      type: "GENERATE_CLIPS",
      status: "PENDING",
      generationSummary: { append: true },
    }));

    await expect(queueSermonProcessingJob(
      "sermon-1",
      "GENERATE_CLIPS",
      { mode: "retry_generation", append: true },
    )).resolves.toEqual({
      id: "job-winner",
      reusedExisting: true,
      intentConflict: false,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reports a conflict instead of silently replacing an active queue intent", async () => {
    mocks.findFirst.mockResolvedValueOnce(processingJob({
      type: "GENERATE_CLIPS",
      status: "PENDING",
      generationSummary: { append: true },
    }));

    await expect(queueSermonProcessingJob(
      "sermon-1",
      "GENERATE_CLIPS",
      { mode: "redo" },
    )).resolves.toEqual({
      id: "job-winner",
      reusedExisting: true,
      intentConflict: true,
    });
  });

  it("treats different content-generation intent keys as a conflict", async () => {
    mocks.findFirst.mockResolvedValueOnce(processingJob({
      type: "GENERATE_CONTENT_OPPORTUNITIES",
      status: "PENDING",
      generationSummary: { intentKey: "content-pack:weekly" },
    }));

    await expect(queueSermonProcessingJob(
      "sermon-1",
      "GENERATE_CONTENT_OPPORTUNITIES",
      { intentKey: "regenerate-type:quote" },
    )).resolves.toEqual({
      id: "job-winner",
      reusedExisting: true,
      intentConflict: true,
    });
  });

  it("checks the unique-index winner's intent when two enqueue requests race", async () => {
    const winner = processingJob({
      type: "GENERATE_CLIPS",
      status: "PENDING",
      generationSummary: { append: true },
    });
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(winner);
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(queueSermonProcessingJob(
      "sermon-1",
      "GENERATE_CLIPS",
      { mode: "redo" },
    )).resolves.toMatchObject({
      id: "job-winner",
      reusedExisting: true,
      intentConflict: true,
    });
  });

  it("retries once when the unique-index winner completes before the active re-read", async () => {
    const winner = processingJob({
      type: "GENERATE_CLIPS",
      status: "PENDING",
      generationSummary: { append: true },
    });
    const created = processingJob({
      id: "job-created-after-race",
      type: "GENERATE_CLIPS",
      status: "PENDING",
      generationSummary: { mode: "redo" },
      workerId: null,
    });
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.create
      .mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
      .mockResolvedValueOnce(created);

    await expect(queueSermonProcessingJob(
      "sermon-1",
      "GENERATE_CLIPS",
      { mode: "redo" },
    )).resolves.toEqual({
      id: "job-created-after-race",
      reusedExisting: false,
      intentConflict: false,
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});

describe("markJobAwaitingClipPreviewPreparation", () => {
  it("keeps the job running and checkpoints preview repair without stale generation controls", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.executeRaw.mockResolvedValueOnce(1);

    await markJobAwaitingClipPreviewPreparation(
      "job-winner",
      {
        mode: "redo",
        append: true,
        existingActiveSuggestionCount: 5,
        failure: { stage: "old_failure" },
      },
      "Generation finished; previews are next.",
    );

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-winner",
        type: "GENERATE_CLIPS",
        status: "RUNNING",
      },
      data: {
        generationSummary: {
          mode: "repair_previews",
          existingActiveSuggestionCount: 5,
        },
      },
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses to checkpoint a job whose running lease was lost", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(markJobAwaitingClipPreviewPreparation(
      "job-winner",
      { append: true },
    )).rejects.toThrow("was no longer running");
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});
