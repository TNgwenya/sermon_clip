export type CaptionStylePresetId =
  | "bold-sermon"
  | "kinetic-pop"
  | "creator-highlight"
  | "soft-bubble"
  | "clean-lower"
  | "high-contrast"
  | "youth-social"
  | "minimal-church"
  | "scripture-focus"
  | "cinematic-testimony"
  | "golden-hour"
  | "royal-focus"
  | "editorial-serif"
  | "clean-outline";

export type CaptionHexColor = `#${string}`;
export type CaptionFontFamilyId =
  | "bold-condensed"
  | "modern-sans"
  | "elegant-serif"
  | "clean-geometric"
  | "friendly-rounded"
  | "cinematic"
  | "traditional-preaching"
  | "youthful-social";
export type CaptionTextCase = "sentence" | "uppercase" | "lowercase";
export type CaptionTextAlignment = "left" | "center" | "right";
export type CaptionBackgroundTreatment = "none" | "solid" | "rounded" | "soft-panel";
export type CaptionHighlightIntensity = "subtle" | "balanced" | "energetic" | "maximum";
export type CaptionVerticalPosition = "top" | "middle" | "lower";
export type CaptionHorizontalPosition = "left" | "center" | "right";
export type CaptionSafeWidth = "narrow" | "standard" | "wide";

export const CAPTION_DESIGN_VERSION = 1 as const;

export type CaptionTypographySettings = {
  fontFamilyId: CaptionFontFamilyId;
  fontSizePx: number;
  fontWeight: number;
  italic: boolean;
  textCase: CaptionTextCase;
  letterSpacingPx: number;
  lineHeight: number;
  wordSpacingPx: number;
  alignment: CaptionTextAlignment;
};

export type CaptionColorSettings = {
  textColor: CaptionHexColor;
  activeTextColor: CaptionHexColor;
  highlightBackgroundColor: CaptionHexColor;
};

export type CaptionBackgroundSettings = {
  treatment: CaptionBackgroundTreatment;
  color: CaptionHexColor;
  opacity: number;
  borderColor: CaptionHexColor;
  borderOpacity: number;
  borderWidthPx: number;
  borderRadiusPx: number;
  paddingX: number;
  paddingY: number;
};

