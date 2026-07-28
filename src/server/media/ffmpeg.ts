import { spawn } from "node:child_process";

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

export async function checkFfmpegInstalled(binaryPath?: string): Promise<boolean> {
  const command = commandFor(binaryPath);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, ["-version"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        reject(new Error(`FFmpeg is not available: ${error.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
        reject(new Error(`FFmpeg is not installed or not executable (${details}).`));
      });
    });

    return true;
  } catch {
    return false;
  }
}

function ffprobeCommandFor(binaryPath?: string): string {
  if (!binaryPath?.trim()) {
    return "ffprobe";
  }

  const trimmed = binaryPath.trim();
  if (trimmed.endsWith("ffmpeg")) {
    return `${trimmed.slice(0, -"ffmpeg".length)}ffprobe`;
  }

  return "ffprobe";
}

export type MediaProbeStream = {
  index: number;
  codecType: string;
  codecName: string | null;
  width: number | null;
  height: number | null;
  pixelFormat: string | null;
  sampleAspectRatio: string | null;
  startTimeSeconds: number | null;
  rotationDegrees: number;
};

export type MediaProbe = {
  formatNames: string[];
  durationSeconds: number | null;
  startTimeSeconds: number | null;
  streams: MediaProbeStream[];
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function probeMediaFile(filePath: string, binaryPath?: string): Promise<MediaProbe> {
  const command = ffprobeCommandFor(binaryPath);
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration,start_time:stream=index,codec_type,codec_name,width,height,pix_fmt,sample_aspect_ratio,start_time:stream_tags=rotate:stream_side_data=rotation",
    "-of",
    "json",
    filePath,
  ];

  const probeText = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe is not available: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`ffprobe failed to inspect media (${details}).`));
    });
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(probeText);
  } catch {
    throw new Error("ffprobe returned invalid media metadata.");
  }

  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const format = root["format"] && typeof root["format"] === "object" && !Array.isArray(root["format"])
    ? root["format"] as Record<string, unknown>
    : {};
  const rawStreams = Array.isArray(root["streams"]) ? root["streams"] : [];
  const streams = rawStreams.flatMap((value, fallbackIndex): MediaProbeStream[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const stream = value as Record<string, unknown>;
    const tags = stream["tags"] && typeof stream["tags"] === "object" && !Array.isArray(stream["tags"])
      ? stream["tags"] as Record<string, unknown>
      : {};
    const sideData = Array.isArray(stream["side_data_list"])
      ? stream["side_data_list"].filter(
          (item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [];
    const sideDataRotation = sideData
      .map((item) => finiteNumber(item["rotation"]))
      .find((rotation) => rotation !== null);
    const rotationDegrees = sideDataRotation ?? finiteNumber(tags["rotate"]) ?? 0;

    return [{
      index: finiteNumber(stream["index"]) ?? fallbackIndex,
      codecType: typeof stream["codec_type"] === "string" ? stream["codec_type"] : "",
      codecName: typeof stream["codec_name"] === "string" ? stream["codec_name"] : null,
      width: positiveInteger(stream["width"]),
      height: positiveInteger(stream["height"]),
      pixelFormat: typeof stream["pix_fmt"] === "string" ? stream["pix_fmt"] : null,
      sampleAspectRatio: typeof stream["sample_aspect_ratio"] === "string"
        ? stream["sample_aspect_ratio"]
        : null,
      startTimeSeconds: finiteNumber(stream["start_time"]),
      rotationDegrees,
    }];
  });

  const durationSeconds = finiteNumber(format["duration"]);
  return {
    formatNames: typeof format["format_name"] === "string"
      ? format["format_name"].split(",").map((name) => name.trim()).filter(Boolean)
      : [],
    durationSeconds: durationSeconds !== null && durationSeconds > 0 ? durationSeconds : null,
    startTimeSeconds: finiteNumber(format["start_time"]),
    streams,
  };
}

export async function getMediaDurationSeconds(filePath: string, binaryPath?: string): Promise<number> {
  const command = ffprobeCommandFor(binaryPath);
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];

  const durationText = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe is not available: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`ffprobe failed to read duration (${details}).`));
    });
  });

  const duration = Number(durationText);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Media duration probe returned an invalid duration.");
  }

  return duration;
}

export async function getMediaDimensions(filePath: string, binaryPath?: string): Promise<{ width: number; height: number }> {
  const command = ffprobeCommandFor(binaryPath);
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    filePath,
  ];

  const dimensionsText = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe is not available: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`ffprobe failed to read video dimensions (${details}).`));
    });
  });

  const [widthText, heightText] = dimensionsText.split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Media dimension probe returned invalid dimensions.");
  }

  return { width, height };
}

export async function hasAudioStream(filePath: string, binaryPath?: string): Promise<boolean> {
  const command = ffprobeCommandFor(binaryPath);
  const args = [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];

  const streamText = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe is not available: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`ffprobe failed to read audio streams (${details}).`));
    });
  });

  return streamText.split(/\s+/).some((value) => value === "audio");
}
