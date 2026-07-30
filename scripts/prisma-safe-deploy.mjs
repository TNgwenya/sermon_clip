import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { randomBytes, scryptSync } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import {
  isRetryableDatabaseConnectionError,
  withDatabaseConnectionRetry,
} from "./prisma-deploy-retry.mjs";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const prisma = new PrismaClient();
const BASELINE_MARKER_TABLE = '"_sermon_clip_baseline_state"';
const PHASE_1_TENANCY_MIGRATION = "20260729152000_phase1_tenancy_identity_foundation";
const DEFAULT_DATABASE_RETRY_MAX_ATTEMPTS = 4;
const DEFAULT_DATABASE_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_DATABASE_RETRY_MAX_DELAY_MS = 8_000;
const PASSWORD_SCRYPT_N = 16_384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_MAX_MEMORY_BYTES = 64 * 1024 * 1024;

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
      to_regclass('public."_sermon_clip_baseline_state"') IS NOT NULL AS "hasBaselineMarker",
      to_regclass('public."Organization"') IS NOT NULL AS "hasPhase1TenantSchema"
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
    hasPhase1TenantSchema: state.hasPhase1TenantSchema === true,
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

/**
 * `prisma db push` cannot make a populated historyless schema's social tenant
 * columns required or add required ownership to existing revision rows.
 * Attribute social rows from their campus (falling back to the compatibility
 * organization), seed revision ownership from immutable parents, and let db
 * push install the declared NOT NULL, unique, and foreign-key constraints.
 * Legitimate organization-scoped rows keep a null campus.
 */
