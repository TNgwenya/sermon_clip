import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }
  return createHash("sha256")
    .update(`sermonclip-secret-encryption:${secret}`)
    .digest();
}

function normalizedPurpose(purpose: string): string {
  const value = purpose.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,48}$/.test(value)) {
    throw new Error("Secret encryption purpose is invalid.");
  }
  return value;
}

export function encryptSecret(value: string, purpose: string): string {
  if (!value) {
    throw new Error("Cannot encrypt an empty secret.");
  }
  const boundPurpose = normalizedPurpose(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${boundPurpose}`));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return [
    VERSION,
    boundPurpose,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string, purpose: string): string {
  const boundPurpose = normalizedPurpose(purpose);
  const [version, storedPurpose, iv, authenticationTag, ciphertext, extra] =
    value.split(":");
  if (
    version !== VERSION
    || storedPurpose !== boundPurpose
    || !iv
    || !authenticationTag
    || !ciphertext
    || extra !== undefined
  ) {
    throw new Error("Encrypted secret format or purpose is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${VERSION}:${boundPurpose}`));
  decipher.setAuthTag(Buffer.from(authenticationTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
