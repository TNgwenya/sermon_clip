import {
  getContentGraphicTemplate,
  getDefaultTemplateId,
  type ContentGraphicTemplateId,
} from "@/lib/contentGraphicTemplates";

export const CONTENT_ARTWORK_BACKGROUNDS = [
  {
    id: "brand-gradient",
    label: "Church gradient",
    description: "A clean gradient built from the church brand colours.",
    kind: "PROCEDURAL",
    category: "BRAND",
    imagePath: null,
    previewColors: ["#17324d", "#d79c42"],
  },
  {
    id: "soft-glow",
    label: "Soft glow",
    description: "A gentle field of light for hopeful, reflective messages.",
    kind: "PROCEDURAL",
    category: "LIGHT",
    imagePath: null,
    previewColors: ["#243b55", "#d8b46a"],
  },
  {
    id: "paper-wash",
    label: "Paper wash",
    description: "Subtle editorial paper grain with generous visual space.",
    kind: "PROCEDURAL",
    category: "TEXTURE",
    imagePath: null,
    previewColors: ["#292725", "#a99070"],
  },
  {
    id: "radiant-rays",
    label: "Radiant rays",
    description: "Strong directional light for invitations and bold declarations.",
    kind: "PROCEDURAL",
    category: "LIGHT",
    imagePath: null,
    previewColors: ["#231942", "#f59e0b"],
  },
  {
    id: "woven-depth",
    label: "Woven depth",
    description: "A grounded woven texture for teaching and testimony.",
    kind: "PROCEDURAL",
    category: "TEXTURE",
    imagePath: null,
    previewColors: ["#1f2937", "#6b5845"],
  },
  {
    id: "midnight-depth",
    label: "Midnight depth",
    description: "A dark, restrained field with a focused pool of colour.",
    kind: "PROCEDURAL",
    category: "BRAND",
    imagePath: null,
    previewColors: ["#080f1e", "#334e68"],
  },
  {
    id: "still-waters",
    label: "Still waters",
    description: "Quiet water and open space for peace, prayer, and Scripture.",
    kind: "IMAGE",
    category: "NATURE",
    imagePath: "/artwork-backgrounds/still-waters.jpg",
    previewColors: ["#597d86", "#d9c9a5"],
  },
  {
    id: "mountain-dawn",
    label: "Mountain dawn",
    description: "A hopeful horizon suited to courage and new beginnings.",
    kind: "IMAGE",
    category: "NATURE",
    imagePath: "/artwork-backgrounds/mountain-dawn.jpg",
    previewColors: ["#3f5267", "#e7aa68"],
  },
  {
    id: "sanctuary-light",
    label: "Sanctuary light",
    description: "Architectural light with a reverent, worshipful atmosphere.",
    kind: "IMAGE",
    category: "ARCHITECTURE",
    imagePath: "/artwork-backgrounds/sanctuary-light.jpg",
    previewColors: ["#292623", "#d4b27b"],
  },
  {
    id: "desert-path",
    label: "Desert path",
    description: "A warm journey scene for perseverance and faithful next steps.",
    kind: "IMAGE",
    category: "NATURE",
    imagePath: "/artwork-backgrounds/desert-path.jpg",
    previewColors: ["#785f49", "#d9b77d"],
  },
  {
    id: "soft-clouds",
    label: "Soft clouds",
    description: "Open, peaceful light for encouragement and devotional content.",
    kind: "IMAGE",
    category: "LIGHT",
    imagePath: "/artwork-backgrounds/soft-clouds.jpg",
    previewColors: ["#7d96aa", "#e8ddd2"],
  },
  {
    id: "urban-light",
    label: "Urban light",
    description: "Modern city atmosphere for youth, outreach, and invitations.",
    kind: "IMAGE",
    category: "URBAN",
    imagePath: "/artwork-backgrounds/urban-light.jpg",
    previewColors: ["#252b3b", "#d16b55"],
  },
] as const;

export type ContentArtworkBackground = (typeof CONTENT_ARTWORK_BACKGROUNDS)[number];
export type ContentArtworkBackgroundId = ContentArtworkBackground["id"];
export type ContentArtworkBackgroundKind = ContentArtworkBackground["kind"];

