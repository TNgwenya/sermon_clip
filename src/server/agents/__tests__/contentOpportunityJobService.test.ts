import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildQueuedContentOpportunityJobSummary } from "@/lib/contentOpportunityJobs";

const mocks = vi.hoisted(() => ({
  sermonFindUnique: vi.fn(),
  processingJobFindUnique: vi.fn(),
  processingJobUpdateMany: vi.fn(),
  queue: vi.fn(),
  createJob: vi.fn(),
  markFailed: vi.fn(),
  markSucceeded: vi.fn(),
  generate: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: { findUnique: mocks.sermonFindUnique },
    processingJob: {
      findUnique: mocks.processingJobFindUnique,
      updateMany: mocks.processingJobUpdateMany,
    },
  },
}));

vi.mock("@/server/agents/processing", () => ({
  queueSermonProcessingJob: mocks.queue,
  createProcessingJob: mocks.createJob,
  markJobFailed: mocks.markFailed,
  markJobSucceeded: mocks.markSucceeded,
}));

vi.mock("@/server/agents/contentMultiplicationService", () => ({
  generateContentOpportunities: mocks.generate,
}));

vi.mock("@/server/contentFunnelTelemetry", () => ({
  recordContentFunnelEvent: mocks.record,
}));

import {
  enqueueContentOpportunityGeneration,
  processContentOpportunityGenerationJob,
} from "@/server/agents/contentOpportunityJobService";

const completeResult = {
  opportunityCount: 3,
  archivedCount: 0,
  reusedExistingOpportunities: false,
  complete: true,
  repairPasses: 1,
  requestedQuantities: { QUOTE_GRAPHIC: 3 },
  generatedQuantities: { QUOTE_GRAPHIC: 3 },
  shortfalls: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sermonFindUnique.mockResolvedValue({
    id: "sermon-1",
    transcript: { id: "transcript-1", fullText: "Private sermon wording." },
    transcriptSegments: [],
  });
  mocks.processingJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.record.mockResolvedValue(undefined);
});

describe("content opportunity job queue", () => {
  it("enqueues an idempotent request with no sermon or generated copy in its summary", async () => {
    mocks.queue.mockResolvedValue({ id: "job-1", reusedExisting: false, intentConflict: false });

    const result = await enqueueContentOpportunityGeneration({
      sermonId: "sermon-1",
      request: {
        mode: "CONTENT_PACK",
        presetId: "WEEKLY_CONTENT_PACK",
        quantities: { QUOTE_GRAPHIC: 3 },
        replaceDefaultQuantities: true,
      },
    });

    expect(result).toEqual({
      execution: "QUEUED",
      jobId: "job-1",
      reusedExisting: false,
      intentConflict: false,
      progress: "QUEUED",
    });
    const summary = mocks.queue.mock.calls[0]?.[2];
    expect(summary).toMatchObject({
      kind: "CONTENT_OPPORTUNITY_GENERATION",
      request: {
        mode: "CONTENT_PACK",
        presetId: "WEEKLY_CONTENT_PACK",
        quantities: { QUOTE_GRAPHIC: 3 },
      },
      progress: { stage: "QUEUED", percent: 0 },
    });
    expect(JSON.stringify(summary)).not.toContain("Private sermon wording");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "GENERATION_REQUESTED",
      processingJobId: "job-1",
    }));
  });

  it("reports a conflicting active request instead of overwriting its intent", async () => {
    mocks.queue.mockResolvedValue({ id: "job-active", reusedExisting: true, intentConflict: true });

    await expect(enqueueContentOpportunityGeneration({
      sermonId: "sermon-1",
      request: { mode: "REGENERATE_TYPE", targetType: "SCRIPTURE_GRAPHIC" },
    })).resolves.toMatchObject({
      jobId: "job-active",
      reusedExisting: true,
      intentConflict: true,
    });
  });

  it("does not queue generation before a transcript record exists", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcript: null,
      transcriptSegments: [],
    });

    await expect(enqueueContentOpportunityGeneration({
      sermonId: "sermon-1",
      request: { mode: "GENERATE" },
    })).rejects.toThrow(/finish the sermon transcript/i);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});

describe("content opportunity job handler", () => {
  it("checkpoints running progress and passes the durable job context into generation", async () => {
    const summary = buildQueuedContentOpportunityJobSummary({
      mode: "REGENERATE_TYPE",
      targetType: "QUOTE_GRAPHIC",
    });
    mocks.processingJobFindUnique.mockResolvedValue({
      id: "job-1",
      sermonId: "sermon-1",
      type: "GENERATE_CONTENT_OPPORTUNITIES",
      status: "RUNNING",
      startedAt: new Date(),
      generationSummary: summary,
    });
    mocks.generate.mockImplementation(async (_sermonId: string, options: {
      onProgress?: (progress: { phase: "GENERATING"; percent: number }) => Promise<void>;
    }) => {
      await options.onProgress?.({ phase: "GENERATING", percent: 40 });
      return completeResult;
    });

    const message = await processContentOpportunityGenerationJob({
      jobId: "job-1",
      sermonId: "sermon-1",
    });

    expect(mocks.processingJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        generationSummary: expect.objectContaining({
          progress: expect.objectContaining({ stage: "RUNNING", percent: 10 }),
        }),
      }),
    }));
    expect(mocks.processingJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        generationSummary: expect.objectContaining({
          progress: expect.objectContaining({ phase: "GENERATING", percent: 40 }),
        }),
      }),
    }));
    expect(mocks.generate).toHaveBeenCalledWith("sermon-1", expect.objectContaining({
      force: true,
      targetType: "QUOTE_GRAPHIC",
      processingJob: expect.objectContaining({ id: "job-1" }),
    }));
    expect(message).toMatch(/requested set is complete/i);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "GENERATION_COMPLETED",
      dedupeKey: "content-generation-completed:job-1",
    }));
  });
});
