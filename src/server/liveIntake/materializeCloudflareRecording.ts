import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { assertMediaStorageCapacity } from "@/server/media/storageCapacity";
import { uploadTrustedSourceStream, type ReadyS3SourceAsset, type S3SourceOwner } from "@/server/media/s3SourceStorage";

import { prepareCloudflareRecordingMp4 } from "./cloudflareStream";
import { createAndQueueMaterializedLiveRecording, resumeMaterializedLiveRecording } from "./service";

const GIBIBYTE = 1024 ** 3;
const DEFAULT_MAX_RECORDING_BYTES = 50 * GIBIBYTE;
const MAX_LIVE_RECORDING_SECONDS = 4 * 60 * 60;

type RecordingForMaterialization = {
  id: string;
  providerRecordingId: string;
  organizationId: string;
  durationSeconds: number | null;
};

export type CloudflareMaterializationResult =
  | { state: "pending" }
  | { state: "materialized"; sermonId: string; sourceAsset?: ReadyS3SourceAsset };

function configuredMaxRecordingBytes(value = process.env.LIVE_INTAKE_MAX_RECORDING_BYTES): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RECORDING_BYTES;
}

function requireSafeCloudflareDownloadUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const allowed = hostname === "cloudflarestream.com"
    || hostname.endsWith(".cloudflarestream.com")
    || hostname === "videodelivery.net"
    || hostname.endsWith(".videodelivery.net");
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw new Error("Cloudflare returned an unsafe recording download address.");
  }
  return url;
}

function requiredContentLength(response: Response): number {
  const value = response.headers.get("content-length")?.trim() ?? "";
  const length = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(length) || length <= 0 || String(length) !== value) {
    throw new Error("Cloudflare did not provide a valid recording content length.");
  }
  if (length > configuredMaxRecordingBytes()) {
    throw new Error("The live recording is larger than this worker's configured private-transfer limit.");
  }
  return length;
}

function mp4ContentType(response: Response): string {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  // Cloudflare's download response is normally video/mp4. application/octet-stream
  // is tolerated because the worker subsequently validates the durable asset with FFmpeg.
  if (!contentType.startsWith("video/mp4") && contentType !== "application/octet-stream") {
    throw new Error("Cloudflare returned a recording that is not an MP4 media response.");
  }
  return "video/mp4";
}

/**
 * Materializes a completed Cloudflare recording directly into tenant-owned S3.
 * It intentionally has no browser path, no public URL persistence and no
 * processing side effect until the private object is byte-verified.
 */
export async function materializeCloudflareRecording(input: RecordingForMaterialization): Promise<CloudflareMaterializationResult> {
  const resumed = await resumeMaterializedLiveRecording(input.id, input.organizationId);
  if (resumed) return { state: "materialized", sermonId: resumed };
  if (input.durationSeconds !== null && (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > MAX_LIVE_RECORDING_SECONDS)) {
    throw new Error("Live recordings must be a positive duration of four hours or less before MP4 transfer.");
  }
  const preparation = await prepareCloudflareRecordingMp4(input.providerRecordingId);
  if (preparation.state === "pending") return { state: "pending" };
  if (preparation.state === "failed") throw new Error(preparation.reason);

  const downloadUrl = requireSafeCloudflareDownloadUrl(preparation.downloadUrl);
  const response = await fetch(downloadUrl, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Cloudflare recording download failed (HTTP ${response.status}).`);
  const expectedSizeBytes = requiredContentLength(response);
  const contentType = mp4ContentType(response);
  if (!response.body) throw new Error("Cloudflare returned an empty recording response.");

  // The existing processing worker materializes the S3 source to local disk
  // before FFmpeg work. Fail early rather than retaining a durable source the
  // current worker cannot safely process.
  await assertMediaStorageCapacity({ incomingBytes: expectedSizeBytes });

  const sermonId = randomUUID();
  const owner: S3SourceOwner = { organizationId: input.organizationId, sermonId };
  const sourceAsset = await uploadTrustedSourceStream({
    owner,
    fileName: "sunday-live-recording.mp4",
    contentType,
    expectedSizeBytes,
    body: Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
  });
  await createAndQueueMaterializedLiveRecording({
    recordingId: input.id,
    sermonId,
    sourceAsset: {
      ...sourceAsset,
      contentType: sourceAsset.contentType ?? contentType,
      originalFileName: sourceAsset.originalFileName ?? "sunday-live-recording.mp4",
    },
  });
  return { state: "materialized", sermonId, sourceAsset };
}

export const __cloudflareMaterializationTestUtils = {
  configuredMaxRecordingBytes,
  requireSafeCloudflareDownloadUrl,
  requiredContentLength,
  mp4ContentType,
  MAX_LIVE_RECORDING_SECONDS,
};
