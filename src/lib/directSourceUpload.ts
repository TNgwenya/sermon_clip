export type DirectSourceUploadMode = "create" | "recovery";

export type DirectSourceUploadFields = {
  eventSessionId?: string;
  title?: string;
  speakerName?: string;
  churchName?: string;
  language?: string;
  sermonDate?: string;
  sermonStartTimestamp?: string;
  sermonEndTimestamp?: string;
  includeWorshipMoments?: boolean;
  rightsConfirmed?: boolean;
};

export type DirectSourceUploadResult = {
  success: boolean;
  message: string;
  createdSermonId?: string;
  sourceAssetId?: string;
  sourceStored?: boolean;
  originalPreserved?: boolean;
  storedBytes?: number;
  resumedImport?: boolean;
  ready?: boolean;
  uploadedPartNumbers?: number[];
  uploadedBytes?: number;
  partSizeBytes?: number;
  partCount?: number;
  uploadUrl?: string;
  partNumber?: number;
  code?: string;
  fieldErrors?: Record<string, string | undefined>;
};

export class DirectSourceUploadUnavailableError extends Error {
  readonly code = "DIRECT_SOURCE_UPLOAD_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "DirectSourceUploadUnavailableError";
  }
}

const DIRECT_SOURCE_UPLOAD_PATH = "/api/sermons/source-upload";
const PART_UPLOAD_CONCURRENCY = 4;
const PART_UPLOAD_MAX_ATTEMPTS = 4;

function retryDelayMs(attempt: number): number {
  return Math.min(750 * (2 ** Math.max(0, attempt - 1)), 5_000);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function sourceUploadRequest(body: Record<string, unknown>): Promise<{
  response: Response;
  result: DirectSourceUploadResult;
}> {
  const response = await fetch(DIRECT_SOURCE_UPLOAD_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({
    success: false,
    message: "The private upload service returned an unreadable response.",
  })) as DirectSourceUploadResult;

  if (response.status === 501 || result.code === "DIRECT_SOURCE_UPLOAD_UNAVAILABLE") {
    throw new DirectSourceUploadUnavailableError(result.message);
  }
  return { response, result };
}

function requireSuccessfulResult(
  response: Response,
  result: DirectSourceUploadResult,
): DirectSourceUploadResult {
  if (!response.ok || !result.success) {
    const error = new Error(result.fieldErrors?.mediaFile || result.message || "Private source upload failed.");
    Object.assign(error, { result, status: response.status });
    throw error;
  }
  return result;
}

async function uploadOnePart(input: {
  sermonId: string;
  sourceAssetId: string;
  file: File;
  partNumber: number;
  partSizeBytes: number;
}): Promise<void> {
  const start = (input.partNumber - 1) * input.partSizeBytes;
  const end = Math.min(start + input.partSizeBytes, input.file.size);
  const body = input.file.slice(start, end);
  let lastError: unknown;

  for (let attempt = 1; attempt <= PART_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const signed = await sourceUploadRequest({
        action: "part-url",
        sermonId: input.sermonId,
        sourceAssetId: input.sourceAssetId,
        partNumber: input.partNumber,
      });
      const signedResult = requireSuccessfulResult(signed.response, signed.result);
      if (!signedResult.uploadUrl) {
        throw new Error(`Upload part ${input.partNumber} did not receive an authorized S3 URL.`);
      }

      const uploaded = await fetch(signedResult.uploadUrl, {
        method: "PUT",
        body,
      });
      if (!uploaded.ok) {
        throw new Error(`Amazon S3 rejected upload part ${input.partNumber} with status ${uploaded.status}.`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof DirectSourceUploadUnavailableError) throw error;
      if (attempt < PART_UPLOAD_MAX_ATTEMPTS) {
        await wait(retryDelayMs(attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Upload part ${input.partNumber} failed after retrying.`);
}

export async function uploadFileToPrivateSource(input: {
  mode: DirectSourceUploadMode;
  sermonId?: string | null;
  sourceAssetId?: string | null;
  file: File;
  fields?: DirectSourceUploadFields;
  onSession?: (sermonId: string, sourceAssetId?: string) => void;
  onProgress?: (percent: number) => void;
}): Promise<DirectSourceUploadResult> {
  const initiated = await sourceUploadRequest({
    action: "initiate",
    mode: input.mode,
    sermonId: input.sermonId || undefined,
    sourceAssetId: input.sourceAssetId || undefined,
    fileName: input.file.name,
    fileSize: input.file.size,
    contentType: input.file.type || "application/octet-stream",
    ...input.fields,
  });
  const session = requireSuccessfulResult(initiated.response, initiated.result);
  const sermonId = session.createdSermonId;
  const sourceAssetId = session.sourceAssetId;
  if (!sermonId) {
    throw new Error("The private upload service did not return a sermon ID.");
  }
  input.onSession?.(sermonId, sourceAssetId);
  if (session.ready) {
    input.onProgress?.(100);
    return session;
  }
  if (!sourceAssetId || !session.partSizeBytes || !session.partCount) {
    throw new Error("The private upload service did not return complete multipart details.");
  }
  const activeSermonId = sermonId;
  const activeSourceAssetId = sourceAssetId;

  const uploadedParts = new Set(session.uploadedPartNumbers ?? []);
  let completedBytes = Math.min(session.uploadedBytes ?? 0, input.file.size);
  input.onProgress?.(Math.floor((completedBytes / input.file.size) * 100));

  const pendingPartNumbers = Array.from(
    { length: session.partCount },
    (_, index) => index + 1,
  ).filter((partNumber) => !uploadedParts.has(partNumber));
  let nextPendingIndex = 0;

  async function uploadWorker(): Promise<void> {
    while (nextPendingIndex < pendingPartNumbers.length) {
      const currentIndex = nextPendingIndex;
      nextPendingIndex += 1;
      const partNumber = pendingPartNumbers[currentIndex];
      await uploadOnePart({
        sermonId: activeSermonId,
        sourceAssetId: activeSourceAssetId,
        file: input.file,
        partNumber,
        partSizeBytes: session.partSizeBytes!,
      });
      const start = (partNumber - 1) * session.partSizeBytes!;
      completedBytes += Math.min(session.partSizeBytes!, input.file.size - start);
      input.onProgress?.(Math.min(99, Math.floor((completedBytes / input.file.size) * 100)));
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(PART_UPLOAD_CONCURRENCY, pendingPartNumbers.length) },
      () => uploadWorker(),
    ),
  );

  const completed = await sourceUploadRequest({
    action: "complete",
    mode: input.mode,
    sermonId: activeSermonId,
    sourceAssetId: activeSourceAssetId,
  });
  const result = requireSuccessfulResult(completed.response, completed.result);
  input.onProgress?.(100);
  return result;
}

export const __directSourceUploadTestUtils = {
  PART_UPLOAD_CONCURRENCY,
  PART_UPLOAD_MAX_ATTEMPTS,
};
