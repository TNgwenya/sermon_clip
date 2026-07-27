import { NextResponse } from "next/server";

import {
  normalizeClipPostingCompositionIdentities,
  revalidateClaimedScheduledPostComposition,
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
  const workerId = getWorkerId(body?.workerId);
  const compositionIdentities = normalizeClipPostingCompositionIdentities(body?.compositionIdentities);
  if (!compositionIdentities || compositionIdentities.length === 0) {
    return NextResponse.json(
      { error: "A claimed clip composition identity is required." },
      { status: 400 },
    );
  }

  const result = await revalidateClaimedScheduledPostComposition({
    id,
    workerId,
    compositionIdentities,
  });
  if (!result.valid) {
    return NextResponse.json(
      { error: result.reason, released: result.released },
      { status: 409 },
    );
  }

  return NextResponse.json({ valid: true });
}
