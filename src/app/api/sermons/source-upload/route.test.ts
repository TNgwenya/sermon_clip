import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const client = {
    auditEvent: { create: vi.fn() },
    campus: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    sermon: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    sermonSourceAsset: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(async (callback) => callback(client));
  return client;
});
const s3Mock = vi.hoisted(() => ({
  abort: vi.fn(async () => undefined),
  complete: vi.fn(async () => ({ etag: "\"etag\"", versionId: null })),
  create: vi.fn(async () => ({
    bucket: "private-sources",
    objectKey: "sermon-sources/org/sermon/source.mp4",
    region: "eu-central-1",
    uploadId: "upload-1",
    partSizeBytes: 16 * 1024 * 1024,
  })),
  list: vi.fn(async () => []),
  presign: vi.fn(async () => "https://s3.example/signed-part"),
}));
const queueMock = vi.hoisted(() => vi.fn(async () => ({
  id: "job-1",
  reusedExisting: false,
  intentConflict: false,
})));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/agents/storage", () => ({ appendPipelineLog: vi.fn(async () => undefined) }));
vi.mock("@/server/agents/processing", () => ({ queueSermonProcessingJob: queueMock }));
vi.mock("@/server/media/s3SourceStorage", () => ({
  abortS3SourceMultipartUpload: s3Mock.abort,
  completeS3SourceMultipartUpload: s3Mock.complete,
  createS3SourceMultipartUpload: s3Mock.create,
  expectedMultipartPartCount: (size: number, partSize: number) => Math.ceil(size / partSize),
  getS3SourceStorageConfig: () => ({
    bucket: "private-sources",
    region: "eu-central-1",
    forcePathStyle: false,
    keyPrefix: "sermon-sources",
    partSizeBytes: 16 * 1024 * 1024,
    presignedUrlTtlSeconds: 900,
  }),
  isS3SourceStorageConfigured: () => true,
  listS3SourceParts: s3Mock.list,
  presignS3SourcePart: s3Mock.presign,
}));

import { POST } from "./route";

function trustedRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/sermons/source-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sermonclip-organization-id": "org-1",
      "x-sermonclip-campus-id": "campus-1",
      "x-sermonclip-actor-id": "user-1",
      "x-sermonclip-authentication": "local-development",
    },
    body: JSON.stringify(body),
  });
}

describe("private S3 source upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "ACTIVE",
      memberships: [{
        organizationId: "org-1",
        campusId: null,
        role: "OWNER",
        status: "ACTIVE",
        expiresAt: null,
        organization: { status: "ACTIVE" },
        campus: null,
      }],
    });
    prismaMock.campus.findFirst.mockResolvedValue({
      id: "campus-1",
      organizationId: "org-1",
      status: "ACTIVE",
    });
    prismaMock.sermon.create.mockResolvedValue({ id: "sermon-1", title: "Sunday Service" });
    prismaMock.sermonSourceAsset.upsert.mockResolvedValue({ id: "asset-1" });
  });

  it("requires a trusted authenticated tenant", async () => {
    const response = await POST(new Request("http://localhost/api/sermons/source-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "initiate", mode: "create" }),
    }));

    expect(response.status).toBe(401);
    expect(s3Mock.create).not.toHaveBeenCalled();
  });

  it("creates a tenant-bound sermon and multipart S3 upload", async () => {
    const response = await POST(trustedRequest({
      action: "initiate",
      mode: "create",
      fileName: "Sunday Service.mp4",
      fileSize: 20 * 1024 * 1024,
      contentType: "video/mp4",
      title: "Sunday Service",
      speakerName: "Pastor",
      churchName: "Church",
      language: "English",
      rightsConfirmed: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      createdSermonId: "sermon-1",
      sourceAssetId: "asset-1",
      partSizeBytes: 16 * 1024 * 1024,
      partCount: 2,
    });
    expect(prismaMock.sermon.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        youtubeUrl: "local-upload://Sunday%20Service.mp4",
      }),
    }));
    expect(prismaMock.sermonSourceAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        sermonId: "sermon-1",
        bucket: "private-sources",
      }),
    }));
  });

  it("authorizes only the requested part for the tenant-owned asset", async () => {
    prismaMock.sermonSourceAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      bucket: "private-sources",
      objectKey: "source.mp4",
      region: "eu-central-1",
      uploadId: "upload-1",
      originalFileName: "service.mp4",
      sizeBytes: BigInt(20 * 1024 * 1024),
      partSizeBytes: 16 * 1024 * 1024,
      status: "INITIATED",
    });

    const response = await POST(trustedRequest({
      action: "part-url",
      sermonId: "sermon-1",
      sourceAssetId: "asset-1",
      partNumber: 2,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      uploadUrl: "https://s3.example/signed-part",
      partNumber: 2,
    });
    expect(prismaMock.sermonSourceAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "asset-1",
        sermonId: "sermon-1",
        organizationId: "org-1",
        campusId: "campus-1",
      },
    }));
  });

  it("marks the durable source ready and queues processing after S3 completion", async () => {
    prismaMock.sermonSourceAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      sermonId: "sermon-1",
      bucket: "private-sources",
      objectKey: "source.mp4",
      region: "eu-central-1",
      uploadId: "upload-1",
      originalFileName: "service.mp4",
      sizeBytes: BigInt(20 * 1024 * 1024),
      partSizeBytes: 16 * 1024 * 1024,
      status: "UPLOADING",
    });

    const response = await POST(trustedRequest({
      action: "complete",
      sermonId: "sermon-1",
      sourceAssetId: "asset-1",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ready: true,
      createdSermonId: "sermon-1",
    });
    expect(prismaMock.sermonSourceAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "READY",
        uploadId: null,
        etag: "\"etag\"",
      }),
    }));
    expect(prismaMock.sermon.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        youtubeUrl: "local-upload://service.mp4",
        sourceVideoPath: null,
      }),
    }));
    expect(queueMock).toHaveBeenCalledWith("sermon-1", "PROCESS_SERMON");
  });
});
