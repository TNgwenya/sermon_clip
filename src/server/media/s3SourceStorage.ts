import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MEBIBYTE = 1024 * 1024;
const MIN_MULTIPART_PART_BYTES = 5 * MEBIBYTE;
const DEFAULT_MULTIPART_PART_BYTES = 16 * MEBIBYTE;
const MAX_MULTIPART_PART_BYTES = 64 * MEBIBYTE;
const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_PRESIGNED_URL_TTL_SECONDS = 60 * 60;

export type S3SourceStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  keyPrefix: string;
  partSizeBytes: number;
  presignedUrlTtlSeconds: number;
};

export type UploadedSourcePart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

export type S3SourceOwner = Readonly<{
  organizationId: string;
  sermonId: string;
}>;

export type ReadyS3SourceAsset = {
  bucket: string;
  objectKey: string;
  region: string;
  sizeBytes: bigint | number;
  contentType?: string | null;
  originalFileName?: string | null;
  versionId?: string | null;
  status: "READY";
};

/**
 * A worker-only upload from a trusted provider. Unlike browser multipart
 * uploads, this never produces presigned URLs or exposes the source bytes.
 */
export type TrustedSourceStreamUpload = {
  owner: S3SourceOwner;
  fileName: string;
  contentType: string;
  expectedSizeBytes: number;
  body: Readable;
};

const clients = new Map<string, S3Client>();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeKeyPrefix(value: string | undefined): string {
  return (value?.trim() || "sermon-sources")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._=-]/g, "-"))
    .join("/");
}

function safeKeySegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._=-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function safeFileExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.length > 1 && extension.length <= 12 ? extension : ".bin";
}

export function isS3SourceStorageConfigured(): boolean {
  return Boolean(
    process.env.SOURCE_MEDIA_S3_BUCKET?.trim()
    && (process.env.SOURCE_MEDIA_S3_REGION?.trim() || process.env.AWS_REGION?.trim()),
  );
}

export function getS3SourceStorageConfig(): S3SourceStorageConfig {
  const bucket = process.env.SOURCE_MEDIA_S3_BUCKET?.trim();
  const region = process.env.SOURCE_MEDIA_S3_REGION?.trim() || process.env.AWS_REGION?.trim();
  if (!bucket || !region) {
    throw new Error("Direct source upload is not configured. Set SOURCE_MEDIA_S3_BUCKET and SOURCE_MEDIA_S3_REGION.");
  }

  const configuredPartMib = positiveInteger(
    process.env.SOURCE_MEDIA_S3_PART_SIZE_MIB,
    DEFAULT_MULTIPART_PART_BYTES / MEBIBYTE,
  );
  const partSizeBytes = Math.min(
    MAX_MULTIPART_PART_BYTES,
    Math.max(MIN_MULTIPART_PART_BYTES, configuredPartMib * MEBIBYTE),
  );
  const presignedUrlTtlSeconds = Math.min(
    MAX_PRESIGNED_URL_TTL_SECONDS,
    positiveInteger(process.env.SOURCE_MEDIA_S3_PRESIGN_TTL_SECONDS, DEFAULT_PRESIGNED_URL_TTL_SECONDS),
  );

  return {
    bucket,
    region,
    endpoint: process.env.SOURCE_MEDIA_S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.SOURCE_MEDIA_S3_FORCE_PATH_STYLE === "true",
    keyPrefix: normalizeKeyPrefix(process.env.SOURCE_MEDIA_S3_KEY_PREFIX),
    partSizeBytes,
    presignedUrlTtlSeconds,
  };
}

function clientKey(config: S3SourceStorageConfig): string {
  return [
    config.region,
    config.endpoint ?? "",
    config.forcePathStyle ? "path" : "virtual",
  ].join("|");
}

function getS3Client(config = getS3SourceStorageConfig()): S3Client {
  const key = clientKey(config);
  const existing = clients.get(key);
  if (existing) return existing;

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    // Browser multipart bodies are uploaded after signing and cannot provide
    // SDK-generated checksum headers. S3 still validates transport integrity
    // and the application verifies every accepted part and final byte count.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  clients.set(key, client);
  return client;
}

export function buildS3SourceObjectKey(input: {
  organizationId: string;
  sermonId: string;
  fileName: string;
  uploadToken?: string;
  config?: S3SourceStorageConfig;
}): string {
  const config = input.config ?? getS3SourceStorageConfig();
  const organization = safeKeySegment(input.organizationId, "organization");
  const sermon = safeKeySegment(input.sermonId, "sermon");
  const uploadToken = safeKeySegment(input.uploadToken ?? randomUUID(), "upload");
  return `${config.keyPrefix}/organizations/${organization}/sermons/${sermon}/${uploadToken}/source${safeFileExtension(input.fileName)}`;
}

