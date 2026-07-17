import { rename, stat, unlink, writeFile } from "node:fs/promises";

import type { ClipCandidate, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import {
  HARD_MAX_DURATION_SECONDS,
  HARD_MIN_DURATION_SECONDS,
  validateBoundaryTimes,
} from "@/server/agents/clipBoundaryRefinement";
import { appendPipelineLog, ensureSermonFolders, getClipSrtPath } from "@/server/agents/storage";
import {
  invalidateAfterCaptionCompleted,
  markCaptionAssetCompleted,
  markCaptionAssetFailed,
} from "@/server/regeneration/dependencies";
import { validateTranscriptSafetyForPublishing } from "@/server/agents/localLanguageTranscriptSafety";

type CaptionGenerationOptions = {
  force?: boolean;
};

type ClipForCaption = Pick<
  ClipCandidate,
  | "id"
  | "sermonId"
  | "status"
  | "startTimeSeconds"
  | "endTimeSeconds"
  | "adjustedStartTimeSeconds"
  | "adjustedEndTimeSeconds"
  | "durationSeconds"
  | "transcriptText"
  | "srtPath"
  | "subtitlesGenerated"
  | "captionStatus"
  | "captionFreshness"
  | "captionData"
  | "transcriptSafetyStatus"
>;

type TranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type CaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

type CaptionGenerationResult = {
  clipId: string;
  srtPath: string;
  generatedAt: Date;
  reusedExistingFile: boolean;
  cueCount: number;
};

type CaptionCueQuality = {
  coverageRatio: number;
  maxGapSeconds: number;
  totalCueDurationSeconds: number;
  warnings: string[];
};

type CaptionTranscriptFidelity = {
  matchedTranscriptTokens: number;
  transcriptTokenCount: number;
  extraCueTokens: number;
  cueTokenCount: number;
  transcriptCoverageRatio: number;
  extraCueTokenRatio: number;
  warnings: string[];
};

export type BulkCaptionGenerationResult = {
  sermonId: string;
  attempted: number;
  generated: number;
  reused: number;
  skipped: number;
  failed: number;
  errors: Array<{ clipId: string; reason: string }>;
};

function normalizeCaptionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeFidelityToken(token: string): string {
  const normalized = token
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "")
    .replace(/'s$/i, "");

  return normalized.length > 4 && normalized.endsWith("s")
    ? normalized.slice(0, -1)
    : normalized;
}

function captionFidelityTokens(text: string): string[] {
  return text
    .split(/\s+/g)
    .map(normalizeFidelityToken)
    .filter((token) => token.length >= 3);
}

function countTokenMatches(sourceTokens: string[], targetTokens: string[]): number {
  const remaining = new Map<string, number>();
  for (const token of targetTokens) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }

  let matches = 0;
  for (const token of sourceTokens) {
    const count = remaining.get(token) ?? 0;
    if (count <= 0) {
      continue;
    }

    matches += 1;
    remaining.set(token, count - 1);
  }

  return matches;
}

function formatSrtTimestamp(seconds: number): string {
  const clampedMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(clampedMilliseconds / 3600000);
  const minutes = Math.floor((clampedMilliseconds % 3600000) / 60000);
  const remainingSeconds = Math.floor((clampedMilliseconds % 60000) / 1000);
  const milliseconds = clampedMilliseconds % 1000;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(",", String(milliseconds).padStart(3, "0"));
}

function resolveClipBoundaries(clip: Pick<ClipForCaption, "startTimeSeconds" | "endTimeSeconds" | "adjustedStartTimeSeconds" | "adjustedEndTimeSeconds">): {
  startTimeSeconds: number;
  endTimeSeconds: number;
} {
  return {
    startTimeSeconds: clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds,
    endTimeSeconds: clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds,
  };
}

function resolveClipDurationSeconds(clip: Pick<ClipForCaption, "startTimeSeconds" | "endTimeSeconds" | "adjustedStartTimeSeconds" | "adjustedEndTimeSeconds" | "durationSeconds">): number {
  const boundaries = resolveClipBoundaries(clip);
  return Number((boundaries.endTimeSeconds - boundaries.startTimeSeconds).toFixed(3));
}

