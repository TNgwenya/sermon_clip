"use server";

import { redirect } from "next/navigation";

import {
  decideWeekDraftItemApprovalAction,
  requestDefaultWeekDraftItemApprovalAction,
} from "@/app/inbox/actions";
import {
  assembleAutomaticWeekDraft,
  AutomaticWeekDraftError,
} from "@/server/weekDraft/assembler";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";

const WEEK_DRAFT_FOCUS_FORMATS = {
  BALANCED: [],
  SOCIAL: [
    "SHORT_FORM_VIDEO",
    "QUOTE_GRAPHIC",
    "CAROUSEL",
    "TEXT_POST",
  ],
  DISCIPLESHIP: [
    "DEVOTIONAL",
    "GUIDE",
    "PRAYER",
    "SCRIPTURE_GRAPHIC",
  ],
  CHURCH_COMMS: [
    "EMAIL",
    "NEWSLETTER",
    "SERMON_RECAP",
    "TEXT_POST",
  ],
} as const;

function requiredString(
  formData: FormData,
  key: string,
  message: string,
): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

export async function assembleAutomaticWeekDraftAction(
  formData: FormData,
): Promise<never> {
  const requestContext = await requireRequestCapability("content.create");
  const sermonId = requiredString(
    formData,
    "sermonId",
    "Choose a sermon before creating a Week Draft.",
  );
  const weekStartsOn = new Date(`${requiredString(
    formData,
    "weekStartsOn",
    "Choose the week this draft is for.",
  )}T00:00:00.000Z`);
  const timezone = requiredString(
    formData,
    "timezone",
    "Choose the church timezone.",
  );
  const requestedCount = Number(requiredString(
    formData,
    "targetItemCount",
    "Choose the size of the automatic content mix.",
  ));
  if (requestedCount !== 5 && requestedCount !== 6 && requestedCount !== 7) {
    throw new Error("Automatic Week Drafts can contain 5, 6, or 7 total items.");
  }
  const focusValue = requiredString(
    formData,
    "mixFocus",
    "Choose the focus for this Week Draft.",
  );
  if (!(focusValue in WEEK_DRAFT_FOCUS_FORMATS)) {
    throw new Error("Choose a valid Week Draft focus.");
  }
  const preferredFormats =
    WEEK_DRAFT_FOCUS_FORMATS[
      focusValue as keyof typeof WEEK_DRAFT_FOCUS_FORMATS
    ];

  let result;
  try {
    result = await assembleAutomaticWeekDraft({
      tenant: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      sermonId,
      weekStartsOn,
      timezone,
      createdByUserId: requestContext.actorId,
      config: {
        targetItemCount: requestedCount,
        preferredFormats,
      },
    });
  } catch (error) {
    const message = error instanceof AutomaticWeekDraftError
      ? error.message
      : "Sermon Clip could not assemble this week. Please try again.";
    redirect(`/week-drafts?error=${encodeURIComponent(message)}`);
  }

  redirect(`/week-drafts/${result.id}`);
}

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectToWeekDraft(
  weekDraftId: string,
  result: Readonly<{ success: boolean; message: string }>,
): never {
  const params = new URLSearchParams({
    [result.success ? "notice" : "error"]: result.message,
  });
  redirect(
    `/week-drafts/${encodeURIComponent(weekDraftId)}?${params.toString()}`,
  );
}

export async function sendWeekDraftItemForApprovalFormAction(
  formData: FormData,
): Promise<void> {
  const weekDraftId = formText(formData, "weekDraftId");
  const result = await requestDefaultWeekDraftItemApprovalAction({
    weekDraftItemId: formText(formData, "weekDraftItemId"),
    message: "Pastor review requested from the Week Draft.",
  });
  redirectToWeekDraft(weekDraftId, result);
}

export async function approveWeekDraftReviewFormAction(
  formData: FormData,
): Promise<void> {
  const weekDraftId = formText(formData, "weekDraftId");
  const result = await decideWeekDraftItemApprovalAction({
    approvalRequestId: formText(formData, "approvalRequestId"),
    decidedAsRole: formText(formData, "decidedAsRole"),
    decision: "APPROVE",
  });
  redirectToWeekDraft(weekDraftId, result);
}

export async function requestWeekDraftReviewChangeFormAction(
  formData: FormData,
): Promise<void> {
  const weekDraftId = formText(formData, "weekDraftId");
  const result = await decideWeekDraftItemApprovalAction({
    approvalRequestId: formText(formData, "approvalRequestId"),
    decidedAsRole: formText(formData, "decidedAsRole"),
    decision: "REQUEST_CHANGES",
    reason: formText(formData, "reason"),
  });
  redirectToWeekDraft(weekDraftId, result);
}
