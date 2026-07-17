import { prisma } from "@/lib/prisma";
import {
  INTELLIGENCE_JSON_SHAPE,
  MINISTRY_TOPICS,
  parseSermonIntelligenceResponse,
  type AiSermonIntelligence,
} from "@/server/ai/sermonIntelligenceSchema";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel, resolveOpenAIReasoningEffort } from "@/server/ai/modelConfig";
import {
  appendJobLog,
  ensureProcessingJobRunning,
  markJobFailed,
  markJobSucceeded,
  resolveProcessingJob,
} from "@/server/agents/processing";
import { appendPipelineLog } from "@/server/agents/storage";
import { generateMinistryMoments } from "@/server/agents/ministryMomentService";
import { refreshSubjectSpeakerTracking } from "@/server/agents/subjectSpeakerTrackingService";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SermonContext = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
  sermonDate?: Date | null;
};

export type GenerateIntelligenceOptions = {
  force?: boolean;
  parentJobId?: string;
  processingJobId?: string;
};

export type IntelligenceResult = {
  intelligenceId: string;
  status: "COMPLETED" | "FAILED";
  failureReason?: string;
};

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildIntelligenceSystemPrompt(): string {
  return [
    "You are a church media analyst producing structured sermon intelligence.",
    "Your task is to read a sermon transcript and return structured JSON with analysis.",
    "You must only use information that is explicitly present in the transcript.",
    "Do not invent scripture references, stories, or details not in the text.",
    "Support multilingual sermons and South African language mixing (for example Zulu, Sotho, Xhosa, Tswana, and English mixed with local languages).",
    "If language or meaning is uncertain, lower confidence and state uncertainty in evidence fields instead of guessing.",
    "For scriptures: distinguish between passages that were read aloud (READ), quoted from memory (QUOTED), briefly referenced by name (REFERENCED), or only implied without citation (IMPLIED).",
    `For topics: use only values from this list: ${MINISTRY_TOPICS.join(", ")}.`,
    "For structure sections: identify the logical flow of the sermon.",
    "Timestamps are optional — only include them if the transcript contains time markers.",
    "Confidence scores must be between 0.0 and 1.0.",
    "Return structured JSON only. Do not include markdown. Do not include commentary outside JSON.",
    "Exact JSON shape required:",
    INTELLIGENCE_JSON_SHAPE,
  ].join("\n");
}

function buildIntelligenceUserPrompt(sermon: SermonContext, transcriptText: string): string {
  const lines: string[] = [
    `Sermon Title: ${sermon.title}`,
    `Speaker: ${sermon.speakerName}`,
    `Church: ${sermon.churchName}`,
    `Language: ${sermon.language}`,
  ];

  if (sermon.sermonDate) {
    lines.push(`Date: ${sermon.sermonDate.toISOString().split("T")[0]}`);
  }

  lines.push("", "Transcript:", transcriptText.trim());

  return lines.join("\n");
}

// ─── AI invocation with validation ────────────────────────────────────────────

async function callIntelligenceAI(
  sermon: SermonContext,
  transcriptText: string,
): Promise<AiSermonIntelligence> {
  const model = resolveOpenAIChatModel("sermonIntelligence");
  const reasoningEffort = resolveOpenAIReasoningEffort("sermonIntelligence", model);

  return createLoggedChatCompletion({
    operation: "sermon_intelligence",
    sermonId: sermon.id,
    model,
    reasoningEffort,
    temperature: 0.2,
    messages: [
      { role: "system", content: buildIntelligenceSystemPrompt() },
      { role: "user", content: buildIntelligenceUserPrompt(sermon, transcriptText) },
    ],
    promptVersion: "sermon-intelligence-v1",
    metadata: {
      transcriptCharacters: transcriptText.length,
      language: sermon.language,
    },
    missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before generating intelligence.",
    validateResponse: (response) => parseSermonIntelligenceResponse(
      response.choices[0]?.message?.content ?? "",
    ),
  });
}

