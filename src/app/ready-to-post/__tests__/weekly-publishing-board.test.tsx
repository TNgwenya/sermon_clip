import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WeeklyPublishingBoard } from "@/app/ready-to-post/weekly-publishing-board";

const snapshot = {
  needsWorkCount: 1,
  readyCount: 2,
  scheduledCount: 3,
  attentionCount: 1,
  postedCount: 4,
  verifiedChannelCount: 0,
  automaticPublishingReady: false,
  automaticPublishingLabel: "No verified automatic channel",
  automaticPublishingDetail: "Use manual downloads before choosing automatic publishing.",
  manualHandoffAvailable: true,
  decision: {
    tone: "attention" as const,
    eyebrow: "Next decision",
    title: "Review the Instagram result",
    detail: "Check the destination before retrying.",
    href: "#posting-calendar" as const,
    actionLabel: "Review publishing result",
    evidence: "Based on the saved failed publishing status.",
  },
};

describe("weekly publishing board presentation", () => {
  it("exposes one labelled workflow summary and keyboard-reachable destinations", () => {
    const markup = renderToStaticMarkup(
      <WeeklyPublishingBoard snapshot={snapshot} weekLabel="Jul 29 – Aug 4" />,
    );

    expect(markup).toContain('aria-labelledby="weekly-publishing-board-title"');
    expect(markup).toContain('aria-label="Publishing workflow status"');
    expect(markup).toContain('href="#ready-clips"');
    expect(markup).toContain('href="#posting-calendar"');
    expect(markup).toContain("No verified automatic channel");
    expect(markup).toContain("Manual video downloads and copy handoff are available.");
    expect(markup).toContain("Based on the saved failed publishing status.");
  });

  it("provides compact tablet and mobile layouts without motion-only affordances", () => {
    const css = readFileSync(
      new URL("../publishing-board.module.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
  });
});
