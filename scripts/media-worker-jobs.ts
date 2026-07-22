type BatchError = {
  clipId: string;
  reason: string;
};

type RenderBatchResult = {
  completed: number;
  skipped: number;
  failed: number;
  errors?: BatchError[];
};

type CaptionBatchResult = {
  generated: number;
  reused: number;
  skipped: number;
  failed: number;
  errors?: BatchError[];
};

type PreviewPreparationResult = {
  prepared: number;
  skipped: number;
  failed: number;
};

type ClipGenerationResult = {
  clipCount: number;
  reusedExistingSuggestions: boolean;
};

type ClipGenerationDependencies = {
  generateSuggestions: (options: {
    force: boolean;
    append: boolean;
  }) => Promise<ClipGenerationResult>;
  preparePreviews: () => Promise<PreviewPreparationResult>;
};

type QualityRefreshResult = {
  clipsRefreshed: number;
  clipsSkipped?: number;
  clipsFailed: number;
  failures?: BatchError[];
};

type RedoClipGenerationResult = {
  success: boolean;
  message: string;
};

export type RedoClipGenerationWorkerSourceWindow = {
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
};

type ExportLayoutStrategy =
  | "CENTER_CROP"
  | "LEFT_FOCUS"
  | "RIGHT_FOCUS"
  | "FIT_BLURRED_BACKGROUND"
  | "SMART_CROP";

export type CaptionBurnClip = {
  id: string;
  captionData: unknown;
};

export type OverlayExportClip = {
  id: string;
  overlayStatus: string;
  overlayFreshness: string;
  exportStatus: string;
  exportFreshness: string;
  exportLayoutStrategy: ExportLayoutStrategy | null;
};

type CaptionBurnDependencies = {
  burnCaptions: (
    clipId: string,
    options: { allowReburn: true; force: true },
  ) => Promise<unknown>;
};

