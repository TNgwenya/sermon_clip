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

function failedAtPreviewPreparation(
  errorMessage: string | null | undefined,
  generationSummary: unknown,
): boolean {
  const normalizedMessage = errorMessage?.trim().toLowerCase() ?? "";
  if (normalizedMessage.includes("preview prep") || normalizedMessage.includes("preview preparation")) {
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
  const previewOnlyFailure = failedAtPreviewPreparation(
    input.failedJobErrorMessage,
    input.failedJobGenerationSummary,
  );

  return input.existingActiveSuggestionCount > 0 && previewOnlyFailure
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
      },
    };
  }

  if (failedSummary?.["mode"] === "redo") {
    return {
      retryMode,
      generationSummary: {
        mode: "redo",
        existingActiveSuggestionCount: input.existingActiveSuggestionCount,
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
  return summary?.["mode"] === CLIP_GENERATION_RETRY_MODE && summary["append"] !== true;
}

export function resolveClipGenerationIntent(value: unknown): ClipGenerationIntent {
  const summary = asSummary(value);
  if (summary?.["mode"] === "redo") return "redo";
  if (summary?.["append"] === true) return "append";
  if (summary?.["mode"] === CLIP_GENERATION_PREVIEW_REPAIR_MODE) {
    return CLIP_GENERATION_PREVIEW_REPAIR_MODE;
  }
  if (summary?.["mode"] === CLIP_GENERATION_RETRY_MODE) {
    return CLIP_GENERATION_RETRY_MODE;
  }
  return "default";
}

export function clipGenerationIntentsMatch(existing: unknown, requested: unknown): boolean {
  return resolveClipGenerationIntent(existing) === resolveClipGenerationIntent(requested);
}
