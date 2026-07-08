import { stat } from "node:fs/promises";

import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { isFreshRemotePreview, listBestPreviewCandidates } from "@/lib/clipPreview";
import { ReviewExperience } from "@/app/sermons/[id]/review/review-experience";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

type ReviewPageData = {
  id: string;
  title: string;
  clipCandidates: Array<{
    id: string;
    title: string;
    hook: string;
    caption: string;
    suggestedHook: string | null;
    suggestedCaption: string | null;
    hashtags: unknown;
    clipNotes: string | null;
    durationSeconds: number;
    score: number;
    finalQualityScore: number | null;
    qualityLabel: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
    postReadyStatus: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
    postReadyBlockers: unknown;
    recommendedNextAction: string | null;
    overallPostScore: number | null;
    standaloneClarityScore: number | null;
    contextSafetyScore: number | null;
    visualReadinessScore: number | null;
    qualitySummary: string | null;
    pastorFriendlyReason: string | null;
    recommendedAction: "KEEP" | "EXTEND" | "SHORTEN" | "MERGE" | "REJECT" | "NEEDS_REVIEW" | null;
    qualityClipCategory: "ENCOURAGEMENT" | "SCRIPTURE_TEACHING" | "ALTAR_CALL" | "TESTIMONY_STORY" | "QUOTE" | "LEADERSHIP" | "EVANGELISTIC" | "PRAYER" | "GENERAL" | null;
    qualityWarnings: unknown;
    qualityReviewedAt: Date | null;
    reasonSelected: string;
    clipType: string;
    smartClipCategory: string | null;
    recommendationReason: string | null;
    intendedAudience: string | null;
    ministryValue: string | null;
    socialValue: string | null;
    transcriptText: string;
    transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
    transcriptSafetyReasons: unknown;
    transcriptSafetyReviewedAt: Date | null;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    riskReasons: unknown;
    contextWarning: boolean;
    status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
    boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
    renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
    renderedAt: Date | null;
    renderedFilePath: string | null;
    captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
    captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
    captionedVideoPath: string | null;
    overlayStatus: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
    exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
    exportFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    renderFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    captionBurnFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    overlayFreshness: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
    exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
    manualCropKeyframes: unknown;
    manualCropUpdatedAt: Date | null;
    smartCropDebugSnapshotPath: string | null;
    smartCropDebugGeneratedAt: Date | null;
    smartCropDebugError: string | null;
    exportedFilePath: string | null;
    subtitleFilePath: string | null;
    overlayVideoPath: string | null;
    remotePreviewUrl: string | null;
    remotePreviewUploadedAt: Date | null;
    createdAt: Date;
  }>;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

const SERVER_ONLY_PREVIEW_KEYS = new Set<string>([
  "renderedAt",
  "renderedFilePath",
  "captionedVideoPath",
  "exportedFilePath",
  "remotePreviewUploadedAt",
  "renderFreshness",
  "captionBurnFreshness",
  "overlayFreshness",
  "exportFreshness",
]);

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function canPreviewClipVideo(
  clip: ReviewPageData["clipCandidates"][number],
  localMediaAvailable: boolean,
): Promise<boolean> {
  if (isFreshRemotePreview(clip)) {
    return true;
  }

  if (!localMediaAvailable) {
    return false;
  }

  const candidates = listBestPreviewCandidates(clip);
  if (candidates.length === 0) {
    return false;
  }

  const candidateReadiness = await Promise.all(candidates.map((candidate) => fileHasBytes(candidate)));
  return candidateReadiness.some(Boolean);
}

export default async function SermonReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const localMediaAvailable = canRunLocalMediaProcessing();

  const sermon: ReviewPageData | null = await prisma.sermon.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      clipCandidates: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          hook: true,
          caption: true,
          suggestedHook: true,
          suggestedCaption: true,
          hashtags: true,
          clipNotes: true,
          durationSeconds: true,
          score: true,
          finalQualityScore: true,
          qualityLabel: true,
          postReadyStatus: true,
          postReadyBlockers: true,
          recommendedNextAction: true,
          overallPostScore: true,
          standaloneClarityScore: true,
          contextSafetyScore: true,
          visualReadinessScore: true,
          qualitySummary: true,
          pastorFriendlyReason: true,
          recommendedAction: true,
          qualityClipCategory: true,
          qualityWarnings: true,
          qualityReviewedAt: true,
          reasonSelected: true,
          clipType: true,
          smartClipCategory: true,
          recommendationReason: true,
          intendedAudience: true,
          ministryValue: true,
          socialValue: true,
          transcriptText: true,
          transcriptSafetyStatus: true,
          transcriptSafetyReasons: true,
          transcriptSafetyReviewedAt: true,
          riskLevel: true,
          riskReasons: true,
          contextWarning: true,
          status: true,
          boundaryQuality: true,
          renderStatus: true,
          renderedAt: true,
          renderedFilePath: true,
          captionStatus: true,
          captionBurnStatus: true,
          captionedVideoPath: true,
          overlayStatus: true,
          exportStatus: true,
          exportFreshness: true,
          renderFreshness: true,
          captionBurnFreshness: true,
          overlayFreshness: true,
          exportLayoutStrategy: true,
          manualCropKeyframes: true,
          manualCropUpdatedAt: true,
          smartCropDebugSnapshotPath: true,
          smartCropDebugGeneratedAt: true,
          smartCropDebugError: true,
          exportedFilePath: true,
          subtitleFilePath: true,
          overlayVideoPath: true,
          remotePreviewUrl: true,
          remotePreviewUploadedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!sermon) {
    notFound();
  }

  const clips = await Promise.all(sermon.clipCandidates.map(async (clip) => {
    const clientClip = { ...clip };
    for (const key of SERVER_ONLY_PREVIEW_KEYS) {
      delete (clientClip as Record<string, unknown>)[key];
    }

    return {
      ...clientClip,
      hashtags: normalizeStringArray(clip.hashtags),
      riskReasons: normalizeStringArray(clip.riskReasons),
      qualityWarnings: normalizeStringArray(clip.qualityWarnings),
      postReadyBlockers: normalizeStringArray(clip.postReadyBlockers),
      transcriptSafetyReasons: normalizeStringArray(clip.transcriptSafetyReasons),
      transcriptSafetyReviewedAt: clip.transcriptSafetyReviewedAt?.toISOString() ?? null,
      qualityReviewedAt: clip.qualityReviewedAt?.toISOString() ?? null,
      manualCropUpdatedAt: clip.manualCropUpdatedAt?.toISOString() ?? null,
      smartCropDebugGeneratedAt: clip.smartCropDebugGeneratedAt?.toISOString() ?? null,
      suggestedHook: clip.suggestedHook ?? null,
      suggestedCaption: clip.suggestedCaption ?? null,
      canPreviewVideo: await canPreviewClipVideo(clip, localMediaAvailable),
      createdAt: clip.createdAt.toISOString(),
    };
  }));

  return (
    <>
      <ReviewExperience
        sermonId={sermon.id}
        sermonTitle={sermon.title}
        clips={clips}
        localMediaAvailable={localMediaAvailable}
      />
      <div className="container">
        <Link href={`/sermons/${sermon.id}`} className="text-link">Back to sermon detail</Link>
      </div>
    </>
  );
}
