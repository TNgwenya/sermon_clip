"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { FeatureModal, type FeatureModalKind } from "@/components/feature-modal";
import {
  createSermonAction,
  type CreateSermonFormState,
} from "@/server/actions/sermons";

const initialCreateSermonState: CreateSermonFormState = {
  success: false,
  message: "",
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button primary command-cta" type="submit" disabled={pending}>
      {pending ? "Starting workflow..." : "Start clip workflow"}
    </button>
  );
}

function UploadProgressTheater() {
  const { pending } = useFormStatus();

  if (!pending) {
    return null;
  }

  return (
    <div className="upload-progress-backdrop" role="status" aria-live="polite">
      <section className="upload-progress-theater">
        <div className="upload-progress-copy stack-sm">
          <p className="kicker">Starting clip workflow</p>
          <h2>Saving the sermon and starting analysis.</h2>
          <p className="muted">
            Keep this tab open while Sermon Clip saves the source and starts the full workflow toward generated clips.
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
          <span className="workflow-step done">Saving sermon</span>
          <span className="workflow-step active">Starting full pipeline</span>
          <span className="workflow-step pending">Generating clips</span>
        </div>
      </section>
    </div>
  );
}

export function NewSermonForm({ initialYoutubeUrl = "" }: { initialYoutubeUrl?: string }) {
  const [state, formAction] = useActionState(createSermonAction, initialCreateSermonState);
  const [activeFeatureModal, setActiveFeatureModal] = useState<FeatureModalKind | null>(null);

  return (
    <>
      <form action={formAction} className="upload-form-panel stack-md">
        <UploadProgressTheater />
        <div className="link-input-shell large">
          <span className="input-icon">Link</span>
          <input id="youtubeUrl" name="youtubeUrl" type="url" placeholder="Paste a YouTube or sermon video link" defaultValue={initialYoutubeUrl} />
        </div>
        <div className="stack-sm">
          <label htmlFor="youtubeUrl">Sermon video link</label>
          <p className="muted small">Paste a sermon video link or upload a video file below. YouTube links work best for link-based processing.</p>
          {state.fieldErrors?.youtubeUrl ? <p className="field-error">{state.fieldErrors.youtubeUrl}</p> : null}
        </div>

        <div className="upload-drop-zone stack-sm dark-drop">
          <label htmlFor="sermonVideoFile">Upload sermon video (optional)</label>
          <input id="sermonVideoFile" name="sermonVideoFile" type="file" accept="video/*" />
          <p className="muted small">Use this when the sermon video is already on this computer. The file is stored locally and used as the source video.</p>
          {state.fieldErrors?.mediaFile ? <p className="field-error">{state.fieldErrors.mediaFile}</p> : null}
        </div>

        <div className="stack-sm">
          <label htmlFor="title">Sermon title</label>
          <input id="title" name="title" type="text" required placeholder="Sunday Service: Hope in Hard Times" />
          {state.fieldErrors?.title ? <p className="field-error">{state.fieldErrors.title}</p> : null}
        </div>

        <div className="review-edit-grid upload-meta-grid">
          <div className="stack-sm">
            <label htmlFor="speakerName">Preacher</label>
            <input id="speakerName" name="speakerName" type="text" required placeholder="Pastor Jane Doe" />
            {state.fieldErrors?.speakerName ? <p className="field-error">{state.fieldErrors.speakerName}</p> : null}
          </div>

          <div className="stack-sm">
            <label htmlFor="churchName">Church</label>
            <input id="churchName" name="churchName" type="text" required placeholder="Grace Community Church" />
            {state.fieldErrors?.churchName ? <p className="field-error">{state.fieldErrors.churchName}</p> : null}
          </div>

          <div className="stack-sm">
            <label htmlFor="language">Language</label>
            <input id="language" name="language" type="text" required placeholder="English" />
            {state.fieldErrors?.language ? <p className="field-error">{state.fieldErrors.language}</p> : null}
          </div>

          <div className="stack-sm">
            <label htmlFor="sermonDate">Sermon date (optional)</label>
            <input id="sermonDate" name="sermonDate" type="date" />
            {state.fieldErrors?.sermonDate ? <p className="field-error">{state.fieldErrors.sermonDate}</p> : null}
          </div>
        </div>

        <section className="sermon-window-panel stack-sm" aria-labelledby="sermon-window-title">
          <div className="stack-sm">
            <p className="kicker">Long service window</p>
            <h2 id="sermon-window-title">Mark where the sermon starts and ends</h2>
            <p className="muted small">
              Optional. Use this when the video includes worship, announcements, or altar ministry before or after the sermon.
            </p>
          </div>
          <div className="review-edit-grid upload-meta-grid">
            <div className="stack-sm">
              <label htmlFor="sermonStartTimestamp">Sermon starts at</label>
              <input id="sermonStartTimestamp" name="sermonStartTimestamp" type="text" inputMode="numeric" placeholder="Example: 32:15" />
              <p className="muted small">Format: <span className="code-text">MM:SS</span> or <span className="code-text">H:MM:SS</span>.</p>
              {state.fieldErrors?.sermonStartTimestamp ? <p className="field-error">{state.fieldErrors.sermonStartTimestamp}</p> : null}
            </div>

            <div className="stack-sm">
              <label htmlFor="sermonEndTimestamp">Sermon ends at</label>
              <input id="sermonEndTimestamp" name="sermonEndTimestamp" type="text" inputMode="numeric" placeholder="Example: 1:18:40" />
              <p className="muted small">Leave blank if the sermon runs to the end of the video.</p>
              {state.fieldErrors?.sermonEndTimestamp ? <p className="field-error">{state.fieldErrors.sermonEndTimestamp}</p> : null}
            </div>
          </div>
        </section>

        <div className="stack-sm">
          <label className="checkbox-label" htmlFor="rightsConfirmed">
            <input id="rightsConfirmed" name="rightsConfirmed" type="checkbox" required />
            <span>I confirm I have rights/permission to process this sermon media.</span>
          </label>
          {state.fieldErrors?.rightsConfirmed ? (
            <p className="field-error">{state.fieldErrors.rightsConfirmed}</p>
          ) : null}
        </div>

        <div className="upload-form-footer">
          <SubmitButton />
          <button className="button tertiary" type="button" onClick={() => setActiveFeatureModal("drive")}>
            Google Drive (soon)
          </button>
          <button className="button tertiary" type="button" onClick={() => setActiveFeatureModal("zoom")}>
            Zoom import (soon)
          </button>
        </div>

        {state.message ? (
          <p className={state.success ? "success-banner" : "error-banner"}>{state.message}</p>
        ) : null}

        {state.success && state.createdSermonId ? (
          <div className="actions-row">
            <Link className="button secondary" href="/">
              Back to Dashboard
            </Link>
            <Link className="button primary" href={`/sermons/${state.createdSermonId}`}>
              View running workflow
            </Link>
          </div>
        ) : null}
      </form>
      <FeatureModal kind={activeFeatureModal} onClose={() => setActiveFeatureModal(null)} />
    </>
  );
}
