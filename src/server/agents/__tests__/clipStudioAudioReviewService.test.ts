import { describe, expect, it } from "vitest";

import { parseClipStudioSilenceDetectEvents } from "@/server/agents/clipStudioAudioReviewService";

describe("parseClipStudioSilenceDetectEvents", () => {
  it("parses ffmpeg silencedetect events relative to the clip window", () => {
    const events = parseClipStudioSilenceDetectEvents(
      [
        "[silencedetect @ 0x123] silence_start: 0.42",
        "[silencedetect @ 0x123] silence_end: 1.28 | silence_duration: 0.86",
        "[silencedetect @ 0x123] silence_start: 8.7",
        "[silencedetect @ 0x123] silence_end: 10.9 | silence_duration: 2.2",
      ].join("\n"),
      10,
    );

    expect(events).toEqual([
      { startSeconds: 0.42, endSeconds: 1.28, durationSeconds: 0.86 },
      { startSeconds: 8.7, endSeconds: 10, durationSeconds: 1.3 },
    ]);
  });
});
