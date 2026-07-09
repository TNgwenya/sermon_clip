import { NextResponse } from "next/server";

import { renewScheduledPostClaim } from "@/lib/scheduledPosts";
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
  const renewed = await renewScheduledPostClaim({ id, workerId });

  if (!renewed) {
    return NextResponse.json({ error: "The publishing claim is no longer active." }, { status: 409 });
  }

  return NextResponse.json({ renewed: true, checkedAt: new Date().toISOString() });
}
