import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveReadyMedia } from "@/lib/readyMedia";

let tempDir = "";

describe("ready media resolution", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ready-media-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("confirms exported media only when a non-empty file exists", async () => {
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));

    const media = await resolveReadyMedia({
      exportFormat: "VERTICAL_9_16",
      exportedFilePath: videoPath,
      exportPath: null,
    });

    expect(media).toMatchObject({
      mediaReady: true,
      outputPath: videoPath,
      estimatedBytes: Buffer.byteLength("video"),
    });
  });

  it("falls back to older prepared media paths when the exported path is missing", async () => {
    const renderedPath = join(tempDir, "rendered.mp4");
    await writeFile(renderedPath, Buffer.from("rendered"));

    const media = await resolveReadyMedia({
      exportFormat: "VERTICAL_9_16",
      exportedFilePath: join(tempDir, "missing.mp4"),
      exportPath: null,
      renderedFilePath: renderedPath,
    });

    expect(media.mediaReady).toBe(true);
    expect(media.outputPath).toBe(renderedPath);
  });

  it("rejects empty or missing media files", async () => {
    const emptyPath = join(tempDir, "empty.mp4");
    await writeFile(emptyPath, Buffer.alloc(0));

    const media = await resolveReadyMedia({
      exportFormat: "VERTICAL_9_16",
      exportedFilePath: emptyPath,
      exportPath: join(tempDir, "missing.mp4"),
    });

    expect(media).toEqual({
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    });
  });
});
