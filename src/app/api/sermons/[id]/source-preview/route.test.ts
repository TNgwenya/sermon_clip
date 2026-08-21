import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  requireSermonResource: vi.fn(),
  stat: vi.fn(),
  videoFileResponse: vi.fn(),
  presignReadyS3SourcePreview: vi.fn(),
  canRunLocalMediaProcessing: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/lib/prisma", () => ({
  prisma: { sermon: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/tenancy/databaseIsolation", () => ({
  withDatabaseTenantIsolation: (_context: unknown, operation: (transaction: unknown) => unknown) => operation({
    sermon: { findFirst: mocks.findFirst },
  }),
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireSermonResource: mocks.requireSermonResource,
}));
vi.mock("@/server/http/videoFileResponse", () => ({
  videoFileResponse: mocks.videoFileResponse,
}));
vi.mock("@/server/media/s3SourceStorage", () => ({
  presignReadyS3SourcePreview: mocks.presignReadyS3SourcePreview,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: mocks.canRunLocalMediaProcessing,
}));

import { GET } from "./route";

describe("sermon source preview route tenant authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSermonResource.mockResolvedValue({
      id: "sermon-1",
      organizationId: "org-1",
      campusId: "campus-1",
    });
    mocks.canRunLocalMediaProcessing.mockReturnValue(true);
  });

  it("does not disclose or read another tenant's source media", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireSermonResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/sermons/sermon-other/source-preview"),
      { params: Promise.resolve({ id: "sermon-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Sermon not found." });
    expect(mocks.requireSermonResource).toHaveBeenCalledWith("sermons.read", "sermon-other");
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("resolves portable storage paths before serving a local source", async () => {
    mocks.findFirst.mockResolvedValue({
      sourceVideoPath: "/srv/sermon-clip/data/sermons/sermon-1/source/source.mp4",
      sourceAsset: null,
    });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 1024 });
    const localResponse = new Response("local video");
    mocks.videoFileResponse.mockResolvedValue(localResponse);

    const response = await GET(
      new Request("http://localhost/api/sermons/sermon-1/source-preview"),
      { params: Promise.resolve({ id: "sermon-1" }) },
    );

    expect(response).toBe(localResponse);
    expect(mocks.videoFileResponse).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/srv/sermon-clip/data/sermons/sermon-1/source/source.mp4",
      disposition: "inline",
    }));
    expect(mocks.presignReadyS3SourcePreview).not.toHaveBeenCalled();
  });

  it("redirects to a short-lived private source URL when the local source is missing", async () => {
    const sourceAsset = {
      bucket: "private-sources",
      objectKey: "sermons/source.mp4",
      region: "eu-central-1",
      sizeBytes: BigInt(2048),
      contentType: "video/mp4",
      originalFileName: "sermon.mp4",
      versionId: "version-1",
      status: "READY",
    };
    mocks.findFirst.mockResolvedValue({
      sourceVideoPath: "sermon-storage://sermons/sermon-1/source/source.mp4",
      sourceAsset,
    });
    mocks.stat.mockRejectedValue(new Error("missing"));
    mocks.presignReadyS3SourcePreview.mockResolvedValue(
      "https://private-sources.s3.eu-central-1.amazonaws.com/source.mp4?signature=test",
    );

    const response = await GET(
      new Request("http://localhost/api/sermons/sermon-1/source-preview", {
        headers: { Range: "bytes=100-200" },
      }),
      { params: Promise.resolve({ id: "sermon-1" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("signature=test");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300, must-revalidate");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.presignReadyS3SourcePreview).toHaveBeenCalledWith({
      owner: { organizationId: "org-1", sermonId: "sermon-1" },
      asset: sourceAsset,
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sermon-1", organizationId: "org-1" },
    }));
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });

  it("can deliver a durable preview from a control-panel runtime", async () => {
    mocks.canRunLocalMediaProcessing.mockReturnValue(false);
    mocks.findFirst.mockResolvedValue({
      sourceVideoPath: null,
      sourceAsset: {
        bucket: "private-sources",
        objectKey: "sermons/source.mp4",
        region: "eu-central-1",
        sizeBytes: BigInt(2048),
        contentType: "video/mp4",
        originalFileName: "sermon.mp4",
        versionId: null,
        status: "READY",
      },
    });
    mocks.presignReadyS3SourcePreview.mockResolvedValue(
      "https://private-sources.s3.eu-central-1.amazonaws.com/source.mp4?signature=test",
    );

    const response = await GET(
      new Request("http://localhost/api/sermons/sermon-1/source-preview"),
      { params: Promise.resolve({ id: "sermon-1" }) },
    );

    expect(response.status).toBe(307);
    expect(mocks.stat).not.toHaveBeenCalled();
  });
});
