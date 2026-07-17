import path from "node:path";

import { describe, expect, it } from "vitest";

import { __brandingLogoRouteTestUtils } from "./route";

describe("branding logo route", () => {
  it("accepts managed branding files and rejects traversal or sibling paths", () => {
    const root = path.join("/srv", "sermon-clip", "storage", "branding");

    expect(__brandingLogoRouteTestUtils.isInside(root, path.join(root, "church-logo.png"))).toBe(true);
    expect(__brandingLogoRouteTestUtils.isInside(root, path.join(root, "..", "source.mp4"))).toBe(false);
    expect(__brandingLogoRouteTestUtils.isInside(root, root)).toBe(false);
  });
});
