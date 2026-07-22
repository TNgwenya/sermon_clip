import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  uploadContentAssetFilesWhenConfigured: vi.fn(),
  uploadContentAssetFileToR2: vi.fn(),
  contentAssetFindUnique: vi.fn(),
  contentAssetFindFirst: vi.fn(),
  contentAssetCreate: vi.fn(),
  contentOpportunityFindFirst: vi.fn(),
  socialAccountFindUnique: vi.fn(),
  duplicateFindFirst: vi.fn(),
  contentAssetFileUpdate: vi.fn(),
  scheduledPostCreate: vi.fn(),
  contentAssetUpdate: vi.fn(),
  contentOpportunityUpdate: vi.fn(),
  transaction: vi.fn(),
  createAssetRevision: vi.fn(),
  createOpportunityRevision: vi.fn(),
  checkContentAssetMediaReadiness: vi.fn(),
  getPublishingServiceHealth: vi.fn(),
  getBrandingSettings: vi.fn(),
  readBrandingArtworkLogoDataUrl: vi.fn(),
  renderApprovedNonVideoAssets: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/contentAssets/contentAssetPublicStorage", () => ({
  uploadContentAssetFilesWhenConfigured: mocks.uploadContentAssetFilesWhenConfigured,
  uploadContentAssetFileToR2: mocks.uploadContentAssetFileToR2,
}));
vi.mock("@/server/branding/settings", () => ({
  getBrandingSettings: mocks.getBrandingSettings,
}));
vi.mock("@/server/branding/artworkLogo", () => ({
  readBrandingArtworkLogoDataUrl: mocks.readBrandingArtworkLogoDataUrl,
}));
vi.mock("@/server/contentAssets/nonVideoAssetRenderer", () => ({
  renderApprovedNonVideoAssets: mocks.renderApprovedNonVideoAssets,
  toContentAssetFilePersistenceInput: (file: {
    name: string;
    mime: string;
    path: string;
    width: number;
    height: number;
    size: number;
    order: number;
    metadata: unknown;
  }) => ({
    fileName: file.name,
    mimeType: file.mime,
    filePath: file.path,
    width: file.width,
    height: file.height,
    sizeBytes: BigInt(file.size),
    sortOrder: file.order,
    metadataJson: file.metadata,
  }),
}));
vi.mock("@/lib/publishingServiceHealth", () => ({
  getPublishingServiceHealth: mocks.getPublishingServiceHealth,
}));
vi.mock("@/server/contentRevisionService", () => ({
  createAssetRevision: mocks.createAssetRevision,
  createOpportunityRevision: mocks.createOpportunityRevision,
}));
vi.mock("@/server/contentAssets/contentAssetMediaReadiness", () => ({
  checkContentAssetMediaReadiness: mocks.checkContentAssetMediaReadiness,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentAsset: {
      findUnique: mocks.contentAssetFindUnique,
      findFirst: mocks.contentAssetFindFirst,
      create: mocks.contentAssetCreate,
      update: mocks.contentAssetUpdate,
    },
    contentOpportunity: {
      findFirst: mocks.contentOpportunityFindFirst,
    },
    socialAccount: {
      findUnique: mocks.socialAccountFindUnique,
    },
    scheduledPostContentAsset: {
      findFirst: mocks.duplicateFindFirst,
    },
    contentAssetFile: {
      update: mocks.contentAssetFileUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  prepareContentOpportunityForPublishingAction,
  scheduleContentAssetAction,
} from "@/server/actions/contentAssets";
import { createArtworkBrandFingerprint } from "@/server/branding/artworkBrandFingerprint";

const scheduledFor = "2099-07-20T10:00:00.000Z";

function readyAsset(sourceTranscriptExcerpt: string | null) {
  return {
    id: "asset-1",
    sermonId: "sermon-1",
    status: "READY",
    assetType: "QUOTE_GRAPHIC",
    platform: "INSTAGRAM",
    title: "Faith in the waiting",
    bodyContent: "Faithful steps matter.",
    structuredContentJson: null,
    caption: "Faithful steps matter.",
    hashtagsJson: [],
    callToAction: null,
    metadataJson: {},
    currentRevisionId: "asset-revision-1",
    approvedRevisionId: "asset-revision-1",
    currentRevision: { approvalState: "APPROVED", renderedAt: new Date("2099-07-19T00:00:00.000Z") },
    files: [{
      id: "file-1",
      fileName: "portrait.jpg",
      mimeType: "image/jpeg",
      filePath: "/tmp/portrait.jpg",
      objectKey: null,
      publicUrl: null,
      width: 1080,
      height: 1350,
      sizeBytes: BigInt(42_000),
      sortOrder: 0,
      metadataJson: { overflowDetected: false },
    }],
    contentOpportunity: {
      sourceTranscriptExcerpt,
      approvedRevisionId: "opportunity-revision-1",
      relatedScripture: null,
      scriptureTranslation: null,
      translationReviewState: "NOT_REQUIRED",
    },
  };
}

function automaticInput() {
  return {
    assetId: "asset-1",
    platform: "INSTAGRAM" as const,
    scheduledFor,
    timezone: "Africa/Johannesburg",
    title: "Faith in the waiting",
    caption: "Faithful steps matter.",
    automationMode: "AUTOMATIC" as const,
    socialAccountId: "account-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.socialAccountFindUnique.mockResolvedValue({
    id: "account-1",
    platform: "INSTAGRAM",
    status: "CONNECTED",
    credentials: [{
      accessTokenCiphertext: "encrypted-token",
      scopesJson: ["instagram_basic", "instagram_content_publish"],
      expiresAt: new Date("2099-08-01T00:00:00.000Z"),
    }],
  });
  mocks.duplicateFindFirst.mockResolvedValue(null);
  mocks.getPublishingServiceHealth.mockResolvedValue({
    status: "ONLINE",
    dryRun: false,
    summary: "Publishing service is online.",
  });
  mocks.uploadContentAssetFileToR2.mockResolvedValue({
    objectKey: "content-assets/asset-1/publishing/file-1.jpg",
    publicUrl: "https://media.example.com/content-assets/asset-1/publishing/file-1.jpg",
    uploadedAt: new Date("2099-07-19T00:00:00.000Z"),
    sizeBytes: 42_000,
  });
  mocks.uploadContentAssetFilesWhenConfigured.mockResolvedValue(new Map());
  mocks.getBrandingSettings.mockResolvedValue({
    churchName: "Local Church",
    primaryBrandColor: "#0F766E",
    secondaryBrandColor: "#1D4ED8",
    defaultFontFamily: "Arial",
    churchLogoPath: null,
  });
  mocks.readBrandingArtworkLogoDataUrl.mockResolvedValue(null);
  mocks.renderApprovedNonVideoAssets.mockResolvedValue({
    outputDirectory: "/tmp/content-assets/render-attempt",
    preflight: { ready: true, diagnostics: [], plannedFiles: [] },
    files: [{
      path: "/tmp/content-assets/render-attempt/portrait.jpg",
      name: "portrait.jpg",
      mime: "image/jpeg",
      width: 1080,
      height: 1350,
      size: 42_000,
      order: 0,
      metadata: {
        variant: "PORTRAIT",
        opportunityId: "opportunity-1",
        opportunityType: "QUOTE_GRAPHIC",
        sourceStatus: "APPROVED",
        publishingFormat: "JPEG",
        templateId: "quote-classic",
      },
    }],
  });
  mocks.contentAssetCreate.mockResolvedValue({ id: "asset-1" });
  mocks.contentAssetFileUpdate.mockResolvedValue({});
  mocks.scheduledPostCreate.mockResolvedValue({ id: "scheduled-1" });
  mocks.contentAssetUpdate.mockResolvedValue({ id: "asset-1" });
  mocks.contentOpportunityUpdate.mockResolvedValue({ id: "opportunity-1" });
  mocks.createAssetRevision.mockResolvedValue({ id: "asset-revision-2", revisionNumber: 2 });
  mocks.createOpportunityRevision.mockResolvedValue({ id: "opportunity-revision-1", revisionNumber: 1 });
  mocks.checkContentAssetMediaReadiness.mockResolvedValue({
    status: "READY",
    reason: "SELECTED_FILES_READY",
    message: "Publishing bytes verified.",
    selectedFileIds: ["file-1"],
    files: [{
      id: "file-1",
      status: "READY",
      source: "PUBLIC_URL",
      effectivePublicUrl: "https://media.example.com/content-assets/asset-1/publishing/file-1.jpg",
    }],
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    scheduledPost: { create: mocks.scheduledPostCreate },
    contentAsset: {
      create: mocks.contentAssetCreate,
      update: mocks.contentAssetUpdate,
    },
    contentOpportunity: { update: mocks.contentOpportunityUpdate },
  }));
});

