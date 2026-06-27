import { spawn } from "node:child_process";

import {
  getMediaDurationSeconds,
  hasAudioStream,
} from "@/server/media/ffmpeg";

export const AUDIO_WARNING_CODES = [
  "LOW_AUDIO_VOLUME",
  "AUDIO_CLIPPING_RISK",
  "LONG_SILENCE_AT_START",
  "LONG_SILENCE_AT_END",
  "LONG_INTERNAL_SILENCE",
  "NO_AUDIO_DETECTED",
  "EFFECTIVE_SILENCE",
] as const;

export type AudioWarningCode = typeof AUDIO_WARNING_CODES[number];

export type AudioQualityInput = {
  hasAudio: boolean | null;
  averageLoudness?: number | null;
  peakLoudness?: number | null;
  silenceAtBeginningSeconds?: number | null;
  silenceAtEndSeconds?: number | null;
  longestInternalSilenceSeconds?: number | null;
  internalSilenceCount?: number | null;
};

export type AudioQualityResult = {
  audioQualityScore: number;
  averageLoudness: number | null;
  peakLoudness: number | null;
  silenceAtBeginningSeconds: number | null;
  silenceAtEndSeconds: number | null;
  longestInternalSilenceSeconds: number | null;
  internalSilenceCount: number | null;
  audioWarnings: string[];
};

type SilenceEvent = {
  start: number;
  end: number | null;
  duration: number | null;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function ffmpegCommandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function parseDbValue(text: string, label: string): number | null {
  const match = text.match(new RegExp(`${label}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*dB`, "i"));
  return match ? Number(match[1]) : null;
}

export function parseVolumeDetectOutput(output: string): Pick<AudioQualityInput, "averageLoudness" | "peakLoudness"> {
  return {
    averageLoudness: parseDbValue(output, "mean_volume"),
    peakLoudness: parseDbValue(output, "max_volume"),
  };
}

export function parseSilenceDetectEvents(output: string): SilenceEvent[] {
  const starts = [...output.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1]));
  const ends = [...output.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => ({
    end: Number(match[1]),
    duration: Number(match[2]),
  }));
  return starts.map((start, index) => ({
    start,
    end: ends[index]?.end ?? null,
    duration: ends[index]?.duration ?? null,
  }));
}

export function parseSilenceDetectOutput(output: string, durationSeconds: number | null): Pick<AudioQualityInput, "silenceAtBeginningSeconds" | "silenceAtEndSeconds" | "longestInternalSilenceSeconds" | "internalSilenceCount"> {
  const events = parseSilenceDetectEvents(output);

  const beginning = events.find((event) => event.start <= 0.25);
  const silenceAtBeginningSeconds = beginning
    ? Number(((beginning.duration ?? ((beginning.end ?? 0) - beginning.start)) || 0).toFixed(2))
    : 0;

  let silenceAtEndSeconds = 0;
  if (durationSeconds !== null && durationSeconds > 0) {
    const ending = [...events].reverse().find((event) => {
      if (event.end === null) {
        return event.start < durationSeconds;
      }
      return durationSeconds - event.end <= 0.35;
    });
    if (ending) {
      silenceAtEndSeconds = Number((durationSeconds - ending.start).toFixed(2));
    }
  }

  const internalEvents = events.filter((event) => {
    const eventEnd = event.end ?? durationSeconds;
    const duration = event.duration ?? (eventEnd !== null ? eventEnd - event.start : 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      return false;
    }
    if (event.start <= 0.25) {
      return false;
    }
    if (durationSeconds !== null && eventEnd !== null && durationSeconds - eventEnd <= 0.35) {
      return false;
    }
    return true;
  });
  const longestInternalSilenceSeconds = internalEvents.length > 0
    ? Number(Math.max(...internalEvents.map((event) => event.duration ?? ((event.end ?? durationSeconds ?? event.start) - event.start))).toFixed(2))
    : 0;

  return {
    silenceAtBeginningSeconds,
    silenceAtEndSeconds,
    longestInternalSilenceSeconds,
    internalSilenceCount: internalEvents.length,
  };
}

