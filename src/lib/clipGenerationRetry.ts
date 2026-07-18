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
  const summary = asSummary(input.failedJobGenerationSummary);
  const explicitGenerationRequest = summary?.["append"] === true || summary?.["mode"] === "redo";
  const previewOnlyFailure = failedAtPreviewPreparation(
    input.failedJobErrorMessage,
    input.failedJobGenerationSummary,
  );

  return input.existingActiveSuggestionCount > 0 && previewOnlyFailure && !explicitGenerationRequest
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
