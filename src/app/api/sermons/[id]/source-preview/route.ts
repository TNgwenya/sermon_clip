import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireSermonResource } from "@/server/auth/resourceAuthorization";
import { resourceAuthorizationErrorResponse } from "@/server/auth/resourceRouteAuthorization";
import { videoFileResponse } from "@/server/http/videoFileResponse";
import { resolvePortableStoragePath } from "@/server/media/portableStoragePath";
import { presignReadyS3SourcePreview } from "@/server/media/s3SourceStorage";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

const PRIVATE_SOURCE_PREVIEW_CACHE_CONTROL = "private, max-age=300, must-revalidate";

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sermonId = id.trim();

  if (!sermonId) {
    return NextResponse.json({ error: "Sermon id is required." }, { status: 400 });
  }

  try {
    await requireSermonResource("sermons.read", sermonId);
  } catch (error) {
    const response = resourceAuthorizationErrorResponse(error, "Sermon not found.");
    if (response) return response;
    throw error;
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      sourceVideoPath: true,
      sourceAsset: {
        select: {
          bucket: true,
          objectKey: true,
          region: true,
          sizeBytes: true,
          contentType: true,
          originalFileName: true,
          versionId: true,
          status: true,
        },
      },
    },
  });

  if (!sermon) {
    return NextResponse.json({ error: "Sermon not found." }, { status: 404 });
  }

  if (canRunLocalMediaProcessing() && sermon.sourceVideoPath) {
    let localSourcePath: string | null = null;
    try {
      localSourcePath = resolvePortableStoragePath(sermon.sourceVideoPath);
    } catch {
      // A malformed legacy path must not prevent use of the verified durable source.
    }

    if (localSourcePath && await fileHasBytes(localSourcePath)) {
      return videoFileResponse({
        request,
        filePath: localSourcePath,
        disposition: "inline",
      });
    }
  }

  if (sermon.sourceAsset?.status === "READY") {
    try {
      const signedPreviewUrl = await presignReadyS3SourcePreview({
        asset: {
          ...sermon.sourceAsset,
          status: "READY",
        },
      });
      return NextResponse.redirect(signedPreviewUrl, {
        status: 307,
        headers: {
          // The presigned URL remains browser-private and expires shortly, but
          // a small fresh window lets Studio's source warmup and visible player
          // reuse the same authorized media ranges during boundary edits.
          "Cache-Control": PRIVATE_SOURCE_PREVIEW_CACHE_CONTROL,
          "Referrer-Policy": "no-referrer",
        },
      });
    } catch (error) {
      console.error("Unable to create a private sermon source preview URL.", error);
      return NextResponse.json(
        { error: "The durable sermon source is available, but secure preview delivery is not configured." },
        { status: 503 },
      );
    }
  }

  if (!canRunLocalMediaProcessing()) {
    return NextResponse.json(
      { error: "Sermon previews live on the media worker, and no durable source preview is available." },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { error: sermon.sourceVideoPath ? "Source video is missing or empty on disk." : "Source video is not available for this sermon." },
    { status: sermon.sourceVideoPath ? 404 : 409 },
  );
}
