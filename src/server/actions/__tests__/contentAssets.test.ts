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
  transaction: vi.fn(),
  getPublishingServiceHealth: vi.fn(),
  getBrandingSettings: vi.fn(),
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

const scheduledFor = "2099-07-20T10:00:00.000Z";

function readyAsset(sourceTranscriptExcerpt: string | null) {
  return {
    id: "asset-1",
    sermonId: "sermon-1",
    status: "READY",
    assetType: "QUOTE_GRAPHIC",
    platform: "INSTAGRAM",
    caption: "Faithful steps matter.",
    metadataJson: {},
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
      metadataJson: { overflowDetected: false },
    }],
    contentOpportunity: { sourceTranscriptExcerpt },
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
  });
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
  mocks.contentAssetUpdate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    scheduledPost: { create: mocks.scheduledPostCreate },
    contentAsset: { update: mocks.contentAssetUpdate },
  }));
});

describe("content asset automatic scheduling", () => {
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

  it("does not expose a new graphic as ready when required durable storage fails", async () => {
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
    mocks.uploadContentAssetFilesWhenConfigured.mockRejectedValue(new Error("R2 unavailable"));

    const result = await prepareContentOpportunityForPublishingAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      platform: "INSTAGRAM",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      caption: "Faithful steps matter.",
    });

    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("not marked ready");
    expect(mocks.contentAssetCreate).not.toHaveBeenCalled();
    expect(mocks.contentAssetUpdate).not.toHaveBeenCalled();
  });

  it("persists durable object fields before exposing a rendered graphic as ready", async () => {
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
    mocks.uploadContentAssetFilesWhenConfigured.mockImplementation(async (input: {
      files: Array<{ id: string }>;
    }) => new Map([[input.files[0].id, {
      objectKey: `content-assets/asset-1/publishing/${input.files[0].id}.jpg`,
      publicUrl: `https://media.example.com/content-assets/asset-1/publishing/${input.files[0].id}.jpg`,
      uploadedAt: new Date("2026-07-16T10:00:00.000Z"),
      sizeBytes: 42_000,
    }]]));

    const result = await prepareContentOpportunityForPublishingAction({
      sermonId: "sermon-1",
      opportunityId: "opportunity-1",
      platform: "INSTAGRAM",
      title: "Faithful steps",
      bodyContent: "Faithful steps matter.",
      caption: "Faithful steps matter.",
    });

    expect(result).toMatchObject({ success: true, contentAssetId: "asset-1" });
    expect(mocks.contentAssetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "READY",
        files: {
          create: [expect.objectContaining({
            objectKey: expect.stringContaining("content-assets/asset-1/publishing/"),
            publicUrl: expect.stringContaining("https://media.example.com/content-assets/asset-1/publishing/"),
          })],
        },
      }),
      select: { id: true },
    });
    expect(mocks.uploadContentAssetFilesWhenConfigured.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.contentAssetCreate.mock.invocationCallOrder[0],
    );
  });
});
