import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, open, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

import {
  ARCHIVE_PREFIX,
  archiveBlobObjectKey,
  buildArchivePlan,
  ensureSafeArchiveDestinationParent,
  resolveArchiveDestination,
  serializeArchiveManifest,
  sha256File,
  validateArchiveManifest,
  verifyArchiveSource,
  type ArchiveManifest,
} from "./media-archive-core.ts";
import { getConfiguredStorageRoot } from "../src/server/media/portableStoragePath.ts";

const DEFAULT_ARCHIVE_BUCKET = "sermon-clip-private-archive";
const MULTIPART_THRESHOLD_BYTES = 128 * 1024 * 1024;
const MULTIPART_PART_BYTES = 32 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 2;
const HYDRATION_FREE_SPACE_RESERVE_BYTES = 2 * 1024 ** 3;

type Command = "plan" | "upload" | "hydrate" | "verify";

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requiredEnv(name: string): string {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required for the private media archive.`);
  }
  return value;
}

function requiredAccountId(): string {
  const value = requiredEnv("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error("R2_ACCOUNT_ID must be the 32-character Cloudflare Account ID.");
  }
  return value;
}

function archiveBucket(): string {
  return envValue("R2_ARCHIVE_BUCKET") ?? DEFAULT_ARCHIVE_BUCKET;
}

function archiveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = envValue("R2_ARCHIVE_ACCESS_KEY_ID") ?? requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = envValue("R2_ARCHIVE_SECRET_ACCESS_KEY") ?? requiredEnv("R2_SECRET_ACCESS_KEY");
  if (accessKeyId.length !== 32) {
    throw new Error("The R2 archive access key ID must be 32 characters.");
  }
  return { accessKeyId, secretAccessKey };
}

function createArchiveClient(): S3Client {
  const accountId = requiredAccountId();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: archiveCredentials(),
  });
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === "NotFound" || candidate.name === "NoSuchKey";
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function gibibytes(bytes: number): number {
  return Number((bytes / 1024 ** 3).toFixed(3));
}

async function headBlob(client: S3Client, sha256: string, expectedSize: number): Promise<boolean> {
  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: archiveBucket(),
      Key: archiveBlobObjectKey(sha256),
    }));
    if (response.ContentLength !== expectedSize) {
      throw new Error(`Remote archive blob ${sha256} has an unexpected size.`);
    }
    if (response.Metadata?.sha256 !== sha256) {
      throw new Error(`Remote archive blob ${sha256} is missing matching SHA-256 metadata.`);
    }
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function uploadMultipartFile(input: {
  client: S3Client;
  filePath: string;
  objectKey: string;
  size: number;
  sha256: string;
}): Promise<void> {
  const created = await input.client.send(new CreateMultipartUploadCommand({
    Bucket: archiveBucket(),
    Key: input.objectKey,
    ContentType: "application/octet-stream",
    Metadata: { sha256: input.sha256 },
  }));
  if (!created.UploadId) {
    throw new Error(`R2 did not return a multipart upload ID for ${input.objectKey}.`);
  }

  const uploadId = created.UploadId;
  let file: Awaited<ReturnType<typeof open>> | null = null;
  const completedParts: Array<{ ETag: string; PartNumber: number }> = [];
  const streamedHash = createHash("sha256");
  try {
    const openedFile = await open(input.filePath, "r");
    file = openedFile;
    const partCount = Math.ceil(input.size / MULTIPART_PART_BYTES);
    for (let batchStart = 0; batchStart < partCount; batchStart += MULTIPART_CONCURRENCY) {
      const partNumbers = Array.from(
        { length: Math.min(MULTIPART_CONCURRENCY, partCount - batchStart) },
        (_, index) => batchStart + index + 1,
      );
      const pendingUploads: Array<Promise<{ ETag: string; PartNumber: number }>> = [];
      for (const partNumber of partNumbers) {
        const position = (partNumber - 1) * MULTIPART_PART_BYTES;
        const length = Math.min(MULTIPART_PART_BYTES, input.size - position);
        const buffer = Buffer.allocUnsafe(length);
        let bytesRead = 0;
        while (bytesRead < length) {
          const result = await openedFile.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
          if (result.bytesRead === 0) {
            throw new Error(`Short read while archiving ${input.filePath}.`);
          }
          bytesRead += result.bytesRead;
        }
        streamedHash.update(buffer);
        const expectedETag = createHash("md5").update(buffer).digest("hex");
        const pendingUpload = input.client.send(new UploadPartCommand({
          Bucket: archiveBucket(),
          Key: input.objectKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buffer,
          ContentLength: length,
        })).then((response) => {
          const actualETag = response.ETag?.replaceAll('"', "").toLowerCase();
          if (!response.ETag || actualETag !== expectedETag) {
            throw new Error(`R2 returned an invalid ETag for part ${partNumber} of ${input.objectKey}.`);
          }
          return { ETag: response.ETag, PartNumber: partNumber };
        });
        pendingUploads.push(pendingUpload);
      }
      let uploaded: Array<{ ETag: string; PartNumber: number }>;
      try {
        uploaded = await Promise.all(pendingUploads);
      } catch (error) {
        await Promise.allSettled(pendingUploads);
        throw error;
      }
      completedParts.push(...uploaded);
      console.log(`[archive] uploaded ${input.objectKey}: ${completedParts.length}/${partCount} parts`);
    }

    if (streamedHash.digest("hex") !== input.sha256) {
      throw new Error(`Archive source changed while uploading ${input.filePath}.`);
    }

    await input.client.send(new CompleteMultipartUploadCommand({
      Bucket: archiveBucket(),
      Key: input.objectKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: completedParts.sort((left, right) => left.PartNumber - right.PartNumber) },
    }));
  } catch (error) {
    await input.client.send(new AbortMultipartUploadCommand({
      Bucket: archiveBucket(),
      Key: input.objectKey,
      UploadId: uploadId,
    })).catch(() => undefined);
    throw error;
  } finally {
    await file?.close();
  }
}

async function uploadBlob(input: {
  client: S3Client;
  filePath: string;
  sha256: string;
  size: number;
}): Promise<void> {
  const objectKey = archiveBlobObjectKey(input.sha256);
  if (input.size >= MULTIPART_THRESHOLD_BYTES) {
    await uploadMultipartFile({ ...input, objectKey });
    return;
  }

  const streamedHash = createHash("sha256");
  const body = Readable.from((async function* () {
    for await (const chunk of createReadStream(input.filePath)) {
      streamedHash.update(chunk);
      yield chunk;
    }
  })(), { objectMode: false });
  try {
    await input.client.send(new PutObjectCommand({
      Bucket: archiveBucket(),
      Key: objectKey,
      Body: body,
      ContentLength: input.size,
      ContentType: "application/octet-stream",
      Metadata: { sha256: input.sha256 },
      ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
      IfNoneMatch: "*",
    }));
    if (streamedHash.digest("hex") !== input.sha256) {
      await input.client.send(new DeleteObjectCommand({
        Bucket: archiveBucket(),
        Key: objectKey,
      }));
      throw new Error(`Archive source changed while uploading ${input.filePath}.`);
    }
  } catch (error) {
    const status = error && typeof error === "object"
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : null;
    if (status !== 412 || !(await headBlob(input.client, input.sha256, input.size))) {
      throw error;
    }
  }
}

async function fetchLatestManifest(client: S3Client): Promise<ArchiveManifest> {
  const response = await client.send(new GetObjectCommand({
    Bucket: archiveBucket(),
    Key: `${ARCHIVE_PREFIX}/latest.json`,
  }));
  if (!response.Body) {
    throw new Error("The latest R2 archive manifest is empty.");
  }
  const text = await response.Body.transformToString("utf-8");
  const actualSha256 = createHash("sha256").update(text).digest("hex");
  if (response.Metadata?.sha256 !== actualSha256) {
    throw new Error("The latest R2 archive manifest failed its SHA-256 integrity check.");
  }
  return validateArchiveManifest(JSON.parse(text) as unknown);
}

function bodyAsReadable(body: GetObjectCommandOutput["Body"]): Readable {
  if (body instanceof Readable) {
    return body;
  }
  throw new Error("R2 returned an unsupported download stream.");
}

async function syncPath(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function downloadArchiveFile(input: {
  client: S3Client;
  storageRoot: string;
  file: ArchiveManifest["files"][number];
  overwrite: boolean;
}): Promise<void> {
  const destination = resolveArchiveDestination(input.storageRoot, input.file.path);
  await ensureSafeArchiveDestinationParent(input.storageRoot, destination);
  const existing = await lstat(destination).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to hydrate through a symbolic link: ${destination}`);
  }
  if (existing?.isFile()) {
    const existingHash = existing.size === input.file.size ? await sha256File(destination) : null;
    if (existingHash === input.file.sha256) {
      console.log(`[archive] already hydrated: ${input.file.path}`);
      return;
    }
    if (!input.overwrite) {
      throw new Error(`Refusing to overwrite a different local file: ${destination}. Re-run with --overwrite only after review.`);
    }
  }

  const temporary = path.join(path.dirname(destination), `.archive-download-${process.pid}-${path.basename(destination)}`);
  await rm(temporary, { force: true });
  try {
    const response = await input.client.send(new GetObjectCommand({
      Bucket: archiveBucket(),
      Key: input.file.objectKey,
    }));
    if (!response.Body || response.ContentLength !== input.file.size) {
      throw new Error(`Remote archive blob has the wrong size: ${input.file.objectKey}`);
    }
    await pipeline(bodyAsReadable(response.Body), createWriteStream(temporary, { flags: "wx" }));
    const downloadedHash = await sha256File(temporary);
    if (downloadedHash !== input.file.sha256) {
      throw new Error(`SHA-256 mismatch while hydrating ${input.file.path}.`);
    }
    await syncPath(temporary);
    let backup: string | null = null;
    if (existing?.isFile()) {
      backup = `${destination}.pre-archive-backup-${Date.now()}-${process.pid}`;
      await link(destination, backup);
      await syncPath(path.dirname(destination));
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (backup) {
        const destinationStillExists = await lstat(destination).catch(() => null);
        if (destinationStillExists) {
          await rm(backup, { force: true }).catch(() => undefined);
        } else {
          await rename(backup, destination).catch(() => undefined);
        }
      }
      throw error;
    }
    await syncPath(path.dirname(destination));
    console.log(`[archive] hydrated: ${input.file.path}`);
    if (backup) {
      console.log(`[archive] preserved previous file: ${backup}`);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function commandPlan(storageRoot: string): Promise<void> {
  const plan = await buildArchivePlan(storageRoot);
  print({
    command: "plan",
    storageRoot,
    files: plan.manifest.files.length,
    uniqueBlobs: plan.uniqueBlobCount,
    logicalGiB: gibibytes(plan.uniqueBytes + plan.deduplicatedBytes),
    uniqueGiB: gibibytes(plan.uniqueBytes),
    deduplicatedGiB: gibibytes(plan.deduplicatedBytes),
    filesModified: false,
    remoteObjectsModified: false,
  });
}

async function commandUpload(storageRoot: string, apply: boolean): Promise<void> {
  const plan = await buildArchivePlan(storageRoot);
  if (!apply) {
    print({
      command: "upload",
      mode: "dry-run",
      bucket: archiveBucket(),
      files: plan.manifest.files.length,
      uniqueBlobs: plan.uniqueBlobCount,
      uniqueGiB: gibibytes(plan.uniqueBytes),
      nextCommand: "Re-run with --apply to upload missing blobs and publish the manifest.",
    });
    return;
  }

  const lockPath = path.join(storageRoot, ".media-archive.lock");
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new Error(`Another archive upload appears to be running: ${lockPath}`);
    }
    throw error;
  });
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    const client = createArchiveClient();
    let uploaded = 0;
    let reused = 0;
    for (const [sha256, filePath] of plan.sourceBySha256) {
      const file = plan.manifest.files.find((entry) => entry.sha256 === sha256);
      if (!file) {
        throw new Error(`Archive plan lost source metadata for ${sha256}.`);
      }
      if (await headBlob(client, sha256, file.size)) {
        reused += 1;
        console.log(`[archive] reused: ${file.objectKey}`);
        continue;
      }
      await verifyArchiveSource(filePath, file.size, sha256);
      await uploadBlob({ client, filePath, sha256, size: file.size });
      if (!(await headBlob(client, sha256, file.size))) {
        throw new Error(`Uploaded archive blob could not be verified: ${file.objectKey}`);
      }
      uploaded += 1;
      console.log(`[archive] verified: ${file.objectKey}`);
    }

    const body = serializeArchiveManifest(plan.manifest);
    for (const key of [plan.manifestObjectKey, `${ARCHIVE_PREFIX}/latest.json`]) {
      await client.send(new PutObjectCommand({
        Bucket: archiveBucket(),
        Key: key,
        Body: body,
        ContentLength: Buffer.byteLength(body),
        ContentType: "application/json",
        Metadata: { sha256: plan.manifestSha256 },
      }));
    }
    print({
      command: "upload",
      mode: "applied",
      bucket: archiveBucket(),
      uploadedBlobs: uploaded,
      reusedBlobs: reused,
      manifestObjectKey: plan.manifestObjectKey,
      manifestSha256: plan.manifestSha256,
      localFilesModified: false,
    });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function commandVerify(): Promise<void> {
  const client = createArchiveClient();
  const manifest = await fetchLatestManifest(client);
  const unique = new Map(manifest.files.map((file) => [file.sha256, file]));
  let verifiedBytes = 0;
  for (const file of unique.values()) {
    if (!(await headBlob(client, file.sha256, file.size))) {
      throw new Error(`Archive blob is missing: ${file.objectKey}`);
    }
    verifiedBytes += file.size;
  }
  print({
    command: "verify",
    bucket: archiveBucket(),
    generatedAt: manifest.generatedAt,
    files: manifest.files.length,
    uniqueBlobs: unique.size,
    verifiedGiB: gibibytes(verifiedBytes),
    status: "ok",
  });
}

