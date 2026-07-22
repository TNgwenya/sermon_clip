import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contentAsset: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const revisionMock = vi.hoisted(() => vi.fn());

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
const artworkLogoMock = vi.hoisted(() => vi.fn().mockResolvedValue("data:image/png;base64,TESTLOGO"));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/server/branding/settings", () => ({
  getBrandingSettings: vi.fn().mockResolvedValue({
    churchName: "Local Church",
    primaryBrandColor: "#111111",
    secondaryBrandColor: "#222222",
    defaultFontFamily: "Arial",
    churchLogoPath: "/managed/church-logo.png",
  }),
}));
vi.mock("@/server/branding/artworkLogo", () => ({
  readBrandingArtworkLogoDataUrl: artworkLogoMock,
}));
vi.mock("@/server/contentAssets/nonVideoAssetRenderer", () => ({
  renderApprovedNonVideoAssets: renderMock,
  toContentAssetFilePersistenceInput: persistenceMock,
}));
vi.mock("@/server/contentRevisionService", () => ({
  createAssetRevision: revisionMock,
}));

import { saveContentAssetDesignAction } from "@/server/actions/contentAssetStudio";
import { createDefaultContentArtworkSettings } from "@/lib/contentArtworkDesign";
import { createArtworkBrandFingerprint } from "@/server/branding/artworkBrandFingerprint";

const slides = [
  { id: "cover", role: "COVER" as const, templateId: "carousel-cover" as const, title: "Choose faith", body: "Three truths for this week", scripture: null },
  { id: "response", role: "CTA" as const, templateId: "carousel-cta" as const, title: "Respond", body: "Take the next faithful step", scripture: "Proverbs 3:5" },
];
const globalTextOverrides = {
  version: 1 as const,
  eyebrowText: "This Sunday",
  footerText: "Melusi Church",
  showEyebrow: true,
  showFooter: true,
};
const coverTextOverrides = {
  version: 1 as const,
  eyebrowText: "Start here",
  footerText: null,
  showEyebrow: true,
  showFooter: false,
};