function validateCaptionGenerationEligibility(
  clip: Pick<ClipForCaption, "id" | "status"> & { transcriptSafetyStatus?: ClipForCaption["transcriptSafetyStatus"] },
): { ok: true } | { ok: false; reason: string } {
  if (clip.status !== "APPROVED" && clip.status !== "EXPORTED") {
    return {
      ok: false,
      reason: `Clip ${clip.id} must be approved before captions can be generated.`,
    };
  }

  const transcriptSafety = validateTranscriptSafetyForPublishing({
    transcriptSafetyStatus: clip.transcriptSafetyStatus ?? "TRUSTED",
  });
  if (!transcriptSafety.ok) {
    return {
      ok: false,
      reason: transcriptSafety.reason,
    };
  }

  return { ok: true };
}

function validateCaptionCueTiming(cues: CaptionCue[], clipDurationSeconds: number): { isValid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let previousStart = -1;

  for (const cue of cues) {
    if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0) {
      reasons.push(`Cue ${cue.index} has an invalid start time.`);
    }

    if (!Number.isFinite(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) {
      reasons.push(`Cue ${cue.index} has an invalid end time.`);
    }

    if (cue.endSeconds > clipDurationSeconds + 0.001) {
      reasons.push(`Cue ${cue.index} exceeds clip duration.`);
    }

    if (cue.startSeconds + 0.001 < previousStart) {
      reasons.push(`Cue ${cue.index} starts before a prior cue.`);
    }

    previousStart = cue.startSeconds;
  }

  return {
    isValid: reasons.length === 0,
    reasons,
  };
}

function buildCaptionCues(
  clip: Pick<ClipForCaption, "id" | "startTimeSeconds" | "endTimeSeconds" | "durationSeconds" | "adjustedStartTimeSeconds" | "adjustedEndTimeSeconds">,
  segments: TranscriptSegment[],
): CaptionCue[] {
  const boundaries = resolveClipBoundaries(clip);
  const clipDurationSeconds = resolveClipDurationSeconds(clip);
  const cues: CaptionCue[] = [];

  for (const segment of segments) {
    const overlapStart = Math.max(boundaries.startTimeSeconds, segment.startTimeSeconds);
    const overlapEnd = Math.min(boundaries.endTimeSeconds, segment.endTimeSeconds);
    const relativeStart = Math.max(0, Number((overlapStart - boundaries.startTimeSeconds).toFixed(3)));
    const relativeEnd = Math.min(
      clipDurationSeconds,
      Number((overlapEnd - boundaries.startTimeSeconds).toFixed(3)),
    );

    const text = normalizeCaptionText(segment.text);
    if (!text) {
      continue;
    }

    if (relativeEnd <= relativeStart) {
      continue;
    }

    cues.push({
      index: cues.length + 1,
      startSeconds: relativeStart,
      endSeconds: relativeEnd,
      text,
    });
  }

  return cues;
}

function assessCaptionCueQuality(cues: CaptionCue[], clipDurationSeconds: number): CaptionCueQuality {
  const totalCueDurationSeconds = Number(
    cues.reduce((total, cue) => total + Math.max(0, cue.endSeconds - cue.startSeconds), 0).toFixed(3),
  );
  const coverageRatio = clipDurationSeconds > 0
    ? Number((totalCueDurationSeconds / clipDurationSeconds).toFixed(3))
    : 0;
  const gaps = cues.slice(1).map((cue, index) => Math.max(0, cue.startSeconds - cues[index].endSeconds));
  const maxGapSeconds = gaps.length > 0 ? Number(Math.max(...gaps).toFixed(3)) : 0;
  const warnings: string[] = [];

  if (coverageRatio < 0.25) {
    warnings.push("LOW_CAPTION_COVERAGE");
  }
  if (maxGapSeconds > 30) {
    warnings.push("LARGE_CAPTION_GAPS");
  }

  return {
    coverageRatio,
    maxGapSeconds,
    totalCueDurationSeconds,
    warnings,
  };
}

