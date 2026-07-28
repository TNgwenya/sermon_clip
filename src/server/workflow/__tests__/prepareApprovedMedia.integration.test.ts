import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, rm, stat } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { GET as downloadClip } from "@/app/api/clips/[id]/download/route";
import { prepareApprovedClipsAction } from "@/server/actions/sermons";
import { ensureSermonFolders, getSermonStoragePath, getSourceVideoPath } from "@/server/agents/storage";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const runMediaIntegration = process.env.RUN_MEDIA_INTEGRATION === "1";
const describeMedia = runMediaIntegration ? describe : describe.skip;
const createdSermonIds: string[] = [];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg exited with code ${code ?? "unknown"}: ${stderr.slice(-1600)}`));
    });
  });
}

async function createSyntheticSourceVideo(outputPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=12:duration=26",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=26",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);
}

describeMedia("one-click prepare approved clips media integration", () => {
  afterEach(async () => {
    while (createdSermonIds.length > 0) {
      const sermonId = createdSermonIds.pop();
      if (!sermonId) {
        continue;
      }

      await prisma.sermon.deleteMany({ where: { id: sermonId } });
      await rm(getSermonStoragePath(sermonId), { recursive: true, force: true });
    }
  });

  it("turns an approved local sermon clip into a downloadable ready-to-post video", async () => {
    const sermon = await prisma.sermon.create({
      data: {
        youtubeUrl: "local-upload://integration-fixture/source.mp4",
        title: "Integration Test Sermon",
        speakerName: "Pastor Test",
        churchName: "Test Church",
        language: "en",
        status: "CLIPS_GENERATED",
        rightsConfirmed: true,
      },
      select: { id: true },
    });
    createdSermonIds.push(sermon.id);

    await ensureSermonFolders(sermon.id);
    const sourceVideoPath = getSourceVideoPath(sermon.id);
    await createSyntheticSourceVideo(sourceVideoPath);
    await prisma.sermon.update({
      where: { id: sermon.id },
      data: {
        sourceVideoPath,
        status: "CLIPS_GENERATED",
      },
    });

    const fullText = [
      "Church, when we pray for the hurting, we are not just filling time.",
      "We are inviting people to bring their pain to Jesus with honest faith.",
      "If you feel far from God today, this is your moment to come home.",
      "The gospel is good news for weary hearts and new believers.",
      "Let us pray with hope and point people toward Christ.",
    ].join(" ");

    const transcript = await prisma.transcript.create({
      data: {
        sermonId: sermon.id,
        fullText,
        provider: "integration-fixture",
        language: "en",
      },
      select: { id: true },
    });

    await prisma.transcriptSegment.createMany({
      data: [
        "Church, when we pray for the hurting, we are not just filling time.",
        "We are inviting people to bring their pain to Jesus with honest faith.",
        "If you feel far from God today, this is your moment to come home.",
        "The gospel is good news for weary hearts and new believers.",
        "Let us pray with hope and point people toward Christ.",
      ].map((text, index) => ({
        sermonId: sermon.id,
        transcriptId: transcript.id,
        startTimeSeconds: index * 5,
        endTimeSeconds: index === 4 ? 26 : index * 5 + 5,
        text,
        confidence: 0.99,
      })),
    });

    const clip = await prisma.clipCandidate.create({
      data: {
        sermonId: sermon.id,
        smartClipCategory: "Best Prayer Clip",
        recommendationReason: "A clear prayer moment with a warm invitation for hurting people.",
        intendedAudience: "Hurting people",
        ministryValue: "Helps viewers feel seen and invited to pray.",
        socialValue: "Short, direct, and easy to share.",
        suggestedHook: "If you feel far from God today...",
        suggestedCaption: "A prayer moment for weary hearts.",
        startTimeSeconds: 1,
        endTimeSeconds: 25.5,
        durationSeconds: 24.5,
        transcriptText: fullText,
        title: "Prayer for Hurting People",
        hook: "If you feel far from God today, this is your moment.",
        caption: "Bring your pain to Jesus with honest faith.",
        hashtags: ["#Prayer", "#Hope", "#Church"],
        score: 9.2,
        reasonSelected: "A focused ministry moment with context-safe language.",
        clipType: "Prayer moment",
        riskLevel: "LOW",
        riskReasons: [],
        contextWarning: false,
        boundaryQuality: "GOOD",
        status: "APPROVED",
        exportFormat: "VERTICAL_9_16",
        exportLayoutStrategy: "CENTER_CROP",
      },
      select: { id: true },
    });

    const result = await prepareApprovedClipsAction({
      sermonId: sermon.id,
      clipIds: [clip.id],
    });

    expect(result).toMatchObject({
      success: true,
      processed: 1,
      prepared: 1,
      captionsAdded: 1,
      brandingAdded: 1,
      readyToPost: 1,
      failed: 0,
    });
    expect(result.message).toContain("Captions, church branding, and downloads are ready");

    const preparedClip = await prisma.clipCandidate.findUniqueOrThrow({
      where: { id: clip.id },
      select: {
        status: true,
        renderStatus: true,
        captionStatus: true,
        captionBurnStatus: true,
        overlayStatus: true,
        exportStatus: true,
        exportFormat: true,
        exportLayoutStrategy: true,
        renderedFilePath: true,
        subtitleFilePath: true,
        captionedVideoPath: true,
        overlayVideoPath: true,
        exportedFilePath: true,
      },
    });

    expect(preparedClip).toMatchObject({
      status: "EXPORTED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
      exportFormat: "VERTICAL_9_16",
      exportLayoutStrategy: "CENTER_CROP",
    });

    for (const filePath of [
      preparedClip.renderedFilePath,
      preparedClip.subtitleFilePath,
      preparedClip.captionedVideoPath,
      preparedClip.overlayVideoPath,
      preparedClip.exportedFilePath,
    ]) {
      expect(filePath).toBeTruthy();
      expect(await fileExists(filePath!)).toBe(true);
    }

    const exportedStats = await stat(preparedClip.exportedFilePath!);
    expect(exportedStats.size).toBeGreaterThan(10_000);

    const [overlayStats, exportArtifact, activePlan] = await Promise.all([
      stat(preparedClip.overlayVideoPath!),
      prisma.clipArtifact.findFirstOrThrow({
        where: {
          clipCandidateId: clip.id,
          kind: "EXPORT",
          status: "READY",
          freshness: "UP_TO_DATE",
        },
        orderBy: { createdAt: "desc" },
        select: {
          editPlanId: true,
          planHash: true,
          metadataJson: true,
        },
      }),
      prisma.clipEditPlan.findFirstOrThrow({
        where: {
          clipCandidateId: clip.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
          planHash: true,
          resolvedFramingPlanHash: true,
        },
      }),
    ]);
    expect(exportArtifact).toMatchObject({
      editPlanId: activePlan.id,
      planHash: activePlan.planHash,
      metadataJson: {
        exportMethod: "LOSSLESS_SOURCE_COPY",
        videoEncoder: "copy",
        audioBitrate: "source",
        sourceKind: "PREPARED_OVERLAY",
        resolvedFramingPlanHash: activePlan.resolvedFramingPlanHash,
      },
    });
    expect(preparedClip.exportedFilePath).not.toBe(preparedClip.overlayVideoPath);
    expect(exportedStats.ino).not.toBe(overlayStats.ino);
    expect(await fileSha256(preparedClip.exportedFilePath!)).toBe(
      await fileSha256(preparedClip.overlayVideoPath!),
    );

    const artifactCountBeforeRepeat = await prisma.clipArtifact.count({
      where: {
        clipCandidateId: clip.id,
        status: "READY",
      },
    });
    const repeatedResult = await prepareApprovedClipsAction({
      sermonId: sermon.id,
      clipIds: [clip.id],
    });
    const [repeatedExportStats, artifactCountAfterRepeat, editPlanCountAfterRepeat] = await Promise.all([
      stat(preparedClip.exportedFilePath!),
      prisma.clipArtifact.count({
        where: {
          clipCandidateId: clip.id,
          status: "READY",
        },
      }),
      prisma.clipEditPlan.count({
        where: { clipCandidateId: clip.id },
      }),
    ]);
    expect(repeatedResult).toMatchObject({
      success: true,
      processed: 1,
      prepared: 1,
      captionsAdded: 0,
      brandingAdded: 0,
      readyToPost: 1,
      failed: 0,
    });
    expect(artifactCountAfterRepeat).toBe(artifactCountBeforeRepeat);
    expect(editPlanCountAfterRepeat).toBe(1);
    expect(repeatedExportStats).toMatchObject({
      ino: exportedStats.ino,
      size: exportedStats.size,
      mtimeMs: exportedStats.mtimeMs,
    });

    const downloadResponse = await downloadClip(
      new Request(`http://localhost/api/clips/${clip.id}/download?variant=vertical`),
      { params: Promise.resolve({ id: clip.id }) },
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("video/mp4");
    expect(downloadResponse.headers.get("content-disposition")).toContain(".mp4");
    expect((await downloadResponse.arrayBuffer()).byteLength).toBe(exportedStats.size);
  }, 120_000);
});
