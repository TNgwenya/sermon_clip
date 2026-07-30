import { NextResponse } from "next/server";

import { requireWorkerAuth } from "@/lib/workerAuth";
import { runAutomaticYoutubeIntakeSweep } from "@/server/integrations/youtubeAutomaticIntake";

export async function POST(request: Request): Promise<NextResponse> {
  const authError = requireWorkerAuth(request);
  if (authError) return authError;
  const result = await runAutomaticYoutubeIntakeSweep();
  return NextResponse.json({
    ...result,
    checkedAt: new Date().toISOString(),
  });
}
