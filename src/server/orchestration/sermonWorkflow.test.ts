import { describe, expect, it } from "vitest";

import {
  EARLY_VALUE_PREVIEW_LIMIT,
  buildOnDemandJob,
  buildSermonWorkflowPayload,
  nextAutomaticJob,
} from "./sermonWorkflow";

const payload = buildSermonWorkflowPayload({
  sermonId: "sermon-1",
  sourceRevision: "source-sha256",
});

describe("portable sermon orchestration workflow", () => {
  it("prioritises suggestions and the first three previews before content work", () => {
    expect(payload.previewLimit).toBe(EARLY_VALUE_PREVIEW_LIMIT);
    expect(nextAutomaticJob({ lane: "INTAKE_MATERIALIZATION" }, payload)?.lane).toBe("TRANSCRIPTION");
    expect(nextAutomaticJob({ lane: "TRANSCRIPTION" }, payload)?.lane).toBe("INTELLIGENCE");
    expect(nextAutomaticJob({ lane: "INTELLIGENCE", suggestionsReady: true }, payload)).toMatchObject({
      lane: "PREVIEW",
      priority: 100,
      payload: { previewLimit: 3, requireBrandedFirstPreview: true },
    });
    expect(nextAutomaticJob({ lane: "PREVIEW", firstBrandedPreviewReady: true }, payload)).toBeNull();
  });

  it("will not report early value without durable suggestions and a branded preview", () => {
    expect(() => nextAutomaticJob({ lane: "INTELLIGENCE" }, payload)).toThrow("suggestions are durably ready");
    expect(() => nextAutomaticJob({ lane: "PREVIEW" }, payload)).toThrow("branded review preview");
  });

  it("keeps Content Week deferred and lower priority", () => {
    expect(buildOnDemandJob({ lane: "CONTENT_WEEK", payload })).toMatchObject({
      lane: "CONTENT_WEEK",
      priority: 10,
    });
  });

  it("requires approval provenance for export and publish intents", () => {
    expect(() => buildOnDemandJob({ lane: "FINAL_RENDER_EXPORT", payload })).toThrow("approvalReference");
    expect(() => buildOnDemandJob({
      lane: "PUBLISHING",
      payload,
      approvalReference: "approval-1",
    })).toThrow("publishIntentReference");

    expect(buildOnDemandJob({
      lane: "PUBLISHING",
      payload,
      approvalReference: "approval-1",
      publishIntentReference: "scheduled-post-1",
    }).logicalKey).toContain("approval-1:scheduled-post-1");
  });
});
