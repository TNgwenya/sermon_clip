export const CLIP_COVER_FRAME_SCHEMA_VERSION = 1 as const;

export type ClipCoverFrameSourceVariant = "exported" | "captioned" | "overlay" | "rendered";
export type ClipCoverFrameSelectedBy = "AUTO" | "USER";
export type ClipCoverFrameCandidateId = "opening" | "early" | "middle" | "later";

export type ClipCoverFrameSource = {
  variant: ClipCoverFrameSourceVariant;
  assetVersion: number;
  sourceUpdatedAt?: Date | string | null;
  fingerprint: string;
};

export type ClipCoverFrameSelection = {
  schemaVersion: typeof CLIP_COVER_FRAME_SCHEMA_VERSION;
  timeSeconds: number;
  durationSeconds: number;
  sourceVariant: ClipCoverFrameSourceVariant;
  sourceAssetVersion: number;
  sourceFingerprint: string;
  selectedBy: ClipCoverFrameSelectedBy;
  selectedAt: string;
};

export type ClipCoverFrameCandidate = {
  id: ClipCoverFrameCandidateId;
  label: string;
  description: string;
  timeSeconds: number;
};

const CANDIDATE_DEFINITIONS: Array<{
  id: ClipCoverFrameCandidateId;
  label: string;
  description: string;
  ratio: number;
}> = [
  { id: "opening", label: "Opening", description: "Near the start of the clip", ratio: 0.08 },
  { id: "early", label: "Early", description: "Around the first third", ratio: 0.32 },
  { id: "middle", label: "Middle", description: "Around the middle", ratio: 0.56 },
  { id: "later", label: "Later", description: "Later in the clip", ratio: 0.8 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSourceVariant(value: unknown): value is ClipCoverFrameSourceVariant {
  return value === "exported" || value === "captioned" || value === "overlay" || value === "rendered";
}

function isSelectedBy(value: unknown): value is ClipCoverFrameSelectedBy {
  return value === "AUTO" || value === "USER";
}

function normalizeAssetVersion(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeSourceUpdatedAt(value: Date | string | null | undefined): string {
  if (!value) {
    return "undated";
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "undated";
}

export function clampCoverFrameTime(timeSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  const safeTime = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  // Avoid asking ffmpeg for the exact final frame, which is commonly outside
  // the decodable range after a clip is transcoded.
  const endPadding = Math.min(0.2, durationSeconds * 0.1);
  const latestSafeTime = Math.max(0, durationSeconds - endPadding);
  return Math.round(Math.min(Math.max(0, safeTime), latestSafeTime) * 1000) / 1000;
}

export function buildNeutralCoverFrameCandidates(durationSeconds: number): ClipCoverFrameCandidate[] {
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;

  return CANDIDATE_DEFINITIONS.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    description: candidate.description,
    timeSeconds: clampCoverFrameTime(safeDuration * candidate.ratio, safeDuration),
  }));
}

export function buildCoverFrameSource(input: {
  variant: ClipCoverFrameSourceVariant;
  assetVersion?: number | null;
  sourceUpdatedAt?: Date | string | null;
}): ClipCoverFrameSource {
  const assetVersion = normalizeAssetVersion(input.assetVersion ?? 0);
  const updatedAt = normalizeSourceUpdatedAt(input.sourceUpdatedAt);

  return {
    variant: input.variant,
    assetVersion,
    sourceUpdatedAt: input.sourceUpdatedAt,
    fingerprint: `${input.variant}:v${assetVersion}:${updatedAt}`,
  };
}

export function buildClipCoverFrameSelection(input: {
  timeSeconds: number;
  durationSeconds: number;
  source: ClipCoverFrameSource;
  selectedBy: ClipCoverFrameSelectedBy;
  selectedAt?: Date | string;
}): ClipCoverFrameSelection {
  const durationSeconds = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;
  const selectedAt = input.selectedAt instanceof Date
    ? input.selectedAt
    : input.selectedAt
      ? new Date(input.selectedAt)
      : new Date();

  return {
    schemaVersion: CLIP_COVER_FRAME_SCHEMA_VERSION,
    timeSeconds: clampCoverFrameTime(input.timeSeconds, durationSeconds),
    durationSeconds,
    sourceVariant: input.source.variant,
    sourceAssetVersion: input.source.assetVersion,
    sourceFingerprint: input.source.fingerprint,
    selectedBy: input.selectedBy,
    selectedAt: Number.isFinite(selectedAt.getTime()) ? selectedAt.toISOString() : new Date().toISOString(),
  };
}

export function parseClipCoverFrameSelection(captionData: unknown): ClipCoverFrameSelection | null {
  if (!isRecord(captionData) || !isRecord(captionData.coverFrameSelection)) {
    return null;
  }

  const selection = captionData.coverFrameSelection;
  if (
    selection.schemaVersion !== CLIP_COVER_FRAME_SCHEMA_VERSION
    || typeof selection.timeSeconds !== "number"
    || !Number.isFinite(selection.timeSeconds)
    || selection.timeSeconds < 0
    || typeof selection.durationSeconds !== "number"
    || !Number.isFinite(selection.durationSeconds)
    || selection.durationSeconds < 0
    || !isSourceVariant(selection.sourceVariant)
    || typeof selection.sourceAssetVersion !== "number"
    || !Number.isFinite(selection.sourceAssetVersion)
    || selection.sourceAssetVersion < 0
    || typeof selection.sourceFingerprint !== "string"
    || !selection.sourceFingerprint.trim()
    || !isSelectedBy(selection.selectedBy)
    || typeof selection.selectedAt !== "string"
    || !Number.isFinite(Date.parse(selection.selectedAt))
  ) {
    return null;
  }

  return {
    schemaVersion: CLIP_COVER_FRAME_SCHEMA_VERSION,
    timeSeconds: selection.timeSeconds,
    durationSeconds: selection.durationSeconds,
    sourceVariant: selection.sourceVariant,
    sourceAssetVersion: Math.floor(selection.sourceAssetVersion),
    sourceFingerprint: selection.sourceFingerprint.trim(),
    selectedBy: selection.selectedBy,
    selectedAt: new Date(selection.selectedAt).toISOString(),
  };
}

export function mergeClipCoverFrameSelection(
  captionData: unknown,
  selection: ClipCoverFrameSelection,
): Record<string, unknown> {
  return {
    ...(isRecord(captionData) ? captionData : {}),
    coverFrameSelection: selection,
  };
}

export function isClipCoverFrameSelectionStale(
  selection: ClipCoverFrameSelection | null,
  currentSource: ClipCoverFrameSource,
  currentDurationSeconds?: number | null,
): boolean {
  if (!selection) {
    return false;
  }

  if (
    selection.sourceVariant !== currentSource.variant
    || selection.sourceAssetVersion !== currentSource.assetVersion
    || selection.sourceFingerprint !== currentSource.fingerprint
  ) {
    return true;
  }

  if (typeof currentDurationSeconds === "number" && Number.isFinite(currentDurationSeconds)) {
    return Math.abs(selection.durationSeconds - Math.max(0, currentDurationSeconds)) > 0.001
      || selection.timeSeconds !== clampCoverFrameTime(selection.timeSeconds, currentDurationSeconds);
  }

  return false;
}
