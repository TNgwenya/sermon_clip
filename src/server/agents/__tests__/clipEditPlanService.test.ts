import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  clipEditPlan: {
    findFirst: vi.fn(),
  },
  clipCandidate: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  clipArtifact: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  STALE_CLIP_COMPOSITION_ERROR_CODE,
  StaleClipCompositionError,
  __clipEditPlanTestUtils,
  assertClipEditPlanStillActive,
  isStaleClipCompositionError,
  preferStaleClipCompositionError,
  recordClipArtifact,
  tryUpdateClipCandidateForActiveEditPlan,
  updateClipCandidateForActiveEditPlan,
} from "../clipEditPlanService";

const guard = {
  clipCandidateId: "clip-1",
  editPlanId: "plan-3",
  planHash: "hash-3",
};

type SnapshotInput = Parameters<typeof __clipEditPlanTestUtils.buildClipEditPlanSnapshot>[0];

function snapshotInput(captionData: SnapshotInput["captionData"]): SnapshotInput {
  return {
    id: "clip-1",
    sermonId: "sermon-1",
    startTimeSeconds: 10,
    endTimeSeconds: 70,
    adjustedStartTimeSeconds: null,
    adjustedEndTimeSeconds: null,
    durationSeconds: 60,
    transcriptText: "A complete thought.",
    title: "A title",
    hook: "A hook",
    caption: "Post copy",
    hashtags: ["sermon"],
    exportFormat: "VERTICAL_9_16",
    exportLayoutStrategy: "CENTER_CROP",
    manualCropKeyframes: null,
    captionData,
  };
}

