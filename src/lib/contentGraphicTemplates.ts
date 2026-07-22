import {
  normalizeContentArtworkSettings,
  normalizeContentArtworkTextOverrides,
  type ContentArtworkSettings,
  type ContentArtworkTextOverrides,
} from "@/lib/contentArtworkDesign";

export const CONTENT_GRAPHIC_TEMPLATE_IDS = [
  "quote-emphasis",
  "quote-minimal",
  "quote-radiant",
  "quote-textured",
  "scripture-focus",
  "scripture-editorial",
  "scripture-calm",
  "scripture-textured",
  "prayer-calm",
  "devotional-reflection",
  "invitation-bold",
  "carousel-cover",
  "carousel-content",
  "carousel-cta",
] as const;

export type ContentGraphicTemplateId = (typeof CONTENT_GRAPHIC_TEMPLATE_IDS)[number];
export type CarouselSlideRole = "COVER" | "CONTENT" | "CTA";
export type ContentGraphicArtDirection =
  | "EDITORIAL"
  | "MINIMAL"
  | "LUMINOUS"
  | "TEXTURED"
  | "SERENE"
  | "JOURNAL"
  | "CELEBRATION";
export type ContentGraphicTemplateFamily =
  | "EDITORIAL_MINIMAL"
  | "BOLD_RADIANT"
  | "TEXTURED_PHOTO";
export type ContentGraphicReferenceTreatment = "BYLINE" | "RULE" | "PILL" | "PLAIN";

export type ContentGraphicTemplate = {
  id: ContentGraphicTemplateId;
  label: string;
  description: string;
  eyebrow: string;
  role: "QUOTE" | "SCRIPTURE" | "PRAYER" | "DEVOTIONAL" | "INVITATION" | CarouselSlideRole;
  alignment: "LEFT" | "CENTER";
  surface: "GLASS" | "PANEL" | "MINIMAL" | "BOLD";
  showQuoteMark: boolean;
  artDirection: ContentGraphicArtDirection;
  family: ContentGraphicTemplateFamily;
  referenceTreatment: ContentGraphicReferenceTreatment;
  tone: string;
};

export const CONTENT_GRAPHIC_TEMPLATE_FAMILY_LABELS: Record<ContentGraphicTemplateFamily, string> = {
  EDITORIAL_MINIMAL: "Editorial & minimal",
  BOLD_RADIANT: "Bold & radiant",
  TEXTURED_PHOTO: "Textured depth",
};

export const CONTENT_GRAPHIC_REFERENCE_LABELS: Record<ContentGraphicReferenceTreatment, string> = {
  BYLINE: "Byline",
  RULE: "Ruled reference",
  PILL: "Reference badge",
  PLAIN: "Simple reference",
};

