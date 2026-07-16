import { describe, expect, it } from "vitest";

import { __guidePdfServiceTestUtils, getGuidePdfOutputPath } from "@/server/contentAssets/guidePdfService";

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
    expect(first.inputPath).not.toBe(outputPath);
    expect(first.stagedOutputPath).not.toBe(outputPath);
    expect(first.inputPath.substring(0, first.inputPath.lastIndexOf("/"))).toBe(outputPath.substring(0, outputPath.lastIndexOf("/")));
    expect(first.stagedOutputPath.substring(0, first.stagedOutputPath.lastIndexOf("/"))).toBe(outputPath.substring(0, outputPath.lastIndexOf("/")));
  });
});
