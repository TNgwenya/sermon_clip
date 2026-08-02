import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  hasCompleteWorshipSermonRange,
  WORSHIP_SERMON_RANGE_REQUIRED_MESSAGE,
} from "@/lib/sermonSegment";
import { appendPipelineLog } from "@/server/agents/storage";

export type WorshipTranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  confidence?: number | null;
};

export type WorshipMomentCandidate = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  confidenceScore: number;
  reason: string;
};

export type WorshipMomentResult = {
  momentCount: number;
  clipCount: number;
  reusedExistingClips: boolean;
};

const MIN_WORSHIP_CLIP_SECONDS = 20;
const MAX_WORSHIP_CLIP_SECONDS = 90;
const MAX_PRAISE_AND_WORSHIP_CLIPS = 15;
const MAX_REGION_GAP_SECONDS = 45;
const MIN_WORSHIP_EVIDENCE_SEGMENTS = 3;

const DIRECT_WORSHIP_PATTERNS = [
  /\b(?:hallelujah|haleluya|alleluia)\b/iu,
  /\b(?:holy[\s,]+holy|worthy is|you are worthy|you are holy)\b/iu,
  /\b(?:we|i)\s+(?:worship|praise|adore|exalt|magnify|glorify|sing to)\b/iu,
  /\b(?:praise|bless|worship|adore|exalt|magnify|glorify)\s+(?:you|him|the lord|his name|your name|jesus|god)\b/iu,
  /\b(?:glory|honour|honor|praise)\s+(?:to|belongs to)\s+(?:god|jesus|the lord|you)\b/iu,
  /\b(?:lift|raise)(?:\s+up)?\s+(?:our|my|your)\s+(?:hands|voice|voices)\b/iu,
  /\b(?:you are|god is|jesus is)\s+(?:good|faithful|holy|worthy|mighty|great)\b/iu,
  /\b(?:i love you|we love you)\s+(?:jesus|lord|god)\b/iu,
  /\b(?:lord|jesus|god)[\s,]+(?:we|i)\s+(?:adore|worship|praise|exalt|magnify|glorify)\b/iu,
  /\b(?:none|no one|nothing|no other|besides)\b[^.!?]{0,28}\b(?:you|lord|god)\b/iu,
  /\b(?:thank you|we thank you)\s+(?:jesus|lord|god)\b/iu,
  /\b(?:siyakudumisa|ngiyakudumisa|siyakukhonza|ngiyakukhonza|uyingcwele|udumo kuwe|haleluya)\b/iu,
] as const;

const STRONG_DIRECT_WORSHIP_PATTERNS = DIRECT_WORSHIP_PATTERNS.slice(1);
const WORSHIP_ACCLAMATION_PATTERN = DIRECT_WORSHIP_PATTERNS[0];
const WORSHIP_VOCABULARY_PATTERN =
  /\b(?:worship|praise|sing|song|hallelujah|haleluya|holy|worthy|glory|adore|exalt|magnify|jesus|lord|god|saviour|savior|king|inkosi|jesu|ngcwele|khonza|dumisa)\b/iu;
const SERMON_PROSE_PATTERN =
  /\b(?:the bible says|scripture says|turn with me|today i want to|i want to teach|let me explain|the point is|this passage|this verse|my first point|in conclusion|purposefully ordained|body of christ|obedience|looking for a sermon)\b/iu;
