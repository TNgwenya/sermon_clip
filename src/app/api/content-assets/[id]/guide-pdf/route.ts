import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { generateContentAssetGuidePdf } from "@/server/contentAssets/guidePdfService";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const guide = await generateContentAssetGuidePdf(id);
    const data = await readFile(guide.path);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${guide.fileName}"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Guide PDF generation failed." }, { status: 409 });
  }
}
