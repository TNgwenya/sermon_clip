import { createHash } from "node:crypto";

import type { TeachingBoundaryQuality, TeachingVideoType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  buildTeachingTranscriptAnchors,
  buildTeachingTranscriptWindows,
  rangesSubstantiallyOverlap,
  refineTeachingVideoBoundaries,
  TEACHING_VIDEO_MAX_SUGGESTIONS,
  TEACHING_VIDEO_TARGET_MAX_SECONDS,
  TEACHING_VIDEO_TARGET_MIN_SECONDS,
  type TeachingTranscriptAnchor,
} from "@/lib/teachingVideos";
import {
  selectBestTeachingVideoTitle,
  type TeachingVideoTitleAssessment,
} from "@/lib/teachingVideoTitles";
import { appendJobLog } from "@/server/agents/processing";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import {
  resolveOpenAIChatModel,
  resolveOpenAIReasoningEffort,
} from "@/server/ai/modelConfig";
import {
  teachingVideoWindowResponseSchema,
  type TeachingVideoAiCandidate,
  type TeachingVideoWindowResponse,
} from "@/server/ai/teachingVideoSchema";

const PROMPT_VERSION = "teaching-videos-v1.1.0";

type ValidatedCandidate = TeachingVideoAiCandidate & {
  title: string;
  titleQuality: TeachingVideoTitleAssessment;
  startTimeSeconds: number;
  endTimeSeconds: number;
  startAnchorId: string;
  endAnchorId: string;
  transcriptExcerpt: string;
  boundaryQuality: TeachingBoundaryQuality;
  boundaryValidation: {
    reasons: string[];
    riskFlags: string[];
    titleOptions: string[];
    titleQuality: TeachingVideoTitleAssessment;
  };
};

function normalizedEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function teachingTranscriptFingerprint(input: {
  transcriptUpdatedAt: Date;
  segments: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    speakerLabel: string | null;
    confidence: number | null;
  }>;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      transcriptUpdatedAt: input.transcriptUpdatedAt.toISOString(),
      segments: input.segments.map((segment) => [
        Number(segment.startTimeSeconds.toFixed(3)),
        Number(segment.endTimeSeconds.toFixed(3)),
        segment.text.replace(/\s+/g, " ").trim(),
        segment.speakerLabel,
        segment.confidence,
      ]),
    }))
    .digest("hex");
}

function transcriptForPrompt(segments: TeachingTranscriptAnchor[]): string {
  return segments.map((segment) => {
    const speaker = segment.speakerLabel ? ` speaker=${segment.speakerLabel}` : "";
    const confidence = typeof segment.confidence === "number"
      ? ` confidence=${segment.confidence.toFixed(2)}`
      : "";
    return [
      `[${segment.startAnchorId} → ${segment.endAnchorId}]`,
      `[${segment.startTimeSeconds.toFixed(2)}-${segment.endTimeSeconds.toFixed(2)}${speaker}${confidence}]`,
      segment.text,
    ].join(" ");
  }).join("\n");
}

function buildSystemPrompt(): string {
  return [
    "You are a senior sermon editor analysing a time-coded transcript.",
    "Identify only complete, standalone teaching sections that can become YouTube teaching videos.",
    "You must not create, rewrite, summarize, rearrange, or combine sermon content.",
    "Every candidate must be exactly one continuous section of the supplied recording.",
    "Use only supplied startAnchorId and endAnchorId values. Never invent transcript text, anchors, or timestamps.",
    "Prefer 5-12 minutes, but completeness is more important than duration. A shorter or longer section requires durationExceptionReason.",
    "Do not begin or end inside a sentence, scripture reading, illustration, story, argument, prayer, altar call, or conclusion.",
    "The selected section must introduce enough context, complete its reasoning, and land the teaching without requiring the rest of the sermon.",
    "If no section meets the standard, return candidates as an empty array.",
    "Titles are the only new editorial language you may generate. Return three distinct titleOptions for every candidate.",
    "Every title option must be a direct, viewer-centred question about a real tension, decision, habit, fear, relationship, or struggle addressed by the teaching.",
    "Use you, your, you're, or yourself. Prefer 7-11 words and never exceed 14 words.",
    "Create honest curiosity and clear personal stakes without hype, vague church language, sensational claims, or promises the teaching does not make.",
    "A strong quality-bar example is: “Could What You’re Watching Be Holding You Back?” Use it only when the selected transcript genuinely teaches that idea; do not copy it onto unrelated sections.",
    "titleEvidence must be one exact, continuous phrase copied verbatim from the selected transcript. Do not omit, insert, rearrange, or paraphrase words inside the evidence.",
    "All three title options must accurately express the meaning of titleEvidence and the complete selected section.",
    "Return strict JSON only, with schemaVersion 2 and the supplied windowId.",
  ].join("\n");
}

