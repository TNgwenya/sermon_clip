import { NextResponse } from "next/server";

import {
  deleteScheduledPost,
  listScheduledPosts,
  normalizeManualPublishingStatus,
  normalizeRestorablePublishingStatus,
  normalizeScheduledPostAction,
  postScheduledPostNow,
  restoreScheduledPostStatus,
  ScheduledPostMutationConflictError,
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
  const restoreStatus = normalizeRestorablePublishingStatus(body?.restoreStatus);
  const expectedCurrentStatus = body?.expectedCurrentStatus === "POSTED" || body?.expectedCurrentStatus === "SKIPPED"
    ? body.expectedCurrentStatus
    : null;
  const scheduledFor = typeof body?.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim().slice(0, 80) : null;

  if (!id) {
    return NextResponse.json({ error: "Choose a scheduled post to update." }, { status: 400 });
  }

  try {
    if (action === "RESTORE_PREVIOUS") {
      if (!restoreStatus || !expectedCurrentStatus) {
        return NextResponse.json({ error: "The previous publishing status could not be verified." }, { status: 400 });
      }

      const scheduledPost = await restoreScheduledPostStatus({
        id,
        status: restoreStatus,
        expectedCurrentStatus,
      });
      if (!scheduledPost) {
        return NextResponse.json({
          error: "This post can no longer be restored safely. Refresh the publishing desk before taking another action.",
        }, { status: 409 });
      }

      return NextResponse.json({ scheduledPost });
    }

    if (action === "POST_NOW") {
      const scheduledPost = await postScheduledPostNow({ id });

      if (!scheduledPost) {
        return NextResponse.json({
          error: "Only automatic planned posts or safely failed attempts can be queued. Refresh before trying again.",
        }, { status: 409 });
      }

      return NextResponse.json({ scheduledPost });
    }

    if (scheduledFor && !Number.isNaN(scheduledFor.getTime())) {
      if (scheduledFor.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: "Choose a future time for this scheduled post." }, { status: 400 });
      }

      const scheduledPost = await updateScheduledPostSchedule({ id, scheduledFor, timezone });

      if (!scheduledPost) {
        return NextResponse.json({
          error: "This post can no longer be rescheduled safely. Check the platform or refresh its publishing status first.",
        }, { status: 409 });
      }

      return NextResponse.json({ scheduledPost });
    }

    if (!status) {
      return NextResponse.json({ error: "Choose a valid manual publishing status." }, { status: 400 });
    }

    const scheduledPost = await updateScheduledPostStatus({ id, status });

    if (!scheduledPost) {
      return NextResponse.json({
        error: "This publishing status changed before your update. Refresh the publishing desk and confirm the current result.",
      }, { status: 409 });
    }

    return NextResponse.json({ scheduledPost });
  } catch (error) {
    if (error instanceof ScheduledPostMutationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "Choose a scheduled post to cancel." }, { status: 400 });
  }

  try {
    const deleted = await deleteScheduledPost({ id });
    if (!deleted) {
      return NextResponse.json({
        error: "This post cannot be cancelled while it is publishing, posted, or waiting for platform verification.",
      }, { status: 409 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ScheduledPostMutationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
