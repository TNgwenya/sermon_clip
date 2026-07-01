export type ClipPreviewAssetFreshness =
  | "UP_TO_DATE"
  | "OUTDATED"
  | "NEEDS_REGENERATION"
  | "FAILED"
  | null
  | undefined;

export type ClipPreviewPaths = {
  exportedFilePath?: string | null;
  captionedVideoPath?: string | null;
  overlayVideoPath?: string | null;
  renderedFilePath?: string | null;
  exportFreshness?: ClipPreviewAssetFreshness;
  captionBurnFreshness?: ClipPreviewAssetFreshness;
  overlayFreshness?: ClipPreviewAssetFreshness;
  renderFreshness?: ClipPreviewAssetFreshness;
};

export type ClipPreviewVariant = "exported" | "captioned" | "overlay" | "rendered";

type ClipPreviewCandidateConfig = {
  variant: ClipPreviewVariant;
  pathKey: keyof Pick<ClipPreviewPaths, "exportedFilePath" | "captionedVideoPath" | "overlayVideoPath" | "renderedFilePath">;
  freshnessKey: keyof Pick<ClipPreviewPaths, "exportFreshness" | "captionBurnFreshness" | "overlayFreshness" | "renderFreshness">;
};

const BEST_PREVIEW_CANDIDATES: ClipPreviewCandidateConfig[] = [
  { variant: "exported", pathKey: "exportedFilePath", freshnessKey: "exportFreshness" },
  { variant: "captioned", pathKey: "captionedVideoPath", freshnessKey: "captionBurnFreshness" },
  { variant: "overlay", pathKey: "overlayVideoPath", freshnessKey: "overlayFreshness" },
  { variant: "rendered", pathKey: "renderedFilePath", freshnessKey: "renderFreshness" },
];

export const BEST_PREVIEW_ORDER = BEST_PREVIEW_CANDIDATES.map((candidate) => candidate.pathKey);

function isFreshPreviewAsset(value: ClipPreviewAssetFreshness): boolean {
  return value === undefined || value === null || value === "UP_TO_DATE";
}

export function resolveBestPreviewCandidate(paths: ClipPreviewPaths): { variant: ClipPreviewVariant; path: string } | null {
  for (const candidate of BEST_PREVIEW_CANDIDATES) {
    const path = paths[candidate.pathKey];
    if (path && isFreshPreviewAsset(paths[candidate.freshnessKey])) {
      return {
        variant: candidate.variant,
        path,
      };
    }
  }

  return null;
}

export function listBestPreviewCandidates(paths: ClipPreviewPaths): string[] {
  return BEST_PREVIEW_CANDIDATES.flatMap((candidate) => {
    const path = paths[candidate.pathKey];
    return path && isFreshPreviewAsset(paths[candidate.freshnessKey]) ? [path] : [];
  });
}