function buildUserPrompt(input: {
  sermon: {
    title: string;
    speakerName: string;
    churchName: string;
    language: string;
  };
  window: {
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    segments: TeachingTranscriptAnchor[];
  };
  structureHints: Array<{
    sectionType: string;
    title: string | null;
    startTimeSeconds: number | null;
    endTimeSeconds: number | null;
  }>;
}): string {
  const hints = input.structureHints
    .filter((hint) => (
      hint.startTimeSeconds === null
      || hint.endTimeSeconds === null
      || (
        hint.endTimeSeconds >= input.window.startTimeSeconds
        && hint.startTimeSeconds <= input.window.endTimeSeconds
      )
    ))
    .map((hint) => ({
      type: hint.sectionType,
      title: hint.title,
      start: hint.startTimeSeconds,
      end: hint.endTimeSeconds,
    }));

  return [
    `windowId: ${input.window.id}`,
    `sermonTitle: ${input.sermon.title}`,
    `speaker: ${input.sermon.speakerName}`,
    `church: ${input.sermon.churchName}`,
    `language: ${input.sermon.language}`,
    `windowSeconds: ${input.window.startTimeSeconds.toFixed(2)}-${input.window.endTimeSeconds.toFixed(2)}`,
    `structureHints: ${JSON.stringify(hints)}`,
    "",
    "Required JSON shape:",
    JSON.stringify({
      schemaVersion: 2,
      windowId: input.window.id,
      candidates: [{
        startAnchorId: "segment-000000:start",
        endAnchorId: "segment-000120:end",
        recommendedStartSeconds: 0,
        recommendedEndSeconds: 600,
        titleOptions: [
          "Could This Daily Habit Be Holding You Back?",
          "What Is Your Focus Doing to Your Future?",
          "Are You Feeding the Thoughts That Keep You Stuck?",
        ],
        titleEvidence: "one exact continuous phrase copied from the selected transcript",
        teachingType: "SCRIPTURE_EXPOSITION | DOCTRINAL_EXPLANATION | PRACTICAL_APPLICATION | PASTORAL_COUNSEL | LEADERSHIP_TEACHING | OTHER",
        completeness: {
          standaloneScore: 0.9,
          boundaryConfidence: 0.9,
          topicIntroduced: true,
          argumentResolved: true,
          scriptureComplete: true,
          illustrationComplete: true,
          prayerOrConclusionComplete: true,
        },
        startReason: "Why this is a complete opening boundary.",
        endReason: "Why this is a complete closing boundary.",
        contextDependencies: [],
        riskFlags: [],
        durationExceptionReason: null,
      }],
    }),
    "",
    "Transcript anchors:",
    transcriptForPrompt(input.window.segments),
  ].join("\n");
}

function candidateScore(candidate: ValidatedCandidate): number {
  return (
    candidate.completeness.standaloneScore * 0.65
    + candidate.completeness.boundaryConfidence * 0.35
    + candidate.titleQuality.score / 1000
    - candidate.contextDependencies.length * 0.05
    - candidate.riskFlags.length * 0.025
  );
}

