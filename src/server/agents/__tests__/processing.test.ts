import type { ProcessingJob } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    processingJob: {
      create: mocks.create,
      findFirst: mocks.findFirst,
    },
  },
}));

vi.mock("@/server/agents/storage", () => ({ appendPipelineLog: vi.fn() }));
vi.mock("@/server/status/sermonStatus", () => ({ updateSermonStatus: vi.fn() }));

import {
  ActiveProcessingJobError,
  createProcessingJob,
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
