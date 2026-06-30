import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { IntelligenceExperience } from "@/app/sermons/[id]/intelligence/intelligence-experience";

function formatSermonStatus(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

function missingTranscriptStatusLine(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized.includes("FAILED") || normalized.includes("ERROR")) {
    return "Status: sermon processing needs attention before a transcript can be created.";
  }

  if (normalized.includes("PROCESS") || normalized.includes("TRANSCRIB")) {
    return "Status: transcript work appears to be in progress. Open the sermon to check the active step.";
  }

  return `Status: no transcript is available yet. Current sermon state: ${formatSermonStatus(status)}.`;
}

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
    <main className="container sermon-intelligence-shell stack-lg">
      <header className="card page-header stack-md">
        <div className="stack-sm">
          <p className="kicker">Sermon intelligence</p>
          <h1>{sermon.title}</h1>
          <p className="muted">{sermon.speakerName} at {sermon.churchName}</p>
        </div>
        {hasTranscript ? (
          <div className="actions-row">
            <Link href={`/sermons/${sermon.id}`} className="button secondary">
              Sermon overview
            </Link>
            <Link href="/knowledge-base" className="button tertiary">
              Knowledge base
            </Link>
          </div>
        ) : (
          <div className="actions-row">
            <Link href={`/sermons/${sermon.id}`} className="button primary">
              Open sermon to transcribe
            </Link>
          </div>
        )}
      </header>

      {!hasTranscript ? (
        <section className="card stack-md sermon-intelligence-empty">
          <div className="sermon-intelligence-status-line">
            {missingTranscriptStatusLine(sermon.status)}
          </div>
          <EmptyState
            title="Transcript required"
            description="Process or transcribe this sermon before sermon intelligence can identify themes, scriptures, and ministry moments."
            action={{ label: "Open sermon to transcribe", href: `/sermons/${sermon.id}`, variant: "primary" }}
          />
          <div className="sermon-intelligence-quiet-links">
            <Link href="/sermons" className="text-link">
              Sermon Library
            </Link>
            <Link href="/intelligence-dashboard" className="text-link">
              Intelligence Dashboard
            </Link>
          </div>
        </section>
      ) : (
        <div className="stack-md">
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
        </div>
      )}

      {hasTranscript ? (
        <div className="sermon-intelligence-quiet-links">
          <Link href="/sermons" className="text-link">
            Sermon Library
          </Link>
          <Link href="/intelligence-dashboard" className="text-link">
            Intelligence Dashboard
          </Link>
        </div>
      ) : null}
    </main>
  );
}
