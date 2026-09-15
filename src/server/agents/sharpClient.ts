import { configureCaptionFonts } from "@/server/media/captionFonts";

type SharpFactory = typeof import("sharp")["default"];

let sharpPromise: Promise<SharpFactory> | null = null;

export function getSharp(): Promise<SharpFactory> {
  configureCaptionFonts();
  sharpPromise ??= import("sharp").then((module) => module.default);
  return sharpPromise;
}
