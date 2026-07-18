"use client";

import Image from "next/image";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  BRANDING_PRESET_DESCRIPTIONS,
  BRANDING_PRESET_LABELS,
  DEFAULT_INTRO_DURATION_SECONDS,
  DEFAULT_OUTRO_DURATION_SECONDS,
  SELECTABLE_BRANDING_PRESETS,
  buildBrandingSummary,
  type BrandBackgroundStyle,
  type BrandingPreset,
  type ClipBrandingConfig,
} from "@/lib/clipBranding";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioBrandingProps = {
  initialConfig: ClipBrandingConfig;
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  logoAvailable: boolean;
  logoSrc: string | null;
};

export function ClipStudioBranding({
  initialConfig,
  churchName,
  sermonTitle,
  preacherName,
  logoAvailable,
  logoSrc,
}: ClipStudioBrandingProps) {
  const isPending = false;
  const { updateBrandingConfig } = useClipStudioPreview();

  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [preset, setPreset] = useState<BrandingPreset>(initialConfig.preset);
  const [showChurchName, setShowChurchName] = useState(initialConfig.showChurchName);
  const [showSermonTitle, setShowSermonTitle] = useState(initialConfig.showSermonTitle);
  const [showPreacherName, setShowPreacherName] = useState(initialConfig.showPreacherName);
  const [watermarkEnabled, setWatermarkEnabled] = useState(initialConfig.watermarkEnabled);
  const [lowerThirdEnabled, setLowerThirdEnabled] = useState(initialConfig.lowerThirdEnabled);
  const [introEnabled, setIntroEnabled] = useState(initialConfig.introEnabled);
  const [outroEnabled, setOutroEnabled] = useState(initialConfig.outroEnabled);
  const [introDurationSeconds, setIntroDurationSeconds] = useState(
    initialConfig.introDurationSeconds ?? DEFAULT_INTRO_DURATION_SECONDS,
  );
  const [outroDurationSeconds, setOutroDurationSeconds] = useState(
    initialConfig.outroDurationSeconds ?? DEFAULT_OUTRO_DURATION_SECONDS,
  );
  const [backgroundStyle, setBackgroundStyle] = useState<BrandBackgroundStyle>(initialConfig.backgroundStyle);
  const [themeColor, setThemeColor] = useState(initialConfig.themeColor ?? "");

  const previewConfig = useMemo<ClipBrandingConfig>(
    () => ({
      enabled,
      preset,
      showChurchName,
      showSermonTitle,
      showPreacherName,
      watermarkEnabled,
      lowerThirdEnabled,
      introEnabled,
      outroEnabled,
      introDurationSeconds,
      outroDurationSeconds,
      backgroundStyle,
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
      introEnabled,
      introDurationSeconds,
      outroEnabled,
      outroDurationSeconds,
      backgroundStyle,
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

  return (
    <SectionCard
      title="Branding"
      description="Add church identity layers to the current preview."
    >
      <div className="stack-md">
        <div className="clip-studio-effect-note">
          <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "Brand active" : "Brand off"}</StatusBadge>
          <p>Branding choices update immediately. Save Draft keeps them; Prepare renders them into the final video.</p>
        </div>

        <div className="clip-studio-brand-kit-status">
          <div className="clip-studio-brand-kit-mark" aria-hidden="true">
            {logoSrc ? <Image src={logoSrc} alt="" width={48} height={48} unoptimized /> : <span>{(churchName || "Church").slice(0, 2).toUpperCase()}</span>}
          </div>
          <div>
            <strong>{logoAvailable ? "Saved logo ready" : "No saved logo"}</strong>
            <p className="muted small">
              {logoAvailable
                ? "The saved logo is applied automatically and kept clear of captions."
                : "Add a logo in Brand settings; church-name branding still works without one."}
            </p>
          </div>
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
          >
            {SELECTABLE_BRANDING_PRESETS.map((option) => (
              <option key={option} value={option}>
                {BRANDING_PRESET_LABELS[option]}
              </option>
            ))}
          </select>
          <p className="muted small">{BRANDING_PRESET_DESCRIPTIONS[preset]}</p>
        </label>

        <fieldset className="stack-sm clip-studio-brand-fields" disabled={isPending || !enabled}>
          <legend className="muted small">Branding fields</legend>

          <div className="clip-studio-brand-toggle-grid">

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
            <span>Add church name watermark</span>
          </label>

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={lowerThirdEnabled}
              onChange={(event) => setLowerThirdEnabled(event.target.checked)}
            />
            <span>Add lower third</span>
          </label>

          </div>

          <div className="clip-studio-brand-timing-controls">

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={previewConfig.introEnabled}
              onChange={(event) => setIntroEnabled(event.target.checked)}
            />
            <span>Intro</span>
          </label>

          {previewConfig.introEnabled ? (
            <label className="stack-sm">
              Intro duration
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={introDurationSeconds}
                onChange={(event) => setIntroDurationSeconds(Number(event.target.value))}
              />
              <span className="muted small">{introDurationSeconds.toFixed(1)} seconds from the opening</span>
            </label>
          ) : null}

          <label className="review-checkbox-row">
            <input
              type="checkbox"
              checked={previewConfig.outroEnabled}
              onChange={(event) => setOutroEnabled(event.target.checked)}
            />
            <span>Outro</span>
          </label>

          {previewConfig.outroEnabled ? (
            <label className="stack-sm">
              Outro duration
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={outroDurationSeconds}
                onChange={(event) => setOutroDurationSeconds(Number(event.target.value))}
              />
              <span className="muted small">{outroDurationSeconds.toFixed(1)} seconds before the clip ends</span>
            </label>
          ) : null}
          </div>
        </fieldset>

        <label className="stack-sm">
          Background style
          <select
            value={backgroundStyle}
            onChange={(event) => setBackgroundStyle(event.target.value as BrandBackgroundStyle)}
            disabled={isPending || !enabled}
          >
            <option value="NONE">Clean video</option>
            <option value="SOFT_GRADIENT">Soft color wash</option>
            <option value="SOLID_BRAND">Brand color wash</option>
            <option value="BLURRED_TINT">Light color tint</option>
          </select>
        </label>

        <label className="stack-sm">
          Theme color
          <span className="clip-studio-brand-color-row">
            <input
              aria-label="Choose theme color"
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(themeColor) ? themeColor : "#0F766E"}
              onChange={(event) => setThemeColor(event.target.value)}
              disabled={isPending || !enabled}
            />
            <input
              type="text"
              value={themeColor}
              onChange={(event) => setThemeColor(event.target.value)}
              placeholder="#0F766E"
              disabled={isPending || !enabled}
            />
          </span>
        </label>

        <div className={enabled ? "stack-sm clip-studio-brand-preview" : "stack-sm clip-studio-brand-preview is-disabled"}>
          <p className="muted small">Branding preview</p>
          <div className={`clip-studio-brand-frame background-${backgroundStyle.toLowerCase().replace(/_/g, "-")}`} style={previewStyle}>
            {enabled && previewConfig.introEnabled ? <div className="clip-studio-brand-intro">Opening · {introDurationSeconds.toFixed(1)}s</div> : null}
            {enabled && logoSrc && (watermarkEnabled || preset === "MINIMAL_WATERMARK") ? (
              <div className="clip-studio-brand-watermark has-logo">
                <Image src={logoSrc} alt={`${churchName || "Church"} logo`} width={80} height={80} unoptimized />
              </div>
            ) : enabled && watermarkEnabled ? (
              <div className="clip-studio-brand-watermark">{(churchName || "Church").slice(0, 2).toUpperCase()}</div>
            ) : null}
            {enabled && lowerThirdEnabled && preset !== "MINIMAL_WATERMARK" && preset !== "NO_BRANDING" ? (
              <div className="clip-studio-brand-lower-third">
                <strong>{showSermonTitle ? sermonTitle || "Sermon title" : "Clip title"}</strong>
                <span>{showPreacherName ? preacherName || "Preacher" : showChurchName ? churchName || "Church" : "Clean clip"}</span>
              </div>
            ) : (
              <div className="clip-studio-brand-clean-label">Clean clip preview</div>
            )}
            {enabled && previewConfig.outroEnabled ? <div className="clip-studio-brand-outro">Closing · {outroDurationSeconds.toFixed(1)}s</div> : null}
          </div>
          <p>{previewSummary}</p>
          <p className="muted small">
            Church name: {churchName || "Not available"} · Sermon title: {sermonTitle || "Not available"} ·
            Preacher name: {preacherName || "Not available"}
          </p>
          <p className="muted small">Brand logo: {logoAvailable ? "Applied automatically" : "Church-name fallback"} · captions keep their own safe area</p>
        </div>
      </div>
    </SectionCard>
  );
}
