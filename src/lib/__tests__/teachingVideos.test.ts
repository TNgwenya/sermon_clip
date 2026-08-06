import { describe, expect, it } from "vitest";

import {
  buildTeachingTranscriptAnchors,
  buildTeachingTranscriptWindows,
  rangesSubstantiallyOverlap,
  refineTeachingVideoBoundaries,
} from "@/lib/teachingVideos";

describe("teaching video transcript analysis", () => {
  const anchors = buildTeachingTranscriptAnchors([
    { startTimeSeconds: 10, endTimeSeconds: 14, text: "This is the first complete thought." },
    { startTimeSeconds: 14.1, endTimeSeconds: 18, text: "because it continues" },
    { startTimeSeconds: 18.1, endTimeSeconds: 23, text: "and now the thought is complete." },
    { startTimeSeconds: 23.2, endTimeSeconds: 28, text: "Here is the next teaching point." },
  ]);

  it("creates stable start and end anchor identifiers", () => {
    expect(anchors[0].startAnchorId).toBe("segment-000000:start");
    expect(anchors[3].endAnchorId).toBe("segment-000003:end");
  });

  it("covers a transcript with overlapping macro windows", () => {
    const longAnchors = buildTeachingTranscriptAnchors(
      Array.from({ length: 40 }, (_, index) => ({
        startTimeSeconds: index * 30,
        endTimeSeconds: index * 30 + 29,
        text: `Complete teaching sentence ${index}.`,
      })),
    );
    const windows = buildTeachingTranscriptWindows(longAnchors);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[1].startTimeSeconds).toBeLessThan(windows[0].endTimeSeconds);
    expect(windows.at(-1)?.segments.at(-1)?.segmentIndex).toBe(39);
  });

  it("expands a start and end to complete transcript boundaries", () => {
    const result = refineTeachingVideoBoundaries(anchors, 14.2, 18.2, 120);
    expect(result.startAnchorId).toBe("segment-000000:start");
    expect(result.endAnchorId).toBe("segment-000002:end");
    expect(result.endTimeSeconds).toBeGreaterThan(23);
  });

  it("does not drift when an already refined range is saved again", () => {
    const first = refineTeachingVideoBoundaries(anchors, 14.2, 18.2, 120);
    const second = refineTeachingVideoBoundaries(
      anchors,
      first.startTimeSeconds,
      first.endTimeSeconds,
      120,
    );

    expect(second.startTimeSeconds).toBe(first.startTimeSeconds);
    expect(second.endTimeSeconds).toBe(first.endTimeSeconds);
    expect(second.startAnchorId).toBe(first.startAnchorId);
    expect(second.endAnchorId).toBe(first.endAnchorId);
  });

  it("detects substantially overlapping teaching ranges", () => {
    expect(rangesSubstantiallyOverlap(
      { startTimeSeconds: 100, endTimeSeconds: 700 },
      { startTimeSeconds: 150, endTimeSeconds: 680 },
    )).toBe(true);
    expect(rangesSubstantiallyOverlap(
      { startTimeSeconds: 100, endTimeSeconds: 400 },
      { startTimeSeconds: 500, endTimeSeconds: 800 },
    )).toBe(false);
  });
});