async function prepareTenantOwnershipForCurrentSchemaPush() {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      INSERT INTO "Organization" (
      "id",
      "slug",
      "name",
      "status",
      "timezone",
      "defaultLanguage",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'org_local_default',
      'local',
      'SermonClip Local',
      'ACTIVE',
      'Africa/Johannesburg',
      'en',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
      ON CONFLICT ("id") DO NOTHING;

      INSERT INTO "Campus" (
      "id",
      "organizationId",
      "slug",
      "name",
      "status",
      "timezone",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'campus_local_default',
      'org_local_default',
      'main',
      'Main Campus',
      'ACTIVE',
      'Africa/Johannesburg',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
      ON CONFLICT ("id") DO NOTHING;

      UPDATE "SocialAccount" AS account
      SET "organizationId" = COALESCE(
        (
          SELECT campus."organizationId"
          FROM "Campus" AS campus
          WHERE campus."id" = account."campusId"
        ),
        'org_local_default'
      )
      WHERE account."organizationId" IS NULL;

      UPDATE "SocialCredential" AS credential
      SET "organizationId" = COALESCE(
        (
          SELECT campus."organizationId"
          FROM "Campus" AS campus
          WHERE campus."id" = credential."campusId"
        ),
        'org_local_default'
      )
      WHERE credential."organizationId" IS NULL;

      UPDATE "SocialMetricSnapshot" AS snapshot
      SET "organizationId" = COALESCE(
        (
          SELECT campus."organizationId"
          FROM "Campus" AS campus
          WHERE campus."id" = snapshot."campusId"
        ),
        'org_local_default'
      )
      WHERE snapshot."organizationId" IS NULL;

      UPDATE "ContentOpportunity" AS opportunity
      SET "organizationId" = COALESCE(
        (
          SELECT campus."organizationId"
          FROM "Campus" AS campus
          WHERE campus."id" = opportunity."campusId"
        ),
        'org_local_default'
      )
      WHERE opportunity."organizationId" IS NULL;

      UPDATE "ContentAsset" AS asset
      SET "organizationId" = COALESCE(
        (
          SELECT campus."organizationId"
          FROM "Campus" AS campus
          WHERE campus."id" = asset."campusId"
        ),
        'org_local_default'
      )
      WHERE asset."organizationId" IS NULL;

      UPDATE "SocialAccount" AS account
      SET "campusId" = NULL
      WHERE account."campusId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Campus" AS campus
          WHERE campus."id" = account."campusId"
            AND campus."organizationId" = account."organizationId"
        );

      UPDATE "SocialCredential" AS credential
      SET "campusId" = NULL
      WHERE credential."campusId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Campus" AS campus
          WHERE campus."id" = credential."campusId"
            AND campus."organizationId" = credential."organizationId"
        );

      UPDATE "SocialMetricSnapshot" AS snapshot
      SET "campusId" = NULL
      WHERE snapshot."campusId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Campus" AS campus
          WHERE campus."id" = snapshot."campusId"
            AND campus."organizationId" = snapshot."organizationId"
        );

      UPDATE "ContentOpportunity" AS opportunity
      SET "campusId" = NULL
      WHERE opportunity."campusId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Campus" AS campus
          WHERE campus."id" = opportunity."campusId"
            AND campus."organizationId" = opportunity."organizationId"
        );

      UPDATE "ContentAsset" AS asset
      SET "campusId" = NULL
      WHERE asset."campusId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Campus" AS campus
          WHERE campus."id" = asset."campusId"
            AND campus."organizationId" = asset."organizationId"
        );

      IF to_regclass('public."ContentOpportunityRevision"') IS NOT NULL THEN
        ALTER TABLE "ContentOpportunityRevision"
          ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
          ADD COLUMN IF NOT EXISTS "campusId" TEXT;

        UPDATE "ContentOpportunityRevision" AS revision
        SET
          "organizationId" = COALESCE(opportunity."organizationId", 'org_local_default'),
          "campusId" = CASE
            WHEN opportunity."campusId" IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM "Campus" AS campus
                WHERE campus."id" = opportunity."campusId"
                  AND campus."organizationId" = COALESCE(opportunity."organizationId", 'org_local_default')
              )
            THEN opportunity."campusId"
            ELSE NULL
          END
        FROM "ContentOpportunity" AS opportunity
        WHERE revision."contentOpportunityId" = opportunity."id"
          AND (
            revision."organizationId" IS DISTINCT FROM COALESCE(opportunity."organizationId", 'org_local_default')
            OR revision."campusId" IS DISTINCT FROM opportunity."campusId"
          );

        IF EXISTS (
          SELECT 1 FROM "ContentOpportunityRevision"
          WHERE "organizationId" IS NULL
        ) THEN
          RAISE EXCEPTION 'ContentOpportunityRevision contains an orphaned row without tenant ownership';
        END IF;
      END IF;

      IF to_regclass('public."ContentAssetRevision"') IS NOT NULL THEN
        ALTER TABLE "ContentAssetRevision"
          ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
          ADD COLUMN IF NOT EXISTS "campusId" TEXT;

        UPDATE "ContentAssetRevision" AS revision
        SET
          "organizationId" = COALESCE(asset."organizationId", 'org_local_default'),
          "campusId" = CASE
            WHEN asset."campusId" IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM "Campus" AS campus
                WHERE campus."id" = asset."campusId"
                  AND campus."organizationId" = COALESCE(asset."organizationId", 'org_local_default')
              )
            THEN asset."campusId"
            ELSE NULL
          END
        FROM "ContentAsset" AS asset
        WHERE revision."contentAssetId" = asset."id"
          AND (
            revision."organizationId" IS DISTINCT FROM COALESCE(asset."organizationId", 'org_local_default')
            OR revision."campusId" IS DISTINCT FROM asset."campusId"
          );

        IF EXISTS (
          SELECT 1 FROM "ContentAssetRevision"
          WHERE "organizationId" IS NULL
        ) THEN
          RAISE EXCEPTION 'ContentAssetRevision contains an orphaned row without tenant ownership';
        END IF;
      END IF;
    END
    $$;
  `);
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
          AND indexdef ILIKE '%GENERATE_CONTENT_OPPORTUNITIES%'
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
      ) AS "contentConstraintCount",
      (
        SELECT COUNT(*)::int
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'Membership_organizationId_userId_org_scope_key',
            'Invitation_pending_org_scope_email_key',
            'Invitation_pending_campus_scope_email_key',
            'OwnershipTransfer_one_pending_per_organization_key'
          )
          AND indexdef ILIKE '%WHERE%'
      ) AS "phase1PartialIndexCount",
      (
        SELECT COUNT(*)::int
        FROM pg_constraint
        WHERE conname IN (
          'WeekDraft_version_check',
          'WeekDraftItem_provenance_check',
          'WeekDraftItemRevision_number_check',
          'WeekDraftItemRevision_hash_check',
          'WeekDraftItemRevision_provenance_check',
          'CollaborationAssignment_completion_check',
          'CollaborationComment_body_check',
          'ApprovalPolicy_minimum_check',
          'ApprovalPolicyRule_minimum_check',
          'ApprovalRequest_resolution_check',
          'ApprovalDecision_reason_check'
        )
          AND connamespace = current_schema()::regnamespace
      ) AS "phase23ConstraintCount",
      (
        SELECT COUNT(*)::int
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'WeekDraft_org_sermon_week_key',
            'ApprovalPolicy_org_name_key',
            'ApprovalPolicy_active_org_default_key',
            'ApprovalPolicy_active_campus_default_key',
            'CollaborationAssignment_active_draft_assignee_key',
            'CollaborationAssignment_active_item_assignee_key',
            'ApprovalRequest_pending_item_key'
          )
          AND indexdef ILIKE '%WHERE%'
      ) AS "phase23PartialIndexCount",
      to_regclass('public."WeekDraft"') IS NOT NULL
        AND to_regclass('public."WeekDraftItem"') IS NOT NULL
        AND to_regclass('public."ApprovalRequest"') IS NOT NULL
        AS "hasPhase23Schema",
      to_regclass('public."PasswordCredential"') IS NOT NULL
        AND to_regclass('public."UserIdentity"') IS NOT NULL
        AND to_regclass('public."UserSession"') IS NOT NULL
        AND to_regclass('public."MfaFactor"') IS NOT NULL
        AND to_regclass('public."MfaRecoveryCode"') IS NOT NULL
        AND to_regclass('public."SecurityToken"') IS NOT NULL
        AS "hasPhase1bIdentitySecurity",
      to_regclass('public."SocialAccount_org_provider_identity_key"') IS NOT NULL
        AND to_regclass('public."SocialCredential_org_provider_identity_key"') IS NOT NULL
        AND to_regclass('public."SocialMetricSnapshot_org_dedupe_key"') IS NOT NULL
        AND (
          SELECT COUNT(*)::int
          FROM pg_attribute
          WHERE attrelid IN (
            '"SocialAccount"'::regclass,
            '"SocialCredential"'::regclass,
            '"SocialMetricSnapshot"'::regclass
          )
            AND attname = 'organizationId'
            AND attnotnull
            AND NOT attisdropped
        ) = 3
        AND NOT EXISTS (
          SELECT 1
          FROM pg_attribute AS attribute
          JOIN pg_attrdef AS default_value
            ON default_value.adrelid = attribute.attrelid
           AND default_value.adnum = attribute.attnum
          WHERE attribute.attrelid IN (
            '"SocialAccount"'::regclass,
            '"SocialCredential"'::regclass,
            '"SocialMetricSnapshot"'::regclass
          )
            AND attribute.attname = 'organizationId'
            AND NOT attribute.attisdropped
        )
        AS "hasTenantSocialIdentityIntegrity",
      (
        SELECT COUNT(*)::int
        FROM pg_attribute
        WHERE attrelid IN (
          '"ContentOpportunityRevision"'::regclass,
          '"ContentAssetRevision"'::regclass
        )
          AND attname = 'organizationId'
          AND attnotnull
          AND NOT attisdropped
      ) = 2
        AND to_regclass('public."ContentOpportunity_id_organizationId_key"') IS NOT NULL
        AND to_regclass('public."ContentAsset_id_organizationId_key"') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = '"ContentOpportunityRevision"'::regclass
            AND confrelid = '"ContentOpportunity"'::regclass
            AND contype = 'f'
            AND convalidated
            AND cardinality(conkey) = 2
            AND cardinality(confkey) = 2
        )
        AND EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = '"ContentAssetRevision"'::regclass
            AND confrelid = '"ContentAsset"'::regclass
            AND contype = 'f'
            AND convalidated
            AND cardinality(conkey) = 2
            AND cardinality(confkey) = 2
        )
        AND (
          SELECT COUNT(*)::int
          FROM pg_trigger
          WHERE tgname IN (
            'ContentOpportunityRevision_parent_tenant_guard',
            'ContentAssetRevision_parent_tenant_guard',
            'ContentOpportunity_revision_tenant_guard',
            'ContentAsset_revision_tenant_guard'
          )
            AND NOT tgisinternal
            AND tgenabled <> 'D'
        ) = 4
        AND NOT EXISTS (
          SELECT 1
          FROM "ContentOpportunityRevision" AS revision
          JOIN "ContentOpportunity" AS opportunity
            ON opportunity."id" = revision."contentOpportunityId"
          WHERE revision."organizationId" IS DISTINCT FROM opportunity."organizationId"
            OR revision."campusId" IS DISTINCT FROM opportunity."campusId"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ContentAssetRevision" AS revision
          JOIN "ContentAsset" AS asset
            ON asset."id" = revision."contentAssetId"
          WHERE revision."organizationId" IS DISTINCT FROM asset."organizationId"
            OR revision."campusId" IS DISTINCT FROM asset."campusId"
        )
        AS "hasRevisionTenantOwnership",
      EXISTS (
        SELECT 1
        FROM "Organization"
        WHERE "id" = 'org_local_default'
      ) AND EXISTS (
        SELECT 1
        FROM "Campus"
        WHERE "id" = 'campus_local_default'
          AND "organizationId" = 'org_local_default'
      ) AND EXISTS (
        SELECT 1
        FROM "User"
        WHERE "id" = 'user_local_bootstrap'
          AND "status" = 'ACTIVE'
      ) AND EXISTS (
        SELECT 1
        FROM "Membership"
        WHERE "id" = 'membership_local_bootstrap'
          AND "organizationId" = 'org_local_default'
          AND "userId" = 'user_local_bootstrap'
          AND "role" = 'OWNER'
          AND "status" = 'ACTIVE'
      ) AS "hasPhase1Bootstrap",
      (
        SELECT COUNT(*)::int
        FROM "OrganizationEntitlement"
        WHERE "organizationId" = 'org_local_default'
          AND "enabled" = TRUE
          AND "key" IN (
            'ai.tokens.monthly',
            'ai.audio_seconds.monthly',
            'media.seconds.monthly',
            'storage.bytes',
            'seats',
            'campuses',
            'social.connections'
          )
      ) AS "phase1BootstrapEntitlementCount"
  `);
  const invariantState = rows[0] ?? {};
  if (
    invariantState.hasActiveJobIndex !== true
    || Number(invariantState.contentConstraintCount) !== 5
    || Number(invariantState.phase1PartialIndexCount) !== 4
    || Number(invariantState.phase23ConstraintCount) !== 11
    || Number(invariantState.phase23PartialIndexCount) !== 7
    || invariantState.hasPhase23Schema !== true
    || invariantState.hasPhase1bIdentitySecurity !== true
    || invariantState.hasTenantSocialIdentityIntegrity !== true
    || invariantState.hasRevisionTenantOwnership !== true
    || invariantState.hasPhase1Bootstrap !== true
    || Number(invariantState.phase1BootstrapEntitlementCount) !== 7
  ) {
    throw new Error("PostgreSQL baseline invariants were not applied; migration history will not be marked complete.");
  }
}

