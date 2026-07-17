import { describe, expect, it } from "vitest";

import {
  __openAITranscriptionProviderTestUtils,
  assertTimestampedTranscriptionModel,
  resolveOpenAITranscriptionModel,
} from "@/server/ai/openaiTranscriptionProvider";

describe("openai transcription provider", () => {
  it("derives conservative segment evidence from Whisper diagnostics", () => {
    const confidence = __openAITranscriptionProviderTestUtils.deriveWhisperSegmentConfidence({
      avg_logprob: Math.log(0.8),
      no_speech_prob: 0.1,
    });

    expect(confidence).toBe(0.72);
  });

  it("does not invent confidence when average log probability is absent", () => {
    expect(
      __openAITranscriptionProviderTestUtils.deriveWhisperSegmentConfidence({
        no_speech_prob: 0.01,
      }),
    ).toBeUndefined();

    expect(
      __openAITranscriptionProviderTestUtils.normalizeSegments([
        { start: 0, end: 3, text: "A timestamped phrase." },
      ])[0],
    ).not.toHaveProperty("confidence");
  });

  it("normalizes provider diagnostics onto timestamped segments", () => {
    const segments = __openAITranscriptionProviderTestUtils.normalizeSegments([
      {
        start: 0,
        end: 3,
        text: "A timestamped phrase.",
        avg_logprob: Math.log(0.75),
        no_speech_prob: 0.2,
      },
    ]);

    expect(segments).toEqual([
      {
        startTimeSeconds: 0,
        endTimeSeconds: 3,
        text: "A timestamped phrase.",
        confidence: 0.6,
      },
    ]);
  });

  it("maps provider evidence onto word-timed phrases by temporal overlap", () => {
    const mapped = __openAITranscriptionProviderTestUtils.mapProviderConfidenceByOverlap(
      [
        { startTimeSeconds: 3, endTimeSeconds: 7, text: "A phrase across two segments." },
        { startTimeSeconds: 11, endTimeSeconds: 12, text: "No provider overlap." },
        { startTimeSeconds: 9, endTimeSeconds: 11, text: "Only partial provider evidence." },
      ],
      [
        { startTimeSeconds: 0, endTimeSeconds: 5, text: "First provider segment.", confidence: 0.8 },
        { startTimeSeconds: 5, endTimeSeconds: 10, text: "Second provider segment.", confidence: 0.4 },
      ],
    );

    expect(mapped[0]).toMatchObject({ confidence: 0.6 });
    expect(mapped[1]).not.toHaveProperty("confidence");
    expect(mapped[2]).not.toHaveProperty("confidence");
  });

  it("defaults to the timestamp-safe Whisper model", () => {
    expect(resolveOpenAITranscriptionModel()).toBe("whisper-1");
  });

  it("rejects models that do not provide segment timestamps for clipping", () => {
    expect(() => assertTimestampedTranscriptionModel("gpt-4o-transcribe")).toThrow(/segment timestamps/);
  });

  it("skips the accuracy pass for a well-timestamped, high-confidence English transcript", () => {
    expect(__openAITranscriptionProviderTestUtils.shouldRunAccuracyPass({
      provider: "openai",
      model: "whisper-1",
      language: "en",
      fullText: "A clear sermon transcript with reliable timing.",
      raw: {},
      words: Array.from({ length: 30 }, (_, index) => ({
        startTimeSeconds: index,
        endTimeSeconds: index + 0.5,
        text: `word${index}`,
      })),
      segments: Array.from({ length: 6 }, (_, index) => ({
        startTimeSeconds: index * 5,
        endTimeSeconds: (index + 1) * 5,
        text: `Clear segment ${index}.`,
        confidence: 0.82,
      })),
    })).toBe(false);
  });

  it("escalates low-confidence or non-English transcripts to the accuracy pass", () => {
    const base = {
      provider: "openai" as const,
      model: "whisper-1",
      fullText: "Transcript text",
      raw: {},
      words: Array.from({ length: 30 }, (_, index) => ({
        startTimeSeconds: index,
        endTimeSeconds: index + 0.5,
        text: `word${index}`,
      })),
      segments: Array.from({ length: 6 }, (_, index) => ({
        startTimeSeconds: index * 5,
        endTimeSeconds: (index + 1) * 5,
        text: `Segment ${index}.`,
        confidence: 0.5,
      })),
    };

    expect(__openAITranscriptionProviderTestUtils.shouldRunAccuracyPass({ ...base, language: "en" })).toBe(true);
    expect(__openAITranscriptionProviderTestUtils.shouldRunAccuracyPass({
      ...base,
      language: "zu",
      segments: base.segments.map((segment) => ({ ...segment, confidence: 0.85 })),
    })).toBe(true);
  });

  it("treats transient transcription API failures as retryable", () => {
    expect(
      __openAITranscriptionProviderTestUtils.isRetryableOpenAITranscriptionError(
        Object.assign(new Error("500 status code (no body)"), { status: 500 }),
      ),
    ).toBe(true);
    expect(
      __openAITranscriptionProviderTestUtils.isRetryableOpenAITranscriptionError(
        Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
      ),
    ).toBe(true);
    expect(
      __openAITranscriptionProviderTestUtils.isRetryableOpenAITranscriptionError(
        Object.assign(new Error("invalid file"), { status: 400 }),
      ),
    ).toBe(false);
  });

  it("retries transient transcription failures before succeeding", async () => {
    let attempts = 0;
    const retryMessages: string[] = [];

    const result = await __openAITranscriptionProviderTestUtils.runTranscriptionRequestWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("500 status code (no body)"), { status: 500 });
        }

        return "transcribed";
      },
      {
        maxAttempts: 4,
        baseDelayMs: 0,
        sleepFn: async () => undefined,
        onRetry: (info) => {
          retryMessages.push(`${info.attempt}->${info.nextAttempt}:${info.message}`);
        },
      },
    );

    expect(result).toBe("transcribed");
    expect(attempts).toBe(3);
    expect(retryMessages).toEqual([
      "1->2:500 status code (no body)",
      "2->3:500 status code (no body)",
    ]);
  });

  it("does not retry non-transient transcription failures", async () => {
    let attempts = 0;

    await expect(
      __openAITranscriptionProviderTestUtils.runTranscriptionRequestWithRetry(
        async () => {
          attempts += 1;
          throw Object.assign(new Error("invalid file"), { status: 400 });
        },
        {
          maxAttempts: 4,
          baseDelayMs: 0,
          sleepFn: async () => undefined,
        },
      ),
    ).rejects.toThrow("invalid file");

    expect(attempts).toBe(1);
  });

  it("converts word timestamps into short phrase-timed transcript segments", () => {
    const words = [
      "Faith",
      "keeps",
      "walking",
      "when",
      "pressure",
      "comes.",
      "God",
      "is",
      "still",
      "faithful",
      "today.",
    ].map((word, index) => ({
      startTimeSeconds: index * 0.42,
      endTimeSeconds: index * 0.42 + 0.35,
      text: word,
    }));

    const segments = __openAITranscriptionProviderTestUtils.wordsToTranscriptSegments(words);

    expect(segments).toEqual([
      {
        startTimeSeconds: 0,
        endTimeSeconds: 2.45,
        text: "Faith keeps walking when pressure comes.",
      },
      {
        startTimeSeconds: 2.52,
        endTimeSeconds: 4.55,
        text: "God is still faithful today.",
      },
    ]);
  });

  it("prefers word-timed segments when they retain enough transcript text", () => {
    const responseText = Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(" ");
    const wordTimestamps = Array.from({ length: 24 }, (_, index) => ({
      startTimeSeconds: index * 0.4,
      endTimeSeconds: index * 0.4 + 0.28,
      text: `word${index + 1}`,
    }));

    const selected = __openAITranscriptionProviderTestUtils.selectBestTimestampedSegments({
      responseText,
      segmentTimestamps: [
        {
          startTimeSeconds: 0,
          endTimeSeconds: 18,
          text: responseText,
          confidence: 0.64,
        },
      ],
      wordTimestamps,
    });

    expect(selected.length).toBeGreaterThan(1);
    expect(Math.max(...selected.map((segment) => segment.endTimeSeconds - segment.startTimeSeconds))).toBeLessThanOrEqual(4.5);
    expect(selected.every((segment) => segment.confidence === 0.64)).toBe(true);
  });

  it("falls back to provider segments when word timestamps are too incomplete", () => {
    const segmentTimestamps = [
      {
        startTimeSeconds: 0,
        endTimeSeconds: 18,
        text: Array.from({ length: 40 }, (_, index) => `word${index + 1}`).join(" "),
      },
    ];
    const wordTimestamps = Array.from({ length: 20 }, (_, index) => ({
      startTimeSeconds: index * 0.4,
      endTimeSeconds: index * 0.4 + 0.28,
      text: `word${index + 1}`,
    }));

    const selected = __openAITranscriptionProviderTestUtils.selectBestTimestampedSegments({
      responseText: segmentTimestamps[0].text,
      segmentTimestamps,
      wordTimestamps,
    });

    expect(selected).toBe(segmentTimestamps);
  });

  it("keeps provider segments when word timestamps drop content that segment timestamps retained", () => {
    const responseText = Array.from({ length: 40 }, (_, index) => `word${index + 1}`).join(" ");
    const segmentTimestamps = [
      {
        startTimeSeconds: 0,
        endTimeSeconds: 18,
        text: responseText,
      },
    ];
    const wordTimestamps = Array.from({ length: 32 }, (_, index) => ({
      startTimeSeconds: index * 0.4,
      endTimeSeconds: index * 0.4 + 0.28,
      text: `word${index + 1}`,
    }));

    const selected = __openAITranscriptionProviderTestUtils.selectBestTimestampedSegments({
      responseText,
      segmentTimestamps,
      wordTimestamps,
    });

    expect(selected).toBe(segmentTimestamps);
  });

  it("aligns higher-accuracy wording onto the Whisper word timeline", () => {
    const timedWords = "Pastor Thabang said God is faithful in every season and we can trust him today"
      .split(" ")
      .map((text, index) => ({
        startTimeSeconds: index * 0.45,
        endTimeSeconds: index * 0.45 + 0.35,
        text,
      }));
    const timingSegments = [{
      startTimeSeconds: 0,
      endTimeSeconds: timedWords[timedWords.length - 1].endTimeSeconds,
      text: timedWords.map((word) => word.text).join(" "),
      confidence: 0.82,
    }];

    const aligned = __openAITranscriptionProviderTestUtils.alignHighAccuracyTranscript({
      accurateText: "Pastor Thabang said, “God is faithful in every season, and we can trust Him today.”",
      timedWords,
      timingSegments,
      accuracyConfidence: 0.91,
    });

    expect(aligned.accepted).toBe(true);
    expect(aligned.segments.map((segment) => segment.text).join(" ")).toContain("faithful");
    expect(aligned.segments[0].startTimeSeconds).toBe(0);
    expect(aligned.segments.every((segment) => segment.confidence === 0.82)).toBe(true);
  });

  it("keeps Whisper wording when the accuracy pass cannot be safely aligned", () => {
    const timedWords = Array.from({ length: 30 }, (_, index) => ({
      startTimeSeconds: index * 0.4,
      endTimeSeconds: index * 0.4 + 0.3,
      text: `sermon${index}`,
    }));
    const timingSegments = [{ startTimeSeconds: 0, endTimeSeconds: 12, text: "Original timed sermon wording." }];

    const aligned = __openAITranscriptionProviderTestUtils.alignHighAccuracyTranscript({
      accurateText: Array.from({ length: 30 }, (_, index) => `unrelated${index}`).join(" "),
      timedWords,
      timingSegments,
    });

    expect(aligned.accepted).toBe(false);
    expect(aligned.segments).toBe(timingSegments);
  });

  it("maps diarized speakers by overlap and normalizes the dominant speaker", () => {
    const diarized = __openAITranscriptionProviderTestUtils.normalizePrimarySpeakerLabel([
      { startTimeSeconds: 0, endTimeSeconds: 8, text: "Main sermon", speakerLabel: "A" },
      { startTimeSeconds: 8, endTimeSeconds: 10, text: "Amen", speakerLabel: "B" },
    ]);
    const mapped = __openAITranscriptionProviderTestUtils.mapSpeakerLabelsByOverlap(
      [
        { startTimeSeconds: 1, endTimeSeconds: 4, text: "Main sermon" },
        { startTimeSeconds: 8.2, endTimeSeconds: 9.5, text: "Amen" },
      ],
      diarized,
    );

    expect(mapped.map((segment) => segment.speakerLabel)).toEqual(["PRIMARY", "SECONDARY_B"]);
  });
});
