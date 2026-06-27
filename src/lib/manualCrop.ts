export type ManualCropKeyframe = {
  timeSeconds: number;
  centerX: number;
  centerY?: number;
  zoom?: number;
};

export type ManualCropPresetDirection = "left" | "center" | "right";

const DEFAULT_MANUAL_CROP_CENTER_X = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MANUAL_CROP_CENTER_X;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function normalizeTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Number(value.toFixed(2));
}

export function normalizeManualCropKeyframes(value: unknown): ManualCropKeyframe[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const keyframe = item as Record<string, unknown>;
      const centerX = typeof keyframe.centerX === "number" ? keyframe.centerX : Number(keyframe.centerX);
      const timeSeconds = typeof keyframe.timeSeconds === "number" ? keyframe.timeSeconds : Number(keyframe.timeSeconds);
      const centerY = typeof keyframe.centerY === "number" ? keyframe.centerY : undefined;
      const zoom = typeof keyframe.zoom === "number" ? keyframe.zoom : undefined;

      return [{
        timeSeconds: normalizeTime(timeSeconds),
        centerX: clamp01(centerX),
        ...(centerY !== undefined ? { centerY: clamp01(centerY) } : {}),
        ...(zoom !== undefined && Number.isFinite(zoom) ? { zoom: Math.max(1, Math.min(2, Number(zoom.toFixed(3)))) } : {}),
      }];
    })
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .filter((keyframe, index, keyframes) => index === 0 || keyframe.timeSeconds > keyframes[index - 1].timeSeconds);
}

export function hasManualCropKeyframes(value: unknown): boolean {
  return normalizeManualCropKeyframes(value).length > 0;
}

export function buildPresetManualCropKeyframes(input: {
  direction: ManualCropPresetDirection;
  durationSeconds: number;
}): ManualCropKeyframe[] {
  const centerXByDirection: Record<ManualCropPresetDirection, number> = {
    left: 0.38,
    center: 0.5,
    right: 0.62,
  };
  const durationSeconds = Math.max(0, Number(input.durationSeconds.toFixed(2)));
  const centerX = centerXByDirection[input.direction];

  return normalizeManualCropKeyframes([
    { timeSeconds: 0, centerX },
    { timeSeconds: durationSeconds, centerX },
  ]);
}

export function nudgeManualCropKeyframes(input: {
  keyframes: unknown;
  direction: "left" | "right";
  durationSeconds: number;
  step?: number;
}): ManualCropKeyframe[] {
  const existing = normalizeManualCropKeyframes(input.keyframes);
  const keyframes = existing.length > 0
    ? existing
    : buildPresetManualCropKeyframes({ direction: "center", durationSeconds: input.durationSeconds });
  const delta = (input.step ?? 0.06) * (input.direction === "left" ? -1 : 1);

  return normalizeManualCropKeyframes(keyframes.map((keyframe) => ({
    ...keyframe,
    centerX: keyframe.centerX + delta,
  })));
}
