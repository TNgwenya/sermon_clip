import { describe, expect, it } from "vitest";
import type { ClipCandidate } from "@prisma/client";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __operationsDiagnosticsTestUtils } from "../operationsDiagnostics";

type ConsistencyClip = Pick<ClipCandidate,
  | "id"
  | "sermonId"
  | "status"
  | "renderStatus"
  | "renderedFilePath"
  | "exportStatus"
  | "exportedFilePath"
  | "captionStatus"
  | "subtitleFilePath"
  | "captionBurnStatus"
  | "captionedVideoPath"
  | "overlayStatus"
  | "overlayVideoPath"
> & {
  title?: string | null;
  sermon?: { title: string } | null;
};

function createRepositoryStub() {
  return {
    countSermons: async () => 2,
    countClips: async (where?: Record<string, unknown>) => {
      if (!where || Object.keys(where).length === 0) {
        return 12;
      }

      if (where.renderStatus === "COMPLETED") {
        return 5;
      }

      if (where.status === "APPROVED") {
        return 4;
      }

      const hasApprovedExportedStatus =
        where.status &&
        typeof where.status === "object" &&
        "in" in where.status &&
        Array.isArray(where.status.in) &&
        where.status.in.includes("APPROVED") &&
        where.status.in.includes("EXPORTED");

      if (hasApprovedExportedStatus && Object.keys(where).length === 1) {
        return 7;
      }

      if (where.status === "SUGGESTED") {
        return 3;
      }

      if (where.captionStatus === "GENERATED") {
        return 3;
      }

      if (where.overlayStatus === "COMPLETED") {
        return 2;
      }

      if (where.exportStatus === "COMPLETED") {
        return 3;
      }

      if (where.renderStatus === "FAILED") {
        return 1;
      }

      if (where.exportStatus === "FAILED") {
        return 2;
      }

      if (where.captionStatus === "FAILED") {
        return 1;
      }

      if (where.captionBurnStatus === "FAILED") {
        return 1;
      }

      if (where.overlayStatus === "FAILED") {
        return 1;
      }

      if (where.renderStatus === "RENDERING") {
        return 2;
      }

      if (where.exportStatus === "EXPORTING") {
        return 1;
      }

      if (where.captionStatus === "GENERATING") {
        return 1;
      }

      if (where.captionBurnStatus === "BURNING") {
        return 1;
      }

      if (where.overlayStatus === "RENDERING") {
        return 1;
      }

      if (where.renderFreshness && typeof where.renderFreshness === "object") {
        return 2;
      }

      if (where.captionFreshness && typeof where.captionFreshness === "object") {
        return 1;
      }

      if (where.captionBurnFreshness && typeof where.captionBurnFreshness === "object") {
        return 1;
      }

      if (where.overlayFreshness && typeof where.overlayFreshness === "object") {
        return 0;
      }

      if (where.exportFreshness && typeof where.exportFreshness === "object") {
        return 2;
      }

      return 0;
    },
    countProcessingJobs: async (where?: Record<string, unknown>) => {
      if (where?.status === "RUNNING") {
        return 1;
      }

      return 0;
    },
    findProcessingJobsForDiagnostics: async () => [
      {
        id: "failed-then-succeeded",
        sermonId: "sermon-a",
        type: "GENERATE_SUBTITLES" as const,
        status: "FAILED" as const,
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        id: "latest-success",
        sermonId: "sermon-a",
        type: "GENERATE_SUBTITLES" as const,
        status: "SUCCEEDED" as const,
        updatedAt: new Date("2026-06-23T10:05:00.000Z"),
      },
      {
        id: "current-failure",
        sermonId: "sermon-b",
        type: "EXPORT_CLIPS" as const,
        status: "FAILED" as const,
        updatedAt: new Date("2026-06-23T11:00:00.000Z"),
      },
    ],
    findClipsForConsistency: async (): Promise<ConsistencyClip[]> => [
      {
        id: "clip-a",
        sermonId: "sermon-a",
        title: "Use Your Gift",
        sermon: { title: "Stirring Up Your Gift" },
        status: "APPROVED",
        renderStatus: "COMPLETED",
        renderedFilePath: null,
        exportStatus: "NOT_EXPORTED",
        exportedFilePath: null,
        captionStatus: "NOT_GENERATED",
        subtitleFilePath: null,
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
      },
      {
        id: "clip-b",
        sermonId: "sermon-a",
        status: "SUGGESTED",
        renderStatus: "FAILED",
        renderedFilePath: null,
        exportStatus: "FAILED",
        exportedFilePath: null,
        captionStatus: "FAILED",
        subtitleFilePath: null,
        captionBurnStatus: "FAILED",
        captionedVideoPath: null,
        overlayStatus: "FAILED",
        overlayVideoPath: null,
      },
    ],
  };
}

