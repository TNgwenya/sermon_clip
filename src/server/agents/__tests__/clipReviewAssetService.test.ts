import { afterEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  renderApprovedClip: vi.fn(),
  renderClipOverlay: vi.fn(),
  appendPipelineLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clipCandidate: {
      findMany: serviceMocks.findMany,
      findUnique: serviceMocks.findUnique,
      update: serviceMocks.update,
    },
  },
}));
vi.mock("@/server/agents/clipRenderService", () => ({
  renderApprovedClip: serviceMocks.renderApprovedClip,
}));
vi.mock("@/server/agents/clipOverlayService", () => ({
  renderClipOverlay: serviceMocks.renderClipOverlay,
}));
vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: serviceMocks.appendPipelineLog,
}));

import {
  __clipReviewAssetServiceTestUtils,
  prepareGeneratedClipReviewAssets,
} from "@/server/agents/clipReviewAssetService";

function reviewClip(id: string) {
  return {
    id,
    status: "SUGGESTED",
    isAiGenerated: true,
    clipType: "smart",
    qualityWarnings: [],
    renderStatus: "NOT_RENDERED",
    renderedFilePath: null,
    captionedVideoPath: null,
    overlayVideoPath: null,
    exportedFilePath: null,
    renderedSizeBytes: null,
    renderedAt: null,
    remotePreviewUrl: null,
    remotePreviewUploadedAt: null,
    renderFreshness: "NEEDS_REGENERATION",
    captionBurnFreshness: "NEEDS_REGENERATION",
    overlayFreshness: "NEEDS_REGENERATION",
    overlayStatus: "NOT_RENDERED",
    exportFreshness: "NEEDS_REGENERATION",
    exportLayoutStrategy: null,
  };
}

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
  vi.clearAllMocks();
});

describe("clip review asset service", () => {
  it("selects the strongest three previews in deterministic query order and defers the rest", () => {
    const ranked = [
      { id: "best" },
      { id: "second" },
      { id: "third" },
      { id: "later" },
    ];

    expect(__clipReviewAssetServiceTestUtils.buildPriorityPreviewPlan(ranked, 3)).toEqual({
      selected: ranked.slice(0, 3),
      deferred: ranked.slice(3),
    });
    expect(__clipReviewAssetServiceTestUtils.buildPriorityPreviewPlan(ranked)).toEqual({
      selected: ranked,
      deferred: [],
    });
  });

  it("supports a zero-work priority invocation without widening to all clips", () => {
    const ranked = [{ id: "best" }, { id: "later" }];
    expect(__clipReviewAssetServiceTestUtils.buildPriorityPreviewPlan(ranked, 0)).toEqual({
      selected: [],
      deferred: ranked,
    });
  });

  it("builds the first ranked preview, then prepares its separate branded overlay", async () => {
    vi.stubEnv("R2_PREVIEW_UPLOAD_DISABLED", "true");
    serviceMocks.findMany.mockResolvedValue([
      reviewClip("best"),
      reviewClip("second"),
      reviewClip("third"),
      reviewClip("later"),
    ]);
    serviceMocks.findUnique.mockResolvedValue({ renderedSizeBytes: 1024 });
    serviceMocks.renderApprovedClip.mockImplementation(async (clipId: string) => ({
      clipId,
      renderedFilePath: `/missing/${clipId}.raw.mp4`,
      durationSeconds: 45,
    }));
    serviceMocks.renderClipOverlay.mockResolvedValue({
      clipId: "best",
      overlayVideoPath: "/missing/branded.mp4",
      renderedAt: new Date(),
      reusedExistingFile: false,
    });

    const result = await prepareGeneratedClipReviewAssets({
      sermonId: "sermon-1",
      maxClips: 3,
      prepareFirstBrandedPreview: true,
    });

    expect(serviceMocks.renderApprovedClip.mock.calls.map(([clipId]) => clipId)).toEqual([
      "best",
      "second",
      "third",
    ]);
    expect(serviceMocks.renderClipOverlay).toHaveBeenCalledWith("best", expect.objectContaining({
      allowRerender: false,
      reviewPreviewWithoutCaptions: true,
    }));
    expect(serviceMocks.renderApprovedClip.mock.invocationCallOrder[0])
      .toBeLessThan(serviceMocks.renderClipOverlay.mock.invocationCallOrder[0]);
    expect(serviceMocks.renderClipOverlay.mock.invocationCallOrder[0])
      .toBeLessThan(serviceMocks.renderApprovedClip.mock.invocationCallOrder[1]);
    expect(result).toMatchObject({
      selectedClipIds: ["best", "second", "third"],
      deferredClipCount: 1,
      firstBrandedClipId: "best",
      firstBrandedPreviewReady: true,
      firstBrandedPreviewFailed: false,
    });
  });

  it("preserves the raw first preview and reports branding failure without failing priority prep", async () => {
    vi.stubEnv("R2_PREVIEW_UPLOAD_DISABLED", "true");
    serviceMocks.findMany.mockResolvedValue([reviewClip("best")]);
    serviceMocks.findUnique.mockResolvedValue({ renderedSizeBytes: 1024 });
    serviceMocks.renderApprovedClip.mockResolvedValue({
      clipId: "best",
      renderedFilePath: "/missing/raw.mp4",
      durationSeconds: 45,
    });
    serviceMocks.renderClipOverlay.mockRejectedValue(new Error("Brand Kit unavailable"));

    const result = await prepareGeneratedClipReviewAssets({
      sermonId: "sermon-1",
      maxClips: 1,
      prepareFirstBrandedPreview: true,
    });

    expect(result).toMatchObject({
      prepared: 1,
      failed: 0,
      firstBrandedPreviewReady: false,
      firstBrandedPreviewFailed: true,
    });
    expect(serviceMocks.appendPipelineLog).toHaveBeenCalledWith(
      "sermon-1",
      expect.stringContaining("preserving the raw review preview"),
    );
  });

  it("limits a queued one-clip repair to the requested clip", () => {
    expect(__clipReviewAssetServiceTestUtils.buildReviewAssetWhere({
      sermonId: "sermon-1",
      clipIds: ["clip-target", "clip-target", " "],
      onlyFailed: true,
    })).toEqual({
      sermonId: "sermon-1",
      id: { in: ["clip-target"] },
      status: { in: ["SUGGESTED", "APPROVED"] },
      renderStatus: "FAILED",
      OR: [
        { isAiGenerated: true },
        {
          isAiGenerated: false,
          clipType: "basic",
          qualityWarnings: { array_contains: ["BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE"] },
        },
      ],
    });
  });

  it("selects zero clips for an explicitly empty target instead of widening the repair", () => {
    expect(__clipReviewAssetServiceTestUtils.buildReviewAssetWhere({
      sermonId: "sermon-1",
      clipIds: [],
    })).toMatchObject({
      sermonId: "sermon-1",
      id: { in: [] },
    });
    expect(__clipReviewAssetServiceTestUtils.buildReviewAssetWhere({
      sermonId: "sermon-1",
    })).not.toHaveProperty("id");
  });

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

  it("renders explicitly labelled basic fallback cuts without widening to other manual clips", () => {
    expect(__clipReviewAssetServiceTestUtils.isBasicFallbackReviewClip({
      clipType: "basic",
      qualityWarnings: ["BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE"],
    })).toBe(true);
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: false,
      clipType: "basic",
      qualityWarnings: ["BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE"],
      renderStatus: "NOT_RENDERED",
    })).toBe(true);
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: false,
      clipType: "manual",
      qualityWarnings: [],
      renderStatus: "NOT_RENDERED",
    })).toBe(false);
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
