import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  clipCandidate: {
    findMany: vi.fn(),
  },
}));

const recordPostingPackageMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/postingPackages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/postingPackages")>();
  return {
    ...actual,
    recordPostingPackage: recordPostingPackageMock,
  };
});

import { GET } from "./route";

function readEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;

  while (offset < zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString());
    offset = nameStart + nameLength + extraLength + compressedSize;
  }

  return names;
}

describe("ready-to-post download route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("packages ready clips with pastor-facing sermon folders, clip names, and caption files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ready-download-"));
    const videoPath = join(tempDir, "clip.mp4");

    try {
      await writeFile(videoPath, Buffer.from("video-bytes"));

      prismaMock.clipCandidate.findMany.mockResolvedValue([
        {
          id: "clip-1",
          title: "Use Your Gift!",
          hook: "God gave you something to steward.",
          caption: "Use what God placed in your hands.",
          hashtags: ["#sermonclip", "faith"],
          score: 8.7,
          finalQualityScore: 9.1,
          startTimeSeconds: 120,
          smartClipCategory: "CALL_TO_ACTION",
          intendedAudience: "Church family",
          exportedAt: new Date("2026-06-23T08:00:00.000Z"),
          exportStatus: "COMPLETED",
          exportFormat: "VERTICAL_9_16",
          exportedFilePath: videoPath,
          exportPath: null,
          overlayVideoPath: null,
          captionedVideoPath: null,
          renderedFilePath: null,
          sermon: {
            title: "Réveil: Stirring / Gift?",
            speakerName: "Pastor José",
            churchName: "Test Church",
            sermonDate: new Date("2026-06-21T00:00:00.000Z"),
          },
        },
      ]);

      const response = await GET(new Request("http://localhost/api/ready-to-post/download?clipIds=clip-1"));
      const zip = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="reveil-stirring-gift_pastor-jose_2026-06-21-posting-package.zip"',
      );
      expect(prismaMock.clipCandidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { finalQualityScore: "desc" },
            { score: "desc" },
            { startTimeSeconds: "asc" },
            { exportedAt: "desc" },
          ],
        }),
      );
      expect(readEntryNames(zip)).toEqual([
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/01_use-your-gift.mp4",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/captions/tiktok.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/captions/instagram.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/captions/youtube-shorts.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/captions/facebook.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/hashtags.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/upload-checklists/tiktok.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/upload-checklists/instagram.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/upload-checklists/youtube-shorts.txt",
        "reveil-stirring-gift_pastor-jose_2026-06-21/01_use-your-gift/upload-checklists/facebook.txt",
        "posting-manifest.json",
      ]);
      expect(recordPostingPackageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "reveil-stirring-gift_pastor-jose_2026-06-21-posting-package.zip",
          clipTitles: ["Use Your Gift!"],
          totalVideoBytes: Buffer.byteLength("video-bytes"),
        }),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not package clips when the prepared video file is empty", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ready-download-"));
    const emptyVideoPath = join(tempDir, "empty.mp4");

    try {
      await writeFile(emptyVideoPath, Buffer.alloc(0));

      prismaMock.clipCandidate.findMany.mockResolvedValue([
        {
          id: "clip-1",
          title: "A Strong Moment",
          hook: "This is where grace meets calling.",
          caption: "Grace meets calling in everyday obedience.",
          hashtags: ["#sermonclip"],
          score: 8.7,
          smartClipCategory: "CALL_TO_ACTION",
          intendedAudience: "Church family",
          exportedAt: new Date("2026-06-23T08:00:00.000Z"),
          exportStatus: "COMPLETED",
          exportFormat: "VERTICAL_9_16",
          exportedFilePath: emptyVideoPath,
          exportPath: null,
          overlayVideoPath: null,
          captionedVideoPath: null,
          renderedFilePath: null,
          sermon: {
            title: "Stirring Up Your Gift",
            speakerName: "Pastor Test",
            churchName: "Test Church",
            sermonDate: new Date("2026-06-21T00:00:00.000Z"),
          },
        },
      ]);

      const response = await GET(new Request("http://localhost/api/ready-to-post/download?clipIds=clip-1"));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'The prepared video for "A Strong Moment" is missing or not ready yet.',
      });
      expect(recordPostingPackageMock).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
