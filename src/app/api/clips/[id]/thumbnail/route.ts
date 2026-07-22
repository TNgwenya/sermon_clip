import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  ensureClipThumbnail,
  generateClipThumbnailPreview,
} from "@/server/agents/clipThumbnailService";
import { canRunInlineMediaProcessing } from "@/server/runtime/workerRuntime";

export const runtime = "nodejs";

function fallbackPoster(title: string): NextResponse {
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 90);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <rect width="720" height="1280" fill="#09090b"/>
  <rect x="48" y="64" width="624" height="1152" rx="28" fill="#141418" stroke="#2a2a31" stroke-width="2"/>
  <text x="360" y="560" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#f8fafc">Sermon Clip</text>
  <text x="360" y="632" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#a3a3ad">Preview preparing</text>
  <foreignObject x="94" y="700" width="532" height="180">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial, Helvetica, sans-serif;font-size:32px;line-height:1.25;color:#f8fafc;text-align:center;font-weight:700;">${safeTitle}</div>
  </foreignObject>
  <rect x="190" y="980" width="340" height="72" rx="36" fill="#f8fafc"/>
  <text x="360" y="1026" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#111114">Ready soon</text>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const clipId = id.trim();

  if (!clipId) {
    return NextResponse.json({ error: "Clip id is required." }, { status: 400 });
  }

  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      sermonId: true,
      title: true,
      renderedFilePath: true,
      overlayVideoPath: true,
      exportedFilePath: true,
      captionedVideoPath: true,
      renderFreshness: true,
      overlayFreshness: true,
      captionBurnFreshness: true,
      exportFreshness: true,
      renderedAt: true,
      overlayRenderedAt: true,
      captionBurnedAt: true,
      exportedAt: true,
      renderAssetVersion: true,
      overlayAssetVersion: true,
      captionBurnAssetVersion: true,
      exportAssetVersion: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      captionData: true,
      thumbnailPath: true,
      thumbnailError: true,
    },
  });

  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  if (!canRunInlineMediaProcessing()) {
    if (clip.thumbnailPath) {
      const existingImage = await readFile(/* turbopackIgnore: true */ clip.thumbnailPath).catch(() => null);
      if (existingImage && existingImage.length > 0) {
        return new NextResponse(new Uint8Array(existingImage), {
          status: 200,
          headers: {
            "Content-Type": clip.thumbnailPath.endsWith(".webp") ? "image/webp" : "image/jpeg",
            "Content-Disposition": `inline; filename="${clip.id}-thumbnail"`,
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }
    return fallbackPoster(clip.title);
  }

  const requestedTime = new URL(request.url).searchParams.get("at");
  if (requestedTime !== null) {
    const timeSeconds = Number(requestedTime);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return NextResponse.json(
        { error: "Cover frame time must be a positive number of seconds." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    try {
      const preview = await generateClipThumbnailPreview(clip, { timeSeconds });
      if (!preview) {
        return fallbackPoster(clip.title);
      }

      return new NextResponse(new Uint8Array(preview.image), {
        status: 200,
        headers: {
          "Content-Type": preview.contentType,
          "Content-Disposition": `inline; filename="${clip.id}-cover-${Math.round(preview.timeSeconds * 1000)}.jpg"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch {
      return fallbackPoster(clip.title);
    }
  }

  const thumbnail = await ensureClipThumbnail(clip, { includeImage: true });
  if (thumbnail.webpPath && request.headers.get("accept")?.includes("image/webp")) {
    const webpImage = await readFile(/* turbopackIgnore: true */ thumbnail.webpPath);
    return new NextResponse(new Uint8Array(webpImage), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": `inline; filename="${clip.id}.webp"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (thumbnail.image && thumbnail.thumbnailPath) {
    return new NextResponse(new Uint8Array(thumbnail.image), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `inline; filename="${clip.id}.jpg"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  return fallbackPoster(clip.title);
}
