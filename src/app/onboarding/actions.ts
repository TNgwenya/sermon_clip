"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";

export type ChurchIdentityActionState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    name?: string;
    timezone?: string;
    defaultLanguage?: string;
  };
};

export type WorkflowDefaultsActionState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    defaultSpeakerName?: string;
    notificationEmail?: string;
    postsPerWeek?: string;
    reviewDay?: string;
  };
};

const churchIdentitySchema = z.object({
  name: z.string().trim().min(2, "Enter the church name.").max(120, "Keep the church name under 120 characters."),
  timezone: z.string().trim().min(1, "Choose a timezone.").max(80, "Choose a valid timezone."),
  defaultLanguage: z.string().trim().min(2, "Choose a language.").max(16, "Choose a valid language."),
});

const workflowDefaultsSchema = z.object({
  defaultSpeakerName: z.string().trim().min(2, "Enter the default preacher name.").max(100),
  notificationEmail: z.union([
    z.literal(""),
    z.string().trim().email("Enter a valid notification email."),
  ]),
  postsPerWeek: z.coerce.number().int().min(1).max(14),
  reviewDay: z.enum(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
});

export async function saveChurchIdentityAction(
  _previousState: ChurchIdentityActionState,
  formData: FormData,
): Promise<ChurchIdentityActionState> {
  let requestContext;
  try {
    requestContext = await requireRequestCapability("organization.update", {
      campusId: null,
    });
  } catch (error) {
    return {
      success: false,
      message: error instanceof AuthorizationError
        ? "Your role can review church identity but cannot change it."
        : "Church identity permissions could not be verified.",
    };
  }

  const result = churchIdentitySchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    defaultLanguage: formData.get("defaultLanguage"),
  });
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Correct the highlighted church details.",
      fieldErrors: {
        name: fields.name?.[0],
        timezone: fields.timezone?.[0],
        defaultLanguage: fields.defaultLanguage?.[0],
      },
    };
  }

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: requestContext.organizationId },
      data: result.data,
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: null,
        actorType: "USER",
        actorUserId: requestContext.actorId,
        action: "organization.identity_updated",
        targetType: "Organization",
        targetId: requestContext.organizationId,
        metadataJson: {
          name: result.data.name,
          timezone: result.data.timezone,
          defaultLanguage: result.data.defaultLanguage,
        },
      },
    }),
  ]);

  revalidatePath("/onboarding");
  revalidatePath("/sermons/new");

  return {
    success: true,
    message: "Church identity saved. New sermons will use these defaults.",
  };
}

export async function saveWorkflowDefaultsAction(
  _previousState: WorkflowDefaultsActionState,
  formData: FormData,
): Promise<WorkflowDefaultsActionState> {
  let requestContext;
  try {
    requestContext = await requireRequestCapability("organization.update", {
      campusId: null,
    });
  } catch (error) {
    return {
      success: false,
      message: error instanceof AuthorizationError
        ? "Your role can review workflow defaults but cannot change them."
        : "Workflow permissions could not be verified.",
    };
  }

  const result = workflowDefaultsSchema.safeParse({
    defaultSpeakerName: formData.get("defaultSpeakerName"),
    notificationEmail: formData.get("notificationEmail"),
    postsPerWeek: formData.get("postsPerWeek"),
    reviewDay: formData.get("reviewDay"),
  });
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Correct the highlighted workflow defaults.",
      fieldErrors: {
        defaultSpeakerName: fields.defaultSpeakerName?.[0],
        notificationEmail: fields.notificationEmail?.[0],
        postsPerWeek: fields.postsPerWeek?.[0],
        reviewDay: fields.reviewDay?.[0],
      },
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: requestContext.organizationId },
    select: { defaultLanguage: true },
  });
  if (!organization) {
    return {
      success: false,
      message: "The active church workspace could not be loaded.",
    };
  }

  await prisma.$transaction([
    prisma.organizationAutomationSettings.upsert({
      where: { organizationId: requestContext.organizationId },
      create: {
        organizationId: requestContext.organizationId,
        defaultSpeakerName: result.data.defaultSpeakerName,
        defaultLanguage: organization.defaultLanguage,
        notificationEmail: result.data.notificationEmail || null,
        weeklyCadenceJson: {
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
        },
      },
      update: {
        defaultSpeakerName: result.data.defaultSpeakerName,
        defaultLanguage: organization.defaultLanguage,
        notificationEmail: result.data.notificationEmail || null,
        weeklyCadenceJson: {
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
        },
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: null,
        actorType: "USER",
        actorUserId: requestContext.actorId,
        action: "organization.workflow_defaults_updated",
        targetType: "OrganizationAutomationSettings",
        targetId: requestContext.organizationId,
        metadataJson: {
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
          notificationEmailConfigured: Boolean(result.data.notificationEmail),
        },
      },
    }),
  ]);

  revalidatePath("/onboarding");
  revalidatePath("/sermons/new");
  revalidatePath("/settings/intake");

  return {
    success: true,
    message: "Weekly rhythm saved. New sermons will use these defaults.",
  };
}
