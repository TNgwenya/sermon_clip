type SharpFactory = typeof import("sharp")["default"];

let sharpPromise: Promise<SharpFactory> | null = null;

export function getSharp(): Promise<SharpFactory> {
  sharpPromise ??= import("sharp").then((module) => module.default);
  return sharpPromise;
}
