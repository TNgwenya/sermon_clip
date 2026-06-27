import type { AssetFreshness, ClipCandidate, ClipStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type RegenerationStage =
  | "CLIP_DISCOVERY"
  | "BOUNDARY_REFINEMENT"
  | "RENDER"
  | "CAPTION_GENERATION"
  | "CAPTION_BURN"
  | "OVERLAY_GENERATION"
  | "EXPORT";

export type ClipAssetKind = "render" | "caption" | "captionBurn" | "overlay" | "export";

export const regenerationGraph: Record<RegenerationStage, RegenerationStage[]> = {
  CLIP_DISCOVERY: ["BOUNDARY_REFINEMENT", "RENDER", "CAPTION_GENERATION", "CAPTION_BURN", "OVERLAY_GENERATION", "EXPORT"],
  BOUNDARY_REFINEMENT: ["RENDER", "CAPTION_GENERATION", "CAPTION_BURN", "OVERLAY_GENERATION", "EXPORT"],
  RENDER: ["CAPTION_GENERATION", "CAPTION_BURN", "OVERLAY_GENERATION", "EXPORT"],
  CAPTION_GENERATION: ["CAPTION_BURN", "EXPORT"],
  CAPTION_BURN: ["EXPORT"],
  OVERLAY_GENERATION: ["EXPORT"],
  EXPORT: [],
};

export type ClipEditImpact = {
  metadataOnlyChanged: boolean;
  boundariesChanged: boolean;
  framingChanged: boolean;
  captionTextChanged: boolean;
  changedFields: string[];
};

type ClipEditBefore = {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  startTimeSeconds: number;
  endTimeSeconds: number;
  exportLayoutStrategy: string | null;
};

type ClipEditAfter = {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  startTimeSeconds: number;
  endTimeSeconds: number;
  exportLayoutStrategy: string | null;
};

type ClipFreshnessSnapshot = Pick<
  ClipCandidate,
  | "id"
  | "sermonId"
  | "renderStatus"
  | "captionStatus"
  | "captionBurnStatus"
  | "overlayStatus"
  | "exportStatus"
  | "renderFreshness"
  | "captionFreshness"
  | "captionBurnFreshness"
  | "overlayFreshness"
  | "exportFreshness"
>;

export type AssetFreshnessView = {
  render: AssetFreshness;
  caption: AssetFreshness;
  captionBurn: AssetFreshness;
  overlay: AssetFreshness;
  export: AssetFreshness;
};

export type ClipAssetStatusView = {
  renderStatus?: string | null;
  captionStatus?: string | null;
  captionBurnStatus?: string | null;
  overlayStatus?: string | null;
  exportStatus?: string | null;
};

export type BatchRegenerationSummary = {
  attempted: number;
  completed: number;
  skipped: number;
  failed: number;
  failures: Array<{ clipId: string; asset: ClipAssetKind; reason: string }>;
};

export type BrandingInvalidationInput = {
  churchName: string;
  churchLogoPath: string | null;
  primaryBrandColor: string;
  secondaryBrandColor: string;
  defaultFontFamily: string;
  defaultCaptionStyleName: string;
  watermarkPosition: string;
};

function normalizeHashtags(input: string[]): string[] {
  return [...input].map((item) => item.trim()).filter((item) => item.length > 0).sort();
}

function toOutdatedOrNeedsRegeneration(
  currentlyCompleted: boolean,
  currentFreshness: AssetFreshness,
): AssetFreshness {
  if (currentFreshness === "FAILED") {
    return "FAILED";
  }

  return currentlyCompleted ? "OUTDATED" : "NEEDS_REGENERATION";
}

function trimOrEmpty(value: string): string {
  return value.trim();
}

export function detectClipEditImpact(before: ClipEditBefore, after: ClipEditAfter): ClipEditImpact {
  const changedFields: string[] = [];

  if (trimOrEmpty(before.title) !== trimOrEmpty(after.title)) changedFields.push("title");
  if (trimOrEmpty(before.hook) !== trimOrEmpty(after.hook)) changedFields.push("hook");
  if (trimOrEmpty(before.caption) !== trimOrEmpty(after.caption)) changedFields.push("caption");

  const beforeTags = normalizeHashtags(before.hashtags);
  const afterTags = normalizeHashtags(after.hashtags);
  if (JSON.stringify(beforeTags) !== JSON.stringify(afterTags)) changedFields.push("hashtags");

  const boundariesChanged =
    Number(before.startTimeSeconds.toFixed(3)) !== Number(after.startTimeSeconds.toFixed(3)) ||
    Number(before.endTimeSeconds.toFixed(3)) !== Number(after.endTimeSeconds.toFixed(3));
  if (boundariesChanged) {
    changedFields.push("boundaries");
  }

  const framingChanged = (before.exportLayoutStrategy ?? "") !== (after.exportLayoutStrategy ?? "");
  if (framingChanged) {
    changedFields.push("framing");
  }

  const captionTextChanged = trimOrEmpty(before.caption) !== trimOrEmpty(after.caption);

  const metadataOnlyChanged =
    changedFields.length > 0 &&
    !boundariesChanged &&
    !framingChanged;

  return {
    metadataOnlyChanged,
    boundariesChanged,
    framingChanged,
    captionTextChanged,
    changedFields,
  };
}

export function computeOutdatedAssetsForClip(clip: AssetFreshnessView): ClipAssetKind[] {
  const assets: ClipAssetKind[] = [];

  if (clip.render !== "UP_TO_DATE") assets.push("render");
  if (clip.caption !== "UP_TO_DATE") assets.push("caption");
  if (clip.captionBurn !== "UP_TO_DATE") assets.push("captionBurn");
  if (clip.overlay !== "UP_TO_DATE") assets.push("overlay");
  if (clip.export !== "UP_TO_DATE") assets.push("export");

  return assets;
}

export function computeRegenerableAssetsForClip(
  clip: AssetFreshnessView & ClipAssetStatusView,
): ClipAssetKind[] {
  const assets = new Set<ClipAssetKind>(computeOutdatedAssetsForClip(clip));
  const assetOrder: ClipAssetKind[] = ["render", "caption", "captionBurn", "overlay", "export"];

  if (clip.renderStatus === "FAILED") assets.add("render");
  if (clip.captionStatus === "FAILED") assets.add("caption");
  if (clip.captionBurnStatus === "FAILED") assets.add("captionBurn");
  if (clip.overlayStatus === "FAILED") assets.add("overlay");
  if (clip.exportStatus === "FAILED") assets.add("export");

  return assetOrder.filter((asset) => assets.has(asset));
}

export function isClipApprovedForPostingAssets(status: ClipStatus): boolean {
  return status === "APPROVED" || status === "EXPORTED";
}

export function toFreshnessLabel(value: AssetFreshness): "Up To Date" | "Outdated" | "Needs Regeneration" | "Failed" {
  if (value === "UP_TO_DATE") return "Up To Date";
  if (value === "OUTDATED") return "Outdated";
  if (value === "FAILED") return "Failed";
  return "Needs Regeneration";
}

export function shouldInvalidateOverlayForBrandingChange(
  before: BrandingInvalidationInput,
  after: BrandingInvalidationInput,
): boolean {
  return (
    before.churchName !== after.churchName ||
    (before.churchLogoPath ?? "") !== (after.churchLogoPath ?? "") ||
    before.primaryBrandColor !== after.primaryBrandColor ||
    before.secondaryBrandColor !== after.secondaryBrandColor ||
    before.defaultFontFamily !== after.defaultFontFamily ||
    before.defaultCaptionStyleName !== after.defaultCaptionStyleName ||
    before.watermarkPosition !== after.watermarkPosition
  );
}

async function loadClipFreshnessSnapshot(clipId: string): Promise<ClipFreshnessSnapshot> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      renderStatus: true,
      captionStatus: true,
      captionBurnStatus: true,
      overlayStatus: true,
      exportStatus: true,
      renderFreshness: true,
      captionFreshness: true,
      captionBurnFreshness: true,
      overlayFreshness: true,
      exportFreshness: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip ${clipId} was not found.`);
  }

  return clip;
}

export async function invalidateAfterBoundaryOrCropChange(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      renderFreshness: toOutdatedOrNeedsRegeneration(clip.renderStatus === "COMPLETED", clip.renderFreshness),
      captionFreshness: toOutdatedOrNeedsRegeneration(clip.captionStatus === "GENERATED", clip.captionFreshness),
      captionBurnFreshness: toOutdatedOrNeedsRegeneration(clip.captionBurnStatus === "COMPLETED", clip.captionBurnFreshness),
      overlayFreshness: toOutdatedOrNeedsRegeneration(clip.overlayStatus === "COMPLETED", clip.overlayFreshness),
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function invalidateAfterCaptionTextChange(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionFreshness: toOutdatedOrNeedsRegeneration(clip.captionStatus === "GENERATED", clip.captionFreshness),
      captionBurnFreshness: toOutdatedOrNeedsRegeneration(clip.captionBurnStatus === "COMPLETED", clip.captionBurnFreshness),
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function invalidateAfterOverlaySettingChange(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      overlayFreshness: toOutdatedOrNeedsRegeneration(clip.overlayStatus === "COMPLETED", clip.overlayFreshness),
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function invalidateAfterBrandingChange(reason: string): Promise<number> {
  const result = await prisma.clipCandidate.updateMany({
    where: {
      status: { in: ["APPROVED", "EXPORTED"] },
    },
    data: {
      // Branding edits affect pastor/church overlays.
      overlayFreshness: "OUTDATED",
      assetInvalidationReason: reason,
    },
  });

  return result.count;
}

export async function markRenderAssetCompleted(clipId: string, incrementVersion: boolean): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      renderFreshness: "UP_TO_DATE",
      renderAssetVersion: incrementVersion ? { increment: 1 } : undefined,
      assetInvalidationReason: null,
    },
  });
}

export async function markRenderAssetFailed(clipId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      renderFreshness: "FAILED",
    },
  });
}

export async function markCaptionAssetCompleted(clipId: string, incrementVersion: boolean): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionFreshness: "UP_TO_DATE",
      captionAssetVersion: incrementVersion ? { increment: 1 } : undefined,
      assetInvalidationReason: null,
    },
  });
}

export async function markCaptionAssetFailed(clipId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionFreshness: "FAILED",
    },
  });
}

export async function markCaptionBurnAssetCompleted(clipId: string, incrementVersion: boolean): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionBurnFreshness: "UP_TO_DATE",
      captionBurnAssetVersion: incrementVersion ? { increment: 1 } : undefined,
      assetInvalidationReason: null,
    },
  });
}

export async function markCaptionBurnAssetFailed(clipId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionBurnFreshness: "FAILED",
    },
  });
}

export async function markOverlayAssetCompleted(clipId: string, incrementVersion: boolean): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      overlayFreshness: "UP_TO_DATE",
      overlayAssetVersion: incrementVersion ? { increment: 1 } : undefined,
      assetInvalidationReason: null,
    },
  });
}

export async function markOverlayAssetFailed(clipId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      overlayFreshness: "FAILED",
    },
  });
}

export async function markExportAssetCompleted(clipId: string, incrementVersion: boolean): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      exportFreshness: "UP_TO_DATE",
      exportAssetVersion: incrementVersion ? { increment: 1 } : undefined,
      assetInvalidationReason: null,
    },
  });
}

export async function markExportAssetFailed(clipId: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      exportFreshness: "FAILED",
    },
  });
}

export async function invalidateAfterRenderCompleted(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionFreshness: toOutdatedOrNeedsRegeneration(clip.captionStatus === "GENERATED", clip.captionFreshness),
      captionBurnFreshness: toOutdatedOrNeedsRegeneration(clip.captionBurnStatus === "COMPLETED", clip.captionBurnFreshness),
      overlayFreshness: toOutdatedOrNeedsRegeneration(clip.overlayStatus === "COMPLETED", clip.overlayFreshness),
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function invalidateAfterCaptionCompleted(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionBurnFreshness: toOutdatedOrNeedsRegeneration(clip.captionBurnStatus === "COMPLETED", clip.captionBurnFreshness),
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function invalidateAfterOverlayCompleted(clipId: string, reason: string): Promise<void> {
  const clip = await loadClipFreshnessSnapshot(clipId);
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      exportFreshness: toOutdatedOrNeedsRegeneration(clip.exportStatus === "COMPLETED", clip.exportFreshness),
      assetInvalidationReason: reason,
    },
  });
}

export async function listClipFreshnessForSermon(sermonId: string): Promise<Array<
  Pick<
    ClipCandidate,
    | "id"
    | "status"
    | "renderStatus"
    | "captionStatus"
    | "captionBurnStatus"
    | "overlayStatus"
    | "exportStatus"
    | "renderFreshness"
    | "captionFreshness"
    | "captionBurnFreshness"
    | "overlayFreshness"
    | "exportFreshness"
  >
>> {
  return prisma.clipCandidate.findMany({
    where: { sermonId },
    select: {
      id: true,
      status: true,
      renderStatus: true,
      captionStatus: true,
      captionBurnStatus: true,
      overlayStatus: true,
      exportStatus: true,
      renderFreshness: true,
      captionFreshness: true,
      captionBurnFreshness: true,
      overlayFreshness: true,
      exportFreshness: true,
    },
  });
}

export function toClipAssetFreshnessView(clip: {
  renderFreshness: AssetFreshness;
  captionFreshness: AssetFreshness;
  captionBurnFreshness: AssetFreshness;
  overlayFreshness: AssetFreshness;
  exportFreshness: AssetFreshness;
}): AssetFreshnessView {
  return {
    render: clip.renderFreshness,
    caption: clip.captionFreshness,
    captionBurn: clip.captionBurnFreshness,
    overlay: clip.overlayFreshness,
    export: clip.exportFreshness,
  };
}

export function summarizeBatchResult(
  items: Array<{ ok: boolean; skipped?: boolean; clipId: string; asset: ClipAssetKind; reason?: string }>,
): BatchRegenerationSummary {
  const summary: BatchRegenerationSummary = {
    attempted: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const item of items) {
    summary.attempted += 1;
    if (item.ok) {
      if (item.skipped) {
        summary.skipped += 1;
      } else {
        summary.completed += 1;
      }
      continue;
    }

    summary.failed += 1;
    summary.failures.push({
      clipId: item.clipId,
      asset: item.asset,
      reason: item.reason ?? "Unknown regeneration failure.",
    });
  }

  return summary;
}

export const __regenerationTestUtils = {
  detectClipEditImpact,
  computeOutdatedAssetsForClip,
  computeRegenerableAssetsForClip,
  toFreshnessLabel,
  shouldInvalidateOverlayForBrandingChange,
  isClipApprovedForPostingAssets,
  summarizeBatchResult,
  toClipAssetFreshnessView,
};
