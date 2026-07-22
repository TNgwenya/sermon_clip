import { afterEach, describe, expect, it, vi } from "vitest";

import { __clipReviewAssetServiceTestUtils } from "@/server/agents/clipReviewAssetService";

function configureRemotePreviewStorage(): void {
  vi.stubEnv("R2_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("R2_ACCESS_KEY_ID", "b".repeat(32));
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "preview-bucket");
  vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.test");
  vi.stubEnv("R2_PREVIEW_UPLOAD_DISABLED", "false");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clip review asset service", () => {
  it("renders missing review previews for active generated clips", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(true);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "APPROVED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(true);
  });

  it("does not rerender completed generated suggestions unless forced", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    })).toBe(false);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, true)).toBe(true);
  });

  it("repairs completed preview records when their media is no longer usable", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, false, false)).toBe(true);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, false, true)).toBe(false);
  });

  it("reuses a healthy downstream preview instead of invalidating it with a raw rerender", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "APPROVED",
      isAiGenerated: true,
      renderStatus: "FAILED",
    }, false, true)).toBe(false);
  });

  it("replaces legacy full-size remote previews with compact-v1 on the next preparation run", () => {
    configureRemotePreviewStorage();
    const preview = {
      renderStatus: "COMPLETED" as const,
      renderedFilePath: "/media/rendered/clip.mp4",
      remotePreviewUrl: "https://media.example.test/clip.mp4?v=1780000000000",
      remotePreviewUploadedAt: new Date("2026-07-22T10:01:00.000Z"),
      renderedAt: new Date("2026-07-22T10:00:00.000Z"),
      renderFreshness: "UP_TO_DATE" as const,
    };

    expect(__clipReviewAssetServiceTestUtils.shouldUploadRemotePreview(preview)).toBe(true);
    expect(__clipReviewAssetServiceTestUtils.shouldUploadRemotePreview({
      ...preview,
      remotePreviewUrl: "https://media.example.test/clip.mp4?v=compact-v1-1780000000000",
    })).toBe(false);
  });
});