describe("content asset Design Studio actions", () => {
  beforeEach(() => {
    revisionMock.mockResolvedValue({ id: "asset-revision-1", revisionNumber: 1 });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      contentAsset: { update: prismaMock.contentAsset.update },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists ordered carousel copy and marks saved-only artwork for rerender", async () => {
    const slidesWithTextOverrides = [
      { ...slides[0], textOverrides: coverTextOverrides },
      slides[1],
    ];
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
      textOverrides: globalTextOverrides,
      slides: slidesWithTextOverrides,
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
            textOverrides: globalTextOverrides,
            slides: slidesWithTextOverrides,
            renderRequired: true,
            renderedAt: null,
          }),
        }),
        files: { deleteMany: {} },
      }),
    }));
  });

  it("rerenders the ordered design and atomically replaces production file records", async () => {
    const slidesWithTextOverrides = [
      { ...slides[0], textOverrides: coverTextOverrides },
      slides[1],
    ];
    const artwork = {
      ...createDefaultContentArtworkSettings("carousel-cover"),
      backgroundId: "mountain-dawn" as const,
      paletteId: "sunrise" as const,
      typographyPresetId: "humanist" as const,
    };
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
      textOverrides: globalTextOverrides,
      slides: slidesWithTextOverrides,
      artwork,
      rerender: true,
    });

    expect(result).toMatchObject({ success: true, renderedFileCount: 2 });
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({
      opportunityType: "CAROUSEL_IDEA",
      carouselSlides: slidesWithTextOverrides,
      templateId: "carousel-cover",
      artwork,
      textOverrides: globalTextOverrides,
      branding: expect.objectContaining({
        logoDataUrl: "data:image/png;base64,TESTLOGO",
      }),
    }), expect.objectContaining({
      storageKey: expect.stringMatching(/^design-[0-9a-f-]{36}$/),
    }));
    const storageKey = renderMock.mock.calls[0]?.[1]?.storageKey as string;
    const renderAttemptId = storageKey.slice("design-".length);
    expect(prismaMock.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "READY",
        metadataJson: expect.objectContaining({
          designStudio: expect.objectContaining({
            version: 2,
            templateVersion: 1,
            artwork,
            textOverrides: globalTextOverrides,
            slides: slidesWithTextOverrides,
            brandSnapshot: expect.objectContaining({
              churchName: "Local Church",
              primaryColor: "#111111",
              secondaryColor: "#222222",
              fingerprint: createArtworkBrandFingerprint({
                churchName: "Local Church",
                primaryColor: "#111111",
                secondaryColor: "#222222",
                fontFamily: "Arial",
                logoDataUrl: "data:image/png;base64,TESTLOGO",
              }),
            }),
            renderAttemptId,
          }),
        }),
        files: {
          deleteMany: {},
          create: expect.arrayContaining([
            expect.objectContaining({ fileName: "slide-01.png", sortOrder: 0 }),
          ]),
        },
      }),
    }));
    expect(revalidatePathMock).toHaveBeenCalledWith("/ready-to-post/content-assets/asset-1/studio");

    await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faith steps",
      templateId: "carousel-cover",
      textOverrides: globalTextOverrides,
      slides: slidesWithTextOverrides,
      artwork,
      rerender: true,
    });
    const nextStorageKey = renderMock.mock.calls[1]?.[1]?.storageKey as string;
    expect(nextStorageKey).toMatch(/^design-[0-9a-f-]{36}$/);
    expect(nextStorageKey).not.toBe(storageKey);
  });

  it("treats a global artwork text override as a persisted design change", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: {
        designStudio: {
          version: 2,
          templateId: "quote-radiant",
          textOverrides: {
            version: 1,
            eyebrowText: null,
            footerText: null,
            showEyebrow: true,
            showFooter: true,
          },
          slides: [],
        },
      },
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "QUOTE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: null,
        sourceTranscriptExcerpt: "Faithful steps matter.",
      },
    });
    prismaMock.contentAsset.update.mockResolvedValue({ id: "asset-1" });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faithful steps",
      templateId: "quote-radiant",
      bodyContent: "Faithful steps matter.",
      textOverrides: {
        eyebrowText: "  Sermon   takeaway ",
        footerText: "  Local Church ",
        showEyebrow: false,
        showFooter: true,
      },
      slides: [],
      rerender: false,
    });

    expect(result).toMatchObject({ success: true });
    expect(result.message).not.toBe("No design changes to save.");
    expect(prismaMock.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadataJson: expect.objectContaining({
          designStudio: expect.objectContaining({
            textOverrides: {
              version: 1,
              eyebrowText: "Sermon takeaway",
              footerText: "Local Church",
              showEyebrow: false,
              showFooter: true,
            },
          }),
        }),
      }),
    }));
  });

  it("rejects a root template that does not match the asset type", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "QUOTE_GRAPHIC",
      status: "PREPARED",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: {},
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "QUOTE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: null,
        sourceTranscriptExcerpt: "Faithful steps matter.",
      },
    });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faithful steps",
      templateId: "scripture-focus",
      bodyContent: "Faithful steps matter.",
      slides: [],
      rerender: false,
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/not compatible/i);
    expect(renderMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a carousel slide template that does not match its declared role", async () => {
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
        relatedScripture: null,
        sourceTranscriptExcerpt: "Evidence",
      },
    });
    const mismatchedSlides = [
      { ...slides[0], templateId: "carousel-content" as const },
      slides[1],
    ];

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "Faith steps",
      templateId: "carousel-cover",
      slides: mismatchedSlides,
      rerender: false,
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/slide 1.*not compatible.*cover role/i);
    expect(renderMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  it("requires an explicit Scripture accuracy confirmation before final rendering", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "SCRIPTURE_GRAPHIC",
      status: "PREPARED",
      title: "The Lord is my shepherd",
      bodyContent: "The Lord is my shepherd; I lack nothing.",
      metadataJson: {},
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "SCRIPTURE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: "Psalm 23:1",
        scriptureTranslation: "NIV",
        translationReviewState: "APPROVED",
        sourceTranscriptExcerpt: null,
        approvedRevisionId: "opportunity-revision-1",
      },
    });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "The Lord is my shepherd",
      templateId: "scripture-focus",
      bodyContent: "The Lord is my shepherd; I lack nothing.",
      relatedScripture: "Psalm 23:1",
      slides: [],
      rerender: true,
      scriptureAccuracyConfirmed: false,
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/confirm that the edited verse wording/i);
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("renders a confirmed Scripture design with its approved translation", async () => {
    prismaMock.contentAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      assetType: "SCRIPTURE_GRAPHIC",
      status: "PREPARED",
      title: "The Lord is my shepherd",
      bodyContent: "The Lord is my shepherd; I lack nothing.",
      metadataJson: {},
      contentOpportunityId: "opportunity-1",
      contentOpportunity: {
        opportunityType: "SCRIPTURE_GRAPHIC",
        status: "APPROVED",
        relatedScripture: "Psalm 23:1",
        scriptureTranslation: "NIV",
        translationReviewState: "APPROVED",
        sourceTranscriptExcerpt: null,
        approvedRevisionId: "opportunity-revision-1",
      },
    });
    renderMock.mockResolvedValue({ files: [{ name: "scripture.png", order: 0 }] });
    prismaMock.contentAsset.update.mockResolvedValue({ id: "asset-1" });

    const result = await saveContentAssetDesignAction({
      assetId: "asset-1",
      title: "The Lord is my shepherd",
      templateId: "scripture-focus",
      bodyContent: "The Lord is my shepherd; I lack nothing.",
      relatedScripture: "Psalm 23:1",
      slides: [],
      rerender: true,
      scriptureAccuracyConfirmed: true,
    });

    expect(result).toMatchObject({ success: true });
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({
      relatedScripture: "Psalms 23:1 (NIV)",
    }), expect.objectContaining({
      storageKey: expect.stringMatching(/^design-[0-9a-f-]{36}$/),
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
