import { NextResponse } from "next/server";

import { syncZernioSocialAccounts } from "@/lib/socialAccounts";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";

export async function POST(): Promise<NextResponse> {
  try {
    const context = await requireRequestCapability("channels.manage");
    const accounts = await syncZernioSocialAccounts({
      organizationId: context.organizationId,
      campusId: context.campusId,
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not sync Zernio social accounts.",
    }, { status: 500 });
  }
}
