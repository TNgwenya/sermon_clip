import { describe, expect, it } from "vitest";

import {
  getDefaultThumbnailWebpPath,
  getStoredOrDefaultThumbnailPath,
  getVersionedClipThumbnailPaths,
} from "@/server/agents/clipThumbnailService";
import { buildCoverFrameSource } from "@/lib/clipCoverFrame";
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

  it("versions generated poster paths by source and selected moment", () => {
    const sourceV1 = buildCoverFrameSource({ variant: "rendered", assetVersion: 1 });
    const sourceV2 = buildCoverFrameSource({ variant: "rendered", assetVersion: 2 });
    const first = getVersionedClipThumbnailPaths({
      clip: { id: "clip-1", sermonId: "sermon-1" },
      source: sourceV1,
      timeSeconds: 4.25,
    });
    const changedTime = getVersionedClipThumbnailPaths({
      clip: { id: "clip-1", sermonId: "sermon-1" },
      source: sourceV1,
      timeSeconds: 8,
    });
    const changedSource = getVersionedClipThumbnailPaths({
      clip: { id: "clip-1", sermonId: "sermon-1" },
      source: sourceV2,
      timeSeconds: 4.25,
    });

    expect(first.thumbnailPath).toContain("clip-1.cover-rendered-v1-");
    expect(first.webpPath).toMatch(/\.webp$/);
    expect(changedTime.thumbnailPath).not.toBe(first.thumbnailPath);
    expect(changedSource.thumbnailPath).not.toBe(first.thumbnailPath);
  });
});
