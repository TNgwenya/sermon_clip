import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  publicPageFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    sermonPublicPage: {
      findFirst: mocks.publicPageFindFirst,
    },
  },
}));

import {
  normalizePublicSermonSlug,
  loadPublicSermonPage,
  projectPublicAsset,
  recordPublicSermonCtaClick,
  safeExternalCtaUrl,
  saveManagedPublicSermonPage,
  youtubePublicVideo,
} from "@/server/publicSermon/publicSermonService";

beforeEach(() => {
  mocks.transaction.mockReset();
  mocks.publicPageFindFirst.mockReset();
});

describe("public sermon security boundary", () => {
  it("queries only published pages with an explicit projection that excludes sensitive fields", async () => {
    mocks.publicPageFindFirst.mockResolvedValue(null);

    await expect(loadPublicSermonPage("hope-sunday")).resolves.toBeNull();

    const query = mocks.publicPageFindFirst.mock.calls[0]?.[0];
    expect(query.where).toEqual({ slug: "hope-sunday", status: "PUBLISHED" });
    const projection = JSON.stringify(query.select);
    expect(projection).not.toMatch(/transcript|filePath|sourceVideoPath|audioPath|membership|userSession/i);
  });

  it("normalizes slugs and rejects private or credential-bearing CTA destinations", () => {
    expect(normalizePublicSermonSlug("  Hope & Grace — Sunday! ")).toBe("hope-grace-sunday");
    expect(safeExternalCtaUrl("https://church.example/visit#details")).toBe("https://church.example/visit");
    expect(safeExternalCtaUrl("http://church.example/visit")).toBeNull();
    expect(safeExternalCtaUrl("https://localhost/visit")).toBeNull();
    expect(safeExternalCtaUrl("https://127.0.0.1/visit")).toBeNull();
    expect(safeExternalCtaUrl("https://user:secret@church.example/visit")).toBeNull();
  });

  it("accepts only recognizable public YouTube video URLs", () => {
    expect(youtubePublicVideo("https://youtu.be/abc123XYZ_0")?.embedUrl)
      .toBe("https://www.youtube-nocookie.com/embed/abc123XYZ_0");
    expect(youtubePublicVideo("https://www.youtube.com/watch?v=abc123XYZ_0")?.watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123XYZ_0");
    expect(youtubePublicVideo("https://video.example/abc123XYZ_0")).toBeNull();
  });

  it("uses approved revision copy but suppresses media belonging to a newer draft", () => {
    const projected = projectPublicAsset({
      id: "asset-1",
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      title: "Current mutable title",
      bodyContent: "Current mutable body",
      caption: null,
      hashtagsJson: [],
      callToAction: null,
      currentRevisionId: "revision-draft",
      approvedRevisionId: "revision-approved",
      currentRevision: {
        id: "revision-draft",
        title: "Unapproved rewrite",
        bodyContent: "Do not expose",
        caption: null,
        hashtagsJson: [],
        callToAction: null,
        approvalState: "REAPPROVAL_REQUIRED",
      },
      approvedRevision: {
        id: "revision-approved",
        title: "Approved title",
        bodyContent: "Approved body",
        caption: "Approved caption",
        hashtagsJson: ["#Hope"],
        callToAction: "Reflect this week",
        approvalState: "APPROVED",
      },
      files: [{
        id: "file-from-draft",
        publicUrl: "https://media.example/content-assets/asset-1/publishing/file.jpg",
        mimeType: "image/jpeg",
        width: 1080,
        height: 1080,
        sortOrder: 0,
      }],
    }, () => true);

    expect(projected).toMatchObject({
      title: "Approved title",
      body: "Approved body",
      hashtags: ["#Hope"],
      media: [],
    });
    expect(JSON.stringify(projected)).not.toContain("Unapproved rewrite");
    expect(JSON.stringify(projected)).not.toContain("file-from-draft");
  });

  it("tenant-scopes management writes and records an audit event in one transaction", async () => {
    const whereQueries: unknown[] = [];
    const auditCreate = vi.fn().mockResolvedValue({});
    const pageCreate = vi.fn().mockResolvedValue({
      id: "page-1",
      slug: "hope-sunday",
      status: "DRAFT",
      primaryCtaUrl: null,
    });
    mocks.transaction.mockImplementation(async (operation) => operation({
      sermon: {
        findFirst: vi.fn(async (query) => {
          whereQueries.push(query.where);
          return {
            id: "sermon-1",
            organizationId: "org-1",
            campusId: "campus-1",
            youtubeUrl: "https://www.youtube.com/watch?v=abc123XYZ_0",
            publicPage: null,
          };
        }),
      },
      sermonPublicPage: { create: pageCreate, update: vi.fn() },
      auditEvent: { create: auditCreate },
    }));

    await saveManagedPublicSermonPage({
      sermonId: "sermon-1",
      slug: "hope-sunday",
      title: "Hope this Sunday",
      summary: null,
      primaryCtaLabel: null,
      primaryCtaUrl: null,
      intent: "SAVE",
      actorUserId: "user-1",
      tenantScope: { organizationId: "org-1", campusId: "campus-1" },
    });

    expect(whereQueries).toEqual([{
      id: "sermon-1",
      organizationId: "org-1",
      campusId: "campus-1",
    }]);
    expect(pageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        createdByUserId: "user-1",
      }),
    }));
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("records a privacy-safe CTA outcome atomically with the aggregate counter", async () => {
    const update = vi.fn().mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) => operation({
      sermonPublicPage: {
        findFirst: vi.fn().mockResolvedValue({
          id: "page-1",
          organizationId: "org-1",
          campusId: "campus-1",
          primaryCtaUrl: "https://church.example/visit",
        }),
        update,
      },
    }));

    await expect(recordPublicSermonCtaClick("hope-sunday"))
      .resolves.toBe("https://church.example/visit");
    expect(update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        ctaClickCount: { increment: 1 },
        ministryOutcomes: {
          create: {
            organizationId: "org-1",
            campusId: "campus-1",
            outcomeType: "WEBSITE_CLICK",
            value: 1,
            notes: "Public sermon page primary CTA click.",
          },
        },
      },
    });
    expect(JSON.stringify(update.mock.calls)).not.toMatch(/ip|userAgent|fingerprint|cookie/i);
  });
});
