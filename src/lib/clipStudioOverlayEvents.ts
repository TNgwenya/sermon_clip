import type { BrollCardPosition, CaptionPosition, HookOverlayPosition } from "@/lib/clipStudio";

export const CLIP_STUDIO_OVERLAY_POSITION_EVENT = "clip-studio-overlay-position";

export function clampOverlayRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampCaptionOverlayOffset(value: number): number {
  return Math.max(-160, Math.min(160, Math.round(value)));
}

export function nudgeCaptionOverlayOffset({
  horizontalOffset,
  verticalOffset,
  key,
  largeStep = false,
}: {
  horizontalOffset: number;
  verticalOffset: number;
  key: string;
  largeStep?: boolean;
}): { horizontalOffset: number; verticalOffset: number } | null {
  const step = largeStep ? 24 : 8;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    return {
      horizontalOffset: clampCaptionOverlayOffset(
        horizontalOffset + (key === "ArrowLeft" ? -step : step),
      ),
      verticalOffset: clampCaptionOverlayOffset(verticalOffset),
    };
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    return {
      horizontalOffset: clampCaptionOverlayOffset(horizontalOffset),
      verticalOffset: clampCaptionOverlayOffset(
        verticalOffset + (key === "ArrowUp" ? step : -step),
      ),
    };
  }

  return null;
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
