import { describe, expect, it } from "vitest";

import {
  CONTENT_GRAPHIC_TEMPLATES,
  buildCarouselStudioSlides,
  getDefaultTemplateId,
  readContentDesignStudioDocument,
  serializeCarouselStudioBody,
} from "@/lib/contentGraphicTemplates";

describe("content graphic templates", () => {
  it("provides a reusable template for every approved ministry format", () => {
    expect(CONTENT_GRAPHIC_TEMPLATES.map((template) => template.id)).toEqual([
      "quote-emphasis",
      "scripture-focus",
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
    expect(document.slides[1].scripture).toBe("Ephesians 2:8");
  });
});
