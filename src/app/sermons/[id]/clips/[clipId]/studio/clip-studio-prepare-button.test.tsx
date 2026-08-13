import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const previewState = vi.hoisted(() => ({
  editPreview: {
    isTimingValid: true,
    startSeconds: 10,
    endSeconds: 40,
    title: "Grace for today",
    editorialHook: "",
    mainCaption: "Grace meets us here.",
    shortCaption: "",
    platformCaption: "",
    onVideoCaptionText: "",
    hashtags: [],
    captionCues: [],
    applyCaptionsToClip: true,
    captionStylePresetId: "clean-lower",
    captionStyleSource: "clip" as const,
    captionPosition: "lower" as const,
    captionAppearance: {
      fontScale: "regular" as const,
      maxLines: 2,
      uppercase: false,
      verticalOffset: 0,
    },
    captionDesign: null,
    captionRevealMode: "phrase" as const,
    captionSyncOffsetSeconds: 0,
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
    brollLayer: { enabled: false, cards: [] },
    speechCleanup: {
      removeDeadAir: false,
      tightenLongPauses: false,
      flagFillerWords: false,
      intensity: "normal" as const,
    },
    speechCleanupEdits: null,
  },
  exportSettings: {
    platformPreset: "INSTAGRAM_REELS" as const,
    primaryFormat: "VERTICAL_9_16" as const,
    selectedFormats: ["VERTICAL_9_16" as const],
    framingMode: "SMART_CROP" as const,
    framingPersonality: "AUTO_INTELLIGENT" as const,
    backgroundMode: "CROP" as const,
    manualCropKeyframes: [],
  },
  brandingConfig: {
    enabled: false,
    preset: "NO_BRANDING" as const,
  },
  isDraftDirty: false,
  draftCompositionKey: "draft-1",
  markDraftSaved: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/server/actions/sermons", () => ({
  prepareClipStudioForPostingAction: vi.fn(),
  saveClipStudioDraftAction: vi.fn(),
}));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewState,
}));

import { ClipStudioPrepareButton } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-prepare-button";

describe("ClipStudioPrepareButton", () => {
  it("gives the compact checklist one unambiguous accessible name", () => {
    const markup = renderToStaticMarkup(
      <ClipStudioPrepareButton
        clipId="clip-1"
        clipStatus="APPROVED"
        hasPreparedMedia={false}
        serverNeedsUpdate={false}
      />,
    );

    expect(markup).toContain('<summary aria-label="Final video checklist">');
    expect(markup).not.toContain("Final video checklistChecklist");
  });
});
