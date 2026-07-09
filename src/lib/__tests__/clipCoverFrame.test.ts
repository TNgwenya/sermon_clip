import { describe, expect, it } from "vitest";

import {
  buildClipCoverFrameSelection,
  buildCoverFrameSource,
  buildNeutralCoverFrameCandidates,
  clampCoverFrameTime,
  isClipCoverFrameSelectionStale,
  mergeClipCoverFrameSelection,
  parseClipCoverFrameSelection,
} from "@/lib/clipCoverFrame";

describe("clip cover frame", () => {
  it("offers four neutral, clip-relative moments", () => {
    expect(buildNeutralCoverFrameCandidates(50)).toEqual([
      expect.objectContaining({ id: "opening", timeSeconds: 4 }),
      expect.objectContaining({ id: "early", timeSeconds: 16 }),
      expect.objectContaining({ id: "middle", timeSeconds: 28 }),
      expect.objectContaining({ id: "later", timeSeconds: 40 }),
    ]);
  });

  it("clamps a requested moment inside the decodable clip range", () => {
    expect(clampCoverFrameTime(-2, 10)).toBe(0);
    expect(clampCoverFrameTime(99, 10)).toBe(9.8);
    expect(clampCoverFrameTime(1, 0)).toBe(0);
  });

  it("builds and parses a versioned selection", () => {
    const source = buildCoverFrameSource({
      variant: "captioned",
      assetVersion: 3,
      sourceUpdatedAt: "2026-07-10T09:00:00.000Z",
    });
    const selection = buildClipCoverFrameSelection({
      timeSeconds: 8.25,
      durationSeconds: 30,
      source,
      selectedBy: "USER",
      selectedAt: "2026-07-10T10:00:00.000Z",
    });

    const captionData = mergeClipCoverFrameSelection({ primaryCaption: "Keep this" }, selection);
    expect(captionData.primaryCaption).toBe("Keep this");
    expect(parseClipCoverFrameSelection(captionData)).toEqual(selection);
  });

  it("rejects malformed or future selection shapes", () => {
    expect(parseClipCoverFrameSelection(null)).toBeNull();
    expect(parseClipCoverFrameSelection({ coverFrameSelection: { schemaVersion: 2 } })).toBeNull();
    expect(parseClipCoverFrameSelection({
      coverFrameSelection: {
        schemaVersion: 1,
        timeSeconds: -1,
        durationSeconds: 20,
        sourceVariant: "rendered",
        sourceAssetVersion: 1,
        sourceFingerprint: "rendered:v1:undated",
        selectedBy: "USER",
        selectedAt: "not-a-date",
      },
    })).toBeNull();
  });

  it("marks a saved choice stale when its source version or duration no longer matches", () => {
    const originalSource = buildCoverFrameSource({ variant: "rendered", assetVersion: 1 });
    const selection = buildClipCoverFrameSelection({
      timeSeconds: 12,
      durationSeconds: 20,
      source: originalSource,
      selectedBy: "USER",
      selectedAt: "2026-07-10T10:00:00.000Z",
    });

    expect(isClipCoverFrameSelectionStale(selection, originalSource, 20)).toBe(false);
    expect(isClipCoverFrameSelectionStale(
      selection,
      buildCoverFrameSource({ variant: "rendered", assetVersion: 2 }),
      20,
    )).toBe(true);
    expect(isClipCoverFrameSelectionStale(selection, originalSource, 25)).toBe(true);
    expect(isClipCoverFrameSelectionStale(selection, originalSource, 10)).toBe(true);
  });
});
