import { createReadStream } from "node:fs";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type UploadedRemotePreview = {
  objectKey: string;
  publicUrl: string;
  uploadedAt: Date;
};

let client: S3Client | null = null;
const DEFAULT_REMOTE_PREVIEW_UPLOAD_TIMEOUT_MS = 5 * 60_000;

function cleanPathSegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned) {
    throw new Error("Cannot build R2 object key from an empty identifier.");
  }

  return cleaned;
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requiredEnv(name: string): string {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required for remote clip previews.`);
  }

  return value;
}

function requiredR2AccountId(): string {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be the 32-character Cloudflare Account ID.");
  }

  return accountId;
}

function requiredR2AccessKeyId(): string {
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  if (accessKeyId.length !== 32) {
    throw new Error("R2_ACCESS_KEY_ID must be the 32-character R2 S3 access key ID.");
  }

  return accessKeyId;
}

function getR2Client(): S3Client {
  if (client) {
    return client;
  }

  const accountId = requiredR2AccountId();
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredR2AccessKeyId(),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return client;
}

function resolveRemotePreviewUploadTimeoutMs(): number {
  const configured = process.env.R2_PREVIEW_UPLOAD_TIMEOUT_MS?.trim();
  if (!configured) {
    return DEFAULT_REMOTE_PREVIEW_UPLOAD_TIMEOUT_MS;
  }

  const timeoutMs = Number(configured);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_REMOTE_PREVIEW_UPLOAD_TIMEOUT_MS;
}

export function remotePreviewStorageConfigured(): boolean {
  if (process.env.R2_PREVIEW_UPLOAD_DISABLED === "true") {
    return false;
  }

  return Boolean(
    envValue("R2_ACCOUNT_ID") &&
    envValue("R2_ACCESS_KEY_ID") &&
    envValue("R2_SECRET_ACCESS_KEY") &&
    envValue("R2_BUCKET") &&
    envValue("R2_PUBLIC_BASE_URL"),
  );
}

export function buildClipPreviewObjectKey(input: {
  sermonId: string;
  clipId: string;
  filename?: string;
}): string {
  const extension = path.extname(input.filename ?? "") || ".mp4";
  return [
    "clip-previews",
    cleanPathSegment(input.sermonId),
    `${cleanPathSegment(input.clipId)}${extension}`,
  ].join("/");
}

export function buildR2PublicUrl(objectKey: string, version?: string | number): string {
  const baseUrl = requiredEnv("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("R2_PUBLIC_BASE_URL must be an HTTPS public bucket URL or custom domain.");
  }

  const publicUrl = `${baseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  return version === undefined ? publicUrl : `${publicUrl}?v=${encodeURIComponent(String(version))}`;
}

export async function uploadClipPreviewToR2(input: {
  sermonId: string;
  clipId: string;
  videoPath: string;
  videoSize: number;
  contentType?: string;
}): Promise<UploadedRemotePreview> {
  const objectKey = buildClipPreviewObjectKey({
    sermonId: input.sermonId,
    clipId: input.clipId,
    filename: input.videoPath,
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), resolveRemotePreviewUploadTimeoutMs());

  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: requiredEnv("R2_BUCKET"),
        Key: objectKey,
        Body: createReadStream(input.videoPath),
        ContentLength: input.videoSize,
        ContentType: input.contentType ?? "video/mp4",
      }),
      { abortSignal: abortController.signal },
    );
  } finally {
    clearTimeout(timeout);
  }

  const uploadedAt = new Date();

  return {
    objectKey,
    publicUrl: buildR2PublicUrl(objectKey, uploadedAt.getTime()),
    uploadedAt,
  };
}
