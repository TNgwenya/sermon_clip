import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";

export type ReadyMediaClip = {
  exportFormat: string | null;
  exportedFilePath: string | null;
  exportPath: string | null;
  overlayVideoPath?: string | null;
  captionedVideoPath?: string | null;
  renderedFilePath?: string | null;
};

export type ReadyMediaResolution = {
  mediaReady: boolean;
  outputPath: string | null;
  estimatedBytes: number | null;
};

type ResolveReadyMediaOptions = {
  trustMetadata?: boolean;
};

type ReadyMediaFile = {
  filePath: string;
  stats: Stats;
};

function buildReadyMediaCandidates(clip: ReadyMediaClip): Array<string | null | undefined> {
  return [
    clip.exportFormat === "VERTICAL_9_16" ? clip.exportedFilePath : null,
    clip.exportedFilePath,
    clip.exportPath,
    clip.overlayVideoPath,
    clip.captionedVideoPath,
    clip.renderedFilePath,
  ];
}

export async function fileHasBytes(filePath: string): Promise<boolean> {
  return Boolean(await statReadyMediaFile(filePath));
}

async function statReadyMediaFile(filePath: string): Promise<ReadyMediaFile | null> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0
      ? { filePath, stats: fileStat }
      : null;
  } catch {
    return null;
  }
}

export async function findExistingReadyMediaFile(candidates: Array<string | null | undefined>): Promise<string | null> {
  return (await findExistingReadyMediaCandidate(candidates))?.filePath ?? null;
}

async function findExistingReadyMediaCandidate(candidates: Array<string | null | undefined>): Promise<ReadyMediaFile | null> {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const file = await statReadyMediaFile(candidate);
    if (file) {
      return file;
    }
  }

  return null;
}

export async function resolveReadyMedia(
  clip: ReadyMediaClip,
  options: ResolveReadyMediaOptions = {},
): Promise<ReadyMediaResolution> {
  const candidates = buildReadyMediaCandidates(clip);

  if (options.trustMetadata) {
    const outputPath = candidates.find((candidate): candidate is string => Boolean(candidate)) ?? null;
    return {
      mediaReady: Boolean(outputPath),
      outputPath,
      estimatedBytes: null,
    };
  }

  const outputFile = await findExistingReadyMediaCandidate(candidates);

  if (!outputFile) {
    return {
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    };
  }

  return {
    mediaReady: true,
    outputPath: outputFile.filePath,
    estimatedBytes: outputFile.stats.size,
  };
}
