import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { IntelligenceExperience } from "@/app/sermons/[id]/intelligence/intelligence-experience";

export default async function SermonIntelligencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sermon = await prisma.sermon.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      sermonDate: true,
      language: true,
      status: true,
      transcript: { select: { id: true } },
      intelligence: {
        select: {
          id: true,
          status: true,
          generatedTitle: true,
          summary: true,
          centralTheme: true,
          shortOverview: true,
          keyTakeaways: true,
          confidenceScore: true,
          isManuallyReviewed: true,
          manualTitle: true,
          manualSummary: true,
          manualCentralTheme: true,
          failureReason: true,
          generatedAt: true,
        },
      },
      scriptureRefs: {
        orderBy: [{ isPrimary: "desc" }, { frequencyCount: "desc" }],
        select: {
          id: true,
          reference: true,
          usageType: true,
          isPrimary: true,
          frequencyCount: true,
          confidenceScore: true,
          transcriptEvidence: true,
          isManuallyAdded: true,
        },
      },
      structureSections: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          sectionType: true,
          title: true,
          description: true,
          orderIndex: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          confidenceScore: true,
          transcriptExcerpt: true,
          isManuallyLabeled: true,
        },
      },
      topicTags: {
        orderBy: { confidenceScore: "desc" },
        select: {
          id: true,
          topic: true,
          confidenceScore: true,
          evidence: true,
          isAiGenerated: true,
          isManuallyAdded: true,
        },
      },
      subjectTracks: {
        orderBy: [{ occurrenceCount: "desc" }, { confidenceScore: "desc" }],
        select: {
          id: true,
          label: true,
          kind: true,
          evidence: true,
          occurrenceCount: true,
          confidenceScore: true,
          firstStartTimeSeconds: true,
          lastEndTimeSeconds: true,
        },
        take: 30,
      },
      speakerTracks: {
        orderBy: [{ isPrimary: "desc" }, { wordCount: "desc" }],
        select: {
          id: true,
          label: true,
          displayName: true,
          segmentCount: true,
          wordCount: true,
          firstStartTimeSeconds: true,
          lastEndTimeSeconds: true,
          confidenceScore: true,
          isPrimary: true,
        },
      },
      ministryMoments: {
        orderBy: [{ confidenceScore: "desc" }, { startTimeSeconds: "asc" }],
        select: {
          id: true,
          momentType: true,
          title: true,
          description: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          confidenceScore: true,
          transcriptExcerpt: true,
          whyDetected: true,
          suggestedAudience: true,
          suggestedUsage: true,
          clipCategory: true,
          reviewStatus: true,
          isAiGenerated: true,
          isManuallyAdjusted: true,
        },
      },
    },
  });

  if (!sermon) {
    notFound();
  }

  const hasTranscript = Boolean(sermon.transcript?.id);

  return (
    <>
      <div className="container">
        <div className="stack-md">
          <div>
            <span className="kicker">Sermon Intelligence</span>
            <h1>{sermon.title}</h1>
            <p className="muted small">{sermon.speakerName} · {sermon.churchName}</p>
          </div>

          <IntelligenceExperience
            sermonId={sermon.id}
            hasTranscript={hasTranscript}
            intelligence={sermon.intelligence ? {
              ...sermon.intelligence,
              keyTakeaways: Array.isArray(sermon.intelligence.keyTakeaways)
                ? (sermon.intelligence.keyTakeaways as string[])
                : [],
              generatedAt: sermon.intelligence.generatedAt?.toISOString() ?? null,
            } : null}
            scriptureRefs={sermon.scriptureRefs}
            structureSections={sermon.structureSections}
            topicTags={sermon.topicTags}
            subjectTracks={sermon.subjectTracks}
            speakerTracks={sermon.speakerTracks}
            ministryMoments={sermon.ministryMoments}
          />

          <div className="actions-row">
            <Link href={`/sermons/${sermon.id}`} className="text-link">
              Back to sermon overview
            </Link>
            <Link href="/sermons" className="text-link">
              Sermon Library
            </Link>
            <Link href="/knowledge-base" className="text-link">
              Knowledge Base
            </Link>
            <Link href="/intelligence-dashboard" className="text-link">
              Intelligence Dashboard
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
