"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  buildTeachingTranscriptAnchors,
  refineTeachingVideoBoundaries,
  TEACHING_VIDEO_TARGET_MAX_SECONDS,
  TEACHING_VIDEO_TARGET_MIN_SECONDS,
} from "@/lib/teachingVideos";
import { queueSermonProcessingJob } from "@/server/agents/processing";
import { teachingTranscriptFingerprint } from "@/server/agents/teachingVideoAnalysisService";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { tenantResourceScope, tenantScope } from "@/server/tenancy/scope";

export type TeachingVideoActionState = {
  success: boolean;
  message: string;
  jobId?: string;
  savedRevision?: {
    revisionVersion: number;
    title: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
  };
};

const updateSchema = z.object({
  teachingVideoId: z.string().trim().min(1),
  expectedRevisionVersion: z.number().int().positive(),
  title: z.string().trim().min(3).max(100),
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().positive(),
}).refine((value) => value.endTimeSeconds > value.startTimeSeconds, {
  message: "End time must be later than start time.",
  path: ["endTimeSeconds"],
});

async function requireTenantSermon(
  sermonId: string,
  capability: "sermons.read" | "sermons.update" | "content.export",
) {
  const requestContext = await requireRequestCapability(capability);
  const sermon = await prisma.sermon.findFirst({
    where: tenantResourceScope(requestContext, sermonId),
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      sourceDurationSeconds: true,
      transcript: { select: { updatedAt: true } },
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
  if (!sermon || !sermon.organizationId) throw new Error("Sermon not found.");
  return { requestContext, sermon };
}

export async function generateTeachingVideosAction(
  sermonId: string,
  force = false,
): Promise<TeachingVideoActionState> {
  try {
    const { sermon } = await requireTenantSermon(sermonId, "sermons.update");
    if (!sermon.transcript || sermon.transcriptSegments.length === 0) {
      return { success: false, message: "Transcribe this sermon before analysing teaching videos." };
    }
    const fingerprint = teachingTranscriptFingerprint({
      transcriptUpdatedAt: sermon.transcript.updatedAt,
      segments: sermon.transcriptSegments,
    });
    const intentKey = `teaching:${fingerprint}:${force ? "force" : "current"}`;
    const queued = await queueSermonProcessingJob(
      sermon.id,
      "GENERATE_TEACHING_VIDEOS",
      { force, transcriptFingerprint: fingerprint, intentKey },
    );
    revalidatePath(`/sermons/${sermon.id}/teaching-videos`);
    return {
      success: true,
      jobId: queued.id,
      message: queued.reusedExisting
        ? "Teaching-video analysis is already queued or running."
        : "Teaching-video analysis was queued.",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Teaching-video analysis could not be queued.",
    };
  }
}

export async function updateTeachingVideoAction(
  input: z.input<typeof updateSchema>,
): Promise<TeachingVideoActionState> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid teaching-video changes." };
  }

  try {
    const requestContext = await requireRequestCapability("sermons.update");
    const video = await prisma.teachingVideo.findFirst({
      where: {
        id: parsed.data.teachingVideoId,
        ...tenantScope(requestContext),
      },
      include: {
        sermon: {
          select: {
            sourceDurationSeconds: true,
            transcript: { select: { updatedAt: true } },
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
        },
      },
    });
    if (!video || !video.sermon.transcript) throw new Error("Teaching video not found.");
    if (video.revisionVersion !== parsed.data.expectedRevisionVersion) {
      throw new Error("This teaching video changed in another session. Refresh before saving.");
    }

    const anchors = buildTeachingTranscriptAnchors(video.sermon.transcriptSegments);
    const refined = refineTeachingVideoBoundaries(
      anchors,
      parsed.data.startTimeSeconds,
      parsed.data.endTimeSeconds,
      video.sermon.sourceDurationSeconds,
    );
    if (refined.quality === "BLOCKED") {
      throw new Error(refined.reasons[0] ?? "These boundaries cannot be saved.");
    }
    const durationSeconds = Number(
      (refined.endTimeSeconds - refined.startTimeSeconds).toFixed(3),
    );
    const durationRisk = durationSeconds < TEACHING_VIDEO_TARGET_MIN_SECONDS
      || durationSeconds > TEACHING_VIDEO_TARGET_MAX_SECONDS;
    const quality = refined.quality === "GOOD" && !durationRisk ? "GOOD" : "NEEDS_REVIEW";
    const nextVersion = video.revisionVersion + 1;
    const fingerprint = teachingTranscriptFingerprint({
      transcriptUpdatedAt: video.sermon.transcript.updatedAt,
      segments: video.sermon.transcriptSegments,
    });
    const transcriptExcerpt = anchors
      .filter((anchor) => (
        anchor.endTimeSeconds >= refined.startTimeSeconds
        && anchor.startTimeSeconds <= refined.endTimeSeconds
      ))
      .map((anchor) => anchor.text)
      .join(" ");
    const riskFlags = durationRisk
      ? Array.from(new Set([...refined.riskFlags, "DURATION_OUTSIDE_TARGET"]))
      : refined.riskFlags;

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.teachingVideo.updateMany({
        where: {
          id: video.id,
          revisionVersion: parsed.data.expectedRevisionVersion,
        },
        data: {
          title: parsed.data.title,
          startTimeSeconds: refined.startTimeSeconds,
          endTimeSeconds: refined.endTimeSeconds,
          durationSeconds,
          startAnchorId: refined.startAnchorId,
          endAnchorId: refined.endAnchorId,
          boundaryQuality: quality,
          boundaryValidationJson: { reasons: refined.reasons, riskFlags },
          riskFlagsJson: riskFlags,
          transcriptExcerpt,
          transcriptFingerprint: fingerprint,
          revisionVersion: nextVersion,
          approvedRevisionVersion: null,
          approvedByUserId: null,
          approvedAt: null,
          status: "NEEDS_REVIEW",
        },
      });
      if (updated.count !== 1) {
        throw new Error("This teaching video changed in another session. Refresh before saving.");
      }
      await transaction.teachingVideoRevision.create({
        data: {
          teachingVideoId: video.id,
          version: nextVersion,
          title: parsed.data.title,
          startTimeSeconds: refined.startTimeSeconds,
          endTimeSeconds: refined.endTimeSeconds,
          durationSeconds,
          startAnchorId: refined.startAnchorId,
          endAnchorId: refined.endAnchorId,
          boundaryQuality: quality,
          boundaryValidationJson: { reasons: refined.reasons, riskFlags },
          transcriptFingerprint: fingerprint,
          createdByUserId: requestContext.actorId,
        },
      });
      await transaction.teachingVideoExport.updateMany({
        where: { teachingVideoId: video.id, status: { not: "STALE" } },
        data: {
          status: "STALE",
          errorMessage: "A newer teaching-video revision was saved.",
        },
      });
    });

    revalidatePath(`/sermons/${video.sermonId}/teaching-videos`);
    return {
      success: true,
      message: quality === "GOOD"
        ? "Teaching-video boundaries saved. Reapprove this revision before exporting."
        : "Changes saved. Review the duration or boundary warnings before approval.",
      savedRevision: {
        revisionVersion: nextVersion,
        title: parsed.data.title,
        startTimeSeconds: refined.startTimeSeconds,
        endTimeSeconds: refined.endTimeSeconds,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Teaching-video changes could not be saved.",
    };
  }
}

