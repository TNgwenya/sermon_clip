import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  buildClipCoverFrameSelection,
  buildNeutralCoverFrameCandidates,
  isClipCoverFrameSelectionStale,
  mergeClipCoverFrameSelection,
  parseClipCoverFrameSelection,
} from "@/lib/clipCoverFrame";
import { prisma } from "@/lib/prisma";
import { resolveClipThumbnailSource } from "@/server/agents/clipThumbnailService";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

const COVER_FRAME_SELECT = {
  id: true,
  sermonId: true,
  title: true,
  captionData: true,
  startTimeSeconds: true,
  endTimeSeconds: true,
  durationSeconds: true,
  renderedFilePath: true,
  overlayVideoPath: true,
  captionedVideoPath: true,
  exportedFilePath: true,
  renderFreshness: true,
  overlayFreshness: true,
  captionBurnFreshness: true,
  exportFreshness: true,
  renderedAt: true,
  overlayRenderedAt: true,
  captionBurnedAt: true,
  exportedAt: true,
  renderAssetVersion: true,
  overlayAssetVersion: true,
  captionBurnAssetVersion: true,
  exportAssetVersion: true,
  thumbnailPath: true,
  thumbnailError: true,
  updatedAt: true,
} as const;

function clipDurationSeconds(clip: { durationSeconds: number; startTimeSeconds: number; endTimeSeconds: number }): number {
  if (Number.isFinite(clip.durationSeconds) && clip.durationSeconds > 0) {
    return clip.durationSeconds;
  }
  return Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds);
}

function hasSafeMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Server-side calls and route tests do not always carry Origin. Browser
    // mutations do, and are checked below to prevent cross-site writes.
    return true;
  }

  try {
    const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === requestHost;
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
    return NextResponse.json({ error: "Clip id is required." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const clip = await prisma.clipCandidate.findUnique({ where: { id: clipId }, select: COVER_FRAME_SELECT });
  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const durationSeconds = clipDurationSeconds(clip);
  const selection = parseClipCoverFrameSelection(clip.captionData);
  const resolvedSource = canRunLocalMediaProcessing() ? await resolveClipThumbnailSource(clip) : null;

  return NextResponse.json({
    durationSeconds,
    candidates: buildNeutralCoverFrameCandidates(durationSeconds),
    selection,
    selectionStale: resolvedSource
      ? isClipCoverFrameSelectionStale(selection, resolvedSource.source, durationSeconds)
      : false,
    sourceAvailable: Boolean(resolvedSource),
  }, { headers: NO_STORE_HEADERS });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const clipId = id.trim();
  if (!clipId) {
    return NextResponse.json({ error: "Clip id is required." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!hasSafeMutationOrigin(request)) {
    return NextResponse.json({ error: "Cross-site cover frame updates are not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
  }
  if (!canRunLocalMediaProcessing()) {
    return NextResponse.json(
      { error: "Cover frame selection is available when the local media worker is connected." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const payload = await request.json().catch(() => null) as { timeSeconds?: unknown } | null;
  if (!payload || typeof payload.timeSeconds !== "number" || !Number.isFinite(payload.timeSeconds) || payload.timeSeconds < 0) {
    return NextResponse.json(
      { error: "Choose a valid moment from this clip." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const clip = await prisma.clipCandidate.findUnique({ where: { id: clipId }, select: COVER_FRAME_SELECT });
  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const resolvedSource = await resolveClipThumbnailSource(clip);
  if (!resolvedSource) {
    return NextResponse.json(
      { error: "Prepare a clip preview before choosing its cover frame." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const durationSeconds = clipDurationSeconds(clip);
  const selection = buildClipCoverFrameSelection({
    timeSeconds: payload.timeSeconds,
    durationSeconds,
    source: resolvedSource.source,
    selectedBy: "USER",
  });
  const captionData = mergeClipCoverFrameSelection(clip.captionData, selection) as Prisma.InputJsonValue;
  const update = await prisma.clipCandidate.updateMany({
    where: { id: clip.id, updatedAt: clip.updatedAt },
    data: {
      captionData,
      thumbnailPath: null,
      thumbnailGeneratedAt: null,
      thumbnailError: null,
    },
  });

  if (update.count !== 1) {
    return NextResponse.json(
      { error: "This clip changed while you were choosing a frame. Review it and try again." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({
    selection,
    posterUrl: `/api/clips/${encodeURIComponent(clip.id)}/thumbnail?cover=${encodeURIComponent(selection.selectedAt)}`,
  }, { headers: NO_STORE_HEADERS });
}

