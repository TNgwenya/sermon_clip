import { NextResponse } from "next/server";

import { recordPublishingServiceHeartbeat } from "@/lib/publishingServiceHealth";
import { getWorkerId, requireWorkerAuth } from "@/lib/workerAuth";

export async function POST(request: Request): Promise<NextResponse> {
  const authError = requireWorkerAuth(request);
  if (authError) {
    return authError;
  }

  const body = await request.json().catch(() => null);
  const workerId = getWorkerId(body?.workerId);
  const dryRun = body?.dryRun === true;
  const cachedPostCount = Number.isFinite(body?.cachedPostCount)
    ? Math.max(0, Math.round(body.cachedPostCount))
    : 0;
  const capabilities = body?.capabilities && typeof body.capabilities === "object"
    ? {
      zernioConfigured: body.capabilities.zernioConfigured === true,
      youtubeConfigured: body.capabilities.youtubeConfigured === true,
      youtubeOAuthClientConfigured: body.capabilities.youtubeOAuthClientConfigured === true,
      facebookConfigured: body.capabilities.facebookConfigured === true,
      youtubePrivacy: typeof body.capabilities.youtubePrivacy === "string" && body.capabilities.youtubePrivacy.trim()
        ? body.capabilities.youtubePrivacy.trim().slice(0, 40)
        : "private",
      youtubeApiVerified: body.capabilities.youtubeApiVerified === true,
      facebookPublishesImmediately: body.capabilities.facebookPublishesImmediately === true,
      tiktokPrivacy: typeof body.capabilities.tiktokPrivacy === "string" && body.capabilities.tiktokPrivacy.trim()
        ? body.capabilities.tiktokPrivacy.trim().slice(0, 80)
        : null,
    }
    : {
      zernioConfigured: false,
      youtubeConfigured: false,
      youtubeOAuthClientConfigured: false,
      facebookConfigured: false,
      youtubePrivacy: "private",
      youtubeApiVerified: false,
      facebookPublishesImmediately: false,
      tiktokPrivacy: null,
    };

  const recorded = await recordPublishingServiceHeartbeat({
    workerId,
    dryRun,
    details: {
      cachedPostCount,
      capabilities,
    },
  });

  if (!recorded) {
    return NextResponse.json({ error: "Publishing heartbeat storage is not ready." }, { status: 503 });
  }

  return NextResponse.json({ accepted: true, checkedAt: new Date().toISOString() });
}
