import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  readFile: vi.fn(),
  requireContentAssetResource: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/prisma", () => ({
  prisma: { contentAssetFile: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/agents/storage", () => ({
  getSermonStoragePath: (sermonId: string) => `/tmp/sermons/${sermonId}`,
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireContentAssetResource: mocks.requireContentAssetResource,
}));

import {
  __contentAssetFileRouteTestUtils,
  GET,
} from "@/app/api/content-assets/[id]/files/[fileId]/route";

describe("content asset file preview path safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireContentAssetResource.mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      campusId: "campus-1",
    });
  });

  it("allows files inside the sermon folder and rejects sibling paths", () => {
    expect(__contentAssetFileRouteTestUtils.isPathInside(
      "/tmp/sermons/sermon-1",
      "/tmp/sermons/sermon-1/content-assets/asset-1/slide.jpg",
    )).toBe(true);
    expect(__contentAssetFileRouteTestUtils.isPathInside(
      "/tmp/sermons/sermon-1",
      "/tmp/sermons/sermon-2/private.jpg",
    )).toBe(false);
  });

  it("does not query a file when the content asset is outside the caller tenant", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireContentAssetResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/content-assets/asset-other/files/file-1"),
      { params: Promise.resolve({ id: "asset-other", fileId: "file-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "This production file is not available.",
    });
    expect(mocks.requireContentAssetResource).toHaveBeenCalledWith(
      "content.read",
      "asset-other",
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
