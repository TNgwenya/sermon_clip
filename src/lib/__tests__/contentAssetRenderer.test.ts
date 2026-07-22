import { describe, expect, it } from "vitest";
import { normalizeContentArtworkSettings } from "@/lib/contentArtworkDesign";
import {
  estimateContentSingleLineCapacity,
  renderBrandedContentSvg,
  resolveContentArtworkTextMetrics,
  resolveContentContrast,
  resolveContentSafeArea,
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

  it("renders editable eyebrow and footer text", () => {
    const svg = renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#111111",
        secondaryColor: "#222222",
        fontFamily: "Arial",
      },
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis",
      textOverrides: {
        version: 1,
        eyebrowText: "A word for today",
        footerText: "Grace Church Young Adults",
        showEyebrow: true,
        showFooter: true,
      },
    });

    expect(svg).toContain('data-text-role="eyebrow"');
    expect(svg).toContain(">A word for today</text>");
    expect(svg).toContain('data-text-role="brand"');
    expect(svg).toContain(">Grace Church Young Adults</text>");
    expect(svg).not.toContain(">FROM THE MESSAGE</text>");
    expect(svg).toContain('aria-label="A word for today. Faith. Keep walking with God. Grace Church Young Adults"');

    const deduplicatedLabel = renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#111111",
        secondaryColor: "#222222",
        fontFamily: "Arial",
      },
      width: 1080,
      height: 1080,
      textOverrides: {
        eyebrowText: "faith",
        footerText: "FAITH",
        showEyebrow: true,
        showFooter: true,
      },
    });
    expect(deduplicatedLabel).toContain('aria-label="faith. Keep walking with God"');
    expect(deduplicatedLabel).not.toContain("faith. Faith");
  });

  it("resets blank visible-text overrides to template and Brand Kit defaults", () => {
    const input = {
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#111111",
        secondaryColor: "#222222",
        fontFamily: "Arial",
      },
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis" as const,
    };
    const legacy = renderBrandedContentSvg(input);
    const reset = renderBrandedContentSvg({
      ...input,
      textOverrides: {
        eyebrowText: "   ",
        footerText: "",
        showEyebrow: true,
        showFooter: true,
      },
    });

    expect(reset).toBe(legacy);
    expect(reset).toContain(">FROM THE MESSAGE</text>");
    expect(reset).toContain(">Grace Church</text>");
  });

  it("can hide the eyebrow and footer without hiding the approved body", () => {
    const svg = renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#111111",
        secondaryColor: "#222222",
        fontFamily: "Arial",
      },
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis",
      textOverrides: {
        eyebrowText: "Hidden eyebrow",
        footerText: "Hidden footer",
        showEyebrow: false,
        showFooter: false,
      },
    });

    expect(svg).not.toContain('data-text-role="eyebrow"');
    expect(svg).not.toContain('data-text-role="brand"');
    expect(svg).not.toContain("Hidden eyebrow");
    expect(svg).not.toContain("Hidden footer");
    expect(svg).toContain('data-text-role="body"');
    expect(svg).toContain("Keep walking with God.");
  });

  it("XML-escapes visible-text overrides before placing them in SVG", () => {
    const svg = renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#111111",
        secondaryColor: "#222222",
        fontFamily: "Arial",
      },
      width: 1080,
      height: 1080,
      textOverrides: {
        eyebrowText: 'Today <script>& "hope"',
        footerText: "Church </text><script>alert(1)</script>",
        showEyebrow: true,
        showFooter: true,
      },
    });

    expect(svg).toContain("Today &lt;script&gt;&amp; &quot;hope&quot;");
    expect(svg).toContain("Church &lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(svg).toContain('aria-label="Today &lt;script&gt;&amp; &quot;hope&quot;. Faith. Keep walking with God. Church &lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("</text><script>");
  });

  it("embeds only a bounded rasterized church logo in the protected footer", () => {
    const logoDataUrl = `data:image/png;base64,${Buffer.from("church-logo").toString("base64")}`;
    const svg = renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Arial",
        logoDataUrl,
      },
      width: 1080,
      height: 1350,
    });

    expect(svg).toContain('data-brand-logo="true"');
    expect(svg).toContain(`href="${logoDataUrl}"`);
    expect(renderBrandedContentSvg({
      title: "Faith",
      content: "Keep walking with God.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Arial",
        logoDataUrl: "data:image/svg+xml,<svg onload=alert(1) />",
      },
      width: 1080,
      height: 1350,
    })).not.toContain("data-brand-logo");
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
    const textured = renderBrandedContentSvg({ ...input, templateId: "quote-textured" });

    expect(editorial).toContain('data-template-id="quote-emphasis" data-design="editorial"');
    expect(minimal).toContain('data-template-id="quote-minimal" data-design="minimal"');
    expect(luminous).toContain('data-template-id="scripture-focus" data-design="luminous"');
    expect(serene).toContain('data-template-id="scripture-calm" data-design="serene"');
    expect(textured).toContain('data-template-id="quote-textured" data-design="textured" data-family="textured_photo"');
    expect(textured).toContain('fill="url(#wovenTexture)"');
    expect(new Set([editorial, minimal, luminous, serene, textured]).size).toBe(5);
  });

  it("renders deterministic production previews and distinct reference treatments", () => {
    const input = {
      title: "Choose faith",
      content: "Trust God with the next faithful step.",
      scripture: "Pastor Jordan · Sunday message",
      branding: { churchName: "Grace Church", primaryColor: "#17324d", secondaryColor: "#d79c42", fontFamily: "Arial" },
      width: 1080,
      height: 1350,
    };
    const editorial = renderBrandedContentSvg({ ...input, templateId: "quote-emphasis" });
    const editorialAgain = renderBrandedContentSvg({ ...input, templateId: "quote-emphasis" });
    const radiant = renderBrandedContentSvg({ ...input, templateId: "quote-radiant" });
    const ruled = renderBrandedContentSvg({ ...input, scripture: "John 3:16 NIV", templateId: "scripture-editorial" });

    expect(editorialAgain).toBe(editorial);
    expect(editorial).toContain('data-text-role="byline"');
    expect(editorial).toContain("— Pastor Jordan · Sunday message");
    expect(radiant).toContain('data-reference-treatment="pill"');
    expect(ruled).toContain('data-reference-treatment="rule"');
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

  it("keeps typography and footer roles inside platform-safe areas for every output ratio", () => {
    const variants = [
      { width: 1080, height: 1080, format: "SQUARE" },
      { width: 1080, height: 1350, format: "PORTRAIT" },
      { width: 1080, height: 1920, format: "STORY" },
      { width: 1200, height: 630, format: "LANDSCAPE" },
    ] as const;

    for (const variant of variants) {
      const safeArea = resolveContentSafeArea(variant);
      const layout = resolveContentTextLayout({
        content: "God is already present in the place you are afraid to enter.",
        width: variant.width,
        height: variant.height,
        hasTitle: true,
        hasReference: true,
      });
      const lastLineBottom = layout.startY
        + Math.max(0, layout.lines.length - 1) * layout.lineHeight
        + Math.round(layout.fontSize * 0.25);

      expect(safeArea.format).toBe(variant.format);
      expect(layout.eyebrowY).toBeGreaterThanOrEqual(safeArea.top);
      expect(layout.titleY).toBeGreaterThan(layout.eyebrowY);
      expect(layout.contentAreaTop).toBeGreaterThan(layout.titleY);
      expect(layout.startY).toBeGreaterThan(layout.contentAreaTop);
      expect(lastLineBottom).toBeLessThanOrEqual(layout.safeBottom);
      expect(layout.safeBottom).toBeLessThan(layout.referenceY);
      expect(layout.referenceY).toBeLessThan(layout.brandY);
      expect(layout.brandY).toBeLessThanOrEqual(safeArea.bottom);
      expect(layout.truncated).toBe(false);
      expect(layout.verticalOverflow).toBe(false);
    }
  });

  it("reserves protected header space when a logo is placed at the top", () => {
    const common = {
      content: "God is already present in every faithful next step.",
      width: 1080,
      height: 1350,
      hasTitle: true,
      hasReference: true,
      textScale: 1,
      lineHeight: 1.25,
    };
    const regular = resolveContentTextLayout(common);
    const withTopLogo = resolveContentTextLayout({ ...common, reserveTopForLogo: true });

    expect(withTopLogo.eyebrowY).toBeGreaterThan(regular.eyebrowY);
    expect(withTopLogo.contentAreaTop).toBeGreaterThan(regular.contentAreaTop);
    expect(withTopLogo.verticalOverflow).toBe(false);
    expect(withTopLogo.safeBottom).toBe(regular.safeBottom);
  });

  it("adds enough deterministic contrast protection even for very light brand colours", () => {
    const plan = resolveContentContrast({
      primaryColor: "#FFFFFF",
      secondaryColor: "#FFF8E7",
    });
    const svg = renderBrandedContentSvg({
      title: "Grace",
      content: "My grace is sufficient for you.",
      scripture: "2 Corinthians 12:9 NIV",
      branding: { churchName: "Church", primaryColor: "#FFFFFF", secondaryColor: "#FFF8E7", fontFamily: "Inter" },
      width: 1080,
      height: 1920,
      templateId: "scripture-textured",
    });

    expect(plan.minimumContrastRatio).toBeGreaterThanOrEqual(4.75);
    expect(plan.scrimOpacity).toBeGreaterThan(0.5);
    expect(svg).toContain(`data-min-contrast="${plan.minimumContrastRatio.toFixed(2)}"`);
    expect(svg).toContain(`data-layer="contrast-shield" width="1080" height="1920" fill="#000" fill-opacity="${plan.scrimOpacity.toFixed(2)}"`);
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

  it("provides one shared title, body, and reference fit plan for artwork typography", () => {
    const common = {
      content: "Faith grows when we take the next faithful step.",
      title: "Choose faith",
      reference: "Hebrews 12:1",
      width: 1080,
      height: 1350,
      templateId: "scripture-focus" as const,
    };
    const quiet = resolveContentArtworkTextMetrics({
      ...common,
      artwork: {
        ...normalizeContentArtworkSettings(null, common.templateId),
        typographyPresetId: "quiet",
        textScale: 0.8,
        lineHeight: 0.9,
        letterSpacing: -1,
      },
    });
    const bold = resolveContentArtworkTextMetrics({
      ...common,
      artwork: {
        ...normalizeContentArtworkSettings(null, common.templateId),
        typographyPresetId: "bold",
        textScale: 1.3,
        lineHeight: 1.35,
        letterSpacing: 4,
      },
    });

    expect(bold.title.fontSize).toBeGreaterThan(quiet.title.fontSize);
    expect(bold.title.capacity).toBeLessThan(quiet.title.capacity);
    expect(bold.body.capacity).toBeLessThan(quiet.body.capacity);
    expect(bold.reference.capacity).toBeLessThan(quiet.reference.capacity);
    expect(bold.layout.lineHeight).toBeGreaterThan(quiet.layout.lineHeight);
    expect(bold.typographyPresetId).toBe("bold");
  });

  it("includes top-logo reserve and reference treatment in shared fit metrics", () => {
    const artwork = {
      ...normalizeContentArtworkSettings(null, "scripture-focus"),
      logoPosition: "TOP_LEFT" as const,
      showLogo: true,
      typographyPresetId: "modern" as const,
    };
    const pill = resolveContentArtworkTextMetrics({
      content: "God is faithful.",
      title: "Faith",
      reference: "2 Corinthians 12:9 NIV",
      width: 1080,
      height: 1350,
      templateId: "scripture-focus",
      artwork,
      hasLogo: true,
    });
    const ruled = resolveContentArtworkTextMetrics({
      content: "God is faithful.",
      title: "Faith",
      reference: "2 Corinthians 12:9 NIV",
      width: 1080,
      height: 1350,
      templateId: "scripture-editorial",
      artwork,
      hasLogo: false,
    });

    expect(pill.reserveTopForLogo).toBe(true);
    expect(pill.layout.eyebrowY).toBeGreaterThan(ruled.layout.eyebrowY);
    expect(pill.reference.capacity).toBeLessThan(ruled.reference.capacity);
  });

  it("reports exact capacity boundaries and feeds the same values into SVG rendering", () => {
    const artwork = {
      ...normalizeContentArtworkSettings(null, "quote-emphasis"),
      typographyPresetId: "editorial" as const,
      textScale: 1.1,
      lineHeight: 1.3,
      letterSpacing: 2,
    };
    const baseline = resolveContentArtworkTextMetrics({
      content: "Grace meets us here.",
      title: "Grace",
      reference: "Pastor Jordan",
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis",
      artwork,
    });
    const overCapacity = resolveContentArtworkTextMetrics({
      content: "Grace meets us here.",
      title: "T".repeat(baseline.title.capacity + 1),
      reference: "R".repeat(baseline.reference.capacity + 1),
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis",
      artwork,
    });
    const svg = renderBrandedContentSvg({
      title: "Grace",
      content: "Grace meets us here.",
      scripture: "Pastor Jordan",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Inter",
      },
      width: 1080,
      height: 1080,
      templateId: "quote-emphasis",
      artwork,
    });

    expect(overCapacity.title.exceedsCapacity).toBe(true);
    expect(overCapacity.reference.exceedsCapacity).toBe(true);
    expect(svg).toContain(`data-text-role="title"`);
    expect(svg).toContain(`font-size="${baseline.title.fontSize}"`);
    expect(svg).toContain(`data-text-role="body"`);
    expect(svg).toContain(`font-size="${baseline.body.fontSize}"`);
    expect(svg).toContain(`letter-spacing="${baseline.body.letterSpacing.toFixed(2)}"`);
    expect(svg).toContain(`font-size="${baseline.reference.fontSize}"`);
    expect(svg).toContain(`letter-spacing="${baseline.reference.letterSpacing.toFixed(2)}"`);
  });

  it("composes a photo, palette, typography, focal point, treatment, alignment, and logo placement", () => {
    const logoDataUrl = `data:image/png;base64,${Buffer.from("logo").toString("base64")}`;
    const artwork = normalizeContentArtworkSettings({
      backgroundId: "mountain-dawn",
      paletteId: "sunrise",
      typographyPresetId: "editorial",
      alignment: "RIGHT",
      textScale: 0.9,
      lineHeight: 1.4,
      letterSpacing: 1.5,
      overlayOpacity: 0.1,
      blur: 4,
      brightness: 0.72,
      focalPointX: "LEFT",
      focalPointY: "TOP",
      showLogo: true,
      logoPosition: "TOP_RIGHT",
    }, "scripture-focus");
    const svg = renderBrandedContentSvg({
      title: "Morning mercy",
      content: "His mercies are new every morning.",
      scripture: "Lamentations 3:23",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Inter",
        logoDataUrl,
      },
      width: 1080,
      height: 1350,
      templateId: "scripture-focus",
      artwork,
    });

    expect(svg).toContain('data-background-id="mountain-dawn"');
    expect(svg).toContain('href="/artwork-backgrounds/mountain-dawn.jpg"');
    expect(svg).toContain('preserveAspectRatio="xMinYMin slice"');
    expect(svg).toContain('<feGaussianBlur stdDeviation="4.00"');
    expect(svg).toContain('<feFuncR type="linear" slope="0.72"');
    expect(svg).toContain('data-palette-id="sunrise" data-typography-id="editorial" data-alignment="right"');
    expect(svg).toContain('data-text-role="body"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('font-family="Georgia, serif"');
    expect(svg).toContain('letter-spacing="1.50"');
    expect(svg).toContain('data-logo-position="top_right"');
    expect(svg).toMatch(/data-layer="contrast-shield"[^>]+fill-opacity="0\.[5-8][0-9]"/);
  });

  it("renders procedural recipes without a remote call and honours hidden logos", () => {
    const logoDataUrl = `data:image/png;base64,${Buffer.from("logo").toString("base64")}`;
    const svg = renderBrandedContentSvg({
      title: "Take the next step",
      content: "You are invited to worship with us.",
      branding: {
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Inter",
        logoDataUrl,
      },
      width: 1080,
      height: 1080,
      templateId: "invitation-bold",
      artwork: {
        ...normalizeContentArtworkSettings(null, "invitation-bold"),
        backgroundId: "radiant-rays",
        paletteId: "ocean",
        typographyPresetId: "bold",
        showLogo: false,
      },
      backgroundImageHref: "javascript:alert(1)",
    });

    expect(svg).toContain('data-background-kind="procedural" data-background-id="radiant-rays"');
    expect(svg).toContain('data-palette-id="ocean"');
    expect(svg).toContain('stop-color="#082f35"');
    expect(svg).not.toContain("javascript:");
    expect(svg).not.toContain("data-brand-logo");
  });

  it("keeps the legacy rendering path when artwork settings are omitted", () => {
    const input = {
      title: "Grace",
      content: "God is faithful.",
      scripture: "Psalm 33:4",
      branding: { churchName: "Church", primaryColor: "#111111", secondaryColor: "#222222", fontFamily: "Inter" },
      width: 1080,
      height: 1080,
      templateId: "scripture-editorial" as const,
    };

    expect(renderBrandedContentSvg(input)).toBe(renderBrandedContentSvg({
      ...input,
      artwork: undefined,
      backgroundImageHref: undefined,
    }));
    expect(renderBrandedContentSvg(input)).not.toContain("data-artwork-version");
  });

  it("splits labelled carousel slides", () => {
    expect(splitCarouselSlides("Slide 1: Opening\nSlide 2: Teaching\nSlide 3: Apply")).toHaveLength(3);
  });
});