function validateAiCandidate(
  candidate: TeachingVideoAiCandidate,
  anchors: TeachingTranscriptAnchor[],
  sourceDurationSeconds: number | null,
  allowedAnchors?: {
    startAnchorIds: ReadonlySet<string>;
    endAnchorIds: ReadonlySet<string>;
  },
): ValidatedCandidate | null {
  if (
    allowedAnchors
    && (
      !allowedAnchors.startAnchorIds.has(candidate.startAnchorId)
      || !allowedAnchors.endAnchorIds.has(candidate.endAnchorId)
    )
  ) {
    return null;
  }
  const startIndex = anchors.findIndex((anchor) => anchor.startAnchorId === candidate.startAnchorId);
  const endIndex = anchors.findIndex((anchor) => anchor.endAnchorId === candidate.endAnchorId);
  if (startIndex < 0 || endIndex < startIndex) return null;

  const anchorStart = anchors[startIndex].startTimeSeconds;
  const anchorEnd = anchors[endIndex].endTimeSeconds;
  if (
    Math.abs(candidate.recommendedStartSeconds - anchorStart) > 5
    || Math.abs(candidate.recommendedEndSeconds - anchorEnd) > 5
  ) {
    return null;
  }

  const selected = anchors.slice(startIndex, endIndex + 1);
  const excerpt = selected.map((segment) => segment.text).join(" ");
  const evidence = normalizedEvidence(candidate.titleEvidence);
  if (!evidence || !normalizedEvidence(excerpt).includes(evidence)) return null;
  const selectedTitle = selectBestTeachingVideoTitle(candidate.titleOptions);
  if (!selectedTitle) return null;

  const initialDuration = anchorEnd - anchorStart;
  if (
    (initialDuration < TEACHING_VIDEO_TARGET_MIN_SECONDS
      || initialDuration > TEACHING_VIDEO_TARGET_MAX_SECONDS)
    && !candidate.durationExceptionReason
  ) {
    return null;
  }

  const refined = refineTeachingVideoBoundaries(
    anchors,
    anchorStart,
    anchorEnd,
    sourceDurationSeconds,
  );
  if (refined.quality === "BLOCKED") return null;
  const refinedStartIndex = anchors.findIndex(
    (anchor) => anchor.startAnchorId === refined.startAnchorId,
  );
  const refinedEndIndex = anchors.findIndex(
    (anchor) => anchor.endAnchorId === refined.endAnchorId,
  );
  const refinedExcerpt = refinedStartIndex >= 0 && refinedEndIndex >= refinedStartIndex
    ? anchors.slice(refinedStartIndex, refinedEndIndex + 1).map((segment) => segment.text).join(" ")
    : excerpt;

  const allCompletenessChecks = (
    candidate.completeness.topicIntroduced
    && candidate.completeness.argumentResolved
    && candidate.completeness.scriptureComplete
    && candidate.completeness.illustrationComplete
    && candidate.completeness.prayerOrConclusionComplete
  );
  const mergedRisks = Array.from(new Set([
    ...candidate.riskFlags,
    ...refined.riskFlags,
  ]));
  const boundaryQuality: TeachingBoundaryQuality = (
    refined.quality === "GOOD"
    && candidate.completeness.standaloneScore >= 0.75
    && candidate.completeness.boundaryConfidence >= 0.75
    && allCompletenessChecks
    && candidate.contextDependencies.length === 0
    && mergedRisks.length === 0
  ) ? "GOOD" : "NEEDS_REVIEW";

  return {
    ...candidate,
    title: selectedTitle.title,
    titleQuality: selectedTitle,
    startTimeSeconds: refined.startTimeSeconds,
    endTimeSeconds: refined.endTimeSeconds,
    startAnchorId: refined.startAnchorId,
    endAnchorId: refined.endAnchorId,
    transcriptExcerpt: refinedExcerpt,
    boundaryQuality,
    riskFlags: mergedRisks,
    boundaryValidation: {
      reasons: refined.reasons,
      riskFlags: mergedRisks,
      titleOptions: candidate.titleOptions,
      titleQuality: selectedTitle,
    },
  };
}

