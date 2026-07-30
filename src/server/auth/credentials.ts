import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SCRYPT_N = 16_384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const MINIMUM_PASSWORD_LENGTH = 12;

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    !normalized
    || normalized.length > 320
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
  ) {
    throw new CredentialError("Enter a valid email address.");
  }
  return normalized;
}

export function validatePassword(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new CredentialError(
      `Password must contain at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    );
  }
  if (password.length > 1_024) {
    throw new CredentialError("Password is too long.");
  }
}

export function hashPassword(password: string): string {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_HASH_BYTES, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: PASSWORD_MAX_MEMORY_BYTES,
  });

  return [
    "scrypt",
    PASSWORD_SCRYPT_N,
    PASSWORD_SCRYPT_R,
    PASSWORD_SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  try {
    const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw, extra] =
      encodedHash.split("$");
    if (
      algorithm !== "scrypt"
      || extra !== undefined
      || !nRaw
      || !rRaw
      || !pRaw
      || !saltRaw
      || !hashRaw
    ) {
      return false;
    }
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (
      N !== PASSWORD_SCRYPT_N
      || r !== PASSWORD_SCRYPT_R
      || p !== PASSWORD_SCRYPT_P
    ) {
      return false;
    }

    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(hashRaw, "base64url");
    if (salt.length !== 16 || expected.length !== PASSWORD_HASH_BYTES) {
      return false;
    }
    const actual = scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: PASSWORD_MAX_MEMORY_BYTES,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(prefix: string, byteLength = 32): string {
  if (!/^[a-z][a-z0-9_]{1,15}$/.test(prefix)) {
    throw new CredentialError("Token prefix is invalid.");
  }
  if (!Number.isInteger(byteLength) || byteLength < 24 || byteLength > 64) {
    throw new CredentialError("Token entropy must be between 24 and 64 bytes.");
  }
  return `${prefix}_${randomBytes(byteLength).toString("base64url")}`;
}

export function hashOpaqueToken(token: string, pepper: string): string {
  if (!token.trim() || token !== token.trim()) {
    throw new CredentialError("Token is invalid.");
  }
  if (pepper.length < 32) {
    throw new CredentialError("Token pepper must contain at least 32 characters.");
  }
  return createHmac("sha256", pepper).update(token).digest("hex");
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/\s+/g, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new CredentialError("MFA secret is invalid.");
  }

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateTotpCode(
  secret: string,
  at = new Date(),
): string {
  if (Number.isNaN(at.getTime())) {
    throw new CredentialError("MFA verification time is invalid.");
  }
  const counter = BigInt(Math.floor(at.getTime() / 1_000 / TOTP_STEP_SECONDS));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(
  secret: string,
  submittedCode: string,
  options: Readonly<{ at?: Date; window?: number }> = {},
): boolean {
  if (!/^\d{6}$/.test(submittedCode)) {
    return false;
  }
  const at = options.at ?? new Date();
  const window = options.window ?? 1;
  if (!Number.isInteger(window) || window < 0 || window > 2) {
    throw new CredentialError("MFA verification window is invalid.");
  }

  const submitted = Buffer.from(submittedCode);
  for (let step = -window; step <= window; step += 1) {
    const candidate = generateTotpCode(
      secret,
      new Date(at.getTime() + (step * TOTP_STEP_SECONDS * 1_000)),
    );
    if (timingSafeEqual(Buffer.from(candidate), submitted)) {
      return true;
    }
  }
  return false;
}

export function createRecoveryCodes(count = 10): string[] {
  if (!Number.isInteger(count) || count < 5 || count > 20) {
    throw new CredentialError("Recovery code count must be between 5 and 20.");
  }
  return Array.from({ length: count }, () => {
    const raw = randomBytes(10).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
  });
}

export function hashRecoveryCode(code: string, pepper: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-F0-9]/g, "");
  if (normalized.length !== 20) {
    throw new CredentialError("Recovery code is invalid.");
  }
  return createHash("sha256")
    .update(`${pepper}:${normalized}`)
    .digest("hex");
}

export const __credentialTestUtils = {
  decodeBase32,
  encodeBase32,
};
