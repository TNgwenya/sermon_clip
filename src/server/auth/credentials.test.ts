import { describe, expect, it } from "vitest";

import {
  __credentialTestUtils,
  createOpaqueToken,
  createRecoveryCodes,
  createTotpSecret,
  generateTotpCode,
  hashOpaqueToken,
  hashPassword,
  hashRecoveryCode,
  normalizeEmail,
  verifyPassword,
  verifyTotpCode,
} from "@/server/auth/credentials";

const PEPPER = "sermonclip-test-pepper-with-more-than-32-characters";

describe("production credential primitives", () => {
  it("normalizes email without accepting malformed addresses", () => {
    expect(normalizeEmail("  Pastor@Example.COM ")).toBe("pastor@example.com");
    expect(() => normalizeEmail("pastor.example.com")).toThrow(
      "valid email",
    );
  });

  it("hashes passwords with a random salt and verifies in constant-size form", () => {
    const first = hashPassword("a secure church password");
    const second = hashPassword("a secure church password");

    expect(first).not.toBe(second);
    expect(verifyPassword("a secure church password", first)).toBe(true);
    expect(verifyPassword("wrong password", first)).toBe(false);
    expect(verifyPassword("a secure church password", "malformed")).toBe(false);
  });

  it("creates high-entropy opaque tokens and keyed hashes", () => {
    const token = createOpaqueToken("scs");

    expect(token).toMatch(/^scs_[A-Za-z0-9_-]{43}$/);
    expect(hashOpaqueToken(token, PEPPER)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => hashOpaqueToken(token, "short")).toThrow("32 characters");
  });

  it("generates and verifies RFC-style time-based one-time codes", () => {
    const secret = createTotpSecret();
    const at = new Date("2026-07-29T12:00:00.000Z");
    const code = generateTotpCode(secret, at);

    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, { at })).toBe(true);
    expect(verifyTotpCode(secret, "000000", { at })).toBe(code === "000000");
    expect(verifyTotpCode(secret, code, {
      at: new Date(at.getTime() + 90_000),
    })).toBe(false);
  });

  it("round-trips base32 secrets without padding", () => {
    const bytes = Buffer.from("SermonClip MFA secret");
    const encoded = __credentialTestUtils.encodeBase32(bytes);

    expect(__credentialTestUtils.decodeBase32(encoded)).toEqual(bytes);
  });

  it("creates one-time recovery codes and hashes normalized input", () => {
    const codes = createRecoveryCodes(10);

    expect(new Set(codes)).toHaveLength(10);
    expect(codes.every((code) => /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/.test(code))).toBe(true);
    expect(hashRecoveryCode(codes[0], PEPPER)).toBe(
      hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, " "), PEPPER),
    );
  });
});