export function assertS3SourceObjectOwnedBy(
  owner: S3SourceOwner,
  objectKey: string,
  config = getS3SourceStorageConfig(),
): void {
  const organization = safeKeySegment(owner.organizationId, "organization");
  const sermon = safeKeySegment(owner.sermonId, "sermon");
  const expectedPrefix = `${config.keyPrefix}/organizations/${organization}/sermons/${sermon}/`;
  if (!objectKey.startsWith(expectedPrefix) || objectKey.length <= expectedPrefix.length) {
    throw new Error("The source object does not belong to the authorized sermon tenant.");
  }
}

export function expectedMultipartPartCount(sizeBytes: number, partSizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Source size must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes < MIN_MULTIPART_PART_BYTES) {
    throw new Error("Multipart part size is invalid.");
  }
  const count = Math.ceil(sizeBytes / partSizeBytes);
  if (count > 10_000) {
    throw new Error("Source recording requires more than 10,000 upload parts.");
  }
  return count;
}

export async function createS3SourceMultipartUpload(input: {
  organizationId: string;
  sermonId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{
  bucket: string;
  objectKey: string;
  region: string;
  uploadId: string;
  partSizeBytes: number;
}> {
  const config = getS3SourceStorageConfig();
  expectedMultipartPartCount(input.sizeBytes, config.partSizeBytes);
  const objectKey = buildS3SourceObjectKey({ ...input, config });
  const response = await getS3Client(config).send(new CreateMultipartUploadCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ContentType: input.contentType || "application/octet-stream",
    ServerSideEncryption: "AES256",
    Metadata: {
      organization: safeKeySegment(input.organizationId, "organization"),
      sermon: safeKeySegment(input.sermonId, "sermon"),
      bytes: String(input.sizeBytes),
    },
  }));
  if (!response.UploadId) {
    throw new Error("Amazon S3 did not return a multipart upload ID.");
  }

  return {
    bucket: config.bucket,
    objectKey,
    region: config.region,
    uploadId: response.UploadId,
    partSizeBytes: config.partSizeBytes,
  };
}

export async function presignS3SourcePart(input: {
  bucket: string;
  objectKey: string;
  region: string;
  uploadId: string;
  partNumber: number;
  owner: S3SourceOwner;
}): Promise<string> {
  const config = getS3SourceStorageConfig();
  if (input.bucket !== config.bucket || input.region !== config.region) {
    throw new Error("The source upload does not match the configured private S3 bucket.");
  }
  if (!Number.isSafeInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000) {
    throw new Error("Upload part number is invalid.");
  }
  assertS3SourceObjectOwnedBy(input.owner, input.objectKey, config);

  return getSignedUrl(
    getS3Client(config),
    new UploadPartCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: config.presignedUrlTtlSeconds },
  );
}

export async function listS3SourceParts(input: {
  bucket: string;
  objectKey: string;
  region: string;
  uploadId: string;
  owner: S3SourceOwner;
}): Promise<UploadedSourcePart[]> {
  const config = getS3SourceStorageConfig();
  if (input.bucket !== config.bucket || input.region !== config.region) {
    throw new Error("The source upload does not match the configured private S3 bucket.");
  }
  assertS3SourceObjectOwnedBy(input.owner, input.objectKey, config);

  const parts: UploadedSourcePart[] = [];
  let partNumberMarker: string | undefined;
  do {
    const response = await getS3Client(config).send(new ListPartsCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumberMarker: partNumberMarker,
    }));
    for (const part of response.Parts ?? []) {
      if (!part.PartNumber || !part.ETag || part.Size === undefined) {
        throw new Error("Amazon S3 returned an incomplete multipart part record.");
      }
      parts.push({
        partNumber: part.PartNumber,
        etag: part.ETag,
        sizeBytes: part.Size,
      });
    }
    partNumberMarker = response.IsTruncated
      ? response.NextPartNumberMarker
      : undefined;
  } while (partNumberMarker);

  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

function validateCompletedParts(input: {
  parts: UploadedSourcePart[];
  sizeBytes: number;
  partSizeBytes: number;
}): void {
  const expectedCount = expectedMultipartPartCount(input.sizeBytes, input.partSizeBytes);
  if (input.parts.length !== expectedCount) {
    throw new Error(`The upload has ${input.parts.length} of ${expectedCount} required parts.`);
  }

  let accumulatedBytes = 0;
  for (let index = 0; index < input.parts.length; index += 1) {
    const part = input.parts[index];
    const expectedPartNumber = index + 1;
    if (part.partNumber !== expectedPartNumber) {
      throw new Error(`Upload part ${expectedPartNumber} is missing.`);
    }
    const expectedBytes = index === input.parts.length - 1
      ? input.sizeBytes - (input.partSizeBytes * index)
      : input.partSizeBytes;
    if (part.sizeBytes !== expectedBytes) {
      throw new Error(`Upload part ${part.partNumber} has ${part.sizeBytes} bytes; expected ${expectedBytes}.`);
    }
    accumulatedBytes += part.sizeBytes;
  }
  if (accumulatedBytes !== input.sizeBytes) {
    throw new Error(`The completed upload has ${accumulatedBytes} bytes; expected ${input.sizeBytes}.`);
  }
}