function assessCaptionTranscriptFidelity(
  cues: CaptionCue[],
  clipTranscriptText: string,
): CaptionTranscriptFidelity {
  const transcriptTokens = captionFidelityTokens(clipTranscriptText);
  const cueTokens = captionFidelityTokens(cues.map((cue) => cue.text).join(" "));
  const matchedTranscriptTokens = countTokenMatches(transcriptTokens, cueTokens);
  const matchedCueTokens = countTokenMatches(cueTokens, transcriptTokens);
  const extraCueTokens = Math.max(0, cueTokens.length - matchedCueTokens);
  const transcriptCoverageRatio = transcriptTokens.length > 0
    ? Number((matchedTranscriptTokens / transcriptTokens.length).toFixed(3))
    : 0;
  const extraCueTokenRatio = cueTokens.length > 0
    ? Number((extraCueTokens / cueTokens.length).toFixed(3))
    : 0;
  const warnings: string[] = [];

  if (transcriptCoverageRatio < 0.7) {
    warnings.push("LOW_CAPTION_TRANSCRIPT_FIDELITY");
  }
  if (extraCueTokenRatio > 0.55 && cueTokens.length >= transcriptTokens.length + 8) {
    warnings.push("CAPTIONS_INCLUDE_SURROUNDING_SERMON_TEXT");
  }

  return {
    matchedTranscriptTokens,
    transcriptTokenCount: transcriptTokens.length,
    extraCueTokens,
    cueTokenCount: cueTokens.length,
    transcriptCoverageRatio,
    extraCueTokenRatio,
    warnings,
  };
}

function buildSrtFromCues(cues: CaptionCue[]): string {
  const blocks = cues.map((cue) => {
    return [
      String(cue.index),
      `${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}`,
      cue.text,
    ].join("\n");
  });

  return `${blocks.join("\n\n")}\n`;
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

function shouldReuseExistingCaptionAsset(
  clip: Pick<ClipForCaption, "subtitlesGenerated" | "captionStatus" | "captionFreshness">,
  options: CaptionGenerationOptions | undefined,
  subtitleFileHasBytes: boolean,
): boolean {
  return Boolean(
    !options?.force &&
    clip.subtitlesGenerated &&
    clip.captionStatus === "GENERATED" &&
    clip.captionFreshness === "UP_TO_DATE" &&
    subtitleFileHasBytes,
  );
}

function hasManualCaptionCues(captionData: unknown): boolean {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return false;
  }

  const record = captionData as Record<string, unknown>;
  const cues = record["cues"];
  return record["manuallyEdited"] === true && Array.isArray(cues) && cues.length > 0;
}

function extractManualCaptionCues(captionData: unknown): CaptionCue[] {
  if (!captionData || typeof captionData !== "object" || Array.isArray(captionData)) {
    return [];
  }

  const cues = (captionData as Record<string, unknown>)["cues"];
  if (!Array.isArray(cues)) {
    return [];
  }

  return cues.flatMap((cue, index) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
      return [];
    }

    const record = cue as Record<string, unknown>;
    const startSeconds = Number(record["startSeconds"]);
    const endSeconds = Number(record["endSeconds"]);
    const text = typeof record["text"] === "string" ? normalizeCaptionText(record["text"]) : "";
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || !text) {
      return [];
    }

    return [{
      index: index + 1,
      startSeconds,
      endSeconds,
      text,
    }];
  });
}

function shouldPreserveManualCaptionCues(
  clip: Pick<ClipForCaption, "captionData" | "subtitlesGenerated" | "captionStatus" | "captionFreshness">,
  options: CaptionGenerationOptions | undefined,
): boolean {
  return Boolean(
    !options?.force &&
    clip.subtitlesGenerated &&
    clip.captionStatus === "GENERATED" &&
    clip.captionFreshness === "UP_TO_DATE" &&
    hasManualCaptionCues(clip.captionData),
  );
}