export const CONTENT_GRAPHIC_TEMPLATES: readonly ContentGraphicTemplate[] = [
  {
    id: "quote-emphasis",
    label: "Editorial quote",
    description: "Magazine framing, serif quotation type, and a speaker byline.",
    eyebrow: "FROM THE MESSAGE",
    role: "QUOTE",
    alignment: "LEFT",
    surface: "GLASS",
    showQuoteMark: true,
    artDirection: "EDITORIAL",
    family: "EDITORIAL_MINIMAL",
    referenceTreatment: "BYLINE",
    tone: "Confident",
  },
  {
    id: "quote-minimal",
    label: "Minimal quote",
    description: "Generous space, restrained rules, and a quiet speaker byline.",
    eyebrow: "FROM THE MESSAGE",
    role: "QUOTE",
    alignment: "CENTER",
    surface: "MINIMAL",
    showQuoteMark: true,
    artDirection: "MINIMAL",
    family: "EDITORIAL_MINIMAL",
    referenceTreatment: "BYLINE",
    tone: "Refined",
  },
  {
    id: "quote-radiant",
    label: "Radiant quote",
    description: "A warm focal glow that makes an encouraging quote feel uplifting.",
    eyebrow: "FROM THE MESSAGE",
    role: "QUOTE",
    alignment: "CENTER",
    surface: "GLASS",
    showQuoteMark: true,
    artDirection: "LUMINOUS",
    family: "BOLD_RADIANT",
    referenceTreatment: "PILL",
    tone: "Uplifting",
  },
  {
    id: "quote-textured",
    label: "Textured quote",
    description: "Layered grain and a grounded editorial panel, ready for bold testimony copy.",
    eyebrow: "FROM THE MESSAGE",
    role: "QUOTE",
    alignment: "LEFT",
    surface: "PANEL",
    showQuoteMark: true,
    artDirection: "TEXTURED",
    family: "TEXTURED_PHOTO",
    referenceTreatment: "BYLINE",
    tone: "Grounded",
  },
  {
    id: "scripture-focus",
    label: "Radiant Scripture",
    description: "A luminous, centred composition that gives the verse room to breathe.",
    eyebrow: "SCRIPTURE",
    role: "SCRIPTURE",
    alignment: "CENTER",
    surface: "MINIMAL",
    showQuoteMark: false,
    artDirection: "LUMINOUS",
    family: "BOLD_RADIANT",
    referenceTreatment: "PILL",
    tone: "Reverent",
  },
  {
    id: "scripture-editorial",
    label: "Editorial Scripture",
    description: "A bold, modern layout for clear teaching and easy social reading.",
    eyebrow: "SCRIPTURE",
    role: "SCRIPTURE",
    alignment: "LEFT",
    surface: "PANEL",
    showQuoteMark: false,
    artDirection: "EDITORIAL",
    family: "EDITORIAL_MINIMAL",
    referenceTreatment: "RULE",
    tone: "Modern",
  },
  {
    id: "scripture-calm",
    label: "Still-waters Scripture",
    description: "Soft organic layers for reflective, devotional Scripture moments.",
    eyebrow: "SCRIPTURE",
    role: "SCRIPTURE",
    alignment: "CENTER",
    surface: "GLASS",
    showQuoteMark: false,
    artDirection: "SERENE",
    family: "BOLD_RADIANT",
    referenceTreatment: "PLAIN",
    tone: "Peaceful",
  },
  {
    id: "scripture-textured",
    label: "Textured Scripture",
    description: "Woven paper detail and a protected reading panel for a timeless verse card.",
    eyebrow: "SCRIPTURE",
    role: "SCRIPTURE",
    alignment: "LEFT",
    surface: "PANEL",
    showQuoteMark: false,
    artDirection: "TEXTURED",
    family: "TEXTURED_PHOTO",
    referenceTreatment: "RULE",
    tone: "Timeless",
  },
  {
    id: "prayer-calm",
    label: "Prayer",
    description: "A calm prayer card for reflection and response.",
    eyebrow: "LET US PRAY",
    role: "PRAYER",
    alignment: "CENTER",
    surface: "GLASS",
    showQuoteMark: false,
    artDirection: "SERENE",
    family: "BOLD_RADIANT",
    referenceTreatment: "PLAIN",
    tone: "Peaceful",
  },
  {
    id: "devotional-reflection",
    label: "Devotional",
    description: "A readable reflection layout with a clear teaching hierarchy.",
    eyebrow: "DEVOTIONAL",
    role: "DEVOTIONAL",
    alignment: "LEFT",
    surface: "PANEL",
    showQuoteMark: false,
    artDirection: "JOURNAL",
    family: "TEXTURED_PHOTO",
    referenceTreatment: "RULE",
    tone: "Thoughtful",
  },
  {
    id: "invitation-bold",
    label: "Invitation",
    description: "A high-contrast invitation designed to make the next step obvious.",
    eyebrow: "YOU ARE INVITED",
    role: "INVITATION",
    alignment: "CENTER",
    surface: "BOLD",
    showQuoteMark: false,
    artDirection: "CELEBRATION",
    family: "BOLD_RADIANT",
    referenceTreatment: "PILL",
    tone: "Energetic",
  },
  {
    id: "carousel-cover",
    label: "Carousel cover",
    description: "A bold opening slide that introduces the promise of the carousel.",
    eyebrow: "SWIPE TO READ",
    role: "COVER",
    alignment: "LEFT",
    surface: "BOLD",
    showQuoteMark: false,
    artDirection: "CELEBRATION",
    family: "BOLD_RADIANT",
    referenceTreatment: "PILL",
    tone: "Bold",
  },
  {
    id: "carousel-content",
    label: "Carousel teaching",
    description: "A structured teaching slide for one clear sermon point at a time.",
    eyebrow: "FROM THE SERMON",
    role: "CONTENT",
    alignment: "LEFT",
    surface: "PANEL",
    showQuoteMark: false,
    artDirection: "EDITORIAL",
    family: "EDITORIAL_MINIMAL",
    referenceTreatment: "RULE",
    tone: "Clear",
  },
  {
    id: "carousel-cta",
    label: "Carousel response",
    description: "A final response slide for prayer, reflection, or a practical next step.",
    eyebrow: "YOUR NEXT STEP",
    role: "CTA",
    alignment: "CENTER",
    surface: "GLASS",
    showQuoteMark: false,
    artDirection: "LUMINOUS",
    family: "BOLD_RADIANT",
    referenceTreatment: "PILL",
    tone: "Inviting",
  },
] as const;

