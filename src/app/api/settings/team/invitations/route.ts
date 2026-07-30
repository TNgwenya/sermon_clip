import type { MembershipRole } from "@prisma/client";

import { isOrganizationRole } from "@/server/auth/authorization";
import {
  issueOrganizationInvitation,
} from "@/server/organizations/trustService";

import {
  organizationTrustContext,
  requireTeamRouteContext,
  teamJson,
  trustErrorResponse,
} from "../_security";

type InvitationRequestBody = {
  email?: unknown;
  role?: unknown;
  campusId?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireTeamRouteContext(request, "invitations.manage");
  if (authorized.error) {
    return authorized.error;
  }

  const body = await request.json().catch(() => null) as InvitationRequestBody | null;
  if (!body) {
    return teamJson(
      { success: false, message: "Enter valid invitation details." },
      400,
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const role = typeof body.role === "string" && isOrganizationRole(body.role)
    ? body.role as MembershipRole
    : null;
  const rawCampusId = body.campusId;
  if (
    rawCampusId !== undefined
    && rawCampusId !== null
    && typeof rawCampusId !== "string"
  ) {
    return teamJson(
      { success: false, message: "The invitation scope is invalid." },
      400,
    );
  }

  const campusId = rawCampusId === undefined
    ? authorized.context.campusId
    : rawCampusId === null || rawCampusId.trim() === ""
      ? null
      : rawCampusId.trim();

  const scopedAuthorization = await requireTeamRouteContext(
    request,
    "invitations.manage",
    { campusId },
  );
  if (scopedAuthorization.error) {
    return scopedAuthorization.error;
  }
  if (!role) {
    return teamJson(
      { success: false, message: "Choose a valid team role." },
      400,
    );
  }

  try {
    const invitation = await issueOrganizationInvitation(
      organizationTrustContext(scopedAuthorization.context, request),
      {
        email,
        role,
        campusId,
      },
    );
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const acceptUrl = new URL(
      "/accept-invitation",
      configuredAppUrl || request.url,
    );
    acceptUrl.searchParams.set("token", invitation.token);

    return teamJson(
      {
        success: true,
        invitation: {
          invitationId: invitation.invitationId,
          expiresAt: invitation.expiresAt.toISOString(),
          acceptUrl: acceptUrl.toString(),
        },
      },
      201,
    );
  } catch (error) {
    return trustErrorResponse(error);
  }
}
