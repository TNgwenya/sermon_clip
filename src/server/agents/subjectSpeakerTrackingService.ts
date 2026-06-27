import type { SermonSubjectKind } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type TrackResult = {
  subjectCount: number;
  speakerCount: number;
};

type SubjectAccumulator = {
  label: string;
  kind: SermonSubjectKind;
  evidence: string | null;
  occurrenceCount: number;
  confidenceScore: number;
  firstStartTimeSeconds: number | null;
  lastEndTimeSeconds: number | null;
};

type SpeakerAccumulator = {
  label: string;
  displayName: string;
  segmentCount: number;
  wordCount: number;
  firstStartTimeSeconds: number | null;
  lastEndTimeSeconds: number | null;
  confidenceScore: number;
  isPrimary: boolean;
};

const STOP_PHRASES = new Set([
  "God",
  "Lord",
  "Jesus Christ",
  "Holy Spirit",
]);

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function subjectKey(label: string, kind: SermonSubjectKind): string {
  return `${kind}:${label.toLowerCase()}`;
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function bumpSubject(
  subjects: Map<string, SubjectAccumulator>,
  input: {
    label: string | null | undefined;
    kind: SermonSubjectKind;
    evidence?: string | null;
    occurrenceCount?: number;
    confidenceScore?: number;
    start?: number | null;
    end?: number | null;
  },
) {
  const label = normalizeLabel(input.label ?? "");
  if (!label || label.length < 2) {
    return;
  }

  const key = subjectKey(label, input.kind);
  const existing = subjects.get(key);
  const occurrenceCount = Math.max(1, input.occurrenceCount ?? 1);
  const confidenceScore = Math.max(0, Math.min(1, input.confidenceScore ?? 0.75));

  if (!existing) {
    subjects.set(key, {
      label,
      kind: input.kind,
      evidence: input.evidence ? normalizeLabel(input.evidence).slice(0, 500) : null,
      occurrenceCount,
      confidenceScore,
      firstStartTimeSeconds: input.start ?? null,
      lastEndTimeSeconds: input.end ?? null,
    });
    return;
  }

  existing.occurrenceCount += occurrenceCount;
  existing.confidenceScore = Math.max(existing.confidenceScore, confidenceScore);
  existing.evidence = existing.evidence ?? (input.evidence ? normalizeLabel(input.evidence).slice(0, 500) : null);
  existing.firstStartTimeSeconds =
    existing.firstStartTimeSeconds === null
      ? input.start ?? null
      : input.start === null || input.start === undefined
        ? existing.firstStartTimeSeconds
        : Math.min(existing.firstStartTimeSeconds, input.start);
  existing.lastEndTimeSeconds =
    existing.lastEndTimeSeconds === null
      ? input.end ?? null
      : input.end === null || input.end === undefined
        ? existing.lastEndTimeSeconds
        : Math.max(existing.lastEndTimeSeconds, input.end);
}

function extractNamedSubjects(text: string): string[] {
  const matches = text.match(/\b(?:[A-Z][a-z]+|Holy|Jesus|Christ|Spirit)(?:\s+(?:[A-Z][a-z]+|of|the|and|Holy|Jesus|Christ|Spirit)){0,3}\b/g) ?? [];
  return Array.from(new Set(matches.map(normalizeLabel).filter((item) => {
    if (item.length < 4 || item.length > 60) {
      return false;
    }
    if (/^(I|We|You|They|This|That|The|A|An|And|But|So|Now|When|Where|Why|How)$/.test(item)) {
      return false;
    }
    return STOP_PHRASES.has(item) || item.split(" ").length > 1;
  }))).slice(0, 12);
}

function speakerDisplayName(label: string, sermonSpeakerName: string): string {
  const normalized = normalizeLabel(label);
  if (!normalized || /^speaker\s*0?1$/i.test(normalized) || /^speaker$/i.test(normalized)) {
    return sermonSpeakerName;
  }

  return normalized;
}

export async function refreshSubjectSpeakerTracking(sermonId: string): Promise<TrackResult> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      speakerName: true,
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
      intelligence: {
        select: {
          centralTheme: true,
          manualCentralTheme: true,
          summary: true,
          confidenceScore: true,
        },
      },
      scriptureRefs: {
        select: {
          reference: true,
          frequencyCount: true,
          confidenceScore: true,
          transcriptEvidence: true,
        },
      },
      topicTags: {
        select: {
          topic: true,
          confidenceScore: true,
          evidence: true,
        },
      },
      ministryMoments: {
        select: {
          title: true,
          momentType: true,
          clipCategory: true,
          suggestedAudience: true,
          confidenceScore: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          transcriptExcerpt: true,
        },
      },
      clipCandidates: {
        select: {
          smartClipCategory: true,
          intendedAudience: true,
          score: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          transcriptText: true,
        },
      },
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  const subjects = new Map<string, SubjectAccumulator>();
  const speakers = new Map<string, SpeakerAccumulator>();

  for (const segment of sermon.transcriptSegments) {
    const label = normalizeLabel(segment.speakerLabel ?? sermon.speakerName);
    const displayName = speakerDisplayName(label, sermon.speakerName);
    const key = label.toLowerCase();
    const existing = speakers.get(key);
    const segmentWords = wordCount(segment.text);

    if (!existing) {
      speakers.set(key, {
        label,
        displayName,
        segmentCount: 1,
        wordCount: segmentWords,
        firstStartTimeSeconds: segment.startTimeSeconds,
        lastEndTimeSeconds: segment.endTimeSeconds,
        confidenceScore: segment.confidence ?? 0.85,
        isPrimary: displayName.toLowerCase() === sermon.speakerName.toLowerCase(),
      });
    } else {
      existing.segmentCount += 1;
      existing.wordCount += segmentWords;
      existing.firstStartTimeSeconds = Math.min(existing.firstStartTimeSeconds ?? segment.startTimeSeconds, segment.startTimeSeconds);
      existing.lastEndTimeSeconds = Math.max(existing.lastEndTimeSeconds ?? segment.endTimeSeconds, segment.endTimeSeconds);
      existing.confidenceScore = Math.max(existing.confidenceScore, segment.confidence ?? 0.85);
      existing.isPrimary = existing.isPrimary || displayName.toLowerCase() === sermon.speakerName.toLowerCase();
    }

    for (const namedSubject of extractNamedSubjects(segment.text)) {
      bumpSubject(subjects, {
        label: namedSubject,
        kind: STOP_PHRASES.has(namedSubject) ? "PERSON" : "CONCEPT",
        evidence: segment.text,
        start: segment.startTimeSeconds,
        end: segment.endTimeSeconds,
        confidenceScore: 0.62,
      });
    }
  }

  if (speakers.size === 0) {
    speakers.set(sermon.speakerName.toLowerCase(), {
      label: sermon.speakerName,
      displayName: sermon.speakerName,
      segmentCount: 0,
      wordCount: 0,
      firstStartTimeSeconds: null,
      lastEndTimeSeconds: null,
      confidenceScore: 0.7,
      isPrimary: true,
    });
  }

  for (const topic of sermon.topicTags) {
    bumpSubject(subjects, {
      label: topic.topic,
      kind: "TOPIC",
      evidence: topic.evidence,
      confidenceScore: topic.confidenceScore,
    });
  }

  for (const scripture of sermon.scriptureRefs) {
    bumpSubject(subjects, {
      label: scripture.reference,
      kind: "SCRIPTURE",
      evidence: scripture.transcriptEvidence,
      occurrenceCount: scripture.frequencyCount,
      confidenceScore: scripture.confidenceScore,
    });
  }

  const centralTheme = sermon.intelligence?.manualCentralTheme ?? sermon.intelligence?.centralTheme;
  if (centralTheme) {
    bumpSubject(subjects, {
      label: centralTheme,
      kind: "THEME",
      evidence: sermon.intelligence?.summary,
      confidenceScore: sermon.intelligence?.confidenceScore ?? 0.8,
    });
  }

  for (const moment of sermon.ministryMoments) {
    bumpSubject(subjects, {
      label: moment.clipCategory ?? moment.title,
      kind: "MINISTRY_MOMENT",
      evidence: moment.transcriptExcerpt,
      confidenceScore: moment.confidenceScore,
      start: moment.startTimeSeconds,
      end: moment.endTimeSeconds,
    });
    bumpSubject(subjects, {
      label: moment.suggestedAudience,
      kind: "AUDIENCE",
      evidence: moment.title,
      confidenceScore: Math.max(0.55, moment.confidenceScore - 0.1),
      start: moment.startTimeSeconds,
      end: moment.endTimeSeconds,
    });
  }

  for (const clip of sermon.clipCandidates) {
    bumpSubject(subjects, {
      label: clip.smartClipCategory,
      kind: "MINISTRY_MOMENT",
      evidence: clip.transcriptText,
      confidenceScore: Math.max(0.5, Math.min(1, clip.score / 10)),
      start: clip.startTimeSeconds,
      end: clip.endTimeSeconds,
    });
    bumpSubject(subjects, {
      label: clip.intendedAudience,
      kind: "AUDIENCE",
      evidence: clip.transcriptText,
      confidenceScore: Math.max(0.5, Math.min(1, clip.score / 10) - 0.08),
      start: clip.startTimeSeconds,
      end: clip.endTimeSeconds,
    });
  }

  const subjectRows = Array.from(subjects.values())
    .sort((left, right) => (right.occurrenceCount * right.confidenceScore) - (left.occurrenceCount * left.confidenceScore))
    .slice(0, 80);
  const speakerRows = Array.from(speakers.values())
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || right.wordCount - left.wordCount);

  await prisma.$transaction(async (tx) => {
    await tx.sermonSubjectTrack.deleteMany({ where: { sermonId } });
    await tx.sermonSpeakerTrack.deleteMany({ where: { sermonId } });

    if (subjectRows.length > 0) {
      await tx.sermonSubjectTrack.createMany({
        data: subjectRows.map((subject) => ({
          sermonId,
          label: subject.label,
          kind: subject.kind,
          evidence: subject.evidence,
          occurrenceCount: subject.occurrenceCount,
          confidenceScore: subject.confidenceScore,
          firstStartTimeSeconds: subject.firstStartTimeSeconds,
          lastEndTimeSeconds: subject.lastEndTimeSeconds,
          isAiGenerated: false,
        })),
      });
    }

    if (speakerRows.length > 0) {
      await tx.sermonSpeakerTrack.createMany({
        data: speakerRows.map((speaker, index) => ({
          sermonId,
          label: speaker.label,
          displayName: speaker.displayName,
          segmentCount: speaker.segmentCount,
          wordCount: speaker.wordCount,
          firstStartTimeSeconds: speaker.firstStartTimeSeconds,
          lastEndTimeSeconds: speaker.lastEndTimeSeconds,
          confidenceScore: speaker.confidenceScore,
          isPrimary: speaker.isPrimary || index === 0,
        })),
      });
    }
  });

  return {
    subjectCount: subjectRows.length,
    speakerCount: speakerRows.length,
  };
}

