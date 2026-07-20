import { describe, expect, it } from "vitest";

import {
  MOBILE_UPLOAD_INITIAL_CHUNK_BYTES,
  MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS,
  MOBILE_UPLOAD_MIN_CHUNK_BYTES,
  parseMobileUploadSession,
  resolveAcknowledgedUploadBytes,
  smallerUploadChunkBytes,
  uploadChunkRetryDelayMs,
  uploadFailureSuggestsSmallerChunk,
  uploadResponseIsRetryable,
} from "@/lib/mobileUpload";

describe("mobile upload transport", () => {
  it("reduces rejected chunks to a proxy-safe minimum", () => {
    expect(MOBILE_UPLOAD_INITIAL_CHUNK_BYTES).toBe(4 * 1024 * 1024);
    expect([
      MOBILE_UPLOAD_INITIAL_CHUNK_BYTES,
      2 * 1024 * 1024,
      1024 * 1024,
      MOBILE_UPLOAD_MIN_CHUNK_BYTES,
    ].map(smallerUploadChunkBytes)).toEqual([
      2 * 1024 * 1024,
      1024 * 1024,
      MOBILE_UPLOAD_MIN_CHUNK_BYTES,
      MOBILE_UPLOAD_MIN_CHUNK_BYTES,
    ]);
    expect(MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS).toBe(6);
  });

  it("retries transient transport responses but not validation failures", () => {
    expect(uploadResponseIsRetryable(408)).toBe(true);
    expect(uploadResponseIsRetryable(429)).toBe(true);
    expect(uploadResponseIsRetryable(502)).toBe(true);
    expect(uploadResponseIsRetryable(400)).toBe(false);
    expect(uploadResponseIsRetryable(413)).toBe(false);
  });

  it("uses bounded exponential backoff between chunk retries", () => {
    expect([1, 2, 3, 4, 8].map(uploadChunkRetryDelayMs)).toEqual([500, 1_000, 2_000, 4_000, 4_000]);
  });

  it("falls back to smaller chunks after connection and gateway failures", () => {
    expect(uploadFailureSuggestsSmallerChunk(null, 4 * 1024 * 1024)).toBe(true);
    expect(uploadFailureSuggestsSmallerChunk(408, 4 * 1024 * 1024)).toBe(true);
    expect(uploadFailureSuggestsSmallerChunk(413, 4 * 1024 * 1024)).toBe(true);
    expect(uploadFailureSuggestsSmallerChunk(502, 4 * 1024 * 1024)).toBe(true);
    expect(uploadFailureSuggestsSmallerChunk(429, 4 * 1024 * 1024)).toBe(false);
    expect(uploadFailureSuggestsSmallerChunk(500, 4 * 1024 * 1024)).toBe(false);
    expect(uploadFailureSuggestsSmallerChunk(null, MOBILE_UPLOAD_MIN_CHUNK_BYTES)).toBe(false);
  });

  it("accepts authoritative progress and rejects invalid acknowledgements", () => {
    expect(resolveAcknowledgedUploadBytes({ receivedBytes: 524_288, currentBytes: 0, totalBytes: 1_000_000 })).toBe(524_288);
    expect(resolveAcknowledgedUploadBytes({ receivedBytes: 0, currentBytes: 0, totalBytes: 1_000_000 })).toBeNull();
    expect(resolveAcknowledgedUploadBytes({ receivedBytes: 1_000_001, currentBytes: 0, totalBytes: 1_000_000 })).toBeNull();
    expect(resolveAcknowledgedUploadBytes({ receivedBytes: "524288", currentBytes: 0, totalBytes: 1_000_000 })).toBeNull();
  });

  it("allows a conflict response to rewind to the server's durable offset", () => {
    expect(resolveAcknowledgedUploadBytes({
      receivedBytes: 262_144,
      currentBytes: 524_288,
      totalBytes: 1_000_000,
      allowRewind: true,
    })).toBe(262_144);
    expect(resolveAcknowledgedUploadBytes({
      receivedBytes: 524_288,
      currentBytes: 524_288,
      totalBytes: 1_000_000,
      allowRewind: true,
    })).toBeNull();
  });

  it("restores only valid resumable upload sessions", () => {
    expect(parseMobileUploadSession(JSON.stringify({
      sermonId: "sermon-1",
      fileName: "Mobile Sermon.mov",
      fileSize: 12_345,
    }))).toEqual({ sermonId: "sermon-1", fileName: "Mobile Sermon.mov", fileSize: 12_345 });
    expect(parseMobileUploadSession("not-json")).toBeNull();
    expect(parseMobileUploadSession(JSON.stringify({ sermonId: "sermon-1", fileName: "Mobile Sermon.mov", fileSize: 0 }))).toBeNull();
  });
});
