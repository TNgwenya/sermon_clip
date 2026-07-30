import crypto from "node:crypto";

import type { PostingPlatform, Prisma, SocialConnectorProvider } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type SocialTenantScope = Readonly<{
  organizationId: string;
  campusId: string | null;
}>;

type StoredCredentialInput = {
  tenantScope: SocialTenantScope;
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
  organizationId: string;
  campusId: string | null;
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

type SocialTokenContext = Readonly<{
  organizationId: string;
  provider: SocialConnectorProvider;
  externalAccountId: string;
}>;

function tokenAdditionalData(context: SocialTokenContext): Buffer {
  return Buffer.from([
    "sermonclip-social-oauth-token",
    context.organizationId,
    context.provider,
    context.externalAccountId,
  ].join("\u001f"), "utf8");
}

export function encryptToken(value: string, context?: SocialTokenContext): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  if (context) {
    cipher.setAAD(tokenAdditionalData(context));
  }
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    context ? "v2" : "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptToken(value: string, context?: SocialTokenContext): string {
  const [version, iv, tag, encrypted] = value.split(":");
  if ((version !== "v1" && version !== "v2") || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted token format.");
  }
  if (version === "v2" && !context) {
    throw new Error("Tenant context is required to decrypt this social token.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  if (version === "v2" && context) {
    decipher.setAAD(tokenAdditionalData(context));
  }
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function socialAccountExternalProvider(provider: SocialConnectorProvider): string {
  return provider.toLowerCase();
}

function scopeOwnsCampus(
  scope: SocialTenantScope,
  campusId: string | null,
): boolean {
  return scope.campusId === null
    ? true
    : campusId === null || campusId === scope.campusId;
}

function tenantVisibilityWhere(scope: SocialTenantScope) {
  return {
    organizationId: scope.organizationId,
    ...(scope.campusId
      ? { OR: [{ campusId: scope.campusId }, { campusId: null }] }
      : {}),
  };
}

async function upsertSocialAccount(
  input: NonNullable<StoredCredentialInput["socialAccount"]>,
  identity: { provider: SocialConnectorProvider; externalAccountId: string },
  existingSocialAccountId: string | null,
  scope: SocialTenantScope,
): Promise<string> {
  const externalProvider = socialAccountExternalProvider(identity.provider);
  const existing = await prisma.socialAccount.findFirst({
    where: {
      organizationId: scope.organizationId,
      externalProvider,
      externalAccountId: identity.externalAccountId,
    },
    select: { id: true, campusId: true },
  });

  if (existing) {
    if (!scopeOwnsCampus(scope, existing.campusId)) {
      throw new Error("This social account is already connected to a different campus in the organization.");
    }
    await prisma.socialAccount.update({
      where: {
        organizationId_externalProvider_externalAccountId: {
          organizationId: scope.organizationId,
          externalProvider,
          externalAccountId: identity.externalAccountId,
        },
      },
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
        organizationId: true,
        campusId: true,
        externalProvider: true,
        externalAccountId: true,
        credentials: { select: { provider: true, externalAccountId: true } },
      },
    });
    const accountIsInScope = linkedAccount
      && linkedAccount.organizationId === scope.organizationId
      && scopeOwnsCampus(scope, linkedAccount.campusId);
    const identityMatches = accountIsInScope
      && linkedAccount.externalProvider === externalProvider
      && linkedAccount.externalAccountId === identity.externalAccountId;
    const canAdoptIdentity = accountIsInScope
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
        organizationId: scope.organizationId,
        campusId: scope.campusId,
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
      where: {
        organizationId: scope.organizationId,
        externalProvider,
        externalAccountId: identity.externalAccountId,
      },
      select: { id: true, campusId: true },
    });
    if (!concurrentlyCreated || !scopeOwnsCampus(scope, concurrentlyCreated.campusId)) throw error;
    created = concurrentlyCreated;
  }

  return created.id;
}

