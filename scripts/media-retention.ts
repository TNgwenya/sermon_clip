import { lstat, readdir, rm, statfs } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { getSermonStoragePath } from "../src/server/agents/storage.ts";
import { getConfiguredStorageRoot } from "../src/server/media/portableStoragePath.ts";
import { GIBIBYTE, configuredMinimumFreeBytes } from "../src/server/media/storageCapacity.ts";
import { buildMediaRetentionDecisions } from "./media-retention-core.ts";

const CLEANUP_RELATIVE_PATHS = [
  "clips/rendered",
  "clips/captioned",
  "clips/overlay",
  "logs",
  "transcript/chunks",
  "transcript/chunk-transcripts",
  "transcript/sermon-window-audio.mp3",
  "transcript/speech-enhanced-audio.mp3",
] as const;

type CleanupTarget = {
  sermonId: string;
  sermonTitle: string;
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function gibibytes(bytes: number): number {
  return Number((bytes / GIBIBYTE).toFixed(3));
}

function parseClipIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function assertPathInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Unsafe retention target: ${candidate}`);
  }
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  while (true) {
    if (await lstat(current).catch(() => null)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

async function freeStorageBytes(storageRoot: string): Promise<number> {
  const filesystem = await statfs(await nearestExistingPath(storageRoot));
  return filesystem.bavail * filesystem.bsize;
}

async function directorySize(candidate: string): Promise<number> {
  const state = await lstat(candidate).catch(() => null);
  if (!state || state.isSymbolicLink()) {
    return 0;
  }
  if (state.isFile()) {
    return state.size;
  }
  if (!state.isDirectory()) {
    return 0;
  }
  const entries = await readdir(candidate, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await directorySize(path.join(candidate, entry.name));
  }
  return total;
}

async function cleanupTargetsForProject(input: {
  sermonId: string;
  sermonTitle: string;
}): Promise<CleanupTarget[]> {
  const projectRoot = path.resolve(getSermonStoragePath(input.sermonId));
  const rootState = await lstat(projectRoot).catch(() => null);
  if (!rootState || rootState.isSymbolicLink() || !rootState.isDirectory()) {
    return [];
  }
  const targets: CleanupTarget[] = [];
  for (const relativePath of CLEANUP_RELATIVE_PATHS) {
    const absolutePath = path.resolve(projectRoot, relativePath);
    assertPathInside(projectRoot, absolutePath);
    const state = await lstat(absolutePath).catch(() => null);
    if (!state || state.isSymbolicLink()) {
      continue;
    }
    const bytes = await directorySize(absolutePath);
    targets.push({ ...input, relativePath, absolutePath, bytes });
  }
  return targets;
}

async function main(): Promise<void> {
  const allowedArgs = new Set(["--apply"]);
  if (process.argv.slice(2).some((argument) => !allowedArgs.has(argument))) {
    throw new Error("Usage: npm run storage:retention -- [--apply]");
  }
  const apply = process.argv.includes("--apply");
  const retentionDays = positiveInteger(process.env.MEDIA_RETENTION_DAYS, 7);
  const maxProjects = positiveInteger(process.env.MEDIA_RETENTION_MAX_PROJECTS_PER_RUN, 20);
  const storageRoot = getConfiguredStorageRoot();
  const { prisma } = await import("../src/lib/prisma.ts");

  const [sermons, scheduledPosts] = await Promise.all([
    prisma.sermon.findMany({
      select: {
        id: true,
        title: true,
        updatedAt: true,
        clipCandidates: { select: { id: true } },
        processingJobs: {
          where: { status: { in: ["PENDING", "RUNNING"] } },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.scheduledPost.findMany({ select: { clipIdsJson: true } }),
  ]);
  const scheduledClipIds = new Set(scheduledPosts.flatMap((post) => parseClipIds(post.clipIdsJson)));
  const decisions = buildMediaRetentionDecisions({
    now: new Date(),
    retentionDays,
    projects: sermons.map((sermon) => ({
      id: sermon.id,
      title: sermon.title,
      updatedAt: sermon.updatedAt,
      hasActiveProcessingJob: sermon.processingJobs.length > 0,
      hasScheduledPost: sermon.clipCandidates.some((clip) => scheduledClipIds.has(clip.id)),
    })),
  });
  const eligible = decisions.filter((decision) => decision.eligible).slice(0, maxProjects);
  const targets = (await Promise.all(
    eligible.map(({ project }) => cleanupTargetsForProject({ sermonId: project.id, sermonTitle: project.title })),
  )).flat();
  const availableBeforeBytes = await freeStorageBytes(storageRoot);
  const reclaimableBytes = targets.reduce((total, target) => total + target.bytes, 0);
  const skipped = decisions.reduce<Record<string, number>>((summary, decision) => {
    if (!decision.eligible) {
      summary[decision.reason] = (summary[decision.reason] ?? 0) + 1;
    }
    return summary;
  }, {});

  if (!apply) {
    console.log(JSON.stringify({
      command: "retention",
      mode: "dry-run",
      storageRoot,
      retentionDays,
      eligibleProjects: eligible.length,
      limitedByMaxProjects: Math.max(0, decisions.filter((decision) => decision.eligible).length - eligible.length),
      skippedProjects: skipped,
      cleanupTargets: targets.map((target) => ({
        sermonId: target.sermonId,
        sermonTitle: target.sermonTitle,
        relativePath: target.relativePath,
        gib: gibibytes(target.bytes),
      })),
      reclaimableGib: gibibytes(reclaimableBytes),
      availableGib: gibibytes(availableBeforeBytes),
      minimumFreeGib: gibibytes(configuredMinimumFreeBytes()),
      diskSpaceReady: availableBeforeBytes >= configuredMinimumFreeBytes(),
      nextCommand: "Re-run with --apply to remove only the listed regenerable files.",
    }, null, 2));
    return;
  }

  let deletedBytes = 0;
  for (const target of targets) {
    const state = await lstat(target.absolutePath).catch(() => null);
    if (!state || state.isSymbolicLink()) {
      continue;
    }
    await rm(target.absolutePath, { recursive: state.isDirectory(), force: true });
    deletedBytes += target.bytes;
  }
  const availableAfterBytes = await freeStorageBytes(storageRoot);
  console.log(JSON.stringify({
    command: "retention",
    mode: "applied",
    storageRoot,
    retentionDays,
    eligibleProjects: eligible.length,
    skippedProjects: skipped,
    deletedTargets: targets.length,
    deletedGib: gibibytes(deletedBytes),
    availableBeforeGib: gibibytes(availableBeforeBytes),
    availableAfterGib: gibibytes(availableAfterBytes),
    minimumFreeGib: gibibytes(configuredMinimumFreeBytes()),
    diskSpaceReady: availableAfterBytes >= configuredMinimumFreeBytes(),
  }, null, 2));
}

await main();
