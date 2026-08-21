import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PILOT_BACKUP_CONFIRMATION,
  PILOT_BACKUP_SCHEMA_VERSION,
  PILOT_RESTORE_CONFIRMATION,
  assertBackupConfirmation,
  assertIsolatedRestoreTarget,
  parsePostgresTarget,
  resolveBundleArtifact,
  validatePilotBackupManifest,
} from "../pilot-recovery-core";

function validManifest() {
  return {
    schemaVersion: PILOT_BACKUP_SCHEMA_VERSION,
    createdAt: "2026-08-21T10:00:00.000Z",
    database: {
      path: "database.dump",
      bytes: 2048,
      sha256: "a".repeat(64),
      format: "postgresql-custom",
    },
    mediaInventory: {
      path: "media-manifest.json",
      bytes: 1024,
      sha256: "b".repeat(64),
      format: "sermon-clip-archive-v1",
      files: 4,
      logicalBytes: 8000,
      uniqueBytes: 6000,
    },
    tools: {
      pgDump: "pg_dump (PostgreSQL) 16.13",
      pgRestore: "pg_restore (PostgreSQL) 16.13",
    },
  };
}

describe("pilot recovery guards", () => {
  it("parses PostgreSQL connection settings without putting the password in the identity", () => {
    const target = parsePostgresTarget(
      "postgresql://pilot-user:s3cret@db.example.test:5433/sermon_clip?sslmode=require&channel_binding=require",
      "DATABASE_URL",
    );

    expect(target.identity).toBe("db.example.test:5433/sermon_clip");
    expect(target.identity).not.toContain("s3cret");
    expect(target.environment).toMatchObject({
      PGHOST: "db.example.test",
      PGPORT: "5433",
      PGUSER: "pilot-user",
      PGPASSWORD: "s3cret",
      PGDATABASE: "sermon_clip",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
    });
  });

  it("requires an exact backup confirmation phrase", () => {
    expect(() => assertBackupConfirmation(undefined)).toThrow("PILOT_BACKUP_CONFIRM");
    expect(() => assertBackupConfirmation("yes")).toThrow("PILOT_BACKUP_CONFIRM");
    expect(() => assertBackupConfirmation(PILOT_BACKUP_CONFIRMATION)).not.toThrow();
  });

  it("allows only a clearly named loopback restore database in development or test", () => {
    const target = assertIsolatedRestoreTarget({
      sourceDatabaseUrl: "postgresql://user:secret@db.example.test/sermon_clip",
      restoreDatabaseUrl: "postgresql://postgres:postgres@127.0.0.1/sermon_clip_restore_drill",
      confirmation: PILOT_RESTORE_CONFIRMATION,
      nodeEnv: "test",
    });

    expect(target.databaseName).toBe("sermon_clip_restore_drill");
  });

  it.each([
    {
      name: "a remote target",
      target: "postgresql://user:secret@db.example.test/sermon_clip_restore",
      nodeEnv: "test",
      confirmation: PILOT_RESTORE_CONFIRMATION,
    },
    {
      name: "an ambiguously named target",
      target: "postgresql://postgres:postgres@localhost/sermon_clip",
      nodeEnv: "test",
      confirmation: PILOT_RESTORE_CONFIRMATION,
    },
    {
      name: "a production-like target",
      target: "postgresql://postgres:postgres@localhost/sermon_clip_production_restore",
      nodeEnv: "test",
      confirmation: PILOT_RESTORE_CONFIRMATION,
    },
    {
      name: "production NODE_ENV",
      target: "postgresql://postgres:postgres@localhost/sermon_clip_restore",
      nodeEnv: "production",
      confirmation: PILOT_RESTORE_CONFIRMATION,
    },
    {
      name: "missing confirmation",
      target: "postgresql://postgres:postgres@localhost/sermon_clip_restore",
      nodeEnv: "test",
      confirmation: undefined,
    },
  ])("rejects $name", ({ target, nodeEnv, confirmation }) => {
    expect(() => assertIsolatedRestoreTarget({
      sourceDatabaseUrl: "postgresql://user:secret@db.example.test/sermon_clip",
      restoreDatabaseUrl: target,
      confirmation,
      nodeEnv,
    })).toThrow();
  });

  it("rejects restoring over the source even when its password differs", () => {
    expect(() => assertIsolatedRestoreTarget({
      sourceDatabaseUrl: "postgresql://postgres:first@localhost/sermon_clip_test",
      restoreDatabaseUrl: "postgresql://postgres:second@localhost/sermon_clip_test",
      confirmation: PILOT_RESTORE_CONFIRMATION,
      nodeEnv: "test",
    })).toThrow("must not be the source");
  });
});

describe("pilot backup manifests", () => {
  it("accepts the versioned manifest and returns its artifact metadata", () => {
    expect(validatePilotBackupManifest(validManifest())).toMatchObject({
      database: { path: "database.dump", bytes: 2048 },
      mediaInventory: { path: "media-manifest.json", files: 4 },
    });
  });

  it.each([
    { name: "a traversal artifact", mutate: (manifest: ReturnType<typeof validManifest>) => { manifest.database.path = "../database.dump"; } },
    { name: "a malformed checksum", mutate: (manifest: ReturnType<typeof validManifest>) => { manifest.database.sha256 = "not-a-checksum"; } },
    { name: "an impossible dedupe total", mutate: (manifest: ReturnType<typeof validManifest>) => { manifest.mediaInventory.uniqueBytes = 9000; } },
    { name: "artifact path reuse", mutate: (manifest: ReturnType<typeof validManifest>) => { manifest.mediaInventory.path = manifest.database.path; } },
  ])("rejects $name", ({ mutate }) => {
    const manifest = validManifest();
    mutate(manifest);
    expect(() => validatePilotBackupManifest(manifest)).toThrow();
  });

  it("resolves bundle artifacts without allowing path escape", () => {
    const bundle = path.resolve("/var/lib/sermonclip/backups/pilot-backup-1");
    expect(resolveBundleArtifact(bundle, "database.dump")).toBe(path.join(bundle, "database.dump"));
    expect(() => resolveBundleArtifact(bundle, "../database.dump")).toThrow("escapes");
  });
});
