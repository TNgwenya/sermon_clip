import { describe, expect, it } from "vitest";

import {
  buildAdaptiveModelSampleTimes,
  buildModelSampleTimes,
  inferHeuristicTracks,
  inferModelTracksFromDetections,
  measureTrackingMotion,
  selectPastorDetection,
  stabilizeSmartCropTimeline,
  type VideoSubjectBox,
} from "@/server/agents/videoSubjectTrackingService";

function box(timeSeconds: number, centerX: number, confidence = 0.9): VideoSubjectBox {
  return {
    timeSeconds,
    x: centerX - 0.1,
    y: 0.2,
    width: 0.2,
    height: 0.6,
    confidence,
  };
}

describe("video subject tracking service", () => {
  it("creates face, body, and speaker-area tracks with normalized boxes", () => {
    const tracks = inferHeuristicTracks({
      startTimeSeconds: 10,
      endTimeSeconds: 40,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });

    expect(tracks.map((track) => track.kind)).toEqual(["FACE", "BODY", "SPEAKER_AREA"]);

    const expectedSampleCount = buildModelSampleTimes(10, 40).length;
    for (const track of tracks) {
      expect(track.boxes).toHaveLength(expectedSampleCount);
      for (const box of track.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1);
        expect(box.y + box.height).toBeLessThanOrEqual(1);
        expect(box.confidence).toBeGreaterThan(0);
      }
    }
  });

  it("creates model person tracks from detected pastor boxes", () => {
    const tracks = inferModelTracksFromDetections({
      detections: [
        {
          timeSeconds: 12,
          x: 0.12,
          y: 0.18,
          width: 0.2,
          height: 0.64,
          confidence: 0.91,
        },
        {
          timeSeconds: 18,
          x: 0.62,
          y: 0.16,
          width: 0.22,
          height: 0.66,
          confidence: 0.88,
        },
      ],
    });

    expect(tracks.map((track) => track.kind)).toEqual(["FACE", "BODY", "SPEAKER_AREA"]);
    expect(tracks[1].label).toBe("Detected pastor body");
    expect(tracks[1].boxes.map((box) => box.x)).toEqual([0.12, 0.62]);
    expect(tracks[2].confidenceScore).toBeGreaterThan(tracks[1].confidenceScore);
  });

  it("samples long clips densely enough to follow a moving pastor", () => {
    const samples = buildModelSampleTimes(100, 220);

    expect(samples[0]).toBe(100);
    expect(samples.at(-1)).toBe(220);
    expect(samples.length).toBe(81);
    expect(samples.slice(0, 4)).toEqual([100, 101.5, 103, 104.5]);
  });

  it("adapts sample density for static, moving, and low-confidence tracking", () => {
    const staticSamples = buildAdaptiveModelSampleTimes({
      startTimeSeconds: 0,
      endTimeSeconds: 10,
      boxes: [box(0, 0.5), box(5, 0.51), box(10, 0.5)],
    });
    const highMotionSamples = buildAdaptiveModelSampleTimes({
      startTimeSeconds: 0,
      endTimeSeconds: 10,
      boxes: [box(0, 0.2), box(5, 0.75), box(10, 0.3)],
    });
    const lowConfidenceSamples = buildAdaptiveModelSampleTimes({
      startTimeSeconds: 0,
      endTimeSeconds: 10,
      boxes: [box(0, 0.5), box(5, 0.55, 0.4), box(10, 0.56)],
    });

    expect(measureTrackingMotion([box(0, 0.5), box(5, 0.51), box(10, 0.5)]).movementProfile).toBe("STATIC");
    expect(staticSamples.length).toBeLessThan(highMotionSamples.length);
    expect(lowConfidenceSamples.length).toBeGreaterThan(staticSamples.length);
    expect(lowConfidenceSamples).toContain(4.5);
    expect(lowConfidenceSamples).toContain(5.5);
  });

  it("keeps following the same pastor instead of switching to a centered person", () => {
    const selected = selectPastorDetection(
      [
        { timeSeconds: 18, x: 0.62, y: 0.16, width: 0.22, height: 0.66, confidence: 0.88 },
        { timeSeconds: 18, x: 0.38, y: 0.18, width: 0.16, height: 0.5, confidence: 0.9 },
      ],
      { timeSeconds: 10, x: 0.6, y: 0.16, width: 0.22, height: 0.66, confidence: 0.88 },
    );

    expect(selected?.x).toBe(0.62);
  });

  it("requires a clearly better detection before switching people", () => {
    const selected = selectPastorDetection(
      [
        { timeSeconds: 18, x: 0.6, y: 0.16, width: 0.22, height: 0.66, confidence: 0.78 },
        { timeSeconds: 18, x: 0.34, y: 0.18, width: 0.2, height: 0.58, confidence: 0.9 },
      ],
      { timeSeconds: 10, x: 0.61, y: 0.16, width: 0.22, height: 0.66, confidence: 0.84 },
    );

    expect(selected?.x).toBe(0.6);
  });

  it("keeps a continuity-locked subject even when a far distractor is highly confident", () => {
    const selected = selectPastorDetection(
      [
        { timeSeconds: 24, x: 0.64, y: 0.16, width: 0.22, height: 0.66, confidence: 0.71 },
        { timeSeconds: 24, x: 0.22, y: 0.18, width: 0.2, height: 0.58, confidence: 0.95 },
      ],
      { timeSeconds: 22, x: 0.62, y: 0.16, width: 0.22, height: 0.66, confidence: 0.84 },
    );

    expect(selected?.x).toBe(0.64);
  });

  it("refuses to switch to a far person unless the match is clearly better", () => {
    const selected = selectPastorDetection(
      [
        { timeSeconds: 24, x: 0.12, y: 0.18, width: 0.22, height: 0.66, confidence: 0.86 },
        { timeSeconds: 24, x: 0.72, y: 0.18, width: 0.24, height: 0.68, confidence: 0.9 },
      ],
      { timeSeconds: 22, x: 0.46, y: 0.16, width: 0.22, height: 0.66, confidence: 0.84 },
    );

    expect(selected).toBeNull();
  });

  it("keeps a stable smart crop timeline mostly unchanged", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.48), box(20, 0.5), box(30, 0.53)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 30 },
      source: "MODEL",
      sampleCount: 3,
      hasBody: true,
      hasFace: true,
      hasSpeakerArea: true,
    });

    expect(points).toHaveLength(3);
    expect(points[0].centerX).toBeCloseTo(0.48, 2);
    expect(points[2].centerX).toBeGreaterThan(0.5);
    expect(points.some((point) => point.rejected)).toBe(false);
  });

  it("smooths a single low-confidence bad jump", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.5, 0.92), box(20, 0.88, 0.48), box(30, 0.52, 0.9)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 30 },
      source: "MODEL",
      sampleCount: 3,
      hasBody: true,
      hasFace: true,
      hasSpeakerArea: true,
    });

    expect(points[1].centerX).toBeLessThan(0.65);
    expect(points[1].rejected || points[1].frozen || points[1].stabilized).toBe(true);
  });

  it("freezes an isolated wrong-person jump when tracking returns to the pastor", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.67, 0.8), box(12, 0.32, 0.72), box(14, 0.75, 0.84)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 14 },
      source: "MODEL",
      sampleCount: 3,
      hasBody: true,
      hasFace: true,
      hasSpeakerArea: true,
    });

    expect(points[1].centerX).toBe(points[0].centerX);
    expect(points[1].rejected).toBe(true);
    expect(points[1].frozen).toBe(true);
  });

  it("freezes low-confidence points at the previous reliable center", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.44, 0.9), box(18, 0.72, 0.24), box(26, 0.74, 0.22)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 26 },
      source: "MODEL",
      sampleCount: 3,
      hasBody: true,
    });

    expect(points[1].frozen).toBe(true);
    expect(points[1].centerX).toBe(points[0].centerX);
    expect(points[2].centerX).toBeCloseTo(points[1].centerX, 2);
  });

  it("dampens heuristic fallback movement", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.5, 0.58), box(20, 0.62, 0.58), box(30, 0.4, 0.58)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 30 },
      source: "HEURISTIC_CENTER",
      sampleCount: 3,
      hasBody: true,
    });

    expect(Math.abs(points[1].centerX - points[0].centerX)).toBeLessThan(0.08);
    expect(Math.abs(points[2].centerX - points[1].centerX)).toBeLessThan(0.08);
  });

  it("applies a dead-zone to avoid small smart-crop jitter", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [box(10, 0.62, 0.88), box(12, 0.646, 0.86), box(14, 0.634, 0.87)],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 14 },
      source: "MODEL",
      sampleCount: 3,
      hasBody: true,
      hasFace: true,
      hasSpeakerArea: true,
    });

    expect(points[1].centerX).toBe(points[0].centerX);
    expect(points[2].centerX).toBe(points[0].centerX);
    expect(points[1].stabilized).toBe(true);
    expect(points[2].stabilized).toBe(true);
  });

  it("returns a valid empty timeline when no points are available", () => {
    const points = stabilizeSmartCropTimeline({
      boxes: [],
      boundaries: { startTimeSeconds: 10, endTimeSeconds: 30 },
      source: "MODEL",
      sampleCount: 0,
    });

    expect(points).toEqual([]);
  });
});
