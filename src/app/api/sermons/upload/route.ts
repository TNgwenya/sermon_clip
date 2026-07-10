import { createWriteStream } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildLocalUploadSourceUrl,
  buildUploadedMediaCheckFailureMessage,
  createSermonSchema,
  MAX_UPLOADED_MEDIA_BYTES,
  UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
} from "@/lib/sermonIntake";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getAudioPath,
  getSourceVideoPath,
  getTranscriptJsonPath,
} from "@/server/agents/storage";
import { processSermonPipeline } from "@/server/pipeline/processSermonPipeline";
import { mediaFileIsUsable } from "@/server/media/fileGuards";
import {
  canRunLocalMediaProcessing,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";

export const runtime = "nodejs";

function getUploadedSourceTempPath(sourceVideoPath: string): string {
  return sourceVideoPath.replace(/\.mp4$/i, ".upload.partial.mp4");
}

async function streamRequestBodyToFile(request: Request, filePath: string, flags: "w" | "a" = "w"): Promise<number> {
  if (!request.body) {
    throw new Error("The upload request did not include a readable file body.");
  }

  await pipeline(Readable.fromWeb(request.body as unknown as NodeReadableStream), createWriteStream(filePath, { flags }));
  const fileStat = await stat(filePath);
  return fileStat.size;
}

function parseByteParam(url: URL, name: string): number | null {
  const value = Number(url.searchParams.get(name));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseContentLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  const value = header ? Number(header) : null;
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function fieldErrorsFromResult(result: ReturnType<typeof createSermonSchema.safeParse>) {
  if (result.success) {
    return undefined;
  }

  const fieldErrors = result.error.flatten().fieldErrors;
  return {
    youtubeUrl: fieldErrors.youtubeUrl?.[0],
    title: fieldErrors.title?.[0],
    speakerName: fieldErrors.speakerName?.[0],
    churchName: fieldErrors.churchName?.[0],
    language: fieldErrors.language?.[0],
    sermonStartTimestamp: fieldErrors.sermonStartTimestamp?.[0],
    sermonEndTimestamp: fieldErrors.sermonEndTimestamp?.[0],
    sermonDate: fieldErrors.sermonDate?.[0],
    mediaFile: fieldErrors.youtubeUrl?.[0],
    rightsConfirmed: fieldErrors.rightsConfirmed?.[0],
  };
}

function startUploadedSermonPipeline(sermonId: string): void {
  void processSermonPipeline(sermonId)
    .then((result) => {
      revalidatePath(`/sermons/${sermonId}`);
      revalidatePath("/");
      return appendPipelineLog(sermonId, `One-click pipeline completed from raw upload. ${result.summary}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown one-click pipeline error.";
      return appendPipelineLog(sermonId, `One-click pipeline failed after raw upload: ${message}`);
    });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!canRunLocalMediaProcessing()) {
    return NextResponse.json(
      {
        success: false,
        message: localMediaProcessingUnavailableMessage("Media upload"),
        fieldErrors: { mediaFile: "File uploads are local-worker only until shared storage is configured." },
      },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const uploadMode = url.searchParams.get("uploadMode") ?? "direct";
  const fileName = url.searchParams.get("fileName")?.trim() || "sermon-media";
  const contentLength = parseContentLength(request);
  const totalBytes = parseByteParam(url, "totalBytes");

  if ((contentLength !== null && contentLength > MAX_UPLOADED_MEDIA_BYTES) || (totalBytes !== null && totalBytes > MAX_UPLOADED_MEDIA_BYTES)) {
    return NextResponse.json(
      { success: false, message: UPLOADED_MEDIA_TOO_LARGE_MESSAGE, fieldErrors: { mediaFile: UPLOADED_MEDIA_TOO_LARGE_MESSAGE } },
      { status: 413 },
    );
  }

  if (uploadMode === "chunk") {
    const sermonId = url.searchParams.get("sermonId") ?? "";
    const offset = parseByteParam(url, "offset");

    if (!sermonId || offset === null || totalBytes === null) {
      return NextResponse.json(
        { success: false, message: "The chunk upload request was missing required upload details.", fieldErrors: { mediaFile: "The upload could not continue. Try again." } },
        { status: 400 },
      );
    }

    const sermon = await prisma.sermon.findUnique({ where: { id: sermonId }, select: { id: true, title: true } });
    if (!sermon) {
      return NextResponse.json(
        { success: false, message: "The upload session could not be found.", fieldErrors: { mediaFile: "The upload session expired. Try again." } },
        { status: 404 },
      );
    }

    try {
      await ensureSermonFolders(sermon.id, sermon.title);
      const tempSourceVideoPath = getUploadedSourceTempPath(getSourceVideoPath(sermon.id));
      const existingBytes = await stat(/* turbopackIgnore: true */ tempSourceVideoPath).then((fileStat) => fileStat.size).catch(() => 0);
      if (existingBytes !== offset) {
        throw new Error(`The upload chunk arrived out of order. Expected offset ${existingBytes} but received ${offset}.`);
      }

      const finalBytes = await streamRequestBodyToFile(request, tempSourceVideoPath, offset === 0 ? "w" : "a");
      if (contentLength !== null && finalBytes !== offset + contentLength) {
        throw new Error(`The upload chunk ended early. Expected ${offset + contentLength} bytes but received ${finalBytes} bytes.`);
      }

      return NextResponse.json({ success: true, message: "Upload chunk received.", receivedBytes: finalBytes, createdSermonId: sermon.id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown chunk upload error.";
      console.error(`Raw upload chunk failed for sermon ${sermon.id}: ${reason}`);
      return NextResponse.json(
        { success: false, message: reason, fieldErrors: { mediaFile: reason }, createdSermonId: sermon.id },
        { status: 400 },
      );
    }
  }

  if (uploadMode === "finish") {
    const sermonId = url.searchParams.get("sermonId") ?? "";
    if (!sermonId || totalBytes === null) {
      return NextResponse.json(
        { success: false, message: "The upload finalization request was missing required upload details.", fieldErrors: { mediaFile: "The upload could not be finalized. Try again." } },
        { status: 400 },
      );
    }

    const sermon = await prisma.sermon.findUnique({ where: { id: sermonId }, select: { id: true, title: true } });
    if (!sermon) {
      return NextResponse.json(
        { success: false, message: "The upload session could not be found.", fieldErrors: { mediaFile: "The upload session expired. Try again." } },
        { status: 404 },
      );
    }

    try {
      await ensureSermonFolders(sermon.id, sermon.title);
      const sourceVideoPath = getSourceVideoPath(sermon.id);
      const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
      const receivedBytes = await stat(/* turbopackIgnore: true */ tempSourceVideoPath).then((fileStat) => fileStat.size).catch(() => 0);
      if (receivedBytes !== totalBytes) {
        throw new Error(`The upload ended early. Expected ${totalBytes} bytes but received ${receivedBytes} bytes.`);
      }

      const uploadedMediaCheck = await mediaFileIsUsable(tempSourceVideoPath);
      if (!uploadedMediaCheck.usable) {
        throw new Error(buildUploadedMediaCheckFailureMessage(uploadedMediaCheck.reason));
      }

      await rename(/* turbopackIgnore: true */ tempSourceVideoPath, /* turbopackIgnore: true */ sourceVideoPath);

      const finalizedUpload = await mediaFileIsUsable(sourceVideoPath);
      if (!finalizedUpload.usable) {
        await unlink(/* turbopackIgnore: true */ sourceVideoPath).catch(() => undefined);
        throw new Error(buildUploadedMediaCheckFailureMessage(finalizedUpload.reason));
      }

      await prisma.sermon.update({
        where: { id: sermon.id },
        data: {
          sourceVideoPath,
          audioPath: getAudioPath(sermon.id),
          transcriptJsonPath: getTranscriptJsonPath(sermon.id),
          sourceDurationSeconds: finalizedUpload.durationSeconds,
          status: "DOWNLOADED",
        },
      });

      await appendPipelineLog(sermon.id, "Sermon created from chunked uploaded media file and storage folders initialized.");
      revalidatePath("/");
      startUploadedSermonPipeline(sermon.id);

      return NextResponse.json({
        success: true,
        message: "Sermon saved. The full clip workflow has started automatically.",
        createdSermonId: sermon.id,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown upload finalization error.";
      console.error(`Raw upload finalization failed for sermon ${sermon.id}: ${reason}`);
      return NextResponse.json(
        { success: false, message: reason, fieldErrors: { mediaFile: reason }, createdSermonId: sermon.id },
        { status: 400 },
      );
    }
  }

  const values = {
    youtubeUrl: "",
    title: url.searchParams.get("title") ?? "",
    speakerName: url.searchParams.get("speakerName") ?? "",
    churchName: url.searchParams.get("churchName") ?? "",
    language: url.searchParams.get("language") ?? "",
    sermonStartTimestamp: url.searchParams.get("sermonStartTimestamp") ?? "",
    sermonEndTimestamp: url.searchParams.get("sermonEndTimestamp") ?? "",
    sermonDate: url.searchParams.get("sermonDate") ?? "",
    rightsConfirmed: url.searchParams.get("rightsConfirmed") === "true",
    hasUploadedVideo: true,
  };

  const result = createSermonSchema.safeParse(values);
  if (!result.success) {
    return NextResponse.json(
      { success: false, message: "Please correct the highlighted fields.", fieldErrors: fieldErrorsFromResult(result) },
      { status: 400 },
    );
  }

  try {
    const sermon = await prisma.sermon.create({
      data: {
        youtubeUrl: buildLocalUploadSourceUrl(fileName),
        title: result.data.title,
        speakerName: result.data.speakerName,
        churchName: result.data.churchName,
        language: result.data.language,
        sermonStartSeconds: result.data.sermonStartSeconds,
        sermonEndSeconds: result.data.sermonEndSeconds,
        analyzeFullRecording: false,
        sermonDate: result.data.sermonDate,
        rightsConfirmed: result.data.rightsConfirmed,
        status: "CREATED",
      },
      select: { id: true, title: true },
    });

    if (uploadMode === "start") {
      try {
        await ensureSermonFolders(sermon.id, sermon.title);
        const sourceVideoPath = getSourceVideoPath(sermon.id);
        const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
        await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);
        await unlink(/* turbopackIgnore: true */ sourceVideoPath).catch(() => undefined);
      } catch (storageError) {
        const reason = storageError instanceof Error ? storageError.message : "Unknown storage setup error.";
        console.error(`Raw upload session initialization failed for sermon ${sermon.id}: ${reason}`);
        return NextResponse.json(
          { success: false, message: reason, fieldErrors: { mediaFile: reason }, createdSermonId: sermon.id },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "Upload session started.",
        createdSermonId: sermon.id,
      });
    }

    try {
      await ensureSermonFolders(sermon.id, sermon.title);
      const sourceVideoPath = getSourceVideoPath(sermon.id);
      const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
      await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);

      try {
        const receivedBytes = await streamRequestBodyToFile(request, tempSourceVideoPath);
        if (receivedBytes === 0) {
          throw new Error("No media file was received.");
        }
        if (receivedBytes > MAX_UPLOADED_MEDIA_BYTES) {
          throw new Error(UPLOADED_MEDIA_TOO_LARGE_MESSAGE);
        }
        if (contentLength !== null && Number.isFinite(contentLength) && receivedBytes !== contentLength) {
          throw new Error(`The upload ended early. Expected ${contentLength} bytes but received ${receivedBytes} bytes.`);
        }

        const uploadedMediaCheck = await mediaFileIsUsable(tempSourceVideoPath);
        if (!uploadedMediaCheck.usable) {
          throw new Error(buildUploadedMediaCheckFailureMessage(uploadedMediaCheck.reason));
        }

        await rename(/* turbopackIgnore: true */ tempSourceVideoPath, /* turbopackIgnore: true */ sourceVideoPath);

        const finalizedUpload = await mediaFileIsUsable(sourceVideoPath);
        if (!finalizedUpload.usable) {
          await unlink(/* turbopackIgnore: true */ sourceVideoPath).catch(() => undefined);
          throw new Error(buildUploadedMediaCheckFailureMessage(finalizedUpload.reason));
        }

        await prisma.sermon.update({
          where: { id: sermon.id },
          data: {
            sourceVideoPath,
            audioPath: getAudioPath(sermon.id),
            transcriptJsonPath: getTranscriptJsonPath(sermon.id),
            sourceDurationSeconds: finalizedUpload.durationSeconds,
            status: "DOWNLOADED",
          },
        });
      } catch (uploadError) {
        await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);
        throw uploadError;
      }

      await appendPipelineLog(sermon.id, "Sermon created from raw uploaded media file and storage folders initialized.");
    } catch (storageError) {
      const reason = storageError instanceof Error ? storageError.message : "Unknown storage setup error.";
      console.error(`Raw upload storage initialization failed for sermon ${sermon.id}: ${reason}`);
      return NextResponse.json(
        { success: false, message: reason, fieldErrors: { mediaFile: reason }, createdSermonId: sermon.id },
        { status: 400 },
      );
    }

    revalidatePath("/");
    startUploadedSermonPipeline(sermon.id);

    return NextResponse.json({
      success: true,
      message: "Sermon saved. The full clip workflow has started automatically.",
      createdSermonId: sermon.id,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown save error.";
    console.error(`Raw upload sermon creation failed: ${reason}`);
    return NextResponse.json(
      {
        success: false,
        message: `The upload could not be saved. Reason: ${reason}`,
        fieldErrors: { mediaFile: `The upload could not be saved. Reason: ${reason}` },
      },
      { status: 500 },
    );
  }
}