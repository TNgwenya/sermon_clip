import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  liveRecordingFindUnique: vi.fn(),
  liveRecordingUpdate: vi.fn(),
  liveRecordingUpdateMany: vi.fn(),
  sermonFindFirst: vi.fn(),
  sermonCreate: vi.fn(),
  sourceAssetCreate: vi.fn(),
  organizationFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  queue: vi.fn(),
  assertOwned: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => unknown) => run({
      $queryRaw: mocks.queryRaw,
      liveRecording: {
        findUnique: mocks.liveRecordingFindUnique,
        update: mocks.liveRecordingUpdate,
      },
      organization: { findUnique: mocks.organizationFindUnique },
      sermon: { create: mocks.sermonCreate },
      sermonSourceAsset: { create: mocks.sourceAssetCreate },
      auditEvent: { create: mocks.auditCreate },
    }),
    liveRecording: {
      findUnique: mocks.liveRecordingFindUnique,
      updateMany: mocks.liveRecordingUpdateMany,
    },
    sermon: { findFirst: mocks.sermonFindFirst },
  },
}));

vi.mock("@/server/agents/processing", () => ({
  queueSermonProcessingJob: mocks.queue,
}));

vi.mock("@/server/media/s3SourceStorage", () => ({
  assertS3SourceObjectOwnedBy: mocks.assertOwned,
}));

vi.mock("./cloudflareStream", () => ({
  createCloudflareLiveInput: vi.fn(),
  liveIntakeProviderReady: vi.fn(),
}));

import { createAndQueueMaterializedLiveRecording } from "./service";

const recording = {
  id: "recording-1",
  organizationId: "org-1",
  title: null,
  durationSeconds: 7_200,
  receivedAt: new Date("2026-08-23T09:00:00.000Z"),
  sermonId: null,
  status: "RECEIVED",
  liveIntake: { id: "intake-1", organizationId: "org-1", campusId: "campus-1", status: "READY" },
  sermon: null,
};

const source = {
  bucket: "private-sources",
  objectKey: "sermon-sources/organizations/org-1/sermons/sermon-1/uuid/source.mp4",
  region: "eu-central-1",
  sizeBytes: 10_000,
  contentType: "video/mp4",
  originalFileName: "sunday-live-recording.mp4",
  versionId: "version-1",
  status: "READY" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.liveRecordingFindUnique
    .mockResolvedValueOnce(recording)
    .mockResolvedValueOnce({ ...recording, sermonId: "sermon-1" });
  mocks.organizationFindUnique.mockResolvedValue({
    id: "org-1",
    name: "Grace Church",
    defaultLanguage: "en",
    brandingSettings: { churchName: "Grace Community Church" },
    automationSettings: { defaultLanguage: "zu", defaultSpeakerName: "Pastor Nandi" },
  });
  mocks.sermonCreate.mockResolvedValue({ id: "sermon-1" });
  mocks.sourceAssetCreate.mockResolvedValue({ id: "asset-1" });
  mocks.liveRecordingUpdate.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.sermonFindFirst.mockResolvedValue({ id: "sermon-1" });
  mocks.queue.mockResolvedValue({ id: "job-1", reusedExisting: false });
  mocks.liveRecordingUpdateMany.mockResolvedValue({ count: 1 });
});

describe("materialized live recordings", () => {
  it("creates a tenant-safe draft with configured defaults, persists the ready source, then queues it", async () => {
    await expect(createAndQueueMaterializedLiveRecording({
      recordingId: "recording-1",
      sermonId: "sermon-1",
      sourceAsset: source,
    })).resolves.toMatchObject({ sermonId: "sermon-1", created: true, queued: true });

    expect(mocks.assertOwned).toHaveBeenCalledWith(
      { organizationId: "org-1", sermonId: "sermon-1" },
      source.objectKey,
    );
    expect(mocks.sermonCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "sermon-1",
        organizationId: "org-1",
        campusId: "campus-1",
        title: "Sunday live recording",
        speakerName: "Pastor Nandi",
        churchName: "Grace Community Church",
        language: "zu",
        analyzeFullRecording: true,
        rightsConfirmed: true,
      }),
    }));
    expect(mocks.sourceAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        sermonId: "sermon-1",
        status: "READY",
        sizeBytes: BigInt(10_000),
      }),
    }));
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "PROCESS_SERMON");
    expect(mocks.liveRecordingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", sermonId: "sermon-1", status: { in: ["RECEIVED", "MATERIALIZING"] } }),
    }));
  });

  it("uses only configured organization defaults and never invents a speaker identity", async () => {
    mocks.organizationFindUnique.mockResolvedValueOnce({
      id: "org-1",
      name: "Grace Church",
      defaultLanguage: "en",
      brandingSettings: null,
      automationSettings: null,
    });

    await createAndQueueMaterializedLiveRecording({ recordingId: "recording-1", sermonId: "sermon-1", sourceAsset: source });

    expect(mocks.sermonCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        language: "en",
        churchName: "Grace Church",
        speakerName: "Speaker to be confirmed",
      }),
    }));
  });

  it("rejects a source key that is not owned by the recording church", async () => {
    mocks.assertOwned.mockImplementationOnce(() => { throw new Error("The source object does not belong to the authorized sermon tenant."); });

    await expect(createAndQueueMaterializedLiveRecording({
      recordingId: "recording-1",
      sermonId: "sermon-1",
      sourceAsset: source,
    })).rejects.toThrow("does not belong");
    expect(mocks.sermonCreate).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("is idempotent when a delivery retry finds the recording already linked and queued", async () => {
    mocks.liveRecordingFindUnique
      .mockReset()
      .mockResolvedValue({
        ...recording,
        sermonId: "sermon-1",
        status: "QUEUED",
        sermon: { id: "sermon-1" },
      });

    await expect(createAndQueueMaterializedLiveRecording({
      recordingId: "recording-1",
      sermonId: "sermon-1",
      sourceAsset: source,
    })).resolves.toMatchObject({ sermonId: "sermon-1", created: false, queued: false, reusedExisting: true });

    expect(mocks.sermonCreate).not.toHaveBeenCalled();
    expect(mocks.sourceAssetCreate).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
