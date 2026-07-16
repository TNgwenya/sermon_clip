import { describe, expect, it } from "vitest";

import {
  buildHtmlEmailHandoff,
  buildStoryHandoffInstructions,
  buildWhatsAppHandoff,
  selectStoryMediaFiles,
  type HandoffContentAsset,
} from "@/lib/contentHandoffs";

const asset: HandoffContentAsset = {
  id: "asset-1",
  sermonId: "sermon-1",
  title: "Faith & courage",
  assetType: "DEVOTIONAL",
  bodyContent: "Trust God in the storm.\n\nTake one faithful step.",
  caption: "Save this reflection for the week.",
  hashtags: ["faith", "hope"],
  callToAction: "Share this with a friend.",
  sermon: {
    title: "Faith < Fear",
    speakerName: "Pastor Example",
    churchName: "Example Church",
  },
  files: [{
    fileName: "story.png",
    mimeType: "image/png",
    filePath: null,
    publicUrl: "https://cdn.example/story.png",
    width: 1080,
    height: 1920,
  }],
};

describe("ministry handoff exports", () => {
  it("builds copy-ready WhatsApp status and group sections", () => {
    const result = buildWhatsAppHandoff(asset);
    expect(result).toContain("WhatsApp Status");
    expect(result).toContain("Group or broadcast message");
    expect(result).toContain("#faith #hope");
  });

  it("documents the native Story sticker step and portrait media", () => {
    const result = buildStoryHandoffInstructions(asset);
    expect(result).toContain("polls, quizzes, sliders");
    expect(result).toContain("1080×1920");
  });

  it("selects 9:16 PNG Story media and excludes 4:5 portrait duplicates", () => {
    const result = selectStoryMediaFiles([
      { mimeType: "image/png", width: 1080, height: 1350, name: "portrait.png" },
      { mimeType: "image/jpeg", width: 1080, height: 1350, name: "portrait.jpg" },
      { mimeType: "image/png", width: 1080, height: 1920, name: "story.png" },
      { mimeType: "image/jpeg", width: 1080, height: 1920, name: "story.jpg" },
    ]);
    expect(result).toEqual([{ mimeType: "image/png", width: 1080, height: 1920, name: "story.png" }]);
  });

  it("exports safe responsive email HTML", () => {
    const result = buildHtmlEmailHandoff(asset);
    expect(result).toContain("<!doctype html>");
    expect(result).toContain("Faith &lt; Fear");
    expect(result).not.toContain("Faith < Fear");
    expect(result).toContain("unsubscribe requirements");
  });
});
