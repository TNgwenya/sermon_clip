import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const stylesheetPath = resolve(process.cwd(), "src/app/styles/premium-studio.css");

let stylesheet = "";

beforeAll(async () => {
  stylesheet = await readFile(stylesheetPath, "utf8");
});

describe("Clip Studio responsive workspace layout", () => {
  it("keeps transcript, preview, and inspector in three columns through laptop widths", () => {
    expect(stylesheet).toContain(
      "grid-template-columns: minmax(240px, 0.62fr) minmax(440px, 1.58fr) minmax(310px, 0.9fr);",
    );
    expect(stylesheet).toContain('"transcript preview tools"');
    expect(stylesheet).toContain("@media (max-width: 1180px)");
    expect(stylesheet).not.toContain("@media (max-width: 1439px)");
  });

  it("reclaims the app rail before the three-column studio can overflow", () => {
    const compactDesktopRule = stylesheet.match(
      /@media \(max-width: 1310px\) \{[\s\S]*?body:has\(\.clip-studio-shell\) \.app-rail \{[\s\S]*?display: none;[\s\S]*?\n  \}/,
    )?.[0];

    expect(compactDesktopRule).toBeTruthy();
  });

  it("gives both side panels bounded independent scrolling", () => {
    const transcriptRule = stylesheet.match(
      /\.clip-studio-shell \.clip-studio-transcript-rail \{[\s\S]*?\n\}/,
    )?.[0];
    const inspectorRule = stylesheet.match(
      /\.clip-studio-shell \.clip-studio-main-column \{[\s\S]*?\n\}/,
    )?.[0];

    expect(transcriptRule).toContain("height: 100%");
    expect(transcriptRule).toContain("min-height: 0");
    expect(transcriptRule).toContain("overflow-y: auto");
    expect(transcriptRule).toContain("overscroll-behavior: contain");
    expect(inspectorRule).toContain("height: 100%");
    expect(inspectorRule).toContain("min-height: 0");
    expect(inspectorRule).toContain("overflow-y: auto");
    expect(inspectorRule).toContain("overscroll-behavior: contain");
  });

  it("keeps inspector tasks readable when the right rail is compact", () => {
    expect(stylesheet).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(stylesheet).not.toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
  });

  it("preserves the single-column mobile reading order", () => {
    const mobileRule = stylesheet.match(
      /@media \(max-width: 880px\) \{[\s\S]*?grid-template-areas:\s*"preview"\s*"timeline"\s*"transcript"\s*"tools";/,
    )?.[0];

    expect(mobileRule).toBeTruthy();
  });
});
