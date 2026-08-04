import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DirectSourceUploadUnavailableError,
  uploadFileToPrivateSource,
} from "@/lib/directSourceUpload";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("direct private source upload client", () => {
  it("resumes completed parts, uploads the remainder, and completes the source", async () => {
    const uploadedPartNumbers: number[] = [];
    const initiatedRequests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sermons/source-upload") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (request.action === "initiate") {
          initiatedRequests.push(request);
          return jsonResponse({
            success: true,
            message: "resume",
            createdSermonId: "sermon-1",
            sourceAssetId: "asset-1",
            ready: false,
            uploadedPartNumbers: [1],
            uploadedBytes: 5,
            partSizeBytes: 5,
            partCount: 3,
          });
        }
        if (request.action === "part-url") {
          return jsonResponse({
            success: true,
            message: "signed",
            uploadUrl: `https://s3.example/part-${request.partNumber}`,
          });
        }
        if (request.action === "complete") {
          return jsonResponse({
            success: true,
            message: "stored",
            createdSermonId: "sermon-1",
            ready: true,
          });
        }
      }
      const match = url.match(/part-(\d+)$/);
      if (match && init?.method === "PUT") {
        uploadedPartNumbers.push(Number(match[1]));
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ success: false, message: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: number[] = [];
    const file = {
      name: "service.mp4",
      size: 12,
      type: "video/mp4",
      slice: (start: number, end: number) => new Blob([new Uint8Array(end - start)]),
    } as File;

    const result = await uploadFileToPrivateSource({
      mode: "create",
      sourceAssetId: "asset-1",
      file,
      onProgress: (percent) => progress.push(percent),
    });

    expect(result.ready).toBe(true);
    expect(initiatedRequests).toEqual([
      expect.objectContaining({ sourceAssetId: "asset-1" }),
    ]);
    expect(uploadedPartNumbers.sort()).toEqual([2, 3]);
    expect(progress.at(-1)).toBe(100);
  });

  it("signals when private S3 uploads are not configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      success: false,
      code: "DIRECT_SOURCE_UPLOAD_UNAVAILABLE",
      message: "not configured",
    }, 501)));
    const file = {
      name: "service.mp4",
      size: 1,
      type: "video/mp4",
      slice: () => new Blob([new Uint8Array([1])]),
    } as File;

    await expect(uploadFileToPrivateSource({ mode: "create", file }))
      .rejects.toBeInstanceOf(DirectSourceUploadUnavailableError);
  });
});
