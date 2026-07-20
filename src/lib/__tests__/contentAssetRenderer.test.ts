import { describe, expect, it } from "vitest";
import {
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

  it("splits labelled carousel slides", () => {
    expect(splitCarouselSlides("Slide 1: Opening\nSlide 2: Teaching\nSlide 3: Apply")).toHaveLength(3);
  });
});
