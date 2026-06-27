"use client";

import type { ClipExportFormat } from "@prisma/client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  PLATFORM_PRESET_LABELS,
  FORMAT_LABELS,
  FRAMING_DESCRIPTIONS,
  FRAMING_LABELS,
  FRAMING_PERSONALITY_DESCRIPTIONS,
  FRAMING_PERSONALITY_LABELS,
  SELECTABLE_FORMATS,
  SELECTABLE_FRAMING_PERSONALITIES,
  SELECTABLE_FRAMING_MODES,
  summarizeExportSettings,
  buildFramingWarnings,
  mapPlatformPresetToFormat,
  isValidExportFormat,
  exportStatusTone,
  toPastorFriendlyExportStatus,
  type ClipStudioExportRecord,
  type FramingPersonality,
  type PlatformPreset,
  type ExportSettings,
} from "@/lib/clipExportSettings";
import { pastorFriendlyError } from "@/lib/pastorFriendlyErrors";
import {
  generateSmartCropDebugSnapshotAction,
  renderClipStudioExportsAction,
  retryClipStudioExportAction,
  refreshClipVideoTrackingAction,
  resetManualCropCorrectionAction,
  saveManualCropCorrectionAction,
  updateClipExportSettingsAction,
  type ManualCropActionState,
  type SmartCropDebugActionState,
  type ClipVideoTrackingActionState,
  type ClipStudioRenderActionState,
  type UpdateClipExportSettingsState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioFormatFramingProps = {
  clipId: string;
  initialSettings: ExportSettings;
  exportHistory: Array<ClipStudioExportRecord & { fileExists: boolean }>;
  currentExport: {
    format: ClipExportFormat;
    outputPath: string;
    fileExists: boolean;
  } | null;
  videoSubjectTracks: Array<{
    id: string;
    kind: string;
    source: string;
    label: string;
    confidenceScore: number;
    sampleCount: number;
    centerX: number;
    centerY: number;
  }>;
  manualCropKeyframes: unknown;
  manualCropUpdatedAt: string | null;
  smartCropDebugGeneratedAt: string | null;
  smartCropDebugError: string | null;
  hasSmartCropDebugSnapshot: boolean;
  visualQualityScore: number | null;
  visualReadinessScore: number | null;
  speakerVisiblePercentage: number | null;
  averageTrackingConfidence: number | null;
  cropStabilityScore: number | null;
  framingDecisionSummary: string | null;
};

const PLATFORM_PRESETS = Object.keys(PLATFORM_PRESET_LABELS) as PlatformPreset[];

function summarizeBrandingSnapshot(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const enabled = snapshot["enabled"] === true;
  if (!enabled) {
    return "Branding: disabled";
  }

  const preset = typeof snapshot["preset"] === "string" ? snapshot["preset"] : "Unknown preset";
  const watermarkEnabled = snapshot["watermarkEnabled"] === true;
  const lowerThirdEnabled = snapshot["lowerThirdEnabled"] === true;

  return `Branding: ${preset}, watermark ${watermarkEnabled ? "on" : "off"}, lower third ${
    lowerThirdEnabled ? "on" : "off"
  }`;
}

export function ClipStudioFormatFraming({
  clipId,
  initialSettings,
  exportHistory,
  currentExport,
  videoSubjectTracks,
  manualCropKeyframes,
  manualCropUpdatedAt,
  smartCropDebugGeneratedAt,
  smartCropDebugError,
  hasSmartCropDebugSnapshot,
  visualQualityScore,
  visualReadinessScore,
  speakerVisiblePercentage,
  averageTrackingConfidence,
  cropStabilityScore,
  framingDecisionSummary,
}: ClipStudioFormatFramingProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { updateExportSettings } = useClipStudioPreview();

  const [platformPreset, setPlatformPreset] = useState<PlatformPreset>(initialSettings.platformPreset);
  const [primaryFormat, setPrimaryFormat] = useState(initialSettings.primaryFormat);
  const [framingMode, setFramingMode] = useState(initialSettings.framingMode);
  const [framingPersonality, setFramingPersonality] = useState<FramingPersonality>(initialSettings.framingPersonality);
  const [selectedFormats, setSelectedFormats] = useState<ClipExportFormat[]>(initialSettings.selectedFormats);

  const [statusMessage, setStatusMessage] = useState("");
  const [statusSuccess, setStatusSuccess] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<UpdateClipExportSettingsState["fieldErrors"]>({});

  const [renderMessage, setRenderMessage] = useState("");
  const [renderSuccess, setRenderSuccess] = useState(true);
  const [lastRenderResults, setLastRenderResults] = useState<ClipStudioRenderActionState["results"]>([]);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [trackingSuccess, setTrackingSuccess] = useState(true);
  const [cropMessage, setCropMessage] = useState("");
  const [cropSuccess, setCropSuccess] = useState(true);
  const [debugMessage, setDebugMessage] = useState("");
  const [debugSuccess, setDebugSuccess] = useState(true);

  const previewSettings = useMemo(
    () => ({
      platformPreset,
      primaryFormat,
      selectedFormats,
      framingMode,
      framingPersonality,
      backgroundMode: framingMode === "FIT_BLURRED_BACKGROUND" ? "BLURRED" : "CROP",
    } as ExportSettings),
    [platformPreset, primaryFormat, selectedFormats, framingMode, framingPersonality],
  );

  const previewSummary = summarizeExportSettings(previewSettings);
  const warnings = buildFramingWarnings(previewSettings);
  const frameQualitySummary = useMemo(() => {
    if (framingDecisionSummary) {
      return framingDecisionSummary;
    }

    if (visualQualityScore === null) {
      return "Render once to score pastor visibility, crop stability, and caption-safe framing.";
    }

    if (visualQualityScore >= 7.8 && (speakerVisiblePercentage ?? 0) >= 70 && (cropStabilityScore ?? 0) >= 7) {
      return "Frame quality: Good. Pastor centered, no major crop instability.";
    }

    if (visualQualityScore < 6.5 || (speakerVisiblePercentage ?? 100) < 70 || (cropStabilityScore ?? 10) < 6.5) {
      return "Manual crop recommended: framing is usable for review but not premium enough for posting.";
    }

    return "Frame quality: Review. Usable framing, but check the pastor before publishing.";
  }, [cropStabilityScore, framingDecisionSummary, speakerVisiblePercentage, visualQualityScore]);
  const latestDownloads = exportHistory.filter(
    (record) => record.status === "COMPLETED" && record.outputPath && record.fileExists && record.isLatest,
  );
  const currentExportAlreadyInHistory = Boolean(
    currentExport && exportHistory.some((record) => record.outputPath === currentExport.outputPath),
  );

  useEffect(() => {
    updateExportSettings(previewSettings);
  }, [previewSettings, updateExportSettings]);

  function onPlatformPresetChange(nextPreset: PlatformPreset) {
    const mapped = mapPlatformPresetToFormat(nextPreset);
    setPlatformPreset(nextPreset);
    setPrimaryFormat(mapped);
    setSelectedFormats((current) => Array.from(new Set([mapped, ...current])));
  }

  function toggleFormatSelection(format: ClipExportFormat) {
    setSelectedFormats((current) => {
      if (current.includes(format)) {
        if (current.length === 1) {
          return current;
        }

        const next = current.filter((item) => item !== format);
        if (!next.includes(primaryFormat)) {
          const nextPrimary = next[0] ?? format;
          setPrimaryFormat(nextPrimary);
        }
        return next;
      }

      return [...current, format];
    });
  }

  function saveSettings() {
    setStatusMessage("");
    setFieldErrors({});

    startTransition(async () => {
      const result = await updateClipExportSettingsAction({
        clipId,
        platformPreset,
        primaryFormat,
        framingMode,
        framingPersonality,
        selectedFormats,
      });

      setFieldErrors(result.fieldErrors ?? {});
      setStatusSuccess(result.success);
      setStatusMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  function applyFramingMode(nextFramingMode: typeof framingMode) {
    setStatusMessage("");
    setFieldErrors({});
    setFramingMode(nextFramingMode);

    startTransition(async () => {
      const result = await updateClipExportSettingsAction({
        clipId,
        platformPreset,
        primaryFormat,
        framingMode: nextFramingMode,
        framingPersonality,
        selectedFormats,
      });

      setFieldErrors(result.fieldErrors ?? {});
      setStatusSuccess(result.success);
      setStatusMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  function applyFramingPersonality(nextPersonality: FramingPersonality, nextFramingMode = framingMode) {
    setStatusMessage("");
    setFieldErrors({});
    setFramingPersonality(nextPersonality);
    setFramingMode(nextFramingMode);

    startTransition(async () => {
      const result = await updateClipExportSettingsAction({
        clipId,
        platformPreset,
        primaryFormat,
        framingMode: nextFramingMode,
        framingPersonality: nextPersonality,
        selectedFormats,
      });

      setFieldErrors(result.fieldErrors ?? {});
      setStatusSuccess(result.success);
      setStatusMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  function renderSelectedFormats() {
    setRenderMessage("");
    startTransition(async () => {
      const result = await renderClipStudioExportsAction({
        clipId,
        selectedFormats,
      });

      setRenderSuccess(result.success);
      setRenderMessage(result.message);
      setLastRenderResults(result.results);
      router.refresh();
    });
  }

  function retryExport(recordId: string) {
    setRenderMessage("");
    startTransition(async () => {
      const result = await retryClipStudioExportAction({
        clipId,
        exportRecordId: recordId,
      });

      setRenderSuccess(result.success);
      setRenderMessage(result.message);
      setLastRenderResults(result.results);
      router.refresh();
    });
  }

  function refreshTracking() {
    setTrackingMessage("");
    startTransition(async () => {
      const result: ClipVideoTrackingActionState = await refreshClipVideoTrackingAction(clipId);
      setTrackingSuccess(result.success);
      setTrackingMessage(result.message);
      router.refresh();
    });
  }

  function saveManualCrop(input: { direction?: "left" | "center" | "right"; nudge?: "left" | "right" }) {
    setCropMessage("");
    startTransition(async () => {
      const result: ManualCropActionState = await saveManualCropCorrectionAction({
        clipId,
        ...input,
      });

      setCropSuccess(result.success);
      setCropMessage(result.message);

      if (result.success) {
        setFramingMode("SMART_CROP");
        router.refresh();
      }
    });
  }

  function resetManualCrop() {
    setCropMessage("");
    startTransition(async () => {
      const result: ManualCropActionState = await resetManualCropCorrectionAction(clipId);
      setCropSuccess(result.success);
      setCropMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  function generateDebugSnapshot() {
    setDebugMessage("");
    startTransition(async () => {
      const result: SmartCropDebugActionState = await generateSmartCropDebugSnapshotAction(clipId);
      setDebugSuccess(result.success);
      setDebugMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  const manualCropCount = Array.isArray(manualCropKeyframes) ? manualCropKeyframes.length : 0;

  return (
    <SectionCard title="Posting Format" description="Choose where this clip will be shared and how the pastor should stay framed on screen.">
      <div className="stack-md">
        <label className="stack-sm">
          Intended platform or preset
          <select
            value={platformPreset}
            onChange={(event) => onPlatformPresetChange(event.target.value as PlatformPreset)}
            disabled={isPending}
            aria-invalid={Boolean(fieldErrors?.platformPreset)}
          >
            {PLATFORM_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{PLATFORM_PRESET_LABELS[preset]}</option>
            ))}
          </select>
          {fieldErrors?.platformPreset ? <span className="error-text small">{fieldErrors.platformPreset}</span> : null}
        </label>

        <label className="stack-sm">
          Download style
          <select
            value={primaryFormat}
            onChange={(event) => {
              const value = event.target.value;
              if (isValidExportFormat(value)) {
                setPrimaryFormat(value);
              }
            }}
            disabled={isPending}
            aria-invalid={Boolean(fieldErrors?.primaryFormat)}
          >
            {SELECTABLE_FORMATS.map((format) => (
              <option key={format} value={format}>{FORMAT_LABELS[format]}</option>
            ))}
          </select>
          {fieldErrors?.primaryFormat ? <span className="error-text small">{fieldErrors.primaryFormat}</span> : null}
        </label>

        <fieldset className="stack-sm" aria-invalid={Boolean(fieldErrors?.selectedFormats)}>
          <legend className="muted small">Optional extra downloads to create</legend>
          {SELECTABLE_FORMATS.map((format) => (
            <label key={format} className="review-checkbox-row">
              <input
                type="checkbox"
                checked={selectedFormats.includes(format)}
                onChange={() => toggleFormatSelection(format)}
                disabled={isPending}
              />
              <span>{FORMAT_LABELS[format]}</span>
            </label>
          ))}
          {fieldErrors?.selectedFormats ? <span className="error-text small">{fieldErrors.selectedFormats}</span> : null}
        </fieldset>

        <label className="stack-sm">
          Pastor framing
          <select
            value={framingMode}
            onChange={(event) => setFramingMode(event.target.value as typeof framingMode)}
            disabled={isPending}
            aria-invalid={Boolean(fieldErrors?.framingMode)}
          >
            {SELECTABLE_FRAMING_MODES.map((mode) => (
              <option key={mode} value={mode}>{FRAMING_LABELS[mode]}</option>
            ))}
          </select>
          {fieldErrors?.framingMode ? <span className="error-text small">{fieldErrors.framingMode}</span> : null}
          <p className="muted small">{FRAMING_DESCRIPTIONS[framingMode]}</p>
        </label>

        <label className="stack-sm">
          Framing personality
          <select
            value={framingPersonality}
            onChange={(event) => applyFramingPersonality(event.target.value as FramingPersonality)}
            disabled={isPending}
            aria-invalid={Boolean(fieldErrors?.framingPersonality)}
          >
            {SELECTABLE_FRAMING_PERSONALITIES.map((personality) => (
              <option key={personality} value={personality}>{FRAMING_PERSONALITY_LABELS[personality]}</option>
            ))}
          </select>
          {fieldErrors?.framingPersonality ? <span className="error-text small">{fieldErrors.framingPersonality}</span> : null}
          <p className="muted small">{FRAMING_PERSONALITY_DESCRIPTIONS[framingPersonality]}</p>
        </label>

        <div className="stack-sm pastor-insight">
          <div className="actions-row">
            <div>
              <p className="kicker">Creative framing</p>
              <p className="muted small">
                Choose the story shape first. The app still falls back safely if tracking is not reliable.
              </p>
            </div>
            <StatusBadge tone={framingMode === "FIT_BLURRED_BACKGROUND" ? "success" : framingMode === "SMART_CROP" ? "accent" : "neutral"}>
              {FRAMING_PERSONALITY_LABELS[framingPersonality]}
            </StatusBadge>
          </div>
          <div className="framing-control-grid">
            <button type="button" className="button secondary" onClick={() => applyFramingPersonality("SPEAKER_FOCUS", "SMART_CROP")} disabled={isPending}>
              Speaker focus
            </button>
            <button type="button" className="button secondary" onClick={() => applyFramingPersonality("CINEMATIC_CLOSE", "SMART_CROP")} disabled={isPending}>
              Cinematic close
            </button>
            <button type="button" className="button secondary" onClick={() => applyFramingPersonality("SOCIAL_PUNCHY", "SMART_CROP")} disabled={isPending}>
              Social punchy
            </button>
            <button type="button" className="button secondary" onClick={() => applyFramingPersonality("WORSHIP_WIDE", "FIT_BLURRED_BACKGROUND")} disabled={isPending}>
              Worship wide
            </button>
            <button type="button" className="button secondary" onClick={() => applyFramingPersonality("SAFE_FULL_STAGE", "FIT_BLURRED_BACKGROUND")} disabled={isPending}>
              Safe full-stage
            </button>
          </div>
          <div className="framing-control-grid">
            <button type="button" className="button secondary" onClick={() => applyFramingMode("SMART_CROP")} disabled={isPending}>
              Auto track
            </button>
            <button type="button" className="button secondary" onClick={() => saveManualCrop({ direction: "left" })} disabled={isPending}>
              Manual left
            </button>
            <button type="button" className="button secondary" onClick={() => saveManualCrop({ direction: "right" })} disabled={isPending}>
              Manual right
            </button>
            <button type="button" className="button secondary" onClick={() => saveManualCrop({ direction: "center" })} disabled={isPending}>
              Manual center
            </button>
          </div>
          <div className="framing-nudge-row">
            <button type="button" className="button secondary" onClick={() => saveManualCrop({ nudge: "left" })} disabled={isPending}>
              Nudge left
            </button>
            <button type="button" className="button secondary" onClick={() => saveManualCrop({ nudge: "right" })} disabled={isPending}>
              Nudge right
            </button>
            <button type="button" className="button secondary" onClick={resetManualCrop} disabled={isPending || manualCropCount === 0}>
              Reset manual crop
            </button>
          </div>
          <p className="muted small">
            {manualCropCount > 0
              ? `${manualCropCount} manual crop keyframe${manualCropCount === 1 ? "" : "s"} saved${manualCropUpdatedAt ? ` ${new Date(manualCropUpdatedAt).toLocaleString()}` : ""}.`
              : "No manual crop keyframes saved."}
          </p>
          {cropMessage ? (
            <p className={cropSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {cropMessage}
            </p>
          ) : null}
        </div>

        <p className="muted small">
          Auto pastor tracking uses saved face/body estimates. Refresh tracking when the pastor moves across the stage.
        </p>

        <div className="stack-sm pastor-insight">
          <div className="actions-row">
            <div>
              <p className="kicker">Frame quality</p>
              <p className="muted small">
                {frameQualitySummary}
              </p>
            </div>
            <StatusBadge tone={(visualQualityScore ?? 0) >= 8 ? "success" : (visualQualityScore ?? 0) >= 6.5 ? "warning" : "neutral"}>
              {visualQualityScore !== null ? `${visualQualityScore.toFixed(1)}/10` : "Not scored"}
            </StatusBadge>
          </div>
          <div className="posting-draft-list">
            <article className="posting-draft-card">
              <strong>Tracking</strong>
              <p className="muted small">
                Confidence {averageTrackingConfidence !== null ? averageTrackingConfidence.toFixed(2) : "N/A"} · Stability {cropStabilityScore !== null ? cropStabilityScore.toFixed(1) : "N/A"}/10
              </p>
            </article>
            <article className="posting-draft-card">
              <strong>Readiness</strong>
              <p className="muted small">
                {visualReadinessScore !== null
                  ? `${visualReadinessScore.toFixed(1)}/10 after the last render.`
                  : "Pending first render."}
              </p>
            </article>
          </div>
        </div>

        <div className="stack-sm pastor-insight">
          <div className="actions-row">
            <div>
              <p className="kicker">Video face/body tracking</p>
              <p className="muted small">
                {videoSubjectTracks.length > 0
                  ? `${videoSubjectTracks.length} track${videoSubjectTracks.length === 1 ? "" : "s"} ready for Auto pastor tracking.`
                  : "No video tracking prepared yet."}
              </p>
            </div>
            <button type="button" className="button secondary" onClick={refreshTracking} disabled={isPending}>
              {isPending ? "Refreshing..." : "Refresh tracking"}
            </button>
          </div>
          {videoSubjectTracks.length > 0 ? (
            <div className="posting-draft-list">
              {videoSubjectTracks.map((track) => (
                <article key={track.id} className="posting-draft-card">
                  <div>
                    <strong>{track.kind.toLowerCase().replace(/_/g, " ")}</strong>
                    <p className="muted small">{track.label}</p>
                    <p className="muted small">
                      {Math.round(track.confidenceScore * 100)}% confidence · {track.sampleCount} samples
                    </p>
                    <p className="muted small">
                      Center {Math.round(track.centerX * 100)}% across, {Math.round(track.centerY * 100)}% down
                    </p>
                  </div>
                  <span className="status-pill">{track.source.toLowerCase().replace(/_/g, " ")}</span>
                </article>
              ))}
            </div>
          ) : null}
          {trackingMessage ? (
            <p className={trackingSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {trackingMessage}
            </p>
          ) : null}
        </div>

        <div className="stack-sm pastor-insight">
          <div className="actions-row">
            <div>
              <p className="kicker">Framing diagnostic</p>
              <p className="muted small">
                Generate a still image with the smart-crop safe area and pastor center line.
              </p>
            </div>
            <button type="button" className="button secondary" onClick={generateDebugSnapshot} disabled={isPending}>
              {isPending ? "Generating..." : "Check frame"}
            </button>
          </div>
          {hasSmartCropDebugSnapshot ? (
            <figure className="framing-debug-preview">
              <Image
                src={`/api/clips/${clipId}/smart-crop-debug?ts=${encodeURIComponent(smartCropDebugGeneratedAt ?? "")}`}
                alt="Smart crop diagnostic frame"
                width={640}
                height={360}
                unoptimized
              />
              <figcaption className="muted small">
                {smartCropDebugGeneratedAt ? `Generated ${new Date(smartCropDebugGeneratedAt).toLocaleString()}.` : "Latest diagnostic frame."}
              </figcaption>
            </figure>
          ) : null}
          {smartCropDebugError ? <p className="status-help">{smartCropDebugError}</p> : null}
          {debugMessage ? (
            <p className={debugSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {debugMessage}
            </p>
          ) : null}
        </div>

        <div className="stack-sm">
          <p className="muted small">Sharing preview guidance</p>
          <p>{previewSummary}</p>
          {warnings.length > 0 ? (
            <ul className="warning-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="actions-row">
          <button type="button" className="button secondary" onClick={saveSettings} disabled={isPending}>
            Save sharing settings
          </button>
          <button type="button" className="button primary" onClick={renderSelectedFormats} disabled={isPending}>
            Re-render videos
          </button>
        </div>

        {statusMessage ? (
          <p className={statusSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
            {statusMessage}
          </p>
        ) : null}

        {renderMessage ? (
          <p className={renderSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
            {renderMessage}
          </p>
        ) : null}

        {lastRenderResults.length > 0 ? (
          <ul className="warning-list">
            {lastRenderResults.map((result) => (
              <li key={result.recordId}>
                {FORMAT_LABELS[result.format]}: {toPastorFriendlyExportStatus(result.status)}
                {result.errorMessage ? ` (${result.errorMessage})` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="stack-sm">
          <h3>Ready Downloads</h3>
          {currentExport || latestDownloads.length > 0 ? (
            <div className="stack-sm success-banner">
              <p><strong>Latest downloadable files</strong></p>
              {currentExport && !currentExportAlreadyInHistory ? (
                <a href={`/api/clips/${clipId}/download?variant=vertical`} className="button secondary">
                  Download current {FORMAT_LABELS[currentExport.format]}
                </a>
              ) : null}
              {latestDownloads.map((record) => (
                <a key={record.id} href={`/api/clips/${clipId}/download?historyId=${encodeURIComponent(record.id)}`} className="button secondary">
                  Download latest {FORMAT_LABELS[record.format]}
                </a>
              ))}
              {currentExport && !currentExport.fileExists ? (
                <p className="error-banner">A current download is listed, but the video file could not be found.</p>
              ) : null}
            </div>
          ) : null}

          {exportHistory.length === 0 && !currentExport ? (
            <p className="muted">No downloads yet. Prepare this clip to create ready-to-post videos.</p>
          ) : exportHistory.length > 0 ? (
            <div className="stack-sm">
              {exportHistory.map((record) => (
                <article key={record.id} className="card stack-sm">
                  <div className="actions-row">
                    <p>
                      <strong>{FORMAT_LABELS[record.format]}</strong>
                      {record.isLatest ? <span className="muted small"> (Latest)</span> : null}
                    </p>
                    <StatusBadge tone={exportStatusTone(record.status)}>{toPastorFriendlyExportStatus(record.status)}</StatusBadge>
                  </div>

                  <p className="muted small">
                    Platform: {PLATFORM_PRESET_LABELS[record.platformPreset]} · Pastor framing: {FRAMING_LABELS[record.framingMode]}
                  </p>

                  {summarizeBrandingSnapshot(record.brandingSnapshot) ? (
                    <p className="muted small">{summarizeBrandingSnapshot(record.brandingSnapshot)}</p>
                  ) : null}

                  {record.completedAt ? <p className="muted small">Completed: {new Date(record.completedAt).toLocaleString()}</p> : null}

                  {record.status === "COMPLETED" && record.outputPath && record.fileExists ? (
                    <a href={`/api/clips/${clipId}/download?historyId=${encodeURIComponent(record.id)}`} className="button secondary">
                      Download video
                    </a>
                  ) : null}

                  {record.status === "COMPLETED" && (!record.outputPath || !record.fileExists) ? (
                    <p className="error-banner">This download is listed, but the video file could not be found.</p>
                  ) : null}

                  {record.status === "FAILED" ? (
                    <div className="stack-sm">
                      <p className="error-banner">
                        {pastorFriendlyError(record.errorMessage)}
                      </p>
                      {record.errorMessage ? (
                        <details className="muted small">
                          <summary>Technical details</summary>
                          <p>{record.errorMessage}</p>
                        </details>
                      ) : null}
                      <button type="button" className="button secondary" onClick={() => retryExport(record.id)} disabled={isPending}>
                        Prepare again
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
