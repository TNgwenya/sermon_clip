import { accessSync, constants } from "node:fs";
import path from "node:path";

export function getCaptionFontsDirectory(): string {
  return path.join(process.cwd(), "public", "fonts", "captions");
}

/** Both Sharp/fontconfig and libass must resolve the fonts shipped to browsers. */
export function getCaptionFontEnvironment(): { FONTCONFIG_FILE: string } {
  const FONTCONFIG_FILE = path.join(getCaptionFontsDirectory(), "fonts.conf");
  accessSync(FONTCONFIG_FILE, constants.R_OK);
  return { FONTCONFIG_FILE };
}

export function configureCaptionFonts(): void {
  Object.assign(process.env, getCaptionFontEnvironment());
}
