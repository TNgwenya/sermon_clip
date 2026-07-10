import { describe, expect, it } from "vitest";

import {
  canChooseClipForProduction,
  resolveClipStudioAssetInvalidation,
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

  it("still invalidates the correct visual asset when subtitle cues change", () => {
    expect(resolveClipStudioAssetInvalidation({
      boundariesChanged: false,
      speechCleanupChanged: false,
      onVideoCaptionChanged: true,
      visualOverlayChanged: false,
    })).toBe("ON_VIDEO_CAPTIONS");
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
