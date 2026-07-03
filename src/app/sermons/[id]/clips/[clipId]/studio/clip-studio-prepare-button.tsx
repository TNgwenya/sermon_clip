"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  prepareClipStudioForPostingAction,
  type PrepareClipStudioForPostingState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioPrepareButtonProps = {
  clipId: string;
  hasPreparedMedia: boolean;
  serverNeedsUpdate: boolean;
};

function buildCompositionKey(value: unknown): string {
  return JSON.stringify(value);
}

const PREPARE_STAGES = [
  {
    label: "Saving edits",
    detail: "Locking in the current timing, captions, framing, and branding.",
  },
  {
    label: "Rendering video",
    detail: "Building the final clip from the selected sermon section.",
  },
  {
    label: "Adding captions",
    detail: "Preparing the on-video captions and styling.",
  },
  {
    label: "Packaging download",
    detail: "Creating the posting-ready video file.",
  },
] as const;

export function ClipStudioPrepareButton({
  clipId,
  hasPreparedMedia,
  serverNeedsUpdate,
}: ClipStudioPrepareButtonProps) {
  const router = useRouter();
  const { editPreview, exportSettings, brandingConfig } = useClipStudioPreview();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PrepareClipStudioForPostingState | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const compositionSnapshot = useMemo(
    () => ({
      editPreview,
      exportSettings,
      brandingConfig,
    }),
    [brandingConfig, editPreview, exportSettings],
  );
  const compositionKey = useMemo(() => buildCompositionKey(compositionSnapshot), [compositionSnapshot]);
  const [baselineCompositionKey, setBaselineCompositionKey] = useState(() => compositionKey);

  const locallyChanged = baselineCompositionKey !== compositionKey;
  const finalNeedsUpdate = hasPreparedMedia && (serverNeedsUpdate || locallyChanged);
  const stateLabel = hasPreparedMedia
    ? finalNeedsUpdate
      ? "Final video needs updating"
      : "Final video ready"
    : "Ready to prepare";
  const canPrepare = editPreview.isTimingValid && editPreview.startSeconds !== null && editPreview.endSeconds !== null;
  const activeStage = PREPARE_STAGES[activeStageIndex] ?? PREPARE_STAGES[0];

  useEffect(() => {
    if (!isPending) {
      return undefined;
    }

    const stageTimer = window.setInterval(() => {
      setActiveStageIndex((current) => Math.min(current + 1, PREPARE_STAGES.length - 1));
    }, 3200);
    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [isPending]);

  function prepareForPosting() {
    setResult(null);
    setActiveStageIndex(0);
    setElapsedSeconds(0);

    if (!canPrepare) {
      setResult({
        success: false,
        message: "Choose a valid start and end before preparing the final video.",
        results: [],
      });
      return;
    }

    startTransition(async () => {
      const nextResult = await prepareClipStudioForPostingAction({
        clipId,
        editPreview: {
          startSeconds: editPreview.startSeconds,
          endSeconds: editPreview.endSeconds,
          mainCaption: editPreview.mainCaption,
          shortCaption: editPreview.shortCaption,
          platformCaption: editPreview.platformCaption,
          onVideoCaptionText: editPreview.onVideoCaptionText,
          hashtags: editPreview.hashtags,
          captionCues: editPreview.captionCues,
          applyCaptionsToClip: editPreview.applyCaptionsToClip,
          captionStylePresetId: editPreview.captionStylePresetId,
          captionPosition: editPreview.captionPosition,
          captionAppearance: editPreview.captionAppearance,
          hookOverlay: editPreview.hookOverlay,
          brollLayer: editPreview.brollLayer,
          speechCleanup: editPreview.speechCleanup,
          speechCleanupEdits: editPreview.speechCleanupEdits,
        },
        exportSettings: {
          platformPreset: exportSettings.platformPreset,
          primaryFormat: exportSettings.primaryFormat,
          selectedFormats: exportSettings.selectedFormats,
          framingMode: exportSettings.framingMode,
          framingPersonality: exportSettings.framingPersonality,
          manualCropKeyframes: exportSettings.manualCropKeyframes,
        },
        brandingConfig,
      });

      setResult(nextResult);
      if (nextResult.success) {
        setBaselineCompositionKey(compositionKey);
        router.refresh();
      }
    });
  }

  return (
    <div className="clip-studio-prepare-control">
      <div className="clip-studio-prepare-state" aria-live="polite">
        <span className={finalNeedsUpdate ? "status-pill tone-warning" : "status-pill tone-success"}>
          {stateLabel}
        </span>
      </div>
      <button
        type="button"
        className={`button primary clip-studio-prepare-button${isPending ? " is-preparing" : ""}`}
        onClick={prepareForPosting}
        disabled={isPending || !canPrepare}
        aria-busy={isPending}
      >
        <span className="clip-studio-prepare-button-content">
          <span
            className={isPending ? "clip-studio-prepare-spinner" : "clip-studio-prepare-idle-mark"}
            aria-hidden="true"
          />
          <span>{isPending ? "Preparing final video" : "Prepare for Posting"}</span>
        </span>
      </button>
      {isPending ? (
        <div className="clip-studio-prepare-loader" role="status" aria-live="polite">
          <div className="clip-studio-prepare-loader-head">
            <span className="clip-studio-prepare-loader-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>{activeStage.label}</strong>
              <p>{activeStage.detail}</p>
            </div>
            <time>{elapsedSeconds}s</time>
          </div>
          <div className="clip-studio-prepare-track" aria-hidden="true">
            <span />
          </div>
          <div className="clip-studio-prepare-progress" aria-label="Preparation stages">
            {PREPARE_STAGES.map((stage, index) => (
              <span
                key={stage.label}
                className={index <= activeStageIndex ? "is-active" : ""}
              >
                {stage.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {result ? (
        <p className={result.success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
