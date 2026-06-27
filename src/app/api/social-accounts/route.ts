import { NextResponse } from "next/server";

import {
  createSocialAccount,
  listSocialAccounts,
  normalizeSocialPlatform,
} from "@/lib/socialAccounts";

export async function GET(): Promise<NextResponse> {
  const accounts = await listSocialAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const platform = normalizeSocialPlatform(body?.platform);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const handle = typeof body?.handle === "string" ? body.handle.trim() : "";

  if (!platform) {
    return NextResponse.json({ error: "Choose a social platform for this church account." }, { status: 400 });
  }

  if (!label) {
    return NextResponse.json({ error: "Name the church channel or page." }, { status: 400 });
  }

  const account = await createSocialAccount({
    platform,
    label,
    handle,
  });

  return NextResponse.json({ account }, { status: 201 });
}
