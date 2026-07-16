import { describe, expect, it } from "vitest";

import { __contentAssetFileRouteTestUtils } from "@/app/api/content-assets/[id]/files/[fileId]/route";

describe("content asset file preview path safety", () => {
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
});
