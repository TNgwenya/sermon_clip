import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  contentOpportunityFindFirst: vi.fn(),
  contentOpportunityUpdate: vi.fn(),
  transcriptSegmentFindMany: vi.fn(),
  transaction: vi.fn(),
  createOpportunityRevision: vi.fn(),
  recordContentFunnelEvent: vi.fn(),
  requestContentOpportunityGeneration: vi.fn(),
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
    transcriptSegment: {
      findMany: mocks.transcriptSegmentFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/server/contentRevisionService", () => ({
  createOpportunityRevision: mocks.createOpportunityRevision,
}));

vi.mock("@/server/contentFunnelTelemetry", () => ({
  recordContentFunnelEvent: mocks.recordContentFunnelEvent,
}));

vi.mock("@/server/agents/contentOpportunityJobService", () => ({
  requestContentOpportunityGeneration: mocks.requestContentOpportunityGeneration,
}));

vi.mock("@/server/agents/contentMultiplicationService", () => ({
  generateContentOpportunities: mocks.generateContentOpportunities,
  regenerateContentOpportunities: mocks.regenerateContentOpportunities,
}));

import {
  generateContentPackAction,
  regenerateContentOpportunityTypeAction,
  updateContentOpportunityStatusAction,
} from "@/server/actions/contentOpportunities";

function opportunity(status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED") {
  return {
    id: "opportunity-1",
    status,
    opportunityType: "CAPTION",
    sourceTranscriptExcerpt: null,
    editedContent: null,
    bodyContent: "A sermon-grounded caption.",
    approvedContent: status === "APPROVED" ? "Approved sermon-grounded caption." : null,
    title: "A grounded caption",
    shortDescription: "Caption copy",
    relatedScripture: null,
    scriptureTranslation: null,
    scriptureVerifiedAt: null,
    translationReviewState: "NOT_REQUIRED",
    sourceTranscriptSegmentIds: null,
    sourceStartTimeSeconds: null,
    sourceEndTimeSeconds: null,
    structuredContentJson: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentOpportunityUpdate.mockResolvedValue({ id: "opportunity-1" });
  mocks.transcriptSegmentFindMany.mockResolvedValue([]);
  mocks.createOpportunityRevision.mockResolvedValue({ id: "revision-1", revisionNumber: 1 });
  mocks.recordContentFunnelEvent.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    contentOpportunity: { update: mocks.contentOpportunityUpdate },
  }));
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
      data: { status: "USED" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/opportunities");
  });

  it("blocks a pastor quote whose approved wording does not match its transcript evidence", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      ...opportunity("NEEDS_REVIEW"),
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "God will remove every difficult season.",
      sourceTranscriptExcerpt: "God will walk with you through every difficult season.",
    });
    mocks.transcriptSegmentFindMany.mockResolvedValue([{
      id: "segment-1",
      transcriptId: "transcript-1",
      text: "God will walk with you through every difficult season.",
      startTimeSeconds: 42,
      endTimeSeconds: 48,
    }]);

    const result = await updateContentOpportunityStatusAction(
      "sermon-1",
      "opportunity-1",
      "APPROVED",
    );

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/does not match the stored transcript/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not trust a cached quote excerpt when the wording is absent from real transcript rows", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      ...opportunity("NEEDS_REVIEW"),
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "Faithful steps matter.",
      sourceTranscriptExcerpt: "Faithful steps matter.",
    });
    mocks.transcriptSegmentFindMany.mockResolvedValue([{
      id: "segment-actual",
      transcriptId: "transcript-1",
      text: "Faith keeps walking when pressure comes.",
      startTimeSeconds: 42,
      endTimeSeconds: 48,
    }]);

    const result = await updateContentOpportunityStatusAction(
      "sermon-1",
      "opportunity-1",
      "APPROVED",
    );

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/does not match the stored transcript/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a recognized and human-confirmed Scripture version", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      ...opportunity("NEEDS_REVIEW"),
      opportunityType: "SCRIPTURE_GRAPHIC",
      bodyContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1",
      scriptureTranslation: null,
      translationReviewState: "REVIEW_REQUIRED",
    });

    const result = await updateContentOpportunityStatusAction(
      "sermon-1",
      "opportunity-1",
      "APPROVED",
    );

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/recognized Scripture translation/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("records an immutable revision when a grounded idea is approved", async () => {
    mocks.contentOpportunityFindFirst.mockResolvedValue({
      ...opportunity("NEEDS_REVIEW"),
      opportunityType: "QUOTE_GRAPHIC",
      bodyContent: "Faithful steps matter.",
      sourceTranscriptExcerpt: "Every day, faithful steps matter for the journey.",
    });
    mocks.transcriptSegmentFindMany.mockResolvedValue([
      {
        id: "segment-before",
        transcriptId: "transcript-1",
        text: "Every day,",
        startTimeSeconds: 40,
        endTimeSeconds: 41,
      },
      {
        id: "segment-match",
        transcriptId: "transcript-1",
        text: "faithful steps matter for the journey.",
        startTimeSeconds: 41,
        endTimeSeconds: 45,
      },
    ]);

    const result = await updateContentOpportunityStatusAction(
      "sermon-1",
      "opportunity-1",
      "APPROVED",
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.createOpportunityRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contentOpportunityId: "opportunity-1",
        content: "Faithful steps matter.",
        approvalState: "APPROVED",
        sourceTranscriptSegmentIds: ["segment-match"],
        sourceStartTimeSeconds: 41,
        sourceEndTimeSeconds: 45,
      }),
    );
    expect(mocks.createOpportunityRevision.mock.calls[0]?.[1]?.structuredContentJson).not.toHaveProperty("legacyConversion");
    expect(mocks.contentOpportunityUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approvedRevisionId: "revision-1" }),
    }));
  });
});

