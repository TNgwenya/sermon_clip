export type ClipPreviewPaths = {
  exportedFilePath?: string | null;
  captionedVideoPath?: string | null;
  overlayVideoPath?: string | null;
  renderedFilePath?: string | null;
};

export const BEST_PREVIEW_ORDER: Array<keyof ClipPreviewPaths> = [
  "exportedFilePath",
  "captionedVideoPath",
  "overlayVideoPath",
  "renderedFilePath",
];

export function listBestPreviewCandidates(paths: ClipPreviewPaths): string[] {
  return BEST_PREVIEW_ORDER.map((key) => paths[key]).filter((value): value is string => Boolean(value));
}
