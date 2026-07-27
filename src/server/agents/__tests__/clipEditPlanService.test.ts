import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  clipEditPlan: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
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
  supersedeActiveClipEditPlansForStudioSave,
  tryUpdateClipCandidateForActiveEditPlan,
  updateClipCandidateForActiveEditPlan,
  upsertActiveClipEditPlanForClip,
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

  it("keeps the media composition stable when only post-distribution copy changes", () => {
    const beforeCopyEdit = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: false,
    }));
    const afterCopyEdit = __clipEditPlanTestUtils.buildClipEditPlanSnapshot({
      ...snapshotInput({
        applyCaptionsToClip: false,
      }),
      title: "A revised social title",
      hook: "A revised editorial opener",
      caption: "Revised platform post copy",
      hashtags: ["sermon", "revised"],
    });

    expect(afterCopyEdit.planHash).toBe(beforeCopyEdit.planHash);
    expect(afterCopyEdit.planJson).toMatchObject({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        transcriptText: "A complete thought.",
      },
    });
    expect(afterCopyEdit.planJson).not.toMatchObject({
      clip: expect.objectContaining({
        title: expect.anything(),
        hook: expect.anything(),
        caption: expect.anything(),
        hashtags: expect.anything(),
      }),
    });
  });

  it("recognizes a legacy active plan as the same media composition after removing post copy", () => {
    const current = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      cues: [{ index: 0, startSeconds: 0, endSeconds: 2, text: "Approved words" }],
    }));
    const currentDocument = current.planJson as Record<string, unknown>;
    const currentClip = currentDocument["clip"] as Record<string, unknown>;
    const legacyDocument = {
      ...currentDocument,
      clip: {
        ...currentClip,
        title: "Legacy title",
        hook: "Legacy editorial opener",
        caption: "Legacy platform copy",
        hashtags: ["legacy"],
      },
    };

    expect(__clipEditPlanTestUtils.mediaPlanHashFromPlanJson(legacyDocument)).toBe(current.planHash);
  });

  it("reuses a legacy active plan for a post-copy-only save without invalidating artifacts", async () => {
    const currentInput = snapshotInput({
      applyCaptionsToClip: true,
      cues: [{ index: 0, startSeconds: 0, endSeconds: 2, text: "Approved words" }],
    });
    const current = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(currentInput);
    const currentDocument = current.planJson as Record<string, unknown>;
    const currentClip = currentDocument["clip"] as Record<string, unknown>;
    const legacyPlan = {
      id: "legacy-plan",
      planHash: "legacy-hash-with-post-copy",
      planJson: {
        ...currentDocument,
        clip: {
          ...currentClip,
          title: "Old social title",
          hook: "Old editorial opener",
          caption: "Old platform copy",
          hashtags: ["old-copy"],
        },
      },
    };
    prismaMock.clipCandidate.findUnique.mockResolvedValue({
      ...currentInput,
      title: "New social title",
      hook: "New editorial opener",
      caption: "New platform copy",
      hashtags: ["new-copy"],
    });
    prismaMock.clipEditPlan.findFirst.mockResolvedValue(legacyPlan);

    await expect(upsertActiveClipEditPlanForClip({
      clipCandidateId: "clip-1",
      createdBy: "studio",
      createdReason: "post_copy_saved",
    })).resolves.toMatchObject({
      plan: legacyPlan,
      created: false,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.clipEditPlan.updateMany).not.toHaveBeenCalled();
  });

  it("changes the media composition when approved on-video wording changes", () => {
    const original = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      cues: [{ index: 0, startSeconds: 0, endSeconds: 2, text: "Approved words" }],
    }));
    const revised = __clipEditPlanTestUtils.buildClipEditPlanSnapshot(snapshotInput({
      applyCaptionsToClip: true,
      cues: [{ index: 0, startSeconds: 0, endSeconds: 2, text: "Revised words" }],
    }));

    expect(revised.planHash).not.toBe(original.planHash);
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

  it("supersedes the active worker guard before a Studio composition save", async () => {
    prismaMock.clipEditPlan.updateMany.mockResolvedValue({ count: 1 });

    await expect(supersedeActiveClipEditPlansForStudioSave("clip-1")).resolves.toBe(1);
    expect(prismaMock.clipEditPlan.updateMany).toHaveBeenCalledWith({
      where: {
        clipCandidateId: "clip-1",
        status: "ACTIVE",
      },
      data: {
        status: "SUPERSEDED",
      },
    });
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