export async function completeS3SourceMultipartUpload(input: {
  bucket: string;
  objectKey: string;
  region: string;
  uploadId: string;
  sizeBytes: number;
  partSizeBytes: number;
  owner: S3SourceOwner;
}): Promise<{ etag: string | null; versionId: string | null }> {
  const config = getS3SourceStorageConfig();
  const parts = await listS3SourceParts(input);
  validateCompletedParts({
    parts,
    sizeBytes: input.sizeBytes,
    partSizeBytes: input.partSizeBytes,
  });

  const completed = await getS3Client(config).send(new CompleteMultipartUploadCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    UploadId: input.uploadId,
    MultipartUpload: {
      Parts: parts.map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber,
      })),
    },
  }));
  const head = await getS3Client(config).send(new HeadObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    VersionId: completed.VersionId,
  }));
  if (head.ContentLength !== input.sizeBytes) {
    throw new Error(`Amazon S3 stored ${head.ContentLength ?? 0} bytes; expected ${input.sizeBytes}.`);
  }

  return {
    etag: completed.ETag ?? head.ETag ?? null,
    versionId: completed.VersionId ?? head.VersionId ?? null,
  };
}

export async function abortS3SourceMultipartUpload(input: {
  bucket: string;
  objectKey: string;
  region: string;
  uploadId: string;
  owner: S3SourceOwner;
}): Promise<void> {
  const config = getS3SourceStorageConfig();
  if (input.bucket !== config.bucket || input.region !== config.region) {
    throw new Error("The source upload does not match the configured private S3 bucket.");
  }
  assertS3SourceObjectOwnedBy(input.owner, input.objectKey, config);
  await getS3Client(config).send(new AbortMultipartUploadCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    UploadId: input.uploadId,
  }));
}

export async function presignReadyS3SourcePreview(input: {
  asset: ReadyS3SourceAsset;
  owner: S3SourceOwner;
}): Promise<string> {
  const config = getS3SourceStorageConfig();
  if (input.asset.bucket !== config.bucket || input.asset.region !== config.region) {
    throw new Error("The saved source asset does not match the configured private S3 bucket.");
  }
  assertS3SourceObjectOwnedBy(input.owner, input.asset.objectKey, config);

  const expectedBytes = Number(input.asset.sizeBytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error("The saved source asset has an invalid size.");
  }

  const originalFileName = path
    .basename(input.asset.originalFileName?.trim() || "sermon-source.mp4")
    .replace(/["\r\n]/g, "");

  return getSignedUrl(
    getS3Client(config),
    new GetObjectCommand({
      Bucket: input.asset.bucket,
      Key: input.asset.objectKey,
      VersionId: input.asset.versionId || undefined,
      ResponseContentType: input.asset.contentType?.trim() || "video/mp4",
      ResponseContentDisposition: `inline; filename="${originalFileName || "sermon-source.mp4"}"`,
    }),
    { expiresIn: config.presignedUrlTtlSeconds },
  );
}

function objectBodyAsReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (
    body
    && typeof body === "object"
    && "transformToWebStream" in body
    && typeof body.transformToWebStream === "function"
  ) {
    return Readable.fromWeb(body.transformToWebStream());
  }
  throw new Error("Amazon S3 returned a source body that cannot be streamed.");
}

async function* fixedSizeParts(body: Readable, partSizeBytes: number): AsyncGenerator<Buffer> {
  let remainder = Buffer.alloc(0);
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    remainder = remainder.length === 0 ? buffer : Buffer.concat([remainder, buffer]);
    while (remainder.length >= partSizeBytes) {
      yield remainder.subarray(0, partSizeBytes);
      remainder = remainder.subarray(partSizeBytes);
    }
  }
  if (remainder.length > 0) yield remainder;
}

/**
 * Streams a known-size provider recording directly into tenant-owned private
 * S3. It verifies the received byte count and the stored object length, and
 * aborts the multipart upload on every failure so partial provider media is
 * never retained as a usable source.
 */
