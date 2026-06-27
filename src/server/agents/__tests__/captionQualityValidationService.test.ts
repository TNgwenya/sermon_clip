import { describe, expect, it } from "vitest";

import {
  parseCaptionDataCues,
  validateCaptionQuality,
} from "@/server/agents/captionQualityValidationService";

describe("caption quality validation", () => {
  it("warns when caption text is missing large parts of the transcript", () => {
    const result = validateCaptionQuality({
      clipStartTimeSeconds: 10,
      clipEndTimeSeconds: 50,
      transcriptText: "God has not forgotten you. He is still working even when you cannot see it.",
      captionText: "God remembers.",
    });

    expect(result.captionWarnings).toContain("MISSING_CAPTION_SEGMENTS");
    expect(result.captionQualityScore).toBeLessThan(7);
  });

  it("flags impossible timing and overly fast captions", () => {
    const result = validateCaptionQuality({
      clipStartTimeSeconds: 10,
      clipEndTimeSeconds: 50,
      transcriptText: "God has not forgotten you.",
      cues: [
        {
          startTimeSeconds: 9,
          endTimeSeconds: 9.1,
          text: "God has not forgotten you and he is still working in your life today.",
          lineCount: 3,
          safeZoneOk: false,
        },
      ],
    });

    expect(result.captionWarnings).toContain("CAPTION_TIMING_MISMATCH");
    expect(result.captionWarnings).toContain("CAPTIONS_TOO_FAST");
    expect(result.captionWarnings).toContain("CAPTIONS_TOO_LONG");
    expect(result.captionWarnings).toContain("CAPTIONS_OUT_OF_SAFE_ZONE");
  });

  it("parses existing captionData and validates metadata-based layout constraints", () => {
    const cues = parseCaptionDataCues({
      clipStartTimeSeconds: 100,
      captionData: {
        cues: [
          { startSeconds: 0, endSeconds: 2, text: "God has not forgotten you.", lineCount: 1 },
        ],
      },
    });
    const result = validateCaptionQuality({
      clipStartTimeSeconds: 100,
      clipEndTimeSeconds: 120,
      transcriptText: "God has not forgotten you.",
      cues: [
        {
          ...cues[0],
          box: { x: 0.01, y: 0.91, width: 0.98, height: 0.08 },
          fontSizePx: 28,
          contrastOk: false,
        },
      ],
      layout: {
        minFontSizePx: 38,
        maxLines: 2,
        contrastRatio: 2.2,
      },
    });

    expect(cues[0].startTimeSeconds).toBe(100);
    expect(result.captionWarnings).toContain("CAPTIONS_OUT_OF_SAFE_ZONE");
    expect(result.captionWarnings).toContain("CAPTIONS_TOO_LONG");
    expect(result.captionReason).toContain("metadata");
  });
});