describe("content opportunity generation actions", () => {
  it("reports a newly queued pack as unfinished work", async () => {
    mocks.requestContentOpportunityGeneration.mockResolvedValue({
      execution: "QUEUED",
      jobId: "job-1",
      reusedExisting: false,
      intentConflict: false,
      progress: "QUEUED",
    });

    const result = await generateContentPackAction("sermon-1", "WEEKLY_CONTENT_PACK");

    expect(result).toMatchObject({
      success: true,
      queued: true,
      jobId: "job-1",
      progress: "QUEUED",
    });
    expect(result.message).toMatch(/queued.*not complete yet/i);
    expect(result.message).not.toMatch(/ready for review/i);
  });

  it("does not claim that a conflicting targeted request was queued", async () => {
    mocks.requestContentOpportunityGeneration.mockResolvedValue({
      execution: "QUEUED",
      jobId: "job-active",
      reusedExisting: true,
      intentConflict: true,
      progress: "RUNNING",
    });

    const result = await regenerateContentOpportunityTypeAction("sermon-1", "QUOTE_GRAPHIC");

    expect(result).toMatchObject({ success: false, queued: false, jobId: "job-active" });
    expect(result.message).toMatch(/different content idea request/i);
  });

  it("surfaces inline repair passes and per-type shortfalls", async () => {
    mocks.requestContentOpportunityGeneration.mockResolvedValue({
      execution: "INLINE",
      jobId: "job-inline",
      result: {
        opportunityCount: 1,
        archivedCount: 0,
        reusedExistingOpportunities: false,
        complete: false,
        repairPasses: 2,
        requestedQuantities: { QUOTE_GRAPHIC: 2 },
        generatedQuantities: { QUOTE_GRAPHIC: 1 },
        shortfalls: [{
          opportunityType: "QUOTE_GRAPHIC",
          requested: 2,
          fulfilled: 1,
          missing: 1,
          reasons: [],
        }],
      },
    });

    const result = await regenerateContentOpportunityTypeAction("sermon-1", "QUOTE_GRAPHIC");

    expect(result).toMatchObject({ success: true, progress: "COMPLETED" });
    expect(result.message).toMatch(/incomplete/i);
    expect(result.message).toMatch(/quote graphic: 1 missing/i);
    expect(result.message).toMatch(/repair ran 2 times/i);
  });
});