export const CONTENT_ARTWORK_PALETTES = [
  { id: "brand", label: "Church brand", description: "Uses the current church brand colours.", colors: ["#17324d", "#d79c42", "#ffffff"], usesBrandColors: true },
  { id: "midnight", label: "Midnight", description: "Deep navy with a clear blue accent.", colors: ["#071525", "#163b5c", "#7dd3fc"], usesBrandColors: false },
  { id: "sunrise", label: "Sunrise", description: "Warm aubergine, coral, and gold.", colors: ["#321b36", "#b74f50", "#f4c56a"], usesBrandColors: false },
  { id: "ocean", label: "Ocean", description: "Deep teal with fresh sea-glass light.", colors: ["#082f35", "#176b78", "#8bd3c7"], usesBrandColors: false },
  { id: "earth", label: "Earth", description: "Natural charcoal, clay, and sand.", colors: ["#292621", "#765742", "#d6bd8d"], usesBrandColors: false },
  { id: "monochrome", label: "Monochrome", description: "Timeless black, slate, and white.", colors: ["#090a0c", "#39404a", "#f5f5f4"], usesBrandColors: false },
] as const;

export type ContentArtworkPalette = (typeof CONTENT_ARTWORK_PALETTES)[number];
export type ContentArtworkPaletteId = ContentArtworkPalette["id"];

export const CONTENT_ARTWORK_TYPOGRAPHY_PRESETS = [
  { id: "brand", label: "Church brand", description: "Uses the church font with a clear social hierarchy.", headingFamily: "BRAND", bodyFamily: "BRAND", headingWeight: 850, bodyWeight: 650 },
  { id: "editorial", label: "Editorial serif", description: "A timeless, expressive serif treatment for quotes and Scripture.", headingFamily: "Georgia, serif", bodyFamily: "Georgia, serif", headingWeight: 700, bodyWeight: 600 },
  { id: "modern", label: "Modern clean", description: "Crisp, neutral sans-serif type for direct teaching.", headingFamily: "Arial, sans-serif", bodyFamily: "Arial, sans-serif", headingWeight: 800, bodyWeight: 650 },
  { id: "humanist", label: "Warm humanist", description: "Friendly, approachable type for pastoral encouragement.", headingFamily: "Trebuchet MS, sans-serif", bodyFamily: "Trebuchet MS, sans-serif", headingWeight: 750, bodyWeight: 600 },
  { id: "bold", label: "Bold statement", description: "Strong display type for short declarations and invitations.", headingFamily: "Arial Black, Arial, sans-serif", bodyFamily: "Arial, sans-serif", headingWeight: 900, bodyWeight: 750 },
  { id: "quiet", label: "Quiet classic", description: "A restrained classic pairing for prayer and reflection.", headingFamily: "Georgia, serif", bodyFamily: "Times New Roman, Georgia, serif", headingWeight: 600, bodyWeight: 500 },
] as const;

export type ContentArtworkTypographyPreset = (typeof CONTENT_ARTWORK_TYPOGRAPHY_PRESETS)[number];
export type ContentArtworkTypographyPresetId = ContentArtworkTypographyPreset["id"];
export type ContentArtworkAlignment = "LEFT" | "CENTER" | "RIGHT";
export type ContentArtworkFocalPointX = "LEFT" | "CENTER" | "RIGHT";
export type ContentArtworkFocalPointY = "TOP" | "CENTER" | "BOTTOM";
export type ContentArtworkLogoPosition = "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_LEFT" | "BOTTOM_RIGHT";

export type ContentArtworkSettings = {
  version: 1;
  backgroundId: ContentArtworkBackgroundId;
  paletteId: ContentArtworkPaletteId;
  typographyPresetId: ContentArtworkTypographyPresetId;
  alignment: ContentArtworkAlignment;
  textScale: number;
  lineHeight: number;
  letterSpacing: number;
  overlayOpacity: number;
  blur: number;
  brightness: number;
  focalPointX: ContentArtworkFocalPointX;
  focalPointY: ContentArtworkFocalPointY;
  showLogo: boolean;
  logoPosition: ContentArtworkLogoPosition;
};

export type ContentArtworkTextOverrides = {
  version: 1;
  /** Null keeps the selected template's default label. */
  eyebrowText: string | null;
  /** Null keeps the current Brand Kit church name. */
  footerText: string | null;
  showEyebrow: boolean;
  showFooter: boolean;
};

export type ArtworkSettings = ContentArtworkSettings;

export type ContentArtworkRecommendationCategory =
  | "RECOMMENDED"
  | "PHOTO"
  | "EDITORIAL"
  | "BOLD"
  | "CALM"
  | "CHURCH";

export type ContentArtworkRecommendation = {
  id: string;
  label: string;
  description: string;
  category: ContentArtworkRecommendationCategory;
  templateId: ContentGraphicTemplateId;
  settings: ContentArtworkSettings;
};

