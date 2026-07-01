"use client";

import { useMemo, useState, useTransition } from "react";
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

export function ClipStudioPrepareButton({
  clipId,
  hasPreparedMedia,
  serverNeedsUpdate,
}: ClipStudioPrepareButtonProps) {
  const router = useRouter();
  const { editPreview, exportSettings, brandingConfig } = useClipStudioPreview();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PrepareClipStudioForPostingState | null>(null);

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

  function prepareForPosting() {
    setResult(null);

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
          hookOverlay: editPreview.hookOverlay,
          speechCleanup: editPreview.speechCleanup,
        },
        exportSettings: {
          platformPreset: exportSettings.platformPreset,
          primaryFormat: exportSettings.primaryFormat,
          selectedFormats: exportSettings.selectedFormats,
          framingMode: exportSettings.framingMode,
          framingPersonality: exportSettings.framingPersonality,
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
        className="button primary clip-studio-prepare-button"
        onClick={prepareForPosting}
        disabled={isPending || !canPrepare}
      >
        {isPending ? "Preparing..." : "Prepare for Posting"}
      </button>
      {isPending ? (
        <div className="clip-studio-prepare-progress" aria-label="Preparation progress">
          <span>Saving composition</span>
          <span>Approving clip</span>
          <span>Rendering final video</span>
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
