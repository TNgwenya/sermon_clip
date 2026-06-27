import type { PostingPlatform as PrismaPostingPlatform, SocialAccountStatus as PrismaSocialAccountStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { POSTING_PLATFORMS, type PostingPlatform } from "@/lib/postingDrafts";

export type SocialAccountStatus = "CONNECTED" | "NEEDS_REVIEW";

export type SocialAccount = {
  id: string;
  platform: PostingPlatform;
  label: string;
  handle: string;
  status: SocialAccountStatus;
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
  createdAt: Date;
}): SocialAccount {
  return {
    id: input.id,
    platform: PLATFORM_FROM_DB[input.platform],
    label: input.label,
    handle: input.handle ?? "",
    status: input.status,
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
  });

  return accounts.map(toSocialAccount);
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
