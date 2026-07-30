import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContentAssetGuidePdf: vi.fn(),
  readContentAssetPublicFile: vi.fn(),
  requireContentAssetResource: vi.fn(),
}));

vi.mock("@/server/contentAssets/guidePdfService", () => ({
  generateContentAssetGuidePdf: mocks.generateContentAssetGuidePdf,
}));

vi.mock("@/server/contentAssets/contentAssetPublicStorage", () => ({
  readContentAssetPublicFile: mocks.readContentAssetPublicFile,
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireContentAssetResource: mocks.requireContentAssetResource,
}));

import { GET } from "@/app/api/content-assets/[id]/guide-pdf/route";

const durableGuide = {
  path: null,
  publicUrl: "https://media.example.com/content-assets/asset-1/publishing/guide.pdf",
  objectKey: "content-assets/asset-1/publishing/guide.pdf",
  fileName: "faith-guide.pdf",
  sizeBytes: 9,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContentAssetResource.mockResolvedValue({
    id: "asset-1",
    organizationId: "org-1",
    campusId: "campus-1",
  });
  mocks.generateContentAssetGuidePdf.mockResolvedValue(durableGuide);
  mocks.readContentAssetPublicFile.mockResolvedValue(Buffer.from("pdf-bytes"));
});

describe("content asset guide PDF route", () => {
  it("serves the durable object before considering a local path", async () => {
    const response = await GET(new Request("https://app.example/api/content-assets/asset-1/guide-pdf"), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("faith-guide.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("pdf-bytes"));
    expect(mocks.readContentAssetPublicFile).toHaveBeenCalledWith(durableGuide.publicUrl);
    expect(mocks.generateContentAssetGuidePdf).toHaveBeenCalledWith("asset-1", {
      tenantScope: {
        organizationId: "org-1",
        campusId: "campus-1",
      },
    });
  });

  it("forces one regeneration when a cached durable PDF is no longer readable", async () => {
    mocks.readContentAssetPublicFile
      .mockRejectedValueOnce(new Error("CDN miss"))
      .mockResolvedValueOnce(Buffer.from("fresh-pdf"));

    const response = await GET(new Request("https://app.example/api/content-assets/asset-1/guide-pdf"), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.generateContentAssetGuidePdf).toHaveBeenNthCalledWith(1, "asset-1", {
      tenantScope: {
        organizationId: "org-1",
        campusId: "campus-1",
      },
    });
    expect(mocks.generateContentAssetGuidePdf).toHaveBeenNthCalledWith(2, "asset-1", {
      tenantScope: {
        organizationId: "org-1",
        campusId: "campus-1",
      },
      forceRegeneration: true,
    });
  });

  it("does not generate a guide for an asset outside the caller tenant", async () => {
    const { AuthorizedResourceNotFoundError } = await import(
      "@/server/auth/resourceAuthorization"
    );
    mocks.requireContentAssetResource.mockRejectedValue(
      new AuthorizedResourceNotFoundError(),
    );

    const response = await GET(
      new Request("https://app.example/api/content-assets/asset-other/guide-pdf"),
      { params: Promise.resolve({ id: "asset-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "This ministry-guide PDF is not available.",
    });
    expect(mocks.requireContentAssetResource).toHaveBeenCalledWith(
      "content.export",
      "asset-other",
    );
    expect(mocks.generateContentAssetGuidePdf).not.toHaveBeenCalled();
    expect(mocks.readContentAssetPublicFile).not.toHaveBeenCalled();
  });
});
