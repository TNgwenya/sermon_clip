import {
  revokeOrganizationInvitation,
} from "@/server/organizations/trustService";

import {
  organizationTrustContext,
  requireTeamRouteContext,
  teamJson,
  trustErrorResponse,
} from "../../_security";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, route: RouteContext) {
  const authorized = await requireTeamRouteContext(
    request,
    "invitations.manage",
  );
  if (authorized.error) {
    return authorized.error;
  }

  const { id } = await route.params;
  try {
    await revokeOrganizationInvitation(
      organizationTrustContext(authorized.context, request),
      id,
    );
    return teamJson({ success: true });
  } catch (error) {
    return trustErrorResponse(error);
  }
}
