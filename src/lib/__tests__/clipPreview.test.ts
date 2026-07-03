import { describe, expect, it } from "vitest";

import {
  hasPreviewMetadata,
  isFreshRemotePreview,
  listBestPreviewCandidates,
  resolveBestPreviewCandidate,
} from "@/lib/clipPreview";

describe("clip preview helpers", () => {
  it("orders best preview candidates from most polished to plain render", () => {
    expect(
      listBestPreviewCandidates({
        renderedFilePath: "/tmp/rendered.mp4",
        overlayVideoPath: "/tmp/overlay.mp4",
        captionedVideoPath: "/tmp/captioned.mp4",
        exportedFilePath: "/tmp/exported.mp4",
      }),
    ).toEqual([
      "/tmp/exported.mp4",
      "/tmp/captioned.mp4",
      "/tmp/overlay.mp4",
      "/tmp/rendered.mp4",
    ]);
  });

  it("skips missing preview paths", () => {
    expect(
      listBestPreviewCandidates({
        renderedFilePath: "/tmp/rendered.mp4",
        overlayVideoPath: null,
        captionedVideoPath: undefined,
        exportedFilePath: "",
      }),
    ).toEqual(["/tmp/rendered.mp4"]);
  });

  it("skips stale preview assets when freshness is supplied", () => {
    expect(
      listBestPreviewCandidates({
        renderedFilePath: "/tmp/rendered.mp4",
        overlayVideoPath: "/tmp/overlay.mp4",
        captionedVideoPath: "/tmp/captioned.mp4",
        exportedFilePath: "/tmp/exported.mp4",
        renderFreshness: "UP_TO_DATE",
        overlayFreshness: "NEEDS_REGENERATION",
        captionBurnFreshness: "OUTDATED",
        exportFreshness: "FAILED",
      }),
    ).toEqual(["/tmp/rendered.mp4"]);
  });

  it("returns the best fresh preview variant and path", () => {
    expect(
      resolveBestPreviewCandidate({
        renderedFilePath: "/tmp/rendered.mp4",
        captionedVideoPath: "/tmp/captioned.mp4",
        exportedFilePath: "/tmp/exported.mp4",
        renderFreshness: "UP_TO_DATE",
        captionBurnFreshness: "UP_TO_DATE",
        exportFreshness: "NEEDS_REGENERATION",
      }),
    ).toEqual({
      variant: "captioned",
      path: "/tmp/captioned.mp4",
    });
  });

  it("accepts remote previews uploaded after the current render", () => {
    expect(
      isFreshRemotePreview({
        remotePreviewUrl: "https://cdn.example.com/clip.mp4",
        renderedAt: "2026-07-03T08:00:00.000Z",
        remotePreviewUploadedAt: "2026-07-03T08:01:00.000Z",
        renderFreshness: "UP_TO_DATE",
      }),
    ).toBe(true);
  });

  it("rejects stale remote previews from older renders", () => {
    expect(
      isFreshRemotePreview({
        remotePreviewUrl: "https://cdn.example.com/clip.mp4",
        renderedAt: "2026-07-03T08:01:00.000Z",
        remotePreviewUploadedAt: "2026-07-03T08:00:00.000Z",
        renderFreshness: "UP_TO_DATE",
      }),
    ).toBe(false);
  });

  it("rejects remote previews when the render asset is stale", () => {
    expect(
      hasPreviewMetadata({
        remotePreviewUrl: "https://cdn.example.com/clip.mp4",
        renderedAt: "2026-07-03T08:00:00.000Z",
        remotePreviewUploadedAt: "2026-07-03T08:01:00.000Z",
        renderFreshness: "NEEDS_REGENERATION",
      }),
    ).toBe(false);
  });
});
