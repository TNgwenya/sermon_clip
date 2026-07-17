import path from "node:path";

export const PORTABLE_STORAGE_PATH_PREFIX = "sermon-storage://";

const DEFAULT_STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage");

export const PORTABLE_MEDIA_PATH_FIELDS = new Set([
  "sourceVideoPath",
  "audioPath",
  "transcriptJsonPath",
  "rawJsonPath",
  "renderedFilePath",
  "smartCropDebugSnapshotPath",
  "exportedFilePath",
  "thumbnailPath",
  "exportPath",
  "srtPath",
  "subtitleFilePath",
  "captionedVideoPath",
  "overlayVideoPath",
  "filePath",
  "churchLogoPath",
]);

export function getConfiguredStorageRoot(): string {
  const configured = process.env.SERMON_STORAGE_ROOT?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : DEFAULT_STORAGE_ROOT);
}

function portableRelativePath(value: string): string | null {
  if (!value.startsWith(PORTABLE_STORAGE_PATH_PREFIX)) {
    return null;
  }

  const relativePath = value.slice(PORTABLE_STORAGE_PATH_PREFIX.length);
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new Error(`Invalid portable sermon storage path: ${value}`);
  }

  const segments = relativePath.split(/[\\/]+/);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid portable sermon storage path: ${value}`);
  }

  return segments.join(path.sep);
}

export function toPortableStoragePath(value: string, storageRoot = getConfiguredStorageRoot()): string {
  if (value.startsWith(PORTABLE_STORAGE_PATH_PREFIX)) {
    portableRelativePath(value);
    return value;
  }

  if (!path.isAbsolute(value)) {
    return value;
  }

  const root = path.resolve(storageRoot);
  const absoluteValue = path.resolve(value);
  const relativePath = path.relative(root, absoluteValue);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return value;
  }

  return `${PORTABLE_STORAGE_PATH_PREFIX}${relativePath.split(path.sep).join("/")}`;
}

export function resolvePortableStoragePath(value: string, storageRoot = getConfiguredStorageRoot()): string {
  const relativePath = portableRelativePath(value);
  if (relativePath === null) {
    return value;
  }

  const root = path.resolve(storageRoot);
  const resolved = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolved);
  if (!relativeToRoot || relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Portable sermon storage path escapes SERMON_STORAGE_ROOT: ${value}`);
  }

  return resolved;
}

export function transformPortableMediaPathValues<T>(
  value: T,
  direction: "store" | "resolve",
  storageRoot = getConfiguredStorageRoot(),
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => transformPortableMediaPathValues(entry, direction, storageRoot)) as T;
  }

  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const transformed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PORTABLE_MEDIA_PATH_FIELDS.has(key) && typeof entry === "string") {
      transformed[key] = direction === "store"
        ? toPortableStoragePath(entry, storageRoot)
        : resolvePortableStoragePath(entry, storageRoot);
    } else {
      transformed[key] = transformPortableMediaPathValues(entry, direction, storageRoot);
    }
  }

  return transformed as T;
}
