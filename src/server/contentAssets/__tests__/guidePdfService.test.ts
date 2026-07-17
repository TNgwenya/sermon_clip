import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentAssetFileUpsert: vi.fn(),
  isContentAssetDurableStorageRequired: vi.fn(() => false),
  isContentAssetPublicStorageConfigured: vi.fn(() => false),
  isTrustedContentAssetPublicUrl: vi.fn(() => false),
  uploadContentAssetFileToR2: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentAsset: { findUnique: vi.fn() },
    contentAssetFile: { upsert: mocks.contentAssetFileUpsert },
  },
}));

vi.mock("@/server/contentAssets/contentAssetPublicStorage", () => ({
  isContentAssetDurableStorageRequired: mocks.isContentAssetDurableStorageRequired,
  isContentAssetPublicStorageConfigured: mocks.isContentAssetPublicStorageConfigured,
  isTrustedContentAssetPublicUrl: mocks.isTrustedContentAssetPublicUrl,
  uploadContentAssetFileToR2: mocks.uploadContentAssetFileToR2,
}));

import {
  __guidePdfServiceTestUtils,
  getGuidePdfOutputPath,
  persistGeneratedGuidePdf,
} from "@/server/contentAssets/guidePdfService";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isContentAssetDurableStorageRequired.mockReturnValue(false);
  mocks.isContentAssetPublicStorageConfigured.mockReturnValue(false);
  mocks.contentAssetFileUpsert.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guide PDF service", () => {
  it("supports discipleship-oriented content types", () => {
    expect(__guidePdfServiceTestUtils.PDF_ELIGIBLE_TYPES.has("GUIDE")).toBe(true);
    expect(__guidePdfServiceTestUtils.PDF_ELIGIBLE_TYPES.has("DEVOTIONAL")).toBe(true);
    expect(__guidePdfServiceTestUtils.PDF_ELIGIBLE_TYPES.has("QUOTE_GRAPHIC")).toBe(false);
  });

  it("builds a safe sermon-local PDF path", () => {
    expect(getGuidePdfOutputPath("sermon-1", "asset-1")).toContain("content-assets/asset-1/ministry-guide.pdf");
    expect(() => getGuidePdfOutputPath("../sermon", "asset-1")).toThrow("Invalid content asset identifier");
  });

  it("uses request-unique files beside the final PDF for atomic generation", () => {
    const outputPath = getGuidePdfOutputPath("sermon-1", "asset-1");
    const first = __guidePdfServiceTestUtils.buildGuidePdfWorkingPaths(outputPath);
    const second = __guidePdfServiceTestUtils.buildGuidePdfWorkingPaths(outputPath);

    expect(first).not.toEqual(second);
    expect(first.stagedOutputPath).not.toBe(outputPath);
    expect(first.stagedOutputPath.substring(0, first.stagedOutputPath.lastIndexOf("/"))).toBe(outputPath.substring(0, outputPath.lastIndexOf("/")));
  });

  it("stages serverless PDF generation in the writable temporary directory", () => {
    vi.stubEnv("VERCEL", "1");
    expect(__guidePdfServiceTestUtils.getGuidePdfGenerationOutputPath("sermon-1", "asset-1"))
      .toContain("/sermon-clip-content-assets/sermon-1/asset-1/ministry-guide.pdf");
  });

  it("uploads and records a guide PDF only after durable storage succeeds", async () => {
    mocks.isContentAssetPublicStorageConfigured.mockReturnValue(true);
    mocks.uploadContentAssetFileToR2.mockResolvedValue({
      objectKey: "content-assets/asset-1/publishing/guide-file.pdf",
      publicUrl: "https://media.example.com/content-assets/asset-1/publishing/guide-file.pdf",
      uploadedAt: new Date("2026-07-16T10:00:00.000Z"),
      sizeBytes: 4096,
    });

    const result = await persistGeneratedGuidePdf({
      assetId: "asset-1",
      existingFileId: "guide-file",
      fileName: "faith-guide.pdf",
      path: "/tmp/faith-guide.pdf",
      sizeBytes: 4000,
    });

    expect(mocks.uploadContentAssetFileToR2).toHaveBeenCalledWith({
      contentAssetId: "asset-1",
      fileId: "guide-file",
      fileName: "faith-guide.pdf",
      filePath: "/tmp/faith-guide.pdf",
      mimeType: "application/pdf",
    });
    expect(mocks.contentAssetFileUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        objectKey: "content-assets/asset-1/publishing/guide-file.pdf",
        publicUrl: "https://media.example.com/content-assets/asset-1/publishing/guide-file.pdf",
        sizeBytes: BigInt(4096),
      }),
    }));
    expect(result.publicUrl).toContain("guide-file.pdf");
    expect(mocks.uploadContentAssetFileToR2.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.contentAssetFileUpsert.mock.invocationCallOrder[0],
    );
  });

  it("does not persist a guide file when its required durable upload fails", async () => {
    mocks.isContentAssetPublicStorageConfigured.mockReturnValue(true);
    mocks.uploadContentAssetFileToR2.mockRejectedValue(new Error("R2 unavailable"));

    await expect(persistGeneratedGuidePdf({
      assetId: "asset-1",
      fileName: "faith-guide.pdf",
      path: "/tmp/faith-guide.pdf",
      sizeBytes: 4000,
    })).rejects.toThrow("R2 unavailable");
    expect(mocks.contentAssetFileUpsert).not.toHaveBeenCalled();
  });

  it("keeps the sermon-local guide as the development fallback when R2 is not configured", async () => {
    const result = await persistGeneratedGuidePdf({
      assetId: "asset-1",
      existingFileId: "guide-file",
      fileName: "faith-guide.pdf",
      path: "/tmp/faith-guide.pdf",
      sizeBytes: 4000,
    });

    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
    expect(mocks.contentAssetFileUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        filePath: "/tmp/faith-guide.pdf",
        publicUrl: null,
        objectKey: null,
      }),
    }));
    expect(result).toMatchObject({ path: "/tmp/faith-guide.pdf", publicUrl: null });
  });

  it("refuses an ephemeral-only guide record when deployment storage is required", async () => {
    mocks.isContentAssetDurableStorageRequired.mockReturnValue(true);

    await expect(persistGeneratedGuidePdf({
      assetId: "asset-1",
      fileName: "faith-guide.pdf",
      path: "/tmp/faith-guide.pdf",
      sizeBytes: 4000,
    })).rejects.toThrow("Durable content-asset storage is required");
    expect(mocks.contentAssetFileUpsert).not.toHaveBeenCalled();
  });
});
