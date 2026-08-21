import { describe, expect, it, vi } from "vitest";

import { buildSermonWorkflowPayload } from "./sermonWorkflow";
import { OrchestrationStageError, createSermonLaneExecutor } from "./sermonLaneExecutor";

const payload = buildSermonWorkflowPayload({ sermonId: "sermon-1", sourceRevision: "revision-1" });

function dependencies() {
  return {
    intakeMaterialization: vi.fn().mockResolvedValue({ sourceReused: false, audioReused: false }),
    transcribe: vi.fn().mockResolvedValue({ reliableForClipping: true, reused: false }),
    buildIntelligenceAndSuggestions: vi.fn().mockResolvedValue({ suggestionCount: 6, reused: false }),
    preparePriorityPreviews: vi.fn().mockResolvedValue({ prepared: 3, deferred: 3, firstBrandedPreviewReady: true }),
    buildContentWeek: vi.fn().mockResolvedValue({
      opportunityCount: 12,
      reused: false,
      weekDraftReady: true,
      weekDraftId: "week-1",
    }),
    exportApprovedContent: vi.fn().mockResolvedValue({ exportCount: 1 }),
  };
}

describe("sermon lane executor", () => {
  it("executes each early-value lane independently and caps preview work", async () => {
    const deps = dependencies();
    const execute = createSermonLaneExecutor(deps);

    await expect(execute({ lane: "INTELLIGENCE", payload })).resolves.toMatchObject({
      completion: { lane: "INTELLIGENCE", suggestionsReady: true },
    });
    await expect(execute({ lane: "PREVIEW", payload })).resolves.toMatchObject({
      completion: { lane: "PREVIEW", firstBrandedPreviewReady: true },
      evidence: { prepared: 3, deferred: 3 },
    });
    expect(deps.preparePriorityPreviews).toHaveBeenCalledWith(expect.objectContaining({
      previewLimit: 3,
      requireBrandedFirstPreview: true,
    }));
    expect(deps.buildContentWeek).not.toHaveBeenCalled();
  });

  it("stops intelligence when transcript reliability is unsafe", async () => {
    const deps = dependencies();
    deps.transcribe.mockResolvedValue({ reliableForClipping: false, reused: false });
    const execute = createSermonLaneExecutor(deps);

    await expect(execute({ lane: "TRANSCRIPTION", payload })).rejects.toMatchObject({
      code: "SAFETY_BLOCK",
    });
  });

  it("preserves suggestions when branding fails and retries only the preview lane", async () => {
    const deps = dependencies();
    deps.preparePriorityPreviews.mockResolvedValue({ prepared: 3, deferred: 2, firstBrandedPreviewReady: false });
    const execute = createSermonLaneExecutor(deps);

    await expect(execute({ lane: "PREVIEW", payload })).rejects.toEqual(expect.any(OrchestrationStageError));
    expect(deps.buildIntelligenceAndSuggestions).not.toHaveBeenCalled();
  });

  it("will not export or publish without explicit approval provenance", async () => {
    const deps = dependencies();
    const execute = createSermonLaneExecutor(deps);

    await expect(execute({ lane: "FINAL_RENDER_EXPORT", payload })).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    await expect(execute({
      lane: "PUBLISHING",
      payload: { ...payload, approvalReference: "approval-1", publishIntentReference: "post-1" },
    })).rejects.toMatchObject({ code: "SAFETY_BLOCK" });
    expect(deps.exportApprovedContent).not.toHaveBeenCalled();
  });

  it("does not claim full Content Week completion without a reviewable Week Draft", async () => {
    const deps = dependencies();
    deps.buildContentWeek.mockResolvedValue({
      opportunityCount: 12,
      reused: false,
      weekDraftReady: false,
      weekDraftId: null,
    });
    const execute = createSermonLaneExecutor(deps);

    await expect(execute({ lane: "CONTENT_WEEK", payload })).rejects.toMatchObject({
      code: "ARTIFACT_INTEGRITY",
    });
  });
});
