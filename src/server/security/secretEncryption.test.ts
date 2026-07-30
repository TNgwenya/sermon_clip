import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptSecret,
  encryptSecret,
} from "@/server/security/secretEncryption";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("purpose-bound secret encryption", () => {
  it("round trips a secret without exposing its plaintext", () => {
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-with-more-than-32-characters");

    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", "mfa-totp");

    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(encrypted, "mfa-totp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("cannot decrypt a secret for a different purpose", () => {
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-with-more-than-32-characters");
    const encrypted = encryptSecret("sensitive", "mfa-totp");

    expect(() => decryptSecret(encrypted, "oauth-token")).toThrow(
      "format or purpose",
    );
  });

  it("fails closed without a strong application secret", () => {
    vi.stubEnv("AUTH_SECRET", "short");

    expect(() => encryptSecret("sensitive", "mfa-totp")).toThrow(
      "at least 32",
    );
  });
});