describe("content asset automatic scheduling", () => {
  it("blocks a legacy text asset that came from a video clip brief", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue({
      ...readyAsset("Faithful steps matter."),
      assetType: "TEXT_POST",
      contentOpportunity: {
        opportunityType: "REEL_HOOK",
        sourceTranscriptExcerpt: "Faithful steps matter.",
        approvedRevisionId: "opportunity-revision-1",
        relatedScripture: null,
        scriptureTranslation: null,
        translationReviewState: "NOT_REQUIRED",
        relatedClip: null,
      },
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("video production brief");
    expect(result.message).toContain("legacy text asset");
    expect(mocks.getPublishingServiceHealth).not.toHaveBeenCalled();
    expect(mocks.scheduledPostCreate).not.toHaveBeenCalled();
  });

  it("blocks a Design Studio save-only asset until it is rerendered", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue({
      ...readyAsset("Faithful steps matter."),
      status: "PREPARED",
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("Finish rendering");
    expect(mocks.getPublishingServiceHealth).not.toHaveBeenCalled();
    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
    expect(mocks.scheduledPostCreate).not.toHaveBeenCalled();
  });

  it("blocks scheduling when church branding changed after artwork approval", async () => {
    const approvedFingerprint = createArtworkBrandFingerprint({
      churchName: "Previous Church Name",
      primaryColor: "#0F766E",
      secondaryColor: "#1D4ED8",
      fontFamily: "Arial",
      logoDataUrl: null,
    });
    mocks.contentAssetFindUnique.mockResolvedValue({
      ...readyAsset("Faithful steps matter."),
      metadataJson: {
        designStudio: {
          version: 2,
          brandSnapshot: { fingerprint: approvedFingerprint },
        },
      },
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/branding changed/i);
    expect(mocks.readBrandingArtworkLogoDataUrl).toHaveBeenCalledWith(null);
    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
    expect(mocks.scheduledPostCreate).not.toHaveBeenCalled();
  });

  it("does not upload when grounding preflight is blocked", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue(readyAsset(null));

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("transcript evidence");
    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
    expect(mocks.duplicateFindFirst).not.toHaveBeenCalled();
  });

  it("checks semantic duplicates before uploading public media", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue(readyAsset("Faithful steps matter."));
    mocks.duplicateFindFirst.mockResolvedValue({
      scheduledPost: { scheduledFor: new Date("2099-07-20T09:00:00.000Z") },
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("already planned");
    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
  });

  it("does not schedule when the selected media row has no readable bytes", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue(readyAsset("Faithful steps matter."));
    mocks.checkContentAssetMediaReadiness.mockResolvedValue({
      status: "BLOCKED",
      reason: "PUBLISHING_FILE_UNAVAILABLE",
      message: "portrait.jpg has no readable, non-empty publishing bytes. Render or upload it again.",
      selectedFileIds: ["file-1"],
      files: [],
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/no readable, non-empty publishing bytes/i);
    expect(mocks.scheduledPostCreate).not.toHaveBeenCalled();
  });

  it("does not upload or queue when the publishing service is offline", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue(readyAsset("Faithful steps matter."));
    mocks.getPublishingServiceHealth.mockResolvedValue({
      status: "NOT_SEEN",
      dryRun: false,
      summary: "Start the publishing service before scheduling automatic posts.",
    });

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("Start the publishing service");
    expect(mocks.uploadContentAssetFileToR2).not.toHaveBeenCalled();
    expect(mocks.duplicateFindFirst).not.toHaveBeenCalled();
  });

  it("uploads only after early gates, reruns strict preflight, and creates a deterministic automatic post", async () => {
    mocks.contentAssetFindUnique.mockResolvedValue(readyAsset("Faithful steps matter."));

    const result = await scheduleContentAssetAction(automaticInput());

    expect(result).toMatchObject({
      success: true,
      scheduledPostId: "scheduled-1",
    });
    expect(mocks.uploadContentAssetFileToR2).toHaveBeenCalledTimes(1);
    expect(mocks.scheduledPostCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        socialAccountId: "account-1",
        status: "PLANNED",
        automationMode: "AUTOMATIC",
        idempotencyKey: `content-asset:asset-1:INSTAGRAM:${scheduledFor}`,
      }),
      select: { id: true },
    });
  });
});

