import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const presignMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: presignMock,
}));

import {
  __s3SourceStorageTestUtils,
  getS3SourceStorageConfig,
  isS3SourceStorageConfigured,
  presignReadyS3SourcePreview,
} from "@/server/media/s3SourceStorage";

const originalEnvironment = {
  bucket: process.env.SOURCE_MEDIA_S3_BUCKET,
  region: process.env.SOURCE_MEDIA_S3_REGION,
  partSize: process.env.SOURCE_MEDIA_S3_PART_SIZE_MIB,
  keyPrefix: process.env.SOURCE_MEDIA_S3_KEY_PREFIX,
  presignTtl: process.env.SOURCE_MEDIA_S3_PRESIGN_TTL_SECONDS,
};

beforeEach(() => {
  presignMock.mockReset();
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("SOURCE_MEDIA_S3_BUCKET", originalEnvironment.bucket);
  restore("SOURCE_MEDIA_S3_REGION", originalEnvironment.region);
  restore("SOURCE_MEDIA_S3_PART_SIZE_MIB", originalEnvironment.partSize);
  restore("SOURCE_MEDIA_S3_KEY_PREFIX", originalEnvironment.keyPrefix);
  restore("SOURCE_MEDIA_S3_PRESIGN_TTL_SECONDS", originalEnvironment.presignTtl);
});

