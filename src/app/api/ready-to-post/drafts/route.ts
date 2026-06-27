import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  createPostingDraft,
  listPostingDrafts,
  normalizeClipIds,
  normalizePostingAutomationMode,
  normalizePostingPlatforms,
  normalizeScheduledFor,
  normalizeTimezone,
} from "@/lib/postingDrafts";
import { resolveReadyMedia } from "@/lib/readyMedia";

export async function GET(): Promise<NextResponse> {
  const drafts = await listPostingDrafts();
  return NextResponse.json({ drafts });
}

export async function POST(request: Request): Promise<NextResponse> {
  const controlPanelMode = process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true";
  const body = await request.json().catch(() => null);
  const clipIds = normalizeClipIds(body?.clipIds);
  const platforms = normalizePostingPlatforms(body?.platforms);
  const postingSlot = typeof body?.postingSlot === "string" ? body.postingSlot.trim() : "";
  const automationMode = normalizePostingAutomationMode(body?.automationMode);
  const scheduledFor = normalizeScheduledFor(body?.scheduledFor);
  const timezone = normalizeTimezone(body?.timezone);
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (clipIds.length === 0) {
    return NextResponse.json({ error: "Select at least one finished clip to schedule." }, { status: 400 });
  }

  if (platforms.length === 0) {
    return NextResponse.json({ error: "Choose at least one platform for the posting draft." }, { status: 400 });
  }

  if (automationMode === "AUTOMATIC" && !scheduledFor) {
    return NextResponse.json({ error: "Choose an exact date and time for automatic posting." }, { status: 400 });
  }

  if (automationMode === "AUTOMATIC" && scheduledFor && scheduledFor.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Choose a future time for automatic posting." }, { status: 400 });
  }

  const readyClips = await prisma.clipCandidate.findMany({
    where: {
      id: { in: clipIds },
      OR: [
        { exportStatus: "COMPLETED" },
        { status: "EXPORTED" },
      ],
    },
    select: {
      id: true,
      exportFormat: true,
      exportedFilePath: true,
      exportPath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      renderedFilePath: true,
    },
  });

  if (readyClips.length !== clipIds.length) {
    const readyIds = new Set(readyClips.map((clip) => clip.id));
    return NextResponse.json({
      error: "Some selected clips are not ready to schedule yet.",
      clipIds: clipIds.filter((clipId) => !readyIds.has(clipId)),
    }, { status: 409 });
  }

  const mediaChecks = await Promise.all(
    readyClips.map(async (clip) => ({
      id: clip.id,
      media: await resolveReadyMedia(clip, { trustMetadata: controlPanelMode }),
    })),
  );
  const missingMediaClipIds = mediaChecks
    .filter((item) => !item.media.mediaReady)
    .map((item) => item.id);

  if (missingMediaClipIds.length > 0) {
    return NextResponse.json({
      error: "Some selected clips need their posting media rebuilt before scheduling.",
      clipIds: missingMediaClipIds,
    }, { status: 409 });
  }

  const draft = await createPostingDraft({
    clipIds,
    platforms,
    postingSlot: postingSlot || "This week",
    automationMode,
    scheduledFor,
    timezone,
    caption,
    title,
    note,
  });

  return NextResponse.json({ draft }, { status: 201 });
}