describe("content asset composer lifecycle locks", () => {
  it.each([
    "SHORT_FORM_CLIP_IDEA",
    "REEL_HOOK",
    "YOUTUBE_SHORTS_IDEA",
    "TIKTOK_IDEA",
  ])("never prepares %s as a generic content asset", async (opportunityType) => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      id: "opportunity-video-1",
      opportunityType,
      status: "APPROVED",
      relatedClip: null,
    });

    const result = await prepareContentOpportunityForPublishingAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-video-1",
      platform: "INSTAGRAM",
      title: "Video brief",
      bodyContent: "Open on this hook and use the sermon moment.",
      caption: "Watch this sermon moment.",
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("video production brief");
    expect(result.message).toContain("Find or create a sermon clip");
    expect(mocks.contentAssetCreate).not.toHaveBeenCalled();
  });

  it.each(["SCHEDULED", "PUBLISHED", "ARCHIVED"])(
    "blocks ordinary composer mutation for %s assets",
    async (status) => {
      mocks.contentAssetFindFirst.mockResolvedValue({
        id: "asset-1",
        status,
        contentOpportunityId: null,
        assetType: "TEXT_POST",
      });

      const result = await prepareContentOpportunityForPublishingAction({
        assetId: "asset-1",
        sermonId: "sermon-1",
        platform: "FACEBOOK",
        title: "New title",
        bodyContent: "Changed content",
        caption: "Changed caption",
      });

      expect(result).toMatchObject({ success: false });
      expect(result.message).toMatch(/locked|read-only/);
      expect(mocks.contentAssetUpdate).not.toHaveBeenCalled();
    },
  );

  it("defers graphic rendering and upload until the user chooses a design", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      id: "opportunity-1",
      opportunityType: "QUOTE_GRAPHIC",
      status: "APPROVED",
      sourceTranscriptExcerpt: "Faithful steps matter.",
      suggestedPlatform: "INSTAGRAM",
      relatedScripture: "Proverbs 3:5",
      aiReason: "Direct sermon quote",
    });
    mocks.contentAssetFindFirst.mockResolvedValue(null);

    const result = await prepareContentOpportunityForPublishingAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      platform: "INSTAGRAM",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      caption: "Faithful steps matter.",
    });

    expect(result).toMatchObject({ success: true, contentAssetId: "asset-1" });
    expect(result.message).toContain("Choose a design");
    expect(mocks.renderApprovedNonVideoAssets).not.toHaveBeenCalled();
    expect(mocks.uploadContentAssetFilesWhenConfigured).not.toHaveBeenCalled();
    expect(mocks.contentAssetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PREPARED",
        readyAt: null,
        metadataJson: expect.objectContaining({
          designStudio: expect.objectContaining({
            templateId: "quote-emphasis",
            renderRequired: true,
            renderedAt: null,
          }),
        }),
      }),
      select: { id: true },
    });
  });

  it("preserves a chosen Studio design when graphic copy is edited", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      id: "opportunity-1",
      opportunityType: "QUOTE_GRAPHIC",
      status: "APPROVED",
      sourceTranscriptExcerpt: "Faithful steps matter.",
      suggestedPlatform: "INSTAGRAM",
      relatedScripture: "Proverbs 3:5",
      aiReason: "Direct sermon quote",
    });
    mocks.contentAssetFindFirst.mockResolvedValue({
      id: "asset-1",
      status: "READY",
      contentOpportunityId: "opportunity-1",
      assetType: "QUOTE_GRAPHIC",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: {
        campaignId: "campaign-1",
        designStudio: {
          version: 1,
          templateId: "quote-radiant",
          slides: [],
          renderRequired: false,
          renderedAt: "2026-07-16T10:00:00.000Z",
        },
      },
    });

    const result = await prepareContentOpportunityForPublishingAction({
      assetId: "asset-1",
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      platform: "INSTAGRAM",
      title: "Faithful steps",
      bodyContent: "Faithful steps still matter.",
      caption: "Faithful steps still matter.",
    });

    expect(result).toMatchObject({ success: true, contentAssetId: "asset-1" });
    expect(mocks.contentAssetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: expect.objectContaining({
        status: "PREPARED",
        bodyContent: "Faithful steps still matter.",
        readyAt: null,
        files: { deleteMany: {} },
        metadataJson: expect.objectContaining({
          campaignId: "campaign-1",
          designStudio: expect.objectContaining({
            templateId: "quote-radiant",
            renderRequired: true,
            renderedAt: null,
          }),
        }),
      }),
      select: { id: true },
    });
    expect(mocks.renderApprovedNonVideoAssets).not.toHaveBeenCalled();
    expect(mocks.uploadContentAssetFilesWhenConfigured).not.toHaveBeenCalled();
  });

  it("keeps rendered artwork ready when only publishing details change", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      id: "opportunity-1",
      opportunityType: "QUOTE_GRAPHIC",
      status: "APPROVED",
      sourceTranscriptExcerpt: "Faithful steps matter.",
      suggestedPlatform: "INSTAGRAM",
      relatedScripture: "Proverbs 3:5",
      aiReason: "Direct sermon quote",
    });
    mocks.contentAssetFindFirst.mockResolvedValue({
      id: "asset-1",
      status: "READY",
      contentOpportunityId: "opportunity-1",
      assetType: "QUOTE_GRAPHIC",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      metadataJson: {
        designStudio: {
          version: 1,
          templateId: "quote-radiant",
          slides: [],
          renderRequired: false,
          renderedAt: "2026-07-16T10:00:00.000Z",
        },
      },
    });

    const result = await prepareContentOpportunityForPublishingAction({
      assetId: "asset-1",
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      platform: "FACEBOOK",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      caption: "A revised social caption.",
      hashtags: ["faith"],
      callToAction: "Join us Sunday",
    });

    expect(result).toMatchObject({ success: true });
    expect(result.message).toContain("artwork remains ready");
    const update = mocks.contentAssetUpdate.mock.calls[0]?.[0];
    expect(update.data).toMatchObject({
      status: "READY",
      platform: "FACEBOOK",
      caption: "A revised social caption.",
      metadataJson: expect.objectContaining({
        designStudio: expect.objectContaining({
          templateId: "quote-radiant",
          renderRequired: false,
        }),
      }),
    });
    expect(update.data.files).toBeUndefined();
    expect(update.data.readyAt).toBeUndefined();
  });

  it("preserves non-graphic files when only publishing details change", async () => {
    mocks.contentAssetFindFirst.mockResolvedValue({
      id: "asset-1",
      status: "READY",
      contentOpportunityId: null,
      assetType: "GUIDE",
      title: "Small group guide",
      bodyContent: "Discuss the next faithful step.",
      metadataJson: {},
    });

    const result = await prepareContentOpportunityForPublishingAction({
      assetId: "asset-1",
      sermonId: "sermon-1",
      platform: "FACEBOOK",
      title: "Small group guide",
      bodyContent: "Discuss the next faithful step.",
      caption: "A revised introduction for group leaders.",
      hashtags: ["discipleship"],
    });

    expect(result).toMatchObject({ success: true });
    const update = mocks.contentAssetUpdate.mock.calls[0]?.[0];
    expect(update.data.files).toBeUndefined();
  });
});
