import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { videoFileResponse } from "@/server/http/videoFileResponse";

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sermonId = id.trim();

  if (!sermonId) {
    return NextResponse.json({ error: "Sermon id is required." }, { status: 400 });
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: { sourceVideoPath: true },
  });

  if (!sermon) {
    return NextResponse.json({ error: "Sermon not found." }, { status: 404 });
  }

  if (!sermon.sourceVideoPath) {
    return NextResponse.json({ error: "Source video is not available for this sermon." }, { status: 409 });
  }

  const hasSourceVideo = await fileHasBytes(sermon.sourceVideoPath);
  if (!hasSourceVideo) {
    return NextResponse.json({ error: "Source video is missing or empty on disk." }, { status: 404 });
  }

  return videoFileResponse({
    request,
    filePath: sermon.sourceVideoPath,
    disposition: "inline",
  });
}