const BACKGROUND_IDS = new Set<string>(CONTENT_ARTWORK_BACKGROUNDS.map((item) => item.id));
const PALETTE_IDS = new Set<string>(CONTENT_ARTWORK_PALETTES.map((item) => item.id));
const TYPOGRAPHY_IDS = new Set<string>(CONTENT_ARTWORK_TYPOGRAPHY_PRESETS.map((item) => item.id));
const ALIGNMENTS = new Set<string>(["LEFT", "CENTER", "RIGHT"]);
const FOCAL_X = new Set<string>(["LEFT", "CENTER", "RIGHT"]);
const FOCAL_Y = new Set<string>(["TOP", "CENTER", "BOTTOM"]);
const LOGO_POSITIONS = new Set<string>(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  if (typeof value !== "string") return fallback;
  if (allowed.has(value)) return value as T;
  const uppercase = value.toUpperCase();
  return allowed.has(uppercase) ? uppercase as T : fallback;
}

export function createDefaultContentArtworkSettings(
  templateId?: ContentGraphicTemplateId | null,
): ContentArtworkSettings {
  const template = getContentGraphicTemplate(templateId ?? "carousel-content");
  return {
    version: 1,
    backgroundId: "brand-gradient",
    paletteId: "brand",
    typographyPresetId: "brand",
    alignment: template.alignment,
    textScale: 1,
    lineHeight: 1.25,
    letterSpacing: 0.15,
    overlayOpacity: 0.28,
    blur: 0,
    brightness: 1,
    focalPointX: "CENTER",
    focalPointY: "CENTER",
    showLogo: true,
    logoPosition: "BOTTOM_LEFT",
  };
}

/**
 * Reads current settings and the earlier nested draft shape. Unknown values are
 * deliberately replaced with safe defaults so stored artwork remains renderable.
 */
export function normalizeContentArtworkSettings(
  value: unknown,
  templateId?: ContentGraphicTemplateId | null,
): ContentArtworkSettings {
  const defaults = createDefaultContentArtworkSettings(templateId);
  const record = recordOf(value);
  if (!record) return defaults;
  const background = recordOf(record.background);
  const typography = recordOf(record.typography);
  const focalPoint = recordOf(record.focalPoint) ?? recordOf(background?.focalPoint);
  const logo = recordOf(record.logo) ?? recordOf(record.logoTreatment);

  return {
    version: 1,
    backgroundId: enumValue(
      record.backgroundId ?? background?.id,
      BACKGROUND_IDS,
      defaults.backgroundId,
    ),
    paletteId: enumValue(record.paletteId, PALETTE_IDS, defaults.paletteId),
    typographyPresetId: enumValue(
      record.typographyPresetId ?? record.typographyId ?? typography?.presetId,
      TYPOGRAPHY_IDS,
      defaults.typographyPresetId,
    ),
    alignment: enumValue(record.alignment ?? typography?.alignment, ALIGNMENTS, defaults.alignment),
    textScale: finiteNumber(record.textScale ?? typography?.scale, defaults.textScale, 0.75, 1.3),
    lineHeight: finiteNumber(record.lineHeight ?? typography?.lineHeight, defaults.lineHeight, 0.9, 1.35),
    letterSpacing: finiteNumber(record.letterSpacing ?? typography?.letterSpacing, defaults.letterSpacing, -1, 4),
    overlayOpacity: finiteNumber(
      record.overlayOpacity ?? record.overlay ?? background?.overlay,
      defaults.overlayOpacity,
      0,
      0.9,
    ),
    blur: finiteNumber(record.blur ?? background?.blur, defaults.blur, 0, 20),
    brightness: finiteNumber(record.brightness ?? background?.brightness, defaults.brightness, 0.45, 1.25),
    focalPointX: enumValue(
      record.focalPointX ?? focalPoint?.x,
      FOCAL_X,
      defaults.focalPointX,
    ),
    focalPointY: enumValue(
      record.focalPointY ?? focalPoint?.y,
      FOCAL_Y,
      defaults.focalPointY,
    ),
    showLogo: typeof record.showLogo === "boolean"
      ? record.showLogo
      : typeof logo?.visible === "boolean"
        ? logo.visible
        : defaults.showLogo,
    logoPosition: enumValue(
      record.logoPosition ?? logo?.position,
      LOGO_POSITIONS,
      defaults.logoPosition,
    ),
  };
}

