"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  prepareClipStudioForPostingAction,
  saveClipStudioDraftAction,
  type PrepareClipStudioForPostingInput,
  type PrepareClipStudioForPostingState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioPrepareButtonProps = {
  clipId: string;
  clipStatus: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  hasPreparedMedia: boolean;
  serverNeedsUpdate: boolean;
  serverIsPreparing?: boolean;
  transcriptReviewRequired?: boolean;
};

export function ClipStudioPrepareButton({
  clipId,
  clipStatus,
  hasPreparedMedia,
  serverNeedsUpdate,
  serverIsPreparing = false,
  transcriptReviewRequired = false,
}: ClipStudioPrepareButtonProps) {
  const router = useRouter();
  const {
    editPreview,
    exportSettings,
    brandingConfig,
    isDraftDirty,
    draftCompositionKey,
    markDraftSaved,
  } = useClipStudioPreview();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PrepareClipStudioForPostingState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeOperation, setActiveOperation] = useState<"save" | "prepare" | null>(null);
  const canPrepare = editPreview.isTimingValid && editPreview.startSeconds !== null && editPreview.endSeconds !== null;
  const canPrepareFinal = canPrepare && !transcriptReviewRequired;
  const finalNeedsUpdate = hasPreparedMedia && (serverNeedsUpdate || isDraftDirty);
  const stateLabel = transcriptReviewRequired
    ? "Transcript review required"
    : !canPrepare
    ? "Timing needs attention"
    : serverIsPreparing
      ? "Final video is preparing"
      : isDraftDirty
        ? "Unsaved draft"
        : hasPreparedMedia
          ? serverNeedsUpdate
            ? "Final video needs updating"
            : "Final video ready"
          : "Ready to prepare";
  const stateToneClass = transcriptReviewRequired
    ? "tone-warning"
    : serverIsPreparing
      ? "tone-info"
    : !canPrepare || isDraftDirty || serverNeedsUpdate
      ? "tone-warning"
      : hasPreparedMedia
        ? "tone-success"
        : "tone-info";
  const actionLabel = transcriptReviewRequired
    ? "Review transcript before preparing"
    : serverIsPreparing
    ? "Preparation in progress"
    : hasPreparedMedia
      ? finalNeedsUpdate
        ? "Update final video"
        : "Rebuild final video"
      : clipStatus === "SUGGESTED" || clipStatus === "REJECTED"
        ? "Approve & prepare final video"
        : "Prepare final video";
  const finalIsReady = hasPreparedMedia && !serverNeedsUpdate && !isDraftDirty && !serverIsPreparing;
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

  useEffect(() => {
    if (!serverIsPreparing || isPending) {
      return undefined;
    }

    const refreshTimer = window.setInterval(() => {
      router.refresh();
    }, 8_000);

    return () => window.clearInterval(refreshTimer);
  }, [isPending, router, serverIsPreparing]);

  function buildStudioInput(forceRebuild = false): PrepareClipStudioForPostingInput {
    return {
      clipId,
      forceRebuild,
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
    };
  }

  function runStudioOperation(operation: "save" | "prepare") {
    setResult(null);
    setElapsedSeconds(0);

    if (!canPrepare) {
      setResult({
        success: false,
        message: "Choose a valid start and end before saving this Studio draft.",
        results: [],
      });
      return;
    }

    if (operation === "prepare" && (serverIsPreparing || transcriptReviewRequired)) {
      return;
    }

    const submittedDraftKey = draftCompositionKey;
    const forceRebuild = operation === "prepare" && finalIsReady;
    setActiveOperation(operation);

    startTransition(async () => {
      try {
        const input = buildStudioInput(forceRebuild);
        const nextResult = operation === "save"
          ? await saveClipStudioDraftAction(input)
          : await prepareClipStudioForPostingAction(input);

        setResult(nextResult);
        if (nextResult.draftSaved) {
          // Mark only the composition that was actually submitted. If the
          // pastor kept editing during a long render, those newer changes stay
          // visibly unsaved instead of being cleared by the older response.
          markDraftSaved(submittedDraftKey);
        }
        if (nextResult.success || nextResult.draftSaved) {
          router.refresh();
        }
      } catch (error) {
        setResult({
          success: false,
          message: error instanceof Error
            ? error.message
            : "Studio could not complete this request. Your browser draft is still available.",
          results: [],
        });
      } finally {
        setActiveOperation(null);
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
            onClick={() => runStudioOperation("prepare")}
            disabled={!canPrepareFinal}
          >
            Rebuild video
          </button>
        </div>
      ) : (
        <div className="clip-studio-ready-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => runStudioOperation("save")}
            disabled={isPending || !isDraftDirty || !canPrepare}
            aria-busy={isPending && activeOperation === "save"}
          >
            {isPending && activeOperation === "save" ? "Saving draft…" : "Save draft"}
          </button>
          <button
            type="button"
            className={`button primary clip-studio-prepare-button${isPending && activeOperation === "prepare" ? " is-preparing" : ""}`}
            onClick={() => runStudioOperation("prepare")}
            disabled={isPending || serverIsPreparing || !canPrepareFinal}
            aria-busy={isPending && activeOperation === "prepare"}
          >
            <span className="clip-studio-prepare-button-content">
              <span
                className={isPending && activeOperation === "prepare" ? "clip-studio-prepare-spinner" : "clip-studio-prepare-idle-mark"}
                aria-hidden="true"
              />
              <span>{isPending && activeOperation === "prepare" ? "Preparing final video" : actionLabel}</span>
            </span>
          </button>
        </div>
      )}
      {isPending ? (
        <div className="clip-studio-prepare-loader" role="status" aria-live="polite">
          <div className="clip-studio-prepare-loader-head">
            <span className="clip-studio-prepare-loader-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>{activeOperation === "save" ? "Saving your Studio draft" : "Preparing your final video"}</strong>
              <p>
                {activeOperation === "save"
                  ? "Saving words, framing, captions, audio choices, and branding without starting a render."
                  : "Saving this draft and building the selected output. This can take a few minutes."}
              </p>
            </div>
            <time aria-label={`${elapsedSeconds} seconds elapsed`}>{elapsedSeconds}s</time>
          </div>
          <div className="clip-studio-prepare-track" aria-hidden="true">
            <span />
          </div>
          {activeOperation === "prepare" ? (
            <div className="clip-studio-prepare-progress" aria-label="What will be prepared">
              {preparationChecklist.map((item) => (
                <span key={item} className="is-active">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div className={result.success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          <p>{result.message}</p>
          {result.draftSaved && !result.success ? <p>Your Studio draft is saved; only the media preparation needs attention.</p> : null}
          {result.fieldErrors && Object.values(result.fieldErrors).some(Boolean) ? (
            <ul>
              {Object.values(result.fieldErrors).filter((message): message is string => Boolean(message)).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {result.warnings && result.warnings.length > 0 ? (
            <ul>
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          {result.results.filter((item) => item.status === "FAILED").map((item) => (
            <p key={item.recordId}>{item.format.replaceAll("_", " ")}: {item.errorMessage ?? "Preparation failed."}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
