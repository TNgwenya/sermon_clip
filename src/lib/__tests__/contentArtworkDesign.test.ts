import { describe, expect, it } from "vitest";

import {
  buildArtworkRecommendations,
  CONTENT_ARTWORK_BACKGROUNDS,
  CONTENT_ARTWORK_PALETTES,
  CONTENT_ARTWORK_TYPOGRAPHY_PRESETS,
  createDefaultContentArtworkTextOverrides,
  createDefaultContentArtworkSettings,
  normalizeContentArtworkTextOverrides,
  normalizeContentArtworkSettings,
} from "@/lib/contentArtworkDesign";
import { getContentGraphicTemplate } from "@/lib/contentGraphicTemplates";

describe("content artwork design", () => {
  it("publishes the deterministic built-in design vocabulary", () => {
    expect(CONTENT_ARTWORK_BACKGROUNDS).toHaveLength(12);
    expect(CONTENT_ARTWORK_PALETTES).toHaveLength(6);
    expect(CONTENT_ARTWORK_TYPOGRAPHY_PRESETS).toHaveLength(6);
    expect(CONTENT_ARTWORK_BACKGROUNDS.filter((item) => item.kind === "IMAGE").map((item) => item.imagePath)).toEqual([
      "/artwork-backgrounds/still-waters.jpg",
      "/artwork-backgrounds/mountain-dawn.jpg",
      "/artwork-backgrounds/sanctuary-light.jpg",
      "/artwork-backgrounds/desert-path.jpg",
      "/artwork-backgrounds/soft-clouds.jpg",
      "/artwork-backgrounds/urban-light.jpg",
    ]);
    expect(new Set(CONTENT_ARTWORK_BACKGROUNDS.map((item) => item.id)).size).toBe(12);
  });

  it("uses the selected template alignment in backward-compatible defaults", () => {
    expect(createDefaultContentArtworkSettings("quote-minimal")).toMatchObject({
      version: 1,
      backgroundId: "brand-gradient",
      paletteId: "brand",
      typographyPresetId: "brand",
      alignment: "CENTER",
      showLogo: true,
      logoPosition: "BOTTOM_LEFT",
    });
    expect(createDefaultContentArtworkSettings("quote-emphasis").alignment).toBe("LEFT");
  });

  it("normalizes the earlier nested draft shape and safely bounds controls", () => {
    expect(normalizeContentArtworkSettings({
      background: {
        id: "mountain-dawn",
        overlay: 4,
        blur: 99,
        brightness: 0.1,
        focalPoint: { x: "RIGHT", y: "TOP" },
      },
      paletteId: "sunrise",
      typography: {
        presetId: "editorial",
        alignment: "RIGHT",
        scale: 3,
        lineHeight: 0.2,
        letterSpacing: -9,
      },
      logoTreatment: { visible: false, position: "TOP_RIGHT" },
    }, "scripture-focus")).toEqual({
      version: 1,
      backgroundId: "mountain-dawn",
      paletteId: "sunrise",
      typographyPresetId: "editorial",
      alignment: "RIGHT",
      textScale: 1.3,
      lineHeight: 0.9,
      letterSpacing: -1,
      overlayOpacity: 0.9,
      blur: 20,
      brightness: 0.45,
      focalPointX: "RIGHT",
      focalPointY: "TOP",
      showLogo: false,
      logoPosition: "TOP_RIGHT",
    });
  });

  it("keeps artwork wording overrides optional, bounded, and backward compatible", () => {
    expect(createDefaultContentArtworkTextOverrides()).toEqual({
      version: 1,
      eyebrowText: null,
      footerText: null,
      showEyebrow: true,
      showFooter: true,
    });
    expect(normalizeContentArtworkTextOverrides({
      eyebrowText: "  A word for today  ",
      footerText: "Community youth ministry",
      showEyebrow: false,
      showFooter: false,
    })).toEqual({
      version: 1,
      eyebrowText: "A word for today",
      footerText: "Community youth ministry",
      showEyebrow: false,
      showFooter: false,
    });
    expect(normalizeContentArtworkTextOverrides({
      eyebrowText: " ",
      footerText: "x".repeat(100),
      showEyebrow: "yes",
    })).toEqual({
      version: 1,
      eyebrowText: null,
      footerText: "x".repeat(60),
      showEyebrow: true,
      showFooter: true,
    });
  });

  it("returns twelve genuinely different, role-appropriate recipes for every designable type", () => {
    const cases = [
      ["QUOTE_GRAPHIC", "QUOTE"],
      ["SCRIPTURE_GRAPHIC", "SCRIPTURE"],
      ["PRAYER", "PRAYER"],
      ["DEVOTIONAL", "DEVOTIONAL"],
      ["INVITATION", "INVITATION"],
    ] as const;

    for (const [assetType, expectedRole] of cases) {
      const recommendations = buildArtworkRecommendations(assetType);
      expect(recommendations).toHaveLength(12);
      expect(new Set(recommendations.map((item) => item.id)).size).toBe(12);
      expect(new Set(recommendations.map((item) => JSON.stringify(item.settings))).size).toBe(12);
      expect(recommendations.every((item) => getContentGraphicTemplate(item.templateId).role === expectedRole)).toBe(true);
    }

    expect(buildArtworkRecommendations("CAROUSEL", "carousel-cta")
      .every((item) => item.templateId === "carousel-cta")).toBe(true);
  });
});