export type CaptionReadabilitySettings = {
  outlineColor: CaptionHexColor;
  outlineWidthPx: number;
  shadowColor: CaptionHexColor;
  shadowOpacity: number;
  shadowBlurPx: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

export type CaptionHighlightSettings = {
  intensity: CaptionHighlightIntensity;
  scale: number;
  backgroundOpacity: number;
  fontWeightBoost: number;
  reducedMotion: boolean;
};

export type CaptionLayoutSettings = {
  verticalPosition: CaptionVerticalPosition;
  horizontalPosition: CaptionHorizontalPosition;
  horizontalOffset: number;
  verticalOffset: number;
  safeWidth: CaptionSafeWidth;
  maxLines: 2 | 3 | 4;
};

/**
 * Canonical caption design contract shared by Studio preview and final export.
 *
 * Persist this object at `captionData.captionDesign`. The version makes future
 * migrations explicit while preset defaults keep older captionData renderable.
 */
export type CaptionDesignSettingsV1 = {
  version: typeof CAPTION_DESIGN_VERSION;
  presetId: CaptionStylePresetId;
  typography: CaptionTypographySettings;
  colors: CaptionColorSettings;
  background: CaptionBackgroundSettings;
  readability: CaptionReadabilitySettings;
  highlighting: CaptionHighlightSettings;
  layout: CaptionLayoutSettings;
};

export type CaptionFontFamilyDefinition = {
  id: CaptionFontFamilyId;
  label: string;
  category: string;
  cssStack: string;
  renderFamily: string;
  /** Deterministic Latin/extended-Latin fallback for Southern African names. */
  glyphSafeFallback: "DejaVu Sans" | "DejaVu Serif";
};

/**
 * Deliberately small font library. Every entry has a conservative render
 * fallback so a saved design remains legible when a preferred font is absent.
 */
export const CAPTION_FONT_LIBRARY: CaptionFontFamilyDefinition[] = [
  {
    id: "bold-condensed",
    label: "Bold condensed",
    category: "High impact",
    cssStack: '"DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif',
    renderFamily: "DejaVu Sans Condensed",
    glyphSafeFallback: "DejaVu Sans",
  },
  {
    id: "modern-sans",
    label: "Modern sans",
    category: "Versatile",
    cssStack: '"DejaVu Sans", Arial, Helvetica, sans-serif',
    renderFamily: "DejaVu Sans",
    glyphSafeFallback: "DejaVu Sans",
  },
  {
    id: "elegant-serif",
    label: "Elegant serif",
    category: "Devotional",
    cssStack: '"DejaVu Serif", Georgia, "Times New Roman", serif',
    renderFamily: "DejaVu Serif",
    glyphSafeFallback: "DejaVu Serif",
  },
  {
    id: "clean-geometric",
    label: "Clean geometric",
    category: "Teaching",
    cssStack: '"Liberation Sans", "DejaVu Sans", Arial, sans-serif',
    renderFamily: "Liberation Sans",
    glyphSafeFallback: "DejaVu Sans",
  },
  {
    id: "friendly-rounded",
    label: "Friendly rounded",
    category: "Warm",
    cssStack: '"DejaVu Sans", "Arial Rounded MT Bold", Arial, sans-serif',
    renderFamily: "DejaVu Sans",
    glyphSafeFallback: "DejaVu Sans",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    category: "Refined",
    cssStack: '"Liberation Sans", "DejaVu Sans", Arial, sans-serif',
    renderFamily: "Liberation Sans",
    glyphSafeFallback: "DejaVu Sans",
  },
  {
    id: "traditional-preaching",
    label: "Traditional preaching",
    category: "Classic",
    cssStack: '"DejaVu Serif", Georgia, "Times New Roman", serif',
    renderFamily: "DejaVu Serif",
    glyphSafeFallback: "DejaVu Serif",
  },
  {
    id: "youthful-social",
    label: "Youthful social",
    category: "Energetic",
    cssStack: '"DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif',
    renderFamily: "DejaVu Sans Condensed",
    glyphSafeFallback: "DejaVu Sans",
  },
];

export type CaptionVisualStyle = {
  fontFamily: "sans" | "serif";
  fontWeight: 700 | 800 | 900;
  textColor: CaptionHexColor;
  activeTextColor: CaptionHexColor;
  backgroundColor: CaptionHexColor;
  backgroundOpacity: number;
  borderColor: CaptionHexColor;
  borderOpacity: number;
  borderWidth: number;
  borderRadius: number;
  textStrokeColor: CaptionHexColor;
  textStrokeWidth: number;
  uppercase: boolean;
};

export type CaptionStylePreset = {
  id: CaptionStylePresetId;
  name: string;
  description: string;
  personality: string;
  /** Honest description of motion currently supported by the export renderer. */
  motion: string;
  bestFor: string;
  sampleText: string;
  emphasisWords: string[];
  className: string;
  /** Legacy visual tokens retained for existing Studio CSS. */
  visual: CaptionVisualStyle;
  /** Canonical complete design tokens used by new Studio and final export. */
  design: CaptionDesignSettingsV1;
};

type CaptionPresetDesignOverrides = {
  fontFamilyId?: CaptionFontFamilyId;
  fontSizePx?: number;
  lineHeight?: number;
  letterSpacingPx?: number;
  wordSpacingPx?: number;
  alignment?: CaptionTextAlignment;
  backgroundTreatment?: CaptionBackgroundTreatment;
  paddingX?: number;
  paddingY?: number;
  shadowOpacity?: number;
  shadowBlurPx?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  highlightIntensity?: CaptionHighlightIntensity;
  highlightScale?: number;
  highlightBackgroundOpacity?: number;
  fontWeightBoost?: number;
  verticalPosition?: CaptionVerticalPosition;
  safeWidth?: CaptionSafeWidth;
  maxLines?: 2 | 3 | 4;
};

type CaptionPresetDefinition = Omit<CaptionStylePreset, "design"> & {
  design?: CaptionPresetDesignOverrides;
};

const HIGHLIGHT_DEFAULTS: Record<
  CaptionHighlightIntensity,
  Pick<CaptionHighlightSettings, "scale" | "backgroundOpacity" | "fontWeightBoost">
> = {
  subtle: { scale: 1.02, backgroundOpacity: 0, fontWeightBoost: 0 },
  balanced: { scale: 1.04, backgroundOpacity: 0.08, fontWeightBoost: 0 },
  energetic: { scale: 1.08, backgroundOpacity: 0.16, fontWeightBoost: 100 },
  maximum: { scale: 1.12, backgroundOpacity: 0.24, fontWeightBoost: 100 },
};

function createCaptionStylePreset(definition: CaptionPresetDefinition): CaptionStylePreset {
  const visual = definition.visual;
  const override = definition.design ?? {};
  const intensity = override.highlightIntensity ?? "balanced";
  const highlightDefaults = HIGHLIGHT_DEFAULTS[intensity];

  return {
    ...definition,
    design: {
      version: CAPTION_DESIGN_VERSION,
      presetId: definition.id,
      typography: {
        fontFamilyId:
          override.fontFamilyId ?? (visual.fontFamily === "serif" ? "elegant-serif" : "modern-sans"),
        fontSizePx: override.fontSizePx ?? 36,
        fontWeight: visual.fontWeight,
        italic: false,
        textCase: visual.uppercase ? "uppercase" : "sentence",
        letterSpacingPx: override.letterSpacingPx ?? 0.3,
        lineHeight: override.lineHeight ?? 1.22,
        wordSpacingPx: override.wordSpacingPx ?? 2.8,
        alignment: override.alignment ?? "center",
      },
      colors: {
        textColor: visual.textColor,
        activeTextColor: visual.activeTextColor,
        highlightBackgroundColor: visual.activeTextColor,
      },
      background: {
        treatment:
          override.backgroundTreatment
          ?? (visual.backgroundOpacity <= 0 ? "none" : visual.borderRadius > 0 ? "rounded" : "solid"),
        color: visual.backgroundColor,
        opacity: visual.backgroundOpacity,
        borderColor: visual.borderColor,
        borderOpacity: visual.borderOpacity,
        borderWidthPx: visual.borderWidth,
        borderRadiusPx: visual.borderRadius,
        paddingX: override.paddingX ?? 34,
        paddingY: override.paddingY ?? 24,
      },
      readability: {
        outlineColor: visual.textStrokeColor,
        outlineWidthPx: visual.textStrokeWidth,
        shadowColor: "#000000",
        shadowOpacity: override.shadowOpacity ?? 0.28,
        shadowBlurPx: override.shadowBlurPx ?? 12,
        shadowOffsetX: override.shadowOffsetX ?? 0,
        shadowOffsetY: override.shadowOffsetY ?? 5,
      },
      highlighting: {
        intensity,
        scale: override.highlightScale ?? highlightDefaults.scale,
        backgroundOpacity:
          override.highlightBackgroundOpacity ?? highlightDefaults.backgroundOpacity,
        fontWeightBoost: override.fontWeightBoost ?? highlightDefaults.fontWeightBoost,
        reducedMotion: false,
      },
      layout: {
        verticalPosition: override.verticalPosition ?? "lower",
        horizontalPosition: "center",
        horizontalOffset: 0,
        verticalOffset: 0,
        safeWidth: override.safeWidth ?? "standard",
        maxLines: override.maxLines ?? 3,
      },
    },
  };
}

export const DEFAULT_CAPTION_STYLE_PRESET_ID: CaptionStylePresetId = "clean-lower";

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  createCaptionStylePreset({
    id: "bold-sermon",
    name: "Modern Bold",
    description: "Large, confident sermon captions with clear active-word emphasis.",
    personality: "Confident and premium",
    motion: "Active-word colour and scale",
    bestFor: "Declarations, Reels, Shorts",
    sampleText: "God is not finished with you.",
    emphasisWords: ["God", "finished"],
    className: "caption-style-bold-sermon",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FACC15",
      backgroundColor: "#030712", backgroundOpacity: 0.82, borderColor: "#FACC15", borderOpacity: 0.34,
      borderWidth: 2, borderRadius: 24, textStrokeColor: "#000000", textStrokeWidth: 5, uppercase: true,
    },
    design: {
      fontFamilyId: "bold-condensed",
      fontSizePx: 42,
      highlightIntensity: "energetic",
      safeWidth: "wide",
      maxLines: 2,
    },
  }),
  createCaptionStylePreset({
    id: "kinetic-pop",
    name: "High-Energy Social",
    description: "Punchy outlined captions designed for the supported one-word pop reveal.",
    personality: "Fast and punchy",
    motion: "One-word fade and scale when selected",
    bestFor: "Hooks, punchlines, youth clips",
    sampleText: "This is your reminder.",
    emphasisWords: ["reminder"],
    className: "caption-style-kinetic-pop",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FACC15",
      backgroundColor: "#020617", backgroundOpacity: 0.7, borderColor: "#FFFFFF", borderOpacity: 0,
      borderWidth: 0, borderRadius: 18, textStrokeColor: "#020617", textStrokeWidth: 8, uppercase: true,
    },
    design: {
      fontFamilyId: "youthful-social",
      fontSizePx: 44,
      backgroundTreatment: "soft-panel",
      highlightIntensity: "maximum",
      safeWidth: "wide",
      maxLines: 2,
    },
  }),
  createCaptionStylePreset({
    id: "creator-highlight",
    name: "Premium Sermon",
    description: "Polished glass-panel captions with controlled active-word focus.",
    personality: "Beautiful and modern",
    motion: "Active-word colour and scale",
    bestFor: "Teaching clips, premium social",
    sampleText: "Grace changes everything.",
    emphasisWords: ["Grace"],
    className: "caption-style-creator-highlight",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#67E8F9",
      backgroundColor: "#020617", backgroundOpacity: 0.76, borderColor: "#7DD3FC", borderOpacity: 0.4,
      borderWidth: 2, borderRadius: 26, textStrokeColor: "#020617", textStrokeWidth: 5, uppercase: false,
    },
    design: {
      fontFamilyId: "clean-geometric",
      fontSizePx: 38,
      backgroundTreatment: "soft-panel",
      highlightIntensity: "balanced",
    },
  }),
  createCaptionStylePreset({
    id: "soft-bubble",
    name: "Podcast Style",
    description: "Friendly rounded captions with calm, high-contrast readability.",
    personality: "Warm and readable",
    motion: "Active-word colour",
    bestFor: "Conversation, testimony, pastoral care",
    sampleText: "You are not alone today.",
    emphasisWords: ["alone"],
    className: "caption-style-soft-bubble",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#111827", activeTextColor: "#4D7C0F",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.92, borderColor: "#FFFFFF", borderOpacity: 0.78,
      borderWidth: 2, borderRadius: 56, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
    design: {
      fontFamilyId: "friendly-rounded",
      fontSizePx: 35,
      highlightIntensity: "subtle",
      shadowOpacity: 0.2,
    },
  }),
  createCaptionStylePreset({
    id: "clean-lower",
    name: "Clean Minimal",
    description: "A restrained lower caption with a soft panel and brand-ready accent.",
    personality: "Elegant and pastoral",
    motion: "Active-word colour",
    bestFor: "Sermon recaps, Facebook, general use",
    sampleText: "Grace meets you in the middle.",
    emphasisWords: ["Grace"],
    className: "caption-style-clean-lower",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#0F172A", activeTextColor: "#0F766E",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.94, borderColor: "#0F766E", borderOpacity: 0.46,
      borderWidth: 2, borderRadius: 20, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
    design: {
      fontFamilyId: "modern-sans",
      fontSizePx: 34,
      highlightIntensity: "subtle",
      maxLines: 3,
    },
  }),
  createCaptionStylePreset({
    id: "high-contrast",
    name: "Breaking Statement",
    description: "Large, direct captions that remain readable against difficult stage lighting.",
    personality: "Readable anywhere",
    motion: "Phrase switch or active-word colour",
    bestFor: "Strong declarations, bright stages",
    sampleText: "Hold on to the promise.",
    emphasisWords: ["promise"],
    className: "caption-style-high-contrast",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FACC15", activeTextColor: "#FFFFFF",
      backgroundColor: "#000000", backgroundOpacity: 0.94, borderColor: "#FFFFFF", borderOpacity: 1,
      borderWidth: 3, borderRadius: 12, textStrokeColor: "#000000", textStrokeWidth: 4, uppercase: false,
    },
    design: {
      fontFamilyId: "bold-condensed",
      fontSizePx: 42,
      highlightIntensity: "energetic",
      safeWidth: "wide",
      maxLines: 2,
    },
  }),
  createCaptionStylePreset({
    id: "youth-social",
    name: "Youth Ministry",
    description: "Bright social captions with strong but controlled active-word emphasis.",
    personality: "Fast and energetic",
    motion: "Active-word colour and scale",
    bestFor: "Youth clips, announcements",
    sampleText: "Faith moves before fear does.",
    emphasisWords: ["Faith", "fear"],
    className: "caption-style-youth-social",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FDE047",
      backgroundColor: "#1D4ED8", backgroundOpacity: 0.94, borderColor: "#93C5FD", borderOpacity: 0.9,
      borderWidth: 3, borderRadius: 20, textStrokeColor: "#172554", textStrokeWidth: 4, uppercase: true,
    },
    design: {
      fontFamilyId: "youthful-social",
      fontSizePx: 40,
      highlightIntensity: "energetic",
      safeWidth: "wide",
      maxLines: 2,
    },
  }),
  createCaptionStylePreset({
    id: "minimal-church",
    name: "Worship Moment",
    description: "Quiet, reverent captions that keep attention on the worship moment.",
    personality: "Quiet reverence",
    motion: "Simple phrase switch",
    bestFor: "Worship, prayer, devotionals",
    sampleText: "Be still and trust Him.",
    emphasisWords: ["trust"],
    className: "caption-style-minimal-church",
    visual: {
      fontFamily: "sans", fontWeight: 700, textColor: "#111827", activeTextColor: "#0F766E",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.86, borderColor: "#FFFFFF", borderOpacity: 0,
      borderWidth: 0, borderRadius: 14, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
    design: {
      fontFamilyId: "modern-sans",
      fontSizePx: 31,
      highlightIntensity: "subtle",
      backgroundTreatment: "soft-panel",
      shadowOpacity: 0.14,
      safeWidth: "narrow",
    },
  }),
  createCaptionStylePreset({
    id: "scripture-focus",
    name: "Teaching & Bible Study",
    description: "Readable serif captions for Scripture explanation and careful teaching.",
    personality: "Elegant teaching",
    motion: "Simple phrase or active-word reveal",
    bestFor: "Bible teaching, quote clips",
    sampleText: "The word of God stands forever.",
    emphasisWords: ["word", "God"],
    className: "caption-style-scripture-focus",
    visual: {
      fontFamily: "serif", fontWeight: 800, textColor: "#111827", activeTextColor: "#A16207",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.94, borderColor: "#FACC15", borderOpacity: 0.76,
      borderWidth: 2, borderRadius: 16, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
    design: {
      fontFamilyId: "traditional-preaching",
      fontSizePx: 34,
      lineHeight: 1.28,
      highlightIntensity: "subtle",
    },
  }),
  createCaptionStylePreset({
    id: "cinematic-testimony",
    name: "Cinematic",
    description: "Refined documentary captions with restrained emphasis and generous spacing.",
    personality: "Human and intimate",
    motion: "Simple phrase switch",
    bestFor: "Testimonies, salvation moments",
    sampleText: "I was lost, but Jesus found me.",
    emphasisWords: ["Jesus", "found"],
    className: "caption-style-cinematic-testimony",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#F8FAFC", activeTextColor: "#FDE68A",
      backgroundColor: "#030712", backgroundOpacity: 0.88, borderColor: "#E2E8F0", borderOpacity: 0.24,
      borderWidth: 2, borderRadius: 20, textStrokeColor: "#000000", textStrokeWidth: 4, uppercase: false,
    },
    design: {
      fontFamilyId: "cinematic",
      fontSizePx: 33,
      letterSpacingPx: 1.1,
      lineHeight: 1.3,
      highlightIntensity: "subtle",
      shadowOpacity: 0.34,
      safeWidth: "narrow",
    },
  }),
  createCaptionStylePreset({
    id: "golden-hour",
    name: "Golden Hour",
    description: "Warm, luminous captions with clear active-word colour.",
    personality: "Warm and uplifting",
    motion: "Active-word colour and scale",
    bestFor: "Hope, invitation, encouragement",
    sampleText: "There is still hope for tomorrow.",
    emphasisWords: ["hope", "tomorrow"],
    className: "caption-style-golden-hour",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFBEB", activeTextColor: "#FCD34D",
      backgroundColor: "#1C1408", backgroundOpacity: 0.86, borderColor: "#F59E0B", borderOpacity: 0.56,
      borderWidth: 2, borderRadius: 28, textStrokeColor: "#120C03", textStrokeWidth: 5, uppercase: false,
    },
    design: {
      fontFamilyId: "modern-sans",
      fontSizePx: 39,
      highlightIntensity: "balanced",
      safeWidth: "wide",
    },
  }),
  createCaptionStylePreset({
    id: "royal-focus",
    name: "Royal Focus",
    description: "A rich violet treatment with a polished active-word accent.",
    personality: "Bold and refined",
    motion: "Active-word colour and scale",
    bestFor: "Leadership, identity, declarations",
    sampleText: "You were called for this moment.",
    emphasisWords: ["called", "moment"],
    className: "caption-style-royal-focus",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#F5F3FF", activeTextColor: "#C4B5FD",
      backgroundColor: "#1E1338", backgroundOpacity: 0.88, borderColor: "#A78BFA", borderOpacity: 0.58,
      borderWidth: 2, borderRadius: 24, textStrokeColor: "#0F0820", textStrokeWidth: 5, uppercase: false,
    },
    design: {
      fontFamilyId: "clean-geometric",
      fontSizePx: 39,
      highlightIntensity: "balanced",
      safeWidth: "wide",
    },
  }),
  createCaptionStylePreset({
    id: "editorial-serif",
    name: "Editorial Serif",
    description: "A quiet serif card inspired by devotional print design.",
    personality: "Thoughtful and timeless",
    motion: "Simple phrase or active-word reveal",
    bestFor: "Devotionals, Scripture, reflection",
    sampleText: "Let truth steady your heart.",
    emphasisWords: ["truth", "heart"],
    className: "caption-style-editorial-serif",
    visual: {
      fontFamily: "serif", fontWeight: 800, textColor: "#241C12", activeTextColor: "#9A6A1F",
      backgroundColor: "#FFF8E7", backgroundOpacity: 0.94, borderColor: "#D6C59F", borderOpacity: 0.88,
      borderWidth: 2, borderRadius: 12, textStrokeColor: "#FFF8E7", textStrokeWidth: 0, uppercase: false,
    },
    design: {
      fontFamilyId: "elegant-serif",
      fontSizePx: 34,
      lineHeight: 1.3,
      highlightIntensity: "subtle",
      safeWidth: "narrow",
    },
  }),
  createCaptionStylePreset({
    id: "clean-outline",
    name: "Clean Outline",
    description: "Airy outlined captions for bright stages and fast teaching.",
    personality: "Modern and clear",
    motion: "Active-word colour and scale",
    bestFor: "Fast teaching, bright stages",
    sampleText: "Keep moving with purpose.",
    emphasisWords: ["moving", "purpose"],
    className: "caption-style-clean-outline",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#67E8F9",
      backgroundColor: "#020617", backgroundOpacity: 0.6, borderColor: "#FFFFFF", borderOpacity: 0.46,
      borderWidth: 2, borderRadius: 18, textStrokeColor: "#020617", textStrokeWidth: 7, uppercase: false,
    },
    design: {
      fontFamilyId: "clean-geometric",
      fontSizePx: 39,
      backgroundTreatment: "soft-panel",
      highlightIntensity: "balanced",
      safeWidth: "wide",
    },
  }),
];

