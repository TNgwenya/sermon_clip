import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const previewState = vi.hoisted(() => ({
  editPreview: {
    startSeconds: 10,
    endSeconds: 40,
    durationSeconds: 30,
    captionCues: [
      { index: 1, startSeconds: 0, endSeconds: 2, text: "Grace meets us here" },
      { index: 2, startSeconds: 4, endSeconds: 6, text: "and carries us forward" },
    ],
    speechCleanup: {
      removeDeadAir: false,
      tightenLongPauses: true,
      flagFillerWords: true,
      intensity: "normal" as const,
    },
    speechCleanupEdits: null,
    audioSilenceEvents: [],
    audioSilenceAnalyzed: false,
    applyCaptionsToClip: true,
    hookOverlay: {
      enabled: false,
      text: "",
      position: "top" as const,
      startSeconds: 0,
      durationSeconds: 4,
      animation: "fade" as const,
      size: "medium" as const,
      bold: true,
    },
    brollLayer: {
      enabled: false,
      cards: [],
    },
  },
  isDraftDirty: false,
  previewClock: {
    currentSeconds: 0,
    sourceCurrentSeconds: 0,
    durationSeconds: 30,
    isPlaying: false,
  },
  requestPreviewPlayback: vi.fn(),
  seekPreviewTo: vi.fn(),
  seekSourcePreviewTo: vi.fn(),
}));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewState,
}));

import {
  __clipStudioTranscriptPanelTestUtils,
  ClipStudioTimeline,
  ClipStudioTranscriptPanel,
} from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-transcript-panel";

const panelProps = {
  transcriptSegments: [
    { id: "line-1", startTimeSeconds: 10, endTimeSeconds: 12, text: "Grace meets us here" },
    { id: "line-2", startTimeSeconds: 14, endTimeSeconds: 16, text: "and carries us forward" },
  ],
  clipStartSeconds: 10,
  clipEndSeconds: 40,
  clipDurationSeconds: 30,
  captionCues: previewState.editPreview.captionCues,
  speechCleanup: previewState.editPreview.speechCleanup,
  momentType: "teaching",
  momentTitle: "Grace for today",
  smartClipCategory: "encouragement",
};

describe("Clip Studio transcript and timing controls", () => {
  it("explains the spoken transcript and starts with follow playback enabled", () => {
    const markup = renderToStaticMarkup(<ClipStudioTranscriptPanel {...panelProps} />);

    expect(markup).toContain("Spoken transcript");
    expect(markup).toContain("Choose what stays");
    expect(markup).toContain("Highlighted lines stay in the clip");
    expect(markup).toContain("Highlighted: in clip");
    expect(markup).toContain("Follow playback");
    expect(markup).toContain("This transcript controls which spoken audio stays in the clip");
    expect(markup).toContain("use Captions in the Edit panel");
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup).toContain("Start clip here");
    expect(markup).toContain("End clip here");
  });

  it("seeks and requests playback when a spoken transcript line is previewed", () => {
    const setFocusedSegmentId = vi.fn();
    const seekToAbsolute = vi.fn();
    const requestPreviewPlayback = vi.fn();

    __clipStudioTranscriptPanelTestUtils.activateTranscriptSegment({
      segment: panelProps.transcriptSegments[1],
      setFocusedSegmentId,
      seekToAbsolute,
      requestPreviewPlayback,
    });

    expect(setFocusedSegmentId).toHaveBeenCalledWith("line-2");
    expect(seekToAbsolute).toHaveBeenCalledWith(14);
    expect(requestPreviewPlayback).toHaveBeenCalledOnce();
  });

  it("announces clip inclusion and follows the source playhead after cleanup cuts", () => {
    previewState.previewClock.currentSeconds = 1;
    previewState.previewClock.sourceCurrentSeconds = 5;
    previewState.previewClock.isPlaying = true;

    const markup = renderToStaticMarkup(
      <ClipStudioTranscriptPanel
        {...panelProps}
        transcriptSegments={[
          { id: "partial-start", startTimeSeconds: 9, endTimeSeconds: 11, text: "Opening boundary" },
          ...panelProps.transcriptSegments,
          { id: "outside", startTimeSeconds: 41, endTimeSeconds: 43, text: "After the clip" },
        ]}
      />,
    );

    expect(markup).toContain('data-clip-status="partial"');
    expect(markup).toContain("Partially included in clip");
    expect(markup).toContain('data-clip-status="included"');
    expect(markup).toContain("Included in clip");
    expect(markup).toContain('data-clip-status="outside"');
    expect(markup).toContain("Outside clip");
    expect(markup).toMatch(/aria-current="true"[^>]*data-transcript-segment-id="line-2"/);
    expect(markup).not.toContain("aria-pressed");

    previewState.previewClock.currentSeconds = 0;
    previewState.previewClock.sourceCurrentSeconds = 0;
    previewState.previewClock.isPlaying = false;
  });

  it("renders numeric In and Out fields with accessible 0.1-second nudges", () => {
    const markup = renderToStaticMarkup(<ClipStudioTimeline {...panelProps} />);

    expect(markup).toContain("In (seconds)");
    expect(markup).toContain("Out (seconds)");
    expect(markup).toContain('id="clip-studio-timeline-in-seconds"');
    expect(markup).toContain('id="clip-studio-timeline-out-seconds"');
    expect(markup).toContain('aria-label="Move In point earlier by 0.1 seconds"');
    expect(markup).toContain('aria-label="Move Out point later by 0.1 seconds"');

    expect(__clipStudioTranscriptPanelTestUtils.resolveTimelineBoundarySeconds({
      command: "set-start-seconds",
      seconds: 39.97,
      timelineStart: 10,
      timelineEnd: 40,
      activeClipStartSeconds: 10,
      activeClipEndSeconds: 40,
    })).toBe(39.9);
    expect(__clipStudioTranscriptPanelTestUtils.resolveTimelineBoundarySeconds({
      command: "set-end-seconds",
      seconds: 9,
      timelineStart: 10,
      timelineEnd: 40,
      activeClipStartSeconds: 10,
      activeClipEndSeconds: 40,
    })).toBe(10.1);
  });

  it("describes deleting a cleanup edit as removing its marker", () => {
    expect(__clipStudioTranscriptPanelTestUtils.removeCleanupMarkerAriaLabel(0)).toBe("Remove cleanup marker 1");
  });
});