function getTempSrtPath(srtPath: string): string {
  return srtPath.replace(/\.srt$/i, ".partial.srt");
}

async function writeCaptionFileAtomically(srtPath: string, srtContent: string): Promise<void> {
  const tempPath = getTempSrtPath(srtPath);
  await unlink(tempPath).catch(() => undefined);
  await writeFile(tempPath, srtContent, "utf8");

  if (!(await fileHasBytes(tempPath))) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error("Caption generation produced an empty subtitle file.");
  }

  try {
    await rename(tempPath, srtPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  if (!(await fileHasBytes(srtPath))) {
    throw new Error("Caption generation produced an empty subtitle file.");
  }
}

async function materializeManualCaptionCues(
  clip: ClipForCaption,
  jobId: string,
): Promise<{ srtPath: string; cueCount: number }> {
  const cues = extractManualCaptionCues(clip.captionData);
  const durationSeconds = resolveClipDurationSeconds(clip);
  const timingValidation = validateCaptionCueTiming(cues, durationSeconds);
  if (cues.length === 0 || !timingValidation.isValid) {
    throw new Error(
      timingValidation.reasons[0]
        ?? "Saved Clip Studio captions could not be materialized for the media worker.",
    );
  }

  await ensureSermonFolders(clip.sermonId);
  const srtPath = getClipSrtPath(clip.sermonId, clip.id);
  await writeCaptionFileAtomically(srtPath, buildSrtFromCues(cues));
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionStatus: "GENERATED",
      subtitleFilePath: srtPath,
      srtPath,
      subtitlesGenerated: true,
      captionGenerationError: null,
    },
  });
  await markCaptionAssetCompleted(clip.id, false);
  await appendJobLog(jobId, `Materialized ${cues.length} saved Clip Studio caption cue(s) for ${clip.id}.`);
  await appendPipelineLog(clip.sermonId, `Saved Clip Studio captions materialized for media worker clip ${clip.id}.`);

  return { srtPath, cueCount: cues.length };
}

async function loadClipForCaption(clipId: string): Promise<ClipForCaption> {
  const clip = await prisma.clipCandidate.findUnique({
    where: {
      id: clipId,
    },
    select: {
      id: true,
      sermonId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      durationSeconds: true,
      transcriptText: true,
      srtPath: true,
      subtitlesGenerated: true,
      captionStatus: true,
      captionFreshness: true,
      captionData: true,
      transcriptSafetyStatus: true,
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

async function getSermonDurationSeconds(sermonId: string): Promise<number> {
  const segment = await prisma.transcriptSegment.findFirst({
    where: { sermonId },
    orderBy: { endTimeSeconds: "desc" },
    select: { endTimeSeconds: true },
  });

  if (!segment) {
    throw new Error("Transcript segments do not exist for this sermon.");
  }

  return segment.endTimeSeconds;
}

async function loadOverlappingSegments(sermonId: string, boundaries: { startTimeSeconds: number; endTimeSeconds: number }): Promise<TranscriptSegment[]> {
  return prisma.transcriptSegment.findMany({
    where: {
      sermonId,
      startTimeSeconds: { lt: boundaries.endTimeSeconds },
      endTimeSeconds: { gt: boundaries.startTimeSeconds },
    },
    orderBy: { startTimeSeconds: "asc" },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      text: true,
    },
  });
}

function buildCaptionMetadata(input: {
  clip: ClipForCaption;
  srtPath: string;
  generatedAt: Date;
  cues: CaptionCue[];
  cueQuality: CaptionCueQuality;
  transcriptFidelity: CaptionTranscriptFidelity;
  reusedExistingFile: boolean;
}): Prisma.ClipCandidateUpdateInput {
  return {
    captionStatus: "GENERATED",
    subtitleFilePath: input.srtPath,
    srtPath: input.srtPath,
    subtitlesGenerated: true,
    captionGeneratedAt: input.generatedAt,
    captionGenerationError: null,
    captionData: {
      schemaVersion: 1,
      source: "transcript-segments",
      generatedAt: input.generatedAt.toISOString(),
      reusedExistingFile: input.reusedExistingFile,
      quality: {
        coverageRatio: input.cueQuality.coverageRatio,
        maxGapSeconds: input.cueQuality.maxGapSeconds,
        totalCueDurationSeconds: input.cueQuality.totalCueDurationSeconds,
        transcriptCoverageRatio: input.transcriptFidelity.transcriptCoverageRatio,
        extraCueTokenRatio: input.transcriptFidelity.extraCueTokenRatio,
        warnings: Array.from(new Set([
          ...input.cueQuality.warnings,
          ...input.transcriptFidelity.warnings,
        ])),
      },
      cues: input.cues.map((cue) => ({
        index: cue.index,
        startSeconds: cue.startSeconds,
        endSeconds: cue.endSeconds,
        text: cue.text,
      })),
      clip: {
        startTimeSeconds: resolveClipBoundaries(input.clip).startTimeSeconds,
        endTimeSeconds: resolveClipBoundaries(input.clip).endTimeSeconds,
      },
    },
  };
}

async function markCaptionGenerationFailed(clipId: string, message: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      captionStatus: "FAILED",
      captionGenerationError: message,
    },
  });
  await markCaptionAssetFailed(clipId);
}

