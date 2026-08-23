import { NextResponse } from "next/server";

import { verifyLiveWebhook } from "@/server/liveIntake/cloudflareStream";
import { receiveCompletedLiveRecording } from "@/server/liveIntake/service";

export const runtime = "nodejs";

// The endpoint accepts only a provider adapter that has verified the request.
// It records an idempotent receipt; a worker, not this public route, materialises
// the video into private source storage and queues normal sermon processing.
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyLiveWebhook(request, body)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let payload: { inputId?: string; recordingId?: string; title?: string; durationSeconds?: number; sourceUrl?: string };
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!payload.inputId || !payload.recordingId) return NextResponse.json({ error: "Incomplete recording event" }, { status: 400 });
  // Provider download URLs are one-time credentials. The worker requests a
  // fresh URL from Cloudflare after receipt; this adapter never persists one.
  const result = await receiveCompletedLiveRecording({ providerInputId: payload.inputId, providerRecordingId: payload.recordingId, title: payload.title, durationSeconds: payload.durationSeconds });
  return NextResponse.json(result, { status: result.accepted ? 202 : 404 });
}
