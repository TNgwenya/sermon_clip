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
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
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

  it("does not fall back to an older plain render when the export is missing", async () => {
    const renderedPath = join(tempDir, "rendered.mp4");
    await writeFile(renderedPath, Buffer.from("rendered"));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
      exportFormat: "VERTICAL_9_16",
      exportedFilePath: join(tempDir, "missing.mp4"),
      exportPath: null,
      renderedFilePath: renderedPath,
    });

    expect(media.mediaReady).toBe(false);
    expect(media.outputPath).toBeNull();
  });

  it("rejects empty or missing media files", async () => {
    const emptyPath = join(tempDir, "empty.mp4");
    await writeFile(emptyPath, Buffer.alloc(0));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
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

  it("can trust exported path metadata without reading Mac-local files", async () => {
    const missingPath = join(tempDir, "mac-only.mp4");

    const media = await resolveReadyMedia(
      {
        exportStatus: "COMPLETED",
        exportFreshness: "UP_TO_DATE",
        exportFormat: "VERTICAL_9_16",
        exportedFilePath: missingPath,
        exportPath: null,
      },
      { trustMetadata: true },
    );

    expect(media).toEqual({
      mediaReady: true,
      outputPath: missingPath,
      estimatedBytes: null,
    });
  });

  it("rejects an existing export whose freshness was invalidated", async () => {
    const videoPath = join(tempDir, "stale.mp4");
    await writeFile(videoPath, Buffer.from("stale-video"));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "OUTDATED",
      exportFormat: "VERTICAL_9_16",
      exportedFilePath: videoPath,
      exportPath: videoPath,
    });

    expect(media).toEqual({
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    });
  });

  it("rejects a fresh horizontal export for short-form ready-to-post publishing", async () => {
    const videoPath = join(tempDir, "horizontal.mp4");
    await writeFile(videoPath, Buffer.from("horizontal-video"));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
      exportFormat: "HORIZONTAL_16_9",
      exportedFilePath: videoPath,
      exportPath: videoPath,
    });

    expect(media.mediaReady).toBe(false);
    expect(media.outputPath).toBeNull();
  });
});
