import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContentAssetGuidePdf: vi.fn(),
  readContentAssetPublicFile: vi.fn(),
}));

vi.mock("@/server/contentAssets/guidePdfService", () => ({
  generateContentAssetGuidePdf: mocks.generateContentAssetGuidePdf,
}));

vi.mock("@/server/contentAssets/contentAssetPublicStorage", () => ({
  readContentAssetPublicFile: mocks.readContentAssetPublicFile,
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
  });

  it("forces one regeneration when a cached durable PDF is no longer readable", async () => {
    mocks.readContentAssetPublicFile
      .mockRejectedValueOnce(new Error("CDN miss"))
      .mockResolvedValueOnce(Buffer.from("fresh-pdf"));

    const response = await GET(new Request("https://app.example/api/content-assets/asset-1/guide-pdf"), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.generateContentAssetGuidePdf).toHaveBeenNthCalledWith(1, "asset-1");
    expect(mocks.generateContentAssetGuidePdf).toHaveBeenNthCalledWith(2, "asset-1", {
      forceRegeneration: true,
    });
  });
});
