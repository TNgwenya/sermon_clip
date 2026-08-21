import { rename, unlink } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  ensureProcessingJobRunning,
  markJobFailed,
  markJobSucceeded,
  resolveProcessingJob,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { mediaFileIsUsable } from "@/server/media/fileGuards";
import { assertMediaStorageCapacity } from "@/server/media/storageCapacity";
import { downloadReadyS3SourceToFile } from "@/server/media/s3SourceStorage";
import { updateSermonStatus } from "@/server/status/sermonStatus";

type MaterializationOptions = {
  processingJobId?: string;
};

type MaterializationResult = {
  sourceVideoPath: string;
  reusedExistingFile: boolean;
};

const activeMaterializations = new Map<string, Promise<MaterializationResult>>();

function temporaryS3SourcePath(sourceVideoPath: string): string {
  return sourceVideoPath.replace(/\.mp4$/i, ".s3.partial.mp4");
}

async function runS3SermonSourceMaterialization(
  sermonId: string,
  options?: MaterializationOptions,
): Promise<MaterializationResult> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      sourceVideoPath: true,
      sourceAsset: {
        select: {
          bucket: true,
          objectKey: true,
          region: true,
          sizeBytes: true,
          status: true,
        },
      },
    },
  });
  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }
  if (!sermon.sourceAsset || sermon.sourceAsset.status !== "READY") {
    throw new Error("The sermon does not have a completed private S3 source upload.");
  }

  await ensureSermonFolders(sermon.id, sermon.title);
  const sourceVideoPath = getSourceVideoPath(sermon.id);
  const existingSource = await mediaFileIsUsable(sourceVideoPath);
  if (existingSource.usable) {
    await prisma.sermon.update({
      where: { id: sermon.id },
      data: {
        sourceVideoPath,
        sourceDurationSeconds: existingSource.durationSeconds,
      },
    });
    return { sourceVideoPath, reusedExistingFile: true };
  }

  const job = await resolveProcessingJob(sermon.id, "DOWNLOAD_VIDEO", options?.processingJobId);
  const temporaryPath = temporaryS3SourcePath(sourceVideoPath);
  try {
    await ensureProcessingJobRunning(job);
    await appendJobLog(job.id, "Private S3 source materialization started.");
    await appendPipelineLog(sermon.id, "Restoring the durable private S3 source to the media worker.");
    await updateSermonStatus(sermon.id, "DOWNLOADING");

    const incomingBytes = Number(sermon.sourceAsset.sizeBytes);
    if (!Number.isSafeInteger(incomingBytes) || incomingBytes <= 0) {
      throw new Error("The durable source asset has an invalid size.");
    }
    await assertMediaStorageCapacity({ incomingBytes });
    await unlink(temporaryPath).catch(() => undefined);
    await downloadReadyS3SourceToFile({
      owner: {
        organizationId: sermon.organizationId ?? "",
        sermonId: sermon.id,
      },
      asset: {
        ...sermon.sourceAsset,
        status: "READY",
      },
      destinationPath: temporaryPath,
    });

    const downloadedSource = await mediaFileIsUsable(temporaryPath);
    if (!downloadedSource.usable) {
      throw new Error(`The S3 source is not usable media: ${downloadedSource.reason}`);
    }

    await rename(temporaryPath, sourceVideoPath);
    const finalizedSource = await mediaFileIsUsable(sourceVideoPath);
    if (!finalizedSource.usable) {
      throw new Error(`The restored source is not usable media: ${finalizedSource.reason}`);
    }

    await prisma.sermon.update({
      where: { id: sermon.id },
      data: {
        sourceVideoPath,
        sourceDurationSeconds: finalizedSource.durationSeconds,
      },
    });
    await updateSermonStatus(sermon.id, "DOWNLOADED");
    await markJobSucceeded(
      job.id,
      `Private S3 source restored and validated (${incomingBytes} bytes, ${finalizedSource.durationSeconds.toFixed(2)} seconds).`,
    );
    await appendPipelineLog(
      sermon.id,
      `Private S3 source restored successfully (${finalizedSource.durationSeconds.toFixed(2)} seconds).`,
    );

    return { sourceVideoPath, reusedExistingFile: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown S3 source materialization error.";
    await unlink(temporaryPath).catch(() => undefined);
    await markJobFailed(job.id, message, "Private S3 source restoration failed.", {
      error,
      code: "S3_SOURCE_MATERIALIZATION_FAILED",
      stage: "source-materialization",
      retryable: true,
      details: {
        bucket: sermon.sourceAsset.bucket,
        objectKey: sermon.sourceAsset.objectKey,
      },
    });
    await updateSermonStatus(sermon.id, "FAILED").catch(() => undefined);
    throw error;
  }
}

export async function materializeS3SermonSource(
  sermonId: string,
  options?: MaterializationOptions,
): Promise<MaterializationResult> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    throw new Error("Sermon id is required for source restoration.");
  }

  const existing = activeMaterializations.get(normalizedSermonId);
  if (existing) {
    return existing;
  }

  const materialization = runS3SermonSourceMaterialization(normalizedSermonId, options);
  activeMaterializations.set(normalizedSermonId, materialization);
  try {
    return await materialization;
  } finally {
    if (activeMaterializations.get(normalizedSermonId) === materialization) {
      activeMaterializations.delete(normalizedSermonId);
    }
  }
}

export const __sourceMaterializationTestUtils = {
  activeMaterializations,
  temporaryS3SourcePath,
};
