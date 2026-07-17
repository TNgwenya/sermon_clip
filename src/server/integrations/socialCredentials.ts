import crypto from "node:crypto";

import type { PostingPlatform, Prisma, SocialConnectorProvider } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type StoredCredentialInput = {
  provider: SocialConnectorProvider;
  externalAccountId: string;
  accountName?: string | null;
  handle?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  scopes?: unknown;
  metadata?: Prisma.InputJsonValue;
  expiresAt?: Date | null;
  socialAccount?: {
    platform: PostingPlatform;
    label: string;
    handle?: string | null;
  };
};

export type DecryptedSocialCredential = {
  id: string;
  socialAccountId: string | null;
  provider: SocialConnectorProvider;
  externalAccountId: string;
  accountName: string | null;
  handle: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scopes: unknown;
  metadata: unknown;
  expiresAt: Date | null;
};

function encryptionSecret(): string {
  const secret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim()
    || process.env.AUTH_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY or AUTH_SECRET is required before storing social OAuth tokens.");
  }

  return secret;
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptToken(value: string): string {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted token format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function socialAccountExternalProvider(provider: SocialConnectorProvider): string {
  return provider.toLowerCase();
}

async function upsertSocialAccount(
  input: NonNullable<StoredCredentialInput["socialAccount"]>,
  identity: { provider: SocialConnectorProvider; externalAccountId: string },
  existingSocialAccountId: string | null,
): Promise<string> {
  const externalProvider = socialAccountExternalProvider(identity.provider);
  const existing = await prisma.socialAccount.findFirst({
    where: {
      externalProvider,
      externalAccountId: identity.externalAccountId,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.socialAccount.update({
      where: { id: existing.id },
      data: {
        platform: input.platform,
        label: input.label,
        handle: input.handle?.trim() || null,
        status: "CONNECTED",
        externalProvider,
        externalAccountId: identity.externalAccountId,
      },
    });
    return existing.id;
  }

  if (existingSocialAccountId) {
    const linkedAccount = await prisma.socialAccount.findUnique({
      where: { id: existingSocialAccountId },
      select: {
        id: true,
        externalProvider: true,
        externalAccountId: true,
        credentials: { select: { provider: true, externalAccountId: true } },
      },
    });
    const identityMatches = linkedAccount
      && linkedAccount.externalProvider === externalProvider
      && linkedAccount.externalAccountId === identity.externalAccountId;
    const canAdoptIdentity = linkedAccount
      && !linkedAccount.externalProvider
      && !linkedAccount.externalAccountId
      && linkedAccount.credentials.every((credential) => (
        credential.provider === identity.provider
        && credential.externalAccountId === identity.externalAccountId
      ));
    if (linkedAccount && (identityMatches || canAdoptIdentity)) {
      await prisma.socialAccount.update({
        where: { id: linkedAccount.id },
        data: {
          platform: input.platform,
          label: input.label,
          handle: input.handle?.trim() || null,
          status: "CONNECTED",
          externalProvider,
          externalAccountId: identity.externalAccountId,
        },
      });
      return linkedAccount.id;
    }
  }

  let created: { id: string };
  try {
    created = await prisma.socialAccount.create({
      data: {
        platform: input.platform,
        label: input.label,
        handle: input.handle?.trim() || null,
        status: "CONNECTED",
        externalProvider,
        externalAccountId: identity.externalAccountId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    const concurrentlyCreated = await prisma.socialAccount.findFirst({
      where: { externalProvider, externalAccountId: identity.externalAccountId },
      select: { id: true },
    });
    if (!concurrentlyCreated) throw error;
    created = concurrentlyCreated;
  }

  return created.id;
}

export async function upsertSocialCredential(input: StoredCredentialInput): Promise<void> {
  const existing = await prisma.socialCredential.findUnique({
    where: {
      provider_externalAccountId: {
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      },
    },
    select: {
      refreshTokenCiphertext: true,
      socialAccountId: true,
    },
  });
  const socialAccountId = input.socialAccount
    ? await upsertSocialAccount(input.socialAccount, {
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      }, existing?.socialAccountId ?? null)
    : existing?.socialAccountId ?? null;

  await prisma.socialCredential.upsert({
    where: {
      provider_externalAccountId: {
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      },
    },
    create: {
      socialAccountId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      accountName: input.accountName ?? input.socialAccount?.label ?? null,
      handle: input.handle ?? input.socialAccount?.handle ?? null,
      accessTokenCiphertext: encryptToken(input.accessToken),
      refreshTokenCiphertext: input.refreshToken ? encryptToken(input.refreshToken) : null,
      tokenType: input.tokenType ?? null,
      scopesJson: input.scopes === undefined ? undefined : input.scopes as Prisma.InputJsonValue,
      metadataJson: input.metadata,
      expiresAt: input.expiresAt ?? null,
      status: "CONNECTED",
      lastError: null,
    },
    update: {
      socialAccountId,
      accountName: input.accountName ?? input.socialAccount?.label ?? null,
      handle: input.handle ?? input.socialAccount?.handle ?? null,
      accessTokenCiphertext: encryptToken(input.accessToken),
      refreshTokenCiphertext: input.refreshToken ? encryptToken(input.refreshToken) : existing?.refreshTokenCiphertext ?? null,
      tokenType: input.tokenType ?? null,
      scopesJson: input.scopes === undefined ? undefined : input.scopes as Prisma.InputJsonValue,
      metadataJson: input.metadata,
      expiresAt: input.expiresAt ?? null,
      status: "CONNECTED",
      lastError: null,
    },
  });
}

export async function listConnectorCredentialSummaries(): Promise<Record<SocialConnectorProvider, number>> {
  const rows = await prisma.socialCredential.groupBy({
    by: ["provider"],
    where: { status: "CONNECTED" },
    _count: { provider: true },
  });

  return rows.reduce((accumulator, row) => ({
    ...accumulator,
    [row.provider]: row._count.provider,
  }), {} as Record<SocialConnectorProvider, number>);
}

export async function getConnectedCredentials(provider: SocialConnectorProvider): Promise<DecryptedSocialCredential[]> {
  const credentials = await prisma.socialCredential.findMany({
    where: {
      provider,
      status: "CONNECTED",
    },
    orderBy: { updatedAt: "desc" },
  });

  return credentials.map((credential) => ({
    id: credential.id,
    socialAccountId: credential.socialAccountId,
    provider: credential.provider,
    externalAccountId: credential.externalAccountId,
    accountName: credential.accountName,
    handle: credential.handle,
    accessToken: decryptToken(credential.accessTokenCiphertext),
    refreshToken: credential.refreshTokenCiphertext ? decryptToken(credential.refreshTokenCiphertext) : null,
    tokenType: credential.tokenType,
    scopes: credential.scopesJson,
    metadata: credential.metadataJson,
    expiresAt: credential.expiresAt,
  }));
}

export async function markCredentialSyncSuccess(id: string): Promise<void> {
  await prisma.socialCredential.update({
    where: { id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      status: "CONNECTED",
    },
  });
}

export async function markCredentialSyncError(id: string, error: unknown): Promise<void> {
  await prisma.socialCredential.update({
    where: { id },
    data: {
      lastError: error instanceof Error ? error.message : String(error),
      status: "ERROR",
    },
  }).catch(() => undefined);
}
