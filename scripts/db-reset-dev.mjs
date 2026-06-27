import path from "node:path";
import { rm } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const RESET_DELETE_ORDER = [
  "processingJob",
  "contentOpportunity",
  "clipCandidate",
  "ministryMoment",
  "sermonStructureSection",
  "sermonTopicTag",
  "sermonScriptureRef",
  "sermonIntelligence",
  "transcriptSegment",
  "transcript",
  "sermon",
];

function getStorageRoot() {
  const configured = process.env.SERMON_STORAGE_ROOT?.trim();
  return configured && configured.length > 0 ? configured : path.join(process.cwd(), "storage");
}

function isDevelopmentResetEnvironment(nodeEnv) {
  return nodeEnv === "development" || nodeEnv === "test";
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname.toLowerCase());
}

function looksProductionLike(value) {
  const normalized = value.trim().toLowerCase();
  return /prod(uction)?|live|main/.test(normalized);
}

function isClearlyLocalFileTarget(fileTarget) {
  const normalized = fileTarget.trim().toLowerCase();
  return normalized.startsWith("./") || normalized.startsWith("../") || /(^|[\\/])(prisma|storage|dev|test|local)([\\/._-]|$)/.test(normalized);
}

function isSafeDatabaseUrl(databaseUrl) {
  if (!databaseUrl?.trim()) {
    return false;
  }

  const normalized = databaseUrl.trim();
  if (looksProductionLike(normalized)) {
    return false;
  }

  if (normalized.startsWith("file:")) {
    const fileTarget = normalized.slice("file:".length).trim();
    if (!fileTarget) {
      return false;
    }

    return !looksProductionLike(fileTarget) && isClearlyLocalFileTarget(fileTarget);
  }

  try {
    const parsed = new URL(normalized);
    if (!["postgres:", "postgresql:", "mysql:", "mysql2:"].includes(parsed.protocol)) {
      return false;
    }

    return isLocalHost(parsed.hostname);
  } catch {
    return false;
  }
}

function assertSafeSermonId(sermonId) {
  const trimmed = sermonId.trim();
  if (!trimmed || /[\\/]/.test(trimmed)) {
    throw new Error(`Invalid sermon id: ${sermonId}`);
  }

  return trimmed;
}

function buildMediaCleanupTargets(storageRoot, sermonIds, deleteMedia) {
  if (!deleteMedia) {
    return [];
  }

  return sermonIds.map((sermonId) => {
    const safeSermonId = assertSafeSermonId(sermonId);
    return {
      sermonId: safeSermonId,
      path: path.join(storageRoot, "sermons", safeSermonId),
    };
  });
}

function printPlan({ nodeEnv, databaseUrl, plan }) {
  console.log("Development reset requested.");
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log(`DATABASE_URL: ${databaseUrl}`);
  console.log("This will permanently delete database records in the following order:");
  for (const model of plan.deleteOrder) {
    console.log(`- ${model}`);
  }
  if (plan.deleteMedia) {
    console.warn("Media cleanup is enabled. The following sermon media directories will be removed:");
    for (const target of plan.mediaTargets) {
      console.warn(`- ${target.path}`);
    }
  } else {
    console.warn("Media cleanup is disabled. Downloaded source videos will be preserved.");
  }
  console.warn("Proceeding only because this command was explicitly run in a development/test environment.");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const deleteMedia = args.has("--delete-media");

  if (!isDevelopmentResetEnvironment(process.env.NODE_ENV)) {
    throw new Error("db:reset-dev can only run when NODE_ENV is development or test.");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!isSafeDatabaseUrl(databaseUrl)) {
    throw new Error("DATABASE_URL does not look like a safe local development database.");
  }

  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  try {
    const sermonIds = (await prisma.sermon.findMany({ select: { id: true } })).map((sermon) => sermon.id);
    const plan = {
      deleteOrder: [...RESET_DELETE_ORDER],
      mediaTargets: buildMediaCleanupTargets(getStorageRoot(), sermonIds, deleteMedia),
      deleteMedia,
    };

    printPlan({ nodeEnv: process.env.NODE_ENV, databaseUrl, plan });

    await prisma.$transaction(async (tx) => {
      for (const model of RESET_DELETE_ORDER) {
        await tx[model].deleteMany({});
      }
    });

    console.log(`Deleted database records for ${sermonIds.length} sermon(s).`);

    if (deleteMedia && plan.mediaTargets.length > 0) {
      for (const target of plan.mediaTargets) {
        await rm(target.path, { recursive: true, force: true });
      }
      console.log(`Deleted ${plan.mediaTargets.length} sermon media director${plan.mediaTargets.length === 1 ? "y" : "ies"}.`);
    }

    console.log("Development reset complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown reset error.";
  console.error(`Development reset failed: ${message}`);
  process.exitCode = 1;
});
