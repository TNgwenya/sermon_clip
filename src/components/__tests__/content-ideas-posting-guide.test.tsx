import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContentIdeasPostingGuide,
  isContentIdeasPostingGuideTarget,
} from "@/components/content-ideas-posting-guide";

describe("ContentIdeasPostingGuide", () => {
  it("explains the complete review-to-scheduling path without implying that drafts publish", () => {
    const markup = renderToStaticMarkup(<ContentIdeasPostingGuide defaultOpen />);

    expect(markup).toContain("Finish this post in three decisions");
    expect(markup).toContain("Preview &amp; approve");
    expect(markup).toContain("Review this idea");
    expect(markup).toContain("Prepare approved content");
    expect(markup).toContain("Prepare for publishing");
    expect(markup).toContain("Design &amp; schedule");
    expect(markup).toContain("Save &amp; choose design");
    expect(markup).toContain("Preview &amp; edit design");
    expect(markup).toContain("Continue to scheduling");
    expect(markup).toContain("Choose date &amp; time");
    expect(markup).toContain("Manual media-team handoff");
    expect(markup).toContain("Automatic Facebook / Instagram images");
    expect(markup).toContain("Your edits autosave");
    expect(markup).toContain("Version history");
    expect(markup).toContain("do not publish anything");
  });

  it("offers a compact refresher from Ready to Post", () => {
    const markup = renderToStaticMarkup(<ContentIdeasPostingGuide compact />);

    expect(markup).toContain("Working on one piece?");
    expect(markup).toContain("approve it, change it, or replace it");
    expect(markup).toContain('href="/weekly-plan"');
  });

  it("teaches the real first action when a sermon has no ideas", () => {
    const markup = renderToStaticMarkup(
      <ContentIdeasPostingGuide defaultOpen startingWithoutIdeas />,
    );

    expect(markup).toContain("Create your first Content Week");
    expect(markup).toContain("Create the Content Week");
    expect(markup).toContain("Create my Content Week");
    expect(markup).toContain("smaller idea set");
    expect(markup.indexOf("Create my Content Week")).toBeLessThan(
      markup.indexOf("Recommended next"),
    );
  });

  it("recognizes only the full guide hash target", () => {
    expect(isContentIdeasPostingGuideTarget("#content-ideas-posting-guide")).toBe(true);
    expect(isContentIdeasPostingGuideTarget("")).toBe(false);
    expect(isContentIdeasPostingGuideTarget("#ready-to-post")).toBe(false);
  });
});
