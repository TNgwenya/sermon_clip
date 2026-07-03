import { readFile, rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { createSermonAction } from "@/server/actions/sermons";
import { getSermonStoragePath } from "@/server/agents/storage";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mediaFileIsUsableMock = vi.hoisted(() => vi.fn(async (): Promise<
  | { usable: true; durationSeconds: number }
  | { usable: false; reason: string }
> => ({
  usable: true,
  durationSeconds: 60,
})));
const processSermonPipelineMock = vi.hoisted(() => vi.fn(async (sermonId: string) => ({
  sermonId,
  sermonTitle: "Sunday Hope",
  parentJobId: "process-job",
  steps: [],
  summary: "Process Sermon complete.",
})));

vi.mock("@/server/media/fileGuards", () => ({
  mediaFileIsUsable: mediaFileIsUsableMock,
}));

vi.mock("@/server/pipeline/processSermonPipeline", () => ({
  processSermonPipeline: processSermonPipelineMock,
}));

const createdSermonIds: string[] = [];

describe("create sermon upload workflow", () => {
  afterEach(async () => {
    mediaFileIsUsableMock.mockResolvedValue({
      usable: true,
      durationSeconds: 60,
    });
    processSermonPipelineMock.mockClear();

    while (createdSermonIds.length > 0) {
      const sermonId = createdSermonIds.pop();
      if (!sermonId) {
        continue;
      }

      await prisma.sermon.deleteMany({ where: { id: sermonId } });
      await rm(getSermonStoragePath(sermonId), { recursive: true, force: true });
    }
  });

  it("stores an uploaded sermon video as the local source video", async () => {
    const videoBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const formData = new FormData();
    formData.set("youtubeUrl", "");
    formData.set("sermonVideoFile", new File([videoBytes], "Sunday Sermon.mp4", { type: "video/mp4" }));
    formData.set("title", "Sunday Hope");
    formData.set("speakerName", "Pastor Test");
    formData.set("churchName", "Test Church");
    formData.set("language", "English");
    formData.set("sermonDate", "2026-06-19");
    formData.set("rightsConfirmed", "on");

    const result = await createSermonAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Sermon saved. The full clip workflow has started automatically.");
    expect(result.createdSermonId).toBeTruthy();
    createdSermonIds.push(result.createdSermonId!);
    await vi.waitFor(() => {
      expect(processSermonPipelineMock).toHaveBeenCalledWith(result.createdSermonId);
    });

    const sermon = await prisma.sermon.findUniqueOrThrow({
      where: { id: result.createdSermonId! },
      select: {
        youtubeUrl: true,
        title: true,
        speakerName: true,
        churchName: true,
        language: true,
        sermonDate: true,
        rightsConfirmed: true,
        status: true,
        sourceVideoPath: true,
        audioPath: true,
        transcriptJsonPath: true,
      },
    });

    expect(sermon).toMatchObject({
      youtubeUrl: "local-upload://Sunday%20Sermon.mp4",
      title: "Sunday Hope",
      speakerName: "Pastor Test",
      churchName: "Test Church",
      language: "English",
      rightsConfirmed: true,
      status: "DOWNLOADED",
    });
    expect(sermon.sermonDate?.toISOString()).toBe("2026-06-19T00:00:00.000Z");
    expect(sermon.sourceVideoPath).toContain("/source/source.mp4");
    expect(sermon.audioPath).toContain("/audio/audio.mp3");
    expect(sermon.transcriptJsonPath).toContain("/transcript/transcript.json");
    await expect(readFile(sermon.sourceVideoPath!)).resolves.toEqual(Buffer.from(videoBytes));
  });

  it("stores uploaded sermon video files larger than the default Server Action body limit", async () => {
    const videoBytes = new Uint8Array(1_250_000).fill(7);
    const formData = new FormData();
    formData.set("youtubeUrl", "");
    formData.set("sermonVideoFile", new File([videoBytes], "Large Sunday Sermon.mp4", { type: "video/mp4" }));
    formData.set("title", "Large Sunday Hope");
    formData.set("speakerName", "Pastor Test");
    formData.set("churchName", "Test Church");
    formData.set("language", "English");
    formData.set("rightsConfirmed", "on");

    const result = await createSermonAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(true);
    expect(result.createdSermonId).toBeTruthy();
    createdSermonIds.push(result.createdSermonId!);
    await vi.waitFor(() => {
      expect(processSermonPipelineMock).toHaveBeenCalledWith(result.createdSermonId);
    });

    const sermon = await prisma.sermon.findUniqueOrThrow({
      where: { id: result.createdSermonId! },
      select: {
        youtubeUrl: true,
        status: true,
        sourceVideoPath: true,
      },
    });

    expect(sermon.youtubeUrl).toBe("local-upload://Large%20Sunday%20Sermon.mp4");
    expect(sermon.status).toBe("DOWNLOADED");
    await expect(readFile(sermon.sourceVideoPath!)).resolves.toEqual(Buffer.from(videoBytes));
  }, 20_000);

  it("rejects uploaded sermon video files that cannot be probed as usable media", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mediaFileIsUsableMock.mockResolvedValueOnce({
      usable: false,
      reason: "Media duration probe returned an invalid duration.",
    });
    const formData = new FormData();
    formData.set("youtubeUrl", "");
    formData.set("sermonVideoFile", new File([new Uint8Array([1, 2, 3])], "Broken Sermon.mp4", { type: "video/mp4" }));
    formData.set("title", "Broken Sunday");
    formData.set("speakerName", "Pastor Test");
    formData.set("churchName", "Test Church");
    formData.set("language", "English");
    formData.set("rightsConfirmed", "on");

    let result;
    try {
      result = await createSermonAction({ success: false, message: "" }, formData);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(result.success).toBe(false);
    expect(result.message).toContain("Uploaded sermon video is not usable");
    expect(result.createdSermonId).toBeTruthy();
    createdSermonIds.push(result.createdSermonId!);
    expect(processSermonPipelineMock).not.toHaveBeenCalled();

    const sermon = await prisma.sermon.findUniqueOrThrow({
      where: { id: result.createdSermonId! },
      select: {
        status: true,
        sourceVideoPath: true,
      },
    });

    expect(sermon.status).toBe("CREATED");
    expect(sermon.sourceVideoPath).toBeNull();
  });
});
