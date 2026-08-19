import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ sourcePath: "" }));
const prismaMock = vi.hoisted(() => ({
  sermon: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const processingMock = vi.hoisted(() => ({
  appendJobLog: vi.fn(async () => undefined),
  ensureRunning: vi.fn(async () => undefined),
  failed: vi.fn(async () => undefined),
  succeeded: vi.fn(async () => undefined),
  resolve: vi.fn(async () => ({ id: "download-job", status: "RUNNING", attemptCount: 1 })),
}));
const mediaGuardMock = vi.hoisted(() => vi.fn());
const capacityMock = vi.hoisted(() => vi.fn(async () => undefined));
const downloadMock = vi.hoisted(() => vi.fn(async ({ destinationPath }: { destinationPath: string }) => {
  await writeFile(destinationPath, Buffer.from("durable-video"));
}));
const updateStatusMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/agents/processing", () => ({
  appendJobLog: processingMock.appendJobLog,
  ensureProcessingJobRunning: processingMock.ensureRunning,
  markJobFailed: processingMock.failed,
  markJobSucceeded: processingMock.succeeded,
  resolveProcessingJob: processingMock.resolve,
}));
vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: vi.fn(async () => undefined),
  ensureSermonFolders: vi.fn(async () => mkdir(path.dirname(testState.sourcePath), { recursive: true })),
  getSourceVideoPath: vi.fn(() => testState.sourcePath),
}));
vi.mock("@/server/media/fileGuards", () => ({ mediaFileIsUsable: mediaGuardMock }));
vi.mock("@/server/media/storageCapacity", () => ({ assertMediaStorageCapacity: capacityMock }));
vi.mock("@/server/media/s3SourceStorage", () => ({ downloadReadyS3SourceToFile: downloadMock }));
vi.mock("@/server/status/sermonStatus", () => ({ updateSermonStatus: updateStatusMock }));

import { materializeS3SermonSource } from "@/server/agents/sourceMaterializationAgent";

let temporaryRoot = "";

describe("S3 sermon source materialization", () => {
  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sermon-s3-source-"));
    testState.sourcePath = path.join(temporaryRoot, "source", "source.mp4");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(path.dirname(testState.sourcePath), { recursive: true, force: true });
    prismaMock.sermon.findUnique.mockResolvedValue({
      id: "sermon-1",
      title: "Sunday Service",
      status: "CREATED",
      sourceVideoPath: null,
      sourceAsset: {
        bucket: "private-sources",
        objectKey: "source.mp4",
        region: "eu-central-1",
        sizeBytes: BigInt(13),
        status: "READY",
      },
    });
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("reuses a usable local source without contacting S3", async () => {
    mediaGuardMock.mockResolvedValue({ usable: true, durationSeconds: 90 });

    const result = await materializeS3SermonSource("sermon-1");

    expect(result.reusedExistingFile).toBe(true);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processingMock.resolve).not.toHaveBeenCalled();
  });

  it("streams, validates, and promotes the durable source before processing", async () => {
    mediaGuardMock
      .mockResolvedValueOnce({ usable: false, reason: "missing" })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 });

    const result = await materializeS3SermonSource("sermon-1");

    expect(result).toEqual({ sourceVideoPath: testState.sourcePath, reusedExistingFile: false });
    expect(capacityMock).toHaveBeenCalledWith({ incomingBytes: 13 });
    expect(downloadMock).toHaveBeenCalledWith(expect.objectContaining({
      destinationPath: testState.sourcePath.replace(/\.mp4$/i, ".s3.partial.mp4"),
    }));
    expect(prismaMock.sermon.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        sourceVideoPath: testState.sourcePath,
        sourceDurationSeconds: 120,
      },
    }));
    expect(updateStatusMock).toHaveBeenNthCalledWith(1, "sermon-1", "DOWNLOADING");
    expect(updateStatusMock).toHaveBeenNthCalledWith(2, "sermon-1", "DOWNLOADED");
    expect(processingMock.succeeded).toHaveBeenCalled();
  });

  it("shares one durable download across concurrent render requests", async () => {
    mediaGuardMock
      .mockResolvedValueOnce({ usable: false, reason: "missing" })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 });

    const [first, second] = await Promise.all([
      materializeS3SermonSource("sermon-1"),
      materializeS3SermonSource("sermon-1"),
    ]);

    expect(first).toEqual(second);
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(processingMock.resolve).toHaveBeenCalledTimes(1);
  });

  it("restores retained media without regressing a sermon that already reached clip review", async () => {
    prismaMock.sermon.findUnique.mockResolvedValueOnce({
      id: "sermon-1",
      title: "Sunday Service",
      status: "CLIPS_GENERATED",
      sourceVideoPath: null,
      sourceAsset: {
        bucket: "private-sources",
        objectKey: "source.mp4",
        region: "eu-central-1",
        sizeBytes: BigInt(13),
        status: "READY",
      },
    });
    mediaGuardMock
      .mockResolvedValueOnce({ usable: false, reason: "missing" })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 })
      .mockResolvedValueOnce({ usable: true, durationSeconds: 120 });

    await expect(materializeS3SermonSource("sermon-1")).resolves.toMatchObject({
      reusedExistingFile: false,
    });

    expect(updateStatusMock).not.toHaveBeenCalled();
    expect(processingMock.succeeded).toHaveBeenCalled();
  });
});
