import { describe, expect, it } from "vitest";

import {
  CONTENT_GRAPHIC_TEMPLATES,
  buildCarouselStudioSlides,
  getDefaultTemplateId,
  getTemplatesForAssetType,
  isContentGraphicTemplateId,
  readContentDesignStudioDocument,
  serializeCarouselStudioBody,
} from "@/lib/contentGraphicTemplates";

describe("content graphic templates", () => {
  it("provides a reusable template for every approved ministry format", () => {
    expect(CONTENT_GRAPHIC_TEMPLATES.map((template) => template.id)).toEqual([
      "quote-emphasis",
      "quote-minimal",
      "quote-radiant",
      "quote-textured",
      "scripture-focus",
      "scripture-editorial",
      "scripture-calm",
      "scripture-textured",
      "prayer-calm",
      "devotional-reflection",
      "invitation-bold",
      "carousel-cover",
      "carousel-content",
      "carousel-cta",
    ]);
    expect(getDefaultTemplateId({ assetType: "QUOTE_GRAPHIC" })).toBe("quote-emphasis");
    expect(getDefaultTemplateId({ slideRole: "CTA" })).toBe("carousel-cta");
  });

  it("offers focused visual choices without mixing prayer or devotional meaning into quote and Scripture graphics", () => {
    expect(getTemplatesForAssetType("QUOTE_GRAPHIC").map((template) => template.id)).toEqual([
      "quote-emphasis",
      "quote-minimal",
      "quote-radiant",
      "quote-textured",
    ]);
    expect(getTemplatesForAssetType("SCRIPTURE_GRAPHIC").map((template) => template.id)).toEqual([
      "scripture-focus",
      "scripture-editorial",
      "scripture-calm",
      "scripture-textured",
    ]);
    expect(getTemplatesForAssetType("QUOTE_GRAPHIC").every((template) => template.eyebrow === "FROM THE MESSAGE")).toBe(true);
    expect(getTemplatesForAssetType("SCRIPTURE_GRAPHIC").every((template) => template.eyebrow === "SCRIPTURE")).toBe(true);
  });

  it("gives quote and Scripture graphics three materially distinct creative families in deterministic order", () => {
    const quoteTemplates = getTemplatesForAssetType("QUOTE_GRAPHIC");
    const scriptureTemplates = getTemplatesForAssetType("SCRIPTURE_GRAPHIC");

    expect(new Set(quoteTemplates.map((template) => template.family))).toEqual(new Set([
      "EDITORIAL_MINIMAL",
      "BOLD_RADIANT",
      "TEXTURED_PHOTO",
    ]));
    expect(new Set(scriptureTemplates.map((template) => template.family))).toEqual(new Set([
      "EDITORIAL_MINIMAL",
      "BOLD_RADIANT",
      "TEXTURED_PHOTO",
    ]));
    expect(getTemplatesForAssetType("QUOTE_GRAPHIC").map((template) => template.id)).toEqual(
      quoteTemplates.map((template) => template.id),
    );
    expect(quoteTemplates.map((template) => template.label)).toEqual([
      "Editorial quote",
      "Minimal quote",
      "Radiant quote",
      "Textured quote",
    ]);
  });

  it("keeps every original saved template ID valid and restores it unchanged", () => {
    const originalIds = [
      "quote-emphasis",
      "scripture-focus",
      "prayer-calm",
      "devotional-reflection",
      "invitation-bold",
      "carousel-cover",
      "carousel-content",
      "carousel-cta",
    ];

    expect(originalIds.every(isContentGraphicTemplateId)).toBe(true);
    const document = readContentDesignStudioDocument({
      assetType: "QUOTE_GRAPHIC",
      title: "Faith",
      bodyContent: "Faith makes room for hope.",
      metadata: { designStudio: { version: 1, templateId: "quote-emphasis", slides: [] } },
    });
    expect(document.version).toBe(2);
    expect(document.templateId).toBe("quote-emphasis");
    expect(document.artwork).toMatchObject({
      version: 1,
      backgroundId: "brand-gradient",
      paletteId: "brand",
    });
    expect(document.textOverrides).toEqual({
      version: 1,
      eyebrowText: null,
      footerText: null,
      showEyebrow: true,
      showFooter: true,
    });
  });

  it("turns existing approved carousel copy into an editable ordered document", () => {
    const slides = buildCarouselStudioSlides(
      "Slide 1: Faith for today\n\nSlide 2: Take the next faithful step",
      "Faith steps",
    );

    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ role: "COVER", templateId: "carousel-cover" });
    expect(slides[1]).toMatchObject({ role: "CONTENT", templateId: "carousel-content" });
    expect(serializeCarouselStudioBody(slides)).toContain("Slide 2:");
  });

  it("restores persisted slide order, roles, copy, and selected templates", () => {
    const document = readContentDesignStudioDocument({
      assetType: "CAROUSEL",
      title: "Grace",
      bodyContent: "old copy",
      metadata: {
        designStudio: {
          version: 1,
          templateId: "carousel-cover",
          slides: [
            { id: "second", role: "CTA", templateId: "carousel-cta", title: "Respond", body: "Pray with us", scripture: null },
            { id: "first", role: "CONTENT", templateId: "carousel-content", title: "Remember", body: "Grace is a gift", scripture: "Ephesians 2:8" },
          ],
        },
      },
    });

    expect(document.slides.map((slide) => slide.id)).toEqual(["second", "first"]);
    expect(document.slides[0]).toMatchObject({ role: "CTA", templateId: "carousel-cta" });
    expect(document.slides[0].textOverrides).toBeUndefined();
    expect(document.slides[1].scripture).toBe("Ephesians 2:8");
  });

  it("normalizes global and per-slide artwork text overrides without changing serialized copy", () => {
    const document = readContentDesignStudioDocument({
      assetType: "CAROUSEL",
      title: "Grace",
      bodyContent: "old copy",
      metadata: {
        designStudio: {
          version: 2,
          templateId: "carousel-cover",
          textOverrides: {
            eyebrowText: "  This   Sunday  ",
            footerText: "  Local Church  ",
            showEyebrow: false,
            showFooter: "invalid",
          },
          slides: [{
            id: "cover",
            role: "COVER",
            templateId: "carousel-cover",
            title: "Choose grace",
            body: "Grace is a gift.",
            scripture: null,
            textOverrides: {
              eyebrowText: "  Start   here ",
              footerText: " ",
              showEyebrow: true,
              showFooter: false,
            },
          }],
        },
      },
    });

    expect(document.textOverrides).toEqual({
      version: 1,
      eyebrowText: "This Sunday",
      footerText: "Local Church",
      showEyebrow: false,
      showFooter: true,
    });
    expect(document.slides[0].textOverrides).toEqual({
      version: 1,
      eyebrowText: "Start here",
      footerText: null,
      showEyebrow: true,
      showFooter: false,
    });
    expect(serializeCarouselStudioBody(document.slides)).toBe(
      "Slide 1: Choose grace\nGrace is a gift.",
    );
  });

  it("restores a versioned artwork recipe while normalizing unsafe stored values", () => {
    const document = readContentDesignStudioDocument({
      assetType: "QUOTE_GRAPHIC",
      title: "Grace",
      bodyContent: "Grace is a gift.",
      metadata: {
        designStudio: {
          version: 2,
          templateId: "quote-radiant",
          artwork: {
            version: 1,
            backgroundId: "still-waters",
            paletteId: "ocean",
            typographyPresetId: "quiet",
            textScale: 8,
            alignment: "CENTER",
          },
          slides: [],
        },
      },
    });

    expect(document.artwork).toMatchObject({
      backgroundId: "still-waters",
      paletteId: "ocean",
      typographyPresetId: "quiet",
      alignment: "CENTER",
      textScale: 1.3,
    });
  });
});
