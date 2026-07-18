import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  contentOpportunityFindFirst: vi.fn(),
  contentOpportunityUpdate: vi.fn(),
  generateContentOpportunities: vi.fn(),
  regenerateContentOpportunities: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentOpportunity: {
      findFirst: mocks.contentOpportunityFindFirst,
      update: mocks.contentOpportunityUpdate,
    },
  },
}));

vi.mock("@/server/agents/contentMultiplicationService", () => ({
  generateContentOpportunities: mocks.generateContentOpportunities,
  regenerateContentOpportunities: mocks.regenerateContentOpportunities,
}));

import { updateContentOpportunityStatusAction } from "@/server/actions/contentOpportunities";

function opportunity(status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED") {
  return {
    id: "opportunity-1",
    status,
    opportunityType: "CAPTION",
    sourceTranscriptExcerpt: null,
    editedContent: null,
    bodyContent: "A sermon-grounded caption.",
    approvedContent: status === "APPROVED" ? "Approved sermon-grounded caption." : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentOpportunityUpdate.mockResolvedValue({ id: "opportunity-1" });
});

describe("content opportunity approval gate", () => {
  it.each(["DRAFT", "NEEDS_REVIEW"] as const)(
    "rejects the transition from %s to USED without updating the opportunity",
    async (status) => {
      mocks.contentOpportunityFindFirst.mockResolvedValue(opportunity(status));

      const result = await updateContentOpportunityStatusAction(
        "sermon-1",
        "opportunity-1",
        "USED",
      );

      expect(result).toMatchObject({ success: false });
      expect(result.message).toMatch(/approv/i);
      expect(mocks.contentOpportunityUpdate).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("allows an approved opportunity to be marked used", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue(opportunity("APPROVED"));

    const result = await updateContentOpportunityStatusAction(
      "sermon-1",
      "opportunity-1",
      "USED",
    );

    expect(result).toEqual({
      success: true,
      message: "Opportunity marked as USED.",
    });
    expect(mocks.contentOpportunityUpdate).toHaveBeenCalledWith({
      where: { id: "opportunity-1" },
      data: {
        status: "USED",
        approvedContent: "Approved sermon-grounded caption.",
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/opportunities");
  });
});
