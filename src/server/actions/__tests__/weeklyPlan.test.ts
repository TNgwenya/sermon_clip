import { describe, expect, it, vi } from "vitest";

const requireSermonResourceMock = vi.hoisted(() => vi.fn());
const sermonFindFirstMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/resourceAuthorization", () => ({
  requireSermonResource: requireSermonResourceMock,
}));
vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: { findFirst: sermonFindFirstMock },
  },
}));

import {
  __weeklyPlanActionTestUtils,
  bulkScheduleWeeklyPlanAction,
} from "@/server/actions/weeklyPlan";

describe("weekly plan scheduling safeguards", () => {
  it("denies a cross-organization sermon before loading any weekly-plan sources", async () => {
    requireSermonResourceMock.mockRejectedValueOnce(
      new Error("The requested resource was not found."),
    );

    const result = await bulkScheduleWeeklyPlanAction({
      sermonId: "sermon-other-org",
      weekStart: "2099-07-20",
      timezone: "Africa/Johannesburg",
      objective: "REACH",
      items: [{
        sourceId: "clip-other-org",
        sourceKind: "CLIP",
        sermonId: "sermon-other-org",
        title: "Hidden clip",
        caption: "Hidden caption",
        contentType: "CLIP",
        pointKey: "hidden-point",
        platform: "INSTAGRAM",
        scheduledFor: "2099-07-20T10:00:00.000Z",
      }],
    });

    expect(result).toMatchObject({ success: false });
    expect(sermonFindFirstMock).not.toHaveBeenCalled();
  });

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

  it("adapts saved clip copy when a weekly-plan platform changes", () => {
    const clip = {
      title: "Choose the Faithful Step",
      hook: "Faith moves before certainty.",
      caption: "Legacy caption",
      hashtags: ["#Legacy"],
      intendedAudience: "Church family",
      captionData: {
        captionPackage: {
          primaryCaption: "God has already placed something in your hand. Choose one faithful act this week.",
          shortCaption: "Choose the next faithful step.",
          platformCaption: "What faithful step can you take today?",
          optionalHashtags: ["#Faith", "#Discipleship"],
        },
      },
    };

    const instagram = __weeklyPlanActionTestUtils.resolveWeeklyClipPlatformCopy({
      ...clip,
      platform: "INSTAGRAM",
    });
    const youtube = __weeklyPlanActionTestUtils.resolveWeeklyClipPlatformCopy({
      ...clip,
      platform: "YOUTUBE_SHORTS",
    });

    expect(instagram.caption).toContain("God has already placed something in your hand.");
    expect(instagram.caption).toContain("What faithful step can you take today?");
    expect(youtube.title).toBe("Choose the Faithful Step");
    expect(youtube.caption).toContain("#Faith #Discipleship");
    expect(instagram.caption).not.toContain("Legacy caption");
  });
});
