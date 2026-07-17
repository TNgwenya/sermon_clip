import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type PublishedContentAssetFile = {
  objectKey: string;
  publicUrl: string;
  uploadedAt: Date;
  sizeBytes: number;
};

export type LocalContentAssetFileForUpload = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
};

const MAX_PUBLIC_CONTENT_ASSET_DOWNLOAD_BYTES = 50 * 1024 * 1024;

let client: S3Client | null = null;

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requiredEnv(name: string): string {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required to prepare public content-asset media.`);
  return value;
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!normalized) throw new Error("A content-asset storage identifier is missing.");
  return normalized;
}

function getR2Client(): S3Client {
  if (client) return client;
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be the 32-character Cloudflare Account ID.");
  }
  if (accessKeyId.length !== 32) {
    throw new Error("R2_ACCESS_KEY_ID must be the 32-character R2 S3 access key ID.");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

export function isContentAssetPublicStorageConfigured(): boolean {
  return process.env.R2_CONTENT_ASSET_UPLOAD_DISABLED !== "true" && Boolean(
    envValue("R2_ACCOUNT_ID")
      && envValue("R2_ACCESS_KEY_ID")
      && envValue("R2_SECRET_ACCESS_KEY")
      && envValue("R2_BUCKET")
      && envValue("R2_PUBLIC_BASE_URL"),
  );
}

export function isContentAssetDurableStorageRequired(): boolean {
  return Boolean(process.env.VERCEL)
    || process.env.CONTENT_ASSET_DURABLE_STORAGE_REQUIRED === "true"
    || (
      process.env.R2_CONTENT_ASSET_UPLOAD_DISABLED !== "true"
      && [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
      ].some((name) => Boolean(envValue(name)))
    );
}

export function buildContentAssetObjectKey(input: {
  contentAssetId: string;
  fileId: string;
  fileName: string;
}): string {
  const extension = path.extname(input.fileName).toLowerCase() || ".jpg";
  return [
    "content-assets",
    safeSegment(input.contentAssetId),
    "publishing",
    `${safeSegment(input.fileId)}${extension}`,
  ].join("/");
}

export function buildContentAssetPublicUrl(objectKey: string): string {
  const baseUrl = requiredEnv("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("R2_PUBLIC_BASE_URL must be an HTTPS public bucket URL or custom domain.");
  }
  return `${baseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export function isTrustedContentAssetPublicUrl(value: string | null | undefined): boolean {
  const publicBaseUrl = envValue("R2_PUBLIC_BASE_URL");
  const candidateValue = value?.trim() ?? "";
  if (!publicBaseUrl || !candidateValue) return false;

  try {
    const base = new URL(publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`);
    const candidate = new URL(candidateValue);
    if (base.protocol !== "https:" || candidate.protocol !== "https:" || candidate.origin !== base.origin) {
      return false;
    }
    const basePath = base.pathname.replace(/\/+$/, "");
    return candidate.pathname.startsWith(`${basePath}/content-assets/`);
  } catch {
    return false;
  }
}

export async function readContentAssetPublicFile(
  publicUrl: string,
  maxBytes = MAX_PUBLIC_CONTENT_ASSET_DOWNLOAD_BYTES,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("The public content-asset download limit is invalid.");
  }
  if (!isTrustedContentAssetPublicUrl(publicUrl)) {
    throw new Error("The content-asset public URL is not part of the configured media bucket.");
  }

  const response = await fetch(publicUrl, {
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Public content-asset download failed with HTTP ${response.status}.`);
  }
  const advertisedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) {
    throw new Error("The public content-asset file is too large to download safely.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error("The public content-asset file is too large to download safely.");
  }
  return bytes;
}

export async function uploadContentAssetFileToR2(input: {
  contentAssetId: string;
  fileId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
}): Promise<PublishedContentAssetFile> {
  if (!isContentAssetPublicStorageConfigured()) {
    throw new Error("Public R2 media storage is not configured. Add the R2 credentials and HTTPS public base URL before automatic publishing.");
  }
  const fileStat = await stat(input.filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size <= 0) {
    throw new Error(`Prepared publishing file ${input.fileName} is missing. Render it again before scheduling.`);
  }
  const objectKey = buildContentAssetObjectKey(input);
  await getR2Client().send(new PutObjectCommand({
    Bucket: requiredEnv("R2_BUCKET"),
    Key: objectKey,
    Body: createReadStream(input.filePath),
    ContentLength: fileStat.size,
    ContentType: input.mimeType,
  }));
  return {
    objectKey,
    publicUrl: buildContentAssetPublicUrl(objectKey),
    uploadedAt: new Date(),
    sizeBytes: fileStat.size,
  };
}

export async function uploadContentAssetFilesWhenConfigured(input: {
  contentAssetId: string;
  files: LocalContentAssetFileForUpload[];
}): Promise<Map<string, PublishedContentAssetFile>> {
  if (input.files.length === 0) {
    return new Map();
  }
  if (!isContentAssetPublicStorageConfigured()) {
    if (isContentAssetDurableStorageRequired()) {
      throw new Error(
        "Durable content-asset storage is required in this deployment. Configure R2 before preparing generated media.",
      );
    }
    return new Map();
  }

  const uploads = await Promise.all(input.files.map(async (file) => ({
    fileId: file.id,
    uploaded: await uploadContentAssetFileToR2({
      contentAssetId: input.contentAssetId,
      fileId: file.id,
      fileName: file.fileName,
      filePath: file.filePath,
      mimeType: file.mimeType,
    }),
  })));
  return new Map(uploads.map(({ fileId, uploaded }) => [fileId, uploaded]));
}
