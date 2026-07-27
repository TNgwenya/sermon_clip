import { describe, expect, it } from "vitest";

import {
  canChooseClipForProduction,
  resolveClipStudioAssetInvalidation,
  resolveClipStudioBoundaryReviewUpdate,
  resolveClipStudioChangeScope,
  resolveClipStudioCompositionReset,
  resolveClipStudioContentValues,
  shouldRecordExplicitTranscriptReview,
} from "@/lib/clipContentPersistence";

describe("clip content persistence", () => {
  it("keeps social post copy independent from on-video transcript captions", () => {
    const values = resolveClipStudioContentValues({
      title: "Courage Before Certainty",
      mainCaption: "A grounded invitation to choose courage this week.",
      editorialHook: "Courage begins before certainty arrives.",
      existingTitle: "Original title",
      existingEditorialHook: "Original spoken opening",
    });

    expect(values.socialCaption).toBe("A grounded invitation to choose courage this week.");
    expect(values.title).toBe("Courage Before Certainty");
    expect(values.editorialHook).toBe("Courage begins before certainty arrives.");
  });

  it("does not invalidate prepared video when only post copy changes", () => {
    expect(resolveClipStudioAssetInvalidation({
      boundariesChanged: false,
      speechCleanupChanged: false,
      onVideoCaptionChanged: false,
      visualOverlayChanged: false,
    })).toBe("NONE");
  });

  it("keeps post guidance changes outside the media composition", () => {
    expect(resolveClipStudioChangeScope({
      boundariesChanged: false,
      speechCleanupChanged: false,
      onVideoCaptionChanged: false,
      visualHookChanged: false,
      brollLayerChanged: false,
      socialCopyChanged: true,
      hashtagChanged: true,
      editorialHookChanged: true,
    })).toEqual({
      mediaCompositionChanged: false,
      postGuidanceChanged: true,
      studioEditsChanged: true,
    });
  });

  it("classifies on-video and timing edits as media composition changes", () => {
    expect(resolveClipStudioChangeScope({
      boundariesChanged: false,
      speechCleanupChanged: false,
      onVideoCaptionChanged: true,
      visualHookChanged: false,
      brollLayerChanged: false,
      socialCopyChanged: false,
      hashtagChanged: false,
      editorialHookChanged: false,
    })).toEqual({
      mediaCompositionChanged: true,
      postGuidanceChanged: false,
      studioEditsChanged: true,
    });
  });

  it("still invalidates the correct visual asset when subtitle cues change", () => {
    expect(resolveClipStudioAssetInvalidation({
      boundariesChanged: false,
      speechCleanupChanged: false,
      onVideoCaptionChanged: true,
      visualOverlayChanged: false,
    })).toBe("ON_VIDEO_CAPTIONS");
  });

  it("fails closed in the Studio save that changes on-video captions", () => {
    expect(resolveClipStudioCompositionReset({
      invalidation: "ON_VIDEO_CAPTIONS",
      captionsEnabled: true,
    })).toMatchObject({
      captionBurnStatus: "NOT_BURNED",
      captionedVideoPath: null,
      captionBurnFreshness: "NEEDS_REGENERATION",
      overlayStatus: "NOT_RENDERED",
      overlayVideoPath: null,
      exportStatus: "NOT_EXPORTED",
      exportedFilePath: null,
      exportFreshness: "NEEDS_REGENERATION",
    });
  });

  it("keeps disabled captions skipped while invalidating the final composition", () => {
    expect(resolveClipStudioCompositionReset({
      invalidation: "ON_VIDEO_CAPTIONS",
      captionsEnabled: false,
    })).toMatchObject({
      captionBurnStatus: "NOT_BURNED",
      captionBurnFreshness: "UP_TO_DATE",
      overlayStatus: "NOT_RENDERED",
      exportStatus: "NOT_EXPORTED",
      exportFreshness: "NEEDS_REGENERATION",
    });
  });

  it("resets the base render and every dependent stage for boundary edits", () => {
    expect(resolveClipStudioCompositionReset({
      invalidation: "BOUNDARIES",
      captionsEnabled: true,
    })).toMatchObject({
      renderStatus: "NOT_RENDERED",
      renderedFilePath: null,
      renderFreshness: "NEEDS_REGENERATION",
      captionBurnStatus: "NOT_BURNED",
      overlayStatus: "NOT_RENDERED",
      exportStatus: "NOT_EXPORTED",
    });
  });

  it("invalidates only the canonical export for output-selection changes", () => {
    expect(resolveClipStudioCompositionReset({
      invalidation: "EXPORT_SETTINGS",
      captionsEnabled: true,
    })).toEqual({
      exportStatus: "NOT_EXPORTED",
      exportedFilePath: null,
      exportPath: null,
      exportedAt: null,
      exportError: null,
      exportFreshness: "NEEDS_REGENERATION",
    });
  });

  it("does not downgrade boundary quality when only copy or styling changes", () => {
    expect(resolveClipStudioBoundaryReviewUpdate({
      boundariesChanged: false,
      startSeconds: 120,
      endSeconds: 180,
    })).toEqual({});
  });

  it("marks changed boundaries for review with the revised range", () => {
    expect(resolveClipStudioBoundaryReviewUpdate({
      boundariesChanged: true,
      startSeconds: 120.125,
      endSeconds: 180.875,
    })).toEqual({
      boundaryQuality: "NEEDS_REVIEW",
      boundaryAdjustmentReason: "Clip boundaries were manually edited to 120.13-180.88s. Re-review recommended.",
    });
  });

  it("does not let single or batch decisions bypass transcript review", () => {
    expect(canChooseClipForProduction("REVIEW_REQUIRED")).toBe(false);
    expect(canChooseClipForProduction("REVIEWED")).toBe(true);
    expect(canChooseClipForProduction("TRUSTED")).toBe(true);
  });

  it("does not infer human transcript review from saved caption cues", () => {
    expect(shouldRecordExplicitTranscriptReview({
      transcriptSafetyStatus: "REVIEW_REQUIRED",
      explicitlyConfirmed: false,
    })).toBe(false);
    expect(shouldRecordExplicitTranscriptReview({
      transcriptSafetyStatus: "REVIEW_REQUIRED",
      explicitlyConfirmed: true,
    })).toBe(true);
    expect(shouldRecordExplicitTranscriptReview({
      transcriptSafetyStatus: "TRUSTED",
      explicitlyConfirmed: true,
    })).toBe(false);
  });
});
