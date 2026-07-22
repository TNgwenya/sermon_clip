import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  transcript: { upsert: vi.fn() },
  transcriptSegment: { deleteMany: vi.fn(), createMany: vi.fn() },
  sermon: { update: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  transcript: { findUnique: vi.fn(), upsert: vi.fn() },
  transcriptSegment: { deleteMany: vi.fn(), createMany: vi.fn() },
  sermon: { update: vi.fn() },
}));

const invalidateTranscriptDerivedClipWorkMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/agents/transcriptChangeInvalidation", () => ({
  invalidateTranscriptDerivedClipWork: invalidateTranscriptDerivedClipWorkMock,
}));

import { __transcriptionTestUtils } from "@/server/agents/transcriptionAgent";

const replacementInput = {
  sermonId: "sermon-1",
  fullText: "Grace meets us here. Faith keeps moving.",
  provider: "openai",
  language: "en",
  transcriptJsonPath: "/storage/sermon-1/transcript/transcript.json",
  words: [
    { text: "Grace", startTimeSeconds: 0, endTimeSeconds: 0.42 },
    { text: "meets", startTimeSeconds: 0.42, endTimeSeconds: 0.88 },
    { text: "us", startTimeSeconds: 0.88, endTimeSeconds: 1.08 },
    { text: "here.", startTimeSeconds: 1.08, endTimeSeconds: 1.45 },
    { text: "Faith", startTimeSeconds: 3, endTimeSeconds: 3.43 },
    { text: "keeps", startTimeSeconds: 3.43, endTimeSeconds: 3.9 },
    { text: "moving.", startTimeSeconds: 3.9, endTimeSeconds: 4.52 },
  ],
  segments: [
    {
      startTimeSeconds: 0,
      endTimeSeconds: 3,
      text: "Grace meets us here.",
      confidence: 0.91,
    },
    {
      startTimeSeconds: 3,
      endTimeSeconds: 6,
      text: "Faith keeps moving.",
      confidence: 0.88,
    },
  ],
};

describe("transcript persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.transcript.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );
    txMock.transcript.upsert.mockResolvedValue({ id: "transcript-1" });
    txMock.transcriptSegment.deleteMany.mockResolvedValue({ count: 2 });
    txMock.transcriptSegment.createMany.mockResolvedValue({ count: 2 });
    txMock.sermon.update.mockResolvedValue({ id: "sermon-1" });
    invalidateTranscriptDerivedClipWorkMock.mockResolvedValue({
      transcriptChanged: false,
      clipsReviewedAgain: 0,
      clipsWithChangedExcerpt: 0,
      clipsWithChangedEvidence: 0,
    });
  });

  it("replaces the transcript, segments, and sermon path inside one transaction", async () => {
    await __transcriptionTestUtils.replaceTranscriptRecords(replacementInput);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.transcript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sermonId: "sermon-1" },
      update: expect.objectContaining({
        fullText: replacementInput.fullText,
        rawJsonPath: replacementInput.transcriptJsonPath,
        wordTimings: replacementInput.words,
      }),
      create: expect.objectContaining({ wordTimings: replacementInput.words }),
    }));
    expect(txMock.transcriptSegment.deleteMany).toHaveBeenCalledWith({
      where: { sermonId: "sermon-1" },
    });
    expect(txMock.transcriptSegment.createMany).toHaveBeenCalledWith({
      data: replacementInput.segments.map((segment) => ({
        sermonId: "sermon-1",
        transcriptId: "transcript-1",
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        text: segment.text,
        confidence: segment.confidence,
        speakerLabel: null,
      })),
    });
    expect(txMock.sermon.update).toHaveBeenCalledWith({
      where: { id: "sermon-1" },
      data: { transcriptJsonPath: replacementInput.transcriptJsonPath },
    });
    expect(prismaMock.transcript.upsert).not.toHaveBeenCalled();
    expect(prismaMock.transcriptSegment.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.transcriptSegment.createMany).not.toHaveBeenCalled();
    expect(prismaMock.sermon.update).not.toHaveBeenCalled();

    expect(txMock.transcript.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.transcriptSegment.deleteMany.mock.invocationCallOrder[0],
    );
    expect(txMock.transcriptSegment.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.transcriptSegment.createMany.mock.invocationCallOrder[0],
    );
    expect(txMock.transcriptSegment.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.sermon.update.mock.invocationCallOrder[0],
    );
  });

  it("stores database null when the provider returns no word timestamps", async () => {
    await __transcriptionTestUtils.replaceTranscriptRecords({
      ...replacementInput,
      words: [],
    });

    expect(txMock.transcript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ wordTimings: Prisma.DbNull }),
      create: expect.objectContaining({ wordTimings: Prisma.DbNull }),
    }));
  });

  it("does not update the sermon path when segment insertion fails", async () => {
    txMock.transcriptSegment.createMany.mockRejectedValueOnce(new Error("segment insert failed"));

    await expect(
      __transcriptionTestUtils.replaceTranscriptRecords(replacementInput),
    ).rejects.toThrow("segment insert failed");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.sermon.update).not.toHaveBeenCalled();
  });

  it("does not install a new transcript when fail-closed clip invalidation fails", async () => {
    prismaMock.transcript.findUnique.mockResolvedValue({
      fullText: "Old transcript wording.",
      segments: [{
        startTimeSeconds: 0,
        endTimeSeconds: 3,
        text: "Old transcript wording.",
        confidence: 0.75,
      }],
    });
    invalidateTranscriptDerivedClipWorkMock.mockRejectedValueOnce(new Error("clip invalidation failed"));

    await expect(
      __transcriptionTestUtils.replaceTranscriptRecords(replacementInput),
    ).rejects.toThrow("clip invalidation failed");

    expect(invalidateTranscriptDerivedClipWorkMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
