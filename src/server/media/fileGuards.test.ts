import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fileHasBytes, mediaFileIsUsable } from "@/server/media/fileGuards";

describe("media file guards", () => {
  it("treats missing files and zero-byte files as unusable", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "media-guards-"));
    const emptyPath = join(tempDir, "source.mp4");

    try {
      await writeFile(emptyPath, Buffer.alloc(0));

      await expect(fileHasBytes(join(tempDir, "missing.mp4"))).resolves.toBe(false);
      await expect(fileHasBytes(emptyPath)).resolves.toBe(false);
      await expect(mediaFileIsUsable(emptyPath)).resolves.toEqual({
        usable: false,
        reason: "The media file is missing or empty.",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("recognizes non-empty files before duration validation", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "media-guards-"));
    const filePath = join(tempDir, "not-empty.mp4");

    try {
      await writeFile(filePath, Buffer.from("not really a video"));

      await expect(fileHasBytes(filePath)).resolves.toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