function deduplicateCandidates(candidates: ValidatedCandidate[]): ValidatedCandidate[] {
  const ranked = [...candidates].sort((a, b) => candidateScore(b) - candidateScore(a));
  const selected: ValidatedCandidate[] = [];
  for (const candidate of ranked) {
    if (!selected.some((existing) => rangesSubstantiallyOverlap(existing, candidate))) {
      selected.push(candidate);
    }
    if (selected.length >= TEACHING_VIDEO_MAX_SUGGESTIONS) break;
  }
  return selected.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

async function analyzeWindow(input: {
  sermon: {
    id: string;
    organizationId: string;
    campusId: string | null;
    title: string;
    speakerName: string;
    churchName: string;
    language: string;
  };
  window: ReturnType<typeof buildTeachingTranscriptWindows>[number];
  structureHints: Array<{
    sectionType: string;
    title: string | null;
    startTimeSeconds: number | null;
    endTimeSeconds: number | null;
  }>;
  model: string;
}): Promise<TeachingVideoWindowResponse> {
  return createLoggedChatCompletion({
    operation: "teaching_video_selection",
    model: input.model,
    reasoningEffort: resolveOpenAIReasoningEffort("teachingVideoSelection", input.model),
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    response_format: { type: "json_object" },
    sermonId: input.sermon.id,
    organizationId: input.sermon.organizationId,
    campusId: input.sermon.campusId,
    promptVersion: PROMPT_VERSION,
    metadata: {
      windowId: input.window.id,
      windowStartSeconds: input.window.startTimeSeconds,
      windowEndSeconds: input.window.endTimeSeconds,
    },
    missingKeyMessage: "OPENAI_API_KEY is required to identify teaching videos.",
    validateResponse: (completion) => {
      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error("Teaching video analysis returned an empty response.");
      const parsed = teachingVideoWindowResponseSchema.parse(JSON.parse(content));
      if (parsed.windowId !== input.window.id) {
        throw new Error("Teaching video analysis returned the wrong windowId.");
      }
      return parsed;
    },
  });
}

export async function generateTeachingVideos(
  sermonId: string,
  options?: { force?: boolean; processingJobId?: string },
): Promise<{ analysisRunId: string; suggestionCount: number; reusedExisting: boolean }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sourceDurationSeconds: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      transcript: {
        select: { updatedAt: true },
      },
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
      structureSections: {
        orderBy: { orderIndex: "asc" },
        select: {
          sectionType: true,
          title: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
        },
      },
    },
  });
  if (!sermon) throw new Error(`Sermon ${sermonId} was not found.`);
  if (!sermon.organizationId) throw new Error("Teaching video analysis requires an organization-owned sermon.");
  if (!sermon.transcript || sermon.transcriptSegments.length === 0) {
    throw new Error("Transcribe the sermon before generating teaching videos.");
  }

  const fingerprint = teachingTranscriptFingerprint({
    transcriptUpdatedAt: sermon.transcript.updatedAt,
    segments: sermon.transcriptSegments,
  });
  if (!options?.force) {
    const existing = await prisma.teachingVideoAnalysisRun.findFirst({
      where: {
        sermonId,
        transcriptFingerprint: fingerprint,
        promptVersion: PROMPT_VERSION,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { teachingVideos: true } } },
    });
    if (existing) {
      return {
        analysisRunId: existing.id,
        suggestionCount: existing._count.teachingVideos,
        reusedExisting: true,
      };
    }
  }

  const model = resolveOpenAIChatModel("teachingVideoSelection");
  const anchors = buildTeachingTranscriptAnchors(sermon.transcriptSegments);
  const startTimeSeconds = sermon.analyzeFullRecording
    ? anchors[0]?.startTimeSeconds
    : sermon.sermonStartSeconds ?? anchors[0]?.startTimeSeconds;
  const endTimeSeconds = sermon.analyzeFullRecording
    ? anchors.at(-1)?.endTimeSeconds
    : sermon.sermonEndSeconds ?? anchors.at(-1)?.endTimeSeconds;
  const windows = buildTeachingTranscriptWindows(anchors, {
    startTimeSeconds,
    endTimeSeconds,
  });
  if (windows.length === 0) throw new Error("The sermon transcript has no analyzable teaching window.");

  const run = await prisma.teachingVideoAnalysisRun.create({
    data: {
      sermonId,
      organizationId: sermon.organizationId,
      campusId: sermon.campusId,
      status: "RUNNING",
      transcriptFingerprint: fingerprint,
      model,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date(),
      configJson: {
        windowCount: windows.length,
        targetMinSeconds: TEACHING_VIDEO_TARGET_MIN_SECONDS,
        targetMaxSeconds: TEACHING_VIDEO_TARGET_MAX_SECONDS,
      },
    },
  });

  try {
    const candidates: ValidatedCandidate[] = [];
    for (const [index, window] of windows.entries()) {
      if (options?.processingJobId) {
        await appendJobLog(
          options.processingJobId,
          `Analysing teaching window ${index + 1}/${windows.length} (${window.startTimeSeconds.toFixed(1)}-${window.endTimeSeconds.toFixed(1)}s).`,
        );
      }
      const response = await analyzeWindow({
        sermon: {
          id: sermon.id,
          organizationId: sermon.organizationId,
          campusId: sermon.campusId,
          title: sermon.title,
          speakerName: sermon.speakerName,
          churchName: sermon.churchName,
          language: sermon.language,
        },
        window,
        structureHints: sermon.structureSections,
        model,
      });
      for (const candidate of response.candidates) {
        const validated = validateAiCandidate(
          candidate,
          anchors,
          sermon.sourceDurationSeconds,
          {
            startAnchorIds: new Set(window.segments.map((segment) => segment.startAnchorId)),
            endAnchorIds: new Set(window.segments.map((segment) => segment.endAnchorId)),
          },
        );
        if (validated) candidates.push(validated);
      }
    }

    const selected = deduplicateCandidates(candidates);
    await prisma.$transaction(async (transaction) => {
      for (const candidate of selected) {
        const durationSeconds = Number(
          (candidate.endTimeSeconds - candidate.startTimeSeconds).toFixed(3),
        );
        await transaction.teachingVideo.create({
          data: {
            analysisRunId: run.id,
            sermonId,
            organizationId: sermon.organizationId!,
            campusId: sermon.campusId,
            status: candidate.boundaryQuality === "GOOD" ? "SUGGESTED" : "NEEDS_REVIEW",
            teachingType: candidate.teachingType as TeachingVideoType,
            aiTitle: candidate.title,
            title: candidate.title,
            suggestedStartSeconds: candidate.startTimeSeconds,
            suggestedEndSeconds: candidate.endTimeSeconds,
            startTimeSeconds: candidate.startTimeSeconds,
            endTimeSeconds: candidate.endTimeSeconds,
            durationSeconds,
            startAnchorId: candidate.startAnchorId,
            endAnchorId: candidate.endAnchorId,
            boundaryQuality: candidate.boundaryQuality,
            standaloneScore: candidate.completeness.standaloneScore,
            boundaryConfidence: candidate.completeness.boundaryConfidence,
            titleEvidence: candidate.titleEvidence,
            startReason: candidate.startReason,
            endReason: candidate.endReason,
            durationExceptionReason: candidate.durationExceptionReason,
            contextDependenciesJson: candidate.contextDependencies,
            riskFlagsJson: candidate.riskFlags,
            completenessJson: candidate.completeness,
            boundaryValidationJson: candidate.boundaryValidation,
            transcriptExcerpt: candidate.transcriptExcerpt,
            transcriptFingerprint: fingerprint,
            revisions: {
              create: {
                version: 1,
                title: candidate.title,
                startTimeSeconds: candidate.startTimeSeconds,
                endTimeSeconds: candidate.endTimeSeconds,
                durationSeconds,
                startAnchorId: candidate.startAnchorId,
                endAnchorId: candidate.endAnchorId,
                boundaryQuality: candidate.boundaryQuality,
                boundaryValidationJson: candidate.boundaryValidation,
                transcriptFingerprint: fingerprint,
              },
            },
          },
        });
      }
      await transaction.teachingVideoAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          configJson: {
            windowCount: windows.length,
            acceptedCandidateCount: selected.length,
            targetMinSeconds: TEACHING_VIDEO_TARGET_MIN_SECONDS,
            targetMaxSeconds: TEACHING_VIDEO_TARGET_MAX_SECONDS,
          },
        },
      });
    });

    return {
      analysisRunId: run.id,
      suggestionCount: selected.length,
      reusedExisting: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Teaching video analysis failed.";
    await prisma.teachingVideoAnalysisRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }
}

export const __teachingVideoAnalysisTestUtils = {
  normalizedEvidence,
  validateAiCandidate,
  deduplicateCandidates,
};
