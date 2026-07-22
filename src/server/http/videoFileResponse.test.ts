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

  it("adds cache validators to inline video previews", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("video"));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview"),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
      expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
      expect(response.headers.get("Last-Modified")).toBeTruthy();
      expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 304 for fresh inline video cache validators", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("video"));

      const firstResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview"),
        filePath: videoPath,
        disposition: "inline",
      });
      const entityTag = firstResponse.headers.get("ETag");
      expect(entityTag).toBeTruthy();

      const cachedResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: { "If-None-Match": entityTag ?? "" },
        }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(cachedResponse.status).toBe(304);
      expect(cachedResponse.headers.get("ETag")).toBe(entityTag);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("videoFileResponse byte serving", () => {
  it("serves the requested bytes with complete range headers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("0123456789"));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: { Range: "bytes=2-5" },
        }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
      expect(response.headers.get("Content-Length")).toBe("4");
      expect(response.headers.get("Accept-Ranges")).toBe("bytes");
      await expect(response.text()).resolves.toBe("2345");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("serves suffix ranges from the end of the file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("0123456789"));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: { Range: "bytes=-3" },
        }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("Content-Range")).toBe("bytes 7-9/10");
      await expect(response.text()).resolves.toBe("789");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns an empty 416 response for an unsatisfiable range", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("0123456789"));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: { Range: "bytes=10-20" },
        }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
      await expect(response.text()).resolves.toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("honors a matching If-Range validator and ignores a stale one", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("0123456789"));
      const initialResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview"),
        filePath: videoPath,
        disposition: "inline",
      });
      const entityTag = initialResponse.headers.get("ETag");
      expect(entityTag).toBeTruthy();
      await initialResponse.body?.cancel();

      const matchingResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: {
            Range: "bytes=2-5",
            "If-Range": entityTag ?? "",
          },
        }),
        filePath: videoPath,
        disposition: "inline",
      });
      expect(matchingResponse.status).toBe(206);
      await expect(matchingResponse.text()).resolves.toBe("2345");

      const staleResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: {
            Range: "bytes=2-5",
            "If-Range": '"stale-etag"',
          },
        }),
        filePath: videoPath,
        disposition: "inline",
      });
      expect(staleResponse.status).toBe(200);
      expect(staleResponse.headers.get("Content-Range")).toBeNull();
      await expect(staleResponse.text()).resolves.toBe("0123456789");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns metadata without opening a response body for HEAD", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("0123456789"));

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", { method: "HEAD" }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Length")).toBe("10");
      expect(response.headers.get("Accept-Ranges")).toBe("bytes");
      expect(response.body).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("gives If-None-Match precedence over If-Modified-Since", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "video-response-"));
    const videoPath = join(tempDir, "preview.mp4");

    try {
      await writeFile(videoPath, Buffer.from("video"));
      const initialResponse = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview"),
        filePath: videoPath,
        disposition: "inline",
      });
      const lastModified = initialResponse.headers.get("Last-Modified");
      expect(lastModified).toBeTruthy();
      await initialResponse.body?.cancel();

      const response = await videoFileResponse({
        request: new Request("http://localhost/api/clips/clip-1/preview", {
          headers: {
            "If-None-Match": '"stale-etag"',
            "If-Modified-Since": lastModified ?? "",
          },
        }),
        filePath: videoPath,
        disposition: "inline",
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("video");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
