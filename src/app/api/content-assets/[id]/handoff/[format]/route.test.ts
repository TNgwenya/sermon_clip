import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requireContentAssetResource: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { contentAsset: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireContentAssetResource: mocks.requireContentAssetResource,
}));

import {
  __contentAssetHandoffTestUtils,
  GET,
} from "@/app/api/content-assets/[id]/handoff/[format]/route";

describe("content asset handoff route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireContentAssetResource.mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      campusId: "campus-1",
    });
  });

  it("accepts only the supported handoff formats", () => {
    expect(__contentAssetHandoffTestUtils.normalizeFormat("whatsapp")).toBe("whatsapp");
    expect(__contentAssetHandoffTestUtils.normalizeFormat("story")).toBe("story");
    expect(__contentAssetHandoffTestUtils.normalizeFormat("email")).toBe("email");
    expect(__contentAssetHandoffTestUtils.normalizeFormat("pdf")).toBeNull();
  });

  it("does not read Story files outside the source sermon folder", () => {
    expect(__contentAssetHandoffTestUtils.isPathInside(
      "/tmp/sermons/source",
      "/tmp/sermons/source/content-assets/story.png",
    )).toBe(true);
    expect(__contentAssetHandoffTestUtils.isPathInside(
      "/tmp/sermons/source",
      "/tmp/sermons/other/private.png",
    )).toBe(false);
  });

  it("does not load a handoff when export permission or tenant scope fails", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireContentAssetResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/content-assets/asset-other/handoff/story"),
      { params: Promise.resolve({ id: "asset-other", format: "story" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.requireContentAssetResource).toHaveBeenCalledWith(
      "content.export",
      "asset-other",
    );
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
