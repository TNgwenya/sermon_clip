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

import { GET } from "./route";

const baseClip = {
  exportStatus: "COMPLETED",
  exportFreshness: "UP_TO_DATE",
  exportedFilePath: "/tmp/exported.mp4",
  exportFormat: "VERTICAL_9_16",
  exportPath: "/tmp/export-legacy.mp4",
  overlayStatus: "COMPLETED",
  overlayFreshness: "UP_TO_DATE",
  overlayVideoPath: "/tmp/overlay.mp4",
  captionBurnStatus: "COMPLETED",
  captionBurnFreshness: "UP_TO_DATE",
  captionedVideoPath: "/tmp/captioned.mp4",
  captionData: null,
  transcriptSafetyStatus: "TRUSTED",
  title: "Faith in the waiting",
  hook: "Hold onto hope.",
  caption: "God remains faithful.",
  sermon: {
    title: "Faithful God",
    speakerName: "Pastor Test",
    sermonDate: new Date("2026-07-12T00:00:00.000Z"),
  },
};

describe("clip download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunLocalMediaProcessing.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(baseClip);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 1_024 });
    mocks.videoFileResponse.mockImplementation(({ filePath }: { filePath: string }) => (
      Response.json({ filePath })
    ));
  });

  it("does not serve a stale vertical export or fall back to another artifact", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseClip,
      exportFreshness: "OUTDATED",
    });

    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/download?variant=vertical"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("fresh completed vertical export"),
    });
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("does not treat a plain render as a best prepared download", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseClip,
      exportStatus: "FAILED",
      exportFreshness: "FAILED",
      overlayStatus: "FAILED",
      overlayFreshness: "FAILED",
      captionBurnStatus: "NOT_BURNED",
      captionBurnFreshness: "NEEDS_REGENERATION",
      renderedFilePath: "/tmp/plain-render.mp4",
    });

    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/download?variant=best"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("skips a stale export and serves the freshest completed polished artifact", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseClip,
      exportFreshness: "OUTDATED",
    });

    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/download?variant=best"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ filePath: "/tmp/overlay.mp4" });
    expect(mocks.videoFileResponse).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/tmp/overlay.mp4",
      disposition: "attachment",
    }));
  });
});
