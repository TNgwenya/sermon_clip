"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  generateContentOpportunities,
  regenerateContentOpportunities,
  type OpportunityGenerationResult,
} from "@/server/agents/contentMultiplicationService";
import { CONTENT_OPPORTUNITY_TYPES } from "@/server/ai/contentOpportunitySchema";

export type ContentOpportunityActionState = {
  success: boolean;
  message: string;
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
});

function buildGenerationMessage(
  result: OpportunityGenerationResult,
  targetType?: string,
): string {
  if (result.reusedExistingOpportunities) {
    return targetType
      ? `Existing ${targetType} opportunities were reused.`
      : "Existing content opportunities were reused.";
  }

  const archiveText = result.archivedCount > 0
    ? ` Archived ${result.archivedCount} older draft${result.archivedCount === 1 ? "" : "s"}.`
    : "";

  return targetType
    ? `Generated ${result.opportunityCount} ${targetType} opportunit${result.opportunityCount === 1 ? "y" : "ies"}.${archiveText}`
    : `Generated ${result.opportunityCount} content opportunit${result.opportunityCount === 1 ? "y" : "ies"}.${archiveText}`;
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
    const result = await generateContentOpportunities(sermonId);
    revalidateOpportunityPaths(sermonId);
    return { success: true, message: buildGenerationMessage(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation error.";
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
    const result = await regenerateContentOpportunities(sermonId);
    revalidateOpportunityPaths(sermonId);
    return { success: true, message: buildGenerationMessage(result) };
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
    const result = await regenerateContentOpportunities(sermonId, {
      targetType: parsedType.data,
    });

    revalidateOpportunityPaths(sermonId);
    return {
      success: true,
      message: buildGenerationMessage(result, parsedType.data),
    };
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
        editedContent: true,
        bodyContent: true,
        approvedContent: true,
      },
    });

    if (!current) {
      return { success: false, message: "Opportunity not found for this sermon." };
    }

    await prisma.contentOpportunity.update({
      where: { id: current.id },
      data: {
        status: parsedStatus.data,
        approvedContent:
          parsedStatus.data === "APPROVED"
            ? current.editedContent?.trim() || current.bodyContent
            : current.approvedContent,
      },
    });

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
      select: { id: true },
    });

    if (!existing) {
      return { success: false, message: "Opportunity not found." };
    }

    await prisma.contentOpportunity.update({
      where: { id: existing.id },
      data: {
        title: parsed.data.title,
        shortDescription: parsed.data.shortDescription?.trim() || null,
        editedContent: parsed.data.content,
        isManuallyEdited: true,
        status: "NEEDS_REVIEW",
      },
    });

    revalidateOpportunityPaths(parsed.data.sermonId);
    return { success: true, message: "Opportunity content updated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content update failed.";
    return { success: false, message };
  }
}
