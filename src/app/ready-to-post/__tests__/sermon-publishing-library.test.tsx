import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SermonPublishingLibrary,
  buildSermonPublishingGroups,
  type SermonPublishingAsset,
  type SermonPublishingClip,
} from "@/app/ready-to-post/sermon-publishing-library";

function buildClip(overrides: Partial<SermonPublishingClip> = {}): SermonPublishingClip {
  return {
    id: "clip-1",
    title: "Keep your eyes on Jesus",
    hook: "Where are your eyes fixed?",
    caption: "Fix your eyes on Jesus.",
    hashtags: [],
    score: 91,
    finalQualityScore: 92,
    qualityLabel: "POST_READY",
    postReadyStatus: "POST_READY",
    postReadyReasons: [],
    postReadyBlockers: [],
    recommendedNextAction: null,
    qualityWarnings: [],
    qualityReasons: [],
    pastorFriendlyReason: null,
    qualitySummary: null,
    visualConfidenceScore: null,
    audioQualityScore: null,
    captionQualityScore: null,
    manualCropRecommended: false,
    smartClipCategory: "Encouragement",
    intendedAudience: null,
    mediaReady: true,
    estimatedBytes: 1024,
    remotePreviewUrl: null,
    exportedAt: "2026-08-12T10:00:00.000Z",
    sermon: {
      id: "sermon-1",
      title: "Fix Your Eyes on Jesus",
      churchName: "Grace Church",
      sermonDate: "2026-08-10T00:00:00.000Z",
    },
    ...overrides,
  };
}

function buildAsset(overrides: Partial<SermonPublishingAsset> = {}): SermonPublishingAsset {
  return {
    id: "asset-1",
    sermonId: "sermon-1",
    sermonTitle: "Fix Your Eyes on Jesus",
    sermonChurchName: "Grace Church",
    sermonDate: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
    contentOpportunityId: null,
    assetType: "QUOTE_GRAPHIC",
    status: "READY",
    platform: "INSTAGRAM",
    title: "Eyes up, church",
    bodyContent: "The direction of our attention shapes the direction of our faith.",
    caption: "Fix your eyes on Jesus this week.",
    hashtags: [],
    callToAction: null,
    currentRevisionId: "revision-1",
    approvedRevisionId: "revision-1",
    currentRevision: {
      revisionNumber: 1,
      approvalState: "APPROVED",
      approvedAt: "2026-08-13T09:00:00.000Z",
    },
    sourceOpportunityStatus: "USED",
    files: [],
    scheduledPosts: [],
    ...overrides,
  };
}

describe("sermon-first publishing library", () => {
  it("groups finished clips and every generated content asset under their source sermon", () => {
    const groups = buildSermonPublishingGroups(
      [buildClip(), buildClip({ id: "clip-2", title: "Run with endurance" })],
      [
        buildAsset(),
        buildAsset({ id: "asset-2", title: "A weekly devotional", assetType: "DEVOTIONAL", status: "GENERATED" }),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Fix Your Eyes on Jesus");
    expect(groups[0].clips.map((clip) => clip.id)).toEqual(["clip-1", "clip-2"]);
    expect(groups[0].contentAssets.map((asset) => asset.id)).toEqual(["asset-1", "asset-2"]);
  });

  it("renders one mixed sermon workspace before publishing operations", () => {
    const markup = renderToStaticMarkup(
      <SermonPublishingLibrary
        clips={[buildClip()]}
        contentAssets={[buildAsset(), buildAsset({ id: "asset-2", assetType: "PRAYER", title: "Prayer for focused faith" })]}
        activeSermonId="sermon-1"
      />,
    );

    expect(markup).toContain("Sermon publishing workspace");
    expect(markup).toContain("Fix Your Eyes on Jesus");
    expect(markup).toContain("Keep your eyes on Jesus");
    expect(markup).toContain("Eyes up, church");
    expect(markup).toContain("Prayer for focused faith");
    expect(markup).toContain("sermonId=sermon-1&amp;clipId=clip-1");
    expect(markup).toContain("sermonId=sermon-1&amp;contentAssetId=asset-1");
  });
});
