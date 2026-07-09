import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canRunLocalMediaProcessing: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  resolveSource: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clipCandidate: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/server/agents/clipThumbnailService", () => ({
  resolveClipThumbnailSource: mocks.resolveSource,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: mocks.canRunLocalMediaProcessing,
}));

import { GET, PUT } from "./route";

const clip = {
  id: "clip-1",
  sermonId: "sermon-1",
  title: "Faith in the waiting",
  captionData: { primaryCaption: "Keep this copy" },
  startTimeSeconds: 120,
  endTimeSeconds: 170,
  durationSeconds: 50,
  renderedFilePath: "/tmp/clip.mp4",
  overlayVideoPath: null,
  captionedVideoPath: null,
  exportedFilePath: null,
  renderFreshness: "UP_TO_DATE",
  overlayFreshness: "NEEDS_REGENERATION",
  captionBurnFreshness: "NEEDS_REGENERATION",
  exportFreshness: "NEEDS_REGENERATION",
  renderedAt: new Date("2026-07-10T08:00:00.000Z"),
  overlayRenderedAt: null,
  captionBurnedAt: null,
  exportedAt: null,
  renderAssetVersion: 3,
  overlayAssetVersion: 0,
  captionBurnAssetVersion: 0,
  exportAssetVersion: 0,
  thumbnailPath: null,
  thumbnailError: null,
  updatedAt: new Date("2026-07-10T09:00:00.000Z"),
};

describe("clip cover frame route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunLocalMediaProcessing.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(clip);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.resolveSource.mockResolvedValue({
      videoPath: "/tmp/clip.mp4",
      source: {
        variant: "rendered",
        assetVersion: 3,
        sourceUpdatedAt: clip.renderedAt,
        fingerprint: "rendered:v3:2026-07-10T08:00:00.000Z",
      },
    });
  });

  it("returns four neutral moments without claiming a best frame", async () => {
    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/cover-frame"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.candidates).toHaveLength(4);
    expect(payload.candidates.map((candidate: { label: string }) => candidate.label)).toEqual([
      "Opening",
      "Early",
      "Middle",
      "Later",
    ]);
    expect(payload).not.toHaveProperty("recommendedCandidate");
  });

  it("saves source provenance while preserving other caption data", async () => {
    const response = await PUT(
      new Request("http://localhost/api/clips/clip-1/cover-frame", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ timeSeconds: 16 }),
      }),
      { params: Promise.resolve({ id: "clip-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.selection).toMatchObject({
      schemaVersion: 1,
      timeSeconds: 16,
      durationSeconds: 50,
      sourceVariant: "rendered",
      sourceAssetVersion: 3,
      selectedBy: "USER",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "clip-1", updatedAt: clip.updatedAt },
      data: expect.objectContaining({
        captionData: expect.objectContaining({
          primaryCaption: "Keep this copy",
          coverFrameSelection: expect.objectContaining({ timeSeconds: 16 }),
        }),
        thumbnailPath: null,
        thumbnailGeneratedAt: null,
        thumbnailError: null,
      }),
    }));
  });

  it("rejects cross-site mutations", async () => {
    const response = await PUT(
      new Request("http://localhost/api/clips/clip-1/cover-frame", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: "https://example.com" },
        body: JSON.stringify({ timeSeconds: 16 }),
      }),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("does not overwrite simultaneous Studio edits", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await PUT(
      new Request("http://localhost/api/clips/clip-1/cover-frame", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeSeconds: 16 }),
      }),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("changed"),
    });
  });
});

