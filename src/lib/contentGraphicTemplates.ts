export const CONTENT_GRAPHIC_TEMPLATE_IDS = [
  "quote-emphasis",
  "scripture-focus",
  "prayer-calm",
  "devotional-reflection",
  "invitation-bold",
  "carousel-cover",
  "carousel-content",
  "carousel-cta",
] as const;

export type ContentGraphicTemplateId = (typeof CONTENT_GRAPHIC_TEMPLATE_IDS)[number];
export type CarouselSlideRole = "COVER" | "CONTENT" | "CTA";

export type ContentGraphicTemplate = {
  id: ContentGraphicTemplateId;
  label: string;
  description: string;
  eyebrow: string;
  role: "QUOTE" | "SCRIPTURE" | "PRAYER" | "DEVOTIONAL" | "INVITATION" | CarouselSlideRole;
  alignment: "LEFT" | "CENTER";
  surface: "GLASS" | "PANEL" | "MINIMAL" | "BOLD";
  showQuoteMark: boolean;
};

export const CONTENT_GRAPHIC_TEMPLATES: readonly ContentGraphicTemplate[] = [
  {
    id: "quote-emphasis",
    label: "Quote emphasis",
    description: "A strong sermon quote with a distinctive quotation mark and source line.",
    eyebrow: "FROM THE MESSAGE",
    role: "QUOTE",
    alignment: "LEFT",
    surface: "GLASS",
    showQuoteMark: true,
  },
  {
    id: "scripture-focus",
    label: "Scripture focus",
    description: "A centred, reverent treatment that gives Scripture room to breathe.",
    eyebrow: "SCRIPTURE",
    role: "SCRIPTURE",
    alignment: "CENTER",
    surface: "MINIMAL",
    showQuoteMark: false,
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
};

export type ContentDesignStudioDocument = {
  version: 1;
  templateId: ContentGraphicTemplateId;
  slides: CarouselStudioSlide[];
};

export function isContentGraphicTemplateId(value: unknown): value is ContentGraphicTemplateId {
  return typeof value === "string" && TEMPLATE_BY_ID.has(value as ContentGraphicTemplateId);
}

export function getContentGraphicTemplate(id: ContentGraphicTemplateId): ContentGraphicTemplate {
  return TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get("carousel-content")!;
}

export function getTemplatesForSlideRole(role: CarouselSlideRole): ContentGraphicTemplate[] {
  return CONTENT_GRAPHIC_TEMPLATES.filter((template) => template.role === role || (
    role === "CONTENT" && !["COVER", "CTA"].includes(template.role)
  ));
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

  return {
    version: 1,
    templateId,
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
