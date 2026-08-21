import { describe, expect, it } from "vitest";

import { buildPublishingFocus } from "@/lib/publishingFocus";

describe("buildPublishingFocus", () => {
  it("puts an unapproved generated post into explicit review", () => {
    expect(buildPublishingFocus({
      sermonTitle: "Hope in the Storm",
      assetTitle: "Peace for Monday",
      assetId: "asset-1",
      assetNeedsReview: true,
    })).toEqual(expect.objectContaining({
      eyebrow: "One post",
      title: "Review Peace for Monday",
      actionLabel: "Review this post",
      actionHref: "/ready-to-post/content-assets/asset-1/studio",
    }));
  });

  it("does not imply that an approved post was published", () => {
    const focus = buildPublishingFocus({
      sermonTitle: "Hope in the Storm",
      assetTitle: "Peace for Monday",
      assetId: "asset-1",
      assetNeedsReview: false,
    });

    expect(focus.title).toBe("Prepare Peace for Monday");
    expect(focus.description).not.toMatch(/published|sent/i);
  });

  it("routes a clip back through the human sermon review", () => {
    expect(buildPublishingFocus({
      sermonTitle: "Hope in the Storm",
      sermonId: "sermon-1",
      clipTitle: "God is near",
      clipId: "clip-1",
    }).actionHref).toBe("/sermons/sermon-1/review");
  });

  it("starts an unscoped visit with the sermon, not the queue", () => {
    expect(buildPublishingFocus({})).toEqual(expect.objectContaining({
      title: "Choose one sermon, then one post.",
      actionHref: "#sermon-library",
    }));
  });
});
