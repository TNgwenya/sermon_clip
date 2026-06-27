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
