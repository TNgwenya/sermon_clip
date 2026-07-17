import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

import {
  isRetryableDatabaseConnectionError,
  withDatabaseConnectionRetry,
} from "./prisma-deploy-retry.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const BASELINE_MARKER_TABLE = '"_sermon_clip_baseline_state"';
const DEFAULT_DATABASE_RETRY_MAX_ATTEMPTS = 4;
const DEFAULT_DATABASE_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_DATABASE_RETRY_MAX_DELAY_MS = 8_000;

function integerEnvironmentValue(name, fallback, { minimum, maximum }) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return parsedValue;
}

function databaseRetryOptions() {
  return {
    maxAttempts: integerEnvironmentValue(
      "PRISMA_DEPLOY_MAX_ATTEMPTS",
      DEFAULT_DATABASE_RETRY_MAX_ATTEMPTS,
      { minimum: 1, maximum: 10 },
    ),
    baseDelayMs: integerEnvironmentValue(
      "PRISMA_DEPLOY_RETRY_BASE_DELAY_MS",
      DEFAULT_DATABASE_RETRY_BASE_DELAY_MS,
      { minimum: 0, maximum: 60_000 },
    ),
    maxDelayMs: integerEnvironmentValue(
      "PRISMA_DEPLOY_RETRY_MAX_DELAY_MS",
      DEFAULT_DATABASE_RETRY_MAX_DELAY_MS,
      { minimum: 0, maximum: 60_000 },
    ),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function databaseMigrationState() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      to_regclass('public."_prisma_migrations"') IS NOT NULL AS "hasMigrationTable",
      to_regclass('public."Sermon"') IS NOT NULL AS "hasApplicationSchema",
      to_regclass('public."_sermon_clip_baseline_state"') IS NOT NULL AS "hasBaselineMarker"
  `);
  const state = rows[0] ?? {};
  const hasMigrationTable = state.hasMigrationTable === true;
  const appliedRows = hasMigrationTable
    ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`)
    : [];
  return {
    hasMigrationTable,
    hasApplicationSchema: state.hasApplicationSchema === true,
    hasBaselineMarker: state.hasBaselineMarker === true,
    appliedMigrationCount: Number(appliedRows[0]?.count ?? 0),
  };
}

async function databaseMigrationStateWithRetry() {
  const retryOptions = databaseRetryOptions();

  try {
    return await withDatabaseConnectionRetry(
      () => databaseMigrationState(),
      {
        ...retryOptions,
        onRetry: async ({ attempt, nextAttempt, maxAttempts, delayMs }) => {
          console.warn(
            `Database connection unavailable during migration preflight (attempt ${attempt}/${maxAttempts}). `
              + `Retrying attempt ${nextAttempt} in ${delayMs}ms.`,
          );
          // Reset Prisma's query engine so the next attempt opens a fresh Neon
          // connection instead of retaining a failed initialization state.
          await prisma.$disconnect().catch(() => undefined);
        },
      },
    );
  } catch (error) {
    if (!isRetryableDatabaseConnectionError(error)) throw error;

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Database migration preflight could not connect after ${retryOptions.maxAttempts} attempts. `
        + "Required migrations were not skipped, so this deployment was stopped safely. "
        + "Confirm the Neon project and branch are active and that Vercel's DATABASE_URL points to the current endpoint, then redeploy. "
        + `Last connection error: ${message}`,
      { cause: error },
    );
  }
}

async function migrationNames() {
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function appliedMigrationNames() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "migration_name" AS name
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL
  `).catch(() => []);
  return new Set(rows.map((row) => String(row.name)));
}

async function ensureBaselineMarker() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${BASELINE_MARKER_TABLE} (
      "id" INTEGER PRIMARY KEY,
      "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ${BASELINE_MARKER_TABLE} ("id") VALUES (1)
    ON CONFLICT ("id") DO UPDATE SET "updatedAt" = NOW()
  `);
}

async function clearBaselineMarker() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${BASELINE_MARKER_TABLE}`);
}

async function assertBaselineInvariants() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'ProcessingJob_one_active_type_per_sermon_key'
          AND indexdef ILIKE '%WHERE%'
          AND indexdef ILIKE '%status%'
          AND indexdef ILIKE '%PENDING%'
          AND indexdef ILIKE '%RUNNING%'
          AND indexdef ILIKE '%GENERATE_INTELLIGENCE%'
      ) AS "hasActiveJobIndex",
      (
        SELECT COUNT(*)::int
        FROM pg_constraint
        WHERE conname IN (
          'ContentAssetFile_location_check',
          'ContentAssetFile_dimensions_check',
          'ContentAssetFile_size_check',
          'ContentAssetFile_sort_order_check',
          'ScheduledPostContentAsset_sort_order_check'
        )
          AND connamespace = current_schema()::regnamespace
      ) AS "contentConstraintCount"
  `);
  const invariantState = rows[0] ?? {};
  if (invariantState.hasActiveJobIndex !== true || Number(invariantState.contentConstraintCount) !== 5) {
    throw new Error("PostgreSQL baseline invariants were not applied; migration history will not be marked complete.");
  }
}

async function baselineCurrentSchema({ resume }) {
  if (resume) {
    console.log("Resuming an interrupted Prisma baseline safely.");
  } else {
    console.log("No Prisma migration history was found. Applying the current PostgreSQL schema safely.");
    run("npx", ["prisma", "db", "push", "--skip-generate"]);
    await ensureBaselineMarker();
  }

  run("npx", [
    "prisma",
    "db",
    "execute",
    "--schema",
    "prisma/schema.prisma",
    "--file",
    "prisma/postgres-baseline-invariants.sql",
  ]);
  await assertBaselineInvariants();

  const applied = await appliedMigrationNames();
  for (const migrationName of await migrationNames()) {
    if (applied.has(migrationName)) continue;
    run("npx", ["prisma", "migrate", "resolve", "--applied", migrationName]);
  }
  await clearBaselineMarker();
}

async function main() {
  const state = await databaseMigrationStateWithRetry();

  const requiresBaseline = state.hasBaselineMarker
    || !state.hasMigrationTable
    || state.appliedMigrationCount === 0;
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({
      ...state,
      action: state.hasBaselineMarker
        ? "resume_baseline"
        : requiresBaseline ? "baseline_current_schema" : "migrate_deploy",
    }));
    await prisma.$disconnect();
    return;
  }

  if (requiresBaseline) {
    await baselineCurrentSchema({ resume: state.hasBaselineMarker });
    await prisma.$disconnect();
    return;
  }

  await prisma.$disconnect();
  run("npx", ["prisma", "migrate", "deploy"]);
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
