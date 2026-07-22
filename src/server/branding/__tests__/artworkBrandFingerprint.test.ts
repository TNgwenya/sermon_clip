import { describe, expect, it } from "vitest";

import {
  createArtworkBrandFingerprint,
  readArtworkBrandFingerprint,
} from "@/server/branding/artworkBrandFingerprint";

const branding = {
  churchName: "Local Church",
  primaryColor: "#123456",
  secondaryColor: "#ABCDEF",
  fontFamily: "Arial",
  logoDataUrl: "data:image/png;base64,AAAA",
};

describe("artwork brand fingerprint", () => {
  it("is deterministic while detecting every rendered brand input", () => {
    const first = createArtworkBrandFingerprint(branding);
    const second = createArtworkBrandFingerprint({ ...branding });

    expect(second).toBe(first);
    expect(createArtworkBrandFingerprint({ ...branding, churchName: "Another Church" })).not.toBe(first);
    expect(createArtworkBrandFingerprint({ ...branding, logoDataUrl: "data:image/png;base64,BBBB" })).not.toBe(first);
  });

  it("reads only a stored versioned design snapshot fingerprint", () => {
    expect(readArtworkBrandFingerprint({
      designStudio: { brandSnapshot: { fingerprint: "artwork-brand-v1-example" } },
    })).toBe("artwork-brand-v1-example");
    expect(readArtworkBrandFingerprint({ designStudio: {} })).toBeNull();
  });
});
