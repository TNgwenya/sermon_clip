export const MOBILE_UPLOAD_INITIAL_CHUNK_BYTES = 4 * 1024 * 1024;
export const MOBILE_UPLOAD_MIN_CHUNK_BYTES = 512 * 1024;
export const MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS = 6;
export const MOBILE_UPLOAD_SESSION_STORAGE_KEY = "sermon-clip:active-upload-session";

export type MobileUploadSession = {
  sermonId: string;
  fileName: string;
  fileSize: number;
};

export function parseMobileUploadSession(value: string | null): MobileUploadSession | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<MobileUploadSession>;
    if (
      typeof parsed.sermonId !== "string"
      || parsed.sermonId.length === 0
      || parsed.sermonId.length > 128
      || typeof parsed.fileName !== "string"
      || parsed.fileName.length === 0
      || !Number.isSafeInteger(parsed.fileSize)
      || Number(parsed.fileSize) <= 0
    ) {
      return null;
    }

    return {
      sermonId: parsed.sermonId,
      fileName: parsed.fileName,
      fileSize: Number(parsed.fileSize),
    };
  } catch {
    return null;
  }
}

export function smallerUploadChunkBytes(currentBytes: number): number {
  const normalizedBytes = Number.isFinite(currentBytes)
    ? Math.floor(currentBytes)
    : MOBILE_UPLOAD_INITIAL_CHUNK_BYTES;
  return Math.max(MOBILE_UPLOAD_MIN_CHUNK_BYTES, Math.floor(normalizedBytes / 2));
}

export function uploadChunkRetryDelayMs(failedAttempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(failedAttempt));
  return Math.min(500 * (2 ** (normalizedAttempt - 1)), 4_000);
}

export function uploadResponseIsRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function uploadFailureSuggestsSmallerChunk(status: number | null, chunkBytes: number): boolean {
  if (chunkBytes <= MOBILE_UPLOAD_MIN_CHUNK_BYTES) {
    return false;
  }

  return status === null || status === 408 || status === 413 || (status >= 502 && status <= 504);
}

export function resolveAcknowledgedUploadBytes(input: {
  receivedBytes: unknown;
  currentBytes: number;
  totalBytes: number;
  allowRewind?: boolean;
}): number | null {
  if (!Number.isSafeInteger(input.receivedBytes)) {
    return null;
  }

  const receivedBytes = Number(input.receivedBytes);
  if (receivedBytes < 0 || receivedBytes > input.totalBytes) {
    return null;
  }

  if (receivedBytes === input.currentBytes || (!input.allowRewind && receivedBytes < input.currentBytes)) {
    return null;
  }

  return receivedBytes;
}
