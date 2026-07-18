import { describe, expect, it } from "vitest";

import { CAPTION_STYLE_PRESETS, isCaptionStylePresetId, resolveCaptionStylePreset } from "@/lib/captionStylePresets";

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
    expect(resolveCaptionStylePreset("golden-hour").name).toBe("Golden hour");
    expect(resolveCaptionStylePreset("royal-focus").visual.activeTextColor).toBe("#C4B5FD");
    expect(resolveCaptionStylePreset("editorial-serif").visual.fontFamily).toBe("serif");
    expect(resolveCaptionStylePreset("clean-outline").visual.textStrokeWidth).toBe(7);
    expect(isCaptionStylePresetId("golden-hour")).toBe(true);
    expect(isCaptionStylePresetId("unknown")).toBe(false);
  });

  it("resolves the new creative styles", () => {
    expect(resolveCaptionStylePreset("kinetic-pop").name).toBe("Kinetic pop");
    expect(resolveCaptionStylePreset("creator-highlight").motion).toBe("Highlight glow");
    expect(resolveCaptionStylePreset("soft-bubble").personality).toBe("Warm and readable");
    expect(resolveCaptionStylePreset("scripture-focus").name).toBe("Scripture focus");
    expect(resolveCaptionStylePreset("cinematic-testimony").motion).toBe("Slow dissolve");
  });

  it("falls back to the clean lower caption style", () => {
    expect(resolveCaptionStylePreset(undefined).id).toBe("clean-lower");
    expect(resolveCaptionStylePreset("unknown").name).toBe("Clean Lower");
  });
});
