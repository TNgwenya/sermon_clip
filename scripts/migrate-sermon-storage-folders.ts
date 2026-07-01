import { access, rename } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "../src/lib/prisma.ts";
import {
  ensureSermonFolders,
  getLegacySermonStoragePath,
  getSermonStoragePath,
  registerSermonStorageFolder,
} from "../src/server/agents/storage.ts";

const CLIP_PATH_FIELDS = [
  "renderedFilePath",
  "smartCropDebugSnapshotPath",
  "exportedFilePath",
  "thumbnailPath",
  "exportPath",
  "srtPath",
  "subtitleFilePath",
  "captionedVideoPath",
  "overlayVideoPath",
] as const;

const CLIP_PATH_SELECT = {
  id: true,
  renderedFilePath: true,
  smartCropDebugSnapshotPath: true,
  exportedFilePath: true,
  thumbnailPath: true,
  exportPath: true,
  srtPath: true,
  subtitleFilePath: true,
  captionedVideoPath: true,
  overlayVideoPath: true,
} satisfies Prisma.ClipCandidateSelect;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function replaceRoot(value: string | null | undefined, fromRoot: string, toRoot: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedFrom = path.resolve(fromRoot);
  const normalizedValue = path.resolve(value);
  if (normalizedValue !== normalizedFrom && !normalizedValue.startsWith(`${normalizedFrom}${path.sep}`)) {
    return undefined;
  }

  return path.join(toRoot, path.relative(normalizedFrom, normalizedValue));
}

function buildUpdatePatch(record: Record<string, unknown>, fields: readonly string[], fromRoot: string, toRoot: string): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of fields) {
    const current = typeof record[field] === "string" ? record[field] : null;
    const updated = replaceRoot(current, fromRoot, toRoot);
    if (updated && updated !== current) {
      patch[field] = updated;
    }
  }

  return patch;
}

async function migrateSermon(input: {
  id: string;
  title: string;
  sourceVideoPath: string | null;
  audioPath: string | null;
  transcriptJsonPath: string | null;
}): Promise<{
  id: string;
  title: string;
  folderName: string;
  renamed: boolean;
  sermonPathsUpdated: number;
  transcriptPathsUpdated: number;
  clipPathsUpdated: number;
}> {
  const legacyRoot = getLegacySermonStoragePath(input.id);
  const folderName = await registerSermonStorageFolder(input.id, input.title);
  const targetRoot = getSermonStoragePath(input.id);
  const renamed = legacyRoot !== targetRoot && await pathExists(legacyRoot);

  if (renamed) {
    if (await pathExists(targetRoot)) {
      throw new Error(`Cannot rename ${legacyRoot} to ${targetRoot}; target already exists.`);
    }
    await rename(legacyRoot, targetRoot);
  }

  await ensureSermonFolders(input.id, input.title);

  const sermonPatch = buildUpdatePatch(
    input,
    ["sourceVideoPath", "audioPath", "transcriptJsonPath"],
    legacyRoot,
    targetRoot,
  );
  const sermonPathsUpdated = Object.keys(sermonPatch).length;
  if (sermonPathsUpdated > 0) {
    await prisma.sermon.update({
      where: { id: input.id },
      data: sermonPatch,
    });
  }

  let transcriptPathsUpdated = 0;
  const transcripts = await prisma.transcript.findMany({
    where: { sermonId: input.id },
    select: { id: true, rawJsonPath: true },
  });
  for (const transcript of transcripts) {
    const rawJsonPath = replaceRoot(transcript.rawJsonPath, legacyRoot, targetRoot);
    if (!rawJsonPath || rawJsonPath === transcript.rawJsonPath) {
      continue;
    }

    await prisma.transcript.update({
      where: { id: transcript.id },
      data: { rawJsonPath },
    });
    transcriptPathsUpdated += 1;
  }

  let clipPathsUpdated = 0;
  const clips = await prisma.clipCandidate.findMany({
    where: { sermonId: input.id },
    select: CLIP_PATH_SELECT,
  });
  for (const clip of clips) {
    const patch = buildUpdatePatch(clip, CLIP_PATH_FIELDS, legacyRoot, targetRoot);
    if (Object.keys(patch).length === 0) {
      continue;
    }

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: patch,
    });
    clipPathsUpdated += 1;
  }

  return {
    id: input.id,
    title: input.title,
    folderName,
    renamed,
    sermonPathsUpdated,
    transcriptPathsUpdated,
    clipPathsUpdated,
  };
}

async function main(): Promise<void> {
  const sermons = await prisma.sermon.findMany({
    select: {
      id: true,
      title: true,
      sourceVideoPath: true,
      audioPath: true,
      transcriptJsonPath: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const results = [];
  for (const sermon of sermons) {
    results.push(await migrateSermon(sermon));
  }

  console.log(JSON.stringify({ migrated: results.length, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
