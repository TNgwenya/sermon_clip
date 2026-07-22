import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sermonFindUnique: vi.fn(),
  sermonUpdate: vi.fn(),
  clipCount: vi.fn(),
  appendPipelineLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: {
      findUnique: mocks.sermonFindUnique,
      update: mocks.sermonUpdate,
    },
    clipCandidate: {
      count: mocks.clipCount,
    },
  },
}));

vi.mock("@/lib/postingPackages", () => ({
  prunePostingPackageHistoryByClipIds: vi.fn(),
}));

vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: mocks.appendPipelineLog,
  ensureSermonFolders: vi.fn(),
  getClipFolderPath: vi.fn(() => "/tmp/clip-redo-service-test"),
}));

import {
  buildRedoClipGenerationSourceWindow,
  validateRedoClipGenerationReadiness,
  validateRedoClipGenerationSourceWindow,
} from "@/server/agents/clipRedoService";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clipCount.mockResolvedValue(0);
});

describe("redo clip source window", () => {
  it("treats two blank controls as an explicit full-recording redo", () => {
    expect(buildRedoClipGenerationSourceWindow(null, null)).toEqual({
      sermonStartSeconds: null,
      sermonEndSeconds: null,
      analyzeFullRecording: true,
    });
  });

  it("treats either entered boundary as a manual source window", () => {
    expect(buildRedoClipGenerationSourceWindow(20 * 60, null)).toEqual({
      sermonStartSeconds: 20 * 60,
      sermonEndSeconds: null,
      analyzeFullRecording: false,
    });
  });

  it("rejects an end boundary that is not after the start", () => {
    expect(validateRedoClipGenerationSourceWindow(
      buildRedoClipGenerationSourceWindow(1_200, 1_200),
      3_600,
    )).toEqual({
      ok: false,
      message: "Sermon end time must be after the start time.",
    });
  });

  it("treats a blank start as zero when validating the end", () => {
    expect(validateRedoClipGenerationSourceWindow(
      buildRedoClipGenerationSourceWindow(null, 0),
      3_600,
    )).toEqual({
      ok: false,
      message: "Sermon end time must be after the start time.",
    });
  });

  it("rejects an explicit source window too short for three distinct clips", () => {
    expect(validateRedoClipGenerationSourceWindow(
      buildRedoClipGenerationSourceWindow(1_200, 1_260),
      3_600,
    )).toEqual({
      ok: false,
      message: "Sermon end time must be at least 90 seconds after the start time.",
    });
  });

  it("rejects a start-only source window with too little video remaining", () => {
    expect(validateRedoClipGenerationSourceWindow(
      buildRedoClipGenerationSourceWindow(3_590, null),
      3_600,
    )).toEqual({
      ok: false,
      message: "Sermon start time must leave at least 90 seconds before the end of the video.",
    });
  });

  it("rejects a boundary beyond a known source video duration", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcriptJsonPath: "/tmp/transcript.json",
      sourceDurationSeconds: 3_600,
      transcriptSegments: [
        { startTimeSeconds: 0, endTimeSeconds: 1_800 },
        { startTimeSeconds: 1_800, endTimeSeconds: 3_600 },
      ],
      processingJobs: [],
    });

    await expect(validateRedoClipGenerationReadiness("sermon-1", {
      sourceWindow: buildRedoClipGenerationSourceWindow(1_200, 3_601),
    })).resolves.toEqual({
      ok: false,
      message: "Sermon end time is longer than the video duration.",
    });
    expect(mocks.clipCount).not.toHaveBeenCalled();
  });

  it("accepts a start-only window inside a known source duration", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcriptJsonPath: "/tmp/transcript.json",
      sourceDurationSeconds: 3_600,
      transcriptSegments: [
        { startTimeSeconds: 0, endTimeSeconds: 1_800 },
        { startTimeSeconds: 1_800, endTimeSeconds: 3_600 },
      ],
      processingJobs: [],
    });

    await expect(validateRedoClipGenerationReadiness("sermon-1", {
      sourceWindow: buildRedoClipGenerationSourceWindow(1_200, null),
    })).resolves.toEqual({ ok: true });
    expect(mocks.clipCount).toHaveBeenCalledTimes(1);
  });

  it("uses the saved transcript end as the duration fallback and rejects an empty range", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcriptJsonPath: "/tmp/transcript.json",
      sourceDurationSeconds: null,
      transcriptSegments: [
        { startTimeSeconds: 0, endTimeSeconds: 300 },
        { startTimeSeconds: 300, endTimeSeconds: 600 },
      ],
      processingJobs: [],
    });

    await expect(validateRedoClipGenerationReadiness("sermon-1", {
      sourceWindow: buildRedoClipGenerationSourceWindow(600, null),
    })).resolves.toEqual({
      ok: false,
      message: "Sermon start time must leave at least 90 seconds before the end of the video.",
    });
    expect(mocks.clipCount).not.toHaveBeenCalled();
  });

  it("rejects a valid video range that has no saved transcript overlap", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcriptJsonPath: "/tmp/transcript.json",
      sourceDurationSeconds: 3_600,
      transcriptSegments: [
        { startTimeSeconds: 0, endTimeSeconds: 600 },
      ],
      processingJobs: [],
    });

    await expect(validateRedoClipGenerationReadiness("sermon-1", {
      sourceWindow: buildRedoClipGenerationSourceWindow(1_200, 1_800),
    })).resolves.toEqual({
      ok: false,
      message: "No saved transcript content exists in that source range. Choose a range that overlaps the transcript, or retranscribe the sermon for that part of the video.",
    });
    expect(mocks.clipCount).not.toHaveBeenCalled();
  });

  it("rejects a range with less than one clip of saved transcript before deleting clips", async () => {
    mocks.sermonFindUnique.mockResolvedValue({
      id: "sermon-1",
      transcriptJsonPath: "/tmp/transcript.json",
      sourceDurationSeconds: 3_600,
      transcriptSegments: [
        { startTimeSeconds: 0, endTimeSeconds: 600 },
      ],
      processingJobs: [],
    });

    await expect(validateRedoClipGenerationReadiness("sermon-1", {
      sourceWindow: buildRedoClipGenerationSourceWindow(590, null),
    })).resolves.toEqual({
      ok: false,
      message: "The selected source range contains less than 90 seconds of saved transcript. Choose a wider range or retranscribe that part of the video.",
    });
    expect(mocks.clipCount).not.toHaveBeenCalled();
  });
});
