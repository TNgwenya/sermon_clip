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
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { upsertSocialCredential } from "@/server/integrations/socialCredentials";

const originalOauthKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "social-credential-persistence-test-key";
  prismaMock.socialAccount.findFirst.mockResolvedValue(null);
  prismaMock.socialAccount.findUnique.mockResolvedValue(null);
  prismaMock.socialAccount.update.mockResolvedValue({ id: "account-updated" });
  prismaMock.socialCredential.findUnique.mockResolvedValue(null);
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
    });

    await upsertSocialCredential({
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
      where: { externalProvider: "meta_facebook", externalAccountId: "page-immutable-1" },
      select: { id: true },
    });
    expect(prismaMock.socialAccount.findFirst).toHaveBeenNthCalledWith(2, {
      where: { externalProvider: "meta_facebook", externalAccountId: "page-immutable-2" },
      select: { id: true },
    });
    expect(prismaMock.socialAccount.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.socialCredential.upsert.mock.calls.map((call) => call[0].create.socialAccountId))
      .toEqual(["facebook-account-1", "facebook-account-2"]);
  });

  it("adopts an existing linked account only when it belongs to the same provider identity", async () => {
    prismaMock.socialCredential.findUnique.mockResolvedValue({
      refreshTokenCiphertext: null,
      socialAccountId: "legacy-youtube-account",
    });
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "legacy-youtube-account",
      externalProvider: null,
      externalAccountId: null,
      credentials: [{ provider: "YOUTUBE", externalAccountId: "channel-1" }],
    });

    await upsertSocialCredential({
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
});
