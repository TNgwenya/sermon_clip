import { describe, expect, it } from "vitest";

import {
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

  it("preserves explicit append and redo generation intent", () => {
    expect(resolveClipGenerationRetryMode({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "Preview prep failed.",
      failedJobGenerationSummary: { append: true },
    })).toBe(CLIP_GENERATION_RETRY_MODE);
    expect(resolveClipGenerationRetryMode({
      existingActiveSuggestionCount: 5,
      failedJobErrorMessage: "Preview prep failed.",
      failedJobGenerationSummary: { mode: "redo" },
    })).toBe(CLIP_GENERATION_RETRY_MODE);
  });

  it("does not treat malformed or unrelated job summaries as preview-only repairs", () => {
    expect(isClipGenerationPreviewRepairSummary(null)).toBe(false);
    expect(isClipGenerationPreviewRepairSummary([])).toBe(false);
    expect(isClipGenerationPreviewRepairSummary({ mode: "redo" })).toBe(false);
  });
});
