import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { refreshSubjectSpeakerTracking } from "@/server/agents/subjectSpeakerTrackingService";

const sermonIds: string[] = [];

describe("subject speaker tracking service", () => {
  afterEach(async () => {
    if (sermonIds.length > 0) {
      await prisma.sermon.deleteMany({ where: { id: { in: sermonIds } } });
      sermonIds.length = 0;
    }
  });

  it("builds speaker and subject tracks from transcript and intelligence context", async () => {
    const sermon = await prisma.sermon.create({
      data: {
        youtubeUrl: "runtime://subject-speaker-tracking",
        title: "Faith That Prays",
        speakerName: "Pastor Grace",
        churchName: "Test Church",
        language: "en",
        rightsConfirmed: true,
      },
    });
    sermonIds.push(sermon.id);

    const transcript = await prisma.transcript.create({
      data: {
        sermonId: sermon.id,
        fullText: "Pastor Grace taught about Jesus Christ and prayer. Guest Elder spoke about faith.",
        provider: "test",
        language: "en",
      },
    });

    await prisma.transcriptSegment.createMany({
      data: [
        {
          sermonId: sermon.id,
          transcriptId: transcript.id,
          startTimeSeconds: 0,
          endTimeSeconds: 12,
          text: "Pastor Grace taught about Jesus Christ and prayer.",
          speakerLabel: "Pastor Grace",
          confidence: 0.94,
        },
        {
          sermonId: sermon.id,
          transcriptId: transcript.id,
          startTimeSeconds: 12,
          endTimeSeconds: 22,
          text: "Guest Elder spoke about faith for the Church.",
          speakerLabel: "Guest Elder",
          confidence: 0.82,
        },
      ],
    });

    await prisma.sermonIntelligence.create({
      data: {
        sermonId: sermon.id,
        status: "COMPLETED",
        generatedTitle: "Faith That Prays",
        summary: "A message about prayer and faith.",
        centralTheme: "Prayer strengthens faith in Jesus Christ.",
        shortOverview: "Prayer and faith.",
        keyTakeaways: ["Pray with faith"],
        confidenceScore: 0.91,
      },
    });

    await prisma.sermonTopicTag.create({
      data: {
        sermonId: sermon.id,
        topic: "prayer",
        confidenceScore: 0.9,
        evidence: "The sermon repeatedly mentions prayer.",
      },
    });

    await prisma.sermonScriptureRef.create({
      data: {
        sermonId: sermon.id,
        reference: "James 5:16",
        usageType: "REFERENCED",
        isPrimary: true,
        frequencyCount: 2,
        confidenceScore: 0.88,
      },
    });

    await prisma.ministryMoment.create({
      data: {
        sermonId: sermon.id,
        momentType: "PRAYER_MOMENT",
        title: "Call to pray",
        description: "The church is invited to pray.",
        confidenceScore: 0.86,
        startTimeSeconds: 3,
        endTimeSeconds: 18,
        transcriptExcerpt: "taught about Jesus Christ and prayer",
        suggestedAudience: "People learning to pray",
        suggestedUsage: "Use as prayer clip",
        clipCategory: "Prayer moment",
      },
    });

    const result = await refreshSubjectSpeakerTracking(sermon.id);

    expect(result.speakerCount).toBe(2);
    expect(result.subjectCount).toBeGreaterThanOrEqual(5);

    const speakers = await prisma.sermonSpeakerTrack.findMany({
      where: { sermonId: sermon.id },
      orderBy: { wordCount: "desc" },
    });
    expect(speakers.map((speaker) => speaker.displayName)).toEqual(expect.arrayContaining(["Pastor Grace", "Guest Elder"]));
    expect(speakers.find((speaker) => speaker.displayName === "Pastor Grace")?.isPrimary).toBe(true);

    const subjects = await prisma.sermonSubjectTrack.findMany({
      where: { sermonId: sermon.id },
    });
    expect(subjects.map((subject) => subject.label)).toEqual(expect.arrayContaining([
      "prayer",
      "James 5:16",
      "Prayer strengthens faith in Jesus Christ.",
      "Prayer moment",
      "People learning to pray",
    ]));
  }, 15_000);
});
