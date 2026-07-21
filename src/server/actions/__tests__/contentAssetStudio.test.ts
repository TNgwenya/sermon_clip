import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contentAsset: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const renderMock = vi.hoisted(() => vi.fn());
const persistenceMock = vi.hoisted(() => vi.fn((file: { name: string; order: number }) => ({
  fileName: file.name,
  mimeType: "image/png",
  filePath: `/tmp/${file.name}`,
  width: 1080,
  height: 1350,
  sizeBytes: BigInt(100),
  sortOrder: file.order,
  metadataJson: { variant: "CAROUSEL_SLIDE" },
})));
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/server/branding/settings", () => ({
  getBrandingSettings: vi.fn().mockResolvedValue({
    churchName: "Local Church",
    primaryBrandColor: "#111111",
    secondaryBrandColor: "#222222",
    defaultFontFamily: "Arial",
  }),
}));
vi.mock("@/server/contentAssets/nonVideoAssetRenderer", () => ({
  renderApprovedNonVideoAssets: renderMock,
  toContentAssetFilePersistenceInput: persistenceMock,
}));

import { saveContentAssetDesignAction } from "@/server/actions/contentAssetStudio";

const slides = [
  { id: "cover", role: "COVER" as const, templateId: "carousel-cover" as const, title: "Choose faith", body: "Three truths for this week", scripture: null },
  { id: "response", role: "CTA" as const, templateId: "carousel-cta" as const, title: "Respond", body: "Take the next faithful step", scripture: "Proverbs 3:5" },
];

describe("content asset Design Studio actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists ordered carousel copy and marks saved-only artwork for rerender", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "CAROUSEL",
      status: "READY",
      title: "Existing carousel",
      bodyContent: "Existing carousel copy",
      metadataJson: { manualHandoffRequired: true },
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "CAROUSEL_IDEA",
        status: "APPROVED",
        relatedScripture: null,
        sourceTranscriptExcerpt: "Evidence",
      },
    });
    prismaMock.contentAsset.update.mockResolvedValue({ id: "asset-1" });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faith steps",
      templateId: "carousel-cover",
      slides,
      rerender: false,
    });

    expect(result.success).toBe(true);
    expect(renderMock).not.toHaveBeenCalled();
    expect(prismaMock.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "asset-1" },
      data: expect.objectContaining({
        status: "PREPARED",
        readyAt: null,
        bodyContent: expect.stringContaining("Slide 2: Respond"),
        metadataJson: expect.objectContaining({
          manualHandoffRequired: true,
          designStudio: expect.objectContaining({
            slides,
            renderRequired: true,
            renderedAt: null,
          }),
        }),
        files: { deleteMany: {} },
      }),
    }));
  });

  it("rerenders the ordered design and atomically replaces production file records", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "CAROUSEL",
      status: "PREPARED",
      title: "Existing carousel",
      bodyContent: "Existing carousel copy",
      metadataJson: {},
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "CAROUSEL_IDEA",
        status: "APPROVED",
        relatedScripture: "Proverbs 3:5",
        sourceTranscriptExcerpt: "Evidence",
      },
    });
    renderMock.mockResolvedValue({
      files: [
        { name: "slide-01.png", order: 0 },
        { name: "slide-02.png", order: 1 },
      ],
    });
    prismaMock.contentAsset.update.mockResolvedValue({ id: "asset-1" });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faith steps",
      templateId: "carousel-cover",
      slides,
      rerender: true,
    });

    expect(result).toMatchObject({ success: true, renderedFileCount: 2 });
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({
      opportunityType: "CAROUSEL_IDEA",
      carouselSlides: slides,
      templateId: "carousel-cover",
    }));
    expect(prismaMock.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "READY",
        files: {
          deleteMany: {},
          create: expect.arrayContaining([
            expect.objectContaining({ fileName: "slide-01.png", sortOrder: 0 }),
          ]),
        },
      }),
    }));
    expect(revalidatePathMock).toHaveBeenCalledWith("/ready-to-post/content-assets/asset-1/studio");
  });

  it("honors an explicitly cleared reference line", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "QUOTE_GRAPHIC",
      status: "PREPARED",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: { relatedScripture: "Proverbs 3:5" },
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "QUOTE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: "Proverbs 3:5",
        sourceTranscriptExcerpt: "Faithful steps matter.",
      },
    });
    prismaMock.contentAsset.update.mockResolvedValue({ id: "asset-1" });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faithful steps",
      templateId: "quote-radiant",
      bodyContent: "Faithful steps matter.",
      relatedScripture: null,
      slides: [],
      rerender: false,
    });

    expect(result.success).toBe(true);
    expect(prismaMock.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadataJson: expect.objectContaining({ relatedScripture: null }),
      }),
    }));
  });

  it("leaves current production files intact when a draft save has no changes", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: {
        relatedScripture: "Proverbs 3:5",
        designStudio: {
          version: 1,
          templateId: "quote-radiant",
          slides: [],
          renderRequired: false,
          renderedAt: "2026-07-16T10:00:00.000Z",
        },
      },
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "QUOTE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: "Proverbs 3:5",
        sourceTranscriptExcerpt: "Faithful steps matter.",
      },
    });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faithful steps",
      templateId: "quote-radiant",
      bodyContent: "Faithful steps matter.",
      relatedScripture: "Proverbs 3:5",
      slides: [],
      rerender: false,
    });

    expect(result).toMatchObject({ success: true, message: "No design changes to save." });
    expect(prismaMock.contentAsset.update).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it.each(["GENERATED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"])(
    "rejects direct Design Studio mutation from %s",
    async (status) => {
      prismaMock.contentAsset.findUnique.mockResolvedValue({
        id: "asset-1",
        sermonId: "sermon-1",
        assetType: "CAROUSEL",
        status,
        metadataJson: {},
        contentOpportunityId: "opportunity-1",
        contentOpportunity: {
          opportunityType: "CAROUSEL_IDEA",
          status: "APPROVED",
          relatedScripture: null,
          sourceTranscriptExcerpt: "Evidence",
        },
      });

      const result = await saveContentAssetDesignAction({
        assetId: "asset-1",
        title: "Faith steps",
        templateId: "carousel-cover",
        slides,
        rerender: false,
      });

      expect(result.success).toBe(false);
      expect(prismaMock.contentAsset.update).not.toHaveBeenCalled();
    },
  );

  it.each([null, "NEEDS_REVIEW", "REJECTED"])(
    "requires an approved or used source opportunity (%s)",
    async (sourceStatus) => {
      prismaMock.contentAsset.findUnique.mockResolvedValue({
        id: "asset-1",
        sermonId: "sermon-1",
        assetType: "CAROUSEL",
        status: "PREPARED",
        metadataJson: {},
        contentOpportunityId: sourceStatus ? "opportunity-1" : null,
        contentOpportunity: sourceStatus ? {
          opportunityType: "CAROUSEL_IDEA",
          status: sourceStatus,
          relatedScripture: null,
          sourceTranscriptExcerpt: "Evidence",
        } : null,
      });

      const result = await saveContentAssetDesignAction({
        assetId: "asset-1",
        title: "Faith steps",
        templateId: "carousel-cover",
        slides,
        rerender: false,
      });

      expect(result).toMatchObject({ success: false });
      expect(result.message).toContain("approved or used");
      expect(prismaMock.contentAsset.update).not.toHaveBeenCalled();
    },
  );
});
