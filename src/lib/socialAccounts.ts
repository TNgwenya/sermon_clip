import type { PostingPlatform as PrismaPostingPlatform, Prisma, SocialAccountStatus as PrismaSocialAccountStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { POSTING_PLATFORMS, type PostingPlatform } from "@/lib/postingDrafts";
import { listZernioAccounts, type ZernioAccount } from "@/server/integrations/zernioClient";

export type SocialAccountStatus = "CONNECTED" | "NEEDS_REVIEW";

export type SocialAccount = {
  id: string;
  platform: PostingPlatform;
  label: string;
  handle: string;
  status: SocialAccountStatus;
  externalProvider: string | null;
  externalAccountId: string | null;
  externalPlatform: string | null;
  profileUrl: string | null;
  credentialReady: boolean;
  createdAt: string;
};

const PLATFORM_TO_DB: Record<PostingPlatform, PrismaPostingPlatform> = {
  TikTok: "TIKTOK",
  Instagram: "INSTAGRAM",
  "YouTube Shorts": "YOUTUBE_SHORTS",
  Facebook: "FACEBOOK",
};

const PLATFORM_FROM_DB: Record<PrismaPostingPlatform, PostingPlatform> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE_SHORTS: "YouTube Shorts",
  FACEBOOK: "Facebook",
};

function toSocialAccount(input: {
  id: string;
  platform: PrismaPostingPlatform;
  label: string;
  handle: string | null;
  status: PrismaSocialAccountStatus;
  externalProvider: string | null;
  externalAccountId: string | null;
  externalPlatform: string | null;
  profileUrl: string | null;
  credentialReady?: boolean;
  createdAt: Date;
}): SocialAccount {
  return {
    id: input.id,
    platform: PLATFORM_FROM_DB[input.platform],
    label: input.label,
    handle: input.handle ?? "",
    status: input.status,
    externalProvider: input.externalProvider,
    externalAccountId: input.externalAccountId,
    externalPlatform: input.externalPlatform,
    profileUrl: input.profileUrl,
    credentialReady: input.credentialReady === true,
    createdAt: input.createdAt.toISOString(),
  };
}

export function normalizeSocialPlatform(value: unknown): PostingPlatform | null {
  return typeof value === "string" && POSTING_PLATFORMS.includes(value as PostingPlatform)
    ? value as PostingPlatform
    : null;
}

export function toPrismaPostingPlatform(platform: PostingPlatform): PrismaPostingPlatform {
  return PLATFORM_TO_DB[platform];
}

export function fromPrismaPostingPlatform(platform: PrismaPostingPlatform): PostingPlatform {
  return PLATFORM_FROM_DB[platform];
}

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const accounts = await prisma.socialAccount.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      credentials: {
        where: { status: "CONNECTED" },
        select: { provider: true },
      },
    },
  });

  return accounts.map((account) => {
    const expectedProvider = account.platform === "YOUTUBE_SHORTS"
      ? "YOUTUBE"
      : account.platform === "FACEBOOK"
        ? "META_FACEBOOK"
        : account.platform === "TIKTOK"
          ? "TIKTOK"
          : "META_INSTAGRAM";
    return toSocialAccount({
      ...account,
      credentialReady: account.credentials.some((credential) => credential.provider === expectedProvider)
        && (account.platform !== "TIKTOK" || process.env.TIKTOK_DIRECT_POST_EXPERIMENTAL === "true"),
    });
  });
}

export async function createSocialAccount(input: {
  platform: PostingPlatform;
  label: string;
  handle?: string;
}): Promise<SocialAccount> {
  const account = await prisma.socialAccount.create({
    data: {
      platform: PLATFORM_TO_DB[input.platform],
      label: input.label.trim() || `${input.platform} account`,
      handle: input.handle?.trim() || null,
      status: "CONNECTED",
    },
  });

  return toSocialAccount(account);
}

function zernioPlatformToPostingPlatform(platform: string): PrismaPostingPlatform | null {
  switch (platform.toLowerCase()) {
    case "instagram":
      return "INSTAGRAM";
    case "tiktok":
      return "TIKTOK";
    default:
      return null;
  }
}

function buildZernioAccountLabel(account: ZernioAccount): string {
  return account.displayName?.trim()
    || account.username?.trim()
    || `${account.platform} account`;
}

export async function syncZernioSocialAccounts(): Promise<SocialAccount[]> {
  const accounts = await Promise.all([
    listZernioAccounts({ platform: "instagram", status: "connected" }),
    listZernioAccounts({ platform: "tiktok", status: "connected" }),
  ]);
  const supportedAccounts = accounts.flat().filter((account) => zernioPlatformToPostingPlatform(account.platform));
  const synced: SocialAccount[] = [];

  for (const account of supportedAccounts) {
    const platform = zernioPlatformToPostingPlatform(account.platform);
    if (!platform) {
      continue;
    }

    const existing = await prisma.socialAccount.findFirst({
      where: {
        externalProvider: "zernio",
        externalAccountId: account._id,
      },
      select: { id: true },
    });
    const data = {
      platform,
      label: buildZernioAccountLabel(account),
      handle: account.username?.trim() || null,
      status: account.isActive === false ? "NEEDS_REVIEW" as const : "CONNECTED" as const,
      externalProvider: "zernio",
      externalAccountId: account._id,
      externalPlatform: account.platform,
      profileUrl: account.profileUrl ?? null,
      metadataJson: {
        profileId: account.profileId ?? null,
        displayName: account.displayName ?? null,
        isActive: account.isActive ?? null,
      } satisfies Prisma.InputJsonValue,
    };

    const record = existing
      ? await prisma.socialAccount.update({
        where: { id: existing.id },
        data,
      })
      : await prisma.socialAccount.create({
        data,
      });

    synced.push(toSocialAccount(record));
  }

  return synced;
}