const TEMPLATE_BY_ID = new Map(CONTENT_GRAPHIC_TEMPLATES.map((template) => [template.id, template]));

export type CarouselStudioSlide = {
  id: string;
  role: CarouselSlideRole;
  templateId: ContentGraphicTemplateId;
  title: string;
  body: string;
  scripture: string | null;
  textOverrides?: ContentArtworkTextOverrides;
};

export type ContentDesignStudioDocument = {
  version: 2;
  templateId: ContentGraphicTemplateId;
  artwork: ContentArtworkSettings;
  textOverrides: ContentArtworkTextOverrides;
  slides: CarouselStudioSlide[];
};

export function isContentGraphicTemplateId(value: unknown): value is ContentGraphicTemplateId {
  return typeof value === "string" && TEMPLATE_BY_ID.has(value as ContentGraphicTemplateId);
}

export function getContentGraphicTemplate(id: ContentGraphicTemplateId): ContentGraphicTemplate {
  return TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get("carousel-content")!;
}

export function getTemplatesForSlideRole(role: CarouselSlideRole): ContentGraphicTemplate[] {
  return CONTENT_GRAPHIC_TEMPLATES.filter((template) => template.role === role);
}

const TEMPLATE_ROLE_BY_ASSET_TYPE: Record<string, ContentGraphicTemplate["role"]> = {
  QUOTE_GRAPHIC: "QUOTE",
  SCRIPTURE_GRAPHIC: "SCRIPTURE",
  PRAYER: "PRAYER",
  PRAYER_GUIDE: "PRAYER",
  DEVOTIONAL: "DEVOTIONAL",
  DEVOTIONAL_SUMMARY: "DEVOTIONAL",
  DEVOTIONAL_GUIDE: "DEVOTIONAL",
  STORY: "DEVOTIONAL",
  INVITATION: "INVITATION",
  NEXT_SERVICE_PROMOTION: "INVITATION",
  INVITATION_CONTENT: "INVITATION",
  ALTAR_CALL_FOLLOW_UP_CONTENT: "INVITATION",
  EVENT_FOLLOW_UP_CONTENT: "INVITATION",
};

export function getTemplatesForAssetType(assetType: string): ContentGraphicTemplate[] {
  const role = TEMPLATE_ROLE_BY_ASSET_TYPE[assetType];
  if (!role) {
    return CONTENT_GRAPHIC_TEMPLATES.filter((template) => !["COVER", "CONTENT", "CTA"].includes(template.role));
  }
  return CONTENT_GRAPHIC_TEMPLATES.filter((template) => template.role === role);
}

export function getDefaultTemplateId(input: {
  assetType?: string | null;
  slideRole?: CarouselSlideRole;
}): ContentGraphicTemplateId {
  if (input.slideRole === "COVER") return "carousel-cover";
  if (input.slideRole === "CTA") return "carousel-cta";
  if (input.slideRole === "CONTENT") return "carousel-content";

  switch (input.assetType) {
    case "QUOTE_GRAPHIC": return "quote-emphasis";
    case "SCRIPTURE_GRAPHIC": return "scripture-focus";
    case "PRAYER":
    case "PRAYER_GUIDE": return "prayer-calm";
    case "DEVOTIONAL":
    case "DEVOTIONAL_SUMMARY":
    case "DEVOTIONAL_GUIDE": return "devotional-reflection";
    case "STORY": return "devotional-reflection";
    case "INVITATION":
    case "NEXT_SERVICE_PROMOTION":
    case "INVITATION_CONTENT":
    case "ALTAR_CALL_FOLLOW_UP_CONTENT":
    case "EVENT_FOLLOW_UP_CONTENT": return "invitation-bold";
    case "CAROUSEL": return "carousel-cover";
    default: return "carousel-content";
  }
}

