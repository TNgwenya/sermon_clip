import { describe, expect, it } from "vitest";

import {
  deriveDashboardWorkflow,
  derivePastorSermonWorkflow,
  deriveSermonWorkspaceAction,
  isStaleActiveProcessingJob,
  pastorFailedStepMessage,
  pastorJobStepLabel,
  resolvePastorProcessingStepStatus,
  selectUnresolvedPastorFailedJobs,
} from "@/lib/pastorWorkflow";

describe("pastor workflow", () => {
  it("shows a durable completed step despite an older failed retry", () => {
    expect(resolvePastorProcessingStepStatus({
      complete: true,
      completionEvidenceAt: new Date("2026-07-18T10:01:00.000Z"),
      jobStatus: "FAILED",
      jobStartedAt: new Date("2026-07-18T10:00:00.000Z"),
      staleActiveJob: false,
    })).toBe("Complete");
  });

  it("shows a newer failed retry when its only output is from an older attempt", () => {
    expect(resolvePastorProcessingStepStatus({
      complete: true,
      completionEvidenceAt: new Date("2026-07-18T09:00:00.000Z"),
      jobStatus: "FAILED",
      jobStartedAt: new Date("2026-07-18T10:00:00.000Z"),
      staleActiveJob: false,
    })).toBe("Failed");
  });

  it("shows a newer running retry instead of masking it with older output", () => {
    expect(resolvePastorProcessingStepStatus({
      complete: true,
      completionEvidenceAt: new Date("2026-07-18T09:00:00.000Z"),
      jobStatus: "RUNNING",
      jobStartedAt: new Date("2026-07-18T10:00:00.000Z"),
      staleActiveJob: false,
    })).toBe("Current / Running");
  });

  it.each([
    {
      label: "publishes exported work despite historical failures and live analysis",
      input: {
        hasExportedClips: true,
        hasApprovedClips: true,
        hasGeneratedMoments: true,
        hasFreshLiveAnalysis: true,
        hasBlockingFailure: true,
      },
      expected: "publish",
    },
    {
      label: "edits approved work despite historical failures and live analysis",
      input: {
        hasExportedClips: false,
        hasApprovedClips: true,
        hasGeneratedMoments: true,
        hasFreshLiveAnalysis: true,
        hasBlockingFailure: true,
      },
      expected: "edit",
    },
    {
      label: "reviews generated moments despite historical failures and live analysis",
      input: {
        hasExportedClips: false,
        hasApprovedClips: false,
        hasGeneratedMoments: true,
        hasFreshLiveAnalysis: true,
        hasBlockingFailure: true,
      },
      expected: "review",
    },
    {
      label: "shows fresh analysis before recovery",
      input: {
        hasExportedClips: false,
        hasApprovedClips: false,
        hasGeneratedMoments: false,
        hasFreshLiveAnalysis: true,
        hasBlockingFailure: true,
      },
      expected: "working",
    },
    {
      label: "recovers when failure blocks an immature sermon",
      input: {
        hasExportedClips: false,
        hasApprovedClips: false,
        hasGeneratedMoments: false,
        hasFreshLiveAnalysis: false,
        hasBlockingFailure: true,
      },
      expected: "recover",
    },
    {
      label: "analyzes a sermon with no mature or active work",
      input: {
        hasExportedClips: false,
        hasApprovedClips: false,
        hasGeneratedMoments: false,
        hasFreshLiveAnalysis: false,
        hasBlockingFailure: false,
      },
      expected: "analyze",
    },
  ] as const)("derives the workspace action: $label", ({ input, expected }) => {
    expect(deriveSermonWorkspaceAction(input)).toBe(expected);
  });

  it("guides a new dashboard toward adding a sermon", () => {
    const workflow = deriveDashboardWorkflow({
      sermonCount: 0,
      clipsGenerated: 0,
      clipsApproved: 0,
      clipsPrepared: 0,
      readyClipCount: 0,
      failedOperationCount: 0,
      pendingPastorActionCount: 0,
    });

    expect(workflow.nextAction).toBe("Add this week's sermon to start the clipping workflow.");
    expect(workflow.steps.map((step) => [step.label, step.ready])).toEqual([
      ["Upload sermon", false],
      ["Review suggestions", false],
      ["Approve clips", false],
      ["Prepare clips", false],
      ["Download and post", false],
    ]);
  });

  it("shows dashboard progress through the ready-to-post path", () => {
    const workflow = deriveDashboardWorkflow({
      sermonCount: 1,
      clipsGenerated: 5,
      clipsApproved: 3,
      clipsPrepared: 2,
      readyClipCount: 2,
      failedOperationCount: 0,
      pendingPastorActionCount: 0,
    });

    expect(workflow.nextAction).toBe("Your finished clips are ready to download and post.");
    expect(workflow.steps.every((step) => step.ready)).toBe(true);
  });

  it("moves a sermon from processing to review to prepare to post", () => {
    expect(
      derivePastorSermonWorkflow({
        sourceVideoReady: true,
        transcriptReady: false,
        clipGenerationComplete: false,
        suggestedClipCount: 0,
        approvedOrReadyClipCount: 0,
        preparedClipCount: 0,
        failedStepCount: 0,
        staleClipCount: 0,
      }).primaryAction,
    ).toBe("process");

    expect(
      derivePastorSermonWorkflow({
        sourceVideoReady: true,
        transcriptReady: true,
        clipGenerationComplete: true,
        suggestedClipCount: 4,
        approvedOrReadyClipCount: 0,
        preparedClipCount: 0,
        failedStepCount: 0,
        staleClipCount: 0,
      }).primaryAction,
    ).toBe("review");

    expect(
      derivePastorSermonWorkflow({
        sourceVideoReady: true,
        transcriptReady: true,
        clipGenerationComplete: true,
        suggestedClipCount: 4,
        approvedOrReadyClipCount: 2,
        preparedClipCount: 0,
        failedStepCount: 0,
        staleClipCount: 0,
      }).primaryAction,
    ).toBe("prepare");

    expect(
      derivePastorSermonWorkflow({
        sourceVideoReady: true,
        transcriptReady: true,
        clipGenerationComplete: true,
        suggestedClipCount: 4,
        approvedOrReadyClipCount: 2,
        preparedClipCount: 2,
        failedStepCount: 0,
        staleClipCount: 0,
      }).primaryAction,
    ).toBe("post");
  });

  it("keeps recovery guidance pastor-friendly", () => {
    const workflow = derivePastorSermonWorkflow({
      sourceVideoReady: true,
      transcriptReady: true,
      clipGenerationComplete: true,
      suggestedClipCount: 3,
      approvedOrReadyClipCount: 1,
      preparedClipCount: 0,
      failedStepCount: 1,
      staleClipCount: 2,
      latestFailedStepType: "TRANSCRIBE_AUDIO",
    });

    expect(workflow.nextAction).toBe("Prepare approved clips");
    expect(workflow.attentionItems).toEqual([
      "The sermon transcript did not finish. Try creating the transcript again before finding clips.",
      "1 sermon or clip step needs attention.",
      "2 clip(s) should be prepared again.",
    ]);
  });

  it("translates failed processing job names into pastor language", () => {
    expect(pastorJobStepLabel("TRANSCRIBE_AUDIO")).toBe("Create sermon transcript");
    expect(pastorJobStepLabel("UNKNOWN_STEP")).toBe("Sermon workflow step");
    expect(pastorFailedStepMessage("TRANSCRIBE_AUDIO")).toBe(
      "The sermon transcript did not finish. Try creating the transcript again before finding clips.",
    );
    expect(pastorFailedStepMessage("UNKNOWN_STEP")).toBe(
      "One sermon step needs attention. Retry the next best step shown above.",
    );
  });

  it("selects only unresolved failed pastor jobs", () => {
    const jobs = [
      {
        id: "old-failed-download",
        type: "DOWNLOAD_VIDEO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        id: "new-success-download",
        type: "DOWNLOAD_VIDEO",
        status: "SUCCEEDED",
        updatedAt: new Date("2026-06-23T10:05:00.000Z"),
      },
      {
        id: "failed-transcribe",
        type: "TRANSCRIBE_AUDIO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T10:10:00.000Z"),
      },
    ];

    expect(selectUnresolvedPastorFailedJobs(jobs).map((job) => job.id)).toEqual(["failed-transcribe"]);
  });

  it("orders unresolved pastor failures by newest update", () => {
    const jobs = [
      {
        id: "failed-generate",
        type: "GENERATE_CLIPS",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        id: "failed-transcribe",
        type: "TRANSCRIBE_AUDIO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T11:00:00.000Z"),
      },
    ];

    expect(selectUnresolvedPastorFailedJobs(jobs).map((job) => job.id)).toEqual([
      "failed-transcribe",
      "failed-generate",
    ]);
  });

  it("treats old active jobs as recoverable but protects fresh active jobs", () => {
    const now = new Date();
    const staleRunning = {
      id: "stale-transcribe",
      type: "TRANSCRIBE_AUDIO",
      status: "RUNNING",
      updatedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    };
    const freshRunning = {
      id: "fresh-download",
      type: "DOWNLOAD_VIDEO",
      status: "RUNNING",
      updatedAt: new Date(now.getTime() - 15 * 60 * 1000),
    };

    expect(isStaleActiveProcessingJob(staleRunning, now)).toBe(true);
    expect(isStaleActiveProcessingJob(freshRunning, now)).toBe(false);
    expect(selectUnresolvedPastorFailedJobs([staleRunning, freshRunning]).map((job) => job.id)).toEqual([
      "stale-transcribe",
    ]);
  });
});
