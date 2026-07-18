import { describe, expect, it } from "vitest";

import { DEFAULT_CLIP_BRANDING } from "@/lib/clipBranding";
import { __brandingOverlayTestUtils } from "@/server/agents/brandingOverlay";

const context = {
  format: "VERTICAL_9_16" as const,
  sermonTitle: "Faith in the Waiting",
  preacherName: "Pastor Grace",
  churchName: "Hope Church",
  themeColor: "#0F766E",
  watermarkPosition: "BOTTOM_RIGHT" as const,
  width: 1080,
  height: 1920,
};

describe("branding overlay layers", () => {
  const config = {
    ...DEFAULT_CLIP_BRANDING,
    enabled: true,
    introEnabled: true,
    outroEnabled: true,
  };

  it("keeps timed cards out of the persistent base overlay", () => {
    const svg = __brandingOverlayTestUtils.buildBrandingOverlaySvg(config, context, "base");

    expect(svg).not.toContain("Reflect · Share");
    expect(svg.match(/Hope Church/g)).toHaveLength(1);
  });

  it("uses real church language instead of developer placeholder labels", () => {
    const intro = __brandingOverlayTestUtils.buildBrandingOverlaySvg(config, context, "intro");
    const outro = __brandingOverlayTestUtils.buildBrandingOverlaySvg(config, context, "outro");

    expect(intro).toContain("Hope Church");
    expect(intro).not.toContain(">Intro<");
    expect(outro).toContain("Reflect · Share");
    expect(outro).not.toContain(">Outro<");
  });

  it("renders a caption-safe top brand rail without dropping church identity", () => {
    const svg = __brandingOverlayTestUtils.buildBrandingOverlaySvg(
      config,
      { ...context, lowerThirdPlacement: "TOP", logoPath: "/managed/church-logo.png" },
      "base",
    );

    expect(svg).toContain('y="92"');
    expect(svg).toContain("Faith in the Waiting");
    expect(svg).toContain("Hope Church");
  });

  it("places the logo in the safe brand rail area", () => {
    expect(__brandingOverlayTestUtils.resolveLogoPlacement({
      position: "BOTTOM_RIGHT",
      width: 1080,
      height: 1920,
      logoWidth: 160,
      logoHeight: 100,
      lowerThirdPlacement: "TOP",
    })).toEqual({ left: 868, top: 52 });
  });

});
