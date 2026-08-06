import { stat } from "node:fs/promises";

import Link from "next/link";
import { notFound } from "next/navigation";

import { TeachingVideoWorkspace } from "@/app/sermons/[id]/teaching-videos/teaching-video-workspace";
import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { getSourceVideoPath } from "@/server/agents/storage";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { tenantResourceScope, tenantScope } from "@/server/tenancy/scope";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function completeness(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    topicIntroduced: input.topicIntroduced === true,
    argumentResolved: input.argumentResolved === true,
    scriptureComplete: input.scriptureComplete === true,
    illustrationComplete: input.illustrationComplete === true,
    prayerOrConclusionComplete: input.prayerOrConclusionComplete === true,
  };
}

async function fileHasBytes(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath?.trim()) return false;
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

export default async function TeachingVideosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestContext = await requireRequestCapability("sermons.read", {
    resource: { kind: "SERMON", id },
  });
  const sermon = await prisma.sermon.findFirst({
    where: tenantResourceScope(requestContext, id),
    select: {
      id: true,
      title: true,
      speakerName: true,
      language: true,
      sourceDurationSeconds: true,
      sourceVideoPath: true,
      transcript: { select: { id: true } },
      transcriptSegments: {
        orderBy: { startTimeSeconds: "asc" },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
          speakerLabel: true,
          confidence: true,
        },
      },
    },
  });
  if (!sermon) notFound();
  const sourcePreviewAvailable = canRunLocalMediaProcessing() && (
    await fileHasBytes(getSourceVideoPath(sermon.id))
    || await fileHasBytes(sermon.sourceVideoPath)
  );

  const [latestCompletedRun, latestRun, jobs] = await Promise.all([
    prisma.teachingVideoAnalysisRun.findFirst({
      where: {
        sermonId: sermon.id,
        ...tenantScope(requestContext),
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.teachingVideoAnalysisRun.findFirst({
      where: { sermonId: sermon.id, ...tenantScope(requestContext) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.processingJob.findMany({
      where: {
        sermonId: sermon.id,
        type: { in: ["GENERATE_TEACHING_VIDEOS", "EXPORT_TEACHING_VIDEOS"] },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  const teachingVideos = latestCompletedRun
    ? await prisma.teachingVideo.findMany({
        where: {
          sermonId: sermon.id,
          ...tenantScope(requestContext),
          OR: [
            { analysisRunId: latestCompletedRun.id },
            { status: "APPROVED" },
          ],
        },
        orderBy: [{ startTimeSeconds: "asc" }, { createdAt: "desc" }],
        include: {
          exports: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              durationSeconds: true,
              errorMessage: true,
              generatedAt: true,
            },
          },
        },
      })
    : [];

  return (
    <main className="container stack-lg">
      <nav aria-label="Breadcrumb">
        <Link href={`/sermons/${sermon.id}`}>← Back to sermon</Link>
      </nav>
      <TeachingVideoWorkspace
        sermon={{
          id: sermon.id,
          title: sermon.title,
          speakerName: sermon.speakerName,
          language: sermon.language,
          sourceDurationSeconds: sermon.sourceDurationSeconds,
          transcriptReady: Boolean(sermon.transcript && sermon.transcriptSegments.length > 0),
        }}
        sourcePreviewAvailable={sourcePreviewAvailable}
        transcriptSegments={sermon.transcriptSegments}
        latestRun={latestRun ? {
          ...latestRun,
          createdAt: latestRun.createdAt.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        } : null}
        jobs={jobs.map((job) => ({
          ...job,
          type: job.type as "GENERATE_TEACHING_VIDEOS" | "EXPORT_TEACHING_VIDEOS",
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
        }))}
        teachingVideos={teachingVideos.map((video) => ({
          id: video.id,
          title: video.title,
          aiTitle: video.aiTitle,
          teachingType: video.teachingType,
          status: video.status,
          startTimeSeconds: video.startTimeSeconds,
          endTimeSeconds: video.endTimeSeconds,
          durationSeconds: video.durationSeconds,
          suggestedStartSeconds: video.suggestedStartSeconds,
          suggestedEndSeconds: video.suggestedEndSeconds,
          startAnchorId: video.startAnchorId,
          endAnchorId: video.endAnchorId,
          boundaryQuality: video.boundaryQuality,
          standaloneScore: video.standaloneScore,
          boundaryConfidence: video.boundaryConfidence,
          titleEvidence: video.titleEvidence,
          startReason: video.startReason,
          endReason: video.endReason,
          durationExceptionReason: video.durationExceptionReason,
          contextDependencies: stringArray(video.contextDependenciesJson),
          riskFlags: stringArray(video.riskFlagsJson),
          completeness: completeness(video.completenessJson),
          transcriptExcerpt: video.transcriptExcerpt,
          revisionVersion: video.revisionVersion,
          approvedRevisionVersion: video.approvedRevisionVersion,
          latestExport: video.exports[0] ? {
            ...video.exports[0],
            generatedAt: video.exports[0].generatedAt?.toISOString() ?? null,
          } : null,
        }))}
      />
    </main>
  );
}
