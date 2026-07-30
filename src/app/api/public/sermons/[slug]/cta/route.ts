import { NextResponse } from "next/server";

import { recordPublicSermonCtaClick } from "@/server/publicSermon/publicSermonService";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  const destination = await recordPublicSermonCtaClick(slug);
  if (!destination) {
    return NextResponse.json(
      { error: "This public next step is not available." },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return NextResponse.redirect(new URL(destination), {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
