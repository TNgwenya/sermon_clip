import { describe, expect, it } from "vitest";

import { CAPTION_STYLE_PRESETS, resolveCaptionStylePreset } from "@/lib/captionStylePresets";

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
    }
  });

  it("resolves the new creative styles", () => {
    expect(resolveCaptionStylePreset("kinetic-pop").name).toBe("Kinetic pop");
    expect(resolveCaptionStylePreset("creator-highlight").motion).toBe("Highlight glow");
    expect(resolveCaptionStylePreset("soft-bubble").personality).toBe("Warm and readable");
    expect(resolveCaptionStylePreset("scripture-focus").name).toBe("Scripture focus");
    expect(resolveCaptionStylePreset("cinematic-testimony").motion).toBe("Slow dissolve");
  });

  it("falls back to the elegant lower caption style", () => {
    expect(resolveCaptionStylePreset(undefined).id).toBe("clean-lower");
    expect(resolveCaptionStylePreset("unknown").name).toBe("Elegant lower captions");
  });
});