describe("private S3 sermon source storage", () => {
  it("requires a bucket and region before advertising direct uploads", () => {
    delete process.env.SOURCE_MEDIA_S3_BUCKET;
    delete process.env.SOURCE_MEDIA_S3_REGION;
    expect(isS3SourceStorageConfigured()).toBe(false);

    process.env.SOURCE_MEDIA_S3_BUCKET = "private-sources";
    process.env.SOURCE_MEDIA_S3_REGION = "eu-central-1";
    expect(isS3SourceStorageConfigured()).toBe(true);
  });

  it("clamps multipart parts to S3-safe sizes", () => {
    process.env.SOURCE_MEDIA_S3_BUCKET = "private-sources";
    process.env.SOURCE_MEDIA_S3_REGION = "eu-central-1";
    process.env.SOURCE_MEDIA_S3_PART_SIZE_MIB = "1";
    expect(getS3SourceStorageConfig().partSizeBytes).toBe(5 * 1024 * 1024);

    process.env.SOURCE_MEDIA_S3_PART_SIZE_MIB = "200";
    expect(getS3SourceStorageConfig().partSizeBytes).toBe(64 * 1024 * 1024);
  });

  it("builds tenant-scoped opaque object keys without trusting the file name", () => {
    const config = {
      bucket: "private-sources",
      region: "eu-central-1",
      forcePathStyle: false,
      keyPrefix: "sermon-sources",
      partSizeBytes: 16 * 1024 * 1024,
      presignedUrlTtlSeconds: 900,
    };
    const key = __s3SourceStorageTestUtils.buildS3SourceObjectKey({
      organizationId: "org/test",
      sermonId: "sermon\\test",
      fileName: "../../Sunday Service.MOV",
      uploadToken: "known-token",
      config,
    });

    expect(key).toBe("sermon-sources/organizations/org-test/sermons/sermon-test/known-token/source.mov");
    expect(key).not.toContain("..");
  });

  it("denies an object key outside the authorized organization and sermon prefix", () => {
    const config = {
      bucket: "private-sources",
      region: "eu-central-1",
      forcePathStyle: false,
      keyPrefix: "sermon-sources",
      partSizeBytes: 16 * 1024 * 1024,
      presignedUrlTtlSeconds: 900,
    };

    expect(() => __s3SourceStorageTestUtils.assertS3SourceObjectOwnedBy(
      { organizationId: "org-one", sermonId: "sermon-one" },
      "sermon-sources/organizations/org-one/sermons/sermon-one/upload/source.mp4",
      config,
    )).not.toThrow();
    expect(() => __s3SourceStorageTestUtils.assertS3SourceObjectOwnedBy(
      { organizationId: "org-one", sermonId: "sermon-one" },
      "sermon-sources/organizations/org-two/sermons/sermon-two/upload/source.mp4",
      config,
    )).toThrow(/authorized sermon tenant/i);
  });

  it("validates every completed part and the total byte count", () => {
    const partSizeBytes = 5 * 1024 * 1024;
    const sizeBytes = partSizeBytes + 7;
    expect(__s3SourceStorageTestUtils.expectedMultipartPartCount(sizeBytes, partSizeBytes)).toBe(2);
    expect(() => __s3SourceStorageTestUtils.validateCompletedParts({
      sizeBytes,
      partSizeBytes,
      parts: [
        { partNumber: 1, etag: "\"one\"", sizeBytes: partSizeBytes },
        { partNumber: 2, etag: "\"two\"", sizeBytes: 7 },
      ],
    })).not.toThrow();
    expect(() => __s3SourceStorageTestUtils.validateCompletedParts({
      sizeBytes,
      partSizeBytes,
      parts: [
        { partNumber: 1, etag: "\"one\"", sizeBytes: partSizeBytes - 1 },
        { partNumber: 2, etag: "\"two\"", sizeBytes: 8 },
      ],
    })).toThrow(/part 1/i);
  });

  it("signs a private inline GET without binding browser Range headers", async () => {
    process.env.SOURCE_MEDIA_S3_BUCKET = "private-sources";
    process.env.SOURCE_MEDIA_S3_REGION = "eu-central-1";
    process.env.SOURCE_MEDIA_S3_PRESIGN_TTL_SECONDS = "600";
    presignMock.mockResolvedValue("https://private.example/source?signature=test");

    const url = await presignReadyS3SourcePreview({
      owner: { organizationId: "org-one", sermonId: "sermon-one" },
      asset: {
        bucket: "private-sources",
        objectKey: "sermon-sources/organizations/org-one/sermons/sermon-one/upload/source.mp4",
        region: "eu-central-1",
        sizeBytes: BigInt(2048),
        contentType: "video/mp4",
        originalFileName: "Sunday \"Service\".mp4",
        versionId: "version-1",
        status: "READY",
      },
    });

    expect(url).toContain("signature=test");
    const [, command, options] = presignMock.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: "private-sources",
      Key: "sermon-sources/organizations/org-one/sermons/sermon-one/upload/source.mp4",
      VersionId: "version-1",
      ResponseContentType: "video/mp4",
      ResponseContentDisposition: "inline; filename=\"Sunday Service.mp4\"",
    });
    expect(command.input.Range).toBeUndefined();
    expect(options).toEqual({ expiresIn: 600 });
  });

  it("refuses to sign an asset outside the configured private bucket", async () => {
    process.env.SOURCE_MEDIA_S3_BUCKET = "private-sources";
    process.env.SOURCE_MEDIA_S3_REGION = "eu-central-1";

    await expect(presignReadyS3SourcePreview({
      owner: { organizationId: "org-one", sermonId: "sermon-one" },
      asset: {
        bucket: "another-bucket",
        objectKey: "sermon-sources/organizations/org-one/sermons/sermon-one/upload/source.mp4",
        region: "eu-central-1",
        sizeBytes: 2048,
        status: "READY",
      },
    })).rejects.toThrow(/configured private S3 bucket/i);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("refuses to sign a valid private object owned by another tenant", async () => {
    process.env.SOURCE_MEDIA_S3_BUCKET = "private-sources";
    process.env.SOURCE_MEDIA_S3_REGION = "eu-central-1";

    await expect(presignReadyS3SourcePreview({
      owner: { organizationId: "org-one", sermonId: "sermon-one" },
      asset: {
        bucket: "private-sources",
        objectKey: "sermon-sources/organizations/org-two/sermons/sermon-two/upload/source.mp4",
        region: "eu-central-1",
        sizeBytes: 2048,
        status: "READY",
      },
    })).rejects.toThrow(/authorized sermon tenant/i);
    expect(presignMock).not.toHaveBeenCalled();
  });
});