function cleanSlidePrefix(value: string): string {
  return value.replace(/^(?:slide\s*)?\d+[.):\-]\s*/i, "").trim();
}

export function splitEditableCarouselCopy(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const labelled = normalized
    .split(/\n(?=(?:slide\s*)?\d+[.):\-]\s*)/i)
    .map(cleanSlidePrefix)
    .filter(Boolean);
  if (labelled.length > 1) return labelled.slice(0, 10);

  return normalized
    .split(/\n{2,}/)
    .map(cleanSlidePrefix)
    .filter(Boolean)
    .slice(0, 10);
}

function slideTitleFromCopy(copy: string, index: number): { title: string; body: string } {
  const lines = copy.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 100) {
    return { title: lines[0], body: lines.slice(1).join("\n") };
  }
  return { title: index === 0 ? "Start here" : `Point ${index + 1}`, body: copy.trim() };
}

export function buildCarouselStudioSlides(content: string, title: string): CarouselStudioSlide[] {
  const parts = splitEditableCarouselCopy(content);
  const source = parts.length ? parts : [content.trim() || title.trim() || "Add your first slide"];

  return source.map((copy, index) => {
    const role: CarouselSlideRole = index === 0 ? "COVER" : "CONTENT";
    const parsed = slideTitleFromCopy(copy, index);
    return {
      id: `slide-${index + 1}`,
      role,
      templateId: getDefaultTemplateId({ slideRole: role }),
      title: index === 0 && parsed.title === "Start here" ? title.trim() || parsed.title : parsed.title,
      body: parsed.body,
      scripture: null,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStoredSlide(value: unknown, index: number): CarouselStudioSlide | null {
  const record = asRecord(value);
  if (!record) return null;
  const role = record.role === "COVER" || record.role === "CTA" ? record.role : "CONTENT";
  const templateId = isContentGraphicTemplateId(record.templateId)
    ? record.templateId
    : getDefaultTemplateId({ slideRole: role });
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (!title && !body) return null;

  return {
    id: typeof record.id === "string" && /^[A-Za-z0-9._-]+$/.test(record.id)
      ? record.id
      : `slide-${index + 1}`,
    role,
    templateId,
    title: title || `Slide ${index + 1}`,
    body,
    scripture: typeof record.scripture === "string" && record.scripture.trim()
      ? record.scripture.trim()
      : null,
    ...(record.textOverrides == null
      ? {}
      : { textOverrides: normalizeContentArtworkTextOverrides(record.textOverrides) }),
  };
}

export function readContentDesignStudioDocument(input: {
  metadata: unknown;
  assetType: string;
  title: string;
  bodyContent: string | null | undefined;
}): ContentDesignStudioDocument {
  const metadata = asRecord(input.metadata);
  const stored = asRecord(metadata?.designStudio);
  const templateId = isContentGraphicTemplateId(stored?.templateId)
    ? stored.templateId
    : getDefaultTemplateId({ assetType: input.assetType });
  const storedSlides = Array.isArray(stored?.slides)
    ? stored.slides.map(parseStoredSlide).filter((slide): slide is CarouselStudioSlide => Boolean(slide)).slice(0, 10)
    : [];
  const artwork = normalizeContentArtworkSettings(stored?.artwork, templateId);
  const textOverrides = normalizeContentArtworkTextOverrides(stored?.textOverrides);

  return {
    version: 2,
    templateId,
    artwork,
    textOverrides,
    slides: input.assetType === "CAROUSEL" && storedSlides.length === 0
      ? buildCarouselStudioSlides(input.bodyContent ?? "", input.title)
      : storedSlides,
  };
}

export function serializeCarouselStudioBody(slides: readonly CarouselStudioSlide[]): string {
  return slides.map((slide, index) => {
    const lines = [slide.title.trim(), slide.body.trim()].filter(Boolean);
    return `Slide ${index + 1}: ${lines.join("\n")}`;
  }).join("\n\n");
}

export function isDesignableContentAssetType(assetType: string): boolean {
  return [
    "QUOTE_GRAPHIC",
    "SCRIPTURE_GRAPHIC",
    "CAROUSEL",
    "PRAYER",
    "DEVOTIONAL",
    "INVITATION",
    "STORY",
  ].includes(assetType);
}
