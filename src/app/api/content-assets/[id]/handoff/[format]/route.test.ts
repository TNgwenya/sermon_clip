import { describe, expect, it } from "vitest";

import { __contentAssetHandoffTestUtils } from "@/app/api/content-assets/[id]/handoff/[format]/route";

describe("content asset handoff route", () => {
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
});
