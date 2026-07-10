import { rename, unlink, writeFile } from "node:fs/promises";

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
  const fileName = url.searchParams.get("fileName")?.trim() || "sermon-media";
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_UPLOADED_MEDIA_BYTES) {
    return NextResponse.json(
      { success: false, message: UPLOADED_MEDIA_TOO_LARGE_MESSAGE, fieldErrors: { mediaFile: UPLOADED_MEDIA_TOO_LARGE_MESSAGE } },
      { status: 413 },
    );
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

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The upload stream ended before the file was received.";
    return NextResponse.json(
      {
        success: false,
        message: `The upload did not finish. Reason: ${message}`,
        fieldErrors: { mediaFile: "The upload did not finish. Keep the tab open and try again, or use a YouTube link." },
      },
      { status: 400 },
    );
  }

  if (body.byteLength === 0) {
    return NextResponse.json(
      { success: false, message: "No media file was received.", fieldErrors: { mediaFile: "Choose a media file before uploading." } },
      { status: 400 },
    );
  }

  if (body.byteLength > MAX_UPLOADED_MEDIA_BYTES) {
    return NextResponse.json(
      { success: false, message: UPLOADED_MEDIA_TOO_LARGE_MESSAGE, fieldErrors: { mediaFile: UPLOADED_MEDIA_TOO_LARGE_MESSAGE } },
      { status: 413 },
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

    try {
      await ensureSermonFolders(sermon.id, sermon.title);
      const sourceVideoPath = getSourceVideoPath(sermon.id);
      const tempSourceVideoPath = getUploadedSourceTempPath(sourceVideoPath);
      await unlink(/* turbopackIgnore: true */ tempSourceVideoPath).catch(() => undefined);

      try {
        await writeFile(/* turbopackIgnore: true */ tempSourceVideoPath, Buffer.from(body));
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