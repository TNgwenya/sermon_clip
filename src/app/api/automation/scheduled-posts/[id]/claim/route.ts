import { NextResponse } from "next/server";

import { claimScheduledPost } from "@/lib/scheduledPosts";
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
  const workerId = getWorkerId(body?.workerId);

  const scheduledPost = await claimScheduledPost({
    id,
    workerId,
  });

  if (!scheduledPost) {
    return NextResponse.json({ error: "Scheduled post is not due or has already been claimed." }, { status: 409 });
  }

  return NextResponse.json({ scheduledPost });
}