// ─── Persistence: upsert intelligence and related rows ────────────────────────

async function persistIntelligence(
  sermonId: string,
  data: AiSermonIntelligence,
): Promise<string> {
  const intelligence = await prisma.sermonIntelligence.upsert({
    where: { sermonId },
    create: {
      sermonId,
      status: "COMPLETED",
      generatedTitle: data.title,
      summary: data.summary,
      centralTheme: data.centralTheme,
      shortOverview: data.shortOverview,
      keyTakeaways: data.keyTakeaways,
      confidenceScore: data.confidenceScore,
      generatedAt: new Date(),
    },
    update: {
      status: "COMPLETED",
      generatedTitle: data.title,
      summary: data.summary,
      centralTheme: data.centralTheme,
      shortOverview: data.shortOverview,
      keyTakeaways: data.keyTakeaways,
      confidenceScore: data.confidenceScore,
      failureReason: null,
      generatedAt: new Date(),
    },
  });

  // Delete and re-insert scripture refs to avoid stale data on regeneration.
  // Manual entries are preserved by the isManuallyAdded flag — we only remove AI-generated ones.
  await prisma.sermonScriptureRef.deleteMany({
    where: { sermonId, isManuallyAdded: false },
  });

  if (data.scriptures.length > 0) {
    await prisma.sermonScriptureRef.createMany({
      data: data.scriptures.map((s) => ({
        sermonId,
        reference: s.reference,
        book: s.book ?? null,
        chapter: s.chapter ?? null,
        verseStart: s.verseStart ?? null,
        verseEnd: s.verseEnd ?? null,
        usageType: s.usageType,
        isPrimary: s.isPrimary,
        frequencyCount: s.frequencyCount,
        confidenceScore: s.confidenceScore,
        transcriptEvidence: s.transcriptEvidence ?? null,
        isManuallyAdded: false,
      })),
    });
  }

  // Delete and re-insert AI structure sections.
  await prisma.sermonStructureSection.deleteMany({
    where: { sermonId, isManuallyLabeled: false },
  });

  if (data.structureSections.length > 0) {
    await prisma.sermonStructureSection.createMany({
      data: data.structureSections.map((sec) => ({
        sermonId,
        sectionType: sec.sectionType,
        title: sec.title ?? null,
        description: sec.description ?? null,
        orderIndex: sec.orderIndex,
        startTimeSeconds: sec.startTimeSeconds ?? null,
        endTimeSeconds: sec.endTimeSeconds ?? null,
        confidenceScore: sec.confidenceScore,
        transcriptExcerpt: sec.transcriptExcerpt ?? null,
        isManuallyLabeled: false,
      })),
    });
  }

  // Delete and re-insert AI topic tags.
  await prisma.sermonTopicTag.deleteMany({
    where: { sermonId, isManuallyAdded: false },
  });

  if (data.topics.length > 0) {
    await prisma.sermonTopicTag.createMany({
      data: data.topics.map((t) => ({
        sermonId,
        topic: t.topic,
        confidenceScore: t.confidenceScore,
        evidence: t.evidence ?? null,
        isAiGenerated: true,
        isManuallyAdded: false,
      })),
    });
  }

  return intelligence.id;
}

// ─── Mark intelligence as failed ──────────────────────────────────────────────

async function markIntelligenceFailed(sermonId: string, reason: string): Promise<void> {
  await prisma.sermonIntelligence.upsert({
    where: { sermonId },
    create: {
      sermonId,
      status: "FAILED",
      failureReason: reason,
    },
    update: {
      status: "FAILED",
      failureReason: reason,
    },
  });
}

// ─── Main exported function ────────────────────────────────────────────────────

