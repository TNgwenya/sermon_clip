import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  socialAccount: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  socialCredential: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  getConnectedCredentials,
  upsertSocialCredential,
} from "@/server/integrations/socialCredentials";

const originalOauthKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
const tenantScope = {
  organizationId: "org-church-1",
  campusId: "campus-main",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "social-credential-persistence-test-key";
  prismaMock.socialAccount.findFirst.mockResolvedValue(null);
  prismaMock.socialAccount.findUnique.mockResolvedValue(null);
  prismaMock.socialAccount.update.mockResolvedValue({ id: "account-updated" });
  prismaMock.socialCredential.findUnique.mockResolvedValue(null);
  prismaMock.socialCredential.findMany.mockResolvedValue([]);
  prismaMock.socialCredential.upsert.mockResolvedValue({ id: "credential-1" });
});

afterEach(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = originalOauthKey;
});

describe("social credential persistence", () => {
  it("preserves the linked social account when a token refresh omits socialAccount", async () => {
    prismaMock.socialCredential.findUnique.mockResolvedValue({
      refreshTokenCiphertext: "stored-refresh-token",
      socialAccountId: "youtube-account-1",
      campusId: "campus-main",
    });

    await upsertSocialCredential({
      tenantScope,
      provider: "YOUTUBE",
      externalAccountId: "channel-1",
      accountName: "Church channel",
      accessToken: "new-access-token",
    });

    expect(prismaMock.socialAccount.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.socialCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ socialAccountId: "youtube-account-1" }),
    }));
  });

  it("keeps same-name pages separate by immutable provider account ID", async () => {
    prismaMock.socialAccount.create
      .mockResolvedValueOnce({ id: "facebook-account-1" })
      .mockResolvedValueOnce({ id: "facebook-account-2" });

    for (const pageId of ["page-immutable-1", "page-immutable-2"]) {
      await upsertSocialCredential({
        tenantScope,
        provider: "META_FACEBOOK",
        externalAccountId: pageId,
        accountName: "Sunday Service",
        accessToken: `token-${pageId}`,
        socialAccount: {
          platform: "FACEBOOK",
          label: "Sunday Service",
        },
      });
    }

    expect(prismaMock.socialAccount.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: tenantScope.organizationId,
        externalProvider: "meta_facebook",
        externalAccountId: "page-immutable-1",
      },
      select: { id: true, campusId: true },
    });
    expect(prismaMock.socialAccount.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId: tenantScope.organizationId,
        externalProvider: "meta_facebook",
        externalAccountId: "page-immutable-2",
      },
      select: { id: true, campusId: true },
    });
    expect(prismaMock.socialAccount.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.socialCredential.upsert.mock.calls.map((call) => call[0].create.socialAccountId))
      .toEqual(["facebook-account-1", "facebook-account-2"]);
  });

  it("adopts an existing linked account only when it belongs to the same provider identity", async () => {
    prismaMock.socialCredential.findUnique.mockResolvedValue({
      refreshTokenCiphertext: null,
      socialAccountId: "legacy-youtube-account",
      campusId: "campus-main",
    });
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "legacy-youtube-account",
      organizationId: tenantScope.organizationId,
      campusId: "campus-main",
      externalProvider: null,
      externalAccountId: null,
      credentials: [{ provider: "YOUTUBE", externalAccountId: "channel-1" }],
    });

    await upsertSocialCredential({
      tenantScope,
      provider: "YOUTUBE",
      externalAccountId: "channel-1",
      accountName: "Church channel",
      accessToken: "access-token",
      socialAccount: {
        platform: "YOUTUBE_SHORTS",
        label: "Church channel",
      },
    });

    expect(prismaMock.socialAccount.create).not.toHaveBeenCalled();
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "legacy-youtube-account" },
      data: expect.objectContaining({
        externalProvider: "youtube",
        externalAccountId: "channel-1",
      }),
    }));
  });

  it("never adopts a matching provider identity from another organization", async () => {
    prismaMock.socialAccount.create.mockResolvedValue({ id: "tenant-owned-account" });

    await upsertSocialCredential({
      tenantScope,
      provider: "YOUTUBE",
      externalAccountId: "shared-provider-channel",
      accountName: "Church channel",
      accessToken: "access-token",
      socialAccount: {
        platform: "YOUTUBE_SHORTS",
        label: "Church channel",
      },
    });

    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: tenantScope.organizationId,
        externalAccountId: "shared-provider-channel",
      }),
    }));
    expect(prismaMock.socialCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_provider_externalAccountId: {
          organizationId: tenantScope.organizationId,
          provider: "YOUTUBE",
          externalAccountId: "shared-provider-channel",
        },
      },
      create: expect.objectContaining({
        organizationId: tenantScope.organizationId,
        campusId: tenantScope.campusId,
      }),
    }));
  });

  it("does not move a provider identity between campus scopes", async () => {
    prismaMock.socialCredential.findUnique.mockResolvedValue({
      refreshTokenCiphertext: null,
      socialAccountId: "campus-north-account",
      campusId: "campus-north",
    });

    await expect(upsertSocialCredential({
      tenantScope,
      provider: "YOUTUBE",
      externalAccountId: "channel-1",
      accountName: "Church channel",
      accessToken: "access-token",
    })).rejects.toThrow("different campus");

    expect(prismaMock.socialCredential.upsert).not.toHaveBeenCalled();
  });

  it("loads connected credentials through organization and campus visibility scope", async () => {
    await getConnectedCredentials("YOUTUBE", tenantScope);

    expect(prismaMock.socialCredential.findMany).toHaveBeenCalledWith({
      where: {
        provider: "YOUTUBE",
        status: "CONNECTED",
        organizationId: tenantScope.organizationId,
        OR: [
          { campusId: tenantScope.campusId },
          { campusId: null },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
  });
});
