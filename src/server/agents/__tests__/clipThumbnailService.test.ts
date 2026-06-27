import { describe, expect, it } from "vitest";

import {
  getDefaultThumbnailWebpPath,
  getStoredOrDefaultThumbnailPath,
} from "@/server/agents/clipThumbnailService";
import { getClipThumbnailPath, getClipThumbnailWebpPath } from "@/server/agents/storage";

describe("clip thumbnail service", () => {
  it("uses a stored thumbnail path when one is available", () => {
    expect(
      getStoredOrDefaultThumbnailPath({
        id: "clip-1",
        sermonId: "sermon-1",
        thumbnailPath: "/tmp/sermon-clip/posters/clip-1.jpg",
      }),
    ).toBe("/tmp/sermon-clip/posters/clip-1.jpg");
  });

  it("falls back to the conventional clip thumbnail path", () => {
    expect(
      getStoredOrDefaultThumbnailPath({
        id: "clip-1",
        sermonId: "sermon-1",
        thumbnailPath: null,
      }),
    ).toBe(getClipThumbnailPath("sermon-1", "clip-1"));
  });

  it("uses the conventional WebP poster variant path", () => {
    expect(
      getDefaultThumbnailWebpPath({
        id: "clip-1",
        sermonId: "sermon-1",
      }),
    ).toBe(getClipThumbnailWebpPath("sermon-1", "clip-1"));
  });
});
