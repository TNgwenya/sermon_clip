import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ sourcePath: "" }));
const prismaMock = vi.hoisted(() => {
  const client = {
    auditEvent: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    campus: {
      findFirst: vi.fn(),
    },
    sermon: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    processingJob: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(async (callback) => callback(client));
  return client;
});
const storageCapacityMock = vi.hoisted(() => vi.fn(async () => undefined));
const runtimeMock = vi.hoisted(() => ({
  canRunLocalMediaProcessing: vi.fn(() => true),
  canRunInlineMediaProcessing: vi.fn(() => true),
}));
const queueProcessingJobMock = vi.hoisted(() => vi.fn(async () => ({
  id: "job-1",
  reusedExisting: false,
  intentConflict: false,
})));
const mediaFileIsUsableMock = vi.hoisted(() => vi.fn(
  async (): Promise<{ usable: boolean; durationSeconds?: number; reason?: string }> => ({
    usable: true,
    durationSeconds: 60,
  }),
));

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
  mediaFileIsUsable: mediaFileIsUsableMock,
}));
vi.mock("@/server/media/storageCapacity", () => ({
  assertMediaStorageCapacity: storageCapacityMock,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: runtimeMock.canRunLocalMediaProcessing,
  canRunInlineMediaProcessing: runtimeMock.canRunInlineMediaProcessing,
  localMediaProcessingUnavailableMessage: vi.fn((action: string) => `${action} unavailable.`),
}));
vi.mock("@/server/agents/processing", () => ({
  queueSermonProcessingJob: queueProcessingJobMock,
}));

import { POST } from "./route";

let temporaryRoot = "";

