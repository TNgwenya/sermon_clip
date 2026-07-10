import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { approveClipCandidateAction } from "@/server/actions/sermons";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
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

  it("blocks the legacy approval action until transcript wording is explicitly reviewed", async () => {
    const sermonId = `approval-safety-${Date.now()}`;
    const clipId = `${sermonId}-clip`;
    createdSermonIds.push(sermonId);

    await prisma.sermon.create({
      data: {
        id: sermonId,
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
      success: false,
      message: "Listen to the clip and confirm the transcript wording before approval.",
    });
    await expect(prisma.clipCandidate.findUniqueOrThrow({
      where: { id: clipId },
      select: { status: true },
    })).resolves.toEqual({ status: "SUGGESTED" });
  });
});
