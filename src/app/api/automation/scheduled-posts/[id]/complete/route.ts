import { NextResponse } from "next/server";

import {
  completeScheduledPost,
  normalizeCompleteScheduledPostStatus,
} from "@/lib/scheduledPosts";
import { getWorkerId, requireWorkerAuth } from "@/lib/workerAuth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const authError = requireWorkerAuth(request);
  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = normalizeCompleteScheduledPostStatus(body?.status);
  const workerId = getWorkerId(body?.workerId);

  if (!status) {
    return NextResponse.json({ error: "Choose a valid completion status." }, { status: 400 });
  }

  const scheduledPost = await completeScheduledPost({
    id,
    workerId,
    status,
    externalPostId: typeof body?.externalPostId === "string" ? body.externalPostId : null,
    publishedUrl: typeof body?.publishedUrl === "string" ? body.publishedUrl : null,
    publishError: typeof body?.publishError === "string" ? body.publishError : null,
    finalPrivacyStatus: typeof body?.finalPrivacyStatus === "string" ? body.finalPrivacyStatus : null,
    mediaObjectKey: typeof body?.mediaObjectKey === "string" ? body.mediaObjectKey : null,
    mediaPublicUrl: typeof body?.mediaPublicUrl === "string" ? body.mediaPublicUrl : null,
    mediaUploadedAt: typeof body?.mediaUploadedAt === "string" ? new Date(body.mediaUploadedAt) : null,
  });

  if (!scheduledPost) {
    return NextResponse.json({ error: "Scheduled post not found." }, { status: 404 });
  }

  return NextResponse.json({ scheduledPost });
}
