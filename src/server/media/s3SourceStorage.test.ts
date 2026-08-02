import { afterEach, describe, expect, it } from "vitest";

import {
  __s3SourceStorageTestUtils,
  getS3SourceStorageConfig,
  isS3SourceStorageConfigured,
} from "@/server/media/s3SourceStorage";

const originalEnvironment = {
  bucket: process.env.SOURCE_MEDIA_S3_BUCKET,
  region: process.env.SOURCE_MEDIA_S3_REGION,
  partSize: process.env.SOURCE_MEDIA_S3_PART_SIZE_MIB,
  keyPrefix: process.env.SOURCE_MEDIA_S3_KEY_PREFIX,
};

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("SOURCE_MEDIA_S3_BUCKET", originalEnvironment.bucket);
  restore("SOURCE_MEDIA_S3_REGION", originalEnvironment.region);
  restore("SOURCE_MEDIA_S3_PART_SIZE_MIB", originalEnvironment.partSize);
  restore("SOURCE_MEDIA_S3_KEY_PREFIX", originalEnvironment.keyPrefix);
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
});