export function createDefaultContentArtworkTextOverrides(): ContentArtworkTextOverrides {
  return {
    version: 1,
    eyebrowText: null,
    footerText: null,
    showEyebrow: true,
    showFooter: true,
  };
}

function normalizedArtworkText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

export function normalizeContentArtworkTextOverrides(
  value: unknown,
): ContentArtworkTextOverrides {
  const defaults = createDefaultContentArtworkTextOverrides();
  const record = recordOf(value);
  if (!record) return defaults;
  return {
    version: 1,
    eyebrowText: normalizedArtworkText(record.eyebrowText, 48),
    footerText: normalizedArtworkText(record.footerText, 60),
    showEyebrow: typeof record.showEyebrow === "boolean"
      ? record.showEyebrow
      : defaults.showEyebrow,
    showFooter: typeof record.showFooter === "boolean"
      ? record.showFooter
      : defaults.showFooter,
  };
}

export function getContentArtworkBackground(id: ContentArtworkBackgroundId): ContentArtworkBackground {
  return CONTENT_ARTWORK_BACKGROUNDS.find((item) => item.id === id) ?? CONTENT_ARTWORK_BACKGROUNDS[0];
}

export function getContentArtworkPalette(id: ContentArtworkPaletteId): ContentArtworkPalette {
  return CONTENT_ARTWORK_PALETTES.find((item) => item.id === id) ?? CONTENT_ARTWORK_PALETTES[0];
}

export function getContentArtworkTypographyPreset(
  id: ContentArtworkTypographyPresetId,
): ContentArtworkTypographyPreset {
  return CONTENT_ARTWORK_TYPOGRAPHY_PRESETS.find((item) => item.id === id)
    ?? CONTENT_ARTWORK_TYPOGRAPHY_PRESETS[0];
}

const TEMPLATE_IDS_BY_ASSET_TYPE: Record<string, readonly ContentGraphicTemplateId[]> = {
  QUOTE_GRAPHIC: ["quote-emphasis", "quote-minimal", "quote-radiant", "quote-textured"],
  SCRIPTURE_GRAPHIC: ["scripture-focus", "scripture-editorial", "scripture-calm", "scripture-textured"],
  PRAYER: ["prayer-calm"],
  PRAYER_GUIDE: ["prayer-calm"],
  DEVOTIONAL: ["devotional-reflection"],
  DEVOTIONAL_SUMMARY: ["devotional-reflection"],
  DEVOTIONAL_GUIDE: ["devotional-reflection"],
  STORY: ["devotional-reflection"],
  INVITATION: ["invitation-bold"],
  NEXT_SERVICE_PROMOTION: ["invitation-bold"],
  INVITATION_CONTENT: ["invitation-bold"],
  ALTAR_CALL_FOLLOW_UP_CONTENT: ["invitation-bold"],
  EVENT_FOLLOW_UP_CONTENT: ["invitation-bold"],
};

function templatesForRecommendation(
  assetType: string,
  selectedTemplateId?: ContentGraphicTemplateId,
): readonly ContentGraphicTemplateId[] {
  if (assetType === "CAROUSEL") {
    return selectedTemplateId?.startsWith("carousel-") ? [selectedTemplateId] : ["carousel-cover"];
  }
  return TEMPLATE_IDS_BY_ASSET_TYPE[assetType]
    ?? (selectedTemplateId ? [selectedTemplateId] : [getDefaultTemplateId({ assetType })]);
}

