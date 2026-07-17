import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  __guidePdfRendererTestUtils,
  renderContentGuidePdf,
} from "@/server/contentAssets/guidePdfRenderer";

describe("guide PDF renderer", () => {
  it("renders a valid multi-section PDF without a Python runtime", async () => {
    const bytes = await renderContentGuidePdf({
      churchName: "Grace Community Church",
      primaryColor: "#0F766E",
      secondaryColor: "#1D4ED8",
      title: "Walking by Faith",
      subtitle: "A seven-day devotional for the whole church",
      scripture: "Hebrews 11:1",
      bodyContent: [
        "## Begin here",
        "Faith helps us trust God even when the next step is not yet visible.",
        "### Reflect",
        "- What is God inviting you to trust Him with today?",
        "- Pray with someone in your community.",
      ].join("\n\n"),
    });

    expect(Buffer.from(bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(document.getTitle()).toBe("Walking by Faith");
  });

  it("preserves the guide's lightweight markdown structure", () => {
    expect(__guidePdfRendererTestUtils.guideBlocks([
      "## Heading",
      "### Subheading",
      "- First action",
      "Pastoral explanation.",
    ].join("\n"))).toEqual([
      { kind: "h2", text: "Heading" },
      { kind: "h3", text: "Subheading" },
      { kind: "bullet", text: "First action" },
      { kind: "body", text: "Pastoral explanation." },
    ]);
  });
});