async function markMigrationsApplied(migrations) {
  const applied = await appliedMigrationNames();
  for (const migrationName of migrations) {
    if (applied.has(migrationName)) continue;
    run("npx", ["prisma", "migrate", "resolve", "--applied", migrationName]);
  }
}

function hashBootstrapPassword(password) {
  if (password.length < 12 || password.length > 1_024) {
    throw new Error("BOOTSTRAP_OWNER_PASSWORD must contain between 12 and 1024 characters.");
  }
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_HASH_BYTES, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: PASSWORD_MAX_MEMORY_BYTES,
  });
  return [
    "scrypt",
    PASSWORD_SCRYPT_N,
    PASSWORD_SCRYPT_R,
    PASSWORD_SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

async function configureBootstrapOwnerCredential() {
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!password) return;
  const passwordHash = hashBootstrapPassword(password);

  await prisma.passwordCredential.upsert({
    where: { userId: "user_local_bootstrap" },
    create: {
      userId: "user_local_bootstrap",
      passwordHash,
    },
    update: {
      passwordHash,
      passwordChangedAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  console.log("Secure bootstrap owner credential configured.");
}

async function applyBaselineInvariants() {
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
  await configureBootstrapOwnerCredential();
}

async function baselineCurrentSchema({ resume }) {
  if (resume) {
    console.log("Resuming an interrupted Prisma baseline safely.");
  } else {
    console.log("No Prisma migration history was found for the tenant schema. The current additive schema and baseline invariants will be verified.");
    await ensureBaselineMarker();
  }

  await prepareTenantOwnershipForCurrentSchemaPush();
  // The recovery marker is intentionally outside Prisma's application schema.
  // Remove it only for db push so Prisma does not treat the marker itself as
  // destructive drift; a historyless failure is still rediscovered safely on
  // the next run because no migration has been marked applied.
  await clearBaselineMarker();
  run("npx", ["prisma", "db", "push", "--skip-generate"]);
  await ensureBaselineMarker();
  await applyBaselineInvariants();
  await markMigrationsApplied(await migrationNames());
  await clearBaselineMarker();
}

async function bootstrapFreshCurrentSchema() {
  console.log("No application schema was found. Applying the current PostgreSQL schema and required baseline data safely.");
  run("npx", ["prisma", "db", "push", "--skip-generate"]);
  await ensureBaselineMarker();
  await applyBaselineInvariants();
  await markMigrationsApplied(await migrationNames());
  await clearBaselineMarker();
}

async function baselineLegacySchema({ resume }) {
  console.log(
    resume
      ? "Resuming the legacy-schema Phase 1 migration baseline."
      : "No Prisma migration history was found for the legacy schema. Applying the Phase 1 cutover migration safely.",
  );
  await ensureBaselineMarker();

  const migrations = await migrationNames();
  const cutoverIndex = migrations.indexOf(PHASE_1_TENANCY_MIGRATION);
  if (cutoverIndex < 0) {
    throw new Error(`Required tenancy migration ${PHASE_1_TENANCY_MIGRATION} was not found.`);
  }

  await markMigrationsApplied(migrations.slice(0, cutoverIndex));
  await prisma.$disconnect();
  run("npx", ["prisma", "migrate", "deploy"]);
  await applyBaselineInvariants();
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
      action: !state.hasApplicationSchema
        ? "bootstrap_current_schema"
        : state.hasBaselineMarker
          ? state.hasPhase1TenantSchema
            ? "resume_current_schema_baseline"
            : "resume_legacy_schema_baseline"
          : requiresBaseline
            ? state.hasPhase1TenantSchema
              ? "baseline_current_schema"
              : "baseline_legacy_schema"
            : "migrate_deploy",
    }));
    await prisma.$disconnect();
    return;
  }

  if (!state.hasApplicationSchema) {
    await bootstrapFreshCurrentSchema();
    await prisma.$disconnect();
    return;
  }

  if (requiresBaseline) {
    if (state.hasPhase1TenantSchema) {
      await baselineCurrentSchema({ resume: state.hasBaselineMarker });
    } else {
      await baselineLegacySchema({ resume: state.hasBaselineMarker });
    }
    await prisma.$disconnect();
    return;
  }

  await prisma.$disconnect();
  run("npx", ["prisma", "migrate", "deploy"]);
  await applyBaselineInvariants();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
