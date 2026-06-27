import { describe, expect, it } from "vitest";

import { __regenerationTestUtils } from "../dependencies";

describe("regeneration dependency tracking", () => {
  it("title/hook/hashtags edit does not imply video rerender", () => {
    const impact = __regenerationTestUtils.detectClipEditImpact(
      {
        title: "Old Title",
        hook: "Old Hook",
        caption: "Same caption",
        hashtags: ["#one", "#two"],
        startTimeSeconds: 12,
        endTimeSeconds: 52,
        exportLayoutStrategy: "CENTER_CROP",
      },
      {
        title: "New Title",
        hook: "New Hook",
        caption: "Same caption",
        hashtags: ["#one", "#three"],
        startTimeSeconds: 12,
        endTimeSeconds: 52,
        exportLayoutStrategy: "CENTER_CROP",
      },
    );

    expect(impact.metadataOnlyChanged).toBe(true);
    expect(impact.boundariesChanged).toBe(false);
    expect(impact.framingChanged).toBe(false);
    expect(impact.captionTextChanged).toBe(false);
  });

  it("boundary edit marks render dependency change", () => {
    const impact = __regenerationTestUtils.detectClipEditImpact(
      {
        title: "Title",
        hook: "Hook",
        caption: "Caption",
        hashtags: ["#a"],
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        exportLayoutStrategy: "CENTER_CROP",
      },
      {
        title: "Title",
        hook: "Hook",
        caption: "Caption",
        hashtags: ["#a"],
        startTimeSeconds: 11,
        endTimeSeconds: 50,
        exportLayoutStrategy: "CENTER_CROP",
      },
    );

    expect(impact.boundariesChanged).toBe(true);
    expect(impact.metadataOnlyChanged).toBe(false);
  });

  it("caption edit marks caption dependency change", () => {
    const impact = __regenerationTestUtils.detectClipEditImpact(
      {
        title: "Title",
        hook: "Hook",
        caption: "Old caption",
        hashtags: ["#a"],
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        exportLayoutStrategy: "CENTER_CROP",
      },
      {
        title: "Title",
        hook: "Hook",
        caption: "New caption",
        hashtags: ["#a"],
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        exportLayoutStrategy: "CENTER_CROP",
      },
    );

    expect(impact.captionTextChanged).toBe(true);
    expect(impact.boundariesChanged).toBe(false);
  });

  it("framing edit marks rerender dependency", () => {
    const impact = __regenerationTestUtils.detectClipEditImpact(
      {
        title: "Title",
        hook: "Hook",
        caption: "Caption",
        hashtags: ["#a"],
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        exportLayoutStrategy: "CENTER_CROP",
      },
      {
        title: "Title",
        hook: "Hook",
        caption: "Caption",
        hashtags: ["#a"],
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        exportLayoutStrategy: "LEFT_FOCUS",
      },
    );

    expect(impact.framingChanged).toBe(true);
  });

  it("computes all outdated assets", () => {
    const assets = __regenerationTestUtils.computeOutdatedAssetsForClip({
      render: "OUTDATED",
      caption: "UP_TO_DATE",
      captionBurn: "FAILED",
      overlay: "NEEDS_REGENERATION",
      export: "UP_TO_DATE",
    });

    expect(assets).toEqual(["render", "captionBurn", "overlay"]);
  });

  it("regenerates failed status assets even when freshness flags look up to date", () => {
    const assets = __regenerationTestUtils.computeRegenerableAssetsForClip({
      render: "UP_TO_DATE",
      caption: "UP_TO_DATE",
      captionBurn: "UP_TO_DATE",
      overlay: "UP_TO_DATE",
      export: "UP_TO_DATE",
      renderStatus: "FAILED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "FAILED",
      exportStatus: "COMPLETED",
    });

    expect(assets).toEqual(["render", "overlay"]);
  });

  it("keeps regeneration assets in dependency order when status and freshness both need work", () => {
    const assets = __regenerationTestUtils.computeRegenerableAssetsForClip({
      render: "UP_TO_DATE",
      caption: "NEEDS_REGENERATION",
      captionBurn: "UP_TO_DATE",
      overlay: "OUTDATED",
      export: "FAILED",
      renderStatus: "COMPLETED",
      captionStatus: "FAILED",
      captionBurnStatus: "FAILED",
      overlayStatus: "COMPLETED",
      exportStatus: "FAILED",
    });

    expect(assets).toEqual(["caption", "captionBurn", "overlay", "export"]);
  });

  it("summarizes batch regeneration outcomes", () => {
    const summary = __regenerationTestUtils.summarizeBatchResult([
      { ok: true, clipId: "a", asset: "render" },
      { ok: true, skipped: true, clipId: "b", asset: "caption" },
      { ok: false, clipId: "c", asset: "export", reason: "failed" },
    ]);

    expect(summary.attempted).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.asset).toBe("export");
  });

  it("formats freshness labels for UI", () => {
    expect(__regenerationTestUtils.toFreshnessLabel("UP_TO_DATE")).toBe("Up To Date");
    expect(__regenerationTestUtils.toFreshnessLabel("OUTDATED")).toBe("Outdated");
    expect(__regenerationTestUtils.toFreshnessLabel("NEEDS_REGENERATION")).toBe("Needs Regeneration");
    expect(__regenerationTestUtils.toFreshnessLabel("FAILED")).toBe("Failed");
  });

  it("only approved or exported clips are eligible for posting asset regeneration", () => {
    expect(__regenerationTestUtils.isClipApprovedForPostingAssets("APPROVED")).toBe(true);
    expect(__regenerationTestUtils.isClipApprovedForPostingAssets("EXPORTED")).toBe(true);
    expect(__regenerationTestUtils.isClipApprovedForPostingAssets("SUGGESTED")).toBe(false);
    expect(__regenerationTestUtils.isClipApprovedForPostingAssets("REJECTED")).toBe(false);
  });

  it("branding edits invalidate overlay assets only when branding values change", () => {
    const before = {
      churchName: "Grace Church",
      churchLogoPath: "/logo.png",
      primaryBrandColor: "#0F766E",
      secondaryBrandColor: "#1D4ED8",
      defaultFontFamily: "Avenir Next",
      defaultCaptionStyleName: "clean-lower-third",
      watermarkPosition: "BOTTOM_RIGHT",
    };

    const unchanged = __regenerationTestUtils.shouldInvalidateOverlayForBrandingChange(before, {
      ...before,
    });
    expect(unchanged).toBe(false);

    const changed = __regenerationTestUtils.shouldInvalidateOverlayForBrandingChange(before, {
      ...before,
      primaryBrandColor: "#FF5500",
    });
    expect(changed).toBe(true);
  });
});
