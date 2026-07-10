import { prisma } from "@/lib/prisma";
import {
  decideClipTranscriptSafety,
  mergeTranscriptSafetyBlocker,
} from "@/server/agents/localLanguageTranscriptSafety";
import { analyzeMultilingualTranscript } from "@/server/agents/multilingualTranscriptAnalysis";
import { invalidateAfterBoundaryOrCropChange } from "@/server/regeneration/dependencies";

export type TranscriptReplacementSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  confidence?: number | null;
};

export type TranscriptDerivedClip = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  transcriptText: string;
  transcriptSafetyReasons: unknown;
  postReadyBlockers: unknown;
  qualityWarnings: unknown;
};

export type ClipTranscriptReplacementPlan = {
  excerptChanged: boolean;
  evidenceChanged: boolean;
  requiresFreshReview: boolean;
  transcriptText: string;
  transcriptSafetyReasons: string[];
  postReadyBlockers: string[];
  qualityWarnings: string[];
  qualityDebugSnapshot: {
    transcriptEvidence: ReturnType<typeof analyzeMultilingualTranscript>;
  };
};

function normalizeTranscriptText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function transcriptTextChanged(previousText: string | null | undefined, nextText: string): boolean {
  return normalizeTranscriptText(previousText ?? "") !== normalizeTranscriptText(nextText);
}

function normalizedConfidence(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? Number(value.toFixed(4))
    : null;
}

function normalizedSegmentEvidence(segments: TranscriptReplacementSegment[]): Array<{
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  confidence: number | null;
}> {
  return [...segments]
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
    .map((segment) => ({
      startTimeSeconds: Number(segment.startTimeSeconds.toFixed(3)),
      endTimeSeconds: Number(segment.endTimeSeconds.toFixed(3)),
      text: normalizeTranscriptText(segment.text),
      confidence: normalizedConfidence(segment.confidence),
    }));
}

function overlappingSegments(
  segments: TranscriptReplacementSegment[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): TranscriptReplacementSegment[] {
  return segments.filter((segment) => (
    segment.endTimeSeconds > startTimeSeconds &&
    segment.startTimeSeconds < endTimeSeconds
  ));
}

export function transcriptSegmentEvidenceChanged(
  previousSegments: TranscriptReplacementSegment[],
  nextSegments: TranscriptReplacementSegment[],
): boolean {
  return JSON.stringify(normalizedSegmentEvidence(previousSegments)) !==
    JSON.stringify(normalizedSegmentEvidence(nextSegments));
}

export function transcriptExcerptForRange(
  segments: TranscriptReplacementSegment[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): string {
  return overlappingSegments(segments, startTimeSeconds, endTimeSeconds)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function planClipTranscriptReplacement(input: {
  clip: TranscriptDerivedClip;
  previousSegments: TranscriptReplacementSegment[];
  segments: TranscriptReplacementSegment[];
}): ClipTranscriptReplacementPlan {
  const previousRangeSegments = overlappingSegments(
    input.previousSegments,
    input.clip.startTimeSeconds,
    input.clip.endTimeSeconds,
  );
  const nextRangeSegments = overlappingSegments(
    input.segments,
    input.clip.startTimeSeconds,
    input.clip.endTimeSeconds,
  );
  const replacementExcerpt = transcriptExcerptForRange(
    input.segments,
    input.clip.startTimeSeconds,
    input.clip.endTimeSeconds,
  );
  const transcriptText = replacementExcerpt || input.clip.transcriptText;
  const excerptChanged = transcriptTextChanged(input.clip.transcriptText, transcriptText);
  const evidenceChanged = transcriptSegmentEvidenceChanged(previousRangeSegments, nextRangeSegments);
  const requiresFreshReview = excerptChanged || evidenceChanged;
  const transcriptEvidence = analyzeMultilingualTranscript(nextRangeSegments);
  const currentSafety = decideClipTranscriptSafety({ transcriptEvidence });

  return {
    excerptChanged,
    evidenceChanged,
    requiresFreshReview,
    transcriptText,
    transcriptSafetyReasons: Array.from(new Set([
      ...stringArray(input.clip.transcriptSafetyReasons),
      ...currentSafety.reasons,
      "TRANSCRIPT_CHANGED_AFTER_CLIP_GENERATION",
    ])),
    postReadyBlockers: mergeTranscriptSafetyBlocker(input.clip.postReadyBlockers),
    qualityWarnings: Array.from(new Set([
      ...stringArray(input.clip.qualityWarnings),
      "TRANSCRIPT_CHANGED_REVIEW_REQUIRED",
    ])),
    qualityDebugSnapshot: { transcriptEvidence },
  };
}

export async function invalidateTranscriptDerivedClipWork(input: {
  sermonId: string;
  previousFullText: string | null | undefined;
  nextFullText: string;
  previousSegments: TranscriptReplacementSegment[];
  segments: TranscriptReplacementSegment[];
}): Promise<{
  transcriptChanged: boolean;
  clipsReviewedAgain: number;
  clipsWithChangedExcerpt: number;
  clipsWithChangedEvidence: number;
}> {
  const transcriptChanged = transcriptTextChanged(input.previousFullText, input.nextFullText);
  const transcriptEvidenceChanged = transcriptSegmentEvidenceChanged(input.previousSegments, input.segments);
  if (!transcriptChanged && !transcriptEvidenceChanged) {
    return {
      transcriptChanged: false,
      clipsReviewedAgain: 0,
      clipsWithChangedExcerpt: 0,
      clipsWithChangedEvidence: 0,
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: { sermonId: input.sermonId },
    select: {
      id: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      transcriptText: true,
      transcriptSafetyReasons: true,
      postReadyBlockers: true,
      qualityWarnings: true,
    },
  });

  let clipsWithChangedExcerpt = 0;
  let clipsWithChangedEvidence = 0;
  for (const clip of clips) {
    const plan = planClipTranscriptReplacement({
      clip,
      previousSegments: input.previousSegments,
      segments: input.segments,
    });
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        qualityReviewedAt: null,
        ...(plan.requiresFreshReview
          ? {
              transcriptText: plan.transcriptText,
              transcriptSafetyStatus: "REVIEW_REQUIRED" as const,
              transcriptSafetyReasons: plan.transcriptSafetyReasons,
              transcriptSafetyReviewedAt: null,
              transcriptSafetyReviewedBy: null,
              qualityDebugSnapshot: plan.qualityDebugSnapshot,
              contextWarning: true,
              qualityLabel: "NEEDS_EDITING" as const,
              postReadyStatus: "NEEDS_EDITING" as const,
              postReadyBlockers: plan.postReadyBlockers,
              recommendedNextAction: "REVIEW_CLIP" as const,
              pastorFriendlyReason: "The sermon transcript changed in this clip range. Check the wording and boundaries again before publishing.",
              qualityWarnings: plan.qualityWarnings,
            }
          : {}),
      },
    });

    if (plan.excerptChanged) {
      clipsWithChangedExcerpt += 1;
    }
    if (plan.requiresFreshReview) {
      clipsWithChangedEvidence += 1;
      await invalidateAfterBoundaryOrCropChange(
        clip.id,
        "The source transcript changed in this clip range. Review wording, boundaries, captions, and prepared media again.",
      );
    }
  }

  return {
    transcriptChanged: true,
    clipsReviewedAgain: clips.length,
    clipsWithChangedExcerpt,
    clipsWithChangedEvidence,
  };
}
