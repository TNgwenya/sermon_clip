import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { resourceAuthorizationErrorResponse } from "@/server/auth/resourceRouteAuthorization";
import { videoFileResponse } from "@/server/http/videoFileResponse";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { tenantScope } from "@/server/tenancy/scope";

function safeFilePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "teaching-video";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const exportId = id.trim();
  if (!exportId) {
    return NextResponse.json({ error: "Teaching-video export id is required." }, { status: 400 });
  }

  let requestContext;
  try {
    requestContext = await requireRequestCapability("content.export");
  } catch (error) {
    const response = resourceAuthorizationErrorResponse(error, "Teaching-video export not found.");
    if (response) return response;
    throw error;
  }
  const record = await prisma.teachingVideoExport.findFirst({
    where: {
      id: exportId,
      ...tenantScope(requestContext),
    },
    select: {
      status: true,
      filePath: true,
      teachingVideo: {
        select: {
          title: true,
          sermon: { select: { title: true, speakerName: true } },
        },
      },
    },
  });
  if (!record) {
    return NextResponse.json({ error: "Teaching-video export not found." }, { status: 404 });
  }
  if (record.status !== "COMPLETED" || !record.filePath) {
    return NextResponse.json({ error: "This teaching-video export is not ready." }, { status: 409 });
  }
  if (!canRunLocalMediaProcessing()) {
    return NextResponse.json(
      { error: "This export is stored on the local media worker." },
      { status: 409 },
    );
  }
  const fileStat = await stat(record.filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size <= 0) {
    return NextResponse.json({ error: "The exported video file is missing." }, { status: 404 });
  }

  const fileName = [
    safeFilePart(record.teachingVideo.sermon.title),
    safeFilePart(record.teachingVideo.title),
    safeFilePart(record.teachingVideo.sermon.speakerName),
  ].join("_") + ".mp4";
  return videoFileResponse({
    request,
    filePath: record.filePath,
    disposition: "attachment",
    downloadFileName: fileName,
  });
}