export async function setTeachingVideoStatusAction(
  teachingVideoId: string,
  status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW",
): Promise<TeachingVideoActionState> {
  try {
    const requestContext = await requireRequestCapability("sermons.update");
    const video = await prisma.teachingVideo.findFirst({
      where: { id: teachingVideoId.trim(), ...tenantScope(requestContext) },
      select: {
        id: true,
        sermonId: true,
        revisionVersion: true,
        boundaryQuality: true,
      },
    });
    if (!video) throw new Error("Teaching video not found.");
    if (status === "APPROVED" && video.boundaryQuality === "BLOCKED") {
      throw new Error("Blocked boundaries cannot be approved.");
    }

    await prisma.$transaction([
      prisma.teachingVideo.update({
        where: { id: video.id },
        data: status === "APPROVED"
          ? {
              status,
              approvedRevisionVersion: video.revisionVersion,
              approvedByUserId: requestContext.actorId,
              approvedAt: new Date(),
            }
          : {
              status,
              approvedRevisionVersion: null,
              approvedByUserId: null,
              approvedAt: null,
            },
      }),
      prisma.teachingVideoRevision.update({
        where: {
          teachingVideoId_version: {
            teachingVideoId: video.id,
            version: video.revisionVersion,
          },
        },
        data: status === "APPROVED"
          ? {
              approvedByUserId: requestContext.actorId,
              approvedAt: new Date(),
            }
          : {
              approvedByUserId: null,
              approvedAt: null,
            },
      }),
    ]);
    revalidatePath(`/sermons/${video.sermonId}/teaching-videos`);
    return {
      success: true,
      message: status === "APPROVED"
        ? "Teaching video approved for continuous export."
        : status === "REJECTED"
          ? "Teaching video rejected."
          : "Teaching video returned to review.",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Review status could not be updated.",
    };
  }
}

export async function exportTeachingVideosAction(
  sermonId: string,
  teachingVideoIds: string[],
): Promise<TeachingVideoActionState> {
  try {
    const { requestContext, sermon } = await requireTenantSermon(sermonId, "content.export");
    const ids = Array.from(new Set(teachingVideoIds.map((id) => id.trim()).filter(Boolean)));
    const videos = await prisma.teachingVideo.findMany({
      where: {
        sermonId: sermon.id,
        ...tenantScope(requestContext),
        status: "APPROVED",
        approvedRevisionVersion: { not: null },
        ...(ids.length > 0 ? { id: { in: ids } } : {}),
      },
      select: {
        id: true,
        revisionVersion: true,
        approvedRevisionVersion: true,
      },
    });
    const approvedIds = videos
      .filter((video) => video.approvedRevisionVersion === video.revisionVersion)
      .map((video) => video.id);
    if (approvedIds.length === 0) {
      return { success: false, message: "Approve at least one current teaching-video revision before exporting." };
    }

    const intentKey = `teaching-export:${approvedIds.sort().join(",")}`;
    const queued = await queueSermonProcessingJob(
      sermon.id,
      "EXPORT_TEACHING_VIDEOS",
      { teachingVideoIds: approvedIds, intentKey },
    );
    revalidatePath(`/sermons/${sermon.id}/teaching-videos`);
    return {
      success: true,
      jobId: queued.id,
      message: queued.reusedExisting
        ? "A teaching-video export is already queued or running."
        : `${approvedIds.length} teaching-video export${approvedIds.length === 1 ? "" : "s"} queued.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Teaching-video exports could not be queued.",
    };
  }
}
