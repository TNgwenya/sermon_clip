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
  remotePreviewUrl?: string | null;
  remotePreviewUploadedAt?: Date | string | null;
  renderedAt?: Date | string | null;
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

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isHttpsPreviewUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value.trim());
}

export function isFreshRemotePreview(paths: Pick<
  ClipPreviewPaths,
  "remotePreviewUrl" | "remotePreviewUploadedAt" | "renderedAt" | "renderFreshness"
>): boolean {
  if (!isHttpsPreviewUrl(paths.remotePreviewUrl) || !isFreshPreviewAsset(paths.renderFreshness)) {
    return false;
  }

  const renderedAt = toTime(paths.renderedAt);
  const uploadedAt = toTime(paths.remotePreviewUploadedAt);
  if (renderedAt === null) {
    return true;
  }

  if (uploadedAt === null) {
    return false;
  }

  return uploadedAt >= renderedAt;
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

export function hasPreviewMetadata(paths: ClipPreviewPaths): boolean {
  return isFreshRemotePreview(paths) || resolveBestPreviewCandidate(paths) !== null;
}