function trustedRequest(input: URL | string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-sermonclip-organization-id", "org_local_default");
  headers.set("x-sermonclip-campus-id", "campus_local_default");
  headers.set("x-sermonclip-actor-id", "user_local_bootstrap");
  headers.set("x-sermonclip-authentication", "local-development");
  return new Request(input, { ...init, headers });
}

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
    runtimeMock.canRunLocalMediaProcessing.mockReturnValue(true);
    runtimeMock.canRunInlineMediaProcessing.mockReturnValue(true);
    queueProcessingJobMock.mockResolvedValue({ id: "job-1", reusedExisting: false, intentConflict: false });
    mediaFileIsUsableMock.mockResolvedValue({ usable: true, durationSeconds: 60 });
    await rm(path.dirname(testState.sourcePath), { recursive: true, force: true });
    prismaMock.sermon.findFirst.mockResolvedValue({
      id: "sermon-1",
      title: "Mobile Sermon",
      status: "CREATED",
      youtubeUrl: "local-upload://Mobile%20Sermon.mov",
      processingJobs: [],
    });
    prismaMock.sermon.create.mockResolvedValue({ id: "sermon-1", title: "Mobile Sermon" });
    prismaMock.campus.findFirst.mockResolvedValue({
      id: "campus_local_default",
      organizationId: "org_local_default",
      status: "ACTIVE",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_local_bootstrap",
      status: "ACTIVE",
      memberships: [{
        organizationId: "org_local_default",
        campusId: null,
        role: "OWNER",
        status: "ACTIVE",
        expiresAt: null,
        organization: { status: "ACTIVE" },
        campus: null,
      }],
    });
    storageCapacityMock.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("rejects requests that did not receive trusted tenant context", async () => {
    const response = await POST(new Request(validStartUrl(), {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("rejects an actor without an active persisted membership", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const response = await POST(trustedRequest(validStartUrl(), {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("rejects an inactive or cross-organization selected campus", async () => {
    prismaMock.campus.findFirst.mockResolvedValueOnce(null);

    const response = await POST(trustedRequest(validStartUrl(), {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("reports a temporary outage when membership lookup fails", async () => {
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error("Database unavailable"));

    const response = await POST(trustedRequest(validStartUrl(), {
      method: "POST",
    }));

    expect(response.status).toBe(503);
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("accepts a replayed chunk without appending duplicate bytes", async () => {
    const chunkUrl = new URL("http://localhost/api/sermons/upload");
    chunkUrl.searchParams.set("uploadMode", "chunk");
    chunkUrl.searchParams.set("sermonId", "sermon-1");
    chunkUrl.searchParams.set("offset", "0");
    chunkUrl.searchParams.set("chunkBytes", "3");
    chunkUrl.searchParams.set("totalBytes", "3");

    const firstResponse = await POST(trustedRequest(chunkUrl, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    }));
    const replayResponse = await POST(trustedRequest(chunkUrl, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(prismaMock.sermon.findFirst).toHaveBeenCalledWith({
      where: {
        id: "sermon-1",
        organizationId: "org_local_default",
        campusId: "campus_local_default",
      },
      select: {
        id: true,
        title: true,
        status: true,
        youtubeUrl: true,
        processingJobs: {
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { type: true, status: true },
        },
      },
    });
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

    const response = await POST(trustedRequest(chunkUrl, {
      method: "POST",
      body: new Uint8Array([4, 5, 6]),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, receivedBytes: 2 });
    await expect(readFile(partialPath)).resolves.toEqual(Buffer.from([1, 2]));
  });

  it("checks disk capacity before creating an upload session", async () => {
    storageCapacityMock.mockRejectedValueOnce(new Error("Not enough storage."));

    const response = await POST(trustedRequest(validStartUrl(2_000_000), { method: "POST" }));

    expect(response.status).toBe(507);
    expect(storageCapacityMock).toHaveBeenCalledWith({ incomingBytes: 2_000_000 });
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("persists the optional worship-moment setting when an upload session starts", async () => {
    const url = validStartUrl();
    url.searchParams.set("includeWorshipMoments", "true");
    url.searchParams.set("sermonStartTimestamp", "30:00");
    url.searchParams.set("sermonEndTimestamp", "1:15:00");

    const response = await POST(trustedRequest(url, { method: "POST" }));

    expect(response.status).toBe(200);
    expect(prismaMock.sermon.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        includeWorshipMoments: true,
      }),
    }));
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "sermon.created",
        targetId: "sermon-1",
      }),
    }));
  });

  it("recovers a failed YouTube sermon by attaching an upload without replacing saved settings", async () => {
    runtimeMock.canRunInlineMediaProcessing.mockReturnValue(false);
    prismaMock.sermon.findFirst.mockResolvedValue({
      id: "sermon-1",
      title: "Saved sermon",
      status: "FAILED",
      youtubeUrl: "https://www.youtube.com/watch?v=blocked",
      processingJobs: [{ type: "DOWNLOAD_VIDEO", status: "FAILED" }],
    });
    mediaFileIsUsableMock
      .mockResolvedValueOnce({ usable: false, reason: "missing" })
      .mockResolvedValue({ usable: true, durationSeconds: 3_540 });

    const startUrl = new URL("http://localhost/api/sermons/upload");
    startUrl.searchParams.set("uploadMode", "recovery-start");
    startUrl.searchParams.set("sermonId", "sermon-1");
    startUrl.searchParams.set("fileName", "service.mp4");
    startUrl.searchParams.set("totalBytes", "3");

    const startResponse = await POST(trustedRequest(startUrl, { method: "POST" }));
    expect(startResponse.status).toBe(200);
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();

    const partialPath = testState.sourcePath.replace(/\.mp4$/i, ".upload.partial.mp4");
    await writeFile(partialPath, Buffer.from([1, 2, 3]));
    const finishUrl = new URL("http://localhost/api/sermons/upload");
    finishUrl.searchParams.set("uploadMode", "finish");
    finishUrl.searchParams.set("sermonId", "sermon-1");
    finishUrl.searchParams.set("fileName", "service.mp4");
    finishUrl.searchParams.set("totalBytes", "3");

    const finishResponse = await POST(trustedRequest(finishUrl, { method: "POST" }));
    expect(finishResponse.status).toBe(200);
    expect(prismaMock.sermon.update).toHaveBeenCalledWith({
      where: { id: "sermon-1" },
      data: expect.objectContaining({
        youtubeUrl: "local-upload://service.mp4",
        status: "DOWNLOADED",
        sourceDurationSeconds: 3_540,
      }),
    });
    const updateData = prismaMock.sermon.update.mock.calls.at(-1)?.[0]?.data;
    expect(updateData).not.toHaveProperty("sermonStartSeconds");
    expect(updateData).not.toHaveProperty("sermonEndSeconds");
    expect(updateData).not.toHaveProperty("includeWorshipMoments");
    expect(prismaMock.processingJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sermonId: "sermon-1",
        type: "DOWNLOAD_VIDEO",
        status: "SUCCEEDED",
      }),
    }));
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "sermon.source_recovered",
        targetId: "sermon-1",
      }),
    }));
    expect(queueProcessingJobMock).toHaveBeenCalledWith("sermon-1", "PROCESS_SERMON");
  });

  it("rejects worship discovery when the sermon start and end times are missing", async () => {
    const url = validStartUrl();
    url.searchParams.set("includeWorshipMoments", "true");

    const response = await POST(trustedRequest(url, { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      fieldErrors: {
        sermonStartTimestamp: expect.stringContaining("required"),
        sermonEndTimestamp: expect.stringContaining("required"),
      },
    });
    expect(prismaMock.sermon.create).not.toHaveBeenCalled();
  });

  it("accepts the upload on production storage but queues processing outside the web process", async () => {
    runtimeMock.canRunInlineMediaProcessing.mockReturnValue(false);
    const partialPath = testState.sourcePath.replace(/\.mp4$/i, ".upload.partial.mp4");
    await mkdir(path.dirname(partialPath), { recursive: true });
    await writeFile(partialPath, Buffer.from([1, 2, 3]));

    const finishUrl = new URL("http://localhost/api/sermons/upload");
    finishUrl.searchParams.set("uploadMode", "finish");
    finishUrl.searchParams.set("sermonId", "sermon-1");
    finishUrl.searchParams.set("totalBytes", "3");

    const response = await POST(trustedRequest(finishUrl, { method: "POST" }));

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(queueProcessingJobMock).toHaveBeenCalledWith("sermon-1", "PROCESS_SERMON");
    });
    expect(runtimeMock.canRunLocalMediaProcessing).toHaveBeenCalled();
  });

  it("reuses a finalized upload when the first durable enqueue fails", async () => {
    runtimeMock.canRunInlineMediaProcessing.mockReturnValue(false);
    queueProcessingJobMock
      .mockRejectedValueOnce(new Error("Database temporarily unavailable."))
      .mockResolvedValueOnce({ id: "job-2", reusedExisting: false, intentConflict: false });
    const partialPath = testState.sourcePath.replace(/\.mp4$/i, ".upload.partial.mp4");
    await mkdir(path.dirname(partialPath), { recursive: true });
    await writeFile(partialPath, Buffer.from([1, 2, 3]));

    const finishUrl = new URL("http://localhost/api/sermons/upload");
    finishUrl.searchParams.set("uploadMode", "finish");
    finishUrl.searchParams.set("sermonId", "sermon-1");
    finishUrl.searchParams.set("totalBytes", "3");

    const firstResponse = await POST(trustedRequest(finishUrl, { method: "POST" }));
    expect(firstResponse.status).toBe(400);
    await expect(readFile(testState.sourcePath)).resolves.toEqual(Buffer.from([1, 2, 3]));

    const retryResponse = await POST(trustedRequest(finishUrl, { method: "POST" }));
    expect(retryResponse.status).toBe(200);
    expect(queueProcessingJobMock).toHaveBeenCalledTimes(2);
    expect(queueProcessingJobMock).toHaveBeenLastCalledWith("sermon-1", "PROCESS_SERMON");
    await expect(readFile(testState.sourcePath)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });
});