export async function generateSermonIntelligence(
  sermonId: string,
  options?: GenerateIntelligenceOptions,
): Promise<IntelligenceResult> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
      sermonDate: true,
      transcript: {
        select: { fullText: true },
      },
      intelligence: {
        select: { id: true, status: true },
      },
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} not found.`);
  }

  if (!sermon.transcript?.fullText?.trim()) {
    const reason = "Transcript is not available or is empty.";
    await markIntelligenceFailed(sermonId, reason);
    return { intelligenceId: sermonId, status: "FAILED", failureReason: reason };
  }

  // Skip if already completed and force is not set.
  if (!options?.force && sermon.intelligence?.status === "COMPLETED") {
    return { intelligenceId: sermon.intelligence.id, status: "COMPLETED" };
  }

  // Mark as processing.
  await prisma.sermonIntelligence.upsert({
    where: { sermonId },
    create: { sermonId, status: "PROCESSING" },
    update: { status: "PROCESSING", failureReason: null },
  });

  const job = await resolveProcessingJob(
    sermonId,
    "GENERATE_INTELLIGENCE",
    options?.processingJobId,
  );
  if (options?.parentJobId) {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        generationSummary: {
          operation: "sermon_intelligence",
          parentJobId: options.parentJobId,
        },
      },
    });
  }
  await ensureProcessingJobRunning(job);
  await appendJobLog(
    job.id,
    `Generating sermon intelligence for ${sermon.title}. sermonId=${sermonId} jobId=${job.id}${options?.parentJobId ? ` parentJobId=${options.parentJobId}` : ""}`,
  );
  await appendPipelineLog(sermonId, "Sermon intelligence generation started.");

  try {
    const intelligence = await callIntelligenceAI(sermon, sermon.transcript.fullText);
    const intelligenceId = await persistIntelligence(sermonId, intelligence);

    try {
      const momentResult = await generateMinistryMoments(sermonId, { force: options?.force });
      await appendPipelineLog(
        sermonId,
        `Ministry moments refreshed: ${momentResult.momentCount} detected${momentResult.reusedExistingMoments ? " (reused existing)" : ""}.`,
      );
    } catch (momentError) {
      const momentReason = momentError instanceof Error ? momentError.message : "Unknown ministry moment error.";
      await appendPipelineLog(sermonId, `Ministry moment detection failed: ${momentReason}`);
    }

    try {
      const trackingResult = await refreshSubjectSpeakerTracking(sermonId);
      await appendPipelineLog(
        sermonId,
        `Subject/speaker tracking refreshed: ${trackingResult.subjectCount} subjects, ${trackingResult.speakerCount} speakers.`,
      );
    } catch (trackingError) {
      const trackingReason = trackingError instanceof Error ? trackingError.message : "Unknown subject/speaker tracking error.";
      await appendPipelineLog(sermonId, `Subject/speaker tracking failed: ${trackingReason}`);
    }

    await markJobSucceeded(job.id, "Sermon intelligence generation completed.");
    await appendPipelineLog(sermonId, "Sermon intelligence generation completed.");

    return { intelligenceId, status: "COMPLETED" };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : "Unknown error during intelligence generation.";

    await markIntelligenceFailed(sermonId, reason);
    const validationFailure = reason.startsWith("AI response validation failed")
      || reason.startsWith("AI response JSON validation failed");
    await markJobFailed(job.id, reason, "Sermon intelligence generation failed.", {
      error,
      code: validationFailure ? "AI_RESPONSE_VALIDATION_FAILED" : "SERMON_INTELLIGENCE_FAILED",
      stage: validationFailure ? "response_validation" : "sermon_intelligence_generation",
      retryable: true,
      parentJobId: options?.parentJobId,
      details: {
        operation: "sermon_intelligence",
        validationFailure,
      },
    });
    await appendPipelineLog(sermonId, `Sermon intelligence failed: ${reason}`);

    return { intelligenceId: sermonId, status: "FAILED", failureReason: reason };
  }
}

// ─── Regeneration ─────────────────────────────────────────────────────────────

export async function regenerateSermonIntelligence(
  sermonId: string,
): Promise<IntelligenceResult> {
  return generateSermonIntelligence(sermonId, { force: true });
}