async function runFfmpegAudioFilter(input: {
  filePath: string;
  filter: string;
  ffmpegPath?: string;
}): Promise<string> {
  const args = [
    "-hide_banner",
    "-nostats",
    "-i",
    input.filePath,
    "-af",
    input.filter,
    "-f",
    "null",
    "-",
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegCommandFor(input.ffmpegPath), args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`FFmpeg audio probe failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stderr);
        return;
      }

      reject(new Error(stderr.trim() || `FFmpeg audio probe failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

export async function probeAudioQuality(input: {
  filePath: string;
  ffmpegPath?: string;
}): Promise<AudioQualityResult> {
  const hasAudio = await hasAudioStream(input.filePath, input.ffmpegPath).catch(() => null);
  if (hasAudio === false) {
    return scoreAudioQuality({ hasAudio: false });
  }

  const durationSeconds = await getMediaDurationSeconds(input.filePath, input.ffmpegPath).catch(() => null);
  const [volumeOutput, silenceOutput] = await Promise.all([
    runFfmpegAudioFilter({ filePath: input.filePath, filter: "volumedetect", ffmpegPath: input.ffmpegPath }).catch(() => ""),
    runFfmpegAudioFilter({ filePath: input.filePath, filter: "silencedetect=noise=-35dB:d=0.3", ffmpegPath: input.ffmpegPath }).catch(() => ""),
  ]);

  return scoreAudioQuality({
    hasAudio,
    ...parseVolumeDetectOutput(volumeOutput),
    ...parseSilenceDetectOutput(silenceOutput, durationSeconds),
  });
}

export function scoreAudioQuality(input: AudioQualityInput): AudioQualityResult {
  if (input.hasAudio === false) {
    return {
      audioQualityScore: 0,
      averageLoudness: input.averageLoudness ?? null,
      peakLoudness: input.peakLoudness ?? null,
      silenceAtBeginningSeconds: input.silenceAtBeginningSeconds ?? null,
      silenceAtEndSeconds: input.silenceAtEndSeconds ?? null,
      longestInternalSilenceSeconds: input.longestInternalSilenceSeconds ?? null,
      internalSilenceCount: input.internalSilenceCount ?? null,
      audioWarnings: ["NO_AUDIO_DETECTED"],
    };
  }

  const warnings: AudioWarningCode[] = [];
  let score = input.hasAudio === true ? 8.4 : 6.2;
  const effectivelySilent =
    input.averageLoudness !== undefined &&
    input.averageLoudness !== null &&
    input.averageLoudness <= -55 &&
    (
      input.peakLoudness === undefined ||
      input.peakLoudness === null ||
      input.peakLoudness <= -45
    );

  if (effectivelySilent) {
    return {
      audioQualityScore: 0,
      averageLoudness: input.averageLoudness ?? null,
      peakLoudness: input.peakLoudness ?? null,
      silenceAtBeginningSeconds: input.silenceAtBeginningSeconds ?? null,
      silenceAtEndSeconds: input.silenceAtEndSeconds ?? null,
      longestInternalSilenceSeconds: input.longestInternalSilenceSeconds ?? null,
      internalSilenceCount: input.internalSilenceCount ?? null,
      audioWarnings: ["EFFECTIVE_SILENCE"],
    };
  }

  if (input.averageLoudness !== undefined && input.averageLoudness !== null && input.averageLoudness < -30) {
    score -= 2.2;
    warnings.push("LOW_AUDIO_VOLUME");
  }
  if (input.peakLoudness !== undefined && input.peakLoudness !== null && input.peakLoudness > -1) {
    score -= 2.2;
    warnings.push("AUDIO_CLIPPING_RISK");
  }
  if ((input.silenceAtBeginningSeconds ?? 0) >= 1.5) {
    score -= 1.2;
    warnings.push("LONG_SILENCE_AT_START");
  }
  if ((input.silenceAtEndSeconds ?? 0) >= 2) {
    score -= 1;
    warnings.push("LONG_SILENCE_AT_END");
  }
  if ((input.longestInternalSilenceSeconds ?? 0) >= 1.2) {
    score -= (input.longestInternalSilenceSeconds ?? 0) >= 2.5 ? 1.4 : 0.9;
    warnings.push("LONG_INTERNAL_SILENCE");
  }

  return {
    audioQualityScore: clampScore(score),
    averageLoudness: input.averageLoudness ?? null,
    peakLoudness: input.peakLoudness ?? null,
    silenceAtBeginningSeconds: input.silenceAtBeginningSeconds ?? null,
    silenceAtEndSeconds: input.silenceAtEndSeconds ?? null,
    longestInternalSilenceSeconds: input.longestInternalSilenceSeconds ?? null,
    internalSilenceCount: input.internalSilenceCount ?? null,
    audioWarnings: Array.from(new Set(warnings)),
  };
}
