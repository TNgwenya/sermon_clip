import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveByteRange, videoFileResponse } from "@/server/http/videoFileResponse";

describe("resolveByteRange", () => {
  it("resolves open-ended ranges", () => {
    expect(resolveByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
  });

  it("resolves bounded ranges", () => {
    expect(resolveByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  });

  it("clamps bounded ranges to the file size", () => {
    expect(resolveByteRange("bytes=900-1200", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("resolves suffix byte ranges from the end of the file", () => {
    expect(resolveByteRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("rejects invalid or unsatisfiable ranges", () => {
    expect(resolveByteRange("bytes=1000-1200", 1000)).toBeNull();
    expect(resolveByteRange("bytes=200-100", 1000)).toBeNull();
    expect(resolveByteRange("items=0-10", 1000)).toBeNull();
  });

  it("refuses to serve empty prepared video files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const emptyVideoPath = join(tempDir, "empty.mp4");

    try {
      await writeFile(emptyVideoPath, Buffer.alloc(0));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/download"),
        filePath: emptyVideoPath,
        disposition: "attachment",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "The prepared video file is empty. Recreate the download before posting this clip.",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
