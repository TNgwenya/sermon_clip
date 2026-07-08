import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveExportHistory } from "@/lib/clipExportSettings";
import { buildClipDownloadFileName } from "@/lib/exportNaming";
import { videoFileResponse } from "@/server/http/videoFileResponse";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function findExistingFile(candidates: Array<string | null | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate && await fileHasBytes(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const clipId = id.trim();

  if (!clipId) {
    return NextResponse.json({ error: "Clip id is required." }, { status: 400 });
  }

  if (!canRunLocalMediaProcessing()) {
    return NextResponse.json(
      { error: "Clip downloads live on the Mac media worker. Open the local app to download this file." },
      { status: 409 },
    );
  }

  const url = new URL(request.url);
  const historyId = (url.searchParams.get("historyId") ?? "").trim();

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      exportStatus: true,
      exportedFilePath: true,
      exportFormat: true,
      exportPath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      renderedFilePath: true,
      captionData: true,
      transcriptSafetyStatus: true,
      title: true,
      hook: true,
      caption: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          sermonDate: true,
        },
      },
    },
  });

  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  if (clip.transcriptSafetyStatus === "REVIEW_REQUIRED") {
    return NextResponse.json(
      { error: "Review the local-language transcript before downloading this clip for posting." },
      { status: 409 },
    );
  }

  if (historyId) {
    const history = resolveExportHistory(clip.captionData);
    const record = history.find((item) => item.id === historyId);
    if (!record || record.status !== "COMPLETED" || !record.outputPath) {
      return NextResponse.json({ error: "Requested export is not ready for download." }, { status: 409 });
    }

    const hasBytes = await fileHasBytes(record.outputPath);
    if (!hasBytes) {
      return NextResponse.json({ error: "This export record exists, but the video file is missing or empty." }, { status: 404 });
    }

    return videoFileResponse({
      request,
      filePath: record.outputPath,
      disposition: "attachment",
      downloadFileName: buildClipDownloadFileName({
        title: clip.sermon.title,
        speakerName: clip.sermon.speakerName,
        sermonDate: clip.sermon.sermonDate,
        clipTitle: clip.title,
        description: clip.hook || clip.caption,
        index: 1,
        extension: ".mp4",
      }),
    });
  }

  const variant = (url.searchParams.get("variant") ?? "best").toLowerCase();
  if (variant !== "vertical" && variant !== "best") {
    return NextResponse.json({ error: "Only best or vertical downloads are available here when a specific download history item is not selected." }, { status: 400 });
  }

  const downloadCandidates = variant === "vertical"
    ? [clip.exportFormat === "VERTICAL_9_16" ? clip.exportedFilePath : null, clip.exportPath, clip.overlayVideoPath, clip.captionedVideoPath, clip.renderedFilePath]
    : [clip.exportedFilePath, clip.exportPath, clip.overlayVideoPath, clip.captionedVideoPath, clip.renderedFilePath];
  const outputPath = await findExistingFile(downloadCandidates);

  if (!outputPath) {
    return NextResponse.json({ error: "The prepared download file is missing or not ready for this clip yet." }, { status: 409 });
  }

  return videoFileResponse({
    request,
    filePath: outputPath,
    disposition: "attachment",
    downloadFileName: buildClipDownloadFileName({
      title: clip.sermon.title,
      speakerName: clip.sermon.speakerName,
      sermonDate: clip.sermon.sermonDate,
      clipTitle: clip.title,
      description: clip.hook || clip.caption,
      index: 1,
      extension: ".mp4",
    }),
  });
}
