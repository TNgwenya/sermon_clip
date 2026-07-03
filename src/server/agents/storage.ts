import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canRunLocalMediaProcessing,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";

const DEFAULT_STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage");
const SERMON_FOLDER_MANIFEST_FILE = ".sermon-folders.json";
const MAX_SERMON_FOLDER_SLUG_LENGTH = 80;

type SermonFolderManifest = Record<string, string>;

function assertPathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid ${label}.`);
  }
  return trimmed;
}

export function getStorageRoot(): string {
  const configured = process.env.SERMON_STORAGE_ROOT?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_STORAGE_ROOT;
}

function getSermonsRoot(): string {
  return path.join(/* turbopackIgnore: true */ getStorageRoot(), "sermons");
}

function getSermonFolderManifestPath(): string {
  return path.join(getSermonsRoot(), SERMON_FOLDER_MANIFEST_FILE);
}

function readSermonFolderManifestSync(): SermonFolderManifest {
  try {
    const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ getSermonFolderManifestPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        typeof entry[0] === "string"
        && typeof entry[1] === "string"
        && entry[0].trim().length > 0
        && entry[1].trim().length > 0
        && !entry[1].includes("/")
        && !entry[1].includes("\\")
      )),
    );
  } catch {
    return {};
  }
}

async function readSermonFolderManifest(): Promise<SermonFolderManifest> {
  return readSermonFolderManifestSync();
}

async function writeSermonFolderManifest(manifest: SermonFolderManifest): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ getSermonsRoot(), { recursive: true });
  await writeFile(
    /* turbopackIgnore: true */ getSermonFolderManifestPath(),
    `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`,
    "utf8",
  );
}

export function buildSermonFolderSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SERMON_FOLDER_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "sermon";
}

export async function registerSermonStorageFolder(sermonId: string, title: string): Promise<string> {
  assertLocalStorageAvailable("Local sermon storage");
  const safeSermonId = assertPathSegment(sermonId, "sermonId");
  const manifest = await readSermonFolderManifest();
  const existing = manifest[safeSermonId];
  if (existing) {
    return existing;
  }

  await mkdir(/* turbopackIgnore: true */ getSermonsRoot(), { recursive: true });
  const existingFolders = new Set(
    (await readdir(/* turbopackIgnore: true */ getSermonsRoot(), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const usedFolders = new Set(Object.values(manifest));
  const baseSlug = buildSermonFolderSlug(title);
  let folderName = baseSlug;
  if (usedFolders.has(folderName) || existingFolders.has(folderName)) {
    folderName = `${baseSlug}-${safeSermonId.slice(0, 8)}`;
  }

  manifest[safeSermonId] = folderName;
  await writeSermonFolderManifest(manifest);
  return folderName;
}

export async function unregisterSermonStorageFolder(sermonId: string): Promise<void> {
  assertLocalStorageAvailable("Local sermon storage");
  const safeSermonId = assertPathSegment(sermonId, "sermonId");
  const manifest = await readSermonFolderManifest();
  if (!manifest[safeSermonId]) {
    return;
  }

  delete manifest[safeSermonId];
  await writeSermonFolderManifest(manifest);
}

export function getLegacySermonStoragePath(sermonId: string): string {
  const safeSermonId = assertPathSegment(sermonId, "sermonId");
  return path.join(/* turbopackIgnore: true */ getSermonsRoot(), safeSermonId);
}

export function getSermonStoragePath(sermonId: string): string {
  const safeSermonId = assertPathSegment(sermonId, "sermonId");
  const manifestFolder = readSermonFolderManifestSync()[safeSermonId];
  if (manifestFolder) {
    return path.join(/* turbopackIgnore: true */ getSermonsRoot(), manifestFolder);
  }

  return getLegacySermonStoragePath(safeSermonId);
}

export function getSourceVideoPath(sermonId: string): string {
  return path.join(getSermonStoragePath(sermonId), "source", "source.mp4");
}

export function getAudioPath(sermonId: string): string {
  return path.join(getSermonStoragePath(sermonId), "audio", "audio.mp3");
}

export function getTranscriptJsonPath(sermonId: string): string {
  return path.join(getSermonStoragePath(sermonId), "transcript", "transcript.json");
}

export function getClipFolderPath(sermonId: string): string {
  return path.join(getSermonStoragePath(sermonId), "clips");
}

export function getRenderedClipFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "rendered");
}

export function getClipSubtitleFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "subtitles");
}

export function getClipExportFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "exports");
}

export function getClipThumbnailFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "thumbnails");
}

export function getClipThumbnailPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getClipThumbnailFolderPath(sermonId), `${safeClipId}.jpg`);
}

export function getClipThumbnailWebpPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getClipThumbnailFolderPath(sermonId), `${safeClipId}.webp`);
}

export function getCaptionedClipFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "captioned");
}

export function getOverlayClipFolderPath(sermonId: string): string {
  return path.join(getClipFolderPath(sermonId), "overlay");
}

export function getOverlayClipPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getOverlayClipFolderPath(sermonId), `${safeClipId}.overlay.mp4`);
}

export function getClipOutputPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getRenderedClipFolderPath(sermonId), `${safeClipId}.mp4`);
}

export function getClipSrtPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getClipSubtitleFolderPath(sermonId), `${safeClipId}.srt`);
}

export function getClipFormatExportPath(
  sermonId: string,
  clipId: string,
  format: "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1",
): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  const suffixByFormat: Record<typeof format, string> = {
    VERTICAL_9_16: "vertical-9x16",
    HORIZONTAL_16_9: "horizontal-16x9",
    SQUARE_1_1: "square-1x1",
  };

  return path.join(getClipExportFolderPath(sermonId), `${safeClipId}-${suffixByFormat[format]}.mp4`);
}

export function getClipFormatExportPathVersioned(
  sermonId: string,
  clipId: string,
  format: "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1",
  versionTag: string,
): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  const safeVersionTag = versionTag.replace(/[^A-Za-z0-9_-]/g, "").trim();
  if (!safeVersionTag) {
    throw new Error("Invalid versionTag.");
  }

  const suffixByFormat: Record<typeof format, string> = {
    VERTICAL_9_16: "vertical-9x16",
    HORIZONTAL_16_9: "horizontal-16x9",
    SQUARE_1_1: "square-1x1",
  };

  return path.join(
    getClipExportFolderPath(sermonId),
    `${safeClipId}-${suffixByFormat[format]}-${safeVersionTag}.mp4`,
  );
}

export function getCaptionedClipPath(sermonId: string, clipId: string): string {
  const safeClipId = assertPathSegment(clipId, "clipId");
  return path.join(getCaptionedClipFolderPath(sermonId), `${safeClipId}.captioned.mp4`);
}

export function getLogPath(sermonId: string): string {
  return path.join(getSermonStoragePath(sermonId), "logs", "pipeline.log");
}

function assertLocalStorageAvailable(action: string): void {
  if (!canRunLocalMediaProcessing()) {
    throw new Error(localMediaProcessingUnavailableMessage(action));
  }
}

export async function ensureSermonFolders(sermonId: string, title?: string): Promise<void> {
  assertLocalStorageAvailable("Local sermon storage");
  if (title?.trim()) {
    await registerSermonStorageFolder(sermonId, title);
  }
  const sermonRoot = getSermonStoragePath(sermonId);

  await Promise.all([
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "source"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "audio"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "transcript"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "rendered"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "subtitles"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "captioned"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "overlay"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "exports"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "clips", "thumbnails"), { recursive: true }),
    mkdir(/* turbopackIgnore: true */ path.join(sermonRoot, "logs"), { recursive: true }),
  ]);
}

export async function appendPipelineLog(sermonId: string, message: string): Promise<void> {
  if (!canRunLocalMediaProcessing()) {
    return;
  }

  await ensureSermonFolders(sermonId);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(/* turbopackIgnore: true */ getLogPath(sermonId), line, "utf8");
}

export async function ensureLocalStorageDirs(): Promise<void> {
  assertLocalStorageAvailable("Local media storage setup");
  await mkdir(/* turbopackIgnore: true */ getSermonsRoot(), { recursive: true });
}
