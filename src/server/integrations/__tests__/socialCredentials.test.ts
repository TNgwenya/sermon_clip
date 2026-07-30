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

  it("binds persisted tokens to their organization and immutable provider identity", () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "test-oauth-token-encryption-key";
    const context = {
      organizationId: "org-church-1",
      provider: "YOUTUBE" as const,
      externalAccountId: "channel-1",
    };
    const encrypted = encryptToken("access-token-value", context);

    expect(decryptToken(encrypted, context)).toBe("access-token-value");
    expect(() => decryptToken(encrypted, {
      ...context,
      organizationId: "org-other",
    })).toThrow();
  });
});
