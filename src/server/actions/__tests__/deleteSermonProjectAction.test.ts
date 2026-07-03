import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteSermonProjectAction } from "@/server/actions/sermons";
import { getClipOutputPath, getLegacySermonStoragePath } from "@/server/agents/storage";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const deleteClipPreviewFromR2Mock = vi.hoisted(() => vi.fn(async () => undefined));
const deletePostingMediaFromR2Mock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/server/agents/clipRemotePreviewStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agents/clipRemotePreviewStorage")>();

  return {
    ...actual,
    r2MediaStorageConfigured: () => true,
    deleteClipPreviewFromR2: deleteClipPreviewFromR2Mock,
    deletePostingMediaFromR2: deletePostingMediaFromR2Mock,
  };
});

const createdSermonIds: string[] = [];
const createdStorageRoots: string[] = [];

describe("delete sermon project action", () => {
  afterEach(async () => {
    deleteClipPreviewFromR2Mock.mockClear();
    deletePostingMediaFromR2Mock.mockClear();

    while (createdSermonIds.length > 0) {
      const sermonId = createdSermonIds.pop();
      if (sermonId) {
        await prisma.sermon.deleteMany({ where: { id: sermonId } });
      }
    }

    while (createdStorageRoots.length > 0) {
      const storageRoot = createdStorageRoots.pop();
      if (storageRoot) {
        await rm(storageRoot, { recursive: true, force: true });
      }
    }
  });

  it("deletes database rows, local project storage, and only in-project remote preview keys", async () => {
    const sermonId = `delete-action-${Date.now()}`;
    const clipId = `${sermonId}-clip`;
    const skippedClipId = `${sermonId}-foreign-clip`;
    const title = `Delete Action ${Date.now()}`;
    const storageRoot = getLegacySermonStoragePath(sermonId);
    const renderedPath = getClipOutputPath(sermonId, clipId);
    const skippedRenderedPath = getClipOutputPath(sermonId, skippedClipId);
    createdSermonIds.push(sermonId);
    createdStorageRoots.push(storageRoot);

    await mkdir(path.dirname(renderedPath), { recursive: true });
    await writeFile(renderedPath, Buffer.from("preview-a"));
    await writeFile(skippedRenderedPath, Buffer.from("preview-b"));

    await prisma.sermon.create({
      data: {
        id: sermonId,
        youtubeUrl: `local-delete-test://${sermonId}`,
        title,
        speakerName: "Readiness Test",
        churchName: "Melusi",
        language: "english",
        status: "CLIPS_GENERATED",
        rightsConfirmed: true,
        clipCandidates: {
          create: [
            {
              id: clipId,
              isAiGenerated: false,
              startTimeSeconds: 1,
              endTimeSeconds: 6,
              durationSeconds: 5,
              renderStatus: "COMPLETED",
              renderedFilePath: renderedPath,
              remotePreviewObjectKey: `clip-previews/${sermonId}/${clipId}.mp4`,
              remotePreviewUrl: `https://media.example.test/clip-previews/${sermonId}/${clipId}.mp4`,
              remotePreviewUploadedAt: new Date(),
              transcriptText: "Deletion readiness test clip.",
              title: "Deletion readiness clip",
              hook: "Deletion readiness",
              caption: "",
              hashtags: [],
              score: 0.5,
              reasonSelected: "Readiness deletion verification.",
              clipType: "readiness-test",
              riskLevel: "LOW",
              riskReasons: [],
            },
            {
              id: skippedClipId,
              isAiGenerated: false,
              startTimeSeconds: 8,
              endTimeSeconds: 13,
              durationSeconds: 5,
              renderStatus: "COMPLETED",
              renderedFilePath: skippedRenderedPath,
              remotePreviewObjectKey: `clip-previews/other-sermon/${skippedClipId}.mp4`,
              remotePreviewUrl: `https://media.example.test/clip-previews/other-sermon/${skippedClipId}.mp4`,
              remotePreviewUploadedAt: new Date(),
              transcriptText: "Foreign preview key should not be deleted.",
              title: "Foreign preview clip",
              hook: "Foreign preview",
              caption: "",
              hashtags: [],
              score: 0.5,
              reasonSelected: "Readiness deletion verification.",
              clipType: "readiness-test",
              riskLevel: "LOW",
              riskReasons: [],
            },
          ],
        },
        transcript: {
          create: {
            fullText: "Deletion readiness transcript.",
            provider: "readiness-test",
            language: "english",
          },
        },
      },
    });
    const transcript = await prisma.transcript.findUniqueOrThrow({
      where: { sermonId },
      select: { id: true },
    });
    await prisma.transcriptSegment.create({
      data: {
        sermonId,
        transcriptId: transcript.id,
        startTimeSeconds: 1,
        endTimeSeconds: 6,
        text: "Deletion readiness transcript.",
      },
    });

    await expect(readFile(renderedPath)).resolves.toEqual(Buffer.from("preview-a"));

    const result = await deleteSermonProjectAction({ sermonId, confirmationTitle: title });

    expect(result).toMatchObject({
      success: true,
      deletedSermonId: sermonId,
      deletedClipCount: 2,
      deletedRemotePreviewObjects: 1,
      skippedRemotePreviewObjects: 1,
      failedRemotePreviewObjects: 0,
      deletedStorage: true,
    });
    expect(deleteClipPreviewFromR2Mock).toHaveBeenCalledTimes(1);
    expect(deleteClipPreviewFromR2Mock).toHaveBeenCalledWith({
      sermonId,
      objectKey: `clip-previews/${sermonId}/${clipId}.mp4`,
    });

    await expect(prisma.sermon.findUnique({ where: { id: sermonId } })).resolves.toBeNull();
    await expect(prisma.clipCandidate.count({ where: { sermonId } })).resolves.toBe(0);
    await expect(prisma.transcript.findUnique({ where: { sermonId } })).resolves.toBeNull();
    await expect(prisma.transcriptSegment.count({ where: { sermonId } })).resolves.toBe(0);
    await expect(readFile(renderedPath)).rejects.toThrow();
  }, 20_000);
});
