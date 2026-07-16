import { describe, expect, it } from "vitest";

import {
  buildPastorProcessingFailurePresentation,
  pastorFriendlyError,
  summarizeTranscriptFailureDiagnostics,
} from "@/lib/pastorFriendlyErrors";

describe("pastorFriendlyError", () => {
  it("summarizes FFmpeg drawtext failures without exposing the full command output", () => {
    expect(pastorFriendlyError("FFmpeg export failed. No such filter: 'drawtext'")).toContain("missing the text overlay filter");
  });

  it("summarizes missing media failures", () => {
    expect(pastorFriendlyError("Rendered clip file does not exist.")).toContain("could not find the video file");
  });

  it("explains the clip-volume safety gate with the actual floor and target", () => {
    const presentation = buildPastorProcessingFailurePresentation({
      message: [
        "Pipeline stopped at Generate clip suggestions:",
        "Clip generation produced 12 pastor-review option(s), below the 20-32 target minimum of 20 for this transcript.",
        "The job was stopped before replacing/saving the low-count result.",
      ].join(" "),
      transcriptDiagnostics: {
        wordCount: 1_908,
        segmentCount: 271,
        timelineDurationSeconds: 3_329,
        coveredSeconds: 982,
        coveragePercent: 29.5,
        largeGapCount: 6,
        maxGapSeconds: 950.5,
      },
    });

    expect(presentation.kind).toBe("CLIP_QUALITY_GATE");
    expect(presentation.summary).toContain("found 12 distinct review moments");
    expect(presentation.summary).toContain("at least 14");
    expect(presentation.summary).toContain("20\u201332");
    expect(presentation.guidance).toContain("about 30%");
    expect(presentation.guidance).toContain("6 gaps");
    expect(presentation.guidance).toContain("15m 51s");
    expect(presentation.retryAfterTranscriptRefresh).toBe(true);
    expect(presentation.metrics).toEqual(expect.arrayContaining([
      { label: "Distinct moments found", value: "12" },
      { label: "Safety floor", value: "14" },
      { label: "Normal target", value: "20\u201332" },
      { label: "Transcript coverage", value: "30%" },
    ]));
  });

  it("recommends clip discovery after the transcript has been refreshed", () => {
    const presentation = buildPastorProcessingFailurePresentation({
      message: "Clip generation produced 12 pastor-review option(s), below the 20-32 target minimum of 20 for this transcript.",
      transcriptRefreshedAfterFailure: true,
    });

    expect(presentation.title).toContain("ready for another clip check");
    expect(presentation.guidance).toContain("Retry clip discovery now");
  });

  it("recognizes the structured quality-gate wording used by new jobs", () => {
    const presentation = buildPastorProcessingFailurePresentation({
      message: "Clip generation produced 12 pastor-review option(s), below the acceptance floor of 14 for the 20-32 duration target (target minimum 20).",
    });

    expect(presentation.kind).toBe("CLIP_QUALITY_GATE");
    expect(presentation.metrics).toEqual(expect.arrayContaining([
      { label: "Distinct moments found", value: "12" },
      { label: "Safety floor", value: "14" },
      { label: "Normal target", value: "20\u201332" },
    ]));
  });

  it("calculates transcript coverage and large gaps from timestamped segments", () => {
    const diagnostics = summarizeTranscriptFailureDiagnostics([
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Faith grows when we trust God together." },
      { startTimeSeconds: 20, endTimeSeconds: 30, text: "A second complete sermon statement." },
      { startTimeSeconds: 100, endTimeSeconds: 110, text: "A final statement after a long gap." },
    ]);

    expect(diagnostics).toMatchObject({
      wordCount: 19,
      segmentCount: 3,
      timelineDurationSeconds: 110,
      coveredSeconds: 30,
      coveragePercent: 27.3,
      largeGapCount: 1,
      maxGapSeconds: 70,
    });
  });

  it("keeps unrelated failures on the generic recovery path", () => {
    const presentation = buildPastorProcessingFailurePresentation({
      message: "OpenAI request timed out.",
    });

    expect(presentation.kind).toBe("GENERIC");
    expect(presentation.retryAfterTranscriptRefresh).toBe(false);
  });
});
