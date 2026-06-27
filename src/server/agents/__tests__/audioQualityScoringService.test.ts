import { describe, expect, it } from "vitest";

import {
  parseSilenceDetectOutput,
  parseVolumeDetectOutput,
  scoreAudioQuality,
} from "@/server/agents/audioQualityScoringService";

describe("audio quality scoring", () => {
  it("blocks clips with no audio", () => {
    const result = scoreAudioQuality({ hasAudio: false });

    expect(result.audioQualityScore).toBe(0);
    expect(result.audioWarnings).toContain("NO_AUDIO_DETECTED");
  });

  it("warns for low volume, clipping, and long silence", () => {
    const result = scoreAudioQuality({
      hasAudio: true,
      averageLoudness: -34,
      peakLoudness: -0.3,
      silenceAtBeginningSeconds: 2,
      silenceAtEndSeconds: 2.5,
    });

    expect(result.audioWarnings).toContain("LOW_AUDIO_VOLUME");
    expect(result.audioWarnings).toContain("AUDIO_CLIPPING_RISK");
    expect(result.audioWarnings).toContain("LONG_SILENCE_AT_START");
    expect(result.audioWarnings).toContain("LONG_SILENCE_AT_END");
    expect(result.audioQualityScore).toBeLessThan(5);
  });

  it("blocks effectively silent audio before transcription can hallucinate", () => {
    const result = scoreAudioQuality({
      hasAudio: true,
      averageLoudness: -62,
      peakLoudness: -50,
      silenceAtBeginningSeconds: 0,
      silenceAtEndSeconds: 0,
    });

    expect(result.audioQualityScore).toBe(0);
    expect(result.audioWarnings).toEqual(["EFFECTIVE_SILENCE"]);
  });

  it("parses ffmpeg volume and silence probe output", () => {
    const volume = parseVolumeDetectOutput(`
      [Parsed_volumedetect_0 @ abc] mean_volume: -34.1 dB
      [Parsed_volumedetect_0 @ abc] max_volume: -0.4 dB
    `);
    const silence = parseSilenceDetectOutput(`
      [silencedetect @ abc] silence_start: 0
      [silencedetect @ abc] silence_end: 2.2 | silence_duration: 2.2
      [silencedetect @ abc] silence_start: 58.1
      [silencedetect @ abc] silence_end: 60 | silence_duration: 1.9
    `, 60);

    expect(volume.averageLoudness).toBe(-34.1);
    expect(volume.peakLoudness).toBe(-0.4);
    expect(silence.silenceAtBeginningSeconds).toBe(2.2);
    expect(silence.silenceAtEndSeconds).toBeCloseTo(1.9);
  });

  it("detects long internal silence separately from edge silence", () => {
    const silence = parseSilenceDetectOutput(`
      [silencedetect @ abc] silence_start: 0
      [silencedetect @ abc] silence_end: 0.8 | silence_duration: 0.8
      [silencedetect @ abc] silence_start: 22.4
      [silencedetect @ abc] silence_end: 24.1 | silence_duration: 1.7
      [silencedetect @ abc] silence_start: 58.8
      [silencedetect @ abc] silence_end: 60 | silence_duration: 1.2
    `, 60);

    expect(silence.silenceAtBeginningSeconds).toBe(0.8);
    expect(silence.silenceAtEndSeconds).toBeCloseTo(1.2);
    expect(silence.internalSilenceCount).toBe(1);
    expect(silence.longestInternalSilenceSeconds).toBe(1.7);
  });

  it("warns for long internal pauses without treating the clip as unusable", () => {
    const result = scoreAudioQuality({
      hasAudio: true,
      averageLoudness: -18,
      peakLoudness: -4,
      silenceAtBeginningSeconds: 0.2,
      silenceAtEndSeconds: 0.1,
      longestInternalSilenceSeconds: 1.8,
      internalSilenceCount: 1,
    });

    expect(result.audioWarnings).toContain("LONG_INTERNAL_SILENCE");
    expect(result.audioWarnings).not.toContain("NO_AUDIO_DETECTED");
    expect(result.audioQualityScore).toBeGreaterThan(6);
  });
});