export async function uploadTrustedSourceStream(input: TrustedSourceStreamUpload): Promise<ReadyS3SourceAsset> {
  if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
    throw new Error("Trusted source content length must be a positive safe integer.");
  }
  const config = getS3SourceStorageConfig();
  const expectedParts = expectedMultipartPartCount(input.expectedSizeBytes, config.partSizeBytes);
  const objectKey = buildS3SourceObjectKey({
    organizationId: input.owner.organizationId,
    sermonId: input.owner.sermonId,
    fileName: input.fileName,
    config,
  });
  const client = getS3Client(config);
  const started = await client.send(new CreateMultipartUploadCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ContentType: input.contentType || "video/mp4",
    ServerSideEncryption: "AES256",
    Metadata: {
      organization: safeKeySegment(input.owner.organizationId, "organization"),
      sermon: safeKeySegment(input.owner.sermonId, "sermon"),
      bytes: String(input.expectedSizeBytes),
      origin: "trusted-live-intake",
    },
  }));
  if (!started.UploadId) throw new Error("Amazon S3 did not return a multipart upload ID.");

  let uploadedBytes = 0;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  let completedObject = false;
  try {
    let partNumber = 1;
    for await (const part of fixedSizeParts(input.body, config.partSizeBytes)) {
      uploadedBytes += part.length;
      if (uploadedBytes > input.expectedSizeBytes || partNumber > expectedParts) {
        throw new Error("Provider recording exceeded its declared content length.");
      }
      const uploaded = await client.send(new UploadPartCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: started.UploadId,
        PartNumber: partNumber,
        Body: part,
      }));
      if (!uploaded.ETag) throw new Error(`Amazon S3 did not return an ETag for source part ${partNumber}.`);
      parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
      partNumber += 1;
    }
    if (uploadedBytes !== input.expectedSizeBytes || parts.length !== expectedParts) {
      throw new Error(`Provider recording transferred ${uploadedBytes} bytes; expected ${input.expectedSizeBytes}.`);
    }
    const completed = await client.send(new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: objectKey,
      UploadId: started.UploadId,
      MultipartUpload: { Parts: parts },
    }));
    completedObject = true;
    const head = await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      VersionId: completed.VersionId,
    }));
    if (head.ContentLength !== input.expectedSizeBytes) {
      throw new Error(`Amazon S3 stored ${head.ContentLength ?? 0} bytes; expected ${input.expectedSizeBytes}.`);
    }
    return {
      bucket: config.bucket,
      objectKey,
      region: config.region,
      sizeBytes: input.expectedSizeBytes,
      contentType: input.contentType || "video/mp4",
      originalFileName: input.fileName,
      versionId: completed.VersionId ?? head.VersionId ?? null,
      status: "READY",
    };
  } catch (error) {
    input.body.destroy();
    if (completedObject) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey })).catch(() => undefined);
    } else {
      await client.send(new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: started.UploadId,
      })).catch(() => undefined);
    }
    throw error;
  }
}

export async function downloadReadyS3SourceToFile(input: {
  asset: ReadyS3SourceAsset;
  owner: S3SourceOwner;
  destinationPath: string;
}): Promise<void> {
  const config = getS3SourceStorageConfig();
  if (input.asset.bucket !== config.bucket || input.asset.region !== config.region) {
    throw new Error("The saved source asset does not match the configured private S3 bucket.");
  }
  assertS3SourceObjectOwnedBy(input.owner, input.asset.objectKey, config);
  const expectedBytes = Number(input.asset.sizeBytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error("The saved source asset has an invalid size.");
  }

  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await unlink(input.destinationPath).catch(() => undefined);
  const response = await getS3Client(config).send(new GetObjectCommand({
    Bucket: input.asset.bucket,
    Key: input.asset.objectKey,
  }));
  if (response.ContentLength !== undefined && response.ContentLength !== expectedBytes) {
    throw new Error(`Amazon S3 returned ${response.ContentLength} bytes; expected ${expectedBytes}.`);
  }
  if (!response.Body) {
    throw new Error("Amazon S3 returned an empty source body.");
  }

  try {
    await pipeline(objectBodyAsReadable(response.Body), createWriteStream(input.destinationPath, { flags: "wx" }));
    const file = await stat(input.destinationPath);
    if (!file.isFile() || file.size !== expectedBytes) {
      throw new Error(`The local source copy has ${file.size} bytes; expected ${expectedBytes}.`);
    }
  } catch (error) {
    await unlink(input.destinationPath).catch(() => undefined);
    throw error;
  }
}

export const __s3SourceStorageTestUtils = {
  MIN_MULTIPART_PART_BYTES,
  buildS3SourceObjectKey,
  assertS3SourceObjectOwnedBy,
  expectedMultipartPartCount,
  validateCompletedParts,
  fixedSizeParts,
};
