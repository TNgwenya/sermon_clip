import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewContext = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewContext.current,
}));

import { ClipStudioEditor } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-editor";
import { resolveCaptionStylePreset } from "@/lib/captionStylePresets";

describe("ClipStudioEditor caption selection workflow", () => {
  beforeEach(() => {
    previewContext.current = {
      isDraftDirty: false,
      previewClock: {
        currentSeconds: 0,
        sourceCurrentSeconds: 0,
        durationSeconds: 45,
        isPlaying: false,
      },
      requestPreviewPlayback: vi.fn(),
      seekPreviewTo: vi.fn(),
      seekSourcePreviewTo: vi.fn(),
      updateEditPreview: vi.fn(),
    };
  });

  it("explains the safe distinction between caption, boundary, and spoken-video actions", () => {
    const captionDesign = resolveCaptionStylePreset("clean-lower").design;
    const markup = renderToStaticMarkup(
      <ClipStudioEditor
        initialStartTimeSeconds={100}
        initialEndTimeSeconds={145}
        initialTitle="Run your race"
        initialEditorialHook=""
        initialMainCaption=""
        initialShortCaption=""
        initialPlatformCaption=""
        initialHashtags={[]}
        initialCaptionCues={[
          { index: 1, startSeconds: 0, endSeconds: 1, text: "Run" },
          { index: 2, startSeconds: 1, endSeconds: 2, text: "your race" },
        ]}
        initialApplyCaptionsToClip
        initialCaptionStylePresetId="clean-lower"
        initialCaptionPosition="lower"
        initialCaptionAppearance={{
          fontScale: "regular",
          maxLines: 2,
          uppercase: false,
          verticalOffset: 0,
        }}
        initialCaptionDesign={captionDesign}
        initialCaptionRevealMode="single-word"
        initialCaptionSyncOffsetSeconds={0}
        brandCaptionStylePresetId="clean-lower"
        suggestedHook=""
        suggestedCaption=""
        titleOptions={[]}
        hookOptions={[]}
        ctaOptions={[]}
        initialHookOverlay={{
          enabled: false,
          text: "",
          position: "top",
          startSeconds: 0,
          durationSeconds: 6,
          animation: "fade",
          size: "medium",
          bold: true,
        }}
        initialBrollLayer={{ enabled: false, cards: [] }}
        initialBrollSuggestions={[]}
        initialSpeechCleanup={{
          removeDeadAir: false,
          tightenLongPauses: false,
          flagFillerWords: false,
          intensity: "normal",
        }}
        initialSpeechCleanupEdits={null}
        initialAudioSilenceEvents={[]}
        initialAudioSilenceAnalyzed={false}
        audioSilenceReviewUrl={null}
        transcriptSegments={[{
          id: "segment-1",
          startTimeSeconds: 100,
          endTimeSeconds: 102,
          text: "Run your race",
        }]}
        knownDurationSeconds={300}
        captionQualityScore={null}
        captionQualityReason={null}
        captionWarnings={[]}
        translationUncertainty={null}
        captionImprovementSuggestions={[]}
      />,
    );

    expect(markup).toContain("Select caption words");
    expect(markup).toContain("Click, then Shift-click to select a range. Changes affect captions only.");
    expect(markup).toContain("Select a caption item to preview it, correct visible wording");
    expect(markup).toContain("set clip boundaries");
    expect(markup).toContain("confirmed video cut");
    expect(markup).toContain('aria-pressed="false"');
  });
});
