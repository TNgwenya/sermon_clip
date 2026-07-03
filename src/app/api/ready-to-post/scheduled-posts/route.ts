import { NextResponse } from "next/server";

import {
  deleteScheduledPost,
  listScheduledPosts,
  normalizeManualPublishingStatus,
  normalizeScheduledPostAction,
  postScheduledPostNow,
  updateScheduledPostSchedule,
  updateScheduledPostStatus,
} from "@/lib/scheduledPosts";

export async function GET(): Promise<NextResponse> {
  const scheduledPosts = await listScheduledPosts();
  return NextResponse.json({ scheduledPosts });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const action = normalizeScheduledPostAction(body?.action);
  const status = normalizeManualPublishingStatus(body?.status);
  const scheduledFor = typeof body?.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim().slice(0, 80) : null;

  if (!id) {
    return NextResponse.json({ error: "Choose a scheduled post to update." }, { status: 400 });
  }

  if (action === "POST_NOW") {
    const scheduledPost = await postScheduledPostNow({ id });

    if (!scheduledPost) {
      return NextResponse.json({ error: "Only automatic planned posts can be moved to post now." }, { status: 400 });
    }

    return NextResponse.json({ scheduledPost });
  }

  if (scheduledFor && !Number.isNaN(scheduledFor.getTime())) {
    if (scheduledFor.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "Choose a future time for this scheduled post." }, { status: 400 });
    }

    const scheduledPost = await updateScheduledPostSchedule({ id, scheduledFor, timezone });

    if (!scheduledPost) {
      return NextResponse.json({ error: "Scheduled post not found." }, { status: 404 });
    }

    return NextResponse.json({ scheduledPost });
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

export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "Choose a scheduled post to cancel." }, { status: 400 });
  }

  const deleted = await deleteScheduledPost({ id });
  if (!deleted) {
    return NextResponse.json({ error: "Scheduled post not found." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
