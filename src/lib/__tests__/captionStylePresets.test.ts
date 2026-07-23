import { describe, expect, it } from "vitest";

import {
  CAPTION_DESIGN_VERSION,
  CAPTION_FONT_LIBRARY,
  CAPTION_STYLE_PRESETS,
  assessCaptionDesignContrast,
  isCaptionStylePresetId,
  resolveCaptionStylePreset,
} from "@/lib/captionStylePresets";

describe("caption style presets", () => {
  it("defines creative metadata for each preset", () => {
    expect(CAPTION_STYLE_PRESETS.length).toBeGreaterThanOrEqual(7);

    for (const preset of CAPTION_STYLE_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.personality).toBeTruthy();
      expect(preset.motion).toBeTruthy();
      expect(preset.bestFor).toBeTruthy();
      expect(preset.sampleText).toBeTruthy();
      expect(preset.emphasisWords.length).toBeGreaterThan(0);
      expect(preset.className).toMatch(/^caption-style-/);
      expect(preset.visual.textColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(preset.visual.activeTextColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(preset.visual.backgroundOpacity).toBeGreaterThanOrEqual(0);
      expect(preset.visual.backgroundOpacity).toBeLessThanOrEqual(1);
    }
  });

  it("offers a tasteful expanded style collection with render tokens", () => {
    expect(CAPTION_STYLE_PRESETS).toHaveLength(14);
    expect(resolveCaptionStylePreset("golden-hour").name).toBe("Golden Hour");
    expect(resolveCaptionStylePreset("royal-focus").visual.activeTextColor).toBe("#C4B5FD");
    expect(resolveCaptionStylePreset("editorial-serif").visual.fontFamily).toBe("serif");
    expect(resolveCaptionStylePreset("clean-outline").visual.textStrokeWidth).toBe(7);
    expect(isCaptionStylePresetId("golden-hour")).toBe(true);
    expect(isCaptionStylePresetId("unknown")).toBe(false);
  });

  it("resolves the new creative styles", () => {
    expect(resolveCaptionStylePreset("kinetic-pop").name).toBe("High-Energy Social");
    expect(resolveCaptionStylePreset("creator-highlight").motion).toBe("Active-word colour and scale");
    expect(resolveCaptionStylePreset("soft-bubble").personality).toBe("Warm and readable");
    expect(resolveCaptionStylePreset("scripture-focus").name).toBe("Teaching & Bible Study");
    expect(resolveCaptionStylePreset("cinematic-testimony").motion).toBe("Simple phrase switch");
  });

  it("falls back to the clean lower caption style", () => {
    expect(resolveCaptionStylePreset(undefined).id).toBe("clean-lower");
    expect(resolveCaptionStylePreset("unknown").name).toBe("Clean Minimal");
  });

  it("gives every editable preset a complete versioned design contract", () => {
    for (const preset of CAPTION_STYLE_PRESETS) {
      expect(preset.design).toMatchObject({
        version: CAPTION_DESIGN_VERSION,
        presetId: preset.id,
        typography: {
          fontFamilyId: expect.any(String),
          fontSizePx: expect.any(Number),
          fontWeight: expect.any(Number),
          textCase: expect.any(String),
          alignment: expect.any(String),
        },
        colors: {
          textColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
          activeTextColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
          highlightBackgroundColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
        },
        background: {
          treatment: expect.any(String),
          opacity: expect.any(Number),
        },
        readability: {
          outlineWidthPx: expect.any(Number),
          shadowOpacity: expect.any(Number),
        },
        highlighting: {
          intensity: expect.any(String),
          scale: expect.any(Number),
          reducedMotion: false,
        },
        layout: {
          verticalPosition: expect.any(String),
          horizontalPosition: expect.any(String),
          safeWidth: expect.any(String),
          maxLines: expect.any(Number),
        },
      });
      expect(preset.design.colors.textColor).toBe(preset.visual.textColor);
      expect(preset.design.colors.activeTextColor).toBe(preset.visual.activeTextColor);
      expect(preset.design.background.color).toBe(preset.visual.backgroundColor);
      expect(preset.design.background.opacity).toBe(preset.visual.backgroundOpacity);
      expect(preset.design.readability.outlineColor).toBe(preset.visual.textStrokeColor);
      expect(preset.design.readability.outlineWidthPx).toBe(preset.visual.textStrokeWidth);
    }
  });

  it("uses a small deterministic font library with African-language-safe fallbacks", () => {
    expect(CAPTION_FONT_LIBRARY).toHaveLength(8);
    expect(new Set(CAPTION_FONT_LIBRARY.map((font) => font.id)).size).toBe(
      CAPTION_FONT_LIBRARY.length,
    );

    for (const font of CAPTION_FONT_LIBRARY) {
      expect(font.renderFamily).toBeTruthy();
      expect(font.cssStack).toContain(font.renderFamily);
      expect(font.cssStack).toContain(font.glyphSafeFallback);
      expect(["DejaVu Sans", "DejaVu Serif"]).toContain(font.glyphSafeFallback);
    }
  });

  it("produces deterministic contrast guidance for readable and unsafe designs", () => {
    const readable = structuredClone(resolveCaptionStylePreset("high-contrast").design);
    readable.typography.fontSizePx = 42;
    readable.colors.textColor = "#FFFFFF";
    readable.colors.activeTextColor = "#FFFF00";
    readable.colors.highlightBackgroundColor = "#000000";
    readable.background.treatment = "solid";
    readable.background.color = "#000000";
    readable.background.opacity = 1;
    readable.highlighting.backgroundOpacity = 1;

    expect(assessCaptionDesignContrast(readable)).toMatchObject({
      requiredRatio: 3,
      passes: true,
      warning: null,
    });

    const unsafe = structuredClone(readable);
    unsafe.typography.fontSizePx = 18;
    unsafe.typography.fontWeight = 400;
    unsafe.colors.textColor = "#777777";
    unsafe.colors.activeTextColor = "#777777";
    unsafe.colors.highlightBackgroundColor = "#777777";
    unsafe.background.color = "#777777";

    const assessment = assessCaptionDesignContrast(unsafe);
    expect(assessment.requiredRatio).toBe(4.5);
    expect(assessment.minimumRatio).toBe(1);
    expect(assessment.passes).toBe(false);
    expect(assessment.warning).toContain("4.5:1");

    const transparentMidTone = structuredClone(readable);
    transparentMidTone.background.treatment = "none";
    transparentMidTone.background.opacity = 0;
    transparentMidTone.colors.textColor = "#777777";
    transparentMidTone.colors.activeTextColor = "#777777";
    expect(assessCaptionDesignContrast(transparentMidTone)).toMatchObject({
      minimumRatio: 1,
      passes: false,
    });
  });

  it("ships every curated preset above the large-caption contrast threshold", () => {
    for (const preset of CAPTION_STYLE_PRESETS) {
      const assessment = assessCaptionDesignContrast(preset.design);
      expect(
        assessment.passes,
        `${preset.id} has only ${assessment.minimumRatio}:1 contrast`,
      ).toBe(true);
      expect(assessment.minimumRatio).toBeGreaterThanOrEqual(3);
    }
  });
});