export function isCaptionStylePresetId(value: unknown): value is CaptionStylePresetId {
  return typeof value === "string" && CAPTION_STYLE_PRESETS.some((preset) => preset.id === value);
}

export function resolveCaptionStylePreset(id: string | null | undefined): CaptionStylePreset {
  return (
    CAPTION_STYLE_PRESETS.find((preset) => preset.id === id) ??
    CAPTION_STYLE_PRESETS.find((preset) => preset.id === DEFAULT_CAPTION_STYLE_PRESET_ID) ??
    CAPTION_STYLE_PRESETS[0]
  );
}

export function resolveCaptionFontFamily(id: CaptionFontFamilyId): CaptionFontFamilyDefinition {
  return (
    CAPTION_FONT_LIBRARY.find((font) => font.id === id)
    ?? CAPTION_FONT_LIBRARY.find((font) => font.id === "modern-sans")
    ?? CAPTION_FONT_LIBRARY[0]
  );
}

export function resolveCaptionSafeWidthPercent(value: CaptionSafeWidth): number {
  if (value === "narrow") return 64;
  if (value === "wide") return 90;
  return 78;
}

export function resolveCaptionHighlightDefaults(
  value: CaptionHighlightIntensity,
): Pick<CaptionHighlightSettings, "scale" | "backgroundOpacity" | "fontWeightBoost"> {
  return HIGHLIGHT_DEFAULTS[value];
}

