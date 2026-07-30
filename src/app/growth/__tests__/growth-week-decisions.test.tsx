import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GrowthWeekDecisions } from "@/app/growth/growth-week-decisions";

describe("growth weekly decisions", () => {
  it("keeps the recommendation, planning state, and measurement caveat in one labelled region", () => {
    const markup = renderToStaticMarkup(
      <GrowthWeekDecisions
        decision={{
          recommendationAvailable: true,
          actionLabel: "Prepare this post",
          title: "Hope after the storm",
          detail: "Prepare this for Instagram.",
          evidence: "Saved post-ready status and audience fit.",
          measurement: "Matched history is still too limited for a precise forecast.",
          confidence: "Medium",
        }}
        recommendationHref="/ready-to-post?clipId=clip-1"
        plannedCount={2}
      />,
    );

    expect(markup).toContain('aria-labelledby="growth-week-decisions-title"');
    expect(markup).toContain("This week’s decisions");
    expect(markup).toContain("<b>Evidence:</b>");
    expect(markup).toContain("too limited for a precise forecast");
    expect(markup).toContain('href="/ready-to-post#posting-calendar"');
    expect(markup).toContain('href="/ready-to-post?clipId=clip-1"');
  });

  it("defines tablet and mobile layouts for the decision cards", () => {
    const css = readFileSync(
      new URL("../growth-week-decisions.module.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("grid-template-columns: 1fr");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