async function generateCaptionsForClipCore(
  clip: ClipForCaption,
  options: CaptionGenerationOptions | undefined,
  jobId: string,
): Promise<CaptionGenerationResult> {
  await ensureSermonFolders(clip.sermonId);

  const eligibility = validateCaptionGenerationEligibility(clip);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }

  const boundaries = resolveClipBoundaries(clip);
  const sermonDurationSeconds = await getSermonDurationSeconds(clip.sermonId);
  const boundaryValidation = validateBoundaryTimes({
    startTimeSeconds: boundaries.startTimeSeconds,
    endTimeSeconds: boundaries.endTimeSeconds,
    sermonDurationSeconds,
    transcriptText: clip.transcriptText,
  });

  if (!boundaryValidation.isValid) {
    throw new Error(`Invalid clip boundaries: ${boundaryValidation.reasons.join(" ")}`);
  }

  if (
    boundaryValidation.durationSeconds < HARD_MIN_DURATION_SECONDS ||
    boundaryValidation.durationSeconds > HARD_MAX_DURATION_SECONDS
  ) {
    throw new Error(
      `Clip duration must be between ${HARD_MIN_DURATION_SECONDS} and ${HARD_MAX_DURATION_SECONDS} seconds.`,
    );
  }

  const srtPath = getClipSrtPath(clip.sermonId, clip.id);
  const canReuse = shouldReuseExistingCaptionAsset(clip, options, await fileHasBytes(srtPath));

  if (canReuse) {
    const generatedAt = new Date();
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        captionStatus: "GENERATED",
        subtitleFilePath: srtPath,
        srtPath,
        subtitlesGenerated: true,
        captionGenerationError: null,
      },
    });
    await markCaptionAssetCompleted(clip.id, false);

    await appendJobLog(jobId, `Reused existing subtitle file for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Reused subtitle file for clip ${clip.id}.`);

    return {
      clipId: clip.id,
      srtPath,
      generatedAt,
      reusedExistingFile: true,
      cueCount: 0,
    };
  }

  const segments = await loadOverlappingSegments(clip.sermonId, boundaries);
  if (segments.length === 0) {
    throw new Error("Transcript exists but contains no segments overlapping this clip.");
  }

  const cues = buildCaptionCues(clip, segments);
  if (cues.length === 0) {
    throw new Error("No valid caption cues were generated from overlapping transcript segments.");
  }

  const effectiveClipDurationSeconds = boundaryValidation.durationSeconds;
  const timingValidation = validateCaptionCueTiming(cues, effectiveClipDurationSeconds);
  if (!timingValidation.isValid) {
    throw new Error(`Generated subtitle timing is invalid: ${timingValidation.reasons.join(" ")}`);
  }
  const cueQuality = assessCaptionCueQuality(cues, effectiveClipDurationSeconds);
  const transcriptFidelity = assessCaptionTranscriptFidelity(cues, clip.transcriptText);
  if (cueQuality.coverageRatio < 0.12) {
    throw new Error(
      `Generated captions cover too little of the clip (${Math.round(cueQuality.coverageRatio * 100)}% coverage). Recheck clip boundaries or transcript timing.`,
    );
  }
  if (cueQuality.maxGapSeconds > 45) {
    throw new Error(
      `Generated captions have a large timing gap (${Math.round(cueQuality.maxGapSeconds)}s). Recheck clip boundaries or transcript timing.`,
    );
  }
  if (transcriptFidelity.transcriptCoverageRatio < 0.5) {
    throw new Error(
      `Generated captions do not match enough of the clip transcript (${Math.round(transcriptFidelity.transcriptCoverageRatio * 100)}% transcript coverage). Recheck clip boundaries or regenerate clip captions.`,
    );
  }
  if (
    transcriptFidelity.extraCueTokenRatio > 0.7 &&
    transcriptFidelity.cueTokenCount >= transcriptFidelity.transcriptTokenCount + 12
  ) {
    throw new Error(
      `Generated captions include too much surrounding sermon text (${Math.round(transcriptFidelity.extraCueTokenRatio * 100)}% extra caption words). Recheck clip boundaries or regenerate clip captions.`,
    );
  }

  const srtContent = buildSrtFromCues(cues);
  await writeCaptionFileAtomically(srtPath, srtContent);

  const generatedAt = new Date();
  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: buildCaptionMetadata({
      clip,
      srtPath,
      generatedAt,
      cues,
      cueQuality,
      transcriptFidelity,
      reusedExistingFile: false,
    }),
  });
  await markCaptionAssetCompleted(clip.id, true);
  await invalidateAfterCaptionCompleted(
    clip.id,
    "Caption asset regenerated. Burned captions, overlays, and exports require regeneration.",
  );

  await appendJobLog(
    jobId,
    `Generated ${cues.length} caption cues for clip ${clip.id}. Coverage ${Math.round(cueQuality.coverageRatio * 100)}%, max gap ${Math.round(cueQuality.maxGapSeconds)}s.`,
  );
  await appendPipelineLog(clip.sermonId, `Generated captions for clip ${clip.id}.`);

  return {
    clipId: clip.id,
    srtPath,
    generatedAt,
    reusedExistingFile: false,
    cueCount: cues.length,
  };
}

