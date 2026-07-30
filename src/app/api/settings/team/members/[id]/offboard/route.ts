import {
  offboardOrganizationMember,
} from "@/server/organizations/trustService";

import {
  organizationTrustContext,
  requireTeamRouteContext,
  teamJson,
  trustErrorResponse,
} from "../../../_security";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type OffboardRequestBody = {
  reassignRoleToUserId?: unknown;
};

export async function POST(request: Request, route: RouteContext) {
  const authorized = await requireTeamRouteContext(request, "members.manage");
  if (authorized.error) {
    return authorized.error;
  }

  const body = await request.json().catch(() => ({})) as OffboardRequestBody;
  if (
    body.reassignRoleToUserId !== undefined
    && body.reassignRoleToUserId !== null
    && typeof body.reassignRoleToUserId !== "string"
  ) {
    return teamJson(
      { success: false, message: "Choose a valid reassignment member." },
      400,
    );
  }

  const { id } = await route.params;
  const replacementUserId = typeof body.reassignRoleToUserId === "string"
    ? body.reassignRoleToUserId.trim() || null
    : null;

  try {
    const result = await offboardOrganizationMember(
      organizationTrustContext(authorized.context, request),
      {
        membershipId: id,
        reassignRoleToUserId: replacementUserId,
      },
    );
    return teamJson({ success: true, result });
  } catch (error) {
    return trustErrorResponse(error);
  }
}
