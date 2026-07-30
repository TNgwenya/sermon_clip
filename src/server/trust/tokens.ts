import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TRUST_TOKEN_PATTERN = /^sc_(invite|transfer)_[A-Za-z0-9_-]{43}$/;

export type TrustTokenPurpose = "invite" | "transfer";

/**
 * Generates 256 bits of entropy. The returned secret is suitable for a
 * one-time email link; only its digest may be persisted.
 */
export function generateTrustToken(purpose: TrustTokenPurpose): string {
  return `sc_${purpose}_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function trustTokenIsWellFormed(token: unknown): token is string {
  return typeof token === "string"
    && token.length <= 80
    && TRUST_TOKEN_PATTERN.test(token);
}

export function hashTrustToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

export function normalizeIdentityEmail(email: string): string {
  return email
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

export function identityEmailIsValid(email: unknown): email is string {
  if (typeof email !== "string" || email.length > 320) {
    return false;
  }

  const normalized = normalizeIdentityEmail(email);
  const separator = normalized.lastIndexOf("@");
  return separator > 0
    && separator < normalized.length - 1
    && !/\s/.test(normalized);
}
