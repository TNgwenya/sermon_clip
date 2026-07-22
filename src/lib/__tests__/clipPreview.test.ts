import { describe, expect, it } from "vitest";

import {
  buildRetryablePreviewUrl,
  hasPreviewMetadata,
  isFreshRemotePreview,
  listBestPreviewCandidates,
  resolveFreshRemotePreviewUrl,
  resolveClipPreviewRecovery,
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
      "/tmp/overlay.mp4",
      "/tmp/captioned.mp4",
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

  it("only exposes a trimmed remote URL while it matches the current render", () => {
    const preview = {
      remotePreviewUrl: "  https://cdn.example.com/clip.mp4?v=2  ",
      renderedAt: "2026-07-03T08:00:00.000Z",
      remotePreviewUploadedAt: "2026-07-03T08:01:00.000Z",
      renderFreshness: "UP_TO_DATE" as const,
    };

    expect(resolveFreshRemotePreviewUrl(preview)).toBe("https://cdn.example.com/clip.mp4?v=2");
    expect(resolveFreshRemotePreviewUrl({
      ...preview,
      remotePreviewUploadedAt: "2026-07-03T07:59:00.000Z",
    })).toBeNull();
  });

  it("keeps the normal preview URL cacheable until the user explicitly retries", () => {
    expect(buildRetryablePreviewUrl("https://cdn.example.com/clip.mp4?v=2", 0)).toBe(
      "https://cdn.example.com/clip.mp4?v=2",
    );
    expect(buildRetryablePreviewUrl("https://cdn.example.com/clip.mp4?v=2", 3)).toBe(
      "https://cdn.example.com/clip.mp4?v=2&retry=3",
    );
  });

  it("offers a real recovery action for a missing or failed suggested preview", () => {
    expect(resolveClipPreviewRecovery({
      clipStatus: "SUGGESTED",
      renderStatus: "FAILED",
    })).toEqual({
      action: "render",
      disabled: false,
      label: "Create preview",
    });
  });

  it("rebuilds completed previews and does not duplicate active renders", () => {
    expect(resolveClipPreviewRecovery({
      clipStatus: "SUGGESTED",
      renderStatus: "COMPLETED",
    }).action).toBe("rerender");

    expect(resolveClipPreviewRecovery({
      clipStatus: "APPROVED",
      renderStatus: "RENDERING",
    })).toEqual({
      action: null,
      disabled: true,
      label: "Creating preview…",
    });
  });
});
