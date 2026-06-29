import { describe, expect, it } from "vitest";

import {
  buildClipWarnings,
  filterClips,
  getQueuedMediaAssetsForRemoteBatchAction,
  summarizeReview,
  type ReviewClipModel,
} from "@/lib/clipReview";

function clip(status: ReviewClipModel["status"]): ReviewClipModel {
  return {
    id: status,
    status,
    score: 8,
    durationSeconds: 45,
    createdAt: new Date("2026-06-18T10:00:00.000Z"),
    renderStatus: "COMPLETED",
    captionStatus: "GENERATED",
    overlayStatus: "COMPLETED",
    exportStatus: status === "EXPORTED" ? "COMPLETED" : "NOT_EXPORTED",
    boundaryQuality: "GOOD",
    subtitleFilePath: "/tmp/subtitles.srt",
    overlayVideoPath: "/tmp/overlay.mp4",
  };
}

describe("clip review summaries", () => {
  it("treats exported clips as approved for pastor readiness", () => {
    const clips = [clip("APPROVED"), clip("EXPORTED"), clip("SUGGESTED"), clip("REJECTED")];

    expect(summarizeReview(clips)).toMatchObject({
      total: 4,
      approved: 2,
      pending: 1,
      rejected: 1,
    });
    expect(filterClips(clips, "APPROVED").map((item) => item.status)).toEqual(["APPROVED", "EXPORTED"]);
  });

  it("shows a pastor-friendly warning for unstable smart crop movement", () => {
    expect(buildClipWarnings({
      ...clip("APPROVED"),
      qualityWarnings: ["SMART_CROP_UNSTABLE"],
    })).toContain("Smart crop movement may need review");
  });

  it("queues local worker assets for remote batch media actions", () => {
    expect(getQueuedMediaAssetsForRemoteBatchAction("approve")).toEqual([
      "render",
      "caption",
      "captionBurn",
      "overlay",
      "export",
    ]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("render")).toEqual([]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("export")).toEqual(["render", "overlay", "export"]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("reject")).toEqual([]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("pending")).toEqual([]);
  });
});
