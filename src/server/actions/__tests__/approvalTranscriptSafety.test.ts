import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { approveClipCandidateAction } from "@/server/actions/sermons";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({
    "x-sermonclip-organization-id": "org_local_default",
    "x-sermonclip-campus-id": "campus_local_default",
    "x-sermonclip-actor-id": "user_local_bootstrap",
    "x-sermonclip-authentication": "local-development",
  }),
}));
const createdSermonIds: string[] = [];

describe("clip approval transcript safety", () => {
  afterEach(async () => {
    while (createdSermonIds.length > 0) {
      const sermonId = createdSermonIds.pop();
      if (sermonId) {
        await prisma.sermon.deleteMany({ where: { id: sermonId } });
      }
    }
  });

  it("allows explicit approval without falsely marking uncertain wording as reviewed", async () => {
    const sermonId = `approval-safety-${Date.now()}`;
    const clipId = `${sermonId}-clip`;
    createdSermonIds.push(sermonId);

    await prisma.sermon.create({
      data: {
        id: sermonId,
        organizationId: "org_local_default",
        campusId: "campus_local_default",
        youtubeUrl: `local-approval-test://${sermonId}`,
        title: "Approval Safety Test",
        speakerName: "Pastor Test",
        churchName: "Test Church",
        language: "English and isiZulu",
        rightsConfirmed: true,
        clipCandidates: {
          create: {
            id: clipId,
            isAiGenerated: true,
            startTimeSeconds: 10,
            endTimeSeconds: 55,
            durationSeconds: 45,
            transcriptText: "UNkulunkulu uthembekile, so trust him in every season.",
            transcriptSafetyStatus: "REVIEW_REQUIRED",
            transcriptSafetyReasons: ["CODE_SWITCHING_DETECTED"],
            title: "Trust God in Every Season",
            hook: "UNkulunkulu uthembekile.",
            caption: "Trust God in every season.",
            hashtags: ["#Faith"],
            score: 7.8,
            reasonSelected: "A grounded code-switched faith declaration.",
            clipType: "pastoral",
            riskLevel: "MEDIUM",
            riskReasons: ["CODE_SWITCHING_DETECTED"],
          },
        },
      },
    });

    const result = await approveClipCandidateAction(clipId);

    expect(result).toMatchObject({
      success: true,
    });
    await expect(prisma.clipCandidate.findUniqueOrThrow({
      where: { id: clipId },
      select: { status: true, transcriptSafetyStatus: true },
    })).resolves.toEqual({ status: "APPROVED", transcriptSafetyStatus: "REVIEW_REQUIRED" });
  });
});
