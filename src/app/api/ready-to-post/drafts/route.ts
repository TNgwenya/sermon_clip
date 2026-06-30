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
  PostingDraftValidationError,
  type PostingPlatform,
} from "@/lib/postingDrafts";
import { normalizeScheduleIntervalMinutes } from "@/lib/postingSchedule";
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
  const scheduleIntervalMinutes = normalizeScheduleIntervalMinutes(body?.scheduleIntervalMinutes, clipIds.length);
  const timezone = normalizeTimezone(body?.timezone);
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const socialAccountIdsByPlatform = normalizeSocialAccountIdsByPlatform(body?.socialAccountIdsByPlatform, platforms);

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
      durationSeconds: true,
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

  if (automationMode === "AUTOMATIC") {
    const zernioPlatforms = platforms.filter((platform) => platform === "TikTok" || platform === "Instagram");
    if (zernioPlatforms.length > 0) {
      const zernioAccounts = await prisma.socialAccount.findMany({
        where: {
          platform: { in: zernioPlatforms.map((platform) => platform === "TikTok" ? "TIKTOK" : "INSTAGRAM") },
          status: "CONNECTED",
          externalProvider: "zernio",
          externalAccountId: { not: null },
        },
        select: { id: true, platform: true },
      });
      const connectedPlatforms = new Set(zernioAccounts.map((account) => account.platform));
      const missingPlatforms = zernioPlatforms.filter((platform) => {
        const dbPlatform = platform === "TikTok" ? "TIKTOK" : "INSTAGRAM";
        return !connectedPlatforms.has(dbPlatform);
      });

      if (missingPlatforms.length > 0) {
        return NextResponse.json({
          error: `Sync a Zernio ${missingPlatforms.join(" and ")} account before automatic posting.`,
        }, { status: 409 });
      }

      const zernioAccountKeys = new Set(zernioAccounts.map((account) => `${account.platform}:${account.id}`));
      const invalidSelectedPlatforms = zernioPlatforms.filter((platform) => {
        const dbPlatform = platform === "TikTok" ? "TIKTOK" : "INSTAGRAM";
        return (socialAccountIdsByPlatform[platform] ?? []).some((accountId) => (
          !zernioAccountKeys.has(`${dbPlatform}:${accountId}`)
        ));
      });

      if (invalidSelectedPlatforms.length > 0) {
        return NextResponse.json({
          error: `Choose a synced Zernio ${invalidSelectedPlatforms.join(" and ")} account before automatic posting.`,
        }, { status: 409 });
      }
    }

    if (platforms.includes("Instagram")) {
      const longInstagramClip = readyClips.find((clip) => clip.durationSeconds > 60);
      if (longInstagramClip) {
        return NextResponse.json({
          error: "Instagram automatic posting is limited to clips of 60 seconds or less until longer Reels are verified.",
          clipIds: [longInstagramClip.id],
        }, { status: 409 });
      }
    }
  }

  let draft;
  try {
    draft = await createPostingDraft({
      clipIds,
      platforms,
      socialAccountIdsByPlatform,
      postingSlot: postingSlot || "This week",
      automationMode,
      scheduledFor,
      scheduleIntervalMinutes,
      timezone,
      caption,
      title,
      note,
    });
  } catch (error) {
    if (error instanceof PostingDraftValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }

  return NextResponse.json({ draft }, { status: 201 });
}

function normalizeSocialAccountIdsByPlatform(
  value: unknown,
  platforms: PostingPlatform[],
): Partial<Record<PostingPlatform, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const selectedPlatforms = new Set(platforms);
  const result: Partial<Record<PostingPlatform, string[]>> = {};
  for (const platform of platforms) {
    const accountIds = (value as Record<string, unknown>)[platform];
    if (!selectedPlatforms.has(platform) || !Array.isArray(accountIds)) {
      continue;
    }

    const normalizedIds = Array.from(new Set(accountIds.filter((item): item is string => (
      typeof item === "string" && item.trim().length > 0
    ))));
    if (normalizedIds.length > 0) {
      result[platform] = normalizedIds;
    }
  }

  return result;
}
