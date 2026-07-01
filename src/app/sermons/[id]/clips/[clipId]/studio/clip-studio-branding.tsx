"use client";

import { type CSSProperties, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  BRANDING_PRESET_DESCRIPTIONS,
  BRANDING_PRESET_LABELS,
  SELECTABLE_BRANDING_PRESETS,
  buildBrandingSummary,
  type BrandingPreset,
  type ClipBrandingConfig,
} from "@/lib/clipBranding";
import {
  updateClipBrandingAction,
  type ClipBrandingActionState,
} from "@/server/actions/sermons";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioBrandingProps = {
  clipId: string;
  initialConfig: ClipBrandingConfig;
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  logoAvailable: boolean;
};

export function ClipStudioBranding({
  clipId,
  initialConfig,
  churchName,
  sermonTitle,
  preacherName,
  logoAvailable,
}: ClipStudioBrandingProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { updateBrandingConfig } = useClipStudioPreview();

  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [preset, setPreset] = useState<BrandingPreset>(initialConfig.preset);
  const [showChurchName, setShowChurchName] = useState(initialConfig.showChurchName);
  const [showSermonTitle, setShowSermonTitle] = useState(initialConfig.showSermonTitle);
  const [showPreacherName, setShowPreacherName] = useState(initialConfig.showPreacherName);
  const [watermarkEnabled, setWatermarkEnabled] = useState(initialConfig.watermarkEnabled);
  const [lowerThirdEnabled, setLowerThirdEnabled] = useState(initialConfig.lowerThirdEnabled);
  const [themeColor, setThemeColor] = useState(initialConfig.themeColor ?? "");

  const [statusMessage, setStatusMessage] = useState("");
  const [statusSuccess, setStatusSuccess] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<ClipBrandingActionState["fieldErrors"]>({});

  const previewConfig = useMemo<ClipBrandingConfig>(
    () => ({
      enabled,
      preset,
      showChurchName,
      showSermonTitle,
      showPreacherName,
      watermarkEnabled,
      lowerThirdEnabled,
      themeColor: themeColor.trim().length > 0 ? themeColor.trim() : null,
    }),
    [
      enabled,
      preset,
      showChurchName,
      showSermonTitle,
      showPreacherName,
      watermarkEnabled,
      lowerThirdEnabled,
      themeColor,
    ],
  );

  const previewSummary = buildBrandingSummary(previewConfig, {
    churchName,
    sermonTitle,
    preacherName,
    logoPath: logoAvailable ? "available" : null,
  });
  const previewStyle = {
    "--clip-brand-color": previewConfig.themeColor ?? "#75d9b8",
  } as CSSProperties;

  useEffect(() => {
    updateBrandingConfig(previewConfig);
  }, [previewConfig, updateBrandingConfig]);

  function saveBranding() {
    setStatusMessage("");
    setFieldErrors({});

    startTransition(async () => {
      const result = await updateClipBrandingAction({
        clipId,
        enabled,
        preset,
        showChurchName,
        showSermonTitle,
        showPreacherName,
        watermarkEnabled,
        lowerThirdEnabled,
        themeColor: themeColor.trim().length > 0 ? themeColor.trim() : null,
      });

      setFieldErrors(result.fieldErrors ?? {});
      setStatusSuccess(result.success);
      setStatusMessage(result.message);

      if (result.success) {
        router.refresh();
      }
    });
  }

  return (
    <SectionCard
      title="Church branding"
      description="Add simple church identity to your rendered clip without using a design editor."
    >
      <div className="stack-md">
        <div className="clip-studio-effect-note">
          <StatusBadge tone="success">Live preview</StatusBadge>
          <p>Branding choices update the preview overlay immediately. Save and re-render before using the downloadable video.</p>
        </div>

        <label className="review-checkbox-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={isPending}
          />
          <span>Enable church branding</span>
        </label>

        <label className="stack-sm">
          Branding preset
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as BrandingPreset)}
            disabled={isPending || !enabled}
            aria-invalid={Boolean(fieldErrors?.preset)}
          >
            {SELECTABLE_BRANDING_PRESETS.map((option) => (
              <option key={option} value={option}>
                {BRANDING_PRESET_LABELS[option]}
              </option>
            ))}
          </select>
          {fieldErrors?.preset ? <span className="error-text small">{fieldErrors.preset}</span> : null}
          <p className="muted small">{BRANDING_PRESET_DESCRIPTIONS[preset]}</p>
        </label>

        <fieldset className="stack-sm" disabled={isPending || !enabled}>
          <legend className="muted small">Branding fields</legend>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={showChurchName}
              onChange={(event) => setShowChurchName(event.target.checked)}
            />
            <span>Show church name</span>
          </label>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={showSermonTitle}
              onChange={(event) => setShowSermonTitle(event.target.checked)}
            />
            <span>Show sermon title</span>
          </label>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={showPreacherName}
              onChange={(event) => setShowPreacherName(event.target.checked)}
            />
            <span>Show preacher name</span>
          </label>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={watermarkEnabled}
              onChange={(event) => setWatermarkEnabled(event.target.checked)}
            />
            <span>Add watermark</span>
          </label>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={lowerThirdEnabled}
              onChange={(event) => setLowerThirdEnabled(event.target.checked)}
            />
            <span>Add lower third</span>
          </label>
        </fieldset>

        <label className="stack-sm">
          Theme color
          <input
            type="text"
            value={themeColor}
            onChange={(event) => setThemeColor(event.target.value)}
            placeholder="#0F766E"
            disabled={isPending || !enabled}
            aria-invalid={Boolean(fieldErrors?.themeColor)}
          />
          {fieldErrors?.themeColor ? <span className="error-text small">{fieldErrors.themeColor}</span> : null}
        </label>

        <div className={enabled ? "stack-sm clip-studio-brand-preview" : "stack-sm clip-studio-brand-preview is-disabled"}>
          <p className="muted small">Branding preview</p>
          <div className="clip-studio-brand-frame" style={previewStyle}>
            {enabled && watermarkEnabled ? (
              <div className="clip-studio-brand-watermark">{churchName ? churchName.slice(0, 2).toUpperCase() : "SC"}</div>
            ) : null}
            {enabled && lowerThirdEnabled ? (
              <div className="clip-studio-brand-lower-third">
                <strong>{showSermonTitle ? sermonTitle || "Sermon title" : "Clip title"}</strong>
                <span>{showPreacherName ? preacherName || "Preacher" : showChurchName ? churchName || "Church" : "Clean clip"}</span>
              </div>
            ) : (
              <div className="clip-studio-brand-clean-label">Clean clip preview</div>
            )}
          </div>
          <p>{previewSummary}</p>
          <p className="muted small">
            Church name: {churchName || "Not available"} · Sermon title: {sermonTitle || "Not available"} ·
            Preacher name: {preacherName || "Not available"}
          </p>
          <p className="muted small">Logo: {logoAvailable ? "Available" : "Missing"}</p>
          {!logoAvailable ? (
            <p className="warning-banner">
              No church logo is available. The clip can still render with text branding.
            </p>
          ) : null}
        </div>

        <div className="actions-row">
          <button type="button" className="button secondary" onClick={saveBranding} disabled={isPending}>
            Save branding settings
          </button>
        </div>

        {statusMessage ? (
          <p className={statusSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
            {statusMessage}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
