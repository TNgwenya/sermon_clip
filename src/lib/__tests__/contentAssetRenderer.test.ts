import { describe, expect, it } from "vitest";
import { renderBrandedContentSvg, splitCarouselSlides, wrapContentText } from "@/lib/contentAssetRenderer";

describe("content asset renderer", () => {
  it("wraps and truncates long content deterministically", () => {
    expect(wrapContentText("one two three four five six", 9, 2)).toEqual(["one two", "three…"]);
  });

  it("escapes user content in SVG output", () => {
    const svg = renderBrandedContentSvg({ title: "Faith & Hope", content: "God < fear", branding: { churchName: "Church", primaryColor: "#111111", secondaryColor: "#222222", fontFamily: "Arial" }, width: 1080, height: 1080 });
    expect(svg).toContain("FAITH &amp; HOPE");
    expect(svg).toContain("God &lt; fear");
  });

  it("splits labelled carousel slides", () => {
    expect(splitCarouselSlides("Slide 1: Opening\nSlide 2: Teaching\nSlide 3: Apply")).toHaveLength(3);
  });
});
