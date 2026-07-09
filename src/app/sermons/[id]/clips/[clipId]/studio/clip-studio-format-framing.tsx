"use client";

import type { ClipExportFormat } from "@prisma/client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  FORMAT_LABELS,
  FRAMING_DESCRIPTIONS,
  FRAMING_PERSONALITY_DESCRIPTIONS,
  FRAMING_PERSONALITY_LABELS,
  PLATFORM_PRESET_LABELS,
  SELECTABLE_FORMATS,
  buildFramingWarnings,
  isValidExportFormat,
  mapPlatformPresetToFormat,
  resolveFramingDisplayLabel,
  summarizeExportSettings,
  type ExportSettings,
  type FramingPersonality,
  type PlatformPreset,
} from "@/lib/clipExportSettings";
import {
  generateSmartCropDebugSnapshotAction,
  refreshClipVideoTrackingAction,
  type ClipVideoTrackingActionState,
  type SmartCropDebugActionState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";
import {
  buildPresetManualCropKeyframes,
  normalizeManualCropKeyframes,
  nudgeManualCropKeyframes,
} from "@/lib/manualCrop";

type ClipStudioFormatFramingProps = {
  clipId: string;
  clipDurationSeconds: number | null;
  initialSettings: ExportSettings;
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

const FRAMING_MODE_CARDS: Array<{
  label: string;
  description: string;
  personality: FramingPersonality;
  mode: ExportSettings["framingMode"];
}> = [
  {
    label: "Auto Intelligent",
    description: "Best automatic choice for this sermon moment.",
    personality: "AUTO_INTELLIGENT",
    mode: "SMART_CROP",
  },
  {
    label: "Speaker Focus",
    description: "Keeps the pastor steady and centered.",
    personality: "SPEAKER_FOCUS",
    mode: "SMART_CROP",
  },
  {
    label: "Worship Wide",
    description: "Leaves more stage and worship context.",
    personality: "WORSHIP_WIDE",
    mode: "FIT_BLURRED_BACKGROUND",
  },
  {
    label: "Full Stage",
    description: "Prioritizes not cutting anyone off.",
    personality: "SAFE_FULL_STAGE",
    mode: "FIT_BLURRED_BACKGROUND",
  },
  {
    label: "Center Crop",
    description: "Simple centered crop for stable shots.",
    personality: "AUTO_INTELLIGENT",
    mode: "CENTER_CROP",
  },
  {
    label: "Blurred Background",
    description: "Fits the full frame into the output.",
    personality: "AUTO_INTELLIGENT",
    mode: "FIT_BLURRED_BACKGROUND",
  },
];

export function ClipStudioFormatFraming({
  clipId,
  clipDurationSeconds,
  initialSettings,
  videoSubjectTracks,
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
  const [manualCropPreviewKeyframes, setManualCropPreviewKeyframes] = useState(initialSettings.manualCropKeyframes);

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
      manualCropKeyframes: manualCropPreviewKeyframes,
    } as ExportSettings),
    [platformPreset, primaryFormat, selectedFormats, framingMode, framingPersonality, manualCropPreviewKeyframes],
  );

  const previewSummary = summarizeExportSettings(previewSettings);
  const warnings = buildFramingWarnings(previewSettings);
  const manualCropCount = manualCropPreviewKeyframes.length;
  const activeModeLabel = resolveFramingDisplayLabel(previewSettings);
  const frameQualitySummary = useMemo(() => {
    if (framingDecisionSummary) {
      return framingDecisionSummary;
    }

    if (visualQualityScore === null) {
      return "Prepare video to check framing quality.";
    }

    if (visualQualityScore >= 7.8 && (speakerVisiblePercentage ?? 0) >= 70 && (cropStabilityScore ?? 0) >= 7) {
      return "Frame quality: Good. Pastor centered, no major crop instability.";
    }

    if (visualQualityScore < 6.5 || (speakerVisiblePercentage ?? 100) < 70 || (cropStabilityScore ?? 10) < 6.5) {
      return "Manual adjust recommended: framing is usable for review but not premium enough for posting.";
    }

    return "Frame quality: Review. Usable framing, but check the pastor before publishing.";
  }, [cropStabilityScore, framingDecisionSummary, speakerVisiblePercentage, visualQualityScore]);

  useEffect(() => {
    updateExportSettings(previewSettings);
  }, [previewSettings, updateExportSettings]);

  function onPlatformPresetChange(nextPreset: PlatformPreset) {
    const mapped = mapPlatformPresetToFormat(nextPreset);
    setPlatformPreset(nextPreset);
    setPrimaryFormat(mapped);
    setSelectedFormats((current) => Array.from(new Set([mapped, ...current])));
  }

  function onPrimaryFormatChange(nextFormat: ClipExportFormat) {
    setPrimaryFormat(nextFormat);
    setSelectedFormats((current) => (
      current.includes(nextFormat) ? current : [nextFormat, ...current]
    ));
  }

  function toggleFormatSelection(format: ClipExportFormat) {
    if (!selectedFormats.includes(format)) {
      setSelectedFormats([...selectedFormats, format]);
      return;
    }

    if (selectedFormats.length === 1) {
      return;
    }

    const nextFormats = selectedFormats.filter((item) => item !== format);
    setSelectedFormats(nextFormats);
    if (primaryFormat === format) {
      setPrimaryFormat(nextFormats[0] ?? format);
    }
  }

  function applyFraming(personality: FramingPersonality, mode: ExportSettings["framingMode"]) {
    setFramingPersonality(personality);
    setFramingMode(mode);
    if (mode !== "SMART_CROP") {
      setManualCropPreviewKeyframes([]);
    }
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

  function previewManualCrop(input: {
    direction?: "left" | "center" | "right";
    nudge?: "left" | "right";
    keyframes?: Array<{ timeSeconds: number; centerX: number; centerY?: number; zoom?: number }>;
  }) {
    setCropMessage("");
    const keyframes = input.keyframes
      ? normalizeManualCropKeyframes(input.keyframes)
      : input.nudge
        ? nudgeManualCropKeyframes({ keyframes: manualCropPreviewKeyframes, direction: input.nudge, durationSeconds: clipDurationSeconds ?? 0 })
        : buildPresetManualCropKeyframes({ direction: input.direction ?? "center", durationSeconds: clipDurationSeconds ?? 0 });

    if (keyframes.length === 0) {
      setCropSuccess(false);
      setCropMessage("Manual crop correction did not include any usable keyframes.");
      return;
    }

    setManualCropPreviewKeyframes(keyframes);
    setFramingMode("SMART_CROP");
    setCropSuccess(true);
    setCropMessage("Framing adjusted in preview. Prepare for Posting saves it.");
  }

  function adjustManualKeyframes(input: { centerX?: number; centerY?: number; zoom?: number }) {
    const durationSeconds = Math.max(0, clipDurationSeconds ?? 0);
    const baseKeyframes = manualCropPreviewKeyframes.length > 0
      ? manualCropPreviewKeyframes
      : buildPresetManualCropKeyframes({ direction: "center", durationSeconds });
    const keyframes = baseKeyframes.map((keyframe) => ({
      ...keyframe,
      centerX: input.centerX ?? keyframe.centerX,
      centerY: input.centerY ?? keyframe.centerY ?? 0.5,
      zoom: input.zoom ?? keyframe.zoom ?? 1,
    }));

    previewManualCrop({ keyframes });
  }

  function resetManualCrop() {
    setCropMessage("");
    setManualCropPreviewKeyframes([]);
    if (initialSettings.manualCropKeyframes.length === 0) {
      setFramingMode(initialSettings.framingMode);
      setFramingPersonality(initialSettings.framingPersonality);
    }
    setCropSuccess(true);
    setCropMessage("Manual crop reset in preview. Prepare for Posting saves it.");
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

  return (
    <SectionCard title="Framing" description="Choose the platform, shape, and speaker crop for the current preview.">
      <div className="stack-md">
        <div className="clip-studio-effect-note">
          <StatusBadge tone="accent">Working preview</StatusBadge>
          <p>Format and framing changes update this preview. Automated speaker movement and multi-point crops are finalized during preparation.</p>
        </div>

        <label className="stack-sm">
          Platform
          <select
            value={platformPreset}
            onChange={(event) => onPlatformPresetChange(event.target.value as PlatformPreset)}
            disabled={isPending}
          >
            {PLATFORM_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{PLATFORM_PRESET_LABELS[preset]}</option>
            ))}
          </select>
        </label>

        <label className="stack-sm">
          Output shape
          <select
            value={primaryFormat}
            onChange={(event) => {
              const value = event.target.value;
              if (isValidExportFormat(value)) {
                onPrimaryFormatChange(value);
              }
            }}
            disabled={isPending}
          >
            {SELECTABLE_FORMATS.map((format) => (
              <option key={format} value={format}>{FORMAT_LABELS[format]}</option>
            ))}
          </select>
        </label>

        <fieldset className="stack-sm">
          <legend className="muted small">Final formats</legend>
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
        </fieldset>

        <section className="stack-sm pastor-insight" aria-labelledby="framing-mode-heading">
          <div className="actions-row">
            <div>
              <p className="kicker">Mode</p>
              <h3 id="framing-mode-heading">{activeModeLabel}</h3>
            </div>
            <StatusBadge tone={framingMode === "SMART_CROP" ? "accent" : framingMode === "FIT_BLURRED_BACKGROUND" ? "success" : "neutral"}>
              {FRAMING_PERSONALITY_LABELS[framingPersonality]}
            </StatusBadge>
          </div>
          <div className="framing-mode-card-grid">
            {FRAMING_MODE_CARDS.map((card) => (
              <button
                key={`${card.personality}-${card.mode}-${card.label}`}
                type="button"
                className={
                  framingMode === card.mode && framingPersonality === card.personality
                    ? "framing-mode-card is-active"
                    : "framing-mode-card"
                }
                onClick={() => applyFraming(card.personality, card.mode)}
                disabled={isPending}
              >
                <strong>{card.label}</strong>
                <span>{card.description}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{FRAMING_DESCRIPTIONS[framingMode]}</p>
          <p className="muted small">{FRAMING_PERSONALITY_DESCRIPTIONS[framingPersonality]}</p>
        </section>

        <section className="stack-sm pastor-insight" aria-labelledby="manual-adjust-heading">
          <div className="actions-row">
            <div>
              <p className="kicker">Manual Adjust</p>
              <h3 id="manual-adjust-heading">Fine tune crop</h3>
            </div>
            <StatusBadge tone={manualCropCount > 0 ? "accent" : "neutral"}>
              {manualCropCount > 0 ? "Custom preview" : "Automatic"}
            </StatusBadge>
          </div>
          <div className="framing-control-grid compact">
            <button type="button" className="button secondary" onClick={() => previewManualCrop({ direction: "left" })} disabled={isPending}>
              Left
            </button>
            <button type="button" className="button secondary" onClick={() => previewManualCrop({ direction: "center" })} disabled={isPending}>
              Center
            </button>
            <button type="button" className="button secondary" onClick={() => previewManualCrop({ direction: "right" })} disabled={isPending}>
              Right
            </button>
          </div>
          <div className="framing-nudge-row">
            <button type="button" className="button secondary" onClick={() => previewManualCrop({ nudge: "left" })} disabled={isPending}>
              Nudge left
            </button>
            <button type="button" className="button secondary" onClick={() => previewManualCrop({ nudge: "right" })} disabled={isPending}>
              Nudge right
            </button>
            <button type="button" className="button secondary" onClick={resetManualCrop} disabled={isPending || manualCropCount === 0}>
              Reset
            </button>
          </div>
          <div className="framing-nudge-row">
            <button type="button" className="button secondary" onClick={() => adjustManualKeyframes({ centerY: 0.42 })} disabled={isPending}>
              Nudge up
            </button>
            <button type="button" className="button secondary" onClick={() => adjustManualKeyframes({ centerY: 0.58 })} disabled={isPending}>
              Nudge down
            </button>
            <button type="button" className="button secondary" onClick={() => adjustManualKeyframes({ zoom: 1.18 })} disabled={isPending}>
              Zoom in
            </button>
          </div>
          <div className="framing-nudge-row compact-two">
            <button type="button" className="button secondary" onClick={() => adjustManualKeyframes({ zoom: 1 })} disabled={isPending}>
              Zoom out
            </button>
          </div>
          <p className="muted small">
            {manualCropCount > 0
              ? "Custom framing is active in this preview. Prepare for Posting saves it to the final video."
              : "Manual adjust previews a crop correction for the final render."}
          </p>
          {cropMessage ? (
            <p className={cropSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {cropMessage}
            </p>
          ) : null}
        </section>

        <details className="clip-studio-editor-disclosure">
          <summary>
            <span>Advanced diagnostics</span>
            <span className="muted small">Frame check, tracking, debug snapshot</span>
          </summary>
          <div className="stack-md">
        <section className="stack-sm pastor-insight" aria-labelledby="frame-quality-heading">
          <div className="actions-row">
            <div>
              <p className="kicker">Quality</p>
              <h3 id="frame-quality-heading">Frame check</h3>
            </div>
            <StatusBadge tone={(visualQualityScore ?? 0) >= 8 ? "success" : (visualQualityScore ?? 0) >= 6.5 ? "warning" : "neutral"}>
              {visualQualityScore !== null ? `${visualQualityScore.toFixed(1)}/10` : "Pending"}
            </StatusBadge>
          </div>
          <p className="muted small">{frameQualitySummary}</p>
          <div className="posting-draft-list">
            <article className="posting-draft-card">
              <strong>Tracking</strong>
              <p className="muted small">
                {averageTrackingConfidence !== null || cropStabilityScore !== null
                  ? [
                      averageTrackingConfidence !== null ? `Confidence ${averageTrackingConfidence.toFixed(2)}` : null,
                      cropStabilityScore !== null ? `Stability ${cropStabilityScore.toFixed(1)}/10` : null,
                    ].filter(Boolean).join(" · ")
                  : "Tracking quality appears after diagnostics run."}
              </p>
            </article>
            <article className="posting-draft-card">
              <strong>Readiness</strong>
              <p className="muted small">
                {visualReadinessScore !== null ? `${visualReadinessScore.toFixed(1)}/10` : "Pending"}
              </p>
            </article>
          </div>
        </section>

        <section className="stack-sm pastor-insight" aria-labelledby="tracking-heading">
          <div className="actions-row">
            <div>
              <p className="kicker">Tracking</p>
              <h3 id="tracking-heading">{videoSubjectTracks.length > 0 ? `${videoSubjectTracks.length} subject track${videoSubjectTracks.length === 1 ? "" : "s"}` : "Speaker tracking not ready"}</h3>
            </div>
            <button type="button" className="button secondary" onClick={refreshTracking} disabled={isPending}>
              {isPending ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {videoSubjectTracks.length > 0 ? (
            <div className="posting-draft-list">
              {videoSubjectTracks.slice(0, 3).map((track) => (
                <article key={track.id} className="posting-draft-card">
                  <strong>{track.kind.toLowerCase().replace(/_/g, " ")}</strong>
                  <p className="muted small">
                    {Math.round(track.confidenceScore * 100)}% · center {Math.round(track.centerX * 100)}% across
                  </p>
                </article>
              ))}
            </div>
          ) : null}
          {trackingMessage ? (
            <p className={trackingSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
              {trackingMessage}
            </p>
          ) : null}
        </section>

        <section className="stack-sm pastor-insight" aria-labelledby="framing-diagnostic-heading">
          <div className="actions-row">
            <div>
              <p className="kicker">Diagnostic</p>
              <h3 id="framing-diagnostic-heading">Safe area frame</h3>
            </div>
            <button type="button" className="button secondary" onClick={generateDebugSnapshot} disabled={isPending}>
              {isPending ? "Checking..." : "Check frame"}
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
        </section>
          </div>
        </details>

        <div className="stack-sm">
          <p className="muted small">Current setup</p>
          <p>{previewSummary}</p>
          {warnings.length > 0 ? (
            <ul className="warning-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