const ANNOUNCEMENT_PROSE_PATTERN =
  /\b(?:rsvp|whatsapp group|sign up|scan (?:it|the|this)|volunteers?|membership training|scholarship|conference|hospitality team|kindly see|the link|every saturday|service (?:from|until|at)|we are selling|t[ -]?shirts?|hoodies?|join (?:our|the)|join us|department|monthly fasting|fasting prayer|taking place|monday|tuesday|wednesday|friday|saturday|women(?:'s)?|temporarily closed|serve (?:and|with|the)|other churches|his ministry|birthday|growing up|give me (?:a|one) minute|waiting for everybody)\b/iu;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{M}\p{N}'’\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function words(value: string): string[] {
  return normalizeText(value).split(/\s+/gu).filter((word) => word.length >= 3);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(words(left));
  const rightTokens = new Set(words(right));
  if (leftTokens.size < 3 || rightTokens.size < 3) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function directSignalCount(text: string): number {
  return DIRECT_WORSHIP_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function strongDirectSignalCount(text: string): number {
  return STRONG_DIRECT_WORSHIP_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function isSpokenProse(text: string): boolean {
  return SERMON_PROSE_PATTERN.test(text) || ANNOUNCEMENT_PROSE_PATTERN.test(text);
}

function isLikelyRepeatedLyric(
  segment: WorshipTranscriptSegment,
  segments: WorshipTranscriptSegment[],
): boolean {
  return segments.some((other) => (
    other !== segment
    && Math.abs(other.startTimeSeconds - segment.startTimeSeconds) <= 150
    && tokenSimilarity(segment.text, other.text) >= 0.68
  ));
}

function segmentWorshipScore(
  segment: WorshipTranscriptSegment,
  segments: WorshipTranscriptSegment[],
): number {
  const normalized = normalizeText(segment.text);
  const directSignals = directSignalCount(normalized);
  const strongDirectSignals = strongDirectSignalCount(normalized);
  const repeatedLyric = isLikelyRepeatedLyric(segment, segments);
  const vocabulary = WORSHIP_VOCABULARY_PATTERN.test(normalized);
  const prosePenalty = isSpokenProse(normalized) ? 3 : 0;
  const shortRefrainBonus = words(normalized).length <= 16 && directSignals > 0 ? 1 : 0;
  const acclamationBonus = WORSHIP_ACCLAMATION_PATTERN.test(normalized) ? 2 : 0;

  return strongDirectSignals * 3
    + acclamationBonus
    + (repeatedLyric ? 2 : 0)
    + (vocabulary ? 1 : 0)
    + shortRefrainBonus
    - prosePenalty;
}

function isWorshipSegment(
  segment: WorshipTranscriptSegment,
  segments: WorshipTranscriptSegment[],
): boolean {
  const score = segmentWorshipScore(segment, segments);
  return score >= 4 && !isSpokenProse(normalizeText(segment.text));
}

function validSegments(segments: WorshipTranscriptSegment[]): WorshipTranscriptSegment[] {
  return [...segments]
    .filter((segment) => (
      Number.isFinite(segment.startTimeSeconds)
      && Number.isFinite(segment.endTimeSeconds)
      && segment.endTimeSeconds > segment.startTimeSeconds
      && segment.text.trim().length > 0
    ))
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
}

function groupWorshipSegments(
  segments: WorshipTranscriptSegment[],
): WorshipTranscriptSegment[][] {
  const worshipSegments = segments.filter((segment) => isWorshipSegment(segment, segments));
  const groups: WorshipTranscriptSegment[][] = [];

  for (const segment of worshipSegments) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const interruptedBySpokenProse = previous
      ? segments.some((between) => (
          between.startTimeSeconds >= previous.endTimeSeconds
          && between.endTimeSeconds <= segment.startTimeSeconds
          && isSpokenProse(normalizeText(between.text))
        ))
      : false;
    if (
      !current
      || !previous
      || segment.startTimeSeconds - previous.endTimeSeconds > MAX_REGION_GAP_SECONDS
      || interruptedBySpokenProse
    ) {
      groups.push([segment]);
    } else {
      current.push(segment);
    }
  }

  return groups;
}

function expandGroupToMinimumDuration(
  group: WorshipTranscriptSegment[],
  allSegments: WorshipTranscriptSegment[],
): WorshipTranscriptSegment[] {
  const first = group[0];
  const last = group.at(-1);
  if (!first || !last) return group;

  let startIndex = allSegments.indexOf(first);
  let endIndex = allSegments.indexOf(last);
  if (startIndex < 0 || endIndex < 0) return group;

  while (
    allSegments[endIndex].endTimeSeconds - allSegments[startIndex].startTimeSeconds < MIN_WORSHIP_CLIP_SECONDS
  ) {
    const before = allSegments[startIndex - 1];
    const after = allSegments[endIndex + 1];
    const canUseBefore = Boolean(
      before
      && allSegments[startIndex].startTimeSeconds - before.endTimeSeconds <= MAX_REGION_GAP_SECONDS
      && !isSpokenProse(normalizeText(before.text)),
    );
    const canUseAfter = Boolean(
      after
      && after.startTimeSeconds - allSegments[endIndex].endTimeSeconds <= MAX_REGION_GAP_SECONDS
      && !isSpokenProse(normalizeText(after.text)),
    );

    if (!canUseBefore && !canUseAfter) break;
    if (canUseAfter && (!canUseBefore || words(after.text).length <= words(before.text).length)) {
      endIndex += 1;
    } else {
      startIndex -= 1;
    }
  }

  return allSegments.slice(startIndex, endIndex + 1);
}

function trimGroupToMaximumDuration(group: WorshipTranscriptSegment[]): WorshipTranscriptSegment[] {
  const first = group[0];
  if (!first) return [];
  const endLimit = first.startTimeSeconds + MAX_WORSHIP_CLIP_SECONDS;
  const selected = group.filter((segment) => segment.endTimeSeconds <= endLimit);
  return selected.length > 0 ? selected : [first];
}

function averageConfidence(segments: WorshipTranscriptSegment[]): number {
  const confidences = segments
    .map((segment) => segment.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (confidences.length === 0) return 0.62;
  return confidences.reduce((total, value) => total + value, 0) / confidences.length;
}

function candidateFromGroup(
  group: WorshipTranscriptSegment[],
  allSegments: WorshipTranscriptSegment[],
): WorshipMomentCandidate | null {
  if (group.length < MIN_WORSHIP_EVIDENCE_SEGMENTS) {
    return null;
  }

  const selected = trimGroupToMaximumDuration(expandGroupToMinimumDuration(group, allSegments));
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last) return null;

  const durationSeconds = Number((last.endTimeSeconds - first.startTimeSeconds).toFixed(2));
  if (durationSeconds < MIN_WORSHIP_CLIP_SECONDS || durationSeconds > MAX_WORSHIP_CLIP_SECONDS) {
    return null;
  }

  const directSignals = selected.reduce((total, segment) => total + directSignalCount(segment.text), 0);
  const strongDirectSignals = selected.reduce(
    (total, segment) => total + strongDirectSignalCount(segment.text),
    0,
  );
  const repeatedLines = selected.filter((segment) => isLikelyRepeatedLyric(segment, allSegments)).length;
  if (
    directSignals === 0
    || (directSignals < 2 && repeatedLines === 0)
    || (strongDirectSignals < 2 && repeatedLines < 1)
  ) {
    return null;
  }

  const confidenceScore = Math.min(
    0.92,
    Math.max(0.55, averageConfidence(selected) + Math.min(0.16, directSignals * 0.025 + repeatedLines * 0.02)),
  );
  return {
    startTimeSeconds: first.startTimeSeconds,
    endTimeSeconds: last.endTimeSeconds,
    durationSeconds,
    transcriptText: selected.map((segment) => segment.text.trim()).join(" "),
    confidenceScore: Number(confidenceScore.toFixed(3)),
    reason: repeatedLines > 0
      ? "Detected a repeated lyric-led praise or worship refrain with a continuous clip-length range."
      : "Detected a sustained lyric-led praise or worship declaration with a continuous clip-length range.",
  };
}

function rangesOverlap(
  left: Pick<WorshipMomentCandidate, "startTimeSeconds" | "endTimeSeconds" | "durationSeconds">,
  right: Pick<WorshipMomentCandidate, "startTimeSeconds" | "endTimeSeconds" | "durationSeconds">,
): boolean {
  const overlap = Math.max(
    0,
    Math.min(left.endTimeSeconds, right.endTimeSeconds) - Math.max(left.startTimeSeconds, right.startTimeSeconds),
  );
  return overlap >= Math.min(left.durationSeconds, right.durationSeconds) * 0.45;
}

export function detectLyricLedWorshipMoments(
  inputSegments: WorshipTranscriptSegment[],
): WorshipMomentCandidate[] {
  const segments = validSegments(inputSegments);
  const candidates = groupWorshipSegments(segments)
    .map((group) => candidateFromGroup(group, segments))
    .filter((candidate): candidate is WorshipMomentCandidate => candidate !== null)
    .sort((left, right) => (
      right.confidenceScore - left.confidenceScore
      || left.startTimeSeconds - right.startTimeSeconds
    ));

  const selected: WorshipMomentCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => rangesOverlap(existing, candidate))) continue;
    selected.push(candidate);
    if (selected.length >= MAX_PRAISE_AND_WORSHIP_CLIPS) break;
  }

  return selected.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
}

export function excludeSermonWindowFromWorshipSegments(
  segments: WorshipTranscriptSegment[],
  sermonStartSeconds: number,
  sermonEndSeconds: number,
): WorshipTranscriptSegment[] {
  return segments.filter((segment) => (
    segment.endTimeSeconds <= sermonStartSeconds
    || segment.startTimeSeconds >= sermonEndSeconds
  ));
}

function shortLyricTitle(text: string, index: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const phrase = normalized.split(/[.!?]/u)[0]?.trim();
  if (!phrase || phrase.length < 4) return `Praise and worship moment ${index + 1}`;
  const title = phrase.split(/\s+/u).slice(0, 8).join(" ");
  return title.length > 64 ? `${title.slice(0, 61).trim()}…` : title;
}

export async function generateWorshipMomentClips(
  sermonId: string,
  options?: { force?: boolean },
): Promise<WorshipMomentResult> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      churchName: true,
      includeWorshipMoments: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      transcriptSegments: {
        orderBy: { startTimeSeconds: "asc" },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
          confidence: true,
        },
      },
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }
  if (!sermon.includeWorshipMoments) {
    return { momentCount: 0, clipCount: 0, reusedExistingClips: false };
  }
  if (!hasCompleteWorshipSermonRange(sermon)) {
    throw new Error(WORSHIP_SERMON_RANGE_REQUIRED_MESSAGE);
  }
  const sermonStartSeconds = sermon.sermonStartSeconds;
  const sermonEndSeconds = sermon.sermonEndSeconds;
  if (typeof sermonStartSeconds !== "number" || typeof sermonEndSeconds !== "number") {
    throw new Error(WORSHIP_SERMON_RANGE_REQUIRED_MESSAGE);
  }

  const existingClipCount = await prisma.clipCandidate.count({
    where: {
      sermonId,
      contentKind: "WORSHIP",
      isAiGenerated: true,
      isManuallyEdited: false,
      status: { in: ["SUGGESTED", "APPROVED", "EXPORTED"] },
    },
  });
  if (existingClipCount > 0 && !options?.force) {
    return {
      momentCount: await prisma.ministryMoment.count({
        where: { sermonId, momentType: "WORSHIP_MOMENT", isAiGenerated: true },
      }),
      clipCount: existingClipCount,
      reusedExistingClips: true,
    };
  }

  const worshipSegments = excludeSermonWindowFromWorshipSegments(
    sermon.transcriptSegments,
    sermonStartSeconds,
    sermonEndSeconds,
  );
  const candidates = detectLyricLedWorshipMoments(worshipSegments);
  if (candidates.length === 0) {
    await appendPipelineLog(
      sermonId,
      "Worship discovery completed without lyric-led candidates. Instrumental-only moments are not included in this beta.",
    );
    return { momentCount: 0, clipCount: 0, reusedExistingClips: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    if (options?.force) {
      await tx.clipCandidate.deleteMany({
        where: {
          sermonId,
          contentKind: "WORSHIP",
          isAiGenerated: true,
          isManuallyEdited: false,
          status: { in: ["SUGGESTED", "REJECTED"] },
        },
      });
      await tx.ministryMoment.deleteMany({
        where: {
          sermonId,
          momentType: "WORSHIP_MOMENT",
          isAiGenerated: true,
          reviewStatus: { in: ["PENDING", "REJECTED", "NEEDS_CORRECTION"] },
        },
      });
    }

    const clipIds: string[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const title = shortLyricTitle(candidate.transcriptText, index);
      const moment = await tx.ministryMoment.create({
        data: {
          sermonId,
          momentType: "WORSHIP_MOMENT",
          title,
          description: "A lyric-led praise and worship moment detected in the full service recording.",
          startTimeSeconds: candidate.startTimeSeconds,
          endTimeSeconds: candidate.endTimeSeconds,
          confidenceScore: candidate.confidenceScore,
          transcriptExcerpt: candidate.transcriptText,
          whyDetected: candidate.reason,
          suggestedAudience: "The church congregation and people looking for a worship moment.",
          suggestedUsage: "Review the lyrics and musical boundaries, then use as a short worship clip.",
          clipCategory: "Best Worship Clip",
          reviewStatus: "PENDING",
          isAiGenerated: true,
          isManuallyAdjusted: false,
        },
      });

      const clip = await tx.clipCandidate.create({
        data: {
          sermonId,
          contentKind: "WORSHIP",
          ministryMomentId: moment.id,
          smartClipCategory: "Best Worship Clip",
          recommendationReason: candidate.reason,
          intendedAudience: "Church members and people seeking a worship moment.",
          ministryValue: "Invites viewers to pause and worship.",
          socialValue: "A concise lyric-led worship excerpt suited to short-form video.",
          suggestedHook: title,
          suggestedCaption: `Join ${sermon.churchName} in this moment of worship.`,
          recommendationConfidence: candidate.confidenceScore,
          isAiGenerated: true,
          isManuallyEdited: false,
          startTimeSeconds: candidate.startTimeSeconds,
          endTimeSeconds: candidate.endTimeSeconds,
          durationSeconds: candidate.durationSeconds,
          originalStartTimeSeconds: candidate.startTimeSeconds,
          originalEndTimeSeconds: candidate.endTimeSeconds,
          adjustedStartTimeSeconds: candidate.startTimeSeconds,
          adjustedEndTimeSeconds: candidate.endTimeSeconds,
          boundaryAdjustmentReason: "Worship beta selected a continuous lyric-led region; review the musical phrase boundaries.",
          boundaryQuality: "NEEDS_REVIEW",
          exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
          transcriptText: candidate.transcriptText,
          transcriptSafetyStatus: "REVIEW_REQUIRED",
          transcriptSafetyReasons: ["WORSHIP_LYRICS_REVIEW_REQUIRED"],
          title,
          hook: title,
          caption: `Join ${sermon.churchName} in this moment of worship.`,
          hashtags: ["#Worship", "#Praise", "#Church"],
          score: Number((candidate.confidenceScore * 10).toFixed(2)),
          reasonSelected: candidate.reason,
          clipType: "worship",
          riskLevel: "MEDIUM",
          riskReasons: ["Review lyric accuracy, music rights, congregation visibility, and musical phrase boundaries before publishing."],
          contextWarning: true,
          finalQualityScore: Number((candidate.confidenceScore * 10).toFixed(2)),
          qualityLabel: "GOOD_NEEDS_REVIEW",
          qualityReasons: [candidate.reason],
          rankingCategory: "NEEDS_REVIEW",
          postReadyStatus: "GOOD_NEEDS_REVIEW",
          recommendedNextAction: "REVIEW_CLIP",
          qualitySummary: "Promising lyric-led worship moment; pastor or media-team review is required.",
          pastorFriendlyReason: "Check the lyrics, music rights, congregation visibility, and the beginning and ending before approval.",
          recommendedAction: "NEEDS_REVIEW",
          qualityWarnings: ["WORSHIP_LYRICS_REVIEW_REQUIRED", "WORSHIP_BOUNDARY_REVIEW_REQUIRED"],
          qualityReviewedAt: new Date(),
          qualityReviewSource: "FALLBACK",
          captionData: {
            applyCaptionsToClip: false,
            captionStyleSource: "clip",
            captionStylePresetId: "minimal-church",
            speechCleanup: {
              removeDeadAir: false,
              tightenLongPauses: false,
              flagFillerWords: false,
              intensity: "normal",
            },
            exportSettings: {
              framingMode: "FIT_BLURRED_BACKGROUND",
              framingPersonality: "WORSHIP_WIDE",
            },
          } satisfies Prisma.InputJsonObject,
          status: "SUGGESTED",
        },
        select: { id: true },
      });
      clipIds.push(clip.id);
    }

    return clipIds;
  });

  await appendPipelineLog(
    sermonId,
    `Worship discovery saved ${created.length} lyric-led worship clip suggestion(s) for human review.`,
  );
  return {
    momentCount: candidates.length,
    clipCount: created.length,
    reusedExistingClips: false,
  };
}

export const __worshipMomentTestUtils = {
  directSignalCount,
  isLikelyRepeatedLyric,
  segmentWorshipScore,
  tokenSimilarity,
};