type OverlayExportDependencies = {
  renderOverlay: (
    clipId: string,
    options: { allowRerender: true; force: true },
  ) => Promise<unknown>;
  exportClip: (
    clipId: string,
    options: {
      allowReexport: true;
      force: true;
      layoutStrategy: ExportLayoutStrategy;
    },
  ) => Promise<unknown>;
  prepareFitBlurredFallback: (clipId: string) => Promise<unknown>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureDetails(errors: BatchError[] | undefined): string {
  if (!errors || errors.length === 0) {
    return "";
  }

  return ` Failures: ${errors
    .slice(0, 3)
    .map((error) => `${error.clipId}: ${error.reason}`)
    .join(" | ")}`;
}

function optionalNonNegativeSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function resolveRedoClipGenerationWorkerSourceWindow(
  generationSummary: unknown,
): RedoClipGenerationWorkerSourceWindow | null {
  if (!generationSummary || typeof generationSummary !== "object" || Array.isArray(generationSummary)) {
    return null;
  }
  const summary = generationSummary as Record<string, unknown>;
  if (summary["mode"] !== "redo") return null;
  const sermonStartSeconds = optionalNonNegativeSeconds(summary["sermonStartSeconds"]);
  const sermonEndSeconds = optionalNonNegativeSeconds(summary["sermonEndSeconds"]);
  return {
    sermonStartSeconds,
    sermonEndSeconds,
    analyzeFullRecording: typeof summary["analyzeFullRecording"] === "boolean"
      ? summary["analyzeFullRecording"]
      : sermonStartSeconds === null && sermonEndSeconds === null,
  };
}

/**
 * Turns a bulk render result into the worker-level outcome. A bulk service may
 * deliberately continue after an individual clip fails, but the parent job must
 * not be recorded as successful when that happens.
 */
export function summarizeRenderBatch(result: RenderBatchResult): string {
  const summary = `Rendered ${result.completed} clip(s), skipped ${result.skipped}, failed ${result.failed}.`;
  if (result.failed > 0 || (result.errors?.length ?? 0) > 0) {
    throw new Error(`${summary}${failureDetails(result.errors)}`);
  }

  return summary;
}

/** Applies the same worker-level all-or-nothing success rule to captions. */
export function summarizeCaptionBatch(result: CaptionBatchResult): string {
  const summary = `Generated captions for ${result.generated} clip(s), reused ${result.reused}, skipped ${result.skipped}; ${result.failed} failed.`;
  if (result.failed > 0 || (result.errors?.length ?? 0) > 0) {
    throw new Error(`${summary}${failureDetails(result.errors)}`);
  }

  return summary;
}

export function summarizePreviewPreparation(result: PreviewPreparationResult): string {
  const summary = `Preview prep: ${result.prepared} prepared, ${result.skipped} skipped, ${result.failed} failed.`;
  if (result.failed > 0) {
    throw new Error(summary);
  }

  return summary;
}

export async function runClipGenerationWorkerJob(
  input: {
    previewRepairOnly: boolean;
    forceGeneration: boolean;
    append: boolean;
  },
  dependencies: ClipGenerationDependencies,
): Promise<string> {
  if (input.previewRepairOnly) {
    const previewResult = await dependencies.preparePreviews();
    return `Existing clip suggestions reused without a new AI call. ${summarizePreviewPreparation(previewResult)}`;
  }

  const result = await dependencies.generateSuggestions({
    force: input.forceGeneration,
    append: input.append,
  });
  const previewSummary = summarizePreviewPreparation(await dependencies.preparePreviews());
  return result.reusedExistingSuggestions
    ? `Existing clip suggestions reused. ${previewSummary}`
    : `Generated ${result.clipCount} ${input.append ? "new " : ""}clip suggestion(s). ${previewSummary}`;
}

export function summarizeQualityRefreshBatch(result: QualityRefreshResult): string {
  const summary = `Refreshed ${result.clipsRefreshed} clip quality record(s); ${result.clipsFailed} failed.`;
  if (result.clipsFailed > 0 || (result.failures?.length ?? 0) > 0) {
    throw new Error(`${summary}${failureDetails(result.failures)}`);
  }

  return summary;
}

export function summarizeRedoClipGeneration(result: RedoClipGenerationResult): string {
  if (!result.success) {
    throw new Error(result.message);
  }

  return result.message;
}

export async function runCaptionBurnBatch(
  clips: CaptionBurnClip[],
  dependencies: CaptionBurnDependencies,
): Promise<string> {
  let completed = 0;
  let skipped = 0;
  const failures: BatchError[] = [];

  for (const clip of clips) {
    const captionData =
      clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
        ? clip.captionData as Record<string, unknown>
        : {};
    if (captionData["applyCaptionsToClip"] === false) {
      skipped += 1;
      continue;
    }

    try {
      await dependencies.burnCaptions(clip.id, {
        allowReburn: true,
        force: true,
      });
      completed += 1;
    } catch (error) {
      failures.push({ clipId: clip.id, reason: errorMessage(error) });
    }
  }

  if (failures.length > 0) {
    const attempted = clips.length - skipped;
    throw new Error(
      `Caption burn failed for ${failures.length} of ${attempted} attempted clip(s) after completing ${completed}; skipped ${skipped}.${failureDetails(failures)}`,
    );
  }

  return `Caption burn completed for ${completed} clip(s), skipped ${skipped} with captions off.`;
}

export async function runOverlayAndExportBatch(
  clips: OverlayExportClip[],
  dependencies: OverlayExportDependencies,
): Promise<string> {
  let overlaysCompleted = 0;
  let exportsCompleted = 0;
  const failures: BatchError[] = [];

  for (const clip of clips) {
    const needsOverlay = clip.overlayStatus !== "COMPLETED" || clip.overlayFreshness !== "UP_TO_DATE";
    const needsExport = clip.exportStatus !== "COMPLETED" || clip.exportFreshness !== "UP_TO_DATE";

    try {
      if (needsOverlay) {
        await dependencies.renderOverlay(clip.id, {
          allowRerender: true,
          force: true,
        });
        overlaysCompleted += 1;
      }

      if (needsExport) {
        const layoutStrategy = clip.exportLayoutStrategy ?? "SMART_CROP";
        try {
          await dependencies.exportClip(clip.id, {
            allowReexport: true,
            force: true,
            layoutStrategy,
          });
        } catch (error) {
          if (layoutStrategy !== "SMART_CROP") {
            throw error;
          }

          await dependencies.prepareFitBlurredFallback(clip.id);
          await dependencies.exportClip(clip.id, {
            allowReexport: true,
            force: true,
            layoutStrategy: "FIT_BLURRED_BACKGROUND",
          });
        }
        exportsCompleted += 1;
      }
    } catch (error) {
      failures.push({ clipId: clip.id, reason: errorMessage(error) });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Overlay/export failed for ${failures.length} of ${clips.length} clip(s) after completing ${overlaysCompleted} overlay(s) and ${exportsCompleted} export(s).${failureDetails(failures)}`,
    );
  }

  return `Overlay/export completed: ${overlaysCompleted} overlay(s), ${exportsCompleted} export(s).`;
}
