"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  prepareClipStudioForPostingAction,
  type PrepareClipStudioForPostingState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioPrepareButtonProps = {
  clipId: string;
  clipStatus: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  hasPreparedMedia: boolean;
  serverNeedsUpdate: boolean;
};

export function ClipStudioPrepareButton({
  clipId,
  clipStatus,
  hasPreparedMedia,
  serverNeedsUpdate,
}: ClipStudioPrepareButtonProps) {
  const router = useRouter();
  const {
    editPreview,
    exportSettings,
    brandingConfig,
    isDraftDirty,
    markDraftSaved,
  } = useClipStudioPreview();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PrepareClipStudioForPostingState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const canPrepare = editPreview.isTimingValid && editPreview.startSeconds !== null && editPreview.endSeconds !== null;
  const finalNeedsUpdate = hasPreparedMedia && (serverNeedsUpdate || isDraftDirty);
  const stateLabel = !canPrepare
    ? "Timing needs attention"
    : isDraftDirty
      ? "Unsaved draft"
      : hasPreparedMedia
        ? serverNeedsUpdate
          ? "Final video needs updating"
          : "Final video ready"
        : "Ready to prepare";
  const stateToneClass = !canPrepare || isDraftDirty || serverNeedsUpdate
    ? "tone-warning"
    : hasPreparedMedia
      ? "tone-success"
      : "tone-info";
  const actionLabel = hasPreparedMedia
    ? finalNeedsUpdate
      ? "Update final video"
      : "Rebuild final video"
    : clipStatus === "SUGGESTED" || clipStatus === "REJECTED"
      ? "Approve & prepare final video"
      : "Prepare final video";
  const finalIsReady = hasPreparedMedia && !serverNeedsUpdate && !isDraftDirty;
  const preparationChecklist = useMemo(
    () => [
      `${exportSettings.selectedFormats.length} video format${exportSettings.selectedFormats.length === 1 ? "" : "s"}`,
      editPreview.applyCaptionsToClip ? "On-video captions" : "Video without captions",
      exportSettings.manualCropKeyframes.length > 0 ? "Custom framing" : "Selected framing",
      brandingConfig.enabled && brandingConfig.preset !== "NO_BRANDING" ? "Church branding" : "Clean video",
    ],
    [
      brandingConfig.enabled,
      brandingConfig.preset,
      editPreview.applyCaptionsToClip,
      exportSettings.manualCropKeyframes.length,
      exportSettings.selectedFormats.length,
    ],
  );

  useEffect(() => {
    if (!isPending) {
      return undefined;
    }

    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, [isPending]);

  function prepareForPosting() {
    setResult(null);
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
          title: editPreview.title,
          editorialHook: editPreview.editorialHook,
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
        markDraftSaved();
        router.refresh();
      }
    });
  }

  return (
    <div className="clip-studio-prepare-control">
      <div className="clip-studio-prepare-state" aria-live="polite">
        <span className={`status-pill ${stateToneClass}`}>
          {stateLabel}
        </span>
      </div>
      {finalIsReady && !isPending ? (
        <div className="clip-studio-ready-actions">
          <Link className="button primary" href={`/ready-to-post?clipId=${clipId}`}>
            Continue to Publishing Desk
          </Link>
          <button
            type="button"
            className="button tertiary"
            onClick={prepareForPosting}
            disabled={!canPrepare}
          >
            Rebuild video
          </button>
        </div>
      ) : (
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
            <span>{isPending ? "Preparing final video" : actionLabel}</span>
          </span>
        </button>
      )}
      {isPending ? (
        <div className="clip-studio-prepare-loader" role="status" aria-live="polite">
          <div className="clip-studio-prepare-loader-head">
            <span className="clip-studio-prepare-loader-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>Preparing your final video</strong>
              <p>Saving this draft and building the selected output. This can take a few minutes.</p>
            </div>
            <time aria-label={`${elapsedSeconds} seconds elapsed`}>{elapsedSeconds}s</time>
          </div>
          <div className="clip-studio-prepare-track" aria-hidden="true">
            <span />
          </div>
          <div className="clip-studio-prepare-progress" aria-label="What will be prepared">
            {preparationChecklist.map((item) => (
              <span key={item} className="is-active">
                {item}
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