describe("operations diagnostics", () => {
  it("aggregates operational metrics", async () => {
    const service = __operationsDiagnosticsTestUtils.createOperationsDiagnosticsService(
      createRepositoryStub(),
    );

    const metrics = await service.getOperationalMetrics();

    expect(metrics.sermonsProcessed).toBe(2);
    expect(metrics.clipsGenerated).toBe(12);
    expect(metrics.clipsApproved).toBe(7);
    expect(metrics.clipsRendered).toBe(5);
    expect(metrics.clipsCaptioned).toBe(3);
    expect(metrics.clipsOverlayed).toBe(2);
    expect(metrics.clipsExported).toBe(3);
    expect(metrics.failedProcessingJobs).toBe(1);
    expect(metrics.failedClipAssets).toBe(6);
    expect(metrics.failedOperations).toBe(7);
    expect(metrics.runningOperations).toBe(7);
    expect(metrics.outdatedAssets).toBe(6);
    expect(metrics.pendingActions).toBe(9);
  });

  it("counts only unresolved latest failed processing jobs", () => {
    const unresolvedCount = __operationsDiagnosticsTestUtils.countUnresolvedFailedProcessingJobs([
      {
        sermonId: "sermon-a",
        type: "EXPORT_CLIPS",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        sermonId: "sermon-a",
        type: "EXPORT_CLIPS",
        status: "SUCCEEDED",
        updatedAt: new Date("2026-06-23T10:05:00.000Z"),
      },
      {
        sermonId: "sermon-b",
        type: "TRANSCRIBE_AUDIO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T11:00:00.000Z"),
      },
    ]);

    expect(unresolvedCount).toBe(1);
  });

  it("selects only the latest unresolved failed jobs for health recovery", () => {
    const retries = __operationsDiagnosticsTestUtils.selectUnresolvedFailedProcessingJobRetries([
      {
        id: "old-failed-download",
        sermonId: "sermon-a",
        type: "DOWNLOAD_VIDEO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        id: "new-success-download",
        sermonId: "sermon-a",
        type: "DOWNLOAD_VIDEO",
        status: "SUCCEEDED",
        updatedAt: new Date("2026-06-23T10:10:00.000Z"),
      },
      {
        id: "failed-transcribe",
        sermonId: "sermon-b",
        type: "TRANSCRIBE_AUDIO",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T11:00:00.000Z"),
      },
      {
        id: "failed-generate",
        sermonId: "sermon-c",
        type: "GENERATE_CLIPS",
        status: "FAILED",
        updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      },
    ], 1);

    expect(retries.map((job) => job.id)).toEqual(["failed-generate"]);
  });

  it("does not treat stale failed jobs as retryable after a newer run resolved the step", () => {
    const jobs = [
      {
        id: "old-failed-download",
        sermonId: "sermon-a",
        type: "DOWNLOAD_VIDEO" as const,
        status: "FAILED" as const,
        updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      },
      {
        id: "new-success-download",
        sermonId: "sermon-a",
        type: "DOWNLOAD_VIDEO" as const,
        status: "SUCCEEDED" as const,
        updatedAt: new Date("2026-06-23T10:10:00.000Z"),
      },
    ];

    expect(__operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(jobs[0], jobs)).toBe(false);
  });

  it("removes failed child retries only after a later successful full pipeline", () => {
    const failedChild = {
      id: "failed-transcribe",
      sermonId: "sermon-a",
      type: "TRANSCRIBE_AUDIO" as const,
      status: "FAILED" as const,
      updatedAt: new Date("2026-07-18T10:00:00.000Z"),
    };
    const staleActiveChild = {
      id: "stale-download",
      sermonId: "sermon-a",
      type: "DOWNLOAD_VIDEO" as const,
      status: "RUNNING" as const,
      updatedAt: new Date(0),
    };
    const otherSermonFailure = {
      id: "other-sermon-clips",
      sermonId: "sermon-b",
      type: "GENERATE_CLIPS" as const,
      status: "FAILED" as const,
      updatedAt: new Date("2026-07-18T10:30:00.000Z"),
    };
    const jobs = [
      failedChild,
      staleActiveChild,
      otherSermonFailure,
      {
        id: "successful-parent",
        sermonId: "sermon-a",
        type: "PROCESS_SERMON" as const,
        status: "SUCCEEDED" as const,
        updatedAt: new Date("2026-07-18T11:00:00.000Z"),
      },
    ];

    expect(__operationsDiagnosticsTestUtils.countUnresolvedFailedProcessingJobs(jobs)).toBe(2);
    expect(__operationsDiagnosticsTestUtils.selectUnresolvedFailedProcessingJobRetries(jobs, 10).map((job) => job.id)).toEqual([
      "other-sermon-clips",
      "stale-download",
    ]);
    expect(__operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(failedChild, jobs)).toBe(false);
    expect(__operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(staleActiveChild, jobs)).toBe(true);
  });

  it("keeps a failed full pipeline unresolved after a later child succeeds", () => {
    const failedParent = {
      id: "failed-parent",
      sermonId: "sermon-a",
      type: "PROCESS_SERMON" as const,
      status: "FAILED" as const,
      updatedAt: new Date("2026-07-18T10:00:00.000Z"),
    };
    const jobs = [
      failedParent,
      {
        id: "successful-child",
        sermonId: "sermon-a",
        type: "GENERATE_CLIPS" as const,
        status: "SUCCEEDED" as const,
        updatedAt: new Date("2026-07-18T11:00:00.000Z"),
      },
    ];

    expect(__operationsDiagnosticsTestUtils.countUnresolvedFailedProcessingJobs(jobs)).toBe(1);
    expect(__operationsDiagnosticsTestUtils.selectUnresolvedFailedProcessingJobRetries(jobs, 10).map((job) => job.id)).toEqual([
      "failed-parent",
    ]);
    expect(__operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(failedParent, jobs)).toBe(true);
  });

  it("keeps forced media steps and specialized clip failures recoverable", () => {
    const forcedMediaSteps = ([
      "DOWNLOAD_VIDEO",
      "EXTRACT_AUDIO",
      "TRANSCRIBE_AUDIO",
    ] as const).map((type, index) => ({
      id: `forced-${type.toLowerCase()}`,
      sermonId: "sermon-a",
      type,
      status: "FAILED" as const,
      updatedAt: new Date(`2026-07-18T10:0${index}:00.000Z`),
      generationSummary: {
        failure: { details: { forceRequested: true } },
      },
    }));
    const specializedClips = {
      id: "redo-clips",
      sermonId: "sermon-a",
      type: "GENERATE_CLIPS" as const,
      status: "FAILED" as const,
      updatedAt: new Date("2026-07-18T10:05:00.000Z"),
      generationSummary: { mode: "redo" },
    };
    const jobs = [
      ...forcedMediaSteps,
      specializedClips,
      {
        id: "successful-parent",
        sermonId: "sermon-a",
        type: "PROCESS_SERMON" as const,
        status: "SUCCEEDED" as const,
        updatedAt: new Date("2026-07-18T11:00:00.000Z"),
      },
    ];

    expect(__operationsDiagnosticsTestUtils.countUnresolvedFailedProcessingJobs(jobs)).toBe(4);
    expect(__operationsDiagnosticsTestUtils.selectUnresolvedFailedProcessingJobRetries(jobs, 10).map((job) => job.id)).toEqual([
      "redo-clips",
      "forced-transcribe_audio",
      "forced-extract_audio",
      "forced-download_video",
    ]);
    expect(forcedMediaSteps.every((job) => (
      __operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(job, jobs)
    ))).toBe(true);
    expect(__operationsDiagnosticsTestUtils.isLatestUnresolvedFailedProcessingJobRetry(specializedClips, jobs)).toBe(true);
  });

  it("returns checklist items", async () => {
    const service = __operationsDiagnosticsTestUtils.createOperationsDiagnosticsService(
      createRepositoryStub(),
    );

    const checklist = service.getReadinessChecklist({
      sermonsProcessed: 1,
      clipsGenerated: 2,
      clipsApproved: 1,
      clipsRendered: 1,
      clipsCaptioned: 1,
      clipsOverlayed: 1,
      clipsExported: 1,
      failedProcessingJobs: 0,
      failedClipAssets: 0,
      failedOperations: 0,
      runningOperations: 0,
      pendingActions: 0,
      outdatedAssets: 0,
    });

    expect(checklist).toHaveLength(9);
    expect(checklist.every((item) => item.ready)).toBe(true);
  });

  it("detects consistency issues", async () => {
    const service = __operationsDiagnosticsTestUtils.createOperationsDiagnosticsService(
      createRepositoryStub(),
    );

    const summary = await service.getDataConsistencySummary();

    expect(summary.issueCount).toBeGreaterThan(0);
    expect(summary.issues.join(" ")).toContain("render status is COMPLETED but rendered path is missing");
    expect(summary.issueDetails[0]).toMatchObject({
      clipId: "clip-a",
      sermonId: "sermon-a",
      clipTitle: "Use Your Gift",
      sermonTitle: "Stirring Up Your Gift",
      assetLabel: "Rendered video",
      blocksPosting: true,
    });
    expect(summary.issueDetails[0].recoveryAction).toContain("prepare the clip again");
    expect(summary.affectedClipIds).toEqual(["clip-a"]);
    expect(summary.affectedSermonIds).toEqual(["sermon-a"]);
  });

  it("keeps draft clip consistency issues out of posting blocker counts", async () => {
    const service = __operationsDiagnosticsTestUtils.createOperationsDiagnosticsService({
      ...createRepositoryStub(),
      findClipsForConsistency: async (): Promise<ConsistencyClip[]> => [
        {
          id: "draft-clip",
          sermonId: "sermon-a",
          status: "SUGGESTED",
          renderStatus: "COMPLETED",
          renderedFilePath: null,
          exportStatus: "NOT_EXPORTED",
          exportedFilePath: null,
          captionStatus: "NOT_GENERATED",
          subtitleFilePath: null,
          captionBurnStatus: "NOT_BURNED",
          captionedVideoPath: null,
          overlayStatus: "NOT_RENDERED",
          overlayVideoPath: null,
        },
      ],
    });

    const summary = await service.getDataConsistencySummary();

    expect(summary.issueCount).toBe(0);
    expect(summary.affectedClipIds).toEqual([]);
    expect(summary.draftIssueCount).toBe(1);
    expect(summary.draftIssueDetails[0]).toMatchObject({
      clipId: "draft-clip",
      clipTitle: "draft-clip",
      assetLabel: "Rendered video",
      blocksPosting: false,
    });
    expect(summary.affectedDraftClipIds).toEqual(["draft-clip"]);
    expect(summary.totalIssueCount).toBe(1);
  });

  it("treats zero-byte completed media files as posting blockers", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "diagnostics-empty-"));
    try {
      const renderedPath = path.join(directory, "rendered.mp4");
      await writeFile(renderedPath, "");
      const service = __operationsDiagnosticsTestUtils.createOperationsDiagnosticsService({
        ...createRepositoryStub(),
        findClipsForConsistency: async (): Promise<ConsistencyClip[]> => [
          {
            id: "empty-render",
            sermonId: "sermon-empty",
            status: "APPROVED",
            renderStatus: "COMPLETED",
            renderedFilePath: renderedPath,
            exportStatus: "NOT_EXPORTED",
            exportedFilePath: null,
            captionStatus: "NOT_GENERATED",
            subtitleFilePath: null,
            captionBurnStatus: "NOT_BURNED",
            captionedVideoPath: null,
            overlayStatus: "NOT_RENDERED",
            overlayVideoPath: null,
          },
        ],
      });

      const summary = await service.getDataConsistencySummary();

      expect(summary.issueCount).toBe(1);
      expect(summary.issues.join(" ")).toContain("does not exist on disk or is empty");
      expect(summary.affectedClipIds).toEqual(["empty-render"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
