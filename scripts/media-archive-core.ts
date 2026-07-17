import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const ARCHIVE_SCHEMA_VERSION = 1;
export const ARCHIVE_PREFIX = "archive/v1";

export type ArchiveFile = {
  path: string;
  size: number;
  sha256: string;
  objectKey: string;
};

export type ArchiveManifest = {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  generatedAt: string;
  files: ArchiveFile[];
};

export type ArchivePlan = {
  manifest: ArchiveManifest;
  manifestSha256: string;
  manifestObjectKey: string;
  uniqueBlobCount: number;
  uniqueBytes: number;
  deduplicatedBytes: number;
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function archiveBlobObjectKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Archive blob SHA-256 must be a lowercase 64-character hex digest.");
  }
  return `${ARCHIVE_PREFIX}/blobs/${sha256.slice(0, 2)}/${sha256}`;
}

export function shouldArchiveRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";

  if (!normalized || normalized.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return false;
  }
  if (
    fileName === ".DS_Store"
    || fileName === ".media-archive.lock"
    || fileName.startsWith(".archive-download-")
    || fileName.includes(".pre-archive-backup-")
  ) {
    return false;
  }
  if (normalized === "sermons/.sermon-folders.json") {
    return true;
  }
  if (segments[0] !== "sermons") {
    return segments[0] === "branding" && segments.length >= 2;
  }
  if (segments.length >= 4 && (segments[2] === "source" || segments[2] === "content-assets")) {
    return true;
  }

  if (segments.length === 4 && segments[2] === "audio" && fileName === "audio.mp3") {
    return true;
  }

  const extension = path.posix.extname(normalized).toLowerCase();
  if (segments[2] === "transcript" && extension === ".json") {
    return true;
  }
  if (segments[2] === "clips" && ["exports", "subtitles", "thumbnails"].includes(segments[3] ?? "")) {
    return true;
  }
  return false;
}

