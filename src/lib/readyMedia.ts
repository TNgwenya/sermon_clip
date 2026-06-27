import { stat } from "node:fs/promises";

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
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

export async function findExistingReadyMediaFile(candidates: Array<string | null | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate && await fileHasBytes(candidate)) {
      return candidate;
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

  const outputPath = await findExistingReadyMediaFile(candidates);

  if (!outputPath) {
    return {
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    };
  }

  try {
    const fileStat = await stat(/* turbopackIgnore: true */ outputPath);
    return {
      mediaReady: fileStat.isFile() && fileStat.size > 0,
      outputPath,
      estimatedBytes: fileStat.isFile() && fileStat.size > 0 ? fileStat.size : null,
    };
  } catch {
    return {
      mediaReady: false,
      outputPath: null,
      estimatedBytes: null,
    };
  }
}
