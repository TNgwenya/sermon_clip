import { NextResponse } from "next/server";

import {
  normalizeClipIds,
  normalizePostingAutomationMode,
  normalizePostingPlatforms,
  type PostingPlatform,
} from "@/lib/postingDrafts";
import { runPublishingPreflight } from "@/lib/publishingPreflightServer";

function normalizeSelectedAccountIds(
  value: unknown,
  platforms: PostingPlatform[],
): Partial<Record<PostingPlatform, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return platforms.reduce((result, platform) => {
    const ids = (value as Record<string, unknown>)[platform];
    if (!Array.isArray(ids)) {
      return result;
    }

    const normalized = Array.from(new Set(ids.filter((id): id is string => (
      typeof id === "string" && id.trim().length > 0
    ))));
    return normalized.length > 0 ? { ...result, [platform]: normalized } : result;
  }, {} as Partial<Record<PostingPlatform, string[]>>);
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const clipIds = normalizeClipIds(body?.clipIds);
  const platforms = normalizePostingPlatforms(body?.platforms);
  const automationMode = normalizePostingAutomationMode(body?.automationMode);
  const selectedAccountIdsByPlatform = normalizeSelectedAccountIds(body?.socialAccountIdsByPlatform, platforms);

  if (clipIds.length === 0 || platforms.length === 0) {
    return NextResponse.json({ error: "Choose at least one clip and platform to run publishing checks." }, { status: 400 });
  }

  const preflight = await runPublishingPreflight({
    clipIds,
    automationMode,
    platforms,
    selectedAccountIdsByPlatform,
    controlPanelMode: process.env.VERCEL === "1" || process.env.CONTROL_PANEL_MODE === "true",
  });

  return NextResponse.json({ preflight });
}
