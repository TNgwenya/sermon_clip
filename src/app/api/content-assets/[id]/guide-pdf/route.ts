import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { readContentAssetPublicFile } from "@/server/contentAssets/contentAssetPublicStorage";
import {
  generateContentAssetGuidePdf,
  type GeneratedGuidePdf,
} from "@/server/contentAssets/guidePdfService";

async function readGeneratedGuide(guide: GeneratedGuidePdf): Promise<Buffer | null> {
  const durableData = guide.publicUrl
    ? await readContentAssetPublicFile(guide.publicUrl).catch(() => null)
    : null;
  return durableData ?? (guide.path
    ? await readFile(guide.path).catch(() => null)
    : null);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    let guide = await generateContentAssetGuidePdf(id);
    let data = await readGeneratedGuide(guide);
    if (!data && guide.publicUrl) {
      guide = await generateContentAssetGuidePdf(id, { forceRegeneration: true });
      data = await readGeneratedGuide(guide);
    }
    if (!data) throw new Error("The generated guide PDF is unavailable.");
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
