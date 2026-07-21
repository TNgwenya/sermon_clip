import { describe, expect, it } from "vitest";
import {
  estimateContentSingleLineCapacity,
  renderBrandedContentSvg,
  resolveContentTextLayout,
  splitCarouselSlides,
  wrapContentText,
} from "@/lib/contentAssetRenderer";

describe("content asset renderer", () => {
  it("wraps and truncates long content deterministically", () => {
    expect(wrapContentText("one two three four five six", 9, 2)).toEqual(["one two", "three…"]);
  });

  it("escapes user content in SVG output", () => {
    const svg = renderBrandedContentSvg({ title: "Faith & Hope", content: "God < fear", branding: { churchName: "Church", primaryColor: "#111111", secondaryColor: "#222222", fontFamily: "Arial" }, width: 1080, height: 1080 });
    expect(svg).toContain("FAITH &amp; HOPE");
    expect(svg).toContain("God &lt; fear");
  });

  it("renders visibly distinct art directions while preserving the selected saved template ID", () => {
    const input = {
      title: "Choose faith",
      content: "God is already present in the place you are afraid to enter.",
      scripture: "Isaiah 41:10",
      branding: { churchName: "Grace Church", primaryColor: "#17324d", secondaryColor: "#d79c42", fontFamily: "Arial" },
      width: 1080,
      height: 1350,
    };
    const editorial = renderBrandedContentSvg({ ...input, templateId: "quote-emphasis" });
    const minimal = renderBrandedContentSvg({ ...input, templateId: "quote-minimal" });
    const luminous = renderBrandedContentSvg({ ...input, templateId: "scripture-focus" });
    const serene = renderBrandedContentSvg({ ...input, templateId: "scripture-calm" });

    expect(editorial).toContain('data-template-id="quote-emphasis" data-design="editorial"');
    expect(minimal).toContain('data-template-id="quote-minimal" data-design="minimal"');
    expect(luminous).toContain('data-template-id="scripture-focus" data-design="luminous"');
    expect(serene).toContain('data-template-id="scripture-calm" data-design="serene"');
    expect(new Set([editorial, minimal, luminous, serene]).size).toBe(4);
  });

  it("uses editorial serif typography for quote and Scripture body copy", () => {
    const svg = renderBrandedContentSvg({
      title: "Grace",
      content: "My grace is sufficient for you.",
      scripture: "2 Corinthians 12:9",
      branding: { churchName: "Church", primaryColor: "#111111", secondaryColor: "#222222", fontFamily: "Inter" },
      width: 1080,
      height: 1080,
      templateId: "scripture-editorial",
    });

    expect(svg).toContain('font-family="Georgia, Inter, serif"');
    expect(svg).toContain('aria-label="Grace. My grace is sufficient for you. 2 Corinthians 12:9"');
  });

  it("shrinks compact landscape body copy without collapsing the title hierarchy", () => {
    const layout = resolveContentTextLayout({
      content: "“Let us lay aside every weight and the sin which so easily ensnares us, and let us run with endurance the race that is set before us, looking unto Jesus.”",
      width: 1200,
      height: 630,
      hasTitle: true,
    });

    expect(layout.compactLandscape).toBe(true);
    expect(layout.fontSize).toBeLessThan(layout.baseFontSize);
    expect(layout.eyebrowY).toBeLessThan(layout.titleY);
    expect(layout.titleY).toBeLessThan(layout.startY);
    expect(layout.truncated).toBe(false);
    expect(layout.verticalOverflow).toBe(false);
  });

  it("uses the same deterministic single-line limits for preview and production checks", () => {
    expect(estimateContentSingleLineCapacity({
      width: 1080,
      height: 1350,
      role: "title",
      titleScale: 0.82,
    })).toBeGreaterThan(10);
    expect(estimateContentSingleLineCapacity({
      width: 1080,
      height: 1350,
      role: "scripture",
    })).toBeGreaterThan(20);
    expect(estimateContentSingleLineCapacity({
      width: 1200,
      height: 630,
      role: "title",
      titleScale: 0.82,
    })).toBeLessThan(estimateContentSingleLineCapacity({
      width: 1200,
      height: 630,
      role: "title",
      titleScale: 0.64,
    }));
  });

  it("splits labelled carousel slides", () => {
    expect(splitCarouselSlides("Slide 1: Opening\nSlide 2: Teaching\nSlide 3: Apply")).toHaveLength(3);
  });
});
