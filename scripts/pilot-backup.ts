import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildArchivePlan, serializeArchiveManifest } from "./media-archive-core.ts";
import {
  PILOT_BACKUP_SCHEMA_VERSION,
  assertBackupConfirmation,
  parsePostgresTarget,
  sha256File,
  validatePilotBackupManifest,
  type PilotBackupManifest,
} from "./pilot-recovery-core.ts";
import { getConfiguredStorageRoot } from "../src/server/media/portableStoragePath.ts";

const DATABASE_ARTIFACT = "database.dump";
const MEDIA_INVENTORY_ARTIFACT = "media-manifest.json";
const BUNDLE_MANIFEST = "backup-manifest.json";

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function backupRoot(): string {
  const configured = process.env.PILOT_BACKUP_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("PILOT_BACKUP_ROOT must be an explicit absolute path outside the media storage root.");
  }
  const root = path.resolve(configured);
  const mediaRoot = getConfiguredStorageRoot();
  const relativeToMedia = path.relative(mediaRoot, root);
  if (!relativeToMedia || (!relativeToMedia.startsWith(`..${path.sep}`) && relativeToMedia !== ".." && !path.isAbsolute(relativeToMedia))) {
    throw new Error("PILOT_BACKUP_ROOT must not be inside SERMON_STORAGE_ROOT.");
  }
  if (root === path.parse(root).root) {
    throw new Error("PILOT_BACKUP_ROOT cannot be a filesystem root.");
  }
  return root;
}

function childEnvironment(postgres?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"];
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const name of allowed) {
    if (process.env[name]) {
      environment[name] = process.env[name];
    }
  }
  return { ...environment, ...postgres, NODE_ENV: process.env.NODE_ENV ?? "production" };
}

async function runCommand(input: {
  command: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
  capture?: boolean;
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: childEnvironment(input.environment),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    const captureLimit = 16 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= captureLimit) {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= captureLimit) {
        stderr.push(chunk);
      }
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`${input.command} exited with code ${code ?? "unknown"}${errorText ? `: ${errorText}` : ""}`));
        return;
      }
      if (capturedBytes > captureLimit) {
        reject(new Error(`${input.command} produced more validation output than expected.`));
        return;
      }
      resolve(input.capture === false ? "" : Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function toolVersion(command: "pg_dump" | "pg_restore"): Promise<string> {
  return (await runCommand({ command, args: ["--version"] })).trim();
}

function assertExpectedDumpContents(listing: string): void {
  for (const table of ["Organization", "Sermon", "ProcessingJob"]) {
    if (!listing.includes(`TABLE public ${table}`)) {
      throw new Error(`Database dump validation did not find the expected ${table} table.`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--apply")) {
    throw new Error("Usage: node --experimental-strip-types scripts/pilot-backup.ts [--apply]");
  }
  const apply = args.includes("--apply");
  const root = backupRoot();
  const source = parsePostgresTarget(process.env.DATABASE_URL, "DATABASE_URL");
  const storageRoot = getConfiguredStorageRoot();
  const [pgDumpVersion, pgRestoreVersion, archivePlan] = await Promise.all([
    toolVersion("pg_dump"),
    toolVersion("pg_restore"),
    buildArchivePlan(storageRoot),
  ]);

  if (!apply) {
    print({
      command: "pilot-backup",
      mode: "dry-run",
      database: `${source.hostname}:${source.port}/${source.databaseName}`,
      backupRoot: root,
      storageRoot,
      mediaFiles: archivePlan.manifest.files.length,
      mediaLogicalBytes: archivePlan.uniqueBytes + archivePlan.deduplicatedBytes,
      mediaUniqueBytes: archivePlan.uniqueBytes,
      tools: { pgDump: pgDumpVersion, pgRestore: pgRestoreVersion },
      filesModified: false,
      databaseModified: false,
      nextStep: "Set PILOT_BACKUP_CONFIRM and re-run with --apply to create a local recovery bundle.",
    });
    return;
  }
  assertBackupConfirmation(process.env.PILOT_BACKUP_CONFIRM);

  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootState = await lstat(root);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error("PILOT_BACKUP_ROOT must be a real directory, not a symbolic link.");
  }
  const lockPath = path.join(root, ".pilot-backup.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new Error(`Another pilot backup appears to be running: ${lockPath}`);
    }
    throw error;
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const temporaryDirectory = path.join(root, `.pilot-backup-${timestamp}-${process.pid}.partial`);
  const finalDirectory = path.join(root, `pilot-backup-${timestamp}`);
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    await mkdir(temporaryDirectory, { mode: 0o700 });
    const databasePath = path.join(temporaryDirectory, DATABASE_ARTIFACT);
    await runCommand({
      command: "pg_dump",
      args: [
        "--format=custom",
        "--compress=6",
        "--no-owner",
        "--no-acl",
        `--file=${databasePath}`,
      ],
      environment: source.environment,
      capture: false,
    });
    await chmod(databasePath, 0o600);
    const listing = await runCommand({ command: "pg_restore", args: ["--list", databasePath] });
    assertExpectedDumpContents(listing);

    const mediaInventoryPath = path.join(temporaryDirectory, MEDIA_INVENTORY_ARTIFACT);
    await writeFile(mediaInventoryPath, serializeArchiveManifest(archivePlan.manifest), { encoding: "utf8", mode: 0o600 });
    const [databaseState, mediaInventoryState, databaseSha256, mediaInventorySha256] = await Promise.all([
      stat(databasePath),
      stat(mediaInventoryPath),
      sha256File(databasePath),
      sha256File(mediaInventoryPath),
    ]);
    const manifest: PilotBackupManifest = validatePilotBackupManifest({
      schemaVersion: PILOT_BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      database: {
        path: DATABASE_ARTIFACT,
        bytes: databaseState.size,
        sha256: databaseSha256,
        format: "postgresql-custom",
      },
      mediaInventory: {
        path: MEDIA_INVENTORY_ARTIFACT,
        bytes: mediaInventoryState.size,
        sha256: mediaInventorySha256,
        format: "sermon-clip-archive-v1",
        files: archivePlan.manifest.files.length,
        logicalBytes: archivePlan.uniqueBytes + archivePlan.deduplicatedBytes,
        uniqueBytes: archivePlan.uniqueBytes,
      },
      tools: { pgDump: pgDumpVersion, pgRestore: pgRestoreVersion },
    });
    await writeFile(path.join(temporaryDirectory, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryDirectory, finalDirectory);

    const persisted = validatePilotBackupManifest(JSON.parse(await readFile(path.join(finalDirectory, BUNDLE_MANIFEST), "utf8")) as unknown);
    print({
      command: "pilot-backup",
      mode: "applied",
      bundleDirectory: finalDirectory,
      createdAt: persisted.createdAt,
      databaseBytes: persisted.database.bytes,
      databaseSha256: persisted.database.sha256,
      mediaFiles: persisted.mediaInventory.files,
      mediaLogicalBytes: persisted.mediaInventory.logicalBytes,
      mediaInventorySha256: persisted.mediaInventory.sha256,
      databaseModified: false,
      sourceMediaModified: false,
      status: "ok",
    });
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
