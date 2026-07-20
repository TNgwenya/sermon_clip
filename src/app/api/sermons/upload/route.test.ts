import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ sourcePath: "" }));
const prismaMock = vi.hoisted(() => ({
  sermon: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const storageCapacityMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: vi.fn(async () => undefined),
  ensureSermonFolders: vi.fn(async () => {
    await mkdir(path.dirname(testState.sourcePath), { recursive: true });
  }),
  getAudioPath: vi.fn(() => path.join(path.dirname(testState.sourcePath), "audio.mp3")),
  getSourceVideoPath: vi.fn(() => testState.sourcePath),
  getTranscriptJsonPath: vi.fn(() => path.join(path.dirname(testState.sourcePath), "transcript.json")),
}));
vi.mock("@/server/pipeline/processSermonPipeline", () => ({
  processSermonPipeline: vi.fn(async () => ({ summary: "Complete" })),
}));
vi.mock("@/server/media/fileGuards", () => ({
  mediaFileIsUsable: vi.fn(async () => ({ usable: true, durationSeconds: 60 })),
}));
vi.mock("@/server/media/storageCapacity", () => ({
  assertMediaStorageCapacity: storageCapacityMock,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: vi.fn(() => true),
  localMediaProcessingUnavailableMessage: vi.fn((action: string) => `${action} unavailable.`),
}));

import { POST } from "./route";

let temporaryRoot = "";

function validStartUrl(totalBytes = 10): URL {
  const url = new URL("http://localhost/api/sermons/upload");
  url.searchParams.set("uploadMode", "start");
  url.searchParams.set("fileName", "Mobile Sermon.mov");
  url.searchParams.set("totalBytes", String(totalBytes));
  url.searchParams.set("title", "Mobile Sermon");
  url.searchParams.set("speakerName", "Pastor Test");
  url.searchParams.set("churchName", "Test Church");
  url.searchParams.set("language", "English");
  url.searchParams.set("rightsConfirmed", "true");
  return url;
}

describe("raw sermon upload route", () => {
  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sermon-upload-route-"));
    testState.sourcePath = path.join(temporaryRoot, "source", "source.mp4");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(path.dirname(testState.sourcePath), { recursive: true, force: true });
    prismaMock.sermon.findUnique.mockResolvedValue({ id: "sermon-1", title: "Mobile Sermon" });
    storageCapacityMock.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("accepts a replayed chunk without appending duplicate bytes", async () => {
    const chunkUrl = new URL("http://localhost/api/sermons/upload");
    chunkUrl.searchParams.set("uploadMode", "chunk");
    chunkUrl.searchParams.set("sermonId", "sermon-1");
    chunkUrl.searchParams.set("offset", "0");
    chunkUrl.searchParams.set("chunkBytes", "3");
    chunkUrl.searchParams.set("totalBytes", "3");

    const firstResponse = await POST(new Request(chunkUrl, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    }));
    const replayResponse = await POST(new Request(chunkUrl, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      success: true,
      receivedBytes: 3,
      message: "Upload chunk was already received.",
    });
    await expect(readFile(testState.sourcePath.replace(/\.mp4$/i, ".upload.partial.mp4"))).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("returns the durable server offset when client and server progress differ", async () => {
    const partialPath = testState.sourcePath.replace(/\.mp4$/i, ".upload.partial.mp4");
    await mkdir(path.dirname(partialPath), { recursive: true });
    await writeFile(partialPath, Buffer.from([1, 2]));
    const chunkUrl = new URL("http://localhost/api/sermons/upload");
    chunkUrl.searchParams.set("uploadMode", "chunk");
    chunkUrl.searchParams.set("sermonId", "sermon-1");
    chunkUrl.searchParams.set("offset", "3");
    chunkUrl.searchParams.set("chunkBytes", "3");
    chunkUrl.searchParams.set("totalBytes", "6");

    const response = await POST(new Request(chunkUrl, {
      method: "POST",
      body: new Uint8Array([4, 5, 6]),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, receivedBytes: 2 });
    await expect(readFile(partialPath)).resolves.toEqual(Buffer.from([1, 2]));
  });

  it("checks disk capacity before creating an upload session", async () => {
    storageCapacityMock.mockRejectedValueOnce(new Error("Not enough storage."));

    const response = await POST(new Request(validStartUrl(2_000_000), { method: "POST" }));

    expect(response.status).toBe(507);
    expect(storageCapacityMock).toHaveBeenCalledWith({ incomingBytes: 2_000_000 });
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });
});
