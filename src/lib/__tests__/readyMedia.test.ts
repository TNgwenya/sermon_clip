import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveReadyMedia } from "@/lib/readyMedia";

let tempDir = "";

function verticalExportRecord(input: {
  id: string;
  status: "WAITING" | "RENDERING" | "COMPLETED" | "FAILED";
  outputPath: string | null;
  createdAt: string;
}) {
  return {
    ...input,
    format: "VERTICAL_9_16",
  };
}

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

  it("recovers the latest completed vertical export when the canonical export is horizontal", async () => {
    const verticalPath = join(tempDir, "vertical.mp4");
    await writeFile(verticalPath, Buffer.from("vertical-video"));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
      exportFormat: "HORIZONTAL_16_9",
      exportedFilePath: join(tempDir, "horizontal.mp4"),
      exportPath: null,
      captionData: {
        exportHistory: [verticalExportRecord({
          id: "vertical-complete",
          status: "COMPLETED",
          outputPath: verticalPath,
          createdAt: "2026-07-17T10:00:00.000Z",
        })],
      },
    });

    expect(media).toEqual({
      mediaReady: true,
      outputPath: verticalPath,
      estimatedBytes: Buffer.byteLength("vertical-video"),
    });
  });

  it("can trust a historical vertical export path when the canonical export is square", async () => {
    const verticalPath = join(tempDir, "remote-vertical.mp4");

    const media = await resolveReadyMedia(
      {
        exportStatus: "COMPLETED",
        exportFreshness: "UP_TO_DATE",
        exportFormat: "SQUARE_1_1",
        exportedFilePath: join(tempDir, "square.mp4"),
        exportPath: null,
        captionData: {
          exportHistory: [verticalExportRecord({
            id: "remote-vertical",
            status: "COMPLETED",
            outputPath: verticalPath,
            createdAt: "2026-07-17T10:00:00.000Z",
          })],
        },
      },
      { trustMetadata: true },
    );

    expect(media).toEqual({
      mediaReady: true,
      outputPath: verticalPath,
      estimatedBytes: null,
    });
  });

  it.each([
    ["FAILED", "UP_TO_DATE"],
    ["COMPLETED", "OUTDATED"],
  ])("rejects historical vertical media when global export state is %s / %s", async (exportStatus, exportFreshness) => {
    const verticalPath = join(tempDir, "globally-invalid.mp4");
    await writeFile(verticalPath, Buffer.from("vertical-video"));

    const media = await resolveReadyMedia({
      exportStatus,
      exportFreshness,
      exportFormat: "HORIZONTAL_16_9",
      exportedFilePath: null,
      exportPath: null,
      captionData: {
        exportHistory: [verticalExportRecord({
          id: "vertical-complete",
          status: "COMPLETED",
          outputPath: verticalPath,
          createdAt: "2026-07-17T10:00:00.000Z",
        })],
      },
    });

    expect(media).toEqual({
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    });
  });

  it("does not fall back to an older completed vertical export after the latest vertical attempt failed", async () => {
    const olderVerticalPath = join(tempDir, "older-vertical.mp4");
    await writeFile(olderVerticalPath, Buffer.from("older-vertical-video"));

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
      exportFormat: "HORIZONTAL_16_9",
      exportedFilePath: null,
      exportPath: null,
      captionData: {
        exportHistory: [
          verticalExportRecord({
            id: "vertical-complete",
            status: "COMPLETED",
            outputPath: olderVerticalPath,
            createdAt: "2026-07-17T10:00:00.000Z",
          }),
          verticalExportRecord({
            id: "vertical-failed",
            status: "FAILED",
            outputPath: null,
            createdAt: "2026-07-17T10:05:00.000Z",
          }),
        ],
      },
    });

    expect(media).toEqual({
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    });
  });

  it("rejects a completed historical vertical export whose local file is missing", async () => {
    const missingVerticalPath = join(tempDir, "missing-vertical.mp4");

    const media = await resolveReadyMedia({
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
      exportFormat: "HORIZONTAL_16_9",
      exportedFilePath: null,
      exportPath: null,
      captionData: {
        exportHistory: [verticalExportRecord({
          id: "vertical-complete",
          status: "COMPLETED",
          outputPath: missingVerticalPath,
          createdAt: "2026-07-17T10:00:00.000Z",
        })],
      },
    });

    expect(media).toEqual({
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    });
  });
});