export async function generateCaptionsForClip(
  clipId: string,
  options?: CaptionGenerationOptions,
): Promise<CaptionGenerationResult> {
  const normalizedClipId = clipId.trim();
  if (!normalizedClipId) {
    throw new Error("Clip id is required for caption generation.");
  }

  const clip = await loadClipForCaption(normalizedClipId);
  const eligibility = validateCaptionGenerationEligibility(clip);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }

  const job = await createProcessingJob(clip.sermonId, "GENERATE_SUBTITLES");

  await prisma.clipCandidate.update({
    where: { id: clip.id },
    data: {
      captionStatus: "GENERATING",
      captionGenerationError: null,
    },
  });

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Caption generation started for clip ${clip.id}.`);
    await appendPipelineLog(clip.sermonId, `Caption generation requested for clip ${clip.id}.`);

    const result = await generateCaptionsForClipCore(clip, options, job.id);

    await markJobSucceeded(
      job.id,
      result.reusedExistingFile
        ? `Reused existing subtitle file for ${clip.id}.`
        : `Generated caption data and SRT for ${clip.id}.`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown caption generation error.";
    await markCaptionGenerationFailed(clip.id, message);
    await markJobFailed(job.id, message, "Caption generation failed.");
    await appendPipelineLog(clip.sermonId, `Caption generation failed for clip ${clip.id}: ${message}`);
    throw new Error(message);
  }
}

export async function generateCaptionsForApprovedClips(
  sermonId: string,
  options?: CaptionGenerationOptions,
): Promise<BulkCaptionGenerationResult> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    throw new Error("Sermon id is required for bulk caption generation.");
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: normalizedSermonId },
    select: { id: true },
  });

  if (!sermon) {
    throw new Error(`Sermon ${normalizedSermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id);

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: sermon.id,
      status: {
        in: ["APPROVED", "EXPORTED"],
      },
    },
    orderBy: [{ startTimeSeconds: "asc" }],
    select: {
      id: true,
      sermonId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      durationSeconds: true,
      transcriptText: true,
      srtPath: true,
      subtitlesGenerated: true,
      captionStatus: true,
      captionFreshness: true,
      captionData: true,
      transcriptSafetyStatus: true,
    },
  });

  if (clips.length === 0) {
    const message = "No approved clips are available for caption generation.";
    await appendPipelineLog(sermon.id, message);
    return {
      sermonId: sermon.id,
      attempted: 0,
      generated: 0,
      reused: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }

  const job = await createProcessingJob(sermon.id, "GENERATE_SUBTITLES");
  await markJobRunning(job.id);
  await appendJobLog(job.id, `Bulk caption generation started for sermon ${sermon.id}.`);
  await appendPipelineLog(sermon.id, "Bulk caption generation requested.");

  let generated = 0;
  let reused = 0;
  let skipped = 0;
  const errors: Array<{ clipId: string; reason: string }> = [];

  for (const clip of clips) {
    const currentClip = await loadClipForCaption(clip.id).catch(() => null);
    if (!currentClip) {
      skipped += 1;
      await appendJobLog(job.id, `Caption generation skipped for ${clip.id}: clip no longer exists.`);
      continue;
    }

    const eligibility = validateCaptionGenerationEligibility(currentClip);
    if (!eligibility.ok) {
      skipped += 1;
      await appendJobLog(job.id, `Caption generation skipped for ${clip.id}: ${eligibility.reason}`);
      continue;
    }

    if (shouldPreserveManualCaptionCues(currentClip, options)) {
      try {
        await materializeManualCaptionCues(currentClip, job.id);
        reused += 1;
        await appendJobLog(job.id, `Caption generation preserved manual Clip Studio cues for ${clip.id}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Saved Clip Studio captions could not be materialized.";
        errors.push({ clipId: clip.id, reason: message });
        await markCaptionGenerationFailed(clip.id, message);
        await appendJobLog(job.id, `Manual Clip Studio caption materialization failed for ${clip.id}: ${message}`);
      }
      continue;
    }

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        captionStatus: "GENERATING",
        captionGenerationError: null,
      },
    });

    try {
      const result = await generateCaptionsForClipCore(currentClip, options, job.id);
      if (result.reusedExistingFile) {
        reused += 1;
      } else {
        generated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown caption generation error.";
      errors.push({ clipId: clip.id, reason: message });
      await markCaptionGenerationFailed(clip.id, message);
      await appendJobLog(job.id, `Caption generation failed for ${clip.id}: ${message}`);
    }
  }

  const failed = errors.length;
  const summary = `Caption generation complete. Generated: ${generated}, reused: ${reused}, skipped: ${skipped}, failed: ${failed}.`;

  if (failed > 0) {
    await markJobFailed(job.id, `${failed} clip(s) failed caption generation.`, summary);
  } else {
    await markJobSucceeded(job.id, summary);
  }

  await appendPipelineLog(sermon.id, summary);

  return {
    sermonId: sermon.id,
    attempted: clips.length,
    generated,
    reused,
    skipped,
    failed,
    errors,
  };
}

export const __captionServiceTestUtils = {
  buildCaptionCues,
  buildSrtFromCues,
  assessCaptionCueQuality,
  assessCaptionTranscriptFidelity,
  validateCaptionCueTiming,
  validateCaptionGenerationEligibility,
  shouldReuseExistingCaptionAsset,
  hasManualCaptionCues,
  extractManualCaptionCues,
  shouldPreserveManualCaptionCues,
  fileHasBytes,
  writeCaptionFileAtomically,
};
