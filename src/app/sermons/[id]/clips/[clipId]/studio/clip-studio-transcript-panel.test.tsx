import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BrollLayerConfig } from "@/lib/clipStudio";
import type { SpeechCleanupEdits } from "@/lib/speechCleanupPlan";

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
    speechCleanupEdits: null as SpeechCleanupEdits | null,
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
      cards: [] as BrollLayerConfig["cards"],
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
    { id: "line-1", startTimeSeconds: 10, endTimeSeconds: 12, text: "Grace meets us here", confidence: 0.72 },
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
  transcriptReviewRequired: false,
  transcriptReviewHref: "/sermons/sermon-1/review#clip-clip-1",
};

describe("Clip Studio transcript and timing controls", () => {
  it("makes playable transcript rows and selected-line actions explicit", () => {
    const markup = renderToStaticMarkup(<ClipStudioTranscriptPanel {...panelProps} />);

    expect(markup).toContain(">Transcript</h2>");
    expect(markup).toContain("Selected line");
    expect(markup.match(/Check wording/g)).toHaveLength(1);
    expect(markup).toContain("Select a line to preview or edit its timing.");
    expect(markup).not.toContain("Choose what stays");
    expect(markup).not.toContain("Choose an action");
    expect(markup).toContain("In clip: highlighted green");
    expect(markup).toContain("Follow playback");
    expect(markup).toContain("Start and end trim the recording");
    expect(markup).toContain("Caption corrections change text only");
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup).toContain("Preview selected line");
    expect(markup).toContain("Set start to 0:10");
    expect(markup).toContain("Set end to 0:12");
    expect(markup).toContain("Edit caption words");
    expect(markup).toContain("Review transcript");
    expect(markup).toContain('href="/sermons/sermon-1/review#clip-clip-1"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*data-transcript-segment-id="line-1"/);
    expect(markup).toContain("Select &amp; play");
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
    expect(markup).toMatch(/aria-pressed="true"[^>]*data-transcript-segment-id="line-2"/);

    previewState.previewClock.currentSeconds = 0;
    previewState.previewClock.sourceCurrentSeconds = 0;
    previewState.previewClock.isPlaying = false;
  });

  it("explains caption and transcript-review requirements without changing audio semantics", () => {
    previewState.editPreview.applyCaptionsToClip = false;

    const markup = renderToStaticMarkup(
      <ClipStudioTranscriptPanel
        {...panelProps}
        transcriptReviewRequired
      />,
    );

    expect(markup).toContain("Captions are off");
    expect(markup).toContain("Enable captions to edit");
    expect(markup).toContain("Spoken transcript review required before final video");
    expect(markup).toContain("Preparing is locked until a reviewer confirms the spoken wording");
    expect(markup).toContain("Caption edits here do not complete that review");
    expect(markup).toContain("Review and confirm wording");

    previewState.editPreview.applyCaptionsToClip = true;
  });

  it("locks caption wording edits for a spoken line outside the clip and explains the requirement", () => {
    const markup = renderToStaticMarkup(
      <ClipStudioTranscriptPanel
        {...panelProps}
        transcriptSegments={[
          { id: "outside", startTimeSeconds: 41, endTimeSeconds: 43, text: "After the clip" },
        ]}
      />,
    );

    expect(markup).toContain("This line is outside the clip");
    expect(markup).toContain("Requirement: include this spoken line in the clip first");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="clip-studio-wording-requirement"/);
  });

  it("renders numeric In and Out fields with accessible 0.1-second nudges", () => {
    const markup = renderToStaticMarkup(<ClipStudioTimeline {...panelProps} />);

    expect(markup).toContain("In (seconds)");
    expect(markup).toContain("Out (seconds)");
    expect(markup).toContain('id="clip-studio-timeline-in-seconds"');
    expect(markup).toContain('id="clip-studio-timeline-out-seconds"');
    expect(markup).toContain('aria-label="Move In point earlier by 0.1 seconds"');
    expect(markup).toContain('aria-label="Move Out point later by 0.1 seconds"');
    expect(markup).toContain('aria-label="Extend clip 5 seconds earlier"');
    expect(markup).toContain('aria-label="Extend clip 5 seconds later"');
    expect(markup).toContain("Drag either white Clip range edge to include more of the original sermon.");
    expect(markup).toContain("Up to 90 seconds of nearby context is loaded on each side.");
    expect(markup).toContain("Clip start handle. Drag left to include earlier sermon context.");
    expect(markup).toContain("Clip end handle. Drag right to include later sermon context.");

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

  it("renders one aligned playhead across spoken, caption, hook, B-roll, pacing, and clip rows", () => {
    previewState.editPreview.hookOverlay = {
      ...previewState.editPreview.hookOverlay,
      enabled: true,
      text: "Do not stop running",
      startSeconds: 1,
    };
    previewState.editPreview.brollLayer = {
      enabled: true,
      cards: [{
        id: "quote-card",
        enabled: true,
        text: "Run the race set before you",
        label: "Key quote",
        startSeconds: 8,
        durationSeconds: 4,
        tone: "quote" as const,
        position: "full" as const,
      }],
    };
    previewState.isDraftDirty = true;

    const markup = renderToStaticMarkup(<ClipStudioTimeline {...panelProps} />);

    expect(markup).toContain('aria-label="Shared editing timeline"');
    expect(markup).toContain("Captions");
    expect(markup).toContain("Hook");
    expect(markup).toContain("B-roll");
    expect(markup).toContain("Pacing");
    expect(markup).toContain("Clip range");
    expect(markup).toContain("Spoken");
    expect(markup.match(/clip-studio-shared-playhead/g)).toHaveLength(1);
    expect(markup).not.toContain("clip-studio-transcript-playhead");
    expect(markup).not.toContain("clip-studio-timeline-playhead");
    expect(markup).not.toContain("Unsaved timeline draft");
    expect(markup).toContain("Timing stays draft-only until saved.");
    expect(markup).toContain("Drag the purple hook to move it");
    expect(markup).toContain("Drag the yellow cutaway to move it");
    expect(markup).toContain('data-hook-overlay="true"');
    expect(markup).toContain("drag either edge to resize it");
    expect(markup).toContain("Starts (seconds)");
    expect(markup).toContain("Duration (seconds)");
    expect(markup).toContain("0.5s earlier");
    expect(markup).toContain("Preview hook");
    expect(markup).toContain("Preview here");

    previewState.editPreview.hookOverlay = {
      ...previewState.editPreview.hookOverlay,
      enabled: false,
      text: "",
      startSeconds: 0,
    };
    previewState.editPreview.brollLayer = { enabled: false, cards: [] };
    previewState.isDraftDirty = false;
  });

  it("exposes direct pacing-cut resizing, moving, creation, and exact accessible controls", () => {
    previewState.editPreview.speechCleanupEdits = {
      version: 1 as const,
      cuts: [{
        id: "manual-pause",
        enabled: true,
        startSeconds: 8,
        endSeconds: 9.2,
        removedSeconds: 1.2,
        kind: "internal" as const,
        source: "audio" as const,
        confidence: "confirmed" as const,
        rawGapSeconds: 1.2,
        beforeText: "Grace meets us here",
        afterText: "and carries us forward",
      }],
    };

    const markup = renderToStaticMarkup(<ClipStudioTimeline {...panelProps} />);

    expect(markup).toContain("Add cut at playhead");
    expect(markup).toContain("Drag a pacing block to move it");
    expect(markup).toContain('data-cleanup-cut-id="manual-pause"');
    expect(markup).toContain("Drag the block to move it or drag either edge to change its length.");
    expect(markup).toContain("clip-studio-timeline-cut-resize is-start");
    expect(markup).toContain("clip-studio-timeline-cut-resize is-end");
    expect(markup).toContain("Review pauses (1)");
    expect(markup).toContain("Use Review pauses for exact controls.");

    previewState.editPreview.speechCleanupEdits = null;
  });

  it("maps pointer positions and B-roll drags to bounded, precise timeline seconds", () => {
    expect(__clipStudioTranscriptPanelTestUtils.resolveTimelinePointerSeconds({
      clientX: 300,
      trackLeft: 100,
      trackWidth: 400,
      timelineStart: 10,
      timelineDuration: 40,
    })).toBe(30);
    expect(__clipStudioTranscriptPanelTestUtils.resolveTimelinePointerSeconds({
      clientX: 50,
      trackLeft: 100,
      trackWidth: 400,
      timelineStart: 10,
      timelineDuration: 40,
    })).toBe(10);
    expect(__clipStudioTranscriptPanelTestUtils.resolveTimelinePointerSeconds({
      clientX: 100,
      trackLeft: 100,
      trackWidth: 0,
      timelineStart: 10,
      timelineDuration: 40,
    })).toBeNull();

    expect(__clipStudioTranscriptPanelTestUtils.resolveBrollCardStartSeconds({
      originStartSeconds: 4,
      deltaPixels: 40,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      cardDurationSeconds: 5,
    })).toBe(10);
    expect(__clipStudioTranscriptPanelTestUtils.resolveBrollCardStartSeconds({
      originStartSeconds: 24,
      deltaPixels: 100,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      cardDurationSeconds: 5,
    })).toBe(25);
    expect(__clipStudioTranscriptPanelTestUtils.resolveBrollCardStartSeconds({
      originStartSeconds: 2,
      deltaPixels: -100,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      cardDurationSeconds: 5,
    })).toBe(0);

    expect(__clipStudioTranscriptPanelTestUtils.resolveVisualLayerTimingDrag({
      mode: "move",
      originStartSeconds: 4,
      originDurationSeconds: 5,
      deltaPixels: 40,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      maximumDurationSeconds: 12,
    })).toEqual({ startSeconds: 10, durationSeconds: 5 });
    expect(__clipStudioTranscriptPanelTestUtils.resolveVisualLayerTimingDrag({
      mode: "end",
      originStartSeconds: 4,
      originDurationSeconds: 5,
      deltaPixels: 40,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      maximumDurationSeconds: 12,
    })).toEqual({ startSeconds: 4, durationSeconds: 11 });
    expect(__clipStudioTranscriptPanelTestUtils.resolveVisualLayerTimingDrag({
      mode: "start",
      originStartSeconds: 4,
      originDurationSeconds: 5,
      deltaPixels: -40,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      maximumDurationSeconds: 12,
    })).toEqual({ startSeconds: 0, durationSeconds: 9 });
    expect(__clipStudioTranscriptPanelTestUtils.resolveVisualLayerTimingDrag({
      mode: "end",
      originStartSeconds: 24,
      originDurationSeconds: 5,
      deltaPixels: 100,
      trackWidth: 200,
      timelineDuration: 30,
      clipDurationSeconds: 30,
      maximumDurationSeconds: 12,
    })).toEqual({ startSeconds: 24, durationSeconds: 6 });
  });

  it("previews hook and B-roll markers at their exact start and selects a B-roll card", () => {
    const seekToAbsolute = vi.fn();
    const requestPreviewPlayback = vi.fn();
    const setSelectedBrollCardId = vi.fn();

    __clipStudioTranscriptPanelTestUtils.previewTimelineLayerSegment({
      segment: { startSeconds: 18.25, cardId: "quote-card" },
      setSelectedBrollCardId,
      seekToAbsolute,
      requestPreviewPlayback,
    });

    expect(setSelectedBrollCardId).toHaveBeenCalledWith("quote-card");
    expect(seekToAbsolute).toHaveBeenCalledWith(18.25);
    expect(requestPreviewPlayback).toHaveBeenCalledOnce();
  });

  it("describes deleting a cleanup edit as removing its marker", () => {
    expect(__clipStudioTranscriptPanelTestUtils.removeCleanupMarkerAriaLabel(0)).toBe("Remove cleanup marker 1");
  });
});
