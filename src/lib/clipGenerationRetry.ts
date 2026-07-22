export const CLIP_GENERATION_PREVIEW_REPAIR_MODE = "repair_previews" as const;
export const CLIP_GENERATION_RETRY_MODE = "retry_generation" as const;

export type ClipGenerationRetryMode =
  | typeof CLIP_GENERATION_PREVIEW_REPAIR_MODE
  | typeof CLIP_GENERATION_RETRY_MODE;

export type ClipGenerationRetryPlan = {
  retryMode: ClipGenerationRetryMode;
  generationSummary: {
    mode: ClipGenerationRetryMode | "redo";
    existingActiveSuggestionCount: number;
    append?: true;
    sermonStartSeconds?: number | null;
    sermonEndSeconds?: number | null;
    analyzeFullRecording?: boolean;
    previewClipIds?: string[];
    forcePreviewRender?: boolean;
    onlyFailedPreviews?: boolean;
    forceGeneration?: boolean;
  };
};

export type ClipGenerationIntent =
  | "default"
  | "append"
  | "redo"
  | typeof CLIP_GENERATION_PREVIEW_REPAIR_MODE
  | typeof CLIP_GENERATION_RETRY_MODE;

function asSummary(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type RedoClipGenerationWindowIntent = {
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
};

type PreviewRepairIntent = {
  previewClipIds: string[] | null;
  forcePreviewRender: boolean;
  onlyFailedPreviews: boolean;
};

function finiteSecondsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolveRedoClipGenerationWindowIntent(value: unknown): RedoClipGenerationWindowIntent | null {
  const summary = asSummary(value);
  if (summary?.["mode"] !== "redo") return null;
  const sermonStartSeconds = finiteSecondsOrNull(summary["sermonStartSeconds"]);
  const sermonEndSeconds = finiteSecondsOrNull(summary["sermonEndSeconds"]);
  return {
    sermonStartSeconds,
    sermonEndSeconds,
    analyzeFullRecording: typeof summary["analyzeFullRecording"] === "boolean"
      ? summary["analyzeFullRecording"]
      : sermonStartSeconds === null && sermonEndSeconds === null,
  };
}

function preservedRedoClipGenerationWindow(value: unknown): Partial<RedoClipGenerationWindowIntent> {
  const summary = asSummary(value);
  if (summary?.["mode"] !== "redo") return {};
  return {
    ...(Object.prototype.hasOwnProperty.call(summary, "sermonStartSeconds")
      ? { sermonStartSeconds: finiteSecondsOrNull(summary["sermonStartSeconds"]) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(summary, "sermonEndSeconds")
      ? { sermonEndSeconds: finiteSecondsOrNull(summary["sermonEndSeconds"]) }
      : {}),
    ...(typeof summary["analyzeFullRecording"] === "boolean"
      ? { analyzeFullRecording: summary["analyzeFullRecording"] }
      : {}),
  };
}

function resolvePreviewRepairIntent(value: unknown): PreviewRepairIntent | null {
  const summary = asSummary(value);
  if (summary?.["mode"] !== CLIP_GENERATION_PREVIEW_REPAIR_MODE) return null;
  const hasClipScope = Object.prototype.hasOwnProperty.call(summary, "previewClipIds");
  const previewClipIds = Array.isArray(summary["previewClipIds"])
    ? Array.from(new Set(
        summary["previewClipIds"]
          .filter((clipId): clipId is string => typeof clipId === "string")
          .map((clipId) => clipId.trim())
          .filter(Boolean),
      )).sort()
    : null;

  return {
    previewClipIds: hasClipScope ? (previewClipIds ?? []) : null,
    forcePreviewRender: summary["forcePreviewRender"] === true,
    onlyFailedPreviews: summary["onlyFailedPreviews"] === true,
  };
}

function preservedPreviewRepairIntent(value: unknown): {
  previewClipIds?: string[];
  forcePreviewRender?: true;
  onlyFailedPreviews?: true;
} {
  const intent = resolvePreviewRepairIntent(value);
  if (!intent) return {};
  return {
    ...(intent.previewClipIds !== null ? { previewClipIds: intent.previewClipIds } : {}),
    ...(intent.forcePreviewRender ? { forcePreviewRender: true } : {}),
    ...(intent.onlyFailedPreviews ? { onlyFailedPreviews: true } : {}),
  };
}

function failedAtPreviewPreparation(
  errorMessage: string | null | undefined,
  generationSummary: unknown,
): boolean {
  const normalizedMessage = errorMessage?.trim().toLowerCase() ?? "";
  if (
    normalizedMessage.includes("preview prep")
    || normalizedMessage.includes("preview preparation")
    || normalizedMessage.includes("preview issues")
  ) {
    return true;
  }

  const summary = asSummary(generationSummary);
  const failure = asSummary(summary?.["failure"]);
  return failure?.["stage"] === "preview_preparation";
}

export function resolveClipGenerationRetryMode(input: {
  existingActiveSuggestionCount: number;
  failedJobErrorMessage?: string | null;
  failedJobGenerationSummary?: unknown;
}): ClipGenerationRetryMode {
  const summary = asSummary(input.failedJobGenerationSummary);
  const previewOnlyFailure = failedAtPreviewPreparation(
    input.failedJobErrorMessage,
    input.failedJobGenerationSummary,
  );
  const generationAlreadyCompleted = summary?.["mode"] === CLIP_GENERATION_PREVIEW_REPAIR_MODE;

  return input.existingActiveSuggestionCount > 0 && (previewOnlyFailure || generationAlreadyCompleted)
    ? CLIP_GENERATION_PREVIEW_REPAIR_MODE
    : CLIP_GENERATION_RETRY_MODE;
}

export function buildClipGenerationRetryPlan(input: {
  existingActiveSuggestionCount: number;
  failedJobErrorMessage?: string | null;
  failedJobGenerationSummary?: unknown;
}): ClipGenerationRetryPlan {
  const retryMode = resolveClipGenerationRetryMode(input);
  const failedSummary = asSummary(input.failedJobGenerationSummary);

  // Once generation produced active suggestions, a preview-stage failure must
  // repair those assets only. Replaying append/redo would spend another AI call
  // and can discard the newly generated clips.
  if (retryMode === CLIP_GENERATION_PREVIEW_REPAIR_MODE) {
    return {
      retryMode,
      generationSummary: {
        mode: retryMode,
        existingActiveSuggestionCount: input.existingActiveSuggestionCount,
        ...preservedPreviewRepairIntent(input.failedJobGenerationSummary),
      },
    };
  }

  if (failedSummary?.["mode"] === "redo") {
    return {
      retryMode,
      generationSummary: {
        mode: "redo",
        existingActiveSuggestionCount: input.existingActiveSuggestionCount,
        ...preservedRedoClipGenerationWindow(failedSummary),
      },
    };
  }

  return {
    retryMode,
    generationSummary: {
      mode: retryMode,
      existingActiveSuggestionCount: input.existingActiveSuggestionCount,
      ...(failedSummary?.["append"] === true ? { append: true as const } : {}),
    },
  };
}

export function isClipGenerationPreviewRepairSummary(value: unknown): boolean {
  return asSummary(value)?.["mode"] === CLIP_GENERATION_PREVIEW_REPAIR_MODE;
}

export function isClipGenerationForcedRetrySummary(value: unknown): boolean {
  const summary = asSummary(value);
  return summary?.["forceGeneration"] === true
    || (summary?.["mode"] === CLIP_GENERATION_RETRY_MODE && summary["append"] !== true);
}

export function resolveClipGenerationIntent(value: unknown): ClipGenerationIntent {
  const summary = asSummary(value);
  if (summary?.["mode"] === "redo") return "redo";
  if (summary?.["mode"] === CLIP_GENERATION_PREVIEW_REPAIR_MODE) {
    return CLIP_GENERATION_PREVIEW_REPAIR_MODE;
  }
  if (summary?.["append"] === true) return "append";
  if (summary?.["mode"] === CLIP_GENERATION_RETRY_MODE) {
    return CLIP_GENERATION_RETRY_MODE;
  }
  return "default";
}

export function clipGenerationIntentsMatch(existing: unknown, requested: unknown): boolean {
  const existingIntent = resolveClipGenerationIntent(existing);
  const requestedIntent = resolveClipGenerationIntent(requested);
  if (existingIntent !== requestedIntent) return false;
  if (existingIntent === "redo") {
    return JSON.stringify(resolveRedoClipGenerationWindowIntent(existing))
      === JSON.stringify(resolveRedoClipGenerationWindowIntent(requested));
  }
  if (existingIntent === CLIP_GENERATION_PREVIEW_REPAIR_MODE) {
    return JSON.stringify(resolvePreviewRepairIntent(existing))
      === JSON.stringify(resolvePreviewRepairIntent(requested));
  }
  if (existingIntent === "default" || existingIntent === "append") {
    return isClipGenerationForcedRetrySummary(existing)
      === isClipGenerationForcedRetrySummary(requested);
  }
  return true;
}

export function buildClipGenerationPreviewCheckpoint(value: unknown): Record<string, unknown> {
  const summary = asSummary(value) ?? {};
  const metadata = Object.fromEntries(
    Object.entries(summary).filter(([key]) => !["append", "failure", "mode"].includes(key)),
  );

  return {
    ...metadata,
    mode: CLIP_GENERATION_PREVIEW_REPAIR_MODE,
  };
}
