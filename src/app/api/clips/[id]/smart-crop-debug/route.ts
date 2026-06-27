import { readFile, stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const clipId = id.trim();

  if (!clipId) {
    return NextResponse.json({ error: "Clip id is required." }, { status: 400 });
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      smartCropDebugSnapshotPath: true,
    },
  });

  if (!clip?.smartCropDebugSnapshotPath) {
    return NextResponse.json({ error: "No smart crop debug snapshot is available for this clip." }, { status: 404 });
  }

  if (!(await fileHasBytes(clip.smartCropDebugSnapshotPath))) {
    return NextResponse.json({ error: "Smart crop debug snapshot file is missing or empty." }, { status: 404 });
  }

  const image = await readFile(/* turbopackIgnore: true */ clip.smartCropDebugSnapshotPath);
  return new NextResponse(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="${clipId}-smart-crop-debug.jpg"`,
      "Cache-Control": "no-store",
    },
  });
}
