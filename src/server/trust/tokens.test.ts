import { describe, expect, it } from "vitest";

import {
  generateTrustToken,
  hashTrustToken,
  identityEmailIsValid,
  normalizeIdentityEmail,
  trustTokenIsWellFormed,
} from "@/server/trust/tokens";

describe("trust tokens", () => {
  it("generates purpose-bound, high-entropy secrets and stores stable digests", () => {
    const first = generateTrustToken("invite");
    const second = generateTrustToken("invite");
    const transfer = generateTrustToken("transfer");

    expect(first).not.toBe(second);
    expect(trustTokenIsWellFormed(first)).toBe(true);
    expect(trustTokenIsWellFormed(transfer)).toBe(true);
    expect(hashTrustToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTrustToken(first)).toBe(hashTrustToken(first));
    expect(hashTrustToken(first)).not.toContain(first);
  });

  it("rejects malformed and wrong-length bearer secrets before database access", () => {
    expect(trustTokenIsWellFormed("")).toBe(false);
    expect(trustTokenIsWellFormed("sc_invite_short")).toBe(false);
    expect(trustTokenIsWellFormed("sc_other_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(trustTokenIsWellFormed(null)).toBe(false);
  });

  it("normalizes identity email consistently", () => {
    expect(normalizeIdentityEmail("  Pastor@Example.COM ")).toBe("pastor@example.com");
    expect(identityEmailIsValid("pastor@example.com")).toBe(true);
    expect(identityEmailIsValid("missing-domain@")).toBe(false);
    expect(identityEmailIsValid("not an email")).toBe(false);
  });
});