async function commandHydrate(storageRoot: string, apply: boolean, overwrite: boolean): Promise<void> {
  const client = createArchiveClient();
  const manifest = await fetchLatestManifest(client);
  let missing = 0;
  let missingBytes = 0;
  let current = 0;
  let conflicts = 0;
  let conflictBytes = 0;
  for (const file of manifest.files) {
    const destination = resolveArchiveDestination(storageRoot, file.path);
    const existing = await lstat(destination).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new Error(`Refusing to hydrate through a symbolic link: ${destination}`);
    }
    if (!existing?.isFile()) {
      missing += 1;
      missingBytes += file.size;
    } else if (existing.size === file.size && await sha256File(destination) === file.sha256) {
      current += 1;
    } else {
      conflicts += 1;
      conflictBytes += file.size;
    }
  }
  let spaceProbe = path.resolve(storageRoot);
  while (!(await stat(spaceProbe).catch(() => null)) && path.dirname(spaceProbe) !== spaceProbe) {
    spaceProbe = path.dirname(spaceProbe);
  }
  const filesystem = await statfs(spaceProbe);
  const availableBytes = filesystem.bavail * filesystem.bsize;
  const requiredBytes = missingBytes + (overwrite ? conflictBytes : 0) + HYDRATION_FREE_SPACE_RESERVE_BYTES;

  if (!apply) {
    print({
      command: "hydrate",
      mode: "dry-run",
      storageRoot,
      generatedAt: manifest.generatedAt,
      files: manifest.files.length,
      current,
      missing,
      conflicts,
      missingGiB: gibibytes(missingBytes),
      requiredWithReserveGiB: gibibytes(requiredBytes),
      availableGiB: gibibytes(availableBytes),
      diskSpaceReady: availableBytes >= requiredBytes,
      nextCommand: conflicts > 0
        ? "Review conflicts before using --apply --overwrite."
        : "Re-run with --apply to download missing files.",
    });
    return;
  }

  if (availableBytes < requiredBytes) {
    throw new Error(`Insufficient disk space to hydrate the archive. Need ${gibibytes(requiredBytes)} GiB including reserve; ${gibibytes(availableBytes)} GiB is available.`);
  }
  if (conflicts > 0 && !overwrite) {
    throw new Error(`Refusing to hydrate because ${conflicts} local files differ from the archive. Review them before using --overwrite.`);
  }

  for (const file of manifest.files) {
    await downloadArchiveFile({ client, storageRoot, file, overwrite });
  }
  print({ command: "hydrate", mode: "applied", storageRoot, files: manifest.files.length, status: "ok" });
}

function parseCommand(): Command {
  const command = process.argv[2];
  if (command === "plan" || command === "upload" || command === "hydrate" || command === "verify") {
    return command;
  }
  throw new Error("Usage: npm run storage:archive -- <plan|upload|hydrate|verify> [--apply] [--overwrite]");
}

async function main(): Promise<void> {
  const command = parseCommand();
  const storageRoot = getConfiguredStorageRoot();
  const apply = process.argv.includes("--apply");
  const overwrite = process.argv.includes("--overwrite");

  if (overwrite && (!apply || command !== "hydrate")) {
    throw new Error("--overwrite is only valid with hydrate --apply.");
  }
  if (command === "plan") {
    await commandPlan(storageRoot);
  } else if (command === "upload") {
    await commandUpload(storageRoot, apply);
  } else if (command === "verify") {
    await commandVerify();
  } else {
    await commandHydrate(storageRoot, apply, overwrite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
