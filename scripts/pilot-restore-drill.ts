import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  resolveArchiveDestination,
  sha256File as sha256MediaFile,
  validateArchiveManifest,
  type ArchiveManifest,
} from "./media-archive-core.ts";
import {
  assertIsolatedRestoreTarget,
  resolveBundleArtifact,
  sha256File,
  validatePilotBackupManifest,
  type PilotBackupManifest,
} from "./pilot-recovery-core.ts";

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function childEnvironment(postgres?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]) {
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
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      stream.on("data", (chunk: Buffer) => {
        capturedBytes += chunk.length;
        if (capturedBytes <= captureLimit) {
          chunks.push(chunk);
        }
      });
    }
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
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function readBundle(bundleDirectory: string): Promise<{
  manifest: PilotBackupManifest;
  databasePath: string;
  mediaInventory: ArchiveManifest;
}> {
  const bundleState = await lstat(bundleDirectory).catch(() => null);
  if (!bundleState?.isDirectory() || bundleState.isSymbolicLink()) {
    throw new Error("The backup bundle must be a real directory, not a symbolic link.");
  }
  const manifestPath = resolveBundleArtifact(bundleDirectory, "backup-manifest.json");
  const manifestState = await lstat(manifestPath).catch(() => null);
  if (!manifestState?.isFile() || manifestState.isSymbolicLink()) {
    throw new Error("The backup bundle does not contain a safe backup-manifest.json file.");
  }
  const manifest = validatePilotBackupManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  const databasePath = resolveBundleArtifact(bundleDirectory, manifest.database.path);
  const mediaInventoryPath = resolveBundleArtifact(bundleDirectory, manifest.mediaInventory.path);
  for (const [artifactPath, artifact, label] of [
    [databasePath, manifest.database, "database backup"],
    [mediaInventoryPath, manifest.mediaInventory, "media inventory"],
  ] as const) {
    const state = await lstat(artifactPath).catch(() => null);
    if (!state?.isFile() || state.isSymbolicLink() || state.size !== artifact.bytes) {
      throw new Error(`The ${label} is missing or has an unexpected size.`);
    }
    if (await sha256File(artifactPath) !== artifact.sha256) {
      throw new Error(`The ${label} failed its SHA-256 integrity check.`);
    }
  }
  const mediaInventory = validateArchiveManifest(JSON.parse(await readFile(mediaInventoryPath, "utf8")) as unknown);
  if (mediaInventory.files.length !== manifest.mediaInventory.files) {
    throw new Error("The media inventory file count does not match the backup manifest.");
  }
  return { manifest, databasePath, mediaInventory };
}

function assertExpectedDumpContents(listing: string): void {
  for (const table of ["Organization", "Sermon", "ProcessingJob"]) {
    if (!listing.includes(`TABLE public ${table}`)) {
      throw new Error(`Database dump validation did not find the expected ${table} table.`);
    }
  }
}

async function verifyHydratedMedia(mediaRoot: string, manifest: ArchiveManifest): Promise<{
  checked: number;
  missing: number;
  mismatched: number;
}> {
  const root = path.resolve(mediaRoot);
  const rootState = await lstat(root).catch(() => null);
  if (!rootState?.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error("PILOT_RESTORE_MEDIA_ROOT must be a real isolated directory.");
  }
  let missing = 0;
  let mismatched = 0;
  for (const file of manifest.files) {
    const filePath = resolveArchiveDestination(root, file.path);
    const state = await lstat(filePath).catch(() => null);
    if (!state?.isFile() || state.isSymbolicLink()) {
      missing += 1;
      continue;
    }
    if (state.size !== file.size || await sha256MediaFile(filePath) !== file.sha256) {
      mismatched += 1;
    }
  }
  return { checked: manifest.files.length, missing, mismatched };
}

async function query(targetEnvironment: NodeJS.ProcessEnv, sql: string): Promise<string> {
  return (await runCommand({
    command: "psql",
    args: ["--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", `--command=${sql}`],
    environment: targetEnvironment,
  })).trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((argument) => argument !== "--apply");
  if (positional.length !== 1) {
    throw new Error("Usage: node --experimental-strip-types scripts/pilot-restore-drill.ts /absolute/path/to/backup-bundle [--apply]");
  }
  const bundleDirectory = path.resolve(positional[0]!);
  const { manifest, databasePath, mediaInventory } = await readBundle(bundleDirectory);
  const listing = await runCommand({ command: "pg_restore", args: ["--list", databasePath] });
  assertExpectedDumpContents(listing);
  const mediaRoot = process.env.PILOT_RESTORE_MEDIA_ROOT?.trim();

  if (!apply) {
    print({
      command: "pilot-restore-drill",
      mode: "dry-run",
      bundleDirectory,
      createdAt: manifest.createdAt,
      databaseBytes: manifest.database.bytes,
      databaseSha256: manifest.database.sha256,
      mediaFiles: mediaInventory.files.length,
      mediaInventorySha256: manifest.mediaInventory.sha256,
      mediaVerificationRoot: mediaRoot || null,
      bundleIntegrity: "ok",
      databaseModified: false,
      mediaModified: false,
      nextStep: "Create an empty loopback restore database, set the guarded restore variables, then re-run with --apply.",
    });
    return;
  }

  const target = assertIsolatedRestoreTarget({
    sourceDatabaseUrl: process.env.DATABASE_URL,
    restoreDatabaseUrl: process.env.PILOT_RESTORE_DATABASE_URL,
    confirmation: process.env.PILOT_RESTORE_CONFIRM,
    nodeEnv: process.env.NODE_ENV,
  });
  const tableCount = Number(await query(target.environment, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';"));
  if (!Number.isSafeInteger(tableCount) || tableCount !== 0) {
    throw new Error(`The isolated restore target is not empty (${tableCount} public tables). Create a fresh database; this drill will not clean or overwrite it.`);
  }

  await runCommand({
    command: "pg_restore",
    args: [
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      target.databaseName,
      databasePath,
    ],
    environment: target.environment,
  });
  const restoredCountsText = await query(target.environment, `
    SELECT json_build_object(
      'organizations', (SELECT count(*) FROM "Organization"),
      'sermons', (SELECT count(*) FROM "Sermon"),
      'processingJobs', (SELECT count(*) FROM "ProcessingJob")
    );
  `);
  const restoredCounts = JSON.parse(restoredCountsText) as Record<string, number | null>;
  const hasMigrationTable = await query(
    target.environment,
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL;`,
  ) === "t";
  restoredCounts.migrations = hasMigrationTable
    ? Number(await query(target.environment, `SELECT count(*) FROM "_prisma_migrations";`))
    : null;

  let mediaVerification: { checked: number; missing: number; mismatched: number } | null = null;
  if (mediaRoot) {
    mediaVerification = await verifyHydratedMedia(mediaRoot, mediaInventory);
    if (mediaVerification.missing > 0 || mediaVerification.mismatched > 0) {
      throw new Error(`Hydrated media verification failed: ${mediaVerification.missing} missing, ${mediaVerification.mismatched} mismatched.`);
    }
  }

  print({
    command: "pilot-restore-drill",
    mode: "applied-to-isolated-target",
    target: `${target.hostname}:${target.port}/${target.databaseName}`,
    restoredCounts,
    mediaVerification,
    sourceDatabaseModified: false,
    sourceMediaModified: false,
    status: mediaVerification ? "database-and-media-ok" : "database-ok-media-not-exercised",
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
