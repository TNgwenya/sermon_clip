import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import {
  getConfiguredStorageRoot,
  PORTABLE_STORAGE_PATH_PREFIX,
  toPortableStoragePath,
} from "../src/server/media/portableStoragePath.ts";

type PathRecord = { id: string } & Record<string, unknown>;
type MigrationSummary = {
  model: string;
  recordsScanned: number;
  recordsChanged: number;
  pathsChanged: number;
};

function readFromRoot(): string {
  const inline = process.argv.find((argument) => argument.startsWith("--from-root="));
  if (inline) {
    return inline.slice("--from-root=".length).trim();
  }

  const index = process.argv.indexOf("--from-root");
  if (index >= 0) {
    return process.argv[index + 1]?.trim() ?? "";
  }

  return getConfiguredStorageRoot();
}

const apply = process.argv.includes("--apply");
const fromRoot = readFromRoot();

if (!fromRoot || !path.isAbsolute(fromRoot)) {
  throw new Error("--from-root must be a non-empty absolute path.");
}

function buildPatch(record: PathRecord, fields: readonly string[]): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of fields) {
    const current = record[field];
    if (typeof current !== "string" || !current.trim()) {
      continue;
    }

    const portable = toPortableStoragePath(current, fromRoot);
    if (portable !== current) {
      patch[field] = portable;
    }
  }
  return patch;
}

async function migrateRecords(input: {
  model: string;
  records: PathRecord[];
  fields: readonly string[];
  update: (id: string, patch: Record<string, string>) => Promise<unknown>;
}): Promise<MigrationSummary> {
  let recordsChanged = 0;
  let pathsChanged = 0;

  for (const record of input.records) {
    const patch = buildPatch(record, input.fields);
    const changed = Object.keys(patch).length;
    if (changed === 0) {
      continue;
    }

    recordsChanged += 1;
    pathsChanged += changed;
    if (apply) {
      await input.update(record.id, patch);
    }
  }

  return {
    model: input.model,
    recordsScanned: input.records.length,
    recordsChanged,
    pathsChanged,
  };
}

async function main(): Promise<void> {
  // This migration intentionally bypasses the app's Prisma extension so it can
  // inspect the stored values rather than their resolved local equivalents.
  const prisma = new PrismaClient();
  try {
    const summaries: MigrationSummary[] = [];

    const sermons = await prisma.sermon.findMany({
      select: { id: true, sourceVideoPath: true, audioPath: true, transcriptJsonPath: true },
    });
    summaries.push(await migrateRecords({
      model: "Sermon",
      records: sermons,
      fields: ["sourceVideoPath", "audioPath", "transcriptJsonPath"],
      update: (id, patch) => prisma.sermon.update({
        where: { id },
        data: patch as Prisma.SermonUpdateInput,
      }),
    }));

    const transcripts = await prisma.transcript.findMany({ select: { id: true, rawJsonPath: true } });
    summaries.push(await migrateRecords({
      model: "Transcript",
      records: transcripts,
      fields: ["rawJsonPath"],
      update: (id, patch) => prisma.transcript.update({
        where: { id },
        data: patch as Prisma.TranscriptUpdateInput,
      }),
    }));

    const clips = await prisma.clipCandidate.findMany({
      select: {
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
      },
    });
    summaries.push(await migrateRecords({
      model: "ClipCandidate",
      records: clips,
      fields: [
        "renderedFilePath",
        "smartCropDebugSnapshotPath",
        "exportedFilePath",
        "thumbnailPath",
        "exportPath",
        "srtPath",
        "subtitleFilePath",
        "captionedVideoPath",
        "overlayVideoPath",
      ],
      update: (id, patch) => prisma.clipCandidate.update({
        where: { id },
        data: patch as Prisma.ClipCandidateUpdateInput,
      }),
    }));

    const artifacts = await prisma.clipArtifact.findMany({ select: { id: true, filePath: true } });
    summaries.push(await migrateRecords({
      model: "ClipArtifact",
      records: artifacts,
      fields: ["filePath"],
      update: (id, patch) => prisma.clipArtifact.update({
        where: { id },
        data: patch as Prisma.ClipArtifactUpdateInput,
      }),
    }));

    const contentFiles = await prisma.contentAssetFile.findMany({ select: { id: true, filePath: true } });
    summaries.push(await migrateRecords({
      model: "ContentAssetFile",
      records: contentFiles,
      fields: ["filePath"],
      update: (id, patch) => prisma.contentAssetFile.update({
        where: { id },
        data: patch as Prisma.ContentAssetFileUpdateInput,
      }),
    }));

    const branding = await prisma.brandingSettings.findMany({ select: { id: true, churchLogoPath: true } });
    summaries.push(await migrateRecords({
      model: "BrandingSettings",
      records: branding,
      fields: ["churchLogoPath"],
      update: (id, patch) => prisma.brandingSettings.update({
        where: { id },
        data: patch as Prisma.BrandingSettingsUpdateInput,
      }),
    }));

    const totals = summaries.reduce(
      (sum, item) => ({
        recordsScanned: sum.recordsScanned + item.recordsScanned,
        recordsChanged: sum.recordsChanged + item.recordsChanged,
        pathsChanged: sum.pathsChanged + item.pathsChanged,
      }),
      { recordsScanned: 0, recordsChanged: 0, pathsChanged: 0 },
    );

    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      fromRoot,
      portablePrefix: PORTABLE_STORAGE_PATH_PREFIX,
      filesModified: false,
      summaries,
      totals,
      nextCommand: apply || totals.pathsChanged === 0
        ? null
        : "Re-run with --apply after reviewing this output.",
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
