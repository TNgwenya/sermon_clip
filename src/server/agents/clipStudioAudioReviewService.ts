import { spawn } from "node:child_process";

import { resolveSpeechCleanupProfile } from "@/lib/clipStudio";
import type { SpeechCleanupAudioSilenceEvent } from "@/lib/clipStudioPreviewTimeline";

const DEFAULT_AUDIO_SILENCE_REVIEW_TIMEOUT_MS = 15_000;

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

export function parseClipStudioSilenceDetectEvents(
  output: string,
  clipDurationSeconds: number,
): SpeechCleanupAudioSilenceEvent[] {
  const events: SpeechCleanupAudioSilenceEvent[] = [];
  let activeStart: number | null = null;

  for (const line of output.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      activeStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!endMatch || activeStart === null) {
      continue;
    }

    const end = Number(endMatch[1]);
    const duration = Number(endMatch[2]);
    if (Number.isFinite(activeStart) && Number.isFinite(end) && Number.isFinite(duration) && end > activeStart) {
      const startSeconds = roundSeconds(Math.max(0, activeStart));
      const endSeconds = roundSeconds(Math.min(clipDurationSeconds, end));
      if (endSeconds > startSeconds) {
        events.push({
          startSeconds,
          endSeconds,
          durationSeconds: roundSeconds(Math.min(duration, endSeconds - startSeconds)),
        });
      }
    }

    activeStart = null;
  }

  return events;
}

export async function detectClipStudioAudioSilenceEvents(input: {
  sourceVideoPath: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  ffmpegPath?: string;
  timeoutMs?: number;
}): Promise<SpeechCleanupAudioSilenceEvent[]> {
  const profile = resolveSpeechCleanupProfile("maximum");
  const clipDurationSeconds = roundSeconds(Math.max(0, input.endTimeSeconds - input.startTimeSeconds));

  if (clipDurationSeconds <= 0) {
    return [];
  }

  const args = [
    "-hide_banner",
    "-ss",
    String(input.startTimeSeconds),
    "-t",
    String(clipDurationSeconds),
    "-i",
    input.sourceVideoPath,
    "-vn",
    "-af",
    `silencedetect=noise=${profile.silenceDetectNoiseDb}dB:d=${profile.silenceDetectDurationSeconds}`,
    "-f",
    "null",
    "-",
  ];

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(commandFor(input.ffmpegPath), args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });

    let output = "";
    let settled = false;
    const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs !== undefined
      ? Math.max(1_000, input.timeoutMs)
      : DEFAULT_AUDIO_SILENCE_REVIEW_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`FFmpeg silence review timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    function settle<T>(callback: () => T): T | undefined {
      if (settled) {
        return undefined;
      }

      settled = true;
      clearTimeout(timeout);
      return callback();
    }

    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", (error) => {
      settle(() => reject(new Error(`Failed to start FFmpeg silence review: ${error.message}`)));
    });

    child.on("close", (code) => {
      settle(() => {
        if (code === 0) {
          resolve(output);
          return;
        }

        reject(new Error(`FFmpeg silence review failed with code ${code ?? "unknown"}. ${output.trim().slice(-800)}`.trim()));
      });
    });
  });

  return parseClipStudioSilenceDetectEvents(stderr, clipDurationSeconds);
}
