import path from "node:path";

export const DEV_RESET_DELETE_ORDER = [
  "ProcessingJob",
  "ContentOpportunity",
  "ClipCandidate",
  "MinistryMoment",
  "SermonStructureSection",
  "SermonTopicTag",
  "SermonScriptureRef",
  "SermonIntelligence",
  "TranscriptSegment",
  "Transcript",
  "Sermon",
] as const;

export type DevResetDatabaseModel = (typeof DEV_RESET_DELETE_ORDER)[number];

export type DevResetMediaTarget = {
  sermonId: string;
  path: string;
};

export type DevResetPlan = {
  deleteOrder: DevResetDatabaseModel[];
  mediaTargets: DevResetMediaTarget[];
  deleteMedia: boolean;
};

export function isDevelopmentResetEnvironment(nodeEnv?: string): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname.toLowerCase());
}

function looksProductionLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /prod(uction)?|live|main/.test(normalized);
}

function isClearlyLocalFileTarget(fileTarget: string): boolean {
  const normalized = fileTarget.trim().toLowerCase();
  return normalized.startsWith("./") || normalized.startsWith("../") || /(^|[\\/])(prisma|storage|dev|test|local)([\\/._-]|$)/.test(normalized);
}

export function isSafeDatabaseUrl(databaseUrl?: string): boolean {
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

function assertSafeSermonId(sermonId: string): string {
  const trimmed = sermonId.trim();
  if (!trimmed || /[\\/]/.test(trimmed)) {
    throw new Error(`Invalid sermon id: ${sermonId}`);
  }

  return trimmed;
}

export function buildMediaCleanupTargets(options: {
  storageRoot: string;
  sermonIds: string[];
  deleteMedia: boolean;
}): DevResetMediaTarget[] {
  if (!options.deleteMedia) {
    return [];
  }

  return options.sermonIds.map((sermonId) => ({
    sermonId: assertSafeSermonId(sermonId),
    path: path.join(options.storageRoot, "sermons", assertSafeSermonId(sermonId)),
  }));
}

export function buildDevResetPlan(options: {
  storageRoot: string;
  sermonIds: string[];
  deleteMedia?: boolean;
}): DevResetPlan {
  return {
    deleteOrder: [...DEV_RESET_DELETE_ORDER],
    mediaTargets: buildMediaCleanupTargets({
      storageRoot: options.storageRoot,
      sermonIds: options.sermonIds,
      deleteMedia: options.deleteMedia ?? false,
    }),
    deleteMedia: options.deleteMedia ?? false,
  };
}
