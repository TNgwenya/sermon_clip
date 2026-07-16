import { describe, expect, it } from "vitest";

import { __contentAssetDownloadTestUtils } from "@/app/api/content-assets/[id]/download/route";

describe("content asset download route", () => {
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
});
