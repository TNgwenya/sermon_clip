import type { BrollCardPosition, CaptionPosition, HookOverlayPosition } from "@/lib/clipStudio";

export const CLIP_STUDIO_OVERLAY_POSITION_EVENT = "clip-studio-overlay-position";

export function clampOverlayRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampCaptionOverlayOffset(value: number): number {
  return Math.max(-160, Math.min(160, Math.round(value)));
}

export function resolveCaptionPositionFromOverlayRatio(ratio: number): CaptionPosition {
  const safeRatio = clampOverlayRatio(ratio);

  if (safeRatio < 0.34) {
    return "top";
  }

  if (safeRatio < 0.67) {
    return "middle";
  }

  return "lower";
}

export function resolveHookPositionFromOverlayRatio(ratio: number): HookOverlayPosition {
  const safeRatio = clampOverlayRatio(ratio);

  if (safeRatio < 0.34) {
    return "top";
  }

  if (safeRatio < 0.67) {
    return "center";
  }

  return "lower";
}

export function resolveBrollPositionFromOverlayRatio(ratio: number): BrollCardPosition {
  const safeRatio = clampOverlayRatio(ratio);

  if (safeRatio < 0.34) {
    return "upper";
  }

  if (safeRatio < 0.67) {
    return "full";
  }

  return "lower";
}

export type ClipStudioOverlayPositionDetail =
  | {
      overlay: "caption";
      position: CaptionPosition;
      horizontalOffset: number;
      verticalOffset: number;
    }
  | {
      overlay: "hook";
      position: HookOverlayPosition;
    }
  | {
      overlay: "broll";
      cardId: string;
      position: BrollCardPosition;
    };