describe("clip edit plan composition guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not churn the composition hash when generated artifact paths or output diagnostics change", () => {
    const base = snapshotInput({
      applyCaptionsToClip: true,
      captionRevealMode: "phrase",
      captionSyncOffsetSeconds: 0,
    });
    const beforeOutput = __clipEditPlanTestUtils.buildClipEditPlanSnapshot({
      ...base,
      renderedFilePath: null,
      captionedVideoPath: null,
      overlayVideoPath: null,
      exportedFilePath: null,
    } as SnapshotInput);
    const afterOutput = __clipEditPlanTestUtils.buildClipEditPlanSnapshot({
      ...snapshotInput({
        applyCaptionsToClip: true,
        captionRevealMode: "phrase",
        captionSyncOffsetSeconds: 0,
        framingDecision: { effectiveLayout: "CENTER_CROP" },
        exportSource: { kind: "PREPARED_RENDERED" },
        exportQualityProfile: { videoEncoder: "h264" },
        speechCleanupPlan: { enabled: true, cuts: [] },
      }),
      renderedFilePath: "/tmp/rendered.mp4",
      captionedVideoPath: "/tmp/captioned.mp4",
      overlayVideoPath: "/tmp/overlay.mp4",
      exportedFilePath: "/tmp/exported.mp4",
    } as SnapshotInput);

    expect(afterOutput.planHash).toBe(beforeOutput.planHash);
    expect(afterOutput.planJson).not.toHaveProperty("artifactPaths");
  });

  it("supersedes the plan for reveal-mode or caption-sync-only Studio edits", () => {
    const phrase = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      captionRevealMode: "phrase",
      captionSyncOffsetSeconds: 0,
    }));
    const oneWordShifted = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      captionRevealMode: "single-word",
      captionSyncOffsetSeconds: 0.25,
    }));

    expect(oneWordShifted.planHash).not.toBe(phrase.planHash);
    expect(oneWordShifted.planJson).toMatchObject({
      captions: {
        captionRevealMode: "single-word",
        captionSyncOffsetSeconds: 0.25,
      },
    });
  });

  it("supersedes the plan when only the canonical caption design changes", () => {
    const clean = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      captionStylePresetId: "clean-lower",
      captionDesign: {
        version: 1,
        presetId: "clean-lower",
        colors: {
          textColor: "#FFFFFF",
          activeTextColor: "#FACC15",
        },
      },
    }));
    const branded = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      captionStylePresetId: "clean-lower",
      captionDesign: {
        version: 1,
        presetId: "clean-lower",
        colors: {
          textColor: "#FFFFFF",
          activeTextColor: "#0F766E",
        },
      },
    }));

    expect(branded.planHash).not.toBe(clean.planHash);
    expect(branded.planJson).toMatchObject({
      schemaVersion: 2,
      captions: {
        captionDesign: {
          colors: {
            activeTextColor: "#0F766E",
          },
        },
      },
    });
  });

  it("accepts the exact active plan captured when a media job started", async () => {
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: guard.editPlanId,
      planHash: guard.planHash,
    });

    await expect(assertClipEditPlanStillActive(guard)).resolves.toEqual({
      id: guard.editPlanId,
      planHash: guard.planHash,
    });
  });

  it("throws a distinct stale-composition error when Studio supersedes the job plan", async () => {
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: "plan-4",
      planHash: "hash-4",
    });

    const assertion = assertClipEditPlanStillActive(guard);

    await expect(assertion).rejects.toBeInstanceOf(StaleClipCompositionError);
    await expect(assertion).rejects.toMatchObject({
      code: STALE_CLIP_COMPOSITION_ERROR_CODE,
      expectedEditPlanId: "plan-3",
      activeEditPlanId: "plan-4",
    });
  });

  it("prefers stale-plan cleanup when a media command also fails after a newer save", async () => {
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: "plan-4",
      planHash: "hash-4",
    });

    const completionError = await preferStaleClipCompositionError(
      guard,
      new Error("FFmpeg exited unexpectedly"),
    );

    expect(completionError).toBeInstanceOf(StaleClipCompositionError);
    expect(completionError).toMatchObject({ activeEditPlanId: "plan-4" });
  });

  it("retains the media error when the job plan is still active", async () => {
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: guard.editPlanId,
      planHash: guard.planHash,
    });
    const mediaError = new Error("FFmpeg exited unexpectedly");

    await expect(preferStaleClipCompositionError(guard, mediaError)).resolves.toBe(mediaError);
  });

  it("uses the active-plan relation as an atomic compare-and-swap for completion metadata", async () => {
    prismaMock.clipCandidate.updateMany.mockResolvedValue({ count: 1 });

    await updateClipCandidateForActiveEditPlan({
      guard,
      data: {
        renderStatus: "COMPLETED",
        renderFreshness: "UP_TO_DATE",
      },
    });

    expect(prismaMock.clipCandidate.updateMany).toHaveBeenCalledWith({
      where: {
        id: "clip-1",
        editPlans: {
          some: {
            id: "plan-3",
            planHash: "hash-3",
            status: "ACTIVE",
          },
        },
      },
      data: {
        renderStatus: "COMPLETED",
        renderFreshness: "UP_TO_DATE",
      },
    });
  });

  it("rejects a completion write when the guarded plan is no longer active", async () => {
    prismaMock.clipCandidate.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: "plan-4",
      planHash: "hash-4",
    });

    const update = updateClipCandidateForActiveEditPlan({
      guard,
      data: { exportStatus: "COMPLETED" },
    });

    await expect(update).rejects.toSatisfy((error: unknown) => (
      isStaleClipCompositionError(error)
      && error.activeEditPlanId === "plan-4"
    ));
  });

  it("silently declines failure metadata when a newer plan won the race", async () => {
    prismaMock.clipCandidate.updateMany.mockResolvedValue({ count: 0 });

    await expect(tryUpdateClipCandidateForActiveEditPlan({
      guard,
      data: { renderStatus: "FAILED" },
    })).resolves.toBe(false);
  });

  it("attributes a ready artifact to the captured plan and rechecks that plan before creation", async () => {
    prismaMock.clipCandidate.findUnique.mockResolvedValue({
      id: "clip-1",
      sermonId: "sermon-1",
    });
    prismaMock.clipEditPlan.findFirst.mockResolvedValue({
      id: guard.editPlanId,
      planHash: guard.planHash,
    });
    prismaMock.clipArtifact.create.mockResolvedValue({ id: "artifact-1" });

    await recordClipArtifact({
      clipCandidateId: "clip-1",
      kind: "EXPORT",
      filePath: "/tmp/current.mp4",
      editPlan: {
        editPlanId: guard.editPlanId,
        planHash: guard.planHash,
      },
    });

    expect(prismaMock.clipArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        editPlanId: "plan-3",
        planHash: "hash-3",
        freshness: "UP_TO_DATE",
      }),
    }));
  });
});
