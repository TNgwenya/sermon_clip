import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { detectClipStudioAudioSilenceEvents } from "@/server/agents/clipStudioAudioReviewService";
import { canRunInlineMediaProcessing } from "@/server/runtime/workerRuntime";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const clipId = id.trim();

  if (!clipId) {
    return NextResponse.json({ error: "Clip id is required." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!canRunInlineMediaProcessing()) {
    return NextResponse.json(
      { error: "Exact audio review runs on the local media worker." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      sermon: {
        select: { sourceVideoPath: true },
      },
    },
  });

  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const sourceVideoPath = clip.sermon.sourceVideoPath;
  if (!sourceVideoPath) {
    return NextResponse.json(
      { error: "The sermon source video is not available for audio review." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const sourceFileReady = await stat(sourceVideoPath)
    .then((fileStat) => fileStat.isFile() && fileStat.size > 0)
    .catch(() => false);

  if (!sourceFileReady) {
    return NextResponse.json(
      { error: "The sermon source video could not be opened for audio review." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const events = await detectClipStudioAudioSilenceEvents({
      sourceVideoPath,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      ffmpegPath: process.env.FFMPEG_PATH,
    });

    return NextResponse.json(
      { analyzed: true, events },
      {
        headers: {
          // The URL contains the saved clip timing, so repeat visits can reuse
          // this deterministic review without delaying Studio again.
          "Cache-Control": "private, max-age=300",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Exact pause analysis is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
