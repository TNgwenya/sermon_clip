import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

export const PILOT_BACKUP_SCHEMA_VERSION = 1;
export const PILOT_BACKUP_CONFIRMATION = "CREATE READ ONLY PILOT BACKUP";
export const PILOT_RESTORE_CONFIRMATION = "RESTORE INTO ISOLATED EMPTY DATABASE";

export type BackupArtifact = {
  path: string;
  bytes: number;
  sha256: string;
};

export type PilotBackupManifest = {
  schemaVersion: typeof PILOT_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  database: BackupArtifact & { format: "postgresql-custom" };
  mediaInventory: BackupArtifact & {
    format: "sermon-clip-archive-v1";
    files: number;
    logicalBytes: number;
    uniqueBytes: number;
  };
  tools: {
    pgDump: string;
    pgRestore: string;
  };
};

export type PostgresTarget = {
  databaseName: string;
  hostname: string;
  port: string;
  environment: NodeJS.ProcessEnv;
  identity: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requiredUrlPart(value: string, label: string): string {
  if (!value) {
    throw new Error(`PostgreSQL ${label} is required.`);
  }
  return value;
}

export function parsePostgresTarget(value: string | undefined, label: string): PostgresTarget {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(`${label} must use the postgresql:// protocol.`);
  }

  const hostname = requiredUrlPart(parsed.hostname, "hostname");
  const databaseName = requiredUrlPart(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "database name");
  const username = requiredUrlPart(decodeURIComponent(parsed.username), "username");
  const port = parsed.port || "5432";
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PGHOST: hostname,
    PGPORT: port,
    PGUSER: username,
    PGDATABASE: databaseName,
  };
  if (parsed.password) {
    environment.PGPASSWORD = decodeURIComponent(parsed.password);
  }

  const supportedParameters: Record<string, string> = {
    sslmode: "PGSSLMODE",
    channel_binding: "PGCHANNELBINDING",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
    options: "PGOPTIONS",
  };
  for (const [name, environmentName] of Object.entries(supportedParameters)) {
    const parameter = parsed.searchParams.get(name);
    if (parameter) {
      environment[environmentName] = parameter;
    }
  }

  return {
    databaseName,
    hostname,
    port,
    environment,
    identity: `${hostname.toLowerCase()}:${port}/${databaseName}`,
  };
}

export function assertBackupConfirmation(value: string | undefined): void {
  if (value !== PILOT_BACKUP_CONFIRMATION) {
    throw new Error(`PILOT_BACKUP_CONFIRM must equal \"${PILOT_BACKUP_CONFIRMATION}\".`);
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());
}

export function assertIsolatedRestoreTarget(input: {
  sourceDatabaseUrl?: string;
  restoreDatabaseUrl?: string;
  confirmation?: string;
  nodeEnv?: string;
}): PostgresTarget {
  if (input.confirmation !== PILOT_RESTORE_CONFIRMATION) {
    throw new Error(`PILOT_RESTORE_CONFIRM must equal \"${PILOT_RESTORE_CONFIRMATION}\".`);
  }
  if (!new Set(["development", "test"]).has(input.nodeEnv ?? "")) {
    throw new Error("The restore drill requires NODE_ENV=development or NODE_ENV=test.");
  }

  const target = parsePostgresTarget(input.restoreDatabaseUrl, "PILOT_RESTORE_DATABASE_URL");
  if (!isLoopbackHost(target.hostname)) {
    throw new Error("The restore drill target must use localhost or a loopback address.");
  }
  if (!/(restore|drill|test)/i.test(target.databaseName) || /(prod(uction)?|live|main)/i.test(target.databaseName)) {
    throw new Error("The restore drill database name must contain restore, drill, or test and must not look production-like.");
  }

  if (input.sourceDatabaseUrl?.trim()) {
    const source = parsePostgresTarget(input.sourceDatabaseUrl, "DATABASE_URL");
    if (source.identity === target.identity) {
      throw new Error("The restore drill target must not be the source database.");
    }
  }
  return target;
}

function validateArtifact(value: unknown, label: string): BackupArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  const artifact = value as Partial<BackupArtifact>;
  if (
    typeof artifact.path !== "string"
    || path.posix.basename(artifact.path) !== artifact.path
    || artifact.path === "."
    || artifact.path === ".."
    || typeof artifact.bytes !== "number"
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes <= 0
    || typeof artifact.sha256 !== "string"
    || !SHA256_PATTERN.test(artifact.sha256)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return artifact as BackupArtifact;
}

export function validatePilotBackupManifest(value: unknown): PilotBackupManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pilot backup manifest must be an object.");
  }
  const candidate = value as Partial<PilotBackupManifest>;
  if (
    candidate.schemaVersion !== PILOT_BACKUP_SCHEMA_VERSION
    || typeof candidate.createdAt !== "string"
    || Number.isNaN(Date.parse(candidate.createdAt))
    || !candidate.tools
    || typeof candidate.tools.pgDump !== "string"
    || typeof candidate.tools.pgRestore !== "string"
  ) {
    throw new Error("Pilot backup manifest is unsupported or malformed.");
  }
  const database = validateArtifact(candidate.database, "Database backup") as PilotBackupManifest["database"];
  if (database.format !== "postgresql-custom") {
    throw new Error("Database backup format is unsupported.");
  }
  const mediaInventory = validateArtifact(candidate.mediaInventory, "Media inventory") as PilotBackupManifest["mediaInventory"];
  if (
    mediaInventory.format !== "sermon-clip-archive-v1"
    || !Number.isSafeInteger(mediaInventory.files)
    || mediaInventory.files < 0
    || !Number.isSafeInteger(mediaInventory.logicalBytes)
    || mediaInventory.logicalBytes < 0
    || !Number.isSafeInteger(mediaInventory.uniqueBytes)
    || mediaInventory.uniqueBytes < 0
    || mediaInventory.uniqueBytes > mediaInventory.logicalBytes
  ) {
    throw new Error("Media inventory metadata is invalid.");
  }
  if (database.path === mediaInventory.path) {
    throw new Error("Pilot backup artifacts must use distinct paths.");
  }
  return {
    schemaVersion: PILOT_BACKUP_SCHEMA_VERSION,
    createdAt: candidate.createdAt,
    database,
    mediaInventory,
    tools: candidate.tools,
  };
}

export function resolveBundleArtifact(bundleDirectory: string, artifactPath: string): string {
  const root = path.resolve(bundleDirectory);
  const candidate = path.resolve(root, artifactPath);
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Backup artifact escapes its bundle: ${artifactPath}`);
  }
  return candidate;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
