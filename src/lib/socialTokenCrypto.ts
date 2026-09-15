import crypto from "node:crypto";
import type { SocialConnectorProvider } from "@prisma/client";

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

export type SocialTokenContext = Readonly<{
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