export type CaptionContrastAssessment = {
  primaryTextRatio: number;
  activeTextRatio: number;
  minimumRatio: number;
  requiredRatio: 3 | 4.5;
  passes: boolean;
  warning: string | null;
};

type RgbColor = { red: number; green: number; blue: number };

function captionHexToRgb(value: CaptionHexColor): RgbColor {
  const normalized = value.slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function compositeCaptionColor(
  foreground: RgbColor,
  opacity: number,
  background: RgbColor,
): RgbColor {
  const alpha = Math.max(0, Math.min(1, opacity));
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
  };
}

function captionRelativeLuminance(color: RgbColor): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel(color.red)
    + 0.7152 * channel(color.green)
    + 0.0722 * channel(color.blue)
  );
}

function captionContrastRatio(first: RgbColor, second: RgbColor): number {
  const firstLuminance = captionRelativeLuminance(first);
  const secondLuminance = captionRelativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Conservative WCAG-style check over dark, light and mid-tone video samples.
 * Transparent panels are composited over every sample and the lower ratio
 * wins. Pixel-aware checks can later supplement this deterministic no-API
 * baseline.
 */
export function assessCaptionDesignContrast(
  design: CaptionDesignSettingsV1,
): CaptionContrastAssessment {
  const text = captionHexToRgb(design.colors.textColor);
  const activeText = captionHexToRgb(design.colors.activeTextColor);
  const panel = captionHexToRgb(design.background.color);
  const highlight = captionHexToRgb(design.colors.highlightBackgroundColor);
  const panelOpacity = design.background.treatment === "none"
    ? 0
    : design.background.opacity;
  const frameSamples: RgbColor[] = [
    ...Array.from({ length: 17 }, (_, index) => {
      const channel = Math.round(index * 255 / 16);
      return { red: channel, green: channel, blue: channel };
    }),
    // A no-panel caption must not pass merely because black and white happen
    // to contrast with it; real video can contain the exact text colour.
    text,
    activeText,
  ];
  const effectivePanels = frameSamples.map((frame) => (
    compositeCaptionColor(panel, panelOpacity, frame)
  ));
  const primaryTextRatio = Math.min(
    ...effectivePanels.map((background) => captionContrastRatio(text, background)),
  );
  const activeTextRatio = Math.min(
    ...effectivePanels.map((background) => {
      const activeBackground = compositeCaptionColor(
        highlight,
        design.highlighting.backgroundOpacity,
        background,
      );
      return captionContrastRatio(activeText, activeBackground);
    }),
  );
  const minimumRatio = Math.min(primaryTextRatio, activeTextRatio);
  const isLargeText =
    design.typography.fontSizePx >= 24
    || (design.typography.fontSizePx >= 19 && design.typography.fontWeight >= 700);
  const requiredRatio: 3 | 4.5 = isLargeText ? 3 : 4.5;
  const roundedPrimary = Number(primaryTextRatio.toFixed(2));
  const roundedActive = Number(activeTextRatio.toFixed(2));
  const roundedMinimum = Number(minimumRatio.toFixed(2));
  const passes = roundedMinimum >= requiredRatio;

  return {
    primaryTextRatio: roundedPrimary,
    activeTextRatio: roundedActive,
    minimumRatio: roundedMinimum,
    requiredRatio,
    passes,
    warning: passes
      ? null
      : `Caption contrast is ${roundedMinimum.toFixed(2)}:1; use at least ${requiredRatio}:1 for this text size.`,
  };
}
