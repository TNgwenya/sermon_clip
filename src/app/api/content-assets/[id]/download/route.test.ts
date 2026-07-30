import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContentAsset: vi.fn(),
  requireContentAssetResource: vi.fn(),
}));

vi.mock("@/lib/contentAssets", () => ({
  getContentAsset: mocks.getContentAsset,
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireContentAssetResource: mocks.requireContentAssetResource,
}));

import {
  __contentAssetDownloadTestUtils,
  GET,
} from "@/app/api/content-assets/[id]/download/route";

describe("content asset download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireContentAssetResource.mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      campusId: "campus-1",
    });
  });

  it("accepts only files inside the sermon storage directory", () => {
    expect(__contentAssetDownloadTestUtils.isPathInside(
      "/tmp/storage/sermons/example",
      "/tmp/storage/sermons/example/content-assets/asset/square.png",
    )).toBe(true);
    expect(__contentAssetDownloadTestUtils.isPathInside(
      "/tmp/storage/sermons/example",
      "/tmp/storage/sermons/other/private.png",
    )).toBe(false);
    expect(__contentAssetDownloadTestUtils.isPathInside(
      "/tmp/storage/sermons/example",
      "/tmp/storage/sermons/example/../other/private.png",
    )).toBe(false);
  });

  it("does not load an asset outside the caller tenant", async () => {
    const { AuthorizedResourceNotFoundError } = await import(
      "@/server/auth/resourceAuthorization"
    );
    mocks.requireContentAssetResource.mockRejectedValue(
      new AuthorizedResourceNotFoundError(),
    );

    const response = await GET(
      new Request("https://app.example/api/content-assets/asset-other/download"),
      { params: Promise.resolve({ id: "asset-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "This prepared content asset is not available.",
    });
    expect(mocks.requireContentAssetResource).toHaveBeenCalledWith(
      "content.export",
      "asset-other",
    );
    expect(mocks.getContentAsset).not.toHaveBeenCalled();
  });
});
