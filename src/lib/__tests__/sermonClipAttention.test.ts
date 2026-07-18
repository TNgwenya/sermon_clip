import { describe, expect, it } from "vitest";

import {
  summarizeSermonClipAttention,
  type SermonClipAttentionInput,
} from "@/lib/sermonClipAttention";

function clip(overrides: Partial<SermonClipAttentionInput> = {}): SermonClipAttentionInput {
  return {
    status: "SUGGESTED",
    renderStatus: "COMPLETED",
    exportStatus: "NOT_EXPORTED",
    captionStatus: "NOT_GENERATED",
    captionBurnStatus: "NOT_BURNED",
    overlayStatus: "NOT_RENDERED",
    renderFreshness: "UP_TO_DATE",
    captionFreshness: "NEEDS_REGENERATION",
    captionBurnFreshness: "NEEDS_REGENERATION",
    overlayFreshness: "NEEDS_REGENERATION",
    exportFreshness: "NEEDS_REGENERATION",
    ...overrides,
  };
}

describe("sermon clip attention", () => {
  it("does not flag future posting assets for fresh suggested previews", () => {
    const summary = summarizeSermonClipAttention(Array.from({ length: 6 }, () => clip()));

    expect(summary).toEqual({
      running: 0,
      failed: 0,
      clipsNeedingRefresh: 0,
    });
  });

  it.each([
    { renderStatus: "NOT_RENDERED" as const, renderFreshness: "NEEDS_REGENERATION" as const },
    { renderStatus: "COMPLETED" as const, renderFreshness: "OUTDATED" as const },
    { renderStatus: "COMPLETED" as const, renderFreshness: "NEEDS_REGENERATION" as const },
  ])("flags a stale or missing expected preview", (previewState) => {
    expect(summarizeSermonClipAttention([clip(previewState)]).clipsNeedingRefresh).toBe(1);
  });

  it("ignores unstarted approved outputs but flags a previously produced outdated output", () => {
    const neverPrepared = clip({ status: "APPROVED" });
    const staleCaption = clip({
      status: "APPROVED",
      captionStatus: "GENERATED",
      captionFreshness: "OUTDATED",
    });

    expect(summarizeSermonClipAttention([neverPrepared]).clipsNeedingRefresh).toBe(0);
    expect(summarizeSermonClipAttention([staleCaption]).clipsNeedingRefresh).toBe(1);
  });

  it("counts a clip once when several produced assets need refresh", () => {
    const summary = summarizeSermonClipAttention([clip({
      status: "EXPORTED",
      captionStatus: "GENERATED",
      captionFreshness: "OUTDATED",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "NEEDS_REGENERATION",
      overlayStatus: "COMPLETED",
      overlayFreshness: "OUTDATED",
      exportStatus: "COMPLETED",
      exportFreshness: "OUTDATED",
    })]);

    expect(summary.clipsNeedingRefresh).toBe(1);
  });

  it("preserves running and failed operation counts", () => {
    const summary = summarizeSermonClipAttention([
      clip({
        renderStatus: "RENDERING",
        exportStatus: "EXPORTING",
        captionStatus: "GENERATING",
        captionBurnStatus: "BURNING",
        overlayStatus: "RENDERING",
      }),
      clip({
        renderStatus: "FAILED",
        exportStatus: "FAILED",
        captionStatus: "FAILED",
        captionBurnStatus: "FAILED",
        overlayStatus: "FAILED",
      }),
    ]);

    expect(summary.running).toBe(5);
    expect(summary.failed).toBe(5);
  });

  it("ignores rejected clips even when every operation needs attention", () => {
    const summary = summarizeSermonClipAttention([clip({
      status: "REJECTED",
      renderStatus: "FAILED",
      exportStatus: "FAILED",
      captionStatus: "FAILED",
      captionBurnStatus: "FAILED",
      overlayStatus: "FAILED",
      renderFreshness: "OUTDATED",
      captionFreshness: "OUTDATED",
      captionBurnFreshness: "OUTDATED",
      overlayFreshness: "OUTDATED",
      exportFreshness: "OUTDATED",
    })]);

    expect(summary).toEqual({
      running: 0,
      failed: 0,
      clipsNeedingRefresh: 0,
    });
  });
});
