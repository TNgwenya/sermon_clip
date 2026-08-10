import { describe, expect, it } from "vitest";

import { __processSermonPipelineTestUtils } from "@/server/pipeline/processSermonPipeline";

describe("process sermon pipeline review asset preparation", () => {
  it("requires a complete sermon range before processing worship-enabled recordings", () => {
    const hasCompleteRange = __processSermonPipelineTestUtils.hasCompleteWorshipSermonRange;

    expect(hasCompleteRange({
      includeWorshipMoments: true,
      sermonStartSeconds: null,
      sermonEndSeconds: null,
    })).toBe(false);
    expect(hasCompleteRange({
      includeWorshipMoments: true,
      sermonStartSeconds: 1800,
      sermonEndSeconds: 4500,
    })).toBe(true);
    expect(hasCompleteRange({
      includeWorshipMoments: false,
      sermonStartSeconds: null,
      sermonEndSeconds: null,
    })).toBe(true);
  });

  it("explains incomplete mobile uploads without referring to YouTube", () => {
    expect(__processSermonPipelineTestUtils.incompleteLocalUploadMessage()).toContain("Upload incomplete");
    expect(__processSermonPipelineTestUtils.incompleteLocalUploadMessage()).toContain("Re-upload the video");
  });

  it("routes exhausted transcription credits to clearly labelled basic clips", () => {
    const fallbackReason = __processSermonPipelineTestUtils.basicClipFallbackReasonForTranscriptionError;

    expect(fallbackReason(new Error("429 You have no credits remaining. Add credits to continue using the API.")))
      .toContain("no available credits");
    expect(fallbackReason({ code: "credit_balance_exhausted", message: "Provider quota exhausted." }))
      .toContain("no available credits");
  });

  it("does not hide unrelated transcription failures behind basic clips", () => {
    expect(__processSermonPipelineTestUtils.basicClipFallbackReasonForTranscriptionError(
      new Error("The source audio file is corrupt."),
    )).toBeNull();
  });

  it("reports premium output failures as a partial pipeline failure", () => {
    const PartialFailure = __processSermonPipelineTestUtils.PipelinePartialCompletionError;
    const failure = new PartialFailure([
      { label: "Transcribe audio", status: "SUCCEEDED", message: "Audio transcribed." },
      { label: "Generate clip suggestions", status: "SUCCEEDED", message: "Generated clips." },
      { label: "Generate content opportunities", status: "FAILED", message: "Provider unavailable." },
    ]);

    expect(failure.code).toBe("PIPELINE_PARTIAL_FAILURE");
    expect(failure.summary).toContain("premium outputs need attention");
    expect(failure.failedSteps).toEqual([
      { label: "Generate content opportunities", status: "FAILED", message: "Provider unavailable." },
    ]);
  });

  it("does not claim a transcript exists when basic clip preview preparation is partial", () => {
    const PartialFailure = __processSermonPipelineTestUtils.PipelinePartialCompletionError;
    const failure = new PartialFailure([
      { label: "Transcribe audio", status: "SKIPPED", message: "Transcript was unreliable." },
      { label: "Create basic clips", status: "SUCCEEDED", message: "Created basic clips." },
      { label: "Prepare generated clip review assets", status: "FAILED", message: "One preview failed." },
    ]);

    expect(failure.summary).toContain("basic time-based clips were preserved");
    expect(failure.summary).toContain("no reliable transcript or content intelligence");
    expect(failure.summary).not.toContain("completed transcript");
  });

  it("does not increment an already-claimed parent job attempt a second time", () => {
    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "RUNNING",
      attemptCount: 0,
    })).toBe(true);

    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "PENDING",
      attemptCount: 0,
    })).toBe(true);

    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "RUNNING",
      attemptCount: 1,
    })).toBe(false);
  });

  it("reuses a complete saved transcript unless a forced rerun was requested", () => {
    const shouldReuse = __processSermonPipelineTestUtils.shouldReuseExistingTranscript;

    expect(shouldReuse({
      force: false,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 12,
      clipCandidateCount: 0,
      sermonStatus: "TRANSCRIBED",
    })).toBe(true);
    expect(shouldReuse({
      force: true,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 12,
      clipCandidateCount: 3,
      sermonStatus: "FAILED",
    })).toBe(false);
    expect(shouldReuse({
      force: false,
      transcriptId: null,
      transcriptSegmentCount: 12,
      clipCandidateCount: 3,
      sermonStatus: "FAILED",
    })).toBe(false);
    expect(shouldReuse({
      force: false,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 0,
      clipCandidateCount: 3,
      sermonStatus: "FAILED",
    })).toBe(false);
    expect(shouldReuse({
      force: false,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 12,
      clipCandidateCount: 3,
      sermonStatus: "FAILED",
    })).toBe(true);
    expect(shouldReuse({
      force: false,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 12,
      clipCandidateCount: 0,
      sermonStatus: "FAILED",
    })).toBe(false);
    expect(shouldReuse({
      force: false,
      transcriptId: "transcript-1",
      transcriptSegmentCount: 12,
      clipCandidateCount: 0,
      sermonStatus: "AUDIO_EXTRACTED",
    })).toBe(false);
  });

  it.each([
    { sermonStatus: "CLIPS_GENERATED" as const, clipCandidateCount: 3 },
    { sermonStatus: "REVIEWING" as const, clipCandidateCount: 3 },
    { sermonStatus: "EXPORTED" as const, clipCandidateCount: 3 },
    { sermonStatus: "FAILED" as const, clipCandidateCount: 3 },
  ])("reuses durable clips without regressing a $sermonStatus sermon", (input) => {
    expect(__processSermonPipelineTestUtils.isAdvancedSermonPipelineState(input)).toBe(true);
    expect(__processSermonPipelineTestUtils.shouldReuseDurableClipCandidates({
      force: false,
      ...input,
    })).toBe(true);
    expect(__processSermonPipelineTestUtils.advancedSermonPipelineGuardMessage({
      force: false,
      ...input,
    })).toBeNull();
  });

  it("stops an advanced sermon whose durable clip records are missing", () => {
    const message = __processSermonPipelineTestUtils.advancedSermonPipelineGuardMessage({
      force: false,
      sermonStatus: "CLIPS_GENERATED",
      clipCandidateCount: 0,
    });

    expect(message).toContain("clip records are missing");
    expect(message).toContain("Repair the sermon data");
    expect(__processSermonPipelineTestUtils.shouldReuseDurableClipCandidates({
      force: false,
      sermonStatus: "CLIPS_GENERATED",
      clipCandidateCount: 0,
    })).toBe(false);
  });

  it("rejects forced full-pipeline reruns after a sermon reaches advanced work", () => {
    expect(__processSermonPipelineTestUtils.advancedSermonPipelineGuardMessage({
      force: true,
      sermonStatus: "REVIEWING",
      clipCandidateCount: 3,
    })).toContain("forced full-pipeline rerun is not safe");
    expect(__processSermonPipelineTestUtils.shouldReuseDurableClipCandidates({
      force: true,
      sermonStatus: "REVIEWING",
      clipCandidateCount: 3,
    })).toBe(false);
  });

  it.each(["source", "audio"] as const)("protects advanced state when the %s artifact is missing", (artifact) => {
    const message = __processSermonPipelineTestUtils.advancedSermonMissingMediaMessage({
      advanced: true,
      artifact,
      usable: false,
    });

    expect(message).toContain("missing or unusable");
    expect(message).toContain("workflow state was preserved");
    expect(__processSermonPipelineTestUtils.advancedSermonMissingMediaMessage({
      advanced: false,
      artifact,
      usable: false,
    })).toBeNull();
    expect(__processSermonPipelineTestUtils.advancedSermonMissingMediaMessage({
      advanced: true,
      artifact,
      usable: true,
    })).toBeNull();
  });

  it("renders suggested clip previews before pastor review", () => {
    const plan = __processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "NOT_RENDERED",
    });

    expect(plan).toEqual({
      preparePreviewVideo: true,
      prepareCaptionFile: false,
    });
  });

  it("skips automatic preview rendering when a preview is already ready", () => {
    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "COMPLETED",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });

    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "COMPLETED",
    }, true)).toEqual({
      preparePreviewVideo: true,
      prepareCaptionFile: false,
    });
  });

  it("does not start another preview render while one is queued or rendering", () => {
    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "QUEUED",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });

    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "RENDERING",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });
  });
});
