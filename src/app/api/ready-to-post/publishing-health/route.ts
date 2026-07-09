import { NextResponse } from "next/server";

import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";

export async function GET(): Promise<NextResponse> {
  const health = await getPublishingServiceHealth();
  return NextResponse.json({ health });
}
