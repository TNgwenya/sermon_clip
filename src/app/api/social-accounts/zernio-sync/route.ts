import { NextResponse } from "next/server";

import { syncZernioSocialAccounts } from "@/lib/socialAccounts";

export async function POST(): Promise<NextResponse> {
  try {
    const accounts = await syncZernioSocialAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not sync Zernio social accounts.",
    }, { status: 500 });
  }
}
