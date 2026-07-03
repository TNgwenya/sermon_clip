"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createProcessingJob } from "@/server/agents/processing";
import { prepareGeneratedClipReviewAssets } from "@/server/agents/clipReviewAssetService";
import { SMART_CLIP_CATEGORIES, type SmartClipCategory } from "@/server/ai/ministryMomentSchema";
import {
  canRunLocalMediaProcessing,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";

// ─── Shared response type ──────────────────────────────────────────────────────

export type IntelligenceActionState = {
  success: boolean;
  message: string;
};

export type RegenerationActionState = IntelligenceActionState;

function assertLocalMediaProcessing(action: string): void {
  if (!canRunLocalMediaProcessing()) {
    throw new Error(localMediaProcessingUnavailableMessage(action));
  }
}

function generateSermonIntelligence(
  ...args: Parameters<typeof import("@/server/agents/sermonIntelligenceService").generateSermonIntelligence>
): ReturnType<typeof import("@/server/agents/sermonIntelligenceService").generateSermonIntelligence> {
  assertLocalMediaProcessing("Sermon intelligence generation");
  return import("@/server/agents/sermonIntelligenceService").then((module) => module.generateSermonIntelligence(...args));
}

function regenerateSermonIntelligence(
  ...args: Parameters<typeof import("@/server/agents/sermonIntelligenceService").regenerateSermonIntelligence>
): ReturnType<typeof import("@/server/agents/sermonIntelligenceService").regenerateSermonIntelligence> {
  assertLocalMediaProcessing("Sermon intelligence regeneration");
  return import("@/server/agents/sermonIntelligenceService").then((module) => module.regenerateSermonIntelligence(...args));
}

function regenerateMinistryMoments(
  ...args: Parameters<typeof import("@/server/agents/ministryMomentService").regenerateMinistryMoments>
): ReturnType<typeof import("@/server/agents/ministryMomentService").regenerateMinistryMoments> {
  assertLocalMediaProcessing("Ministry moment regeneration");
  return import("@/server/agents/ministryMomentService").then((module) => module.regenerateMinistryMoments(...args));
}

function refreshSubjectSpeakerTracking(
  ...args: Parameters<typeof import("@/server/agents/subjectSpeakerTrackingService").refreshSubjectSpeakerTracking>
): ReturnType<typeof import("@/server/agents/subjectSpeakerTrackingService").refreshSubjectSpeakerTracking> {
  assertLocalMediaProcessing("Subject and speaker tracking");
  return import("@/server/agents/subjectSpeakerTrackingService").then((module) => module.refreshSubjectSpeakerTracking(...args));
}

function generateClipSuggestions(
  ...args: Parameters<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions>
): ReturnType<typeof import("@/server/agents/clipIntelligenceAgent").generateClipSuggestions> {
  assertLocalMediaProcessing("Smart clip generation");
  return import("@/server/agents/clipIntelligenceAgent").then((module) => module.generateClipSuggestions(...args));
}

async function queueSmartClipGeneration(sermonId: string): Promise<void> {
  const existing = await prisma.processingJob.findFirst({
    where: {
      sermonId,
      type: "GENERATE_CLIPS",
      status: { in: ["PENDING", "RUNNING"] },
    },
    select: { id: true },
  });

  if (!existing) {
    await createProcessingJob(sermonId, "GENERATE_CLIPS");
  }
}

// ─── Generate intelligence ─────────────────────────────────────────────────────

export async function generateIntelligenceAction(
  sermonId: string,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await generateSermonIntelligence(sermonId);
    revalidatePath(`/sermons/${sermonId}/intelligence`);

    if (result.status === "COMPLETED") {
      return { success: true, message: "Sermon intelligence generated successfully." };
    }

    return { success: false, message: result.failureReason ?? "Intelligence generation failed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

// ─── Regenerate intelligence ───────────────────────────────────────────────────

export async function regenerateIntelligenceAction(
  sermonId: string,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await regenerateSermonIntelligence(sermonId);
    revalidatePath(`/sermons/${sermonId}/intelligence`);

    if (result.status === "COMPLETED") {
      return { success: true, message: "Sermon intelligence regenerated successfully." };
    }

    return { success: false, message: result.failureReason ?? "Intelligence regeneration failed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

export async function regenerateMinistryMomentsAction(
  sermonId: string,
): Promise<RegenerationActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await regenerateMinistryMoments(sermonId);
    revalidatePath(`/sermons/${sermonId}/intelligence`);
    revalidatePath(`/sermons/${sermonId}/review`);

    return {
      success: true,
      message: `Ministry moments refreshed (${result.momentCount} detected).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

export async function refreshSubjectSpeakerTrackingAction(
  sermonId: string,
): Promise<RegenerationActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await refreshSubjectSpeakerTracking(sermonId);
    revalidatePath(`/sermons/${sermonId}/intelligence`);
    revalidatePath(`/sermons/${sermonId}`);

    return {
      success: true,
      message: `Subject and speaker tracking refreshed (${result.subjectCount} subjects, ${result.speakerCount} speakers).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

export async function regenerateSmartClipsAction(
  sermonId: string,
): Promise<RegenerationActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  if (!canRunLocalMediaProcessing()) {
    await queueSmartClipGeneration(sermonId);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath(`/sermons/${sermonId}`);
    return { success: true, message: "Smart clip generation queued for your local worker." };
  }

  try {
    const result = await generateClipSuggestions(sermonId, { force: true });
    const previewSummary = await prepareGeneratedClipReviewAssets({ sermonId, force: true });
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath(`/sermons/${sermonId}`);

    return {
      success: true,
      message: result.reusedExistingSuggestions
        ? `Smart clips were already present and reused. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`
        : `Smart clips refreshed (${result.clipCount} recommendations). Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

const smartClipCategorySchema = z.enum(SMART_CLIP_CATEGORIES);

export async function regenerateSmartClipsByCategoryAction(
  sermonId: string,
  category: SmartClipCategory,
): Promise<RegenerationActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const parsedCategory = smartClipCategorySchema.safeParse(category);
  if (!parsedCategory.success) {
    return { success: false, message: "Invalid smart clip category." };
  }

  if (!canRunLocalMediaProcessing()) {
    await queueSmartClipGeneration(sermonId);
    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath(`/sermons/${sermonId}`);
    return { success: true, message: `${parsedCategory.data} smart clip generation queued for your local worker.` };
  }

  try {
    const result = await generateClipSuggestions(sermonId, {
      force: true,
      targetCategory: parsedCategory.data,
    });
    const previewSummary = await prepareGeneratedClipReviewAssets({ sermonId, force: true });

    revalidatePath(`/sermons/${sermonId}/review`);
    revalidatePath(`/sermons/${sermonId}`);

    return {
      success: true,
      message: result.reusedExistingSuggestions
        ? `${parsedCategory.data} clips were already present and reused. Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`
        : `${parsedCategory.data} clips refreshed (${result.clipCount} recommendation${result.clipCount === 1 ? "" : "s"}). Preview prep: ${previewSummary.prepared} prepared, ${previewSummary.skipped} skipped, ${previewSummary.failed} failed.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return { success: false, message };
  }
}

const ministryMomentReviewStatusSchema = z.enum([
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_CORRECTION",
]);

export async function updateMinistryMomentReviewStatusAction(
  sermonId: string,
  momentId: string,
  reviewStatus: z.infer<typeof ministryMomentReviewStatusSchema>,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim() || !momentId?.trim()) {
    return { success: false, message: "Sermon ID and ministry moment ID are required." };
  }

  const parsedStatus = ministryMomentReviewStatusSchema.safeParse(reviewStatus);
  if (!parsedStatus.success) {
    return { success: false, message: "Invalid ministry moment review status." };
  }

  try {
    const updated = await prisma.ministryMoment.updateMany({
      where: {
        id: momentId,
        sermonId,
      },
      data: {
        reviewStatus: parsedStatus.data,
      },
    });

    if (updated.count === 0) {
      return { success: false, message: "Ministry moment not found for this sermon." };
    }

    revalidatePath(`/sermons/${sermonId}/intelligence`);
    return { success: true, message: "Ministry moment review status updated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    return { success: false, message };
  }
}

// ─── Validation schemas ────────────────────────────────────────────────────────

const manualOverrideSchema = z.object({
  manualTitle: z.string().trim().max(200).optional(),
  manualSummary: z.string().trim().max(2000).optional(),
  manualCentralTheme: z.string().trim().max(500).optional(),
});

const manualTopicSchema = z.object({
  topic: z.string().trim().min(1).max(100),
});

// ─── Save manual overrides on the intelligence overview ───────────────────────

export async function saveIntelligenceOverridesAction(
  sermonId: string,
  formData: FormData,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const raw = {
    manualTitle: formData.get("manualTitle") as string | null,
    manualSummary: formData.get("manualSummary") as string | null,
    manualCentralTheme: formData.get("manualCentralTheme") as string | null,
  };

  const parsed = manualOverrideSchema.safeParse({
    manualTitle: raw.manualTitle ?? undefined,
    manualSummary: raw.manualSummary ?? undefined,
    manualCentralTheme: raw.manualCentralTheme ?? undefined,
  });

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message).join(", ");
    return { success: false, message: `Validation failed: ${messages}` };
  }

  try {
    await prisma.sermonIntelligence.update({
      where: { sermonId },
      data: {
        manualTitle: parsed.data.manualTitle ?? null,
        manualSummary: parsed.data.manualSummary ?? null,
        manualCentralTheme: parsed.data.manualCentralTheme ?? null,
        isManuallyReviewed: true,
        status: "COMPLETED",
      },
    });

    revalidatePath(`/sermons/${sermonId}/intelligence`);
    return { success: true, message: "Overrides saved." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed.";
    return { success: false, message };
  }
}

// ─── Add a manual topic ───────────────────────────────────────────────────────

export async function addManualTopicAction(
  sermonId: string,
  formData: FormData,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const parsed = manualTopicSchema.safeParse({ topic: formData.get("topic") });

  if (!parsed.success) {
    return { success: false, message: "Topic is required." };
  }

  try {
    const existing = await prisma.sermonTopicTag.findFirst({
      where: { sermonId, topic: parsed.data.topic },
    });

    if (existing) {
      return { success: false, message: "Topic already exists for this sermon." };
    }

    await prisma.sermonTopicTag.create({
      data: {
        sermonId,
        topic: parsed.data.topic,
        confidenceScore: 1.0,
        isAiGenerated: false,
        isManuallyAdded: true,
      },
    });

    revalidatePath(`/sermons/${sermonId}/intelligence`);
    return { success: true, message: "Topic added." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Add failed.";
    return { success: false, message };
  }
}

// ─── Remove a topic tag ───────────────────────────────────────────────────────

export async function removeTopicAction(
  sermonId: string,
  topicId: string,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim() || !topicId?.trim()) {
    return { success: false, message: "Invalid parameters." };
  }

  try {
    await prisma.sermonTopicTag.deleteMany({
      where: { id: topicId, sermonId },
    });

    revalidatePath(`/sermons/${sermonId}/intelligence`);
    return { success: true, message: "Topic removed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remove failed.";
    return { success: false, message };
  }
}

// ─── Add manual primary scripture override ────────────────────────────────────

const manualScriptureSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  usageType: z.enum(["READ", "QUOTED", "REFERENCED", "IMPLIED"]),
  isPrimary: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export async function addManualScriptureAction(
  sermonId: string,
  formData: FormData,
): Promise<IntelligenceActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const parsed = manualScriptureSchema.safeParse({
    reference: formData.get("reference"),
    usageType: formData.get("usageType"),
    isPrimary: formData.get("isPrimary"),
  });

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message).join(", ");
    return { success: false, message: `Validation failed: ${messages}` };
  }

  try {
    await prisma.sermonScriptureRef.create({
      data: {
        sermonId,
        reference: parsed.data.reference,
        usageType: parsed.data.usageType,
        isPrimary: parsed.data.isPrimary,
        confidenceScore: 1.0,
        frequencyCount: 1,
        isManuallyAdded: true,
      },
    });

    revalidatePath(`/sermons/${sermonId}/intelligence`);
    return { success: true, message: "Scripture added." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Add failed.";
    return { success: false, message };
  }
}

// ─── Search sermons by intelligence ───────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().trim().optional(),
  topic: z.string().trim().optional(),
  scripture: z.string().trim().optional(),
  speakerName: z.string().trim().optional(),
});

export type SermonSearchResult = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  sermonDate: string | null;
  intelligenceStatus: string | null;
  centralTheme: string | null;
  topics: string[];
};

export async function searchSermonsAction(
  rawParams: z.infer<typeof searchSchema>,
): Promise<SermonSearchResult[]> {
  const params = searchSchema.parse(rawParams);

  const sermons = await prisma.sermon.findMany({
    where: {
      AND: [
        params.query
          ? {
              OR: [
                { title: { contains: params.query } },
                { speakerName: { contains: params.query } },
                { intelligence: { centralTheme: { contains: params.query } } },
                { intelligence: { generatedTitle: { contains: params.query } } },
              ],
            }
          : {},
        params.speakerName
          ? { speakerName: { contains: params.speakerName } }
          : {},
        params.topic
          ? { topicTags: { some: { topic: { contains: params.topic } } } }
          : {},
        params.scripture
          ? { scriptureRefs: { some: { reference: { contains: params.scripture } } } }
          : {},
      ],
    },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      sermonDate: true,
      intelligence: {
        select: { status: true, centralTheme: true, generatedTitle: true, manualCentralTheme: true },
      },
      topicTags: {
        select: { topic: true },
        orderBy: { confidenceScore: "desc" },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return sermons.map((s) => ({
    id: s.id,
    title: s.intelligence?.generatedTitle ?? s.title,
    speakerName: s.speakerName,
    churchName: s.churchName,
    sermonDate: s.sermonDate?.toISOString() ?? null,
    intelligenceStatus: s.intelligence?.status ?? null,
    centralTheme: s.intelligence?.manualCentralTheme ?? s.intelligence?.centralTheme ?? null,
    topics: s.topicTags.map((t) => t.topic),
  }));
}
