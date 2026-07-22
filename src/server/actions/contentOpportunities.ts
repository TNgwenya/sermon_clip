"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requestContentOpportunityGeneration } from "@/server/agents/contentOpportunityJobService";
import {
  CONTENT_OPPORTUNITY_TYPES,
  type ContentOpportunityType,
} from "@/server/ai/contentOpportunitySchema";
import { getContentPackPreset } from "@/lib/contentPackPresets";
import {
  formatContentOpportunityGenerationResult,
  type ContentOpportunityJobRequest,
} from "@/lib/contentOpportunityJobs";
import { createOpportunityRevision } from "@/server/contentRevisionService";
import { recordContentFunnelEvent } from "@/server/contentFunnelTelemetry";
import {
  detectProductionCopyIssues,
  extractQuoteTextFromContent,
  findQuoteTranscriptSegmentSpan,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
  type QuoteTranscriptSegmentSpan,
} from "@/lib/contentIntegrity";
import {
  convertLegacyBodyContent,
  parseContentOpportunityContractForType,
  resolveContentOpportunityContract,
  type ContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";

export type ContentOpportunityActionState = {
  success: boolean;
  message: string;
  queued?: boolean;
  jobId?: string;
  progress?: "QUEUED" | "RUNNING" | "COMPLETED";
};

const contentOpportunityTypeSchema = z.enum(CONTENT_OPPORTUNITY_TYPES);

const contentOpportunityStatusSchema = z.enum([
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "USED",
  "ARCHIVED",
]);

const updateOpportunitySchema = z.object({
  opportunityId: z.string().trim().min(1),
  sermonId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  shortDescription: z.string().trim().max(400).optional(),
  content: z.string().trim().min(1).max(10000),
  relatedScripture: z.string().trim().max(200).nullable().optional(),
  scriptureTranslation: z.string().trim().max(20).nullable().optional(),
  translationConfirmed: z.boolean().optional(),
});

function asRevisionJson(value: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : value as Prisma.InputJsonValue;
}

function scriptureReferenceWithVersion(
  reference: string | null | undefined,
  version: string | null | undefined,
): string | null {
  const trimmedReference = reference?.trim();
  if (!trimmedReference) return null;
  const trimmedVersion = version?.trim().toUpperCase();
  return trimmedVersion ? `${trimmedReference} (${trimmedVersion})` : trimmedReference;
}

function contentContractJson(contract: ContentOpportunityContract): Prisma.InputJsonValue {
  return contract as unknown as Prisma.InputJsonValue;
}

function sourceSegmentIds(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function buildApprovedContentContract(input: {
  opportunityType: ContentOpportunityType;
  structuredContent: Prisma.JsonValue | null;
  title: string;
  content: string;
  sourceTranscriptExcerpt: string | null;
  sourceTranscriptId: string | null;
  sourceTranscriptSegmentIds: Prisma.JsonValue | null;
  sourceStartTimeSeconds: number | null;
  sourceEndTimeSeconds: number | null;
  relatedScripture: string | null;
  scriptureTranslation: string | null;
  suggestedPlatform: string | null;
  approvedAt: Date;
}): ContentOpportunityContract {
  const resolved = resolveContentOpportunityContract({
    opportunityType: input.opportunityType,
    structuredContent: input.structuredContent,
    bodyContent: input.content,
    title: input.title,
    sourceTranscriptExcerpt: input.sourceTranscriptExcerpt,
    relatedScripture: scriptureReferenceWithVersion(input.relatedScripture, input.scriptureTranslation),
    suggestedPlatform: input.suggestedPlatform,
  }).contract;
  const reviewedContract = { ...resolved };
  delete reviewedContract.legacyConversion;
  const verification = {
    status: "VERIFIED" as const,
    method: "TRANSCRIPT_MATCH" as const,
    verifiedAt: input.approvedAt.toISOString(),
    verifiedBy: "opportunity-review",
    note: "The approved wording was matched against the stored transcript evidence.",
  };

  if (resolved.family === "QUOTE_GRAPHIC") {
    const transcriptEvidence = {
      kind: "TRANSCRIPT_SPAN" as const,
      transcriptId: input.sourceTranscriptId,
      segmentIds: sourceSegmentIds(input.sourceTranscriptSegmentIds),
      startMs: input.sourceStartTimeSeconds === null ? null : Math.round(input.sourceStartTimeSeconds * 1000),
      endMs: input.sourceEndTimeSeconds === null ? null : Math.round(input.sourceEndTimeSeconds * 1000),
      excerpt: input.sourceTranscriptExcerpt?.trim() || input.content,
      speaker: null,
      verification,
    };
    const firstTranscriptIndex = resolved.sourceEvidence.findIndex((item) => item.kind === "TRANSCRIPT_SPAN");
    const sourceEvidence = firstTranscriptIndex >= 0
      ? resolved.sourceEvidence.map((item, index) => index === firstTranscriptIndex ? transcriptEvidence : item)
      : [transcriptEvidence, ...resolved.sourceEvidence];
    return parseContentOpportunityContractForType(input.opportunityType, {
      ...reviewedContract,
      sourceEvidence,
      quote: {
        ...resolved.quote,
        text: extractQuoteTextFromContent(input.content) ?? input.content,
        kind: "VERBATIM_SERMON",
      },
    });
  }

  if (resolved.family === "SCRIPTURE_GRAPHIC") {
    const validated = validateScriptureReference(scriptureReferenceWithVersion(
      input.relatedScripture,
      input.scriptureTranslation,
    ));
    const scripture = {
      reference: validated.normalizedReference,
      verseText: input.content,
      translation: validated.version,
      verification: {
        referenceStatus: "VERIFIED" as const,
        verseTextStatus: "VERIFIED" as const,
        translationStatus: "VERIFIED" as const,
        method: "MANUAL_REVIEW" as const,
        verifiedAt: input.approvedAt.toISOString(),
        verifiedBy: "opportunity-review",
        note: "A reviewer confirmed the reference, verse wording, and selected translation.",
      },
    };
    return parseContentOpportunityContractForType(input.opportunityType, {
      ...reviewedContract,
      scripture,
      sourceEvidence: [
        ...resolved.sourceEvidence.filter((item) => item.kind !== "SCRIPTURE"),
        { kind: "SCRIPTURE", scripture },
      ],
      artwork: { ...resolved.artwork, primaryText: input.content },
    });
  }

  return parseContentOpportunityContractForType(input.opportunityType, reviewedContract);
}

async function submitContentOpportunityGeneration(
  sermonId: string,
  request: ContentOpportunityJobRequest,
): Promise<ContentOpportunityActionState> {
  const requested = await requestContentOpportunityGeneration({ sermonId, request });
  if (requested.execution === "INLINE") {
    return {
      success: true,
      message: formatContentOpportunityGenerationResult(requested.result, request.targetType),
      jobId: requested.jobId,
      progress: "COMPLETED",
    };
  }
  if (requested.intentConflict) {
    return {
      success: false,
      message: requested.progress === "COMPLETED"
        ? "A different content idea request finished before this one could be queued. Review its results, then try this request again if it is still needed."
        : "A different content idea request is already queued or running for this sermon. Wait for it to finish, then try this request again.",
      queued: false,
      jobId: requested.jobId,
      progress: requested.progress,
    };
  }
  if (requested.progress === "COMPLETED") {
    return {
      success: true,
      message: "This exact content idea request has completed. Refresh to review its validated results and any reported shortfalls.",
      queued: false,
      jobId: requested.jobId,
      progress: "COMPLETED",
    };
  }
  return {
    success: true,
    message: requested.reusedExisting
      ? "This exact content idea request is already queued or running. No duplicate was created; refresh to see its latest progress."
      : "Content idea generation is queued and is not complete yet. Keep the background worker running; refresh to see progress and validated drafts when the job finishes.",
    queued: true,
    jobId: requested.jobId,
    progress: requested.progress,
  };
}

function revalidateOpportunityPaths(sermonId: string): void {
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities?sermonId=${sermonId}`);
  revalidatePath(`/sermons/${sermonId}`);
  revalidatePath(`/sermons/${sermonId}/intelligence`);
}

export async function generateContentOpportunitiesAction(
  sermonId: string,
): Promise<ContentOpportunityActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await submitContentOpportunityGeneration(sermonId, { mode: "GENERATE" });
    revalidateOpportunityPaths(sermonId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation error.";
    return { success: false, message };
  }
}

export async function generateContentPackAction(
  sermonId: string,
  presetId: string,
): Promise<ContentOpportunityActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const preset = getContentPackPreset(presetId);
  if (!preset) {
    return { success: false, message: "Invalid content pack preset." };
  }

  try {
    const result = await submitContentOpportunityGeneration(sermonId, {
      mode: "CONTENT_PACK",
      presetId: preset.id,
      quantities: preset.quantities,
      replaceDefaultQuantities: true,
    });
    revalidateOpportunityPaths(sermonId);
    return {
      ...result,
      message: `${preset.label}: ${result.message}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content pack generation failed.";
    return { success: false, message };
  }
}

export async function regenerateContentOpportunitiesAction(
  sermonId: string,
): Promise<ContentOpportunityActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  try {
    const result = await submitContentOpportunityGeneration(sermonId, { mode: "REGENERATE" });
    revalidateOpportunityPaths(sermonId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown regeneration error.";
    return { success: false, message };
  }
}

export async function regenerateContentOpportunityTypeAction(
  sermonId: string,
  opportunityType: string,
): Promise<ContentOpportunityActionState> {
  if (!sermonId?.trim()) {
    return { success: false, message: "Sermon ID is required." };
  }

  const parsedType = contentOpportunityTypeSchema.safeParse(opportunityType);
  if (!parsedType.success) {
    return { success: false, message: "Invalid content opportunity type." };
  }

  try {
    const result = await submitContentOpportunityGeneration(sermonId, {
      mode: "REGENERATE_TYPE",
      targetType: parsedType.data,
    });

    revalidateOpportunityPaths(sermonId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown regeneration error.";
    return { success: false, message };
  }
}

export async function updateContentOpportunityStatusAction(
  sermonId: string,
  opportunityId: string,
  status: string,
): Promise<ContentOpportunityActionState> {
  if (!sermonId?.trim() || !opportunityId?.trim()) {
    return { success: false, message: "Sermon ID and opportunity ID are required." };
  }

  const parsedStatus = contentOpportunityStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { success: false, message: "Invalid opportunity status." };
  }

  try {
    const current = await prisma.contentOpportunity.findFirst({
      where: { id: opportunityId, sermonId },
      select: {
        id: true,
        status: true,
        opportunityType: true,
        title: true,
        shortDescription: true,
        sourceTranscriptExcerpt: true,
        sourceTranscriptSegmentIds: true,
        sourceStartTimeSeconds: true,
        sourceEndTimeSeconds: true,
        suggestedPlatform: true,
        relatedScripture: true,
        scriptureTranslation: true,
        scriptureVerifiedAt: true,
        translationReviewState: true,
        editedContent: true,
        bodyContent: true,
        structuredContentJson: true,
        approvedContent: true,
      },
    });

    if (!current) {
      return { success: false, message: "Opportunity not found for this sermon." };
    }

    if (
      parsedStatus.data === "USED" &&
      current.status !== "APPROVED" &&
      current.status !== "USED"
    ) {
      return {
        success: false,
        message: "Approve this opportunity before marking it as used.",
      };
    }

    const approvedContent = current.editedContent?.trim() || current.bodyContent;
    let approvedQuoteEvidence: QuoteTranscriptSegmentSpan | null = null;
    if (parsedStatus.data === "APPROVED") {
      if (current.opportunityType === "QUOTE_GRAPHIC") {
        const transcriptSegments = await prisma.transcriptSegment.findMany({
          where: { sermonId },
          orderBy: [
            { startTimeSeconds: "asc" },
            { endTimeSeconds: "asc" },
          ],
          select: {
            id: true,
            transcriptId: true,
            text: true,
            startTimeSeconds: true,
            endTimeSeconds: true,
          },
        });
        const quoteText = extractQuoteTextFromContent(approvedContent);
        approvedQuoteEvidence = findQuoteTranscriptSegmentSpan({
          quoteText,
          transcriptSegments,
        });
        if (!approvedQuoteEvidence) {
          const quoteIntegrity = verifyQuoteTextAgainstTranscript({
            quoteText,
            transcriptSegments,
          });
          return { success: false, message: quoteIntegrity.message };
        }
      }

      if (current.opportunityType === "SCRIPTURE_GRAPHIC") {
        const scripture = validateScriptureReference(scriptureReferenceWithVersion(
          current.relatedScripture,
          current.scriptureTranslation,
        ));
        if (!scripture.valid) {
          return {
            success: false,
            message: scripture.errors[0] ?? "Add a valid Bible reference before approval.",
          };
        }
        if (scripture.versionStatus !== "RECOGNIZED") {
          return {
            success: false,
            message: "Choose a recognized Scripture translation before approval.",
          };
        }
        if (current.translationReviewState !== "APPROVED") {
          return {
            success: false,
            message: "Confirm that the verse wording matches the selected translation before approval.",
          };
        }
      }

      if (
        (current.opportunityType === "QUOTE_GRAPHIC" || current.opportunityType === "SCRIPTURE_GRAPHIC")
        && detectProductionCopyIssues({ artworkText: approvedContent }).length > 0
      ) {
        return {
          success: false,
          message: "Remove internal design directions or placeholders from the artwork text before approval.",
        };
      }
    }

    let approvedRevisionId: string | null = null;
    await prisma.$transaction(async (tx) => {
      if (parsedStatus.data === "APPROVED") {
        const approvedAt = new Date();
        const approvedContract = buildApprovedContentContract({
          opportunityType: current.opportunityType,
          structuredContent: current.structuredContentJson,
          title: current.title,
          content: approvedContent,
          sourceTranscriptExcerpt: approvedQuoteEvidence?.excerpt ?? current.sourceTranscriptExcerpt,
          sourceTranscriptId: approvedQuoteEvidence?.transcriptId ?? null,
          sourceTranscriptSegmentIds: approvedQuoteEvidence?.segmentIds ?? current.sourceTranscriptSegmentIds,
          sourceStartTimeSeconds: approvedQuoteEvidence?.startTimeSeconds ?? current.sourceStartTimeSeconds,
          sourceEndTimeSeconds: approvedQuoteEvidence?.endTimeSeconds ?? current.sourceEndTimeSeconds,
          relatedScripture: current.relatedScripture,
          scriptureTranslation: current.scriptureTranslation,
          suggestedPlatform: current.suggestedPlatform,
          approvedAt,
        });
        const approvedContractJson = contentContractJson(approvedContract);
        const revision = await createOpportunityRevision(tx, {
          contentOpportunityId: current.id,
          title: current.title,
          shortDescription: current.shortDescription,
          content: approvedContent,
          structuredContentJson: approvedContractJson,
          sourceTranscriptExcerpt: approvedQuoteEvidence?.excerpt ?? current.sourceTranscriptExcerpt,
          sourceTranscriptSegmentIds: approvedQuoteEvidence?.segmentIds
            ?? asRevisionJson(current.sourceTranscriptSegmentIds),
          sourceStartTimeSeconds: approvedQuoteEvidence?.startTimeSeconds ?? current.sourceStartTimeSeconds,
          sourceEndTimeSeconds: approvedQuoteEvidence?.endTimeSeconds ?? current.sourceEndTimeSeconds,
          relatedScripture: current.relatedScripture,
          scriptureTranslation: current.scriptureTranslation,
          scriptureVerifiedAt: current.scriptureVerifiedAt,
          translationReviewState: current.translationReviewState,
          approvalState: "APPROVED",
          createdBy: "opportunity-review",
          approvedBy: "opportunity-review",
          approvedAt,
        });
        approvedRevisionId = revision.id;
        await tx.contentOpportunity.update({
          where: { id: current.id },
          data: {
            status: "APPROVED",
            approvedContent,
            structuredContentJson: approvedContractJson,
            ...(current.opportunityType === "SCRIPTURE_GRAPHIC" ? { scriptureVerifiedAt: approvedAt } : {}),
            ...(approvedQuoteEvidence ? {
              sourceTranscriptExcerpt: approvedQuoteEvidence.excerpt,
              sourceTranscriptSegmentIds: approvedQuoteEvidence.segmentIds,
              sourceStartTimeSeconds: approvedQuoteEvidence.startTimeSeconds,
              sourceEndTimeSeconds: approvedQuoteEvidence.endTimeSeconds,
            } : {}),
            approvedRevisionId: revision.id,
          },
        });
        return;
      }

      await tx.contentOpportunity.update({
        where: { id: current.id },
        data: { status: parsedStatus.data },
      });
    });

    if (parsedStatus.data === "APPROVED") {
      await recordContentFunnelEvent({
        eventType: "APPROVED",
        sermonId,
        opportunityId: current.id,
        dedupeKey: approvedRevisionId
          ? `content-approved:${approvedRevisionId}`
          : `content-approved:${current.id}:${Date.now()}`,
        metadata: {
          opportunityType: current.opportunityType,
          fromStatus: current.status,
          toStatus: "APPROVED",
        },
      });
    }

    revalidateOpportunityPaths(sermonId);
    return { success: true, message: `Opportunity marked as ${parsedStatus.data}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Status update failed.";
    return { success: false, message };
  }
}

export async function updateContentOpportunityContentAction(
  input: z.infer<typeof updateOpportunitySchema>,
): Promise<ContentOpportunityActionState> {
  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join(", ");
    return { success: false, message: `Validation failed: ${issues}` };
  }

  try {
    const existing = await prisma.contentOpportunity.findFirst({
      where: {
        id: parsed.data.opportunityId,
        sermonId: parsed.data.sermonId,
      },
      select: {
        id: true,
        status: true,
        opportunityType: true,
        title: true,
        suggestedPlatform: true,
        sourceTranscriptExcerpt: true,
        sourceTranscriptSegmentIds: true,
        sourceStartTimeSeconds: true,
        sourceEndTimeSeconds: true,
        relatedScripture: true,
        scriptureTranslation: true,
        scriptureVerifiedAt: true,
        translationReviewState: true,
        structuredContentJson: true,
      },
    });

    if (!existing) {
      return { success: false, message: "Opportunity not found." };
    }

    const relatedScripture = parsed.data.relatedScripture === undefined
      ? existing.relatedScripture
      : parsed.data.relatedScripture?.trim() || null;
    const scriptureTranslation = parsed.data.scriptureTranslation === undefined
      ? existing.scriptureTranslation
      : parsed.data.scriptureTranslation?.trim().toUpperCase() || null;
    const translationReviewState = parsed.data.translationConfirmed === undefined
      ? existing.translationReviewState
      : parsed.data.translationConfirmed ? "APPROVED" as const : "REVIEW_REQUIRED" as const;
    const editedContract = convertLegacyBodyContent({
      opportunityType: existing.opportunityType,
      bodyContent: parsed.data.content,
      title: parsed.data.title,
      sourceTranscriptExcerpt: existing.sourceTranscriptExcerpt,
      relatedScripture: scriptureReferenceWithVersion(relatedScripture, scriptureTranslation),
      suggestedPlatform: existing.suggestedPlatform,
    }).contract;
    const editedContractJson = contentContractJson(editedContract);

    let editedRevisionId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const revision = await createOpportunityRevision(tx, {
        contentOpportunityId: existing.id,
        title: parsed.data.title,
        shortDescription: parsed.data.shortDescription?.trim() || null,
        content: parsed.data.content,
        structuredContentJson: editedContractJson,
        sourceTranscriptExcerpt: existing.sourceTranscriptExcerpt,
        sourceTranscriptSegmentIds: asRevisionJson(existing.sourceTranscriptSegmentIds),
        sourceStartTimeSeconds: existing.sourceStartTimeSeconds,
        sourceEndTimeSeconds: existing.sourceEndTimeSeconds,
        relatedScripture,
        scriptureTranslation,
        scriptureVerifiedAt: existing.scriptureVerifiedAt,
        translationReviewState,
        approvalState: "REAPPROVAL_REQUIRED",
        createdBy: "opportunity-editor",
      });
      editedRevisionId = revision.id;
      await tx.contentOpportunity.update({
        where: { id: existing.id },
        data: {
          title: parsed.data.title,
          shortDescription: parsed.data.shortDescription?.trim() || null,
          editedContent: parsed.data.content,
          structuredContentJson: editedContractJson,
          relatedScripture,
          scriptureTranslation,
          translationReviewState,
          scriptureVerifiedAt: translationReviewState === "APPROVED" ? new Date() : null,
          isManuallyEdited: true,
          status: "NEEDS_REVIEW",
        },
      });
    });

    await recordContentFunnelEvent({
      eventType: "EDITED",
      sermonId: parsed.data.sermonId,
      opportunityId: existing.id,
      dedupeKey: editedRevisionId
        ? `content-edited:${editedRevisionId}`
        : `content-edited:${existing.id}:${Date.now()}`,
      metadata: {
        opportunityType: existing.opportunityType,
        fromStatus: existing.status,
        toStatus: "NEEDS_REVIEW",
      },
    });
    if (existing.status === "APPROVED" || existing.status === "USED") {
      await recordContentFunnelEvent({
        eventType: "REAPPROVAL_REQUIRED",
        sermonId: parsed.data.sermonId,
        opportunityId: existing.id,
        dedupeKey: editedRevisionId
          ? `content-reapproval-required:${editedRevisionId}`
          : `content-reapproval-required:${existing.id}:${Date.now()}`,
        metadata: {
          opportunityType: existing.opportunityType,
          fromStatus: existing.status,
          toStatus: "NEEDS_REVIEW",
        },
      });
    }

    revalidateOpportunityPaths(parsed.data.sermonId);
    return { success: true, message: "Opportunity content updated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content update failed.";
    return { success: false, message };
  }
}

export async function recordContentOpportunityPreviewAction(
  sermonId: string,
  opportunityId: string,
): Promise<{ success: boolean }> {
  if (!sermonId?.trim() || !opportunityId?.trim()) return { success: false };
  const opportunity = await prisma.contentOpportunity.findFirst({
    where: { id: opportunityId, sermonId },
    select: { id: true, opportunityType: true },
  });
  if (!opportunity) return { success: false };
  await recordContentFunnelEvent({
    eventType: "PREVIEWED",
    sermonId,
    opportunityId,
    dedupeKey: `content-previewed:${opportunityId}`,
    metadata: { opportunityType: opportunity.opportunityType },
  });
  return { success: true };
}
