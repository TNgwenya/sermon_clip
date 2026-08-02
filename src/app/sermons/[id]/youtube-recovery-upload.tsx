"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DirectSourceUploadUnavailableError,
  uploadFileToPrivateSource,
} from "@/lib/directSourceUpload";
import {
  MAX_UPLOADED_MEDIA_LABEL,
  MOBILE_UPLOAD_FAILURE_HELP,
  UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
  uploadedMediaExceedsSizeLimit,
} from "@/lib/sermonIntake";
import {
  MOBILE_UPLOAD_INITIAL_CHUNK_BYTES,
  MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS,
  MOBILE_UPLOAD_MIN_CHUNK_BYTES,
  resolveAcknowledgedUploadBytes,
  smallerUploadChunkBytes,
  uploadChunkRetryDelayMs,
  uploadFailureSuggestsSmallerChunk,
  uploadResponseIsRetryable,
} from "@/lib/mobileUpload";

type UploadApiResponse = {
  success: boolean;
  message: string;
  createdSermonId?: string;
  receivedBytes?: number;
  fieldErrors?: {
    mediaFile?: string;
  };
};

const mediaAcceptTypes = [
  "video/*",
  "audio/*",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
].join(",");

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

async function parseUploadResponse(response: Response): Promise<UploadApiResponse> {
  return response.json().catch(() => ({
    success: false,
    message: "The upload ended before Sermon Clip received a normal response.",
    fieldErrors: { mediaFile: "Keep the recording on this device and try again on a stable connection." },
  })) as Promise<UploadApiResponse>;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export function YouTubeRecoveryUpload({
  sermonId,
  directSourceUploadEnabled = false,
  localUploadFallbackEnabled = true,
}: {
  sermonId: string;
  directSourceUploadEnabled?: boolean;
  localUploadFallbackEnabled?: boolean;
}) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const sessionKey = `sermon-clip:youtube-recovery:${sermonId}`;

  async function uploadRecording() {
    if (!selectedFile) {
      setSuccess(false);
      setMessage("Choose the recording from this device first.");
      return;
    }
    if (uploadedMediaExceedsSizeLimit(selectedFile)) {
      setSuccess(false);
      setMessage(UPLOADED_MEDIA_TOO_LARGE_MESSAGE);
      return;
    }

    setIsUploading(true);
    setProgressPercent(0);
    setMessage("");
    setSuccess(false);

    try {
      if (directSourceUploadEnabled) {
        try {
          const directResult = await uploadFileToPrivateSource({
            mode: "recovery",
            sermonId,
            file: selectedFile,
            onProgress: setProgressPercent,
          });
          window.sessionStorage.removeItem(sessionKey);
          setProgressPercent(100);
          setSuccess(true);
          setMessage(directResult.message);
          router.refresh();
          return;
        } catch (error) {
          if (!(error instanceof DirectSourceUploadUnavailableError) || !localUploadFallbackEnabled) {
            const failed = error as Error & { result?: UploadApiResponse };
            setMessage(failed.result?.fieldErrors?.mediaFile ?? failed.result?.message ?? failed.message);
            return;
          }
        }
      }

      const savedSession = window.sessionStorage.getItem(sessionKey);
      const canResume = savedSession === `${selectedFile.name}:${selectedFile.size}`;
      if (!canResume) {
        window.sessionStorage.removeItem(sessionKey);
        const startUrl = new URL("/api/sermons/upload", window.location.origin);
        startUrl.searchParams.set("uploadMode", "recovery-start");
        startUrl.searchParams.set("sermonId", sermonId);
        startUrl.searchParams.set("fileName", selectedFile.name);
        startUrl.searchParams.set("totalBytes", String(selectedFile.size));

        const startResponse = await fetch(startUrl, { method: "POST" });
        const startResult = await parseUploadResponse(startResponse);
        if (!startResponse.ok || !startResult.success) {
          setMessage(startResult.fieldErrors?.mediaFile ?? startResult.message);
          return;
        }
        window.sessionStorage.setItem(sessionKey, `${selectedFile.name}:${selectedFile.size}`);
      }

      let uploadedBytes = 0;
      let uploadChunkBytes = MOBILE_UPLOAD_INITIAL_CHUNK_BYTES;
      while (uploadedBytes < selectedFile.size) {
        const nextUploadedBytes = Math.min(uploadedBytes + uploadChunkBytes, selectedFile.size);
        const chunkUrl = new URL("/api/sermons/upload", window.location.origin);
        chunkUrl.searchParams.set("uploadMode", "chunk");
        chunkUrl.searchParams.set("sermonId", sermonId);
        chunkUrl.searchParams.set("offset", String(uploadedBytes));
        chunkUrl.searchParams.set("chunkBytes", String(nextUploadedBytes - uploadedBytes));
        chunkUrl.searchParams.set("totalBytes", String(selectedFile.size));

        let chunkResponse: Response | null = null;
        let chunkResult: UploadApiResponse | null = null;
        let retryWithSmallerChunk = false;

        for (let attempt = 1; attempt <= MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS; attempt += 1) {
          try {
            chunkResponse = await fetch(chunkUrl, {
              method: "POST",
              headers: { "content-type": selectedFile.type || "application/octet-stream" },
              body: selectedFile.slice(uploadedBytes, nextUploadedBytes),
            });
            chunkResult = await parseUploadResponse(chunkResponse);

            if (chunkResponse.ok || chunkResponse.status === 409 || !uploadResponseIsRetryable(chunkResponse.status)) {
              break;
            }
            if (uploadFailureSuggestsSmallerChunk(chunkResponse.status, uploadChunkBytes)) {
              retryWithSmallerChunk = true;
              break;
            }
          } catch {
            chunkResponse = null;
            chunkResult = null;
            if (uploadFailureSuggestsSmallerChunk(null, uploadChunkBytes)) {
              retryWithSmallerChunk = true;
              break;
            }
          }

          if (attempt < MOBILE_UPLOAD_MAX_CHUNK_ATTEMPTS) {
            await waitForRetry(uploadChunkRetryDelayMs(attempt));
          }
        }

        if (retryWithSmallerChunk) {
          uploadChunkBytes = smallerUploadChunkBytes(uploadChunkBytes);
          await waitForRetry(uploadChunkRetryDelayMs(1));
          continue;
        }
        if (!chunkResponse || !chunkResult) {
          setMessage("The connection ended during upload. Keep this page open, reconnect to stable Wi-Fi, and try again.");
          return;
        }
        if (chunkResponse.status === 413 && uploadChunkBytes > MOBILE_UPLOAD_MIN_CHUNK_BYTES) {
          uploadChunkBytes = smallerUploadChunkBytes(uploadChunkBytes);
          continue;
        }

        const acknowledgedBytes = resolveAcknowledgedUploadBytes({
          receivedBytes: chunkResult.receivedBytes,
          currentBytes: uploadedBytes,
          totalBytes: selectedFile.size,
          allowRewind: chunkResponse.status === 409,
        });
        if (chunkResponse.status === 409 && acknowledgedBytes !== null) {
          uploadedBytes = acknowledgedBytes;
          setProgressPercent(Math.floor((uploadedBytes / selectedFile.size) * 100));
          continue;
        }
        if (!chunkResponse.ok || !chunkResult.success || acknowledgedBytes === null) {
          setMessage(chunkResult.fieldErrors?.mediaFile ?? chunkResult.message);
          return;
        }

        uploadedBytes = acknowledgedBytes;
        setProgressPercent(Math.min(99, Math.floor((uploadedBytes / selectedFile.size) * 100)));
      }

      const finishUrl = new URL("/api/sermons/upload", window.location.origin);
      finishUrl.searchParams.set("uploadMode", "finish");
      finishUrl.searchParams.set("sermonId", sermonId);
      finishUrl.searchParams.set("fileName", selectedFile.name);
      finishUrl.searchParams.set("totalBytes", String(selectedFile.size));

      const finishResponse = await fetch(finishUrl, { method: "POST" });
      const finishResult = await parseUploadResponse(finishResponse);
      if (!finishResponse.ok || !finishResult.success) {
        setMessage(finishResult.fieldErrors?.mediaFile ?? finishResult.message);
        return;
      }

      window.sessionStorage.removeItem(sessionKey);
      setProgressPercent(100);
      setSuccess(true);
      setMessage(finishResult.message);
      router.refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The upload request could not be completed.";
      setMessage(`The recording was not attached yet. ${reason}`);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section id="youtube-upload-recovery" className="failure-recovery-action stack-sm" aria-labelledby="youtube-upload-recovery-title">
      <div className="stack-sm">
        <strong id="youtube-upload-recovery-title">Attach the recording to this sermon</strong>
        <p className="muted small">
          This keeps the existing sermon details, start/end times, and worship choice. Maximum file size: {MAX_UPLOADED_MEDIA_LABEL}.
        </p>
      </div>
      <label className="stack-sm">
        Recording
        <input
          type="file"
          accept={mediaAcceptTypes}
          disabled={isUploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            setSelectedFile(file);
            setMessage("");
            setSuccess(false);
          }}
        />
      </label>
      {selectedFile ? (
        <p className="small muted">{selectedFile.name} · {formatFileSize(selectedFile.size)}</p>
      ) : null}
      {isUploading ? (
        <div className="stack-sm" role="status" aria-live="polite">
          <progress value={progressPercent} max={100} aria-label="Recording upload progress" />
          <p className="small">Uploading recording… {progressPercent}%. Keep this page open.</p>
        </div>
      ) : null}
      {message ? (
        <p className={success ? "success-banner" : "error-banner"} role="status">{message}</p>
      ) : null}
      <button
        type="button"
        className="button primary"
        disabled={isUploading || !selectedFile}
        onClick={() => void uploadRecording()}
      >
        {isUploading ? `Uploading… ${progressPercent}%` : "Upload recording and continue"}
      </button>
      {!isUploading && !success ? <p className="muted small">{MOBILE_UPLOAD_FAILURE_HELP}</p> : null}
    </section>
  );
}
