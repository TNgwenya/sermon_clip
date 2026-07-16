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