function isCanonicalArchivePath(relativePath: string): boolean {
  return relativePath === relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function resolveArchiveDestination(storageRoot: string, relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!isCanonicalArchivePath(relativePath) || !shouldArchiveRelativePath(normalized)) {
    throw new Error(`Unsafe or unsupported archive path: ${relativePath}`);
  }

  const root = path.resolve(storageRoot);
  const destination = path.resolve(root, ...normalized.split("/"));
  const relativeToRoot = path.relative(root, destination);
  if (!relativeToRoot || relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Archive path escapes the storage root: ${relativePath}`);
  }
  return destination;
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function ensureSafeArchiveDestinationParent(storageRoot: string, destination: string): Promise<void> {
  const root = path.resolve(storageRoot);
  const parent = path.dirname(path.resolve(destination));
  if (!isInsidePath(root, parent)) {
    throw new Error(`Archive destination parent escapes the storage root: ${destination}`);
  }

  const rootState = await lstat(root).catch(() => null);
  if (!rootState) {
    await mkdir(root, { recursive: true });
  } else if (!rootState.isDirectory() && !rootState.isSymbolicLink()) {
    throw new Error(`Storage root is not a directory: ${root}`);
  }
  const resolvedRoot = await realpath(root);
  if (!(await stat(resolvedRoot)).isDirectory()) {
    throw new Error(`Storage root is not a directory: ${root}`);
  }

  const relativeParent = path.relative(root, parent);
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const currentState = await lstat(current).catch(() => null);
    if (!currentState) {
      await mkdir(current);
    }
    const verifiedState = await lstat(current);
    if (verifiedState.isSymbolicLink() || !verifiedState.isDirectory()) {
      throw new Error(`Refusing to hydrate through a non-directory or symbolic link: ${current}`);
    }
    const resolvedCurrent = await realpath(current);
    if (!isInsidePath(resolvedRoot, resolvedCurrent)) {
      throw new Error(`Hydration destination resolves outside the storage root: ${destination}`);
    }
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function verifyArchiveSource(
  filePath: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  const beforeHash = await lstat(filePath).catch(() => null);
  if (!beforeHash?.isFile() || beforeHash.isSymbolicLink() || beforeHash.size !== expectedSize) {
    throw new Error(`Archive source changed before upload: ${filePath}`);
  }

  const actualSha256 = await sha256File(filePath);
  const afterHash = await lstat(filePath).catch(() => null);
  if (
    !afterHash?.isFile()
    || afterHash.isSymbolicLink()
    || afterHash.size !== beforeHash.size
    || afterHash.mtimeMs !== beforeHash.mtimeMs
    || afterHash.dev !== beforeHash.dev
    || afterHash.ino !== beforeHash.ino
  ) {
    throw new Error(`Archive source changed while verifying it for upload: ${filePath}`);
  }
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Archive source no longer matches the planned SHA-256: ${filePath}`);
  }
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function discoverArchiveFiles(storageRoot: string): Promise<Array<{
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  ino: number;
}>> {
  const root = path.resolve(storageRoot);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Storage root is not a directory: ${root}`);
  }

  const discovered = [];
  for (const absolutePath of await walkFiles(root)) {
    const relativePath = toPosixPath(path.relative(root, absolutePath));
    if (!shouldArchiveRelativePath(relativePath)) {
      continue;
    }
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 0) {
      discovered.push({
        absolutePath,
        relativePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        ino: fileStat.ino,
      });
    }
  }
  return discovered;
}

export function validateArchiveManifest(value: unknown): ArchiveManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Archive manifest must be an object.");
  }
  const candidate = value as Partial<ArchiveManifest>;
  if (candidate.schemaVersion !== ARCHIVE_SCHEMA_VERSION || typeof candidate.generatedAt !== "string" || !Array.isArray(candidate.files)) {
    throw new Error("Unsupported or malformed archive manifest.");
  }

  const files = candidate.files.map((file, index) => {
    if (!file || typeof file !== "object") {
      throw new Error(`Archive manifest file ${index} is malformed.`);
    }
    const entry = file as Partial<ArchiveFile>;
    if (
      typeof entry.path !== "string"
      || !isCanonicalArchivePath(entry.path)
      || !shouldArchiveRelativePath(entry.path)
      || typeof entry.size !== "number"
      || !Number.isSafeInteger(entry.size)
      || entry.size <= 0
      || typeof entry.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || entry.objectKey !== archiveBlobObjectKey(entry.sha256)
    ) {
      throw new Error(`Archive manifest file ${index} is invalid.`);
    }
    return entry as ArchiveFile;
  });

  const uniquePaths = new Set(files.map((file) => file.path));
  if (uniquePaths.size !== files.length) {
    throw new Error("Archive manifest contains duplicate file paths.");
  }
  const portablePaths = new Set(files.map((file) => file.path.normalize("NFC").toLocaleLowerCase("en-US")));
  if (portablePaths.size !== files.length) {
    throw new Error("Archive manifest contains paths that collide on a portable filesystem.");
  }

  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    generatedAt: candidate.generatedAt,
    files,
  };
}

export function serializeArchiveManifest(manifest: ArchiveManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function buildArchivePlan(storageRoot: string, now = new Date()): Promise<ArchivePlan & { sourceBySha256: Map<string, string> }> {
  const discovered = await discoverArchiveFiles(storageRoot);
  const files: ArchiveFile[] = [];
  const sourceBySha256 = new Map<string, string>();
  let totalBytes = 0;

  for (const file of discovered) {
    const sha256 = await sha256File(file.absolutePath);
    const afterHash = await stat(file.absolutePath);
    if (afterHash.size !== file.size || afterHash.mtimeMs !== file.mtimeMs || afterHash.ino !== file.ino) {
      throw new Error(`File changed while building the archive plan: ${file.absolutePath}`);
    }
    files.push({
      path: file.relativePath,
      size: file.size,
      sha256,
      objectKey: archiveBlobObjectKey(sha256),
    });
    sourceBySha256.set(sha256, sourceBySha256.get(sha256) ?? file.absolutePath);
    totalBytes += file.size;
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = validateArchiveManifest({
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    files,
  });
  const serialized = serializeArchiveManifest(manifest);
  const manifestSha256 = createHash("sha256").update(serialized).digest("hex");
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const uniqueBytes = Array.from(sourceBySha256.entries()).reduce((sum, [sha256, filePath]) => {
    const matching = files.find((file) => file.sha256 === sha256 && sourceBySha256.get(sha256) === filePath);
    return sum + (matching?.size ?? 0);
  }, 0);

  return {
    manifest,
    manifestSha256,
    manifestObjectKey: `${ARCHIVE_PREFIX}/manifests/${timestamp}-${manifestSha256}.json`,
    uniqueBlobCount: sourceBySha256.size,
    uniqueBytes,
    deduplicatedBytes: totalBytes - uniqueBytes,
    sourceBySha256,
  };
}
