"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { FeatureModal, type FeatureModalKind } from "@/components/feature-modal";
import {
  HOSTED_MEDIA_UPLOAD_UNAVAILABLE_MESSAGE,
  MAX_UPLOADED_MEDIA_LABEL,
  MOBILE_UPLOAD_FAILURE_HELP,
  SERMON_UPLOAD_ATTEMPT_STORAGE_KEY,
  UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
  uploadedMediaExceedsSizeLimit,
} from "@/lib/sermonIntake";
import {
  createSermonAction,
  type CreateSermonFormState,
} from "@/server/actions/sermons";

const initialCreateSermonState: CreateSermonFormState = {
  success: false,
  message: "",
};

type SermonSourceMode = "youtube" | "upload";

const mobileMediaAcceptTypes = [
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

function SubmitButton({
  sourceMode,
  uploadBlocked,
  isUploadSubmitting,
}: {
  sourceMode: SermonSourceMode;
  uploadBlocked: boolean;
  isUploadSubmitting: boolean;
}) {
  const { pending: actionPending } = useFormStatus();
  const pending = actionPending || isUploadSubmitting;

  return (
    <button className="button primary command-cta" type="submit" disabled={pending || uploadBlocked}>
      {pending
        ? sourceMode === "upload"
          ? "Uploading recording..."
          : "Starting analysis..."
        : "Analyze this sermon"}
    </button>
  );
}

function UploadProgressTheater({
  sourceMode,
  selectedFileName,
  isUploadSubmitting,
}: {
  sourceMode: SermonSourceMode;
  selectedFileName: string | null;
  isUploadSubmitting: boolean;
}) {
  const { pending: actionPending } = useFormStatus();
  const pending = actionPending || isUploadSubmitting;

  if (!pending) {
    return null;
  }

  return (
    <div className="upload-progress-backdrop" role="status" aria-live="polite">
      <section className="upload-progress-theater">
        <div className="upload-progress-copy stack-sm">
          <p className="kicker">{sourceMode === "upload" ? "Uploading your recording" : "Starting sermon analysis"}</p>
          <h2>{sourceMode === "upload" ? "Keep this tab open while the media uploads." : "Your sermon is being added to the studio."}</h2>
          <p className="muted">
            {sourceMode === "upload"
              ? `${selectedFileName ?? "The selected recording"} will be checked before analysis begins.`
              : "Sermon Clip is saving the details and preparing the YouTube recording for analysis."}
            {" "}You will be taken to live progress automatically.
          </p>
        </div>

        <div className="upload-progress-stage" aria-hidden="true">
          <div className="progress-source-card">
            <span className="small muted">Source sermon</span>
            <div className="progress-source-frame" />
          </div>
          <div className="progress-orb" />
          <div className="progress-skeleton-grid">
            <div className="progress-skeleton-clip" />
            <div className="progress-skeleton-clip second" />
            <div className="progress-skeleton-clip third" />
          </div>
        </div>

        <div className="upload-progress-steps">
          {sourceMode === "upload" ? (
            <>
              <span className="workflow-step active">Uploading recording</span>
              <span className="workflow-step pending">Checking media</span>
              <span className="workflow-step pending">Starting analysis</span>
            </>
          ) : (
            <>
              <span className="workflow-step active">Saving sermon details</span>
              <span className="workflow-step pending">Preparing YouTube video</span>
              <span className="workflow-step pending">Finding moments</span>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function NewSermonForm({
  initialYoutubeUrl = "",
  canUploadMedia = true,
}: {
  initialYoutubeUrl?: string;
  canUploadMedia?: boolean;
}) {
  const [state, formAction] = useActionState(createSermonAction, initialCreateSermonState);
  const router = useRouter();
  const [activeFeatureModal, setActiveFeatureModal] = useState<FeatureModalKind | null>(null);
  const [sourceMode, setSourceMode] = useState<SermonSourceMode>("youtube");
  const [youtubeUrl, setYoutubeUrl] = useState(initialYoutubeUrl);
  const [uploadState, setUploadState] = useState<CreateSermonFormState | null>(null);
  const [isUploadSubmitting, setIsUploadSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [selectedFileError, setSelectedFileError] = useState<string | null>(null);
  const displayState = uploadState ?? state;
  const hasSermonWindowErrors = Boolean(
    displayState.fieldErrors?.sermonStartTimestamp || displayState.fieldErrors?.sermonEndTimestamp,
  );
  const mediaFileError = selectedFileError ?? displayState.fieldErrors?.mediaFile;

  useEffect(() => {
    if (state.success && state.createdSermonId) {
      router.replace(`/sermons/${state.createdSermonId}`);
    }
  }, [router, state.createdSermonId, state.success]);

  useEffect(() => {
    if (state.message || uploadState?.message) {
      window.sessionStorage.removeItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY);
    }
  }, [state.message, uploadState?.message]);

  async function submitRawUpload(event: React.FormEvent<HTMLFormElement>) {
    if (sourceMode !== "upload") {
      return;
    }

    event.preventDefault();
    setUploadState(null);

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("sermonVideoFile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0] ?? null;

    if (!file) {
      setUploadState({
        success: false,
        message: "Choose a media file before uploading.",
        fieldErrors: { mediaFile: "Choose a media file before uploading." },
      });
      return;
    }

    if (uploadedMediaExceedsSizeLimit(file)) {
      setSelectedFileError(UPLOADED_MEDIA_TOO_LARGE_MESSAGE);
      return;
    }

    const formData = new FormData(form);
    const uploadUrl = new URL("/api/sermons/upload", window.location.origin);
    uploadUrl.searchParams.set("fileName", file.name);
    uploadUrl.searchParams.set("title", String(formData.get("title") ?? ""));
    uploadUrl.searchParams.set("speakerName", String(formData.get("speakerName") ?? ""));
    uploadUrl.searchParams.set("churchName", String(formData.get("churchName") ?? ""));
    uploadUrl.searchParams.set("language", String(formData.get("language") ?? ""));
    uploadUrl.searchParams.set("sermonDate", String(formData.get("sermonDate") ?? ""));
    uploadUrl.searchParams.set("sermonStartTimestamp", String(formData.get("sermonStartTimestamp") ?? ""));
    uploadUrl.searchParams.set("sermonEndTimestamp", String(formData.get("sermonEndTimestamp") ?? ""));
    uploadUrl.searchParams.set("rightsConfirmed", formData.get("rightsConfirmed") === "on" ? "true" : "false");

    window.sessionStorage.setItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY, "true");
    setIsUploadSubmitting(true);
    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const result = await response.json().catch(() => ({
        success: false,
        message: "The upload ended before Sermon Clip received a normal response.",
        fieldErrors: { mediaFile: "The upload ended early. Try again or use a YouTube link." },
      })) as CreateSermonFormState;

      setUploadState(result);
      if (result.success && result.createdSermonId) {
        window.sessionStorage.removeItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY);
        router.replace(`/sermons/${result.createdSermonId}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The upload request could not be completed.";
      setUploadState({
        success: false,
        message: `The upload did not finish. Reason: ${reason}`,
        fieldErrors: { mediaFile: "The upload did not finish. Try again on a stable connection, or use a YouTube link." },
      });
    } finally {
      setIsUploadSubmitting(false);
    }
  }

  return (
    <>
      <form
        action={formAction}
        className="upload-form-panel premium-intake-form stack-lg"
        onSubmit={(event) => {
          if (sourceMode === "upload") {
            void submitRawUpload(event);
          } else {
            window.sessionStorage.removeItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY);
            setUploadState(null);
          }
        }}
      >
        <UploadProgressTheater sourceMode={sourceMode} selectedFileName={selectedFile?.name ?? null} isUploadSubmitting={isUploadSubmitting} />
        <section className="intake-form-section stack-md" aria-labelledby="sermon-source-heading">
          <div className="intake-section-heading">
            <span className="intake-section-number">01</span>
            <div>
              <h2 id="sermon-source-heading">Choose the recording</h2>
              <p className="muted">
                {canUploadMedia
                  ? "Use a YouTube link or choose a media file from this device."
                  : "Use a public or unlisted YouTube link to add the sermon to the hosted app."}
              </p>
            </div>
          </div>

          <div className="source-mode-switch" role="radiogroup" aria-label="Recording source">
            <label className={sourceMode === "youtube" ? "source-mode-option is-selected" : "source-mode-option"}>
              <input
                type="radio"
                name="sourceMode"
                value="youtube"
                checked={sourceMode === "youtube"}
                onChange={() => setSourceMode("youtube")}
              />
              <span>
                <strong>YouTube link</strong>
                <small>Use a public or unlisted sermon video</small>
              </span>
            </label>
            <label className={`${sourceMode === "upload" ? "source-mode-option is-selected" : "source-mode-option"}${canUploadMedia ? "" : " is-unavailable"}`}>
              <input
                type="radio"
                name="sourceMode"
                value="upload"
                checked={sourceMode === "upload"}
                disabled={!canUploadMedia}
                aria-describedby={!canUploadMedia ? "hosted-upload-unavailable" : undefined}
                onChange={() => setSourceMode("upload")}
              />
              <span>
                <strong>Upload media</strong>
                <small>{canUploadMedia ? "Choose the recording from this device" : "Unavailable on the hosted app"}</small>
              </span>
            </label>
          </div>

          {!canUploadMedia ? (
            <p id="hosted-upload-unavailable" className="upload-availability-notice" role="note">
              <strong>Why can’t I upload a video?</strong>
              <span>{HOSTED_MEDIA_UPLOAD_UNAVAILABLE_MESSAGE}</span>
            </p>
          ) : null}

          <div className="source-method-grid">
            <div className={`source-method-card stack-sm${sourceMode === "youtube" ? " is-selected" : ""}`} hidden={sourceMode !== "youtube"}>
              <div className="source-method-heading">
                <span className="source-method-mark" aria-hidden="true">URL</span>
                <div>
                  <strong>Paste the YouTube link</strong>
                  <span className="muted small">YouTube watch and youtu.be links are supported</span>
                </div>
              </div>
              <label className="sr-only" htmlFor="youtubeUrl">Sermon video link</label>
              <input
                id="youtubeUrl"
                name="youtubeUrl"
                type="url"
                placeholder="https://youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                disabled={sourceMode !== "youtube"}
                required={sourceMode === "youtube"}
                pattern="https://(www\.youtube\.com|youtube\.com|youtu\.be)/.+"
                title="Enter a YouTube or youtu.be link beginning with https://"
                aria-invalid={Boolean(state.fieldErrors?.youtubeUrl)}
                aria-describedby={state.fieldErrors?.youtubeUrl ? "youtubeUrl-error" : undefined}
              />
              {displayState.fieldErrors?.youtubeUrl ? <p id="youtubeUrl-error" className="field-error">{displayState.fieldErrors.youtubeUrl}</p> : null}
            </div>

            <div className={`source-method-card upload-drop-zone stack-sm dark-drop${sourceMode === "upload" ? " is-selected" : ""}`} hidden={sourceMode !== "upload"}>
              <div className="source-method-heading">
                <span className="source-method-mark" aria-hidden="true">FILE</span>
                <div>
                  <label htmlFor="sermonVideoFile">Upload a recording</label>
                  <span className="muted small">Choose a video or audio file up to {MAX_UPLOADED_MEDIA_LABEL}</span>
                </div>
              </div>
              <input
                id="sermonVideoFile"
                name="sermonVideoFile"
                type="file"
                accept={mobileMediaAcceptTypes}
                disabled={sourceMode !== "upload" || !canUploadMedia}
                required={sourceMode === "upload" && canUploadMedia}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setSelectedFile(file ? { name: file.name, size: file.size } : null);
                  setSelectedFileError(file && uploadedMediaExceedsSizeLimit(file)
                    ? UPLOADED_MEDIA_TOO_LARGE_MESSAGE
                    : null);
                }}
                aria-invalid={Boolean(mediaFileError)}
                aria-describedby={mediaFileError ? "sermonVideoFile-error" : selectedFile ? "sermonVideoFile-selection" : undefined}
              />
              {selectedFile ? (
                <p id="sermonVideoFile-selection" className="selected-source-file" role="status">
                  <span aria-hidden="true">✓</span>
                  <strong>{selectedFile.name}</strong>
                  <span>{formatFileSize(selectedFile.size)}</span>
                </p>
              ) : null}
              {selectedFile && !selectedFileError ? (
                <p className="muted small">{MOBILE_UPLOAD_FAILURE_HELP}</p>
              ) : null}
              {mediaFileError ? <p id="sermonVideoFile-error" className="field-error">{mediaFileError}</p> : null}
            </div>
          </div>
        </section>

        <section className="intake-form-section stack-md" aria-labelledby="sermon-details-heading">
          <div className="intake-section-heading">
            <span className="intake-section-number">02</span>
            <div>
              <h2 id="sermon-details-heading">Add the sermon details</h2>
              <p className="muted">These details keep your library and exported posts easy to recognize.</p>
            </div>
          </div>

          <div className="stack-sm">
            <label htmlFor="title">Sermon title</label>
            <input id="title" name="title" type="text" required placeholder="Hope in hard times" />
              {displayState.fieldErrors?.title ? <p className="field-error">{displayState.fieldErrors.title}</p> : null}
          </div>

          <div className="review-edit-grid upload-meta-grid">
            <div className="stack-sm">
              <label htmlFor="speakerName">Preacher</label>
              <input id="speakerName" name="speakerName" type="text" required placeholder="Pastor Jane Doe" />
              {displayState.fieldErrors?.speakerName ? <p className="field-error">{displayState.fieldErrors.speakerName}</p> : null}
            </div>

            <div className="stack-sm">
              <label htmlFor="churchName">Church</label>
              <input id="churchName" name="churchName" type="text" required placeholder="Grace Community Church" />
              {displayState.fieldErrors?.churchName ? <p className="field-error">{displayState.fieldErrors.churchName}</p> : null}
            </div>

            <div className="stack-sm">
              <label htmlFor="language">Sermon language</label>
              <input id="language" name="language" type="text" required placeholder="English" />
              {displayState.fieldErrors?.language ? <p className="field-error">{displayState.fieldErrors.language}</p> : null}
            </div>

            <div className="stack-sm">
              <label htmlFor="sermonDate">Date preached <span className="field-optional">Optional</span></label>
              <input id="sermonDate" name="sermonDate" type="date" />
              {displayState.fieldErrors?.sermonDate ? <p className="field-error">{displayState.fieldErrors.sermonDate}</p> : null}
            </div>
          </div>
        </section>

        <details className="sermon-window-panel sermon-window-disclosure" open={hasSermonWindowErrors || undefined}>
          <summary>
            <span>
              <span className="kicker">Optional setup</span>
              <strong id="sermon-window-title">Tell us where the sermon begins</strong>
            </span>
            <span className="summary-hint">For full service recordings</span>
          </summary>
          <div className="review-edit-grid upload-meta-grid">
            <div className="stack-sm">
              <label htmlFor="sermonStartTimestamp">Sermon starts at</label>
              <input id="sermonStartTimestamp" name="sermonStartTimestamp" type="text" inputMode="numeric" placeholder="Example: 32:15" />
              <p className="muted small">Format: <span className="code-text">MM:SS</span> or <span className="code-text">H:MM:SS</span>.</p>
              {displayState.fieldErrors?.sermonStartTimestamp ? <p className="field-error">{displayState.fieldErrors.sermonStartTimestamp}</p> : null}
            </div>

            <div className="stack-sm">
              <label htmlFor="sermonEndTimestamp">Sermon ends at</label>
              <input id="sermonEndTimestamp" name="sermonEndTimestamp" type="text" inputMode="numeric" placeholder="Example: 1:18:40" />
              <p className="muted small">Leave blank if the sermon runs to the end of the video.</p>
              {displayState.fieldErrors?.sermonEndTimestamp ? <p className="field-error">{displayState.fieldErrors.sermonEndTimestamp}</p> : null}
            </div>
          </div>
        </details>

        <div className="rights-confirmation stack-sm">
          <label className="checkbox-label" htmlFor="rightsConfirmed">
            <input id="rightsConfirmed" name="rightsConfirmed" type="checkbox" required />
            <span>I confirm that our church or media team has permission to process this sermon recording.</span>
          </label>
          {displayState.fieldErrors?.rightsConfirmed ? (
            <p className="field-error">{displayState.fieldErrors.rightsConfirmed}</p>
          ) : null}
        </div>

        <div className="upload-form-footer premium-upload-footer">
          <SubmitButton
            sourceMode={sourceMode}
            uploadBlocked={sourceMode === "upload" && (!canUploadMedia || Boolean(selectedFileError))}
            isUploadSubmitting={isUploadSubmitting}
          />
          <p className="muted small">Analysis begins after your sermon is saved. You can leave while it works.</p>
        </div>

        <details className="upload-import-options">
          <summary>More import options</summary>
          <div className="actions-row">
            <button className="button tertiary" type="button" onClick={() => setActiveFeatureModal("drive")}>
              Google Drive <span className="button-note">Coming soon</span>
            </button>
            <button className="button tertiary" type="button" onClick={() => setActiveFeatureModal("zoom")}>
              Zoom <span className="button-note">Coming soon</span>
            </button>
          </div>
        </details>

        {displayState.message ? (
          <p className={displayState.success ? "success-banner" : "error-banner"} role="status">{displayState.message}</p>
        ) : null}

        {displayState.createdSermonId ? (
          <div className="actions-row">
            <Link className="button secondary" href="/">
              Back to Dashboard
            </Link>
            <Link className="button primary" href={`/sermons/${displayState.createdSermonId}`}>
              {displayState.success ? "Open live progress" : "Open saved sermon"}
            </Link>
          </div>
        ) : null}
      </form>
      <FeatureModal kind={activeFeatureModal} onClose={() => setActiveFeatureModal(null)} />
    </>
  );
}
