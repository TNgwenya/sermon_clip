import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewContext = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewContext.current,
}));

import {
  ClipStudioLivePreview,
  resolveClipStudioPreviewSource,
} from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-live-preview";

describe("ClipStudioLivePreview media loading", () => {
  beforeEach(() => {
    previewContext.current = {
      exportSettings: {
        platformPreset: "INSTAGRAM_REELS",
        primaryFormat: "VERTICAL_9_16",
        selectedFormats: ["VERTICAL_9_16"],
        framingMode: "FIT_BLURRED_BACKGROUND",
        framingPersonality: "SAFE_FULL_STAGE",
        backgroundMode: "BLURRED",
        manualCropKeyframes: [],
      },
      brandingConfig: {
        enabled: false,
        preset: "NO_BRANDING",
        showChurchName: true,
        showSermonTitle: true,
        showPreacherName: true,
        watermarkEnabled: false,
        lowerThirdEnabled: false,
        introEnabled: false,
        outroEnabled: false,
        backgroundStyle: "NONE",
        themeColor: null,
      },
      editPreview: {
        startLabel: "00:00",
        endLabel: "00:45",
        durationLabel: "45 sec",
        startSeconds: 0,
        endSeconds: 45,
        durationSeconds: 45,
        title: "Clip",
        editorialHook: "",
        mainCaption: "",
        shortCaption: "",
        platformCaption: "",
        onVideoCaptionText: "",
        captionCues: [],
        applyCaptionsToClip: false,
        captionStylePresetId: "clean-lower",
        captionStyleSource: "clip",
        captionPosition: "lower",
        captionAppearance: {
          fontScale: "regular",
          maxLines: 2,
          uppercase: false,
          verticalOffset: 0,
        },
        captionRevealMode: "phrase",
        captionSyncOffsetSeconds: 0,
        hookOverlay: {
          enabled: false,
          text: "",
          position: "top",
          startSeconds: 0,
          durationSeconds: 6,
          animation: "fade",
          size: "medium",
          bold: true,
        },
        brollLayer: { enabled: false, cards: [] },
        speechCleanup: {
          removeDeadAir: false,
          tightenLongPauses: false,
          flagFillerWords: false,
          intensity: "normal",
        },
        speechCleanupEdits: null,
        audioSilenceEvents: [],
        audioSilenceAnalyzed: false,
        hashtags: "",
        isTimingValid: true,
      },
      seekRequest: null,
      playbackRequest: null,
      seekPreviewTo: vi.fn(),
      churchName: "Church",
      sermonTitle: "Sermon",
      preacherName: "Pastor",
      logoSrc: null,
      updatePreviewClock: vi.fn(),
    };
  });

  it("uses one eager inline video and a static backdrop without a default retry cache-buster", () => {
    const markup = renderToStaticMarkup(
      <ClipStudioLivePreview
        hasPreview
        previewSrc="https://media.example.com/clip.mp4?v=2"
        sourcePreviewSrc={null}
        renderLabel="Ready"
        renderTone="success"
        durationLabel="45 sec"
        timingLabel="00:00 - 00:45"
        riskLabel="LOW risk"
        riskClassName="risk-low"
      />,
    );

    expect(markup.match(/<video/g)).toHaveLength(1);
    expect(markup).toContain('preload="auto"');
    expect(markup).toContain('playsInline=""');
    expect(markup).toContain('src="https://media.example.com/clip.mp4?v=2"');
    expect(markup).not.toContain("retry=0");
    expect(markup).toContain('class="clip-studio-live-backdrop"');
  });

  it("falls back to the prepared clip after the sermon source is unavailable", () => {
    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      unavailableSourcePreviewSrc: null,
    })).toMatchObject({
      activePreviewSrc: "/api/sermons/sermon-1/source-preview",
      hasSourcePreview: true,
    });

    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      unavailableSourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
    })).toEqual({
      activePreviewSrc: "/api/clips/clip-1/preview",
      canPreview: true,
      hasSourcePreview: false,
    });
  });
});
