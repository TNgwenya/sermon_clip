import { stat } from "node:fs/promises";

import { getMediaDurationSeconds } from "@/server/media/ffmpeg";

export type UsableMediaFileResult =
  | { usable: true; durationSeconds: number }
  | { usable: false; reason: string };

export async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

export async function mediaFileIsUsable(filePath: string, binaryPath?: string): Promise<UsableMediaFileResult> {
  if (!(await fileHasBytes(filePath))) {
    return { usable: false, reason: "The media file is missing or empty." };
  }

  try {
    const durationSeconds = await getMediaDurationSeconds(filePath, binaryPath);
    return { usable: true, durationSeconds };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown media duration probe error.";
    return { usable: false, reason: message };
  }
}
