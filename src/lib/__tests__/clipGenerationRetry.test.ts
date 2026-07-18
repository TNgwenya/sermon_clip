import { describe, expect, it } from "vitest";

import {
  buildClipGenerationRetryPlan,
  CLIP_GENERATION_PREVIEW_REPAIR_MODE,
  CLIP_GENERATION_RETRY_MODE,
  isClipGenerationForcedRetrySummary,
  isClipGenerationPreviewRepairSummary,
  resolveClipGenerationRetryMode,
} from "@/lib/clipGenerationRetry";

describe("clip generation retry planning", () => {
  it("repairs previews without regenerating when active suggestions already exist", () => {
    expect(resolveClipGenerationRetryMode({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "Preview prep: 0 prepared, 0 skipped, 5 failed.",
    })).toBe(CLIP_GENERATION_PREVIEW_REPAIR_MODE);
    expect(isClipGenerationPreviewRepairSummary({ mode: CLIP_GENERATION_PREVIEW_REPAIR_MODE })).toBe(true);
  });

  it("keeps generation available when no active suggestions exist", () => {
    expect(resolveClipGenerationRetryMode({
      existingActiveSuggestionCount: 0,
      failedJobErrorMessage: "Preview preparation failed.",
    })).toBe(CLIP_GENERATION_RETRY_MODE);
    expect(isClipGenerationPreviewRepairSummary({ mode: CLIP_GENERATION_RETRY_MODE })).toBe(false);
    expect(isClipGenerationForcedRetrySummary({ mode: CLIP_GENERATION_RETRY_MODE })).toBe(true);
  });

  it("retries genuine generation failures even when older suggestions exist", () => {
    expect(resolveClipGenerationRetryMode({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "AI clip selection timed out.",
      failedJobGenerationSummary: {
        failure: { stage: "clip_batch_generation" },
      },
    })).toBe(CLIP_GENERATION_RETRY_MODE);
  });

  it("preserves append intent without turning the retry into a destructive forced replacement", () => {
    const plan = buildClipGenerationRetryPlan({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "Preview prep failed.",
      failedJobGenerationSummary: { append: true },
    });

    expect(plan).toEqual({
      retryMode: CLIP_GENERATION_RETRY_MODE,
      generationSummary: {
        mode: CLIP_GENERATION_RETRY_MODE,
        existingActiveSuggestionCount: 5,
        append: true,
      },
    });
    expect(isClipGenerationForcedRetrySummary(plan.generationSummary)).toBe(false);
  });

  it("preserves redo intent in the summary written with the queued retry", () => {
    expect(buildClipGenerationRetryPlan({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "Preview prep failed.",
      failedJobGenerationSummary: { mode: "redo" },
    })).toEqual({
      retryMode: CLIP_GENERATION_RETRY_MODE,
      generationSummary: {
        mode: "redo",
        existingActiveSuggestionCount: 5,
      },
    });
  });

  it("keeps a genuine generation retry forced when it is not an append", () => {
    const plan = buildClipGenerationRetryPlan({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "AI clip selection timed out.",
    });

    expect(plan.generationSummary).toEqual({
      mode: CLIP_GENERATION_RETRY_MODE,
      existingActiveSuggestionCount: 5,
    });
    expect(isClipGenerationForcedRetrySummary(plan.generationSummary)).toBe(true);
  });

  it("does not treat malformed or unrelated job summaries as preview-only repairs", () => {
    expect(isClipGenerationPreviewRepairSummary(null)).toBe(false);
    expect(isClipGenerationPreviewRepairSummary([])).toBe(false);
    expect(isClipGenerationPreviewRepairSummary({ mode: "redo" })).toBe(false);
  });
});
