import { describe, expect, it } from "vitest";

import {
  __openAITranscriptionProviderTestUtils,
  assertTimestampedTranscriptionModel,
  resolveOpenAITranscriptionModel,
} from "@/server/ai/openaiTranscriptionProvider";

describe("openai transcription provider", () => {
  it("defaults to the timestamp-safe Whisper model", () => {
    expect(resolveOpenAITranscriptionModel()).toBe("whisper-1");
  });

  it("rejects models that do not provide segment timestamps for clipping", () => {
    expect(() => assertTimestampedTranscriptionModel("gpt-4o-transcribe")).toThrow(/segment timestamps/);
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
        },
      ],
      wordTimestamps,
    });

    expect(selected.length).toBeGreaterThan(1);
    expect(Math.max(...selected.map((segment) => segment.endTimeSeconds - segment.startTimeSeconds))).toBeLessThanOrEqual(4.5);
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
});
