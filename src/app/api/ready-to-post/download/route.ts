import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildClipExportBaseName,
  buildSermonExportDirectoryName,
} from "@/lib/exportNaming";
import { buildReadyToPostPackage } from "@/lib/readyToPost";
import { recordPostingPackage } from "@/lib/postingPackages";
import { createZipArchive } from "@/lib/zipArchive";
import { resolveReadyMedia } from "@/lib/readyMedia";

function parseClipIds(value: string | null): string[] {
  if (!value || value === "all") {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const selectedClipIds = parseClipIds(url.searchParams.get("clipIds"));

  const clips = await prisma.clipCandidate.findMany({
    where: {
      ...(selectedClipIds.length > 0 ? { id: { in: selectedClipIds } } : {}),
      transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
      OR: [
        { exportStatus: "COMPLETED" },
        { status: "EXPORTED" },
      ],
    },
    orderBy: [
      { finalQualityScore: "desc" },
      { score: "desc" },
      { startTimeSeconds: "asc" },
      { exportedAt: "desc" },
    ],
    select: {
      id: true,
      title: true,
      hook: true,
      caption: true,
      hashtags: true,
      score: true,
      finalQualityScore: true,
      startTimeSeconds: true,
      smartClipCategory: true,
      intendedAudience: true,
      exportedAt: true,
      exportStatus: true,
      exportFreshness: true,
      exportFormat: true,
      exportedFilePath: true,
      exportPath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      renderedFilePath: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          churchName: true,
          sermonDate: true,
        },
      },
    },
    take: selectedClipIds.length > 0 ? selectedClipIds.length : 50,
  });

  if (clips.length === 0) {
    return NextResponse.json({ error: "No ready-to-post clips are available for download yet." }, { status: 404 });
  }

  const missingSelections = selectedClipIds.filter((clipId) => !clips.some((clip) => clip.id === clipId));
  if (missingSelections.length > 0) {
    return NextResponse.json(
      { error: "Some selected clips are not ready to download yet.", clipIds: missingSelections },
      { status: 409 },
    );
  }

  const entries: Array<{ name: string; data: Buffer | string; modifiedAt?: Date }> = [];
  const manifest = [];
  let totalVideoBytes = 0;

  for (const [index, clip] of clips.entries()) {
    const media = await resolveReadyMedia(clip);
    const outputPath = media.outputPath;

    if (!outputPath) {
      return NextResponse.json(
        { error: `The prepared video for "${clip.title}" is missing or not ready yet.` },
        { status: 409 },
      );
    }

    const readyPackage = buildReadyToPostPackage({
      clipId: clip.id,
      title: clip.title,
      hook: clip.hook,
      caption: clip.caption,
      hashtags: clip.hashtags,
      smartClipCategory: clip.smartClipCategory,
      intendedAudience: clip.intendedAudience,
    });
    const sermonFolderName = buildSermonExportDirectoryName({
      title: clip.sermon.title,
      speakerName: clip.sermon.speakerName,
      sermonDate: clip.sermon.sermonDate,
    });
    const clipBaseName = buildClipExportBaseName({
      title: clip.title,
      description: clip.hook || clip.caption,
      index: index + 1,
    });
    const folderName = `${sermonFolderName}/${clipBaseName}`;
    const videoExtension = path.extname(outputPath) || ".mp4";
    const videoFile = await readFile(/* turbopackIgnore: true */ outputPath);
    totalVideoBytes += videoFile.byteLength;

    entries.push({
      name: `${folderName}/${clipBaseName}${videoExtension}`,
      data: videoFile,
      modifiedAt: clip.exportedAt ?? undefined,
    });

    for (const variant of readyPackage.variants) {
      entries.push({
        name: `${folderName}/captions/${buildClipExportBaseName({ title: variant.platform })}.txt`,
        data: variant.text,
      });
    }

    entries.push({
      name: `${folderName}/hashtags.txt`,
      data: readyPackage.hashtags.join(" "),
    });

    for (const handoff of readyPackage.handoffs) {
      entries.push({
        name: `${folderName}/upload-checklists/${buildClipExportBaseName({ title: handoff.platform })}.txt`,
        data: handoff.checklistText,
      });
    }

    manifest.push({
      id: clip.id,
      title: clip.title,
      sermon: clip.sermon.title,
      church: clip.sermon.churchName,
      score: clip.score,
      category: clip.smartClipCategory,
      audience: clip.intendedAudience,
      packageContents: readyPackage.contentsLabel,
      estimatedVideoBytes: videoFile.byteLength,
      downloadFile: `${folderName}/${clipBaseName}${videoExtension}`,
      captions: readyPackage.variants.map((variant) => ({
        platform: variant.platform,
        file: `${folderName}/captions/${buildClipExportBaseName({ title: variant.platform })}.txt`,
      })),
      uploadChecklists: readyPackage.handoffs.map((handoff) => ({
        platform: handoff.platform,
        uploadUrl: handoff.uploadUrl,
        file: `${folderName}/upload-checklists/${buildClipExportBaseName({ title: handoff.platform })}.txt`,
      })),
      hashtags: readyPackage.hashtags,
    });
  }

  entries.push({
    name: "posting-manifest.json",
    data: JSON.stringify({
      generatedAt: new Date().toISOString(),
      clipCount: clips.length,
      clips: manifest,
    }, null, 2),
  });

  const zip = createZipArchive(entries);
  const sermonName = buildSermonExportDirectoryName({
    title: clips[0]?.sermon.title ?? "sermon-clips",
    speakerName: clips[0]?.sermon.speakerName ?? "pastor",
    sermonDate: clips[0]?.sermon.sermonDate,
  });
  const fileName = `${sermonName}-posting-package.zip`;

  await recordPostingPackage({
    clipIds: clips.map((clip) => clip.id),
    clipTitles: clips.map((clip) => clip.title),
    sermonTitle: clips[0]?.sermon.title ?? "Sermon clips",
    churchName: clips[0]?.sermon.churchName ?? "Church",
    fileName,
    totalVideoBytes,
  });

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
