import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewContext = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewContext.current,
}));

import { ClipStudioEditor } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-editor";
import { resolveCaptionStylePreset } from "@/lib/captionStylePresets";

describe("ClipStudioEditor transcript-grounded highlight suggestions", () => {
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

  it("labels optional suggestions and exposes preview, edit, add, and ignore controls", () => {
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
        initialCaptionCues={[]}
        initialApplyCaptionsToClip={false}
        initialCaptionStylePresetId="clean-lower"
        initialCaptionPosition="lower"
        initialCaptionAppearance={{
          fontScale: "regular",
          maxLines: 2,
          uppercase: false,
          verticalOffset: 0,
        }}
        initialCaptionDesign={captionDesign}
        initialCaptionRevealMode="phrase"
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
        initialBrollSuggestions={[{
          id: "suggestion-quote-1",
          revisionKey: "revision-1",
          type: "quote",
          text: "You must run the race God has put before you.",
          label: "Key quote",
          startSeconds: 2,
          durationSeconds: 5,
          tone: "quote",
          position: "full",
          sourceLabel: "Spoken transcript · exact wording",
          sourceExcerpt: "You must run the race God has put before you.",
        }]}
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
          startTimeSeconds: 102,
          endTimeSeconds: 108,
          text: "You must run the race God has put before you.",
        }]}
        knownDurationSeconds={300}
        captionQualityScore={null}
        captionQualityReason={null}
        captionWarnings={[]}
        translationUncertainty={null}
        captionImprovementSuggestions={[]}
      />,
    );

    expect(markup).toContain("Transcript-grounded highlight cards");
    expect(markup).toContain("nothing is added or saved automatically");
    expect(markup).toContain("Spoken transcript · exact wording");
    expect(markup).toContain(">Preview<");
    expect(markup).toContain(">Edit<");
    expect(markup).toContain(">Add to draft<");
    expect(markup).toContain(">Ignore<");
    expect(markup).not.toContain("Cutaway 1");
  });
});
