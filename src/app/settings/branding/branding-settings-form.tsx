"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  saveBrandingSettingsAction,
  type BrandingSettingsActionState,
} from "@/server/actions/branding";
import { watermarkPositions, type BrandingSettingsRecord } from "@/server/branding/settings";
import { CAPTION_STYLE_PRESETS, resolveCaptionStylePreset } from "@/lib/captionStylePresets";

type BrandingSettingsFormProps = {
  settings: BrandingSettingsRecord;
  helperPayload: unknown;
};

const initialState: BrandingSettingsActionState = {
  success: false,
  message: "",
};

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save Brand Kit"}
    </button>
  );
}

function formatWatermarkPosition(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getFileName(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "No logo selected";
  }

  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "SC";
  }

  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function getColorInputValue(value: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : "#000000";
}

function getPublicLogoUrl(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  if (/^(?:https?:|blob:|data:)/.test(trimmed) || trimmed.startsWith("/uploads/") || trimmed.startsWith("/logo/")) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const publicIndex = normalized.indexOf("/public/");
  if (publicIndex >= 0) {
    return normalized.slice(publicIndex + "/public".length);
  }

  return null;
}

function renderCaptionSample(text: string, emphasisWords: string[]): ReactNode {
  if (emphasisWords.length === 0) {
    return text;
  }

  const emphasis = new Set(emphasisWords.map((word) => word.toLowerCase()));
  return text.split(/(\s+)/).map((part, index) => {
    const normalized = part.replace(/[^\w']/g, "").toLowerCase();
    if (!normalized || !emphasis.has(normalized)) {
      return part;
    }

    return (
      <mark key={`${part}-${index}`} className="caption-emphasis-mark">
        {part}
      </mark>
    );
  });
}

export function BrandingSettingsForm({ settings, helperPayload }: BrandingSettingsFormProps) {
  const [state, action] = useActionState(saveBrandingSettingsAction, initialState);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [churchName, setChurchName] = useState(settings.churchName);
  const [churchLogoPath, setChurchLogoPath] = useState(settings.churchLogoPath ?? "");
  const [selectedLogoName, setSelectedLogoName] = useState("");
  const [selectedLogoPreviewUrl, setSelectedLogoPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [primaryBrandColor, setPrimaryBrandColor] = useState(settings.primaryBrandColor);
  const [secondaryBrandColor, setSecondaryBrandColor] = useState(settings.secondaryBrandColor);
  const [defaultFontFamily, setDefaultFontFamily] = useState(settings.defaultFontFamily);
  const [watermarkPosition, setWatermarkPosition] = useState(settings.watermarkPosition);
  const [defaultCaptionStyleName, setDefaultCaptionStyleName] = useState(settings.defaultCaptionStyleName);
  const captionStyle = useMemo(() => resolveCaptionStylePreset(defaultCaptionStyleName), [defaultCaptionStyleName]);
  const savedLogoPreviewUrl = useMemo(() => getPublicLogoUrl(churchLogoPath), [churchLogoPath]);
  const activeLogoPreviewUrl = removeLogo ? null : selectedLogoPreviewUrl ?? savedLogoPreviewUrl;
  const logoFileName = selectedLogoName || getFileName(churchLogoPath);
  const logoConfigured = !removeLogo && (selectedLogoName.length > 0 || churchLogoPath.trim().length > 0);
  const logoMarkStyle = activeLogoPreviewUrl
    ? ({ backgroundImage: `url("${activeLogoPreviewUrl.replace(/"/g, "%22")}")` } as CSSProperties)
    : undefined;
  const previewStyle = {
    "--brand-primary": primaryBrandColor,
    "--brand-secondary": secondaryBrandColor,
    "--brand-font": defaultFontFamily,
  } as CSSProperties;

  useEffect(() => {
    return () => {
      if (selectedLogoPreviewUrl) {
        URL.revokeObjectURL(selectedLogoPreviewUrl);
      }
    };
  }, [selectedLogoPreviewUrl]);

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) {
      setSelectedLogoName("");
      setSelectedLogoPreviewUrl(null);
      return;
    }

    setRemoveLogo(false);
    setSelectedLogoName(file.name);
    setSelectedLogoPreviewUrl(URL.createObjectURL(file));
  }

  function clearSelectedLogo() {
    setSelectedLogoName("");
    setSelectedLogoPreviewUrl(null);
    setRemoveLogo(true);
    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }
  }

  return (
    <form action={action} className="brand-kit-workspace" encType="multipart/form-data">
      <section className="card brand-kit-controls stack-md">
        <div className="section-heading-row">
          <div>
            <p className="kicker">Identity</p>
            <h2>Brand defaults</h2>
          </div>
          <span className="status-pill">Used for new prepared clips</span>
        </div>

        <div className="stack-sm">
          <label htmlFor="churchName">Church Name</label>
          <input
            id="churchName"
            name="churchName"
            type="text"
            required
            value={churchName}
            onChange={(event) => setChurchName(event.target.value)}
            placeholder="Grace Community Church"
          />
          {state.fieldErrors?.churchName ? <p className="field-error">{state.fieldErrors.churchName}</p> : null}
        </div>

        <div className="brand-asset-field">
          <div className={activeLogoPreviewUrl ? "brand-asset-mark has-logo" : "brand-asset-mark"} style={logoMarkStyle} aria-hidden="true">
            {activeLogoPreviewUrl ? null : logoConfigured ? getInitials(churchName) : "+"}
          </div>
          <div className="stack-sm">
            <label htmlFor="churchLogoFile">Logo or Watermark File</label>
            <div className="brand-logo-upload-row">
              <input
                ref={logoInputRef}
                id="churchLogoFile"
                name="churchLogoFile"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoFileChange}
              />
              {logoConfigured ? (
                <button className="button secondary" type="button" onClick={clearSelectedLogo}>
                  Remove
                </button>
              ) : null}
            </div>
            <input type="hidden" name="removeLogo" value={removeLogo ? "1" : "0"} />
            <span className="muted small">
              {logoConfigured ? logoFileName : "Upload a PNG, JPG, WebP, or SVG. Initials are used when no logo is set."}
            </span>
            {state.fieldErrors?.churchLogoFile ? <p className="field-error">{state.fieldErrors.churchLogoFile}</p> : null}
            <details className="brand-path-details">
              <summary>Use an existing logo path</summary>
              <label className="stack-sm" htmlFor="churchLogoPath">
                Existing Logo Path
                <input
                  id="churchLogoPath"
                  name="churchLogoPath"
                  type="text"
                  value={removeLogo ? "" : churchLogoPath}
                  onChange={(event) => {
                    setRemoveLogo(false);
                    setChurchLogoPath(event.target.value);
                  }}
                  placeholder="/Users/you/branding/church-logo.png"
                />
              </label>
            </details>
            {state.fieldErrors?.churchLogoPath ? <p className="field-error">{state.fieldErrors.churchLogoPath}</p> : null}
          </div>
        </div>

        <div className="brand-color-grid">
          <label className="brand-color-control" htmlFor="primaryBrandColor">
            <span>Main Theme Color</span>
            <span className="brand-color-input-row">
              <input
                className="brand-color-swatch"
                type="color"
                value={getColorInputValue(primaryBrandColor)}
                onChange={(event) => setPrimaryBrandColor(event.target.value.toUpperCase())}
                aria-label="Choose main theme color"
              />
              <input
                id="primaryBrandColor"
                name="primaryBrandColor"
                type="text"
                value={primaryBrandColor}
                onChange={(event) => setPrimaryBrandColor(event.target.value)}
                placeholder="#0F766E"
              />
            </span>
            {state.fieldErrors?.primaryBrandColor ? <p className="field-error">{state.fieldErrors.primaryBrandColor}</p> : null}
          </label>

          <label className="brand-color-control" htmlFor="secondaryBrandColor">
            <span>Accent Color</span>
            <span className="brand-color-input-row">
              <input
                className="brand-color-swatch"
                type="color"
                value={getColorInputValue(secondaryBrandColor)}
                onChange={(event) => setSecondaryBrandColor(event.target.value.toUpperCase())}
                aria-label="Choose accent color"
              />
              <input
                id="secondaryBrandColor"
                name="secondaryBrandColor"
                type="text"
                value={secondaryBrandColor}
                onChange={(event) => setSecondaryBrandColor(event.target.value)}
                placeholder="#1D4ED8"
              />
            </span>
            {state.fieldErrors?.secondaryBrandColor ? <p className="field-error">{state.fieldErrors.secondaryBrandColor}</p> : null}
          </label>
        </div>

        <div className="grid-two">
          <label className="stack-sm" htmlFor="defaultFontFamily">
            Caption Font
            <input
              id="defaultFontFamily"
              name="defaultFontFamily"
              type="text"
              value={defaultFontFamily}
              onChange={(event) => setDefaultFontFamily(event.target.value)}
              placeholder="Avenir Next"
            />
            {state.fieldErrors?.defaultFontFamily ? <p className="field-error">{state.fieldErrors.defaultFontFamily}</p> : null}
          </label>

          <label className="stack-sm" htmlFor="watermarkPosition">
            Logo Placement
            <select
              id="watermarkPosition"
              name="watermarkPosition"
              value={watermarkPosition}
              onChange={(event) => setWatermarkPosition(event.target.value as typeof watermarkPosition)}
            >
              {watermarkPositions.map((position) => (
                <option key={position} value={position}>
                  {formatWatermarkPosition(position)}
                </option>
              ))}
            </select>
            {state.fieldErrors?.watermarkPosition ? <p className="field-error">{state.fieldErrors.watermarkPosition}</p> : null}
          </label>
        </div>

        <section className="brand-caption-style-panel" aria-labelledby="caption-style-heading">
          <div className="section-heading-row compact">
            <div>
              <p className="kicker">Captions</p>
              <h3 id="caption-style-heading">Default Caption Personality</h3>
            </div>
            <span className="status-pill">{captionStyle.motion}</span>
          </div>
          <p className="muted small">
            Choose the default caption mood for prepared clips. Clip Studio can still tune the copy per clip.
          </p>
          <input type="hidden" name="defaultCaptionStyleName" value={defaultCaptionStyleName} />
          <div className="brand-caption-options">
            {CAPTION_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={preset.id === defaultCaptionStyleName ? "brand-caption-option is-active" : "brand-caption-option"}
                onClick={() => setDefaultCaptionStyleName(preset.id)}
              >
                <span className={`brand-caption-option-preview ${preset.className}`}>
                  {renderCaptionSample(preset.sampleText, preset.emphasisWords)}
                </span>
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
                <span className="brand-caption-option-meta">
                  <span>{preset.personality}</span>
                  <span>{preset.bestFor}</span>
                </span>
              </button>
            ))}
          </div>
          {state.fieldErrors?.defaultCaptionStyleName ? <p className="field-error">{state.fieldErrors.defaultCaptionStyleName}</p> : null}
        </section>

        <div className="brand-save-strip">
          <div>
            <p className="muted small">Applied when approved clips are prepared for Ready-to-post.</p>
            <p className="brand-save-title">Saving may mark existing overlays as outdated.</p>
          </div>
          <SaveButton />
        </div>

        {state.message ? (
          <p className={state.success ? "success-banner" : "error-banner"} role="status" aria-live="polite">
            {state.message}
          </p>
        ) : null}
      </section>

      <aside className="card brand-kit-preview-card stack-md" aria-label="Live brand preview">
        <div className="section-heading-row">
          <div>
            <p className="kicker">Live Preview</p>
            <h2>Prepared clip look</h2>
          </div>
          <span className="status-pill">{formatWatermarkPosition(watermarkPosition)}</span>
        </div>

        <div className={`brand-preview-stage watermark-${watermarkPosition.toLowerCase().replace(/_/g, "-")}`} style={previewStyle}>
          <div className="brand-preview-video">
            <div className="brand-preview-subject" aria-hidden="true" />
            <div className="brand-preview-pulpit" aria-hidden="true" />
            <div className="brand-preview-light brand-preview-light-one" aria-hidden="true" />
            <div className="brand-preview-light brand-preview-light-two" aria-hidden="true" />
          </div>
          <div className={activeLogoPreviewUrl ? "brand-preview-watermark has-logo" : "brand-preview-watermark"} style={logoMarkStyle}>
            {activeLogoPreviewUrl ? null : logoConfigured ? getInitials(churchName) : "SC"}
          </div>
          <div className="brand-preview-lower-third">
            <strong>Sunday service</strong>
            <span>{churchName || "Church name"}</span>
          </div>
          <div className={`brand-preview-caption ${captionStyle.className}`}>
            {renderCaptionSample(captionStyle.sampleText, captionStyle.emphasisWords)}
          </div>
        </div>

        <div className="brand-preview-status-grid">
          <div>
            <span>Church</span>
            <strong>{churchName || "Not set"}</strong>
          </div>
          <div>
            <span>Logo</span>
            <strong>{activeLogoPreviewUrl ? "Previewing logo" : logoConfigured ? "Path configured" : "Initials"}</strong>
          </div>
          <div>
            <span>Colors</span>
            <strong>{primaryBrandColor} / {secondaryBrandColor}</strong>
          </div>
          <div>
            <span>Captions</span>
            <strong>{captionStyle.name} · {captionStyle.motion}</strong>
          </div>
        </div>

        <details className="advanced-details brand-advanced-details">
          <summary>Advanced payload</summary>
          <pre className="code-block">{JSON.stringify(helperPayload, null, 2)}</pre>
        </details>
      </aside>
    </form>
  );
}