export function buildArtworkRecommendations(
  assetType: string,
  selectedTemplateId?: ContentGraphicTemplateId,
): ContentArtworkRecommendation[] {
  const templates = templatesForRecommendation(assetType, selectedTemplateId);
  const templateAt = (index: number) => templates[index % templates.length];
  const settings = (
    index: number,
    patch: Partial<ContentArtworkSettings>,
  ): ContentArtworkSettings => normalizeContentArtworkSettings({
    ...createDefaultContentArtworkSettings(templateAt(index)),
    ...patch,
  }, templateAt(index));

  const recipes: Array<Omit<ContentArtworkRecommendation, "templateId" | "settings"> & {
    settings: Partial<ContentArtworkSettings>;
  }> = [
    { id: "best-for-message", label: "Best for this message", description: "A balanced branded direction with immediate readability.", category: "RECOMMENDED", settings: { backgroundId: "brand-gradient", paletteId: "brand", typographyPresetId: "brand", overlayOpacity: 0.3 } },
    { id: "still-waters", label: "Still waters", description: "Peaceful photography with a calm, reflective type treatment.", category: "PHOTO", settings: { backgroundId: "still-waters", paletteId: "ocean", typographyPresetId: "quiet", alignment: "CENTER", overlayOpacity: 0.52, brightness: 0.82, focalPointY: "CENTER" } },
    { id: "mountain-dawn", label: "New mercies", description: "Hopeful dawn photography for courage and fresh beginnings.", category: "PHOTO", settings: { backgroundId: "mountain-dawn", paletteId: "sunrise", typographyPresetId: "humanist", alignment: "LEFT", overlayOpacity: 0.5, brightness: 0.86, focalPointY: "BOTTOM" } },
    { id: "sanctuary-light", label: "Sacred light", description: "A reverent sanctuary atmosphere with classic typography.", category: "PHOTO", settings: { backgroundId: "sanctuary-light", paletteId: "earth", typographyPresetId: "editorial", alignment: "CENTER", overlayOpacity: 0.56, brightness: 0.78, focalPointX: "RIGHT" } },
    { id: "desert-path", label: "Faithful path", description: "Warm, grounded photography for perseverance and response.", category: "PHOTO", settings: { backgroundId: "desert-path", paletteId: "earth", typographyPresetId: "humanist", alignment: "LEFT", overlayOpacity: 0.52, brightness: 0.84, focalPointX: "RIGHT", focalPointY: "BOTTOM" } },
    { id: "soft-clouds", label: "Open heaven", description: "Airy light and a gentle classic voice for encouragement.", category: "CALM", settings: { backgroundId: "soft-clouds", paletteId: "ocean", typographyPresetId: "quiet", alignment: "CENTER", overlayOpacity: 0.55, brightness: 0.88, blur: 1 } },
    { id: "urban-light", label: "City light", description: "A contemporary urban direction for youth and outreach.", category: "PHOTO", settings: { backgroundId: "urban-light", paletteId: "midnight", typographyPresetId: "modern", alignment: "LEFT", overlayOpacity: 0.58, brightness: 0.78, focalPointX: "RIGHT" } },
    { id: "editorial-paper", label: "Sunday editorial", description: "Confident magazine composition with understated texture.", category: "EDITORIAL", settings: { backgroundId: "paper-wash", paletteId: "earth", typographyPresetId: "editorial", alignment: "LEFT", overlayOpacity: 0.26, letterSpacing: 0.05 } },
    { id: "radiant-declaration", label: "Radiant declaration", description: "High-energy light and strong type for a memorable statement.", category: "BOLD", settings: { backgroundId: "radiant-rays", paletteId: "sunrise", typographyPresetId: "bold", alignment: "CENTER", textScale: 1.06, lineHeight: 1.14, overlayOpacity: 0.28 } },
    { id: "quiet-glow", label: "Quiet glow", description: "Soft dimensional light with generous, devotional spacing.", category: "CALM", settings: { backgroundId: "soft-glow", paletteId: "ocean", typographyPresetId: "quiet", alignment: "CENTER", textScale: 0.96, lineHeight: 1.36, overlayOpacity: 0.3 } },
    { id: "church-signature", label: "Church signature", description: "A recognisable brand-led direction with the church logo present.", category: "CHURCH", settings: { backgroundId: "woven-depth", paletteId: "brand", typographyPresetId: "brand", alignment: "LEFT", overlayOpacity: 0.34, showLogo: true, logoPosition: "BOTTOM_LEFT" } },
    { id: "midnight-minimal", label: "Midnight minimal", description: "Focused contrast and quiet restraint for short, powerful copy.", category: "EDITORIAL", settings: { backgroundId: "midnight-depth", paletteId: "midnight", typographyPresetId: "modern", alignment: "RIGHT", textScale: 0.94, lineHeight: 1.3, letterSpacing: 0.5, overlayOpacity: 0.24, showLogo: false } },
  ];

  return recipes.map((recipe, index) => ({
    ...recipe,
    templateId: templateAt(index),
    settings: settings(index, recipe.settings),
  }));
}

export const ARTWORK_BACKGROUNDS = CONTENT_ARTWORK_BACKGROUNDS;
export const ARTWORK_PALETTES = CONTENT_ARTWORK_PALETTES;
export const ARTWORK_TYPOGRAPHY_PRESETS = CONTENT_ARTWORK_TYPOGRAPHY_PRESETS;
export const getDefaultArtworkSettings = createDefaultContentArtworkSettings;
export const normalizeArtworkSettings = normalizeContentArtworkSettings;
export const normalizeArtworkTextOverrides = normalizeContentArtworkTextOverrides;
export const getArtworkRecommendations = buildArtworkRecommendations;
