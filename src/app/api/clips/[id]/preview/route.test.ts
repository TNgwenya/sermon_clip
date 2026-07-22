import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canRunLocalMediaProcessing: vi.fn(),
  findUnique: vi.fn(),
  stat: vi.fn(),
  videoFileResponse: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/lib/prisma", () => ({
  prisma: { clipCandidate: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: mocks.canRunLocalMediaProcessing,
}));
vi.mock("@/server/http/videoFileResponse", () => ({
  videoFileResponse: mocks.videoFileResponse,
}));

import { GET, HEAD } from "./route";

const uploadedAt = new Date("2026-07-22T12:01:00.000Z");
const baseClip = {
  renderedFilePath: "/tmp/rendered.mp4",
  overlayVideoPath: null,
  exportedFilePath: null,
  captionedVideoPath: null,
  remotePreviewUrl: "https://media.example.test/clip-previews/sermon-1/clip-1.mp4?v=1",
  remotePreviewUploadedAt: uploadedAt,
  renderedAt: new Date("2026-07-22T12:00:00.000Z"),
  renderFreshness: "UP_TO_DATE",
  captionBurnFreshness: "NEEDS_REGENERATION",
  overlayFreshness: "NEEDS_REGENERATION",
  exportFreshness: "NEEDS_REGENERATION",
};

describe("clip preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunLocalMediaProcessing.mockReturnValue(false);
    mocks.findUnique.mockResolvedValue(baseClip);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 1_024 });
    mocks.videoFileResponse.mockImplementation(({ request }: { request: Request }) => (
      new Response(null, { status: request.method === "HEAD" ? 204 : 200 })
    ));
  });

  it("redirects remote previews with a short private cache lifetime", async () => {
    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/preview?variant=best"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(baseClip.remotePreviewUrl);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=30, must-revalidate");
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("supports HEAD for a remote preview without proxying its bytes", async () => {
    const response = await HEAD(
      new Request("http://localhost/api/clips/clip-1/preview?variant=best", { method: "HEAD" }),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(baseClip.remotePreviewUrl);
    expect(response.body).toBeNull();
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("passes a local HEAD request to the range-aware file responder", async () => {
    mocks.canRunLocalMediaProcessing.mockReturnValue(true);

    const request = new Request("http://localhost/api/clips/clip-1/preview?variant=rendered", {
      method: "HEAD",
    });
    const response = await HEAD(request, { params: Promise.resolve({ id: "clip-1" }) });

    expect(response.status).toBe(204);
    expect(mocks.videoFileResponse).toHaveBeenCalledWith({
      request,
      filePath: baseClip.renderedFilePath,
      disposition: "inline",
    });
  });
});
