"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";

export type YoutubeIntakeSettingsActionState = {
  success: boolean;
  message: string;
  fieldErrors?: {
    youtubeSocialAccountId?: string;
    rightsConfirmed?: string;
    defaultSpeakerName?: string;
    defaultLanguage?: string;
    notificationEmail?: string;
    postsPerWeek?: string;
    reviewDay?: string;
  };
};

const intakeSettingsSchema = z.object({
  youtubeSocialAccountId: z.string().trim().min(1, "Choose the church YouTube channel."),
  rightsConfirmed: z.boolean(),
  automaticYoutubeImportEnabled: z.boolean(),
  defaultSpeakerName: z.string().trim().min(2, "Enter the default preacher name.").max(100),
  defaultLanguage: z.string().trim().min(2, "Choose a default language.").max(16),
  notificationEmail: z.string().trim().email("Enter the email that should receive completion notices."),
  postsPerWeek: z.coerce.number().int().min(1).max(14),
  reviewDay: z.enum(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
});

export async function saveYoutubeIntakeSettingsAction(
  _previousState: YoutubeIntakeSettingsActionState,
  formData: FormData,
): Promise<YoutubeIntakeSettingsActionState> {
  let requestContext;
  try {
    requestContext = await requireRequestCapability("channels.manage");
  } catch (error) {
    return {
      success: false,
      message: error instanceof AuthorizationError
        ? "Your role can review intake status but cannot configure church channels."
        : "Channel permissions could not be verified.",
    };
  }

  const result = intakeSettingsSchema.safeParse({
    youtubeSocialAccountId: formData.get("youtubeSocialAccountId"),
    rightsConfirmed: formData.get("rightsConfirmed") === "on",
    automaticYoutubeImportEnabled: formData.get("automaticYoutubeImportEnabled") === "on",
    defaultSpeakerName: formData.get("defaultSpeakerName"),
    defaultLanguage: formData.get("defaultLanguage"),
    notificationEmail: formData.get("notificationEmail"),
    postsPerWeek: formData.get("postsPerWeek"),
    reviewDay: formData.get("reviewDay"),
  });
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Correct the highlighted automatic intake settings.",
      fieldErrors: {
        youtubeSocialAccountId: fields.youtubeSocialAccountId?.[0],
        defaultSpeakerName: fields.defaultSpeakerName?.[0],
        defaultLanguage: fields.defaultLanguage?.[0],
        notificationEmail: fields.notificationEmail?.[0],
        postsPerWeek: fields.postsPerWeek?.[0],
        reviewDay: fields.reviewDay?.[0],
      },
    };
  }

  if (result.data.automaticYoutubeImportEnabled && !result.data.rightsConfirmed) {
    return {
      success: false,
      message: "Automatic intake remains off until recording rights are explicitly confirmed.",
      fieldErrors: {
        rightsConfirmed: "Confirm that the church may process future public sermons from this channel.",
      },
    };
  }

  const account = await prisma.socialAccount.findFirst({
    where: {
      id: result.data.youtubeSocialAccountId,
      organizationId: requestContext.organizationId,
      platform: "YOUTUBE_SHORTS",
      status: "CONNECTED",
      ...(requestContext.campusId
        ? { OR: [{ campusId: requestContext.campusId }, { campusId: null }] }
        : { campusId: null }),
      credentials: {
        some: {
          provider: "YOUTUBE",
          status: "CONNECTED",
        },
      },
    },
    select: {
      id: true,
      label: true,
    },
  });
  if (!account) {
    return {
      success: false,
      message: "The selected YouTube channel is not connected to this workspace.",
      fieldErrors: {
        youtubeSocialAccountId: "Reconnect YouTube, then choose the connected church channel.",
      },
    };
  }

  const existing = await prisma.organizationAutomationSettings.findUnique({
    where: { organizationId: requestContext.organizationId },
    select: {
      youtubeSocialAccountId: true,
      youtubeRightsConfirmedAt: true,
      youtubeRightsConfirmedByUserId: true,
      onboardingCompletedAt: true,
    },
  });
  const consentStillApplies = result.data.rightsConfirmed
    && existing?.youtubeSocialAccountId === account.id
    && existing.youtubeRightsConfirmedAt
    && existing.youtubeRightsConfirmedByUserId;
  const rightsData = result.data.rightsConfirmed
    ? {
        youtubeRightsConfirmedAt: consentStillApplies
          ? existing.youtubeRightsConfirmedAt
          : new Date(),
        youtubeRightsConfirmedByUserId: consentStillApplies
          ? existing.youtubeRightsConfirmedByUserId
          : requestContext.actorId,
      }
    : {
        youtubeRightsConfirmedAt: null,
        youtubeRightsConfirmedByUserId: null,
      };

  await prisma.$transaction([
    prisma.organizationAutomationSettings.upsert({
      where: { organizationId: requestContext.organizationId },
      create: {
        organizationId: requestContext.organizationId,
        youtubeSocialAccountId: account.id,
        automaticYoutubeImportEnabled: result.data.automaticYoutubeImportEnabled,
        ...rightsData,
        defaultSpeakerName: result.data.defaultSpeakerName,
        defaultLanguage: result.data.defaultLanguage,
        notificationEmail: result.data.notificationEmail,
        weeklyCadenceJson: {
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
        },
        onboardingCompletedAt: result.data.automaticYoutubeImportEnabled
          ? new Date()
          : null,
        lastError: null,
      },
      update: {
        youtubeSocialAccountId: account.id,
        automaticYoutubeImportEnabled: result.data.automaticYoutubeImportEnabled,
        ...rightsData,
        defaultSpeakerName: result.data.defaultSpeakerName,
        defaultLanguage: result.data.defaultLanguage,
        notificationEmail: result.data.notificationEmail,
        weeklyCadenceJson: {
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
        },
        ...(result.data.automaticYoutubeImportEnabled
          ? { onboardingCompletedAt: existing?.onboardingCompletedAt ?? new Date() }
          : {}),
        lastError: null,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
        actorType: "USER",
        actorUserId: requestContext.actorId,
        action: result.data.automaticYoutubeImportEnabled
          ? "youtube_automatic_intake.enabled"
          : "youtube_automatic_intake.settings_saved",
        targetType: "OrganizationAutomationSettings",
        targetId: requestContext.organizationId,
        metadataJson: {
          youtubeSocialAccountId: account.id,
          accountLabel: account.label,
          rightsConfirmed: result.data.rightsConfirmed,
          automaticYoutubeImportEnabled: result.data.automaticYoutubeImportEnabled,
          postsPerWeek: result.data.postsPerWeek,
          reviewDay: result.data.reviewDay,
        },
      },
    }),
  ]);

  revalidatePath("/settings/intake");
  revalidatePath("/onboarding");
  revalidatePath("/sermons/new");

  return {
    success: true,
    message: result.data.automaticYoutubeImportEnabled
      ? "Automatic intake enabled. Wait for the first recorded worker scan before relying on channel monitoring."
      : "YouTube intake settings saved. Automatic monitoring remains off.",
  };
}
