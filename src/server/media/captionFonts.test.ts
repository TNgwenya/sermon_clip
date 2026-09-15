import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CAPTION_FONT_LIBRARY } from "@/lib/captionStylePresets";
import { getCaptionFontEnvironment, getCaptionFontsDirectory } from "./captionFonts";

describe("bundled caption font parity", () => {
  it("ships every browser face and the redistribution licenses in the worker font directory", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/styles/caption-fonts.css"), "utf8");
    const files = [...css.matchAll(/url\("\/fonts\/captions\/([^"/]+)"\)/g)].map((match) => match[1]);
    expect(new Set(files).size).toBe(16);
    for (const file of files) {
      const bytes = readFileSync(path.join(getCaptionFontsDirectory(), file));
      expect(bytes.subarray(0, 4).toString("hex")).toBe("00010000");
      expect(bytes.length).toBeGreaterThan(100_000);
    }
    for (const family of CAPTION_FONT_LIBRARY) {
      expect(css).toContain(`font-family: "${family.renderFamily}"`);
      expect(family.cssStack).toContain(`"${family.renderFamily}"`);
    }
    expect(existsSync(path.join(getCaptionFontsDirectory(), "LICENSE-DejaVu.txt"))).toBe(true);
    expect(existsSync(path.join(getCaptionFontsDirectory(), "LICENSE-Liberation.txt"))).toBe(true);
    expect(readFileSync(getCaptionFontEnvironment().FONTCONFIG_FILE, "utf8")).not.toContain("<include");
  });

  it("resolves condensed heavy and italic fonts to the bundled files instead of system substitutes", () => {
    // Fontconfig CLI is an optional diagnostic; production rendering uses its
    // library through Sharp/libass and does not require this executable.
    let available = true;
    try { execFileSync("fc-match", ["--version"], { stdio: "ignore" }); } catch { available = false; }
    if (!available) return;
    for (const [request, file] of [
      ["DejaVu Sans Condensed:weight=heavy", "DejaVuSansCondensed-Bold.ttf"],
      ["DejaVu Sans:weight=bold:slant=italic", "DejaVuSans-BoldOblique.ttf"],
      ["DejaVu Serif:weight=regular", "DejaVuSerif.ttf"],
      ["Liberation Sans:weight=bold", "LiberationSans-Bold.ttf"],
    ]) {
      const actual = execFileSync("fc-match", ["-f", "%{file}", request], {
        env: { ...process.env, ...getCaptionFontEnvironment() }, encoding: "utf8",
      });
      expect(actual).toBe(path.join(getCaptionFontsDirectory(), file));
    }
  });
});
