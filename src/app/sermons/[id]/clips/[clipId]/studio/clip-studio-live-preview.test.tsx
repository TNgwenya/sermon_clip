import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewContext = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context", () => ({
  useClipStudioPreview: () => previewContext.current,
}));

import {
  ClipStudioLivePreview,
  clipStudioPreviewMediaCoversDraft,
  clipStudioPreviewNeedsSourceMedia,
  resolveCanonicalFramingPreviewFrame,
  resolveClipStudioFramingPreview,
  resolveClipStudioPreviewSource,
} from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-live-preview";
import { buildResolvedFramingPlanDocument } from "@/lib/resolvedFramingPlan";

function buildPreviewPlan(input?: {
  requestedLayout?: "SMART_CROP" | "CENTER_CROP" | "FIT_BLURRED_BACKGROUND";
  requestedPersonality?: "AUTO_INTELLIGENT" | "SPEAKER_FOCUS" | "WORSHIP_WIDE" | "SAFE_FULL_STAGE";
  tracking?: boolean;
  preparedPortrait?: boolean;
}) {
  return buildResolvedFramingPlanDocument({
    clipCandidateId: "clip-1",
    editPlanId: "plan-1",
    editPlanHash: "hash-1",
    requestedLayout: input?.requestedLayout ?? "SMART_CROP",
    requestedPersonality: input?.requestedPersonality ?? "SPEAKER_FOCUS",
    sourceGeometry: {
      width: input?.preparedPortrait ? 1080 : 1920,
      height: input?.preparedPortrait ? 1920 : 1080,
      role: input?.preparedPortrait ? "CANONICAL_PORTRAIT_MASTER" : "ORIGINAL_SOURCE",
    },
    trackingSource: input?.tracking === false ? null : "MODEL",
    trackingPoints: input?.tracking === false
      ? []
      : [
          {
            timeSeconds: 0,
            centerX: 0.2,
            centerY: 0.65,
            zoom: 1.08,
            confidence: 0.98,
            sceneId: "scene-1",
          },
          {
            timeSeconds: 10,
            centerX: 0.8,
            centerY: 0.3,
            zoom: 1.16,
            confidence: 0.98,
            sceneId: "scene-1",
          },
        ],
    moment: {
      title: "Teaching",
      durationSeconds: 10,
    },
  });
}

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

  it("uses one eager prepared video even when precise source media is available", () => {
    const markup = renderToStaticMarkup(
      <ClipStudioLivePreview
        hasPreview
        previewSrc="https://media.example.com/clip.mp4?v=2"
        sourcePreviewSrc="/api/sermons/sermon-1/source-preview"
        renderLabel="Ready"
        renderTone="success"
        durationLabel="45 sec"
        timingLabel="00:00 - 00:45"
        riskLabel="LOW risk"
        riskClassName="risk-low"
        resolvedFramingPlan={null}
      />,
    );

    expect(markup.match(/<video/g)).toHaveLength(1);
    expect(markup).toContain('preload="auto"');
    expect(markup).toContain('playsInline=""');
    expect(markup).toContain('src="https://media.example.com/clip.mp4?v=2"');
    expect(markup).not.toContain('src="/api/sermons/sermon-1/source-preview"');
    expect(markup).not.toContain("retry=0");
    expect(markup).not.toContain("clip-studio-live-backdrop");
    expect(markup).toContain("Framing pending");
    expect(markup).not.toContain("trackedTreatment");
  });

  it("renders a real synchronized duplicate video layer only for matching true blur", () => {
    previewContext.current = {
      ...previewContext.current,
      seekRequest: {
        seconds: 12,
        timeDomain: "source",
        nonce: 1,
      },
      exportSettings: {
        ...(previewContext.current.exportSettings as Record<string, unknown>),
        framingMode: "FIT_BLURRED_BACKGROUND",
        framingPersonality: "AUTO_INTELLIGENT",
      },
    };
    const blurredPlan = buildPreviewPlan({
      requestedLayout: "FIT_BLURRED_BACKGROUND",
      requestedPersonality: "AUTO_INTELLIGENT",
    });
    const markup = renderToStaticMarkup(
      <ClipStudioLivePreview
        hasPreview
        previewSrc="https://media.example.com/clip.mp4?v=2"
        sourcePreviewSrc="/api/sermons/sermon-1/source-preview"
        renderLabel="Ready"
        renderTone="success"
        durationLabel="45 sec"
        timingLabel="00:00 - 00:45"
        riskLabel="LOW risk"
        riskClassName="risk-low"
        resolvedFramingPlan={blurredPlan}
      />,
    );

    expect(markup.match(/<video/g)).toHaveLength(2);
    expect(markup).toContain("clip-studio-live-backdrop");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('src="/api/sermons/sermon-1/source-preview"');
    expect(markup).toContain("Framing READY");
    expect(markup).toContain(blurredPlan.resolution.summary);
  });

  it("treats the prepared compact preview as already framed and never applies the plan twice", () => {
    previewContext.current = {
      ...previewContext.current,
      exportSettings: {
        ...(previewContext.current.exportSettings as Record<string, unknown>),
        framingMode: "FIT_BLURRED_BACKGROUND",
        framingPersonality: "AUTO_INTELLIGENT",
      },
    };
    const blurredPlan = buildPreviewPlan({
      requestedLayout: "FIT_BLURRED_BACKGROUND",
      requestedPersonality: "AUTO_INTELLIGENT",
    });
    const markup = renderToStaticMarkup(
      <ClipStudioLivePreview
        hasPreview
        previewSrc="https://media.example.com/prepared-vertical.mp4"
        sourcePreviewSrc="/api/sermons/sermon-1/source-preview"
        renderLabel="Ready"
        renderTone="success"
        durationLabel="45 sec"
        timingLabel="00:00 - 00:45"
        riskLabel="LOW risk"
        riskClassName="risk-low"
        resolvedFramingPlan={blurredPlan}
      />,
    );

    expect(markup.match(/<video/g)).toHaveLength(1);
    expect(markup).toContain('src="https://media.example.com/prepared-vertical.mp4"');
    expect(markup).not.toContain("clip-studio-live-backdrop");
    expect(markup).toContain("passthroughTreatment");
    expect(markup).toContain("already applied to this prepared preview");
    expect(markup).toContain("Framing READY");
  });

  it("refuses to consume a saved plan when the current Studio choice changed", () => {
    const stalePlan = buildPreviewPlan({
      requestedLayout: "CENTER_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
    });
    const stale = resolveClipStudioFramingPreview({
      plan: stalePlan,
      framingMode: "SMART_CROP",
      framingPersonality: "SPEAKER_FOCUS",
      hasManualCrop: false,
    });

    expect(stale).toMatchObject({
      state: "STALE",
      statusLabel: "Framing stale",
      canConsumePlan: false,
      layout: null,
      treatment: null,
    });

    previewContext.current = {
      ...previewContext.current,
      exportSettings: {
        ...(previewContext.current.exportSettings as Record<string, unknown>),
        framingMode: "SMART_CROP",
        framingPersonality: "SPEAKER_FOCUS",
      },
    };
    const markup = renderToStaticMarkup(
      <ClipStudioLivePreview
        hasPreview
        previewSrc="https://media.example.com/prepared.mp4"
        sourcePreviewSrc="/api/sermons/sermon-1/source-preview"
        renderLabel="Ready"
        renderTone="success"
        durationLabel="45 sec"
        timingLabel="00:00 - 00:45"
        riskLabel="LOW risk"
        riskClassName="risk-low"
        resolvedFramingPlan={stalePlan}
      />,
    );

    expect(markup).toContain("Framing stale");
    expect(markup).toContain("different Studio settings");
    expect(markup).toContain("unresolvedFraming");
    expect(markup).not.toContain("trackedTreatment");
  });

  it("keeps manual crop authoritative over a matching automatic plan", () => {
    const resolution = resolveClipStudioFramingPreview({
      plan: buildPreviewPlan(),
      framingMode: "SMART_CROP",
      framingPersonality: "SPEAKER_FOCUS",
      hasManualCrop: true,
    });

    expect(resolution).toMatchObject({
      state: "MANUAL",
      canConsumePlan: false,
      layout: null,
      treatment: null,
    });
    expect(resolution.message).toContain("override");
  });

  it("smoothly interpolates canonical X, Y, and zoom by source time", () => {
    const frame = resolveCanonicalFramingPreviewFrame([
      {
        timeSeconds: 0,
        centerX: 0.2,
        centerY: 0.7,
        zoom: 1.02,
        confidence: 0.98,
        sceneId: "scene-1",
        stabilized: true,
        rejected: false,
        frozen: false,
      },
      {
        timeSeconds: 10,
        centerX: 0.8,
        centerY: 0.3,
        zoom: 1.18,
        confidence: 0.98,
        sceneId: "scene-1",
        stabilized: true,
        rejected: false,
        frozen: false,
      },
    ], 5);

    expect(frame?.centerX).toBeCloseTo(0.5, 4);
    expect(frame?.centerY).toBeCloseTo(0.5, 4);
    expect(frame?.zoom).toBeCloseTo(1.1, 4);
  });

  it("reports the canonical missing-tracking fallback instead of simulating motion", () => {
    const fallbackPlan = buildPreviewPlan({ tracking: false });
    const resolution = resolveClipStudioFramingPreview({
      plan: fallbackPlan,
      framingMode: "SMART_CROP",
      framingPersonality: "SPEAKER_FOCUS",
      hasManualCrop: false,
    });

    expect(resolution.state).toBe("FALLBACK");
    expect(resolution.canConsumePlan).toBe(true);
    expect(resolution.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(resolution.treatment).toBe("BLURRED_BACKGROUND");
    expect(resolution.message).toContain("tracking was unavailable");
  });

  it("renders distinct canonical classes for Worship Wide, Full Stage, and Centre Crop", () => {
    const cases = [
      {
        plan: buildPreviewPlan({
          requestedLayout: "SMART_CROP",
          requestedPersonality: "WORSHIP_WIDE",
        }),
        framingMode: "SMART_CROP",
        framingPersonality: "WORSHIP_WIDE",
        className: "worshipWideTreatment",
      },
      {
        plan: buildPreviewPlan({
          requestedLayout: "SMART_CROP",
          requestedPersonality: "SAFE_FULL_STAGE",
        }),
        framingMode: "SMART_CROP",
        framingPersonality: "SAFE_FULL_STAGE",
        className: "fullStageTreatment",
      },
      {
        plan: buildPreviewPlan({
          requestedLayout: "CENTER_CROP",
          requestedPersonality: "AUTO_INTELLIGENT",
        }),
        framingMode: "CENTER_CROP",
        framingPersonality: "AUTO_INTELLIGENT",
        className: "centerCropTreatment",
      },
    ] as const;

    for (const previewCase of cases) {
      previewContext.current = {
        ...previewContext.current,
        seekRequest: {
          seconds: 5,
          timeDomain: "source",
          nonce: 1,
        },
        exportSettings: {
          ...(previewContext.current.exportSettings as Record<string, unknown>),
          framingMode: previewCase.framingMode,
          framingPersonality: previewCase.framingPersonality,
        },
      };
      const markup = renderToStaticMarkup(
        <ClipStudioLivePreview
          hasPreview
          previewSrc="https://media.example.com/clip.mp4"
          sourcePreviewSrc="/api/sermons/sermon-1/source-preview"
          renderLabel="Ready"
          renderTone="success"
          durationLabel="45 sec"
          timingLabel="00:00 - 00:45"
          riskLabel="LOW risk"
          riskClassName="risk-low"
          resolvedFramingPlan={previewCase.plan}
        />,
      );

      expect(markup).toContain(previewCase.className);
      expect(markup.match(/<video/g)).toHaveLength(1);
      expect(markup).toContain("Framing READY");
    }
  });

  it("surfaces PASSTHROUGH and does not apply a second crop", () => {
    const passthroughPlan = buildPreviewPlan({
      requestedLayout: "CENTER_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
      preparedPortrait: true,
    });
    const resolution = resolveClipStudioFramingPreview({
      plan: passthroughPlan,
      framingMode: "CENTER_CROP",
      framingPersonality: "AUTO_INTELLIGENT",
      hasManualCrop: false,
    });

    expect(resolution).toMatchObject({
      state: "PASSTHROUGH",
      statusLabel: "Framing PASSTHROUGH",
      canConsumePlan: true,
      treatment: "PASSTHROUGH",
    });
  });

  it("starts with the prepared clip and switches to source media only for precision work", () => {
    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      preferSourcePreview: false,
      unavailableSourcePreviewSrc: null,
      unavailablePreparedPreviewSrc: null,
    })).toMatchObject({
      activePreviewSrc: "/api/clips/clip-1/preview",
      hasSourcePreview: false,
    });

    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      preferSourcePreview: true,
      unavailableSourcePreviewSrc: null,
      unavailablePreparedPreviewSrc: null,
    })).toMatchObject({
      activePreviewSrc: "/api/sermons/sermon-1/source-preview",
      hasSourcePreview: true,
    });
  });

  it("blocks a shorter prepared fallback when precise source media is required", () => {
    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      preferSourcePreview: true,
      unavailableSourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      unavailablePreparedPreviewSrc: null,
    })).toEqual({
      activePreviewSrc: null,
      canPreview: false,
      hasSourcePreview: false,
    });

    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      preferSourcePreview: false,
      unavailableSourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      unavailablePreparedPreviewSrc: null,
    })).toEqual({
      activePreviewSrc: "/api/clips/clip-1/preview",
      canPreview: true,
      hasSourcePreview: false,
    });

    expect(resolveClipStudioPreviewSource({
      hasPreview: true,
      previewSrc: "/api/clips/clip-1/preview",
      sourcePreviewSrc: "/api/sermons/sermon-1/source-preview",
      preferSourcePreview: false,
      unavailableSourcePreviewSrc: null,
      unavailablePreparedPreviewSrc: "/api/clips/clip-1/preview",
    })).toEqual({
      activePreviewSrc: "/api/sermons/sermon-1/source-preview",
      canPreview: true,
      hasSourcePreview: true,
    });
  });

  it("rejects media that ends before the selected draft range", () => {
    expect(clipStudioPreviewMediaCoversDraft({
      mediaDurationSeconds: 60,
      draftDurationSeconds: 90,
      draftEndSeconds: 1634,
      hasSourcePreview: false,
    })).toBe(false);
    expect(clipStudioPreviewMediaCoversDraft({
      mediaDurationSeconds: 15112,
      draftDurationSeconds: 90,
      draftEndSeconds: 1634,
      hasSourcePreview: true,
    })).toBe(true);
    expect(clipStudioPreviewMediaCoversDraft({
      mediaDurationSeconds: Number.POSITIVE_INFINITY,
      draftDurationSeconds: 90,
      draftEndSeconds: 1634,
      hasSourcePreview: true,
    })).toBe(true);
  });

  it("requires source media for boundary changes and source-domain seeks", () => {
    const initialWindow = {
      initialStartSeconds: 90,
      initialEndSeconds: 135,
      currentStartSeconds: 90,
      currentEndSeconds: 135,
    };

    expect(clipStudioPreviewNeedsSourceMedia(initialWindow)).toBe(false);
    expect(clipStudioPreviewNeedsSourceMedia({
      ...initialWindow,
      currentStartSeconds: 89.5,
    })).toBe(true);
    expect(clipStudioPreviewNeedsSourceMedia({
      ...initialWindow,
      currentEndSeconds: 136,
    })).toBe(true);
    expect(clipStudioPreviewNeedsSourceMedia({
      ...initialWindow,
      seekTimeDomain: "source",
    })).toBe(true);
    expect(clipStudioPreviewNeedsSourceMedia({
      ...initialWindow,
      seekTimeDomain: "cleaned",
    })).toBe(false);
  });
});
