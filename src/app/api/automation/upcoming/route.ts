import { NextResponse } from "next/server";

import { listUpcomingAutomationPosts } from "@/lib/scheduledPosts";
import { requireWorkerAuth } from "@/lib/workerAuth";

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireWorkerAuth(request);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);
  const windowMinutesParam = Number(url.searchParams.get("windowMinutes") ?? "");
  const windowMinutes = Number.isFinite(windowMinutesParam) && windowMinutesParam > 0
    ? Math.min(Math.round(windowMinutesParam), 60 * 24 * 14)
    : undefined;
  const scheduledPosts = await listUpcomingAutomationPosts({ windowMinutes });

  return NextResponse.json({
    scheduledPosts,
    serverTime: new Date().toISOString(),
  });
}
