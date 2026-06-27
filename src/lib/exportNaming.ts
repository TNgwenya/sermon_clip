export type SermonExportNamingInput = {
  title: string;
  speakerName?: string | null;
  sermonDate?: Date | string | null;
};

export type ClipExportNamingInput = {
  title: string;
  description?: string | null;
  index?: number;
};

const MAX_EXPORT_NAME_LENGTH = 72;

function trimSlug(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

export function slugifyExportName(value: string, fallback = "sermon-clip"): string {
  const slug = trimSlug(value
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_EXPORT_NAME_LENGTH));

  return slug || fallback;
}

export function formatExportDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "undated";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "undated";
  }

  return date.toISOString().slice(0, 10);
}

function isGenericClipTitle(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    normalized === "" ||
    normalized === "clip" ||
    normalized === "sermon clip" ||
    normalized === "untitled" ||
    normalized === "untitled clip" ||
    /^clip \d+$/.test(normalized)
  );
}

function resolveClipNameSource(input: ClipExportNamingInput): string {
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";

  if (title && !isGenericClipTitle(title)) {
    return title;
  }

  return description || title;
}

export function buildSermonExportDirectoryName(input: SermonExportNamingInput): string {
  return [
    slugifyExportName(input.title, "sermon"),
    slugifyExportName(input.speakerName ?? "pastor", "pastor"),
    formatExportDate(input.sermonDate),
  ].join("_");
}

export function buildClipExportBaseName(input: ClipExportNamingInput): string {
  const prefix = typeof input.index === "number" ? `${String(input.index).padStart(2, "0")}_` : "";
  return `${prefix}${slugifyExportName(resolveClipNameSource(input), "clip")}`;
}

export function buildClipDownloadFileName(input: SermonExportNamingInput & ClipExportNamingInput & {
  clipTitle?: string | null;
  extension?: string | null;
}): string {
  const extension = input.extension?.startsWith(".") ? input.extension : ".mp4";
  const sermonName = buildSermonExportDirectoryName(input);
  const clipName = buildClipExportBaseName({
    title: input.clipTitle ?? input.title,
    description: input.description,
    index: input.index,
  });

  return `${sermonName}_${clipName}${extension}`;
}
