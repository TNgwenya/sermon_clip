import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __captionServiceTestUtils } from "../captionService";

describe("caption service helpers", () => {
  it("builds cues from overlapping transcript segments", () => {
    const cues = __captionServiceTestUtils.buildCaptionCues(
      {
        id: "clip-1",
        startTimeSeconds: 30,
        endTimeSeconds: 60,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        durationSeconds: 30,
      },
      [
        {
          startTimeSeconds: 28,
          endTimeSeconds: 33,
          text: " Opening line ",
        },
        {
          startTimeSeconds: 35,
          endTimeSeconds: 42,
          text: "Main thought",
        },
      ],
    );

    expect(cues.map((cue) => cue.text)).toEqual(["Opening", "line", "Main", "thought"]);
    expect(cues[0]).toMatchObject({ index: 1, startSeconds: 0 });
    expect(cues[1]).toMatchObject({ index: 2, endSeconds: 3 });
    expect(cues[2]).toMatchObject({ index: 3, startSeconds: 5 });
    expect(cues[3]).toMatchObject({ index: 4, endSeconds: 12 });
  });

  it("uses adjusted clip boundaries when calculating caption timing", () => {
    const cues = __captionServiceTestUtils.buildCaptionCues(
      {
        id: "clip-1",
        startTimeSeconds: 30,
        endTimeSeconds: 60,
        adjustedStartTimeSeconds: 25,
        adjustedEndTimeSeconds: 75,
        durationSeconds: 30,
      },
      [
        {
          startTimeSeconds: 25,
          endTimeSeconds: 40,
          text: "Adjusted opening",
        },
        {
          startTimeSeconds: 68,
          endTimeSeconds: 75,
          text: "Adjusted ending",
        },
      ],
    );

    expect(cues.map((cue) => cue.text)).toEqual(["Adjusted", "opening", "Adjusted", "ending"]);
    expect(cues[0]).toMatchObject({ startSeconds: 0 });
    expect(cues[1]).toMatchObject({ endSeconds: 15 });
    expect(cues[2]).toMatchObject({ startSeconds: 43 });
    expect(cues[3]).toMatchObject({ endSeconds: 50 });
  });

  it("prefers persisted exact word timings over coarse transcript segments", () => {
    const result = __captionServiceTestUtils.buildCaptionCueSet(
      {
        id: "clip-1",
        startTimeSeconds: 30,
        endTimeSeconds: 40,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        durationSeconds: 10,
      },
      [{ startTimeSeconds: 30, endTimeSeconds: 40, text: "Coarse segment wording" }],
      [
        { text: "Grace", startTimeSeconds: 31.1, endTimeSeconds: 31.5 },
        { text: "still", startTimeSeconds: 31.8, endTimeSeconds: 32.2 },
        { text: "wins", startTimeSeconds: 32.6, endTimeSeconds: 33.1 },
      ],
      "active-word",
    );

    expect(result.source).toBe("transcript-word-timings");
    expect(result.cues).toEqual([
      {
        index: 1,
        startSeconds: 1.1,
        endSeconds: 3.1,
        text: "Grace still wins",
        wordTimings: [
          { text: "Grace", startSeconds: 1.1, endSeconds: 1.5 },
          { text: "still", startSeconds: 1.8, endSeconds: 2.2 },
          { text: "wins", startSeconds: 2.6, endSeconds: 3.1 },
        ],
      },
    ]);
  });

  it("uses one exact cue per word for the single-word reveal mode", () => {
    const result = __captionServiceTestUtils.buildCaptionCueSet(
      {
        id: "clip-1",
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        durationSeconds: 10,
      },
      [],
      [
        { text: "Faith", startTimeSeconds: 10.2, endTimeSeconds: 10.7 },
        { text: "moves", startTimeSeconds: 10.9, endTimeSeconds: 11.4 },
      ],
      "single-word",
    );

    expect(result.cues.map((cue) => cue.text)).toEqual(["Faith", "moves"]);
    expect(result.cues[1]?.wordTimings).toEqual([
      { text: "moves", startSeconds: 0.9, endSeconds: 1.4 },
    ]);
  });

  it("falls back to grouped segment timing when persisted words are unavailable", () => {
    const result = __captionServiceTestUtils.buildCaptionCueSet(
      {
        id: "clip-1",
        startTimeSeconds: 0,
        endTimeSeconds: 8,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        durationSeconds: 8,
      },
      [{ startTimeSeconds: 0, endTimeSeconds: 8, text: "God is faithful through every season" }],
      [],
      "phrase",
    );

    expect(result.source).toBe("transcript-segments");
    expect(result.cues.map((cue) => cue.text)).toEqual(["God is", "faithful", "through", "every", "season"]);
    expect(result.cues.every((cue) => (cue.wordTimings?.length ?? 0) > 0)).toBe(true);
  });

  it("renders SRT blocks with sequential numbering", () => {
    const srt = __captionServiceTestUtils.buildSrtFromCues([
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 1.2,
        text: "One",
      },
      {
        index: 2,
        startSeconds: 1.2,
        endSeconds: 3,
        text: "Two",
      },
    ]);

    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,200\nOne");
    expect(srt).toContain("2\n00:00:01,200 --> 00:00:03,000\nTwo");
  });

  it("flags invalid subtitle timing", () => {
    const validation = __captionServiceTestUtils.validateCaptionCueTiming(
      [
        {
          index: 1,
          startSeconds: 4,
          endSeconds: 3.9,
          text: "Bad timing",
        },
      ],
      10,
    );

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("invalid end time");
  });

  it("passes valid subtitle timing", () => {
    const validation = __captionServiceTestUtils.validateCaptionCueTiming(
      [
        {
          index: 1,
          startSeconds: 0,
          endSeconds: 1.5,
          text: "Good timing",
        },
        {
          index: 2,
          startSeconds: 1.6,
          endSeconds: 4,
          text: "Still good",
        },
      ],
      8,
    );

    expect(validation.isValid).toBe(true);
    expect(validation.reasons).toHaveLength(0);
  });

  it("measures caption coverage and large gaps", () => {
    const quality = __captionServiceTestUtils.assessCaptionCueQuality(
      [
        { index: 1, startSeconds: 0, endSeconds: 4, text: "Opening" },
        { index: 2, startSeconds: 42, endSeconds: 48, text: "Ending" },
      ],
      60,
    );

    expect(quality.coverageRatio).toBeCloseTo(0.167);
    expect(quality.maxGapSeconds).toBe(38);
    expect(quality.warnings).toContain("LOW_CAPTION_COVERAGE");
    expect(quality.warnings).toContain("LARGE_CAPTION_GAPS");
  });

  it("measures whether generated captions match the saved clip transcript", () => {
    const fidelity = __captionServiceTestUtils.assessCaptionTranscriptFidelity(
      [
        { index: 1, startSeconds: 0, endSeconds: 4, text: "God placed a gift in you." },
        { index: 2, startSeconds: 4, endSeconds: 8, text: "Stir it up and serve with courage." },
      ],
      "God has placed a gift in you. Stir it up and serve with courage.",
    );

    expect(fidelity.transcriptCoverageRatio).toBeGreaterThanOrEqual(0.7);
    expect(fidelity.extraCueTokenRatio).toBeLessThan(0.35);
    expect(fidelity.warnings).toEqual([]);
  });

  it("warns when captions miss the selected clip transcript", () => {
    const fidelity = __captionServiceTestUtils.assessCaptionTranscriptFidelity(
      [
        { index: 1, startSeconds: 0, endSeconds: 4, text: "Welcome to church and please scan the QR code." },
      ],
      "God has placed a gift in you. Stir it up and serve with courage.",
    );

    expect(fidelity.transcriptCoverageRatio).toBeLessThan(0.5);
    expect(fidelity.warnings).toContain("LOW_CAPTION_TRANSCRIPT_FIDELITY");
  });

  it("warns when captions include too much surrounding sermon text", () => {
    const fidelity = __captionServiceTestUtils.assessCaptionTranscriptFidelity(
      [
        {
          index: 1,
          startSeconds: 0,
          endSeconds: 12,
          text: "Before we get there I want to remind you about several announcements from earlier in the service. God has placed a gift in you. Stir it up and serve with courage.",
        },
      ],
      "God has placed a gift in you. Stir it up and serve with courage.",
    );

    expect(fidelity.extraCueTokenRatio).toBeGreaterThan(0.55);
    expect(fidelity.warnings).toContain("CAPTIONS_INCLUDE_SURROUNDING_SERMON_TEXT");
  });

  it("blocks real caption generation for draft clips before jobs are created", () => {
    const result = __captionServiceTestUtils.validateCaptionGenerationEligibility({
      id: "draft-clip",
      status: "SUGGESTED",
    });

    expect(result).toEqual({
      ok: false,
      reason: "Clip draft-clip must be approved before captions can be generated.",
    });
  });

  it("allows caption generation for approved and exported clips", () => {
    expect(__captionServiceTestUtils.validateCaptionGenerationEligibility({
      id: "approved-clip",
      status: "APPROVED",
    })).toEqual({ ok: true });
    expect(__captionServiceTestUtils.validateCaptionGenerationEligibility({
      id: "exported-clip",
      status: "EXPORTED",
    })).toEqual({ ok: true });
  });

  it("blocks automatic captions when transcript review is still required", () => {
    const result = __captionServiceTestUtils.validateCaptionGenerationEligibility({
      id: "zulu-review-clip",
      status: "APPROVED",
      transcriptSafetyStatus: "REVIEW_REQUIRED",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected transcript review to block caption generation.");
    }
    expect(result.reason).toContain("confirm the transcript wording");
  });

  it("does not treat empty subtitle files as reusable caption assets", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "caption-empty-"));
    try {
      const srtPath = path.join(directory, "clip.srt");
      await writeFile(srtPath, "");

      await expect(__captionServiceTestUtils.fileHasBytes(srtPath)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not reuse existing subtitle files when caption freshness is stale", () => {
    expect(
      __captionServiceTestUtils.shouldReuseExistingCaptionAsset(
        {
          subtitlesGenerated: true,
          captionStatus: "GENERATED",
          captionFreshness: "NEEDS_REGENERATION",
        },
        undefined,
        true,
      ),
    ).toBe(false);

    expect(
      __captionServiceTestUtils.shouldReuseExistingCaptionAsset(
        {
          subtitlesGenerated: true,
          captionStatus: "GENERATED",
          captionFreshness: "UP_TO_DATE",
        },
        undefined,
        true,
      ),
    ).toBe(true);
  });

  it("preserves manual Clip Studio caption cues even during a forced media rebuild", () => {
    expect(
      __captionServiceTestUtils.shouldPreserveManualCaptionCues(
        {
          subtitlesGenerated: true,
          captionStatus: "GENERATED",
          captionFreshness: "UP_TO_DATE",
          captionData: {
            manuallyEdited: true,
            cues: [{ index: 1, startSeconds: 0, endSeconds: 2, text: "Manual cue" }],
          },
        },
        undefined,
      ),
    ).toBe(true);

    expect(
      __captionServiceTestUtils.shouldPreserveManualCaptionCues(
        {
          subtitlesGenerated: true,
          captionStatus: "GENERATED",
          captionFreshness: "UP_TO_DATE",
          captionData: {
            manuallyEdited: true,
            cues: [{ index: 1, startSeconds: 0, endSeconds: 2, text: "Manual cue" }],
          },
        },
        { force: true },
      ),
    ).toBe(true);
  });

  it("keeps Studio styling and overlays when generated caption metadata is refreshed", () => {
    const metadata = __captionServiceTestUtils.buildCaptionMetadata({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "APPROVED",
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        durationSeconds: 10,
        transcriptText: "Grace wins",
        srtPath: null,
        subtitlesGenerated: false,
        captionStatus: "NOT_GENERATED",
        captionFreshness: "OUTDATED",
        transcriptSafetyStatus: "TRUSTED",
        captionData: {
          captionStylePresetId: "kinetic-pop",
          captionRevealMode: "single-word",
          hookOverlay: { enabled: true, text: "Watch this" },
        },
      },
      srtPath: "/tmp/clip-1.srt",
      generatedAt: new Date("2026-07-22T10:00:00.000Z"),
      source: "transcript-word-timings",
      cues: [{
        index: 1,
        startSeconds: 0,
        endSeconds: 1,
        text: "Grace",
        wordTimings: [{ text: "Grace", startSeconds: 0, endSeconds: 1 }],
      }],
      cueQuality: { coverageRatio: 0.8, maxGapSeconds: 0.2, totalCueDurationSeconds: 8, warnings: [] },
      transcriptFidelity: {
        matchedTranscriptTokens: 1,
        transcriptTokenCount: 2,
        extraCueTokens: 0,
        cueTokenCount: 1,
        transcriptCoverageRatio: 0.5,
        extraCueTokenRatio: 0,
        warnings: [],
      },
      reusedExistingFile: false,
    });

    expect(metadata.captionData).toMatchObject({
      captionStylePresetId: "kinetic-pop",
      captionRevealMode: "single-word",
      hookOverlay: { enabled: true, text: "Watch this" },
      source: "transcript-word-timings",
      cues: [{
        index: 1,
        startSeconds: 0,
        endSeconds: 1,
        text: "Grace",
        wordTimings: [{ text: "Grace", startSeconds: 0, endSeconds: 1 }],
      }],
    });
  });

  it("extracts saved Studio cues into a worker-safe SRT payload", () => {
    const cues = __captionServiceTestUtils.extractManualCaptionCues({
      manuallyEdited: true,
      cues: [
        { index: 8, startSeconds: 0, endSeconds: 1.25, text: "  Keep   the   faith  " },
        { index: 9, startSeconds: 1.25, endSeconds: 3, text: "God is faithful." },
        { index: 10, startSeconds: 4, endSeconds: 3, text: "Invalid timing" },
      ],
    });

    expect(cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 1.25, text: "Keep the faith" },
      { index: 2, startSeconds: 1.25, endSeconds: 3, text: "God is faithful." },
    ]);
    expect(__captionServiceTestUtils.buildSrtFromCues(cues)).toContain(
      "00:00:00,000 --> 00:00:01,250\nKeep the faith",
    );
  });

  it("writes subtitle files atomically before captions are marked generated", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "caption-atomic-"));
    try {
      const srtPath = path.join(directory, "clip.srt");
      await __captionServiceTestUtils.writeCaptionFileAtomically(
        srtPath,
        "1\n00:00:00,000 --> 00:00:02,000\nGrace still meets you here.\n",
      );

      await expect(__captionServiceTestUtils.fileHasBytes(srtPath)).resolves.toBe(true);
      await expect(readFile(srtPath, "utf8")).resolves.toContain("Grace still meets you here.");
      await expect(__captionServiceTestUtils.fileHasBytes(path.join(directory, "clip.partial.srt"))).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
