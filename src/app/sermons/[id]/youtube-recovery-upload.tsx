"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DirectSourceUploadUnavailableError,
  uploadFileToPrivateSource,
} from "@/lib/directSourceUpload";
import {
  MAX_UPLOADED_MEDIA_LABEL,
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
  sourceStored?: boolean;
  originalPreserved?: boolean;
  storedBytes?: number;
  resumedImport?: boolean;
  receivedBytes?: number;
  fieldErrors?: {
    mediaFile?: string;
  };
};

const videoAcceptTypes = [
  "video/*",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
].join(",");

const PHONE_COPY_DELETE_GUIDANCE = "You can now delete the downloaded copy from your phone if you no longer need it. Removing that phone copy will not delete the source safely stored in Simonclip.";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function buildSafelyStoredMessage(fileName: string): string {
  return `${fileName} is safely stored exactly as received. Simonclip has resumed this same sermon import with your saved details.`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [directUploadAssetId, setDirectUploadAssetId] = useState<string | null>(null);
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
          await uploadFileToPrivateSource({
            mode: "recovery",
            sermonId,
            sourceAssetId: directUploadAssetId,
            file: selectedFile,
            onSession: (_activeSermonId, sourceAssetId) => {
              if (sourceAssetId) setDirectUploadAssetId(sourceAssetId);
            },
            onProgress: setProgressPercent,
          });
          window.sessionStorage.removeItem(sessionKey);
          setProgressPercent(100);
          setSuccess(true);
          setMessage(buildSafelyStoredMessage(selectedFile.name));
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
      setMessage(buildSafelyStoredMessage(selectedFile.name));
      router.refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The upload request could not be completed.";
      setMessage(`The recording was not attached yet. ${reason}`);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section
      id="youtube-upload-recovery"
      className={`youtube-recovery-fallback${success ? " is-complete" : ""}`}
      aria-labelledby="youtube-upload-recovery-title"
    >
      <div className="youtube-recovery-heading stack-sm">
        <p className="kicker">Safe YouTube fallback</p>
        <h2 id="youtube-upload-recovery-title">
          {success ? "Your source video is safely stored" : "Download your own video, then continue here"}
        </h2>
        {success ? (
          <p className="muted">
            Simonclip is continuing the original import. Your sermon details, timing, and worship setting stayed with it.
          </p>
        ) : (
          <p className="muted">
            The YouTube link import did not work. The video owner must download their own video from YouTube Studio, then upload that file to Simonclip.
          </p>
        )}
      </div>

      {!success ? (
        <ol className="youtube-recovery-steps" aria-label="How to continue the YouTube import">
          <li>
            <span>1</span>
            <div>
              <strong>Open YouTube Studio</strong>
              <p>As the video owner, find the video, open its menu, and choose <strong>Download</strong>.</p>
              <a href="https://studio.youtube.com/" target="_blank" rel="noreferrer">Open YouTube Studio</a>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Choose the downloaded video</strong>
              <p>Return here and pick the original file from Files, Downloads, or your device storage.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Upload and continue</strong>
              <p>Simonclip stores the file exactly as received and resumes this same sermon automatically.</p>
            </div>
          </li>
        </ol>
      ) : null}

      {!success ? (
        <div className="youtube-recovery-upload-panel stack-sm">
          <input
            ref={fileInputRef}
            id={`youtube-recovery-file-${sermonId}`}
            className="sr-only"
            type="file"
            accept={videoAcceptTypes}
            disabled={isUploading}
            aria-hidden="true"
            tabIndex={-1}
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              window.sessionStorage.removeItem(sessionKey);
              setDirectUploadAssetId(null);
              setSelectedFile(file);
              setProgressPercent(0);
              setMessage("");
              setSuccess(false);
            }}
          />
          <div className="youtube-recovery-picker-row">
            <button
              type="button"
              className="button secondary"
              disabled={isUploading}
              aria-describedby="youtube-recovery-file-help"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? "Choose a different video" : "Choose video from this device"}
            </button>
            {selectedFile ? (
              <p className="youtube-recovery-file" role="status">
                <strong>{selectedFile.name}</strong>
                <span>{formatFileSize(selectedFile.size)}</span>
              </p>
            ) : null}
          </div>
          <p id="youtube-recovery-file-help" className="muted small">
            Video only, up to {MAX_UPLOADED_MEDIA_LABEL}. Uploading does not compress, resize, or reduce the source quality.
          </p>
        </div>
      ) : null}

      {isUploading ? (
        <div className="youtube-recovery-progress stack-sm" role="status" aria-live="polite">
          <div className="youtube-recovery-progress-label">
            <strong>Uploading the original video</strong>
            <span>{progressPercent}%</span>
          </div>
          <progress value={progressPercent} max={100} aria-label="Original video upload progress" />
          <p className="small muted">Keep this page open. If the connection stops, use the same button to resume.</p>
        </div>
      ) : null}

      {message ? (
        <div className={success ? "success-banner stack-sm" : "error-banner stack-sm"} role="status" aria-live="polite">
          <strong>{success ? "Source safely stored" : "The video is still on your device"}</strong>
          <p>{message}</p>
        </div>
      ) : null}

      {!success ? (
        <div className="youtube-recovery-actions">
          <button
            type="button"
            className="button primary"
            disabled={isUploading || !selectedFile}
            onClick={() => void uploadRecording()}
          >
            {isUploading ? `Uploading… ${progressPercent}%` : "Upload original video and continue"}
          </button>
        </div>
      ) : (
        <div className="youtube-recovery-phone-copy" role="note">
          <strong>Temporary phone copy</strong>
          <p>{PHONE_COPY_DELETE_GUIDANCE}</p>
        </div>
      )}

      {!isUploading && !success ? (
        <p className="muted small">
          On a phone, keep Simonclip open on stable Wi-Fi. If the upload is interrupted, keep the same file on the device and tap upload again to resume.
        </p>
      ) : null}

      <p className="youtube-recovery-privacy-note small">
        Simonclip will never ask for your YouTube password or use your cookies, browser automation, or an unofficial downloader for this fallback.
      </p>
    </section>
  );
}

export const __youtubeRecoveryUploadTestUtils = {
  PHONE_COPY_DELETE_GUIDANCE,
  buildSafelyStoredMessage,
  videoAcceptTypes,
};
