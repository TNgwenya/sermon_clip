import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateReadiness: vi.fn(),
  redo: vi.fn(),
  queue: vi.fn(),
  canRunLocally: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/server/agents/clipRedoService", () => ({
  buildRedoClipGenerationSourceWindow: (
    sermonStartSeconds: number | null,
    sermonEndSeconds: number | null,
  ) => ({
    sermonStartSeconds,
    sermonEndSeconds,
    analyzeFullRecording: sermonStartSeconds === null && sermonEndSeconds === null,
  }),
  validateRedoClipGenerationReadiness: mocks.validateReadiness,
  redoClipGenerationFromTranscript: mocks.redo,
}));

vi.mock("@/server/agents/processing", () => ({
  appendJobLog: vi.fn(),
  createProcessingJob: vi.fn(),
  markJobFailed: vi.fn(),
  markJobRunning: vi.fn(),
  markJobSucceeded: vi.fn(),
  queueSermonProcessingJob: mocks.queue,
}));

vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: mocks.canRunLocally,
  localMediaProcessingUnavailableMessage: vi.fn(() => "Local processing unavailable."),
}));

import { redoClipGenerationFromTranscriptAction } from "@/server/actions/sermons";

function redoForm(input: {
  start?: string;
  end?: string;
} = {}): FormData {
  const formData = new FormData();
  formData.set("sermonId", "sermon-1");
  formData.set("confirmation", "redo-clips");
  formData.set("sermonStartTimestamp", input.start ?? "");
  formData.set("sermonEndTimestamp", input.end ?? "");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateReadiness.mockResolvedValue({ ok: true });
  mocks.queue.mockResolvedValue({
    id: "redo-job-1",
    reusedExisting: false,
    intentConflict: false,
  });
  mocks.canRunLocally.mockReturnValue(false);
});

describe("redo clip generation source range", () => {
  it("rejects malformed timestamps before readiness or deletion", async () => {
    const result = await redoClipGenerationFromTranscriptAction(
      { success: false, message: "" },
      redoForm({ start: "twenty minutes" }),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: {
        sermonStartTimestamp: "Use a format like 52:30 or 1:12:45.",
      },
    });
    expect(mocks.validateReadiness).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.redo).not.toHaveBeenCalled();
  });

  it("queues a start-only redo with the exact source window", async () => {
    const result = await redoClipGenerationFromTranscriptAction(
      { success: false, message: "" },
      redoForm({ start: "20:00" }),
    );

    expect(result.success).toBe(true);
    expect(mocks.validateReadiness).toHaveBeenCalledWith("sermon-1", {
      sourceWindow: {
        sermonStartSeconds: 1_200,
        sermonEndSeconds: null,
        analyzeFullRecording: false,
      },
    });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "GENERATE_CLIPS", {
      mode: "redo",
      sermonStartSeconds: 1_200,
      sermonEndSeconds: null,
      analyzeFullRecording: false,
    });
    expect(mocks.redo).not.toHaveBeenCalled();
  });

  it("keeps blank controls backward-compatible by queuing the full transcript", async () => {
    const result = await redoClipGenerationFromTranscriptAction(
      { success: false, message: "" },
      redoForm(),
    );

    expect(result.success).toBe(true);
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "GENERATE_CLIPS", {
      mode: "redo",
      sermonStartSeconds: null,
      sermonEndSeconds: null,
      analyzeFullRecording: true,
    });
  });

  it("passes a validated window into inline redo generation", async () => {
    mocks.canRunLocally.mockReturnValue(true);
    mocks.redo.mockResolvedValue({
      success: true,
      message: "Redo complete.",
      deletedClips: 2,
      generatedClips: 3,
      clearedDrafts: 0,
      clearedScheduledPosts: 0,
      clearedPackages: 0,
    });

    const result = await redoClipGenerationFromTranscriptAction(
      { success: false, message: "" },
      redoForm({ start: "20:00", end: "55:00" }),
    );

    expect(result.success).toBe(true);
    expect(mocks.redo).toHaveBeenCalledWith("sermon-1", {
      sourceWindow: {
        sermonStartSeconds: 1_200,
        sermonEndSeconds: 3_300,
        analyzeFullRecording: false,
      },
    });
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