export async function upsertSocialCredential(input: StoredCredentialInput): Promise<void> {
  const tokenContext: SocialTokenContext = {
    organizationId: input.tenantScope.organizationId,
    provider: input.provider,
    externalAccountId: input.externalAccountId,
  };
  const existing = await prisma.socialCredential.findUnique({
    where: {
      organizationId_provider_externalAccountId: {
        organizationId: input.tenantScope.organizationId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      },
    },
    select: {
      refreshTokenCiphertext: true,
      socialAccountId: true,
      campusId: true,
    },
  });
  if (existing && !scopeOwnsCampus(input.tenantScope, existing.campusId)) {
    throw new Error("This provider identity is already connected to a different campus in the organization.");
  }
  const socialAccountId = input.socialAccount
    ? await upsertSocialAccount(input.socialAccount, {
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      }, existing?.socialAccountId ?? null, input.tenantScope)
    : existing?.socialAccountId ?? null;

  await prisma.socialCredential.upsert({
    where: {
      organizationId_provider_externalAccountId: {
        organizationId: input.tenantScope.organizationId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
      },
    },
    create: {
      organizationId: input.tenantScope.organizationId,
      campusId: input.tenantScope.campusId,
      socialAccountId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      accountName: input.accountName ?? input.socialAccount?.label ?? null,
      handle: input.handle ?? input.socialAccount?.handle ?? null,
      accessTokenCiphertext: encryptToken(input.accessToken, tokenContext),
      refreshTokenCiphertext: input.refreshToken ? encryptToken(input.refreshToken, tokenContext) : null,
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
      accessTokenCiphertext: encryptToken(input.accessToken, tokenContext),
      refreshTokenCiphertext: input.refreshToken ? encryptToken(input.refreshToken, tokenContext) : existing?.refreshTokenCiphertext ?? null,
      tokenType: input.tokenType ?? null,
      scopesJson: input.scopes === undefined ? undefined : input.scopes as Prisma.InputJsonValue,
      metadataJson: input.metadata,
      expiresAt: input.expiresAt ?? null,
      status: "CONNECTED",
      lastError: null,
    },
  });
}

export async function listConnectorCredentialSummaries(
  scope: Readonly<{ organizationId: string; campusId?: string | null }>,
): Promise<Record<SocialConnectorProvider, number>> {
  const normalizedScope: SocialTenantScope = {
    organizationId: scope.organizationId,
    campusId: scope.campusId ?? null,
  };
  const rows = await prisma.socialCredential.groupBy({
    by: ["provider"],
    where: {
      status: "CONNECTED",
      ...tenantVisibilityWhere(normalizedScope),
    },
    _count: { provider: true },
  });

  return rows.reduce((accumulator, row) => ({
    ...accumulator,
    [row.provider]: row._count.provider,
  }), {} as Record<SocialConnectorProvider, number>);
}

export async function getConnectedCredentials(
  provider: SocialConnectorProvider,
  scope: SocialTenantScope,
): Promise<DecryptedSocialCredential[]> {
  const credentials = await prisma.socialCredential.findMany({
    where: {
      provider,
      status: "CONNECTED",
      ...tenantVisibilityWhere(scope),
    },
    orderBy: { updatedAt: "desc" },
  });

  return credentials.map((credential) => {
    const tokenContext: SocialTokenContext = {
      organizationId: credential.organizationId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
    };
    return {
      id: credential.id,
      organizationId: credential.organizationId,
      campusId: credential.campusId,
      socialAccountId: credential.socialAccountId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
      accountName: credential.accountName,
      handle: credential.handle,
      accessToken: decryptToken(credential.accessTokenCiphertext, tokenContext),
      refreshToken: credential.refreshTokenCiphertext ? decryptToken(credential.refreshTokenCiphertext, tokenContext) : null,
      tokenType: credential.tokenType,
      scopes: credential.scopesJson,
      metadata: credential.metadataJson,
      expiresAt: credential.expiresAt,
    };
  });
}

export async function markCredentialSyncSuccess(
  id: string,
  scope: SocialTenantScope,
): Promise<void> {
  const result = await prisma.socialCredential.updateMany({
    where: { id, ...tenantVisibilityWhere(scope) },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      status: "CONNECTED",
    },
  });
  if (result.count !== 1) {
    throw new Error("The social credential is not available in this tenant.");
  }
}

export async function markCredentialSyncError(
  id: string,
  error: unknown,
  scope: SocialTenantScope,
): Promise<void> {
  await prisma.socialCredential.updateMany({
    where: { id, ...tenantVisibilityWhere(scope) },
    data: {
      lastError: error instanceof Error ? error.message : String(error),
      status: "ERROR",
    },
  }).catch(() => undefined);
}
