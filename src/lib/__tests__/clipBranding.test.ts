import { describe, expect, it } from "vitest";

import { __clipBrandingTestUtils } from "@/lib/clipBranding";

describe("resolveBrandingConfig", () => {
  it("uses safe defaults when branding settings are missing", () => {
    const config = __clipBrandingTestUtils.resolveBrandingConfig(null);

    expect(config.enabled).toBe(false);
    expect(config.preset).toBe("CLEAN_LOWER_THIRD");
    expect(config.watermarkEnabled).toBe(false);
    expect(config.lowerThirdEnabled).toBe(true);
    expect(config.introEnabled).toBe(false);
    expect(config.outroEnabled).toBe(false);
    expect(config.introDurationSeconds).toBe(2.5);
    expect(config.outroDurationSeconds).toBe(3);
    expect(config.backgroundStyle).toBe("NONE");
  });

  it("loads and preserves valid branding settings", () => {
    const config = __clipBrandingTestUtils.resolveBrandingConfig({
      brandingSettings: {
        enabled: true,
        preset: "MINIMAL_WATERMARK",
        showChurchName: true,
        showSermonTitle: false,
        showPreacherName: false,
        watermarkEnabled: true,
        lowerThirdEnabled: false,
        introEnabled: true,
        outroEnabled: false,
        introDurationSeconds: 4.5,
        backgroundStyle: "SOFT_GRADIENT",
        themeColor: "#0F766E",
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.preset).toBe("MINIMAL_WATERMARK");
    expect(config.introEnabled).toBe(true);
    expect(config.introDurationSeconds).toBe(4.5);
    expect(config.backgroundStyle).toBe("SOFT_GRADIENT");
    expect(config.themeColor).toBe("#0F766E");
  });

  it("falls back when preset is unsupported", () => {
    const config = __clipBrandingTestUtils.resolveBrandingConfig({
      brandingSettings: {
        enabled: true,
        preset: "CANVA_EDITOR",
      },
    });

    expect(config.preset).toBe("CLEAN_LOWER_THIRD");
  });
});

describe("validateThemeColor", () => {
  it("accepts valid hex values", () => {
    expect(__clipBrandingTestUtils.validateThemeColor("#123")).toBe("#123");
    expect(__clipBrandingTestUtils.validateThemeColor("#0F766E")).toBe("#0F766E");
  });

  it("rejects invalid values safely", () => {
    expect(__clipBrandingTestUtils.validateThemeColor("red")).toBeNull();
    expect(__clipBrandingTestUtils.validateThemeColor("#12")).toBeNull();
    expect(__clipBrandingTestUtils.validateThemeColor("#12345G")).toBeNull();
  });
});

describe("preset summaries", () => {
  it("builds summary for clean lower third", () => {
    const summary = __clipBrandingTestUtils.buildBrandingSummary(
      {
        enabled: true,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: false,
        lowerThirdEnabled: true,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: null,
      },
      {
        churchName: "Grace Church",
        sermonTitle: "Faith Through Trials",
        preacherName: "Pastor James",
        logoPath: null,
      },
    );

    expect(summary).toContain("Clean lower third");
    expect(summary).toContain("lower third");
  });

  it("returns a brand-off summary when disabled", () => {
    const summary = __clipBrandingTestUtils.buildBrandingSummary(
      {
        enabled: false,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: true,
        lowerThirdEnabled: true,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: null,
      },
      {
        churchName: "Grace Church",
        sermonTitle: "Faith Through Trials",
        preacherName: "Pastor James",
        logoPath: null,
      },
    );

    expect(summary).toContain("Brand layers are off");
  });

  it("includes intro, outro, and background style layers in summaries", () => {
    const summary = __clipBrandingTestUtils.buildBrandingSummary(
      {
        enabled: true,
        preset: "SERMON_IDENTITY",
        showChurchName: true,
        showSermonTitle: false,
        showPreacherName: false,
        watermarkEnabled: false,
        lowerThirdEnabled: false,
        introEnabled: true,
        outroEnabled: true,
        backgroundStyle: "SOLID_BRAND",
        themeColor: "#0F766E",
      },
      {
        churchName: "Grace Church",
        sermonTitle: "Faith Through Trials",
        preacherName: "Pastor James",
        logoPath: null,
      },
    );

    expect(summary).toContain("intro brand card for 2.5s");
    expect(summary).toContain("outro brand card for 3s");
    expect(summary).toContain("background style");
  });
});

describe("render filter generation", () => {
  it("includes lower-third draw filters when enabled", () => {
    const filters = __clipBrandingTestUtils.buildBrandingFilters(
      {
        enabled: true,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: false,
        lowerThirdEnabled: true,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: "#0F766E",
      },
      {
        format: "VERTICAL_9_16",
        sermonTitle: "Faith Through Trials",
        preacherName: "Pastor James",
        churchName: "Grace Church",
        themeColor: "#0F766E",
      },
      "BOTTOM_RIGHT",
    );

    expect(filters.some((filter) => filter.includes("drawbox"))).toBe(true);
    expect(filters.some((filter) => filter.includes("drawtext"))).toBe(true);
  });

  it("includes watermark filter when enabled", () => {
    const filters = __clipBrandingTestUtils.buildBrandingFilters(
      {
        enabled: true,
        preset: "MINIMAL_WATERMARK",
        showChurchName: true,
        showSermonTitle: false,
        showPreacherName: false,
        watermarkEnabled: true,
        lowerThirdEnabled: false,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: null,
      },
      {
        format: "HORIZONTAL_16_9",
        sermonTitle: "",
        preacherName: "",
        churchName: "Grace Church",
        themeColor: null,
      },
      "TOP_RIGHT",
    );

    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain("drawtext");
    expect(filters[0]).toContain("x=w-tw-24");
  });

  it("returns empty filters when branding is disabled", () => {
    const filters = __clipBrandingTestUtils.buildBrandingFilters(
      {
        enabled: false,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: true,
        lowerThirdEnabled: true,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: null,
      },
      {
        format: "SQUARE_1_1",
        sermonTitle: "Faith Through Trials",
        preacherName: "Pastor James",
        churchName: "Grace Church",
        themeColor: null,
      },
      "BOTTOM_RIGHT",
    );

    expect(filters).toEqual([]);
  });

  it("handles missing text inputs without crashing", () => {
    const filters = __clipBrandingTestUtils.buildBrandingFilters(
      {
        enabled: true,
        preset: "CLEAN_LOWER_THIRD",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: true,
        lowerThirdEnabled: true,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: "#0F766E",
      },
      {
        format: "VERTICAL_9_16",
        sermonTitle: "",
        preacherName: "",
        churchName: "",
        themeColor: "#0F766E",
      },
      "BOTTOM_RIGHT",
    );

    expect(Array.isArray(filters)).toBe(true);
  });

  it("appends branding chain to framing filter", () => {
    const fullFilter = __clipBrandingTestUtils.appendBrandingToFilter(
      "[0:v]scale=1080:1920,crop=1080:1920,format=yuv420p[v]",
      ["drawbox=x=0:y=0:w=100:h=100:color=black@0.3:t=fill"],
    );

    expect(fullFilter).toContain("[vframed]");
    expect(fullFilter).toContain("drawbox");
    expect(fullFilter.endsWith("[v]")).toBe(true);
  });
});
