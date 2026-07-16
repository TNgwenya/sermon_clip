import { describe, expect, it } from "vitest";

import { __weeklyPlanActionTestUtils } from "@/server/actions/weeklyPlan";

describe("weekly plan scheduling safeguards", () => {
  it("uses one platform-ready format instead of counting duplicate PNG and JPEG variants", () => {
    const files = [
      { mimeType: "image/png", width: 1080, height: 1350, sizeBytes: BigInt(100), metadataJson: { variant: "PORTRAIT" } },
      { mimeType: "image/jpeg", width: 1080, height: 1350, sizeBytes: BigInt(80), metadataJson: { variant: "PORTRAIT" } },
      { mimeType: "image/png", width: 1080, height: 1920, sizeBytes: BigInt(120), metadataJson: { variant: "STORY" } },
    ];
    const result = __weeklyPlanActionTestUtils.selectPlatformPreflightFiles({
      assetType: "QUOTE_GRAPHIC",
      platform: "INSTAGRAM",
      files,
    });
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe("image/png");
    expect(result[0].height).toBe(1350);
  });

  it("selects no more than ten ordered carousel images from a single format", () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      mimeType: index < 10 ? "image/png" : "image/jpeg",
      width: 1080,
      height: 1350,
      sizeBytes: BigInt(100),
      metadataJson: { variant: "CAROUSEL_SLIDE", slideNumber: (index % 10) + 1 },
    }));
    const result = __weeklyPlanActionTestUtils.selectPlatformPreflightFiles({
      assetType: "CAROUSEL",
      platform: "INSTAGRAM",
      files,
    });
    expect(result).toHaveLength(10);
    expect(result.every((file) => file.mimeType === "image/png")).toBe(true);
  });
});
