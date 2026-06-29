import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { listBestPreviewCandidates } from "@/lib/clipPreview";
import { videoFileResponse } from "@/server/http/videoFileResponse";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
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
      renderedFilePath: true,
      overlayVideoPath: true,
      exportedFilePath: true,
      captionedVideoPath: true,
      remotePreviewUrl: true,
    },
  });

  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const variant = (url.searchParams.get("variant") ?? "rendered").toLowerCase();
  const remotePreviewUrl =
    (variant === "best" || variant === "rendered") && isHttpsUrl(clip.remotePreviewUrl)
      ? clip.remotePreviewUrl
      : null;

  if (!canRunLocalMediaProcessing()) {
    if (remotePreviewUrl) {
      return NextResponse.redirect(remotePreviewUrl, { status: 302 });
    }

    return NextResponse.json(
      { error: "No remote preview is available yet. Run the Mac media worker to render and upload clip previews." },
      { status: 409 },
    );
  }

  if (variant === "best") {
    const candidates = listBestPreviewCandidates(clip);
    const bestPath = (await Promise.all(
      candidates.map(async (candidate) => {
        if (!candidate) {
          return null;
        }
        return (await fileHasBytes(candidate)) ? candidate : null;
      }),
    )).find((candidate): candidate is string => Boolean(candidate));

    if (!bestPath) {
      if (remotePreviewUrl) {
        return NextResponse.redirect(remotePreviewUrl, { status: 302 });
      }
      return NextResponse.json({ error: "No preview file is available for this clip yet." }, { status: 409 });
    }

    return videoFileResponse({ request, filePath: bestPath, disposition: "inline" });
  }

  const pathByVariant: Record<string, string | null | undefined> = {
    rendered: clip.renderedFilePath,
    overlay: clip.overlayVideoPath,
    exported: clip.exportedFilePath,
    captioned: clip.captionedVideoPath,
  };

  const filePath = pathByVariant[variant];
  if (!filePath) {
    if (remotePreviewUrl) {
      return NextResponse.redirect(remotePreviewUrl, { status: 302 });
    }
    return NextResponse.json({ error: `Preview variant not available: ${variant}.` }, { status: 409 });
  }

  const hasBytes = await fileHasBytes(filePath);
  if (!hasBytes) {
    if (remotePreviewUrl) {
      return NextResponse.redirect(remotePreviewUrl, { status: 302 });
    }
    return NextResponse.json({ error: "Preview file is missing or empty on disk." }, { status: 404 });
  }

  return videoFileResponse({ request, filePath, disposition: "inline" });
}
