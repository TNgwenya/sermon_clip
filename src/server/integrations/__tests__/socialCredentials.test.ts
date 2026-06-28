import { afterEach, describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "@/server/integrations/socialCredentials";

const originalAuthSecret = process.env.AUTH_SECRET;
const originalOauthKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.AUTH_SECRET = originalAuthSecret;
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = originalOauthKey;
});

describe("social credential encryption", () => {
  it("encrypts tokens without storing plaintext and decrypts them with the configured secret", () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "test-oauth-token-encryption-key";
    process.env.AUTH_SECRET = "";

    const encrypted = encryptToken("refresh-token-value");

    expect(encrypted).not.toContain("refresh-token-value");
    expect(decryptToken(encrypted)).toBe("refresh-token-value");
  });
});
