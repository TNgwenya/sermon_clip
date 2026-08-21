import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getBrandingSettings: vi.fn(),
  readBrandingArtworkLogoDataUrl: vi.fn(),
  requireSermonResource: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { sermon: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/tenancy/databaseIsolation", () => ({
  withDatabaseTenantIsolation: (_context: unknown, operation: (transaction: unknown) => unknown) => operation({
    sermon: { findFirst: mocks.findFirst },
  }),
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireSermonResource: mocks.requireSermonResource,
}));
vi.mock("@/server/branding/artworkLogo", () => ({
  readBrandingArtworkLogoDataUrl: mocks.readBrandingArtworkLogoDataUrl,
}));
vi.mock("@/server/branding/settings", () => ({
  getBrandingSettings: mocks.getBrandingSettings,
}));

import { GET } from "./route";

describe("content production pack route tenant authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load approved copy or branding across tenant boundaries", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireSermonResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/content-packs/sermon-other/download"),
      { params: Promise.resolve({ sermonId: "sermon-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Sermon not found." });
    expect(mocks.requireSermonResource).toHaveBeenCalledWith("content.export", "sermon-other");
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.getBrandingSettings).not.toHaveBeenCalled();
    expect(mocks.readBrandingArtworkLogoDataUrl).not.toHaveBeenCalled();
  });
});
