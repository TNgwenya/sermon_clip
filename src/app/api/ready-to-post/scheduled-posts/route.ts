import { NextResponse } from "next/server";

import {
  listScheduledPosts,
  normalizeManualPublishingStatus,
  updateScheduledPostStatus,
} from "@/lib/scheduledPosts";

export async function GET(): Promise<NextResponse> {
  const scheduledPosts = await listScheduledPosts();
  return NextResponse.json({ scheduledPosts });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const status = normalizeManualPublishingStatus(body?.status);

  if (!id) {
    return NextResponse.json({ error: "Choose a scheduled post to update." }, { status: 400 });
  }

  if (!status) {
    return NextResponse.json({ error: "Choose a valid manual publishing status." }, { status: 400 });
  }

  const scheduledPost = await updateScheduledPostStatus({ id, status });

  if (!scheduledPost) {
    return NextResponse.json({ error: "Scheduled post not found." }, { status: 404 });
  }

  return NextResponse.json({ scheduledPost });
}
